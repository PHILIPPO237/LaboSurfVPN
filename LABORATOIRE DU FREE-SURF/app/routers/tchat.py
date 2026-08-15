from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.access import canonicalize_legacy_user_type, is_admin_role, resolve_role_code


def _json_error(message: str, *, status_code: int) -> JSONResponse:
    return JSONResponse({"status": "error", "message": str(message or "Erreur")}, status_code=status_code)


def _safe_avatar(value: Any, safe_avatar_url: Callable[[Any], str] | None) -> str:
    if callable(safe_avatar_url):
        try:
            return str(safe_avatar_url(value) or "")
        except Exception:
            return ""
    return str(value or "").strip()


def _ui_user_type(user: dict[str, Any] | None) -> str:
    legacy_type = canonicalize_legacy_user_type((user or {}).get("type"))
    if legacy_type == "Revendeur":
        return "REVENDEUR"
    return legacy_type


def _is_unlimited(user: dict[str, Any]) -> bool:
    return _ui_user_type(user) in {"VIP", "REVENDEUR", "ADMIN", "PREMIUM"}


def _parse_timestamp(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return time.time()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).timestamp()
        except Exception:
            continue
    try:
        return float(text)
    except Exception:
        return time.time()


def _decode_message_payload(row: dict[str, Any]) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
    raw_content = row.get("content", "")
    text = str(raw_content or "")
    reply_to = None
    file_payload = None

    if isinstance(raw_content, dict):
        payload = raw_content
    else:
        payload = None
        stripped = text.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
            except Exception:
                parsed = None
            if isinstance(parsed, dict) and any(key in parsed for key in ("message", "replyTo", "file")):
                payload = parsed

    if isinstance(payload, dict):
        text = str(payload.get("message", "") or "")
        reply_to = payload.get("replyTo") if isinstance(payload.get("replyTo"), dict) else None
        file_payload = payload.get("file") if isinstance(payload.get("file"), dict) else None

    if file_payload is None:
        raw_file_url = str(row.get("file_url", "") or "").strip()
        if raw_file_url.startswith("{") and raw_file_url.endswith("}"):
            try:
                parsed_file = json.loads(raw_file_url)
            except Exception:
                parsed_file = None
            if isinstance(parsed_file, dict):
                file_payload = parsed_file
        elif raw_file_url:
            file_payload = {
                "url": raw_file_url,
                "name": str(row.get("msg_type", "file") or "file"),
                "type": str(row.get("msg_type", "document") or "document"),
                "size": "",
            }

    return text, reply_to, file_payload


def _format_message(
    row: dict[str, Any],
    profiles: dict[str, dict[str, Any]],
    safe_avatar_url: Callable[[Any], str] | None,
) -> dict[str, Any]:
    username = str(row.get("username", "") or "")
    profile = profiles.get(username.lower(), {}) if isinstance(profiles, dict) else {}
    message, reply_to, file_payload = _decode_message_payload(row)
    reactions = row.get("reactions", {})
    if not isinstance(reactions, dict):
        reactions = {}

    payload = {
        "id": int(row.get("id", 0) or 0),
        "username": username,
        "user_type": _ui_user_type(profile or {"type": row.get("user_type", "Gratuit")}),
        "avatar": _safe_avatar((profile or {}).get("avatar", row.get("avatar", "")), safe_avatar_url),
        "message": message,
        "timestamp": _parse_timestamp(row.get("created_at", "")),
        "reactions": reactions,
    }
    if isinstance(reply_to, dict):
        payload["replyTo"] = reply_to
    if isinstance(file_payload, dict):
        payload["file"] = file_payload
    return payload


