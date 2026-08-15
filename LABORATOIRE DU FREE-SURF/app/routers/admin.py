from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core import config as app_cfg
from app.core.access import can_manage_user_lineage, has_root_access


def _is_mapping(value: Any) -> bool:
    return isinstance(value, dict)


def _is_truthy_env(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _normalize_distribution(raw: Any) -> dict[str, dict[str, bool]]:
    if not isinstance(raw, dict):
        return {}

    out: dict[str, dict[str, bool]] = {}
    for key, value in raw.items():
        remark = str(key or "").strip()
        if not remark:
            continue

        payload = value if isinstance(value, dict) else {}
        out[remark] = {
            "FREE": bool(payload.get("FREE", False)),
            "VIP": bool(payload.get("VIP", False)),
            "REV": bool(payload.get("REV", False)),
        }
    return out


def _load_distribution(db: Any) -> dict[str, dict[str, bool]]:
    repo = getattr(db, "configs_distribution", None)
    if repo is None:
        return {}

    stored = None
    try:
        stored = repo.get("config_distribution")
    except Exception:
        stored = None

    normalized = _normalize_distribution(stored)
    if normalized:
        return normalized

    legacy: Any = {}
    try:
        legacy = repo.get_all()
    except Exception:
        legacy = {}

    if not isinstance(legacy, dict):
        return {}

    allowed: dict[str, Any] = {}
    for key, value in legacy.items():
        name = str(key or "").strip()
        if not name:
            continue
        if name in {"config_distribution", "config_templates", "templates"}:
            continue
        allowed[name] = value

    return _normalize_distribution(allowed)


def _as_error_response(check: Any) -> JSONResponse | None:
    if isinstance(check, JSONResponse):
        return check
    return None


def create_admin_router(
    *,
    db: Any,
    require_admin_api: Callable[[Request], Any],
    fetch_panel_inbounds: Callable[..., Any],
    get_panel_provider: Callable[[], Any],
    list_transport_backends: Callable[[], list[dict]] = lambda: [],
    list_provisioning_backends: Callable[[], list[dict]] = lambda: [],
    get_provisioners: Callable[[], list[Any]] = lambda: [],
    config_agent: Any = None,
) -> APIRouter:
    router = APIRouter()
    users_repo = getattr(db, "users", None)
    config_repo = getattr(db, "configs_distribution", None)
    last_provisioning_key = "admin_last_provisioning_run"

    def _load_user_by_id(user_id: int) -> dict[str, Any] | None:
        if users_repo is None or not callable(getattr(users_repo, "get_by_id", None)):
            return None
        try:
            row = users_repo.get_by_id(int(user_id))
        except Exception:
            return None
        return dict(row) if isinstance(row, dict) else None

    def _json_forbidden(message: str) -> JSONResponse:
        return JSONResponse({"status": "error", "message": str(message or "Interdit")}, status_code=403)

    def _ensure_manageable_target(actor: dict[str, Any], target: dict[str, Any]) -> JSONResponse | None:
        if has_root_access(actor):
            return None
        if can_manage_user_lineage(actor, target, _load_user_by_id):
            return None
        return _json_forbidden("Acces root requis pour cette cible.")

    def _serialize_provisioning_result(value: Any) -> dict[str, Any] | None:
        if isinstance(value, dict):
            return dict(value)
        serializer = getattr(value, "as_dict", None)
        if callable(serializer):
            try:
                payload = serializer()
            except Exception:
                return None
            return dict(payload) if isinstance(payload, dict) else None
        return None

    def _target_user_payload(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": int(user.get("id", 0) or 0),
            "username": str(user.get("username", "") or "").strip(),
            "type": str(user.get("type", "") or "").strip(),
            "status": str(user.get("status", "") or "").strip(),
            "expiration": str(user.get("expiration", "") or "").strip(),
        }

    def _action_status_for(provisioner: Any, action: str) -> dict[str, Any] | None:
        resolved_action = "disable" if str(action or "").strip().lower() == "disable" else "upsert"
        loader = getattr(provisioner, "action_status", None)
        if callable(loader):
            try:
                payload = loader(resolved_action)
            except Exception:
                payload = None
            return dict(payload) if isinstance(payload, dict) else None
        loader = getattr(provisioner, "status_dict", None)
        if callable(loader):
            try:
                payload = loader()
            except Exception:
                payload = None
            return dict(payload) if isinstance(payload, dict) else None
        return None

    def _load_target_user(body: Any) -> tuple[dict[str, Any] | None, JSONResponse | None]:
        if not isinstance(body, dict):
            body = {}
        raw_user_id = str(body.get("user_id", "") or "").strip()
        if raw_user_id:
            if users_repo is None or not callable(getattr(users_repo, "get_by_id", None)):
                return None, JSONResponse({"status": "error", "message": "Stockage utilisateur indisponible."}, status_code=500)
            try:
                user_id = int(raw_user_id)
            except Exception:
                return None, JSONResponse({"status": "error", "message": "user_id invalide."}, status_code=400)
            row = _load_user_by_id(user_id)
            return (dict(row), None) if isinstance(row, dict) else (None, JSONResponse({"status": "error", "message": "Utilisateur introuvable."}, status_code=404))
        username = str(body.get("username", "") or "").strip()
        if username:
            if users_repo is None or not callable(getattr(users_repo, "get_by_username", None)):
                return None, JSONResponse({"status": "error", "message": "Stockage utilisateur indisponible."}, status_code=500)
            row = users_repo.get_by_username(username)
            return (dict(row), None) if isinstance(row, dict) else (None, JSONResponse({"status": "error", "message": "Utilisateur introuvable."}, status_code=404))
        return None, JSONResponse({"status": "error", "message": "username ou user_id requis."}, status_code=400)

    def _build_provisioning_run(*, user: dict[str, Any], reason: str, action: str, dry_run: bool, actor: dict[str, Any]) -> dict[str, Any]:
        items: list[dict[str, Any]] = []
        transport_action = "disable" if str(action or "").strip().lower() == "disable" else "upsert"
        method_name = "disable_user" if transport_action == "disable" else "ensure_user"
        for provisioner in get_provisioners() or []:
            if dry_run:
                payload = _action_status_for(provisioner, transport_action)
                if payload is None:
                    continue
                payload["action"] = action
                payload["dry_run"] = True
                payload["would_run"] = bool(payload.get("configured", False))
                items.append(payload)
                continue
            runner = getattr(provisioner, method_name, None)
            if not callable(runner):
                continue
            try:
                raw = runner(dict(user), reason=reason)
            except Exception as exc:
                raw = getattr(exc, "result", None)
                payload = _serialize_provisioning_result(raw)
                if payload is None:
                    action_status = _action_status_for(provisioner, transport_action) or {}
                    payload = {
                        "engine": str(getattr(provisioner, "engine_name", "unknown") or "unknown"),
                        "action": transport_action,
                        "configured": bool(action_status.get("configured", True)),
                        "ok": False,
                        "message": str(exc),
                    }
                items.append(payload)
                continue
            payload = _serialize_provisioning_result(raw)
            if isinstance(payload, dict):
                items.append(payload)

        run = {
            "action": action,
            "dry_run": dry_run,
            "reason": str(reason or "").strip(),
            "target": _target_user_payload(user),
            "actor": {
                "username": str(actor.get("username", "") or "").strip(),
                "type": str(actor.get("type", "") or "").strip(),
            },
            "ran_at": datetime.now(timezone.utc).isoformat(),
            "provisioning": {
                "configured": any(bool(item.get("configured", False)) for item in items),
                "ok": all(bool(item.get("ok", False)) for item in items if bool(item.get("configured", False))) if items else True,
                "items": items,
            },
        }
        return run

    def _load_last_provisioning_run() -> dict[str, Any] | None:
        if config_repo is None or not callable(getattr(config_repo, "get", None)):
            return None
        try:
            payload = config_repo.get(last_provisioning_key)
        except Exception:
            return None
        return dict(payload) if isinstance(payload, dict) else None

    def _save_last_provisioning_run(payload: dict[str, Any]) -> None:
        if config_repo is None or not callable(getattr(config_repo, "set", None)):
            return
        try:
            config_repo.set(last_provisioning_key, dict(payload))
        except Exception:
            return

    def _list_runtime_tools() -> list[dict[str, Any]]:
        checker_path = str(getattr(config_agent, "checker_path", "") or "").strip() or "xray-checker"
        resolved = shutil.which(checker_path) or ""
        checker_ok = bool(resolved)

        secret_source = ""
        secret_value = ""
        for candidate in ("FS_CSRF_SECRET", "FS_VIP_SECRET", "VIP_COOKIE_SECRET"):
            raw = str(os.getenv(candidate, "") or "").strip()
            if not raw:
                continue
            secret_source = candidate
            secret_value = raw
            break
        session_secret_ok = bool(secret_value and secret_value != "dev-vip-cookie-secret-change-me")

        cookie_secure_value = str(os.getenv("FS_COOKIE_SECURE", "") or "").strip()
        cookie_secure_ok = _is_truthy_env(cookie_secure_value)

        env_profile = str(getattr(app_cfg, "ENV_PROFILE", "") or os.getenv("FS_ENV", "") or "").strip()
        env_file = str(getattr(app_cfg, "ENV_FILE_OVERRIDE", "") or os.getenv("FS_ENV_FILE", "") or "").strip()
        loaded_files = list(getattr(app_cfg, "ENV_FILES_LOADED", ()) or [])
        profile_label = str(getattr(app_cfg, "ENV_SOURCE_LABEL", "") or "").strip() or env_profile or env_file or "default .env"

        return [
            {
                "key": "xray-checker",
                "name": "xray-checker",
                "configured": True,
                "ok": checker_ok,
                "message": (
                    "Binaire local disponible."
                    if checker_ok
                    else "Binaire local introuvable; xray-checker ne pourra pas être lancé."
                ),
                "raw": {
                    "path": checker_path,
                    "resolved_path": resolved,
                },
            },
            {
                "key": "session-secret",
                "name": "session-secret",
                "configured": bool(secret_source),
                "ok": session_secret_ok,
                "status_label": "ok" if session_secret_ok else "a corriger",
                "message": (
                    f"Secret de session personnalise via {secret_source}."
                    if session_secret_ok
                    else "FS_CSRF_SECRET absent ou fallback dev detecte."
                ),
                "raw": {
                    "source": secret_source,
                },
            },
            {
                "key": "secure-cookies",
                "name": "secure-cookies",
                "configured": bool(cookie_secure_value),
                "ok": cookie_secure_ok,
                "status_label": "secure" if cookie_secure_ok else "a corriger",
                "message": (
                    "FS_COOKIE_SECURE est actif."
                    if cookie_secure_ok
                    else "FS_COOKIE_SECURE est desactive ou absent; les cookies ne sont pas forces en HTTPS."
                ),
                "raw": {
                    "value": cookie_secure_value,
                },
            },
            {
                "key": "env-profile",
                "name": "env-profile",
                "configured": True,
                "ok": True,
                "status_label": "profil",
                "message": f"Chargement env actif: {profile_label}.",
                "raw": {
                    "fs_env": env_profile,
                    "fs_env_file": env_file,
                    "loaded_files": loaded_files,
                },
            },
        ]

    @router.get("/lab-admin/api/panel-health")
    @router.get("/admin/api/panel-health")
    async def admin_panel_health(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied

        provider = get_panel_provider()
        backend_name = str(getattr(provider, "backend_name", "unknown") or "unknown")
        display_name = str(getattr(provider, "display_name", backend_name) or backend_name)

        try:
            payload = await provider.healthcheck()
            if not _is_mapping(payload):
                payload = {
                    "ok": False,
                    "backend": backend_name,
                    "display_name": display_name,
                    "message": "Reponse provider invalide.",
                }
            payload.setdefault("backend", backend_name)
            payload.setdefault("display_name", display_name)
            payload.setdefault("transport_backends", list_transport_backends())
            payload.setdefault("provisioning_backends", list_provisioning_backends())
            payload.setdefault("runtime_tools", _list_runtime_tools())
            payload.setdefault("last_provisioning_run", _load_last_provisioning_run())
            status_code = 200 if bool(payload.get("ok", False)) else 502
            return JSONResponse({"status": "success", "data": payload}, status_code=status_code)
        except Exception as exc:
            return JSONResponse(
                {
                    "status": "error",
                    "data": {
                        "ok": False,
                        "backend": backend_name,
                        "display_name": display_name,
                        "message": f"Erreur verification panel: {exc}",
                        "transport_backends": list_transport_backends(),
                        "provisioning_backends": list_provisioning_backends(),
                        "runtime_tools": _list_runtime_tools(),
                        "last_provisioning_run": _load_last_provisioning_run(),
                    },
                },
                status_code=502,
            )

    @router.get("/lab-admin/api/transport-backends")
    @router.get("/admin/api/transport-backends")
    async def admin_transport_backends(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied

        try:
            payload = list_transport_backends()
            if not isinstance(payload, list):
                payload = []
            return {"status": "success", "data": payload}
        except Exception as exc:
            return JSONResponse(
                {"status": "error", "message": f"Erreur moteurs transport: {exc}"},
                status_code=500,
            )

    @router.get("/lab-admin/api/provisioning-backends")
    @router.get("/admin/api/provisioning-backends")
    async def admin_provisioning_backends(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied

        try:
            payload = list_provisioning_backends()
            if not isinstance(payload, list):
                payload = []
            return {"status": "success", "data": payload}
        except Exception as exc:
            return JSONResponse(
                {"status": "error", "message": f"Erreur moteurs provisioning: {exc}"},
                status_code=500,
            )

    @router.get("/lab-admin/api/runtime-tools")
    @router.get("/admin/api/runtime-tools")
    async def admin_runtime_tools(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied
        return {"status": "success", "data": _list_runtime_tools()}

    @router.get("/lab-admin/api/provisioning-last-results")
    @router.get("/admin/api/provisioning-last-results")
    async def admin_provisioning_last_results(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied
        return {"status": "success", "data": _load_last_provisioning_run()}

    @router.post("/lab-admin/api/provisioning/dry-run")
    @router.post("/admin/api/provisioning/dry-run")
    async def admin_provisioning_dry_run(request: Request):
        actor = require_admin_api(request)
        denied = _as_error_response(actor)
        if denied is not None:
            return denied
        actor = dict(actor)
        try:
            body = await request.json()
        except Exception:
            body = {}
        user, error = _load_target_user(body)
        if error is not None:
            return error
        denied = _ensure_manageable_target(actor, user)
        if denied is not None:
            return denied
        reason = str((body or {}).get("reason", "admin_dry_run") or "admin_dry_run").strip()
        payload = _build_provisioning_run(user=dict(user), reason=reason, action="dry_run", dry_run=True, actor=actor)
        _save_last_provisioning_run(payload)
        return {"status": "success", "data": payload}

    @router.post("/lab-admin/api/provisioning/replay")
    @router.post("/admin/api/provisioning/replay")
    async def admin_provisioning_replay(request: Request):
        actor = require_admin_api(request)
        denied = _as_error_response(actor)
        if denied is not None:
            return denied
        actor = dict(actor)
        try:
            body = await request.json()
        except Exception:
            body = {}
        user, error = _load_target_user(body)
        if error is not None:
            return error
        denied = _ensure_manageable_target(actor, user)
        if denied is not None:
            return denied
        reason = str((body or {}).get("reason", "admin_replay") or "admin_replay").strip()
        payload = _build_provisioning_run(user=dict(user), reason=reason, action="replay", dry_run=False, actor=actor)
        _save_last_provisioning_run(payload)
        status_code = 200 if bool(payload.get("provisioning", {}).get("ok", False)) else 502
        return JSONResponse({"status": "success", "data": payload}, status_code=status_code)

    @router.post("/lab-admin/api/provisioning/disable")
    @router.post("/admin/api/provisioning/disable")
    async def admin_provisioning_disable(request: Request):
        actor = require_admin_api(request)
        denied = _as_error_response(actor)
        if denied is not None:
            return denied
        actor = dict(actor)
        try:
            body = await request.json()
        except Exception:
            body = {}
        user, error = _load_target_user(body)
        if error is not None:
            return error
        denied = _ensure_manageable_target(actor, user)
        if denied is not None:
            return denied
        reason = str((body or {}).get("reason", "admin_disable") or "admin_disable").strip()
        payload = _build_provisioning_run(user=dict(user), reason=reason, action="disable", dry_run=False, actor=actor)
        _save_last_provisioning_run(payload)
        status_code = 200 if bool(payload.get("provisioning", {}).get("ok", False)) else 502
        return JSONResponse({"status": "success", "data": payload}, status_code=status_code)

    @router.get("/lab-admin/api/fetch-panel-inbounds")
    @router.get("/admin/api/fetch-panel-inbounds")
    async def admin_fetch_panel_inbounds(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied

        force = str(request.query_params.get("force", "") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "y",
            "on",
        }
        provider = get_panel_provider()
        backend_name = str(getattr(provider, "backend_name", "unknown") or "unknown")
        display_name = str(getattr(provider, "display_name", backend_name) or backend_name)

        try:
            items = await fetch_panel_inbounds(force_refresh=force)
            if not isinstance(items, list):
                items = []
            return {
                "status": "success",
                "provider": backend_name,
                "provider_display_name": display_name,
                "data": items,
            }
        except Exception as exc:
            return JSONResponse(
                {
                    "status": "error",
                    "provider": backend_name,
                    "provider_display_name": display_name,
                    "message": str(exc),
                },
                status_code=502,
            )

    @router.get("/lab-admin/api/fetch-3xui")
    @router.get("/admin/api/fetch-3xui")
    async def admin_fetch_legacy_alias(request: Request):
        # Legacy alias kept for backward compatibility.
        return await admin_fetch_panel_inbounds(request)

    @router.get("/lab-admin/api/config-distribution")
    @router.get("/admin/api/config-distribution")
    async def admin_get_config_distribution(request: Request):
        denied = _as_error_response(require_admin_api(request))
        if denied is not None:
            return denied

        distribution = _load_distribution(db)
        return {"status": "success", "data": distribution}

    @router.post("/lab-admin/api/config-distribution")
    @router.post("/admin/api/config-distribution")
    async def admin_save_config_distribution(request: Request):
        actor = require_admin_api(request)
        denied = _as_error_response(actor)
        if denied is not None:
            return denied
        if not has_root_access(actor):
            return _json_forbidden("Acces root requis pour cette operation.")

        try:
            body = await request.json()
        except Exception:
            body = {}

        raw_distribution = body.get("distribution") if isinstance(body, dict) else {}
        if not isinstance(raw_distribution, dict):
            return JSONResponse(
                {"status": "error", "message": "Payload distribution invalide."},
                status_code=400,
            )

        cleaned = _normalize_distribution(raw_distribution)

        repo = getattr(db, "configs_distribution", None)
        if repo is None or not callable(getattr(repo, "set", None)):
            return JSONResponse(
                {"status": "error", "message": "Stockage distribution indisponible."},
                status_code=500,
            )

        try:
            repo.set("config_distribution", cleaned)
        except Exception as exc:
            return JSONResponse(
                {"status": "error", "message": f"Erreur sauvegarde distribution: {exc}"},
                status_code=500,
            )

        return {"status": "success", "data": cleaned}

    return router