def create_tchat_router(
    *,
    db: Any,
    cfg: Any,
    get_current_user: Callable[[Request], dict | None] | None = None,
    contains_link: Callable[[str], bool] | None = None,
    safe_avatar_url: Callable[[Any], str] | None = None,
) -> APIRouter:
    router = APIRouter()
    users_repo = getattr(db, "users", None)
    tchat_repo = getattr(db, "tchat", None)
    quotas_repo = getattr(db, "tchat_quotas", None)

    max_messages = max(50, int(getattr(cfg, "TCHAT_MAX_MESSAGES", 500) or 500))
    slowmode_free = max(0, int(getattr(cfg, "SLOWMODE_FREE", 2) or 0))
    max_files_free = max(0, int(getattr(cfg, "MAX_FILES_FREE", 2) or 0))
    max_links_free = max(0, int(getattr(cfg, "MAX_LINKS_FREE", 5) or 0))

    def _api_user(request: Request) -> dict[str, Any] | JSONResponse:
        if not callable(get_current_user):
            return _json_error("Authentification indisponible.", status_code=500)
        user = get_current_user(request)
        if not isinstance(user, dict):
            return _json_error("Authentification requise.", status_code=401)
        return dict(user)

    def _quota_state(user: dict[str, Any]) -> dict[str, Any]:
        unlimited = _is_unlimited(user)
        username = str(user.get("username", "") or "")
        today = datetime.now().strftime("%Y-%m-%d")
        current = quotas_repo.get(username, today) if quotas_repo and callable(getattr(quotas_repo, "get", None)) else None
        current = current if isinstance(current, dict) else {}
        files_used = max(0, int(current.get("files", 0) or 0))
        links_used = max(0, int(current.get("links", 0) or 0))
        last_msg = float(current.get("last_msg", 0) or 0)
        if unlimited:
            return {
                "username": username,
                "date": today,
                "unlimited": True,
                "files_used": files_used,
                "links_used": links_used,
                "files_left": 9999,
                "links_left": 9999,
                "last_msg": last_msg,
            }
        return {
            "username": username,
            "date": today,
            "unlimited": False,
            "files_used": files_used,
            "links_used": links_used,
            "files_left": max(0, max_files_free - files_used),
            "links_left": max(0, max_links_free - links_used),
            "last_msg": last_msg,
        }

    @router.get("/api/tchat/messages")
    async def get_messages(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        if tchat_repo is None or not callable(getattr(tchat_repo, "get_since", None)):
            return {"status": "ok", "messages": []}

        try:
            since_id = int(str(request.query_params.get("since", "0") or "0"))
        except Exception:
            since_id = 0

        rows = tchat_repo.get_since(since_id, limit=max_messages)
        usernames = [str(row.get("username", "") or "") for row in rows if isinstance(row, dict)]
        profiles_getter = getattr(users_repo, "get_profiles_by_usernames", None)
        profiles = profiles_getter(usernames) if callable(profiles_getter) else {}
        if not isinstance(profiles, dict):
            profiles = {}

        messages = [_format_message(dict(row), profiles, safe_avatar_url) for row in rows if isinstance(row, dict)]
        return {"status": "ok", "messages": messages}

    @router.post("/api/tchat/send")
    async def send_message(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        if tchat_repo is None or not callable(getattr(tchat_repo, "add", None)):
            return _json_error("Stockage tchat indisponible.", status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        message = str(body.get("message", "") or "").strip()
        reply_to = body.get("replyTo") if isinstance(body.get("replyTo"), dict) else None
        file_payload = body.get("file") if isinstance(body.get("file"), dict) else None
        if not message and not isinstance(file_payload, dict):
            return _json_error("Message vide.", status_code=400)

        quota = _quota_state(current_user)
        now_epoch = time.time()
        if not quota["unlimited"]:
            if slowmode_free > 0 and quota["last_msg"] > 0 and (now_epoch - quota["last_msg"]) < slowmode_free:
                wait_seconds = max(1, int(round(slowmode_free - (now_epoch - quota["last_msg"])) ))
                return {"status": "error", "message": f"Patientez {wait_seconds}s avant d'envoyer un autre message."}
            if isinstance(file_payload, dict) and quota["files_left"] <= 0:
                return {"status": "error", "message": "Quota fichiers atteint pour aujourd'hui."}
            if message and callable(contains_link) and contains_link(message) and quota["links_left"] <= 0:
                return {"status": "error", "message": "Quota liens atteint pour aujourd'hui."}

        stored_payload = {"message": message}
        if isinstance(reply_to, dict):
            stored_payload["replyTo"] = {
                "id": int(reply_to.get("id", 0) or 0),
                "username": str(reply_to.get("username", "") or ""),
                "text": str(reply_to.get("text", "") or ""),
            }
        if isinstance(file_payload, dict):
            stored_payload["file"] = {
                "name": str(file_payload.get("name", "") or ""),
                "size": str(file_payload.get("size", "") or ""),
                "type": str(file_payload.get("type", "document") or "document"),
                "url": str(file_payload.get("url", "") or ""),
            }

        saved = tchat_repo.add(
            {
                "user_id": current_user.get("id"),
                "username": str(current_user.get("username", "") or ""),
                "content": json.dumps(stored_payload, ensure_ascii=False),
                "msg_type": str((file_payload or {}).get("type", "text") or "text"),
                "file_url": json.dumps(stored_payload.get("file"), ensure_ascii=False) if stored_payload.get("file") else "",
                "reactions": {},
            }
        )

        if quotas_repo is not None and callable(getattr(quotas_repo, "upsert", None)):
            files_used = quota["files_used"] + (1 if isinstance(file_payload, dict) and not quota["unlimited"] else 0)
            link_used = quota["links_used"] + (1 if message and callable(contains_link) and contains_link(message) and not quota["unlimited"] else 0)
            quotas_repo.upsert(quota["username"], quota["date"], files_used, link_used, now_epoch)

        trim = getattr(tchat_repo, "trim", None)
        if callable(trim):
            trim(max_messages)

        profile = {
            "type": current_user.get("type", "Gratuit"),
            "avatar": current_user.get("avatar", ""),
        }
        return {
            "status": "ok",
            "message": "Message envoye.",
            "data": _format_message({**saved, "reactions": {}}, {str(current_user.get("username", "")).lower(): profile}, safe_avatar_url),
        }

    @router.post("/api/tchat/delete")
    async def delete_message(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        if tchat_repo is None or not callable(getattr(tchat_repo, "get_by_id", None)):
            return _json_error("Stockage tchat indisponible.", status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        raw_message_id = body.get("id") if "id" in body else body.get("message_id")
        try:
            message_id = int(raw_message_id or 0)
        except Exception:
            message_id = 0
        if message_id <= 0:
            return _json_error("message_id invalide.", status_code=400)

        row = tchat_repo.get_by_id(message_id)
        if not isinstance(row, dict):
            return _json_error("Message introuvable.", status_code=404)

        is_owner = str(row.get("username", "") or "").strip().lower() == str(current_user.get("username", "") or "").strip().lower()
        is_admin = is_admin_role(current_user)
        if not is_owner and not is_admin:
            return _json_error("Suppression interdite.", status_code=403)

        deleted = tchat_repo.delete(message_id) if callable(getattr(tchat_repo, "delete", None)) else False
        if not deleted:
            return _json_error("Suppression impossible.", status_code=500)
        return {"status": "ok", "message": "Message supprime."}

    @router.post("/api/tchat/react")
    async def react_message(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        if tchat_repo is None or not callable(getattr(tchat_repo, "get_by_id", None)):
            return _json_error("Stockage tchat indisponible.", status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        try:
            message_id = int(body.get("message_id", 0) or 0)
        except Exception:
            message_id = 0
        emoji = str(body.get("emoji", "") or "").strip()
        if message_id <= 0 or not emoji:
            return _json_error("Reaction invalide.", status_code=400)

        row = tchat_repo.get_by_id(message_id)
        if not isinstance(row, dict):
            return _json_error("Message introuvable.", status_code=404)

        reactions = row.get("reactions", {})
        if not isinstance(reactions, dict):
            reactions = {}

        username = str(current_user.get("username", "") or "")
        users = [str(item or "") for item in reactions.get(emoji, []) if str(item or "")]
        if username in users:
            users = [item for item in users if item != username]
        else:
            users.append(username)

        if users:
            reactions[emoji] = users
        else:
            reactions.pop(emoji, None)

        updater = getattr(tchat_repo, "update_reactions", None)
        if callable(updater):
            updater(message_id, reactions)
        return {"status": "ok", "reactions": reactions}

    @router.get("/api/tchat/quotas")
    async def get_quotas(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        quota = _quota_state(current_user)
        return {
            "status": "ok",
            "unlimited": quota["unlimited"],
            "files_left": quota["files_left"],
            "links_left": quota["links_left"],
        }

    return router
