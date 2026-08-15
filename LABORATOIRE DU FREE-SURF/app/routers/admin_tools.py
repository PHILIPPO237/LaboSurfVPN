from __future__ import annotations

import base64
import binascii
import csv
import hashlib
import html
import io
import ipaddress
import re
import secrets
import time
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from app.core.passwords import build_password_context

from app.core.access import can_manage_user_lineage, canonicalize_legacy_user_type, has_root_access, user_has_permission


pwd_context = build_password_context(schemes=["bcrypt"], deprecated="auto")
_DATA_URL_RE = re.compile(r"^data:(image/(png|jpeg|webp));base64,(?P<data>[A-Za-z0-9+/=\s]+)$", re.IGNORECASE)


def _as_error_response(check: Any) -> JSONResponse | None:
    if isinstance(check, JSONResponse):
        return check
    return None

def _as_redirect_response(check: Any) -> RedirectResponse | None:
    if isinstance(check, RedirectResponse):
        return check
    return None


def _replace(content: str, values: dict[str, Any]) -> str:
    out = str(content or "")
    for key, value in values.items():
        rendered = str(value)
        out = out.replace(f"{{{{{key}}}}}", rendered)
        out = out.replace(f"{{{{ {key} }}}}", rendered)
    return out


def _is_ip_literal(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except Exception:
        return False


def _unique(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in items:
        clean = str(raw or "").strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
    return out


def create_admin_tools_router(
    *,
    db: Any,
    require_access: Callable[..., Any],
    require_admin_api: Callable[[Request], Any],
    read_template: Callable[[str], str | None],
    html_response: Callable[[str, int], Any],
    normalize_host: Callable[[Any], str],
    resolve_dns_records: Callable[[str], tuple[list[str], list[str]]],
    is_cloudflare_ip: Callable[[str], bool],
    is_gcp_ip: Callable[[str], bool],
    is_user_expired: Callable[[dict], bool],
    active_session_user_ids: Callable[[], set[int]] | None = None,
    ssh_dropbear_provisioner: Any = None,
    hysteria2_provisioner: Any = None,
    slowdns_provisioner: Any = None,
    zivpn_udp_provisioner: Any = None,
    xui_provisioner: Any = None,
    vpn_orchestrator: Any = None,
    templates: Any | None = None,
    require_permission: Callable[..., Any] | None = None,
    require_api_permission: Callable[[Request, str], Any] | None = None,
    cfg: Any | None = None,
    build_user_configs: Callable[[dict], list[dict]] | None = None,
) -> APIRouter:
    router = APIRouter()
    users_repo = getattr(db, "users", None)
    delegated_grants_repo = getattr(db, "delegated_admin_grants", None)
    action_tokens_repo = getattr(db, "account_action_tokens", None)
    notifications_repo = getattr(db, "notifications", None)
    subscriptions_repo = getattr(db, "subscriptions", None)
    services_repo = getattr(db, "services", None)
    configurations_repo = getattr(db, "configurations", None)

    def _record_subscription_if_changed(before: dict[str, Any], after: dict[str, Any], *, source: str) -> None:
        """N'enregistre un evenement subscriptions que si le plan ou l'expiration
        a reellement change entre avant/apres — evite de polluer l'historique
        quand l'admin ne fait que corriger un champ sans rapport (avatar, notes...).
        Snapshotte aussi services + configurations, meme logique que user.py."""
        before_type = str(before.get("type", "") or "")
        after_type = str(after.get("type", "") or "")
        before_exp = str(before.get("expiration", "") or "")
        after_exp = str(after.get("expiration", "") or "")
        if before_type == after_type and before_exp == after_exp:
            return
        add = getattr(subscriptions_repo, "add", None)
        if not callable(add):
            return
        try:
            sub = add({
                "user_id": int(after.get("id", 0) or 0),
                "plan": after_type,
                "status": "active",
                "source": source,
                "expires_at": after_exp,
            })
        except Exception:
            return

        add_service = getattr(services_repo, "add", None)
        if not callable(add_service):
            return
        try:
            service = add_service({
                "user_id": int(after.get("id", 0) or 0),
                "subscription_id": sub.get("id") if isinstance(sub, dict) else None,
                "type": "VPN",
                "status": "active",
            })
        except Exception:
            return

        if not callable(build_user_configs):
            return
        add_config = getattr(configurations_repo, "add", None)
        if not callable(add_config):
            return
        try:
            generated = build_user_configs(after)
        except Exception:
            generated = []
        if not isinstance(generated, list):
            return
        for cfg_item in generated:
            if not isinstance(cfg_item, dict):
                continue
            try:
                add_config({
                    "user_id": int(after.get("id", 0) or 0),
                    "service_id": service.get("id") if isinstance(service, dict) else None,
                    "protocol": str(cfg_item.get("protocol", "") or ""),
                    "status": "active",
                    "technical_data": str(cfg_item.get("uri", "") or ""),
                    "expires_at": after_exp,
                })
            except Exception:
                continue

    def _load_user_by_id(user_id: int) -> dict[str, Any] | None:
        if users_repo is None or not callable(getattr(users_repo, "get_by_id", None)):
            return None
        try:
            row = users_repo.get_by_id(int(user_id))
        except Exception:
            return None
        return dict(row) if isinstance(row, dict) else None

    def _page_guard(request: Request, *, next_url: str, need: str) -> RedirectResponse | None:
        if callable(require_permission) and str(need or "").strip():
            check = require_permission(request, str(need or "").strip(), next_url=next_url)
        else:
            check = require_access(request, {"ADMIN"}, next_url=next_url, need=need)
        return _as_redirect_response(check)

    def _api_guard(request: Request, *, need: str = "panel.admin.view") -> JSONResponse | None:
        if callable(require_api_permission) and str(need or "").strip():
            return _as_error_response(require_api_permission(request, str(need or "").strip()))
        return _as_error_response(require_admin_api(request))

    def _api_user(request: Request, *, need: str = "panel.admin.view") -> dict[str, Any] | JSONResponse:
        if callable(require_api_permission) and str(need or "").strip():
            check = require_api_permission(request, str(need or "").strip())
        else:
            check = require_admin_api(request)
        denied = _as_error_response(check)
        if denied is not None:
            return denied
        return dict(check) if isinstance(check, dict) else {}

    def _render(name: str, values: dict[str, Any] | None = None):
        content = read_template(name)
        if content is None:
            return html_response(f"<h1>Erreur: {html.escape(name)} manquant</h1>", 404)
        if isinstance(values, dict) and values:
            content = _replace(content, values)
        return content

    def _stats() -> dict[str, int]:
        users_repo = getattr(db, "users", None)
        payments_repo = getattr(db, "payments", None)
        requests_repo = getattr(db, "service_requests", None)
        security_repo = getattr(db, "security", None)
        try:
            users = users_repo.get_all() if users_repo is not None else []
        except Exception:
            users = []
        if not isinstance(users, list):
            users = []

        def _active(user: dict) -> bool:
            if str(user.get("status", "active") or "active").strip().lower() != "active":
                return False
            if str(user.get("type", "") or "").strip() == "ADMIN":
                return True
            try:
                return not bool(is_user_expired(user))
            except Exception:
                return True

        total_users = len(users)
        active_users = sum(1 for row in users if isinstance(row, dict) and _active(row))
        try:
            pending_payments = int(payments_repo.count_by_status("pending")) if payments_repo is not None else 0
        except Exception:
            pending_payments = 0
        try:
            pending_recoveries = int(requests_repo.count_pending_by_kind("license_recovery")) if requests_repo is not None else 0
        except Exception:
            pending_recoveries = 0
        try:
            active_bans = int(security_repo.count_active(time.time())) if security_repo is not None else 0
        except Exception:
            active_bans = 0
        return {
            "total": max(0, total_users),
            "active": max(0, active_users),
            "pending_payments": max(0, pending_payments),
            "pending_recoveries": max(0, pending_recoveries),
            "active_bans": max(0, active_bans),
            "modules": 12,
        }

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

    def _collect_transport_action(user: dict[str, Any], *, reason: str, method_name: str) -> dict[str, Any] | None:
        items: list[dict[str, Any]] = []
        for provisioner in (ssh_dropbear_provisioner, hysteria2_provisioner, slowdns_provisioner, zivpn_udp_provisioner, xui_provisioner):
            runner = getattr(provisioner, method_name, None)
            if not callable(runner):
                continue
            result = runner(dict(user), reason=reason)
            payload = _serialize_provisioning_result(result)
            if isinstance(payload, dict) and bool(payload.get("configured", False)):
                items.append(payload)
        if not items:
            return None
        return {
            "configured": True,
            "ok": all(bool(item.get("ok", False)) for item in items),
            "items": items,
        }

    def _paid_transport_profile(user: dict[str, Any]) -> bool:
        user_type = str(user.get("type", "") or "").strip().lower()
        user_status = str(user.get("status", "active") or "active").strip().lower()
        return user_status == "active" and user_type in {"vip", "premium", "revendeur", "admin"}

    def _sync_user_transport_state(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        method_name = "ensure_user" if _paid_transport_profile(user) else "disable_user"
        return _collect_transport_action(user, reason=reason, method_name=method_name)

    def _parse_quota(value: Any) -> float | None:
        text = str(value or "").strip().replace(",", ".")
        if not text:
            return None
        try:
            parsed = float(text)
        except Exception:
            return None
        return parsed if parsed > 0 else None

    def _parse_limit_ip(value: Any) -> int | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = int(text)
        except Exception:
            return None
        return parsed if parsed > 0 else None

    def _parse_expiration(value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        try:
            return date.fromisoformat(text).isoformat()
        except Exception:
            return ""

    def _redirect_ok(path: str, ok: str) -> RedirectResponse:
        return RedirectResponse(f"{path}?ok={ok}", status_code=303)

    def _redirect_err(path: str, err: str) -> RedirectResponse:
        return RedirectResponse(f"{path}?err={err}", status_code=303)

    def _actor_can(actor: dict[str, Any] | None, permission_code: str) -> bool:
        return user_has_permission(actor or {}, permission_code)

    def _root_actor(actor: dict[str, Any] | None) -> bool:
        return has_root_access(actor or {})

    def _is_admin_target(user: dict[str, Any] | None) -> bool:
        if not isinstance(user, dict):
            return False
        return canonicalize_legacy_user_type(user.get("type")) == "ADMIN"

    def _managed_type_defaults(user_type: Any) -> tuple[str, str, str]:
        normalized = canonicalize_legacy_user_type(user_type)
        if normalized == "ADMIN":
            return normalized, "admin", "admin"
        if normalized == "Revendeur":
            return normalized, "reseller", "reseller"
        if normalized in {"VIP", "PREMIUM"}:
            return normalized, "client", "premium"
        return "Gratuit", "client", "free"

    def _apply_managed_type(user: dict[str, Any], user_type: Any) -> dict[str, Any]:
        normalized, role_code, panel_key = _managed_type_defaults(user_type)
        user["type"] = normalized
        user["role_code"] = role_code
        user["default_panel_key"] = panel_key
        if normalized == "ADMIN":
            user["status"] = "active"
            user["expiration"] = ""
            user["quota_gb"] = None
        return user

    def _load_target_or_redirect(user_id: int) -> dict[str, Any] | RedirectResponse:
        target = _load_user_by_id(int(user_id))
        if not isinstance(target, dict):
            return _redirect_err("/admin/users", "notfound")
        return dict(target)

    def _protect_admin_target(
        actor: dict[str, Any],
        target: dict[str, Any],
        *,
        allow_root_profile: bool = False,
    ) -> RedirectResponse | None:
        if has_root_access(target) and not allow_root_profile:
            return _redirect_err(f"/admin/users/edit?user_id={int(target.get('id', 0) or 0)}", "root_protected")
        if _is_admin_target(target) and not _root_actor(actor):
            return _redirect_err(f"/admin/users/edit?user_id={int(target.get('id', 0) or 0)}", "root_required")
        return None

    def _check_lineage(actor: dict[str, Any], target: dict[str, Any], *, allow_root_profile: bool = False) -> RedirectResponse | None:
        """Combine la protection admin + la vérification de lignée.

        Le super-admin (root) passe toujours.
        Un admin simple ne peut gérer que les utilisateurs de sa lignée
        (ceux qu'il a créés ou dont le reseller_id remonte jusqu'à lui).
        """
        denied = _protect_admin_target(actor, target, allow_root_profile=allow_root_profile)
        if denied is not None:
            return denied
        if _root_actor(actor):
            return None
        if not can_manage_user_lineage(actor, target, _load_user_by_id):
            return _redirect_err(f"/admin/users/edit?user_id={int(target.get('id', 0) or 0)}", "root_required")
        return None

    def _actor_can_see(actor: dict[str, Any], user: dict[str, Any]) -> bool:
        """Le root voit tout ; un admin simple ne voit que sa lignée."""
        if _root_actor(actor):
            return True
        return can_manage_user_lineage(actor, user, _load_user_by_id)

    @router.get("/api/messages/{user_id}")
    async def api_messages_conversation(request: Request, user_id: int):
        """Conversation privee avec CE client precis. Reserve au gestionnaire
        de sa lignee (son revendeur, ou tout admin/super admin) -- reutilise
        exactement la meme regle de filiation que partout ailleurs (service
        requests, edition utilisateur...). Marque les messages du client
        comme lus au passage."""
        actor = _api_user(request, need="account.self.view")
        if isinstance(actor, JSONResponse):
            return actor
        target = _load_user_by_id(user_id)
        if target is None:
            return JSONResponse({"status": "error", "message": "Client introuvable."}, status_code=404)
        if not _actor_can_see(actor, target):
            return JSONResponse({"status": "error", "message": "Ce client ne fait pas partie de votre lignee."}, status_code=403)

        messages_repo = getattr(db, "private_messages", None)
        if messages_repo is None:
            return {"status": "ok", "messages": []}
        try:
            messages_repo.mark_read(user_id, reader_is_client=False)
        except Exception:
            pass
        try:
            messages = messages_repo.get_conversation(user_id)
        except Exception:
            messages = []
        return {"status": "ok", "messages": messages, "client": {"id": target.get("id"), "username": target.get("username")}}

    @router.post("/api/messages/{user_id}")
    async def api_messages_send(request: Request, user_id: int):
        actor = _api_user(request, need="account.self.view")
        if isinstance(actor, JSONResponse):
            return actor
        target = _load_user_by_id(user_id)
        if target is None:
            return JSONResponse({"status": "error", "message": "Client introuvable."}, status_code=404)
        if not _actor_can_see(actor, target):
            return JSONResponse({"status": "error", "message": "Ce client ne fait pas partie de votre lignee."}, status_code=403)

        messages_repo = getattr(db, "private_messages", None)
        if messages_repo is None or not callable(getattr(messages_repo, "add", None)):
            return JSONResponse({"status": "error", "message": "Messagerie indisponible."}, status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        text = str(body.get("body", "") or "").strip()[:2000]
        if not text:
            return JSONResponse({"status": "error", "message": "Message vide."}, status_code=400)

        actor_type = str(actor.get("type", "") or "").strip().lower()
        sender_role = "admin" if actor_type == "admin" else "revendeur"

        msg = messages_repo.add({
            "conversation_user_id": user_id,
            "sender_user_id": int(actor.get("id", 0) or 0),
            "sender_username": str(actor.get("username", "") or ""),
            "sender_role": sender_role,
            "body": text,
        })
        return {"status": "ok", "sent": msg}

    @router.get("/api/messages/conversations")
    async def api_messages_conversations_summary(request: Request):
        """Vue d'ensemble pour le gestionnaire : dernier message + non-lus,
        pour chacun de ses clients (filtre par lignee)."""
        actor = _api_user(request, need="account.self.view")
        if isinstance(actor, JSONResponse):
            return actor

        users_repo = getattr(db, "users", None)
        messages_repo = getattr(db, "private_messages", None)
        if users_repo is None or messages_repo is None:
            return {"status": "ok", "conversations": []}

        all_users = users_repo.get_all() if callable(getattr(users_repo, "get_all", None)) else []
        managed_ids = [int(u["id"]) for u in all_users if _actor_can_see(actor, u) and int(u.get("id", 0) or 0) != int(actor.get("id", 0) or 0)]

        try:
            summaries = messages_repo.get_conversations_summary(managed_ids)
        except Exception:
            summaries = []
        by_id = {int(s["conversation_user_id"]): s for s in summaries}

        result = []
        for uid in managed_ids:
            unread = messages_repo.get_unread_count(uid, for_client=False) if callable(getattr(messages_repo, "get_unread_count", None)) else 0
            if uid not in by_id and unread == 0:
                continue  # pas de conversation du tout -> pas affiche dans la liste
            user_obj = next((u for u in all_users if int(u["id"]) == uid), {})
            result.append({
                "user_id": uid,
                "username": user_obj.get("username", ""),
                "last_message": by_id.get(uid, {}).get("body", ""),
                "unread_count": unread,
            })
        result.sort(key=lambda r: r["unread_count"], reverse=True)
        return {"status": "ok", "conversations": result}

    def _extend_expiration(user: dict[str, Any], days: int) -> None:
        amount = max(0, int(days or 0))
        if amount <= 0:
            return
        base_date = date.today()
        current_expiration = str(user.get("expiration", "") or "").strip()
        if current_expiration:
            try:
                parsed_expiration = date.fromisoformat(current_expiration)
                if parsed_expiration > base_date:
                    base_date = parsed_expiration
            except Exception:
                pass
        user["expiration"] = (base_date + timedelta(days=amount)).isoformat()

    def _append_quota(user: dict[str, Any], amount_gb: Any) -> None:
        amount = _parse_quota(amount_gb)
        if amount is None:
            return
        try:
            current = float(user.get("quota_gb", 0) or 0)
        except Exception:
            current = 0.0
        user["quota_gb"] = round(current + amount, 2)

    def _build_action_token_value() -> str:
        return "FS-" + "-".join(secrets.token_hex(3).upper() for _ in range(3))

    def _page_actor(request: Request, *, next_url: str, need: str) -> tuple[dict[str, Any] | None, RedirectResponse | None]:
        denied = _page_guard(request, next_url=next_url, need=need)
        if denied is not None:
            return None, denied
        actor = require_admin_api(request)
        api_denied = _as_error_response(actor)
        if api_denied is not None:
            return None, RedirectResponse(f"/acces?next={html.escape(next_url, quote=True)}", status_code=303)
        return dict(actor) if isinstance(actor, dict) else {}, None

    def _avatar_storage_dir() -> Path:
        raw = getattr(cfg, "AVATARS_DIR", Path("static/avatars")) if cfg is not None else Path("static/avatars")
        folder = Path(raw or Path("static/avatars"))
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def _flash_banner(query_params: Any) -> str:
        ok_code = str(query_params.get("ok", "") or "").strip().lower()
        err_code = str(query_params.get("err", "") or "").strip().lower()
        success_messages = {
            "updated": "Profil abonne mis a jour.",
            "renewed": "Renouvellement applique.",
            "extended": "Extension appliquee.",
            "revoked": "Abonnement revoque.",
            "created": "Compte cree avec succes.",
            "password_reset": "Mot de passe reinitialise.",
            "suspended": "Compte suspendu.",
            "reactivated": "Compte reactive.",
            "recharged": "Recharge data appliquee.",
            "avatar_deleted": "Avatar supprime.",
            "delegated": "Delegation admin creee.",
            "delegation_revoked": "Delegation admin revoquee.",
            "action_token_created": "Code d'action genere.",
            "action_token_revoked": "Code d'action revoque.",
        }
        error_messages = {
            "notfound": "Utilisateur introuvable.",
            "password": "Mot de passe invalide.",
            "username": "Nom d'utilisateur deja utilise.",
            "root_required": "Acces root requis pour cette operation.",
            "root_protected": "Le compte root reste prioritaire et ne peut pas etre restreint.",
            "invalid_permissions": "Selection de permissions invalide.",
            "invalid_token": "Parametres de code d'action invalides.",
            "bad_avatar": "Avatar invalide ou trop lourd.",
        }
        if ok_code in success_messages:
            return f'<div class="mb-5 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-[11px] text-emerald-100">{html.escape(success_messages[ok_code])}</div>'
        if err_code in error_messages:
            return f'<div class="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[11px] text-red-100">{html.escape(error_messages[err_code])}</div>'
        return ""

    def _permission_choice_rows(selected: list[str] | None = None) -> str:
        selected_codes = set(selected or [])
        choices = [
            ("admin.dashboard", "Acces dashboard admin"),
            ("admin.users", "Liste des abonnes"),
            ("admin.users.edit", "Edition des comptes"),
            ("admin.users.password.reset", "Reset des mots de passe"),
            ("admin.users.recharge", "Recharge et renouvellement"),
            ("admin.users.avatar", "Gestion des avatars"),
            ("admin.tokens.manage", "Codes d'action et upgrades"),
            ("admin.payments", "Validation paiements"),
            ("admin.payment.settings", "Coordonnees paiement"),
            ("admin.config", "Config generator"),
            ("admin.dns", "DNS / Cloudflare"),
            ("admin.security", "Bans et securite"),
            ("admin.ads", "Publicites admin"),
        ]
        rows = []
        for code, label in choices:
            checked = ' checked' if code in selected_codes else ''
            rows.append(
                f'<label class="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-gray-200">'
                f'<input type="checkbox" name="permission_codes" value="{html.escape(code)}"{checked} class="accent-[#39ff14]">'
                f'<span class="font-mono text-[10px] text-[#39ff14]">{html.escape(code)}</span>'
                f'<span class="text-gray-400">{html.escape(label)}</span>'
                f'</label>'
            )
        return ''.join(rows)

    def _format_expiration_badge(expires_at: Any) -> str:
        try:
            remaining = int(float(expires_at or 0) - time.time())
        except Exception:
            remaining = 0
        if remaining <= 0:
            return 'Expire'
        hours = max(1, remaining // 3600)
        if hours < 48:
            return f'{hours}h'
        return f'{max(1, hours // 24)}j'

    def _delegation_rows_html(user_id: int) -> str:
        if delegated_grants_repo is None or not callable(getattr(delegated_grants_repo, "list_for_user", None)):
            return '<div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[11px] text-gray-500">Delegations indisponibles.</div>'
        rows = delegated_grants_repo.list_for_user(int(user_id), limit=8)
        if not rows:
            return '<div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[11px] text-gray-500">Aucune delegation pour ce compte.</div>'
        rendered = []
        now_ts = time.time()
        for row in rows:
            permissions = ', '.join(str(code or '').strip() for code in (row.get("permission_codes") or []) if str(code or '').strip()) or 'Aucune permission'
            is_active = float(row.get("revoked_at", 0) or 0) <= 0 and float(row.get("expires_at", 0) or 0) > now_ts
            badge = 'ACTIVE' if is_active else 'TERMINEE'
            action = ''
            if is_active:
                action = (
                    '<form action="/admin/users/delegations/revoke" method="POST">'
                    f'<input type="hidden" name="user_id" value="{int(user_id)}">'
                    f'<input type="hidden" name="grant_id" value="{int(row.get("id", 0) or 0)}">'
                    '<button type="submit" class="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] orbitron font-bold text-red-200">REVOQUER</button>'
                    '</form>'
                )
            rendered.append(
                '<div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">'
                '<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">'
                f'<div><div class="text-[10px] uppercase tracking-widest text-gray-500">Delegation #{int(row.get("id", 0) or 0)} ? {badge}</div>'
                f'<div class="mt-2 text-[11px] text-white">{html.escape(permissions)}</div>'
                f'<div class="mt-2 text-[10px] text-gray-500">Expire dans: {html.escape(_format_expiration_badge(row.get("expires_at")))} ? Cree par {html.escape(str(row.get("granted_by_username", "") or "root"))}</div></div>'
                f'{action}'
                '</div></div>'
            )
        return ''.join(rendered)

    def _action_token_rows_html(user_id: int) -> str:
        if action_tokens_repo is None or not callable(getattr(action_tokens_repo, "list_for_user", None)):
            return '<div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[11px] text-gray-500">Codes d\'action indisponibles.</div>'
        rows = action_tokens_repo.list_for_user(int(user_id), limit=8)
        if not rows:
            return '<div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[11px] text-gray-500">Aucun code d\'action genere.</div>'
        rendered = []
        for row in rows:
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            summary = []
            if payload.get("amount_gb"):
                summary.append(f'+{float(payload.get("amount_gb", 0) or 0):g} GB')
            if payload.get("duration_days"):
                summary.append(f'{int(payload.get("duration_days", 0) or 0)} jours')
            if payload.get("target_type"):
                summary.append(str(payload.get("target_type", "") or ""))
            meta = ' ? '.join(summary) or 'Aucun detail'
            action = ''
            is_active = float(row.get("revoked_at", 0) or 0) <= 0 and float(row.get("expires_at", 0) or 0) > time.time() and int(row.get("uses_count", 0) or 0) < int(row.get("max_uses", 1) or 1)
            if is_active:
                action = (
                    '<form action="/admin/users/action-tokens/revoke" method="POST">'
                    f'<input type="hidden" name="user_id" value="{int(user_id)}">'
                    f'<input type="hidden" name="token_id" value="{int(row.get("id", 0) or 0)}">'
                    '<button type="submit" class="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] orbitron font-bold text-red-200">REVOQUER</button>'
                    '</form>'
                )
            rendered.append(
                '<div class="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">'
                '<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">'
                f'<div><div class="text-[10px] uppercase tracking-widest text-gray-500">{html.escape(str(row.get("purpose", "") or "code"))}</div>'
                f'<div class="mt-2 font-mono text-[12px] text-cyan-200 break-all">{html.escape(str(row.get("token", "") or ""))}</div>'
                f'<div class="mt-2 text-[10px] text-gray-500">{html.escape(meta)} ? Utilisations {int(row.get("uses_count", 0) or 0)}/{int(row.get("max_uses", 1) or 1)} ? Expire dans {html.escape(_format_expiration_badge(row.get("expires_at")))}</div></div>'
                f'{action}'
                '</div></div>'
            )
        return ''.join(rendered)

    def _next_user_id() -> int:
        try:
            rows = users_repo.get_all() if users_repo is not None else []
        except Exception:
            rows = []
        ids = [int(row.get("id", 0) or 0) for row in rows if isinstance(row, dict)]
        return max(ids or [0]) + 1

    @router.get("/admin")
    async def admin_dashboard(request: Request):
        denied = _page_guard(request, next_url="/admin", need="admin.dashboard")
        if denied is not None:
            return denied
        content = _render("admin-dashboard.html")
        if not isinstance(content, str):
            return content
        stats = _stats()
        rendered = _replace(
            content,
            {
                "TOTAL_USERS": stats["total"],
                "ACTIVE_USERS": stats["active"],
                "PENDING_PAYMENTS": stats["pending_payments"],
                "PENDING_RECOVERIES": stats["pending_recoveries"],
                "ACTIVE_BANS": stats["active_bans"],
                "ADMIN_MODULES": stats["modules"],
            },
        )
        return html_response(rendered, 200)

    @router.get("/admin/users")
    async def admin_users(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users")
        if denied is not None:
            return denied
        content = _render("admin-users.html")
        if not isinstance(content, str):
            return content
        try:
            users = users_repo.get_all() if users_repo is not None else []
        except Exception:
            users = []
        if not isinstance(users, list):
            users = []
        users = [u for u in users if isinstance(u, dict) and _actor_can_see(actor or {}, u)]
        online_ids: set[int] = set()
        if callable(active_session_user_ids):
            try:
                online_ids = {int(v) for v in active_session_user_ids()}
            except Exception:
                online_ids = set()

        users_options: list[str] = []
        users_rows: list[str] = []
        for raw_user in users:
            if not isinstance(raw_user, dict):
                continue
            user = dict(raw_user)
            user_id = int(user.get("id", 0) or 0)
            username = str(user.get("username", "") or "").strip() or f"user-{user_id}"
            user_type = canonicalize_legacy_user_type(user.get("type"))
            expiration = str(user.get("expiration", "") or "").strip() or "Illimite"
            quota_value = user.get("quota_gb")
            quota_label = f"{float(quota_value or 0):g} GB" if quota_value not in (None, "") else "Illimite"
            online = 1 if user_id in online_ids else 0
            status = str(user.get("status", "active") or "active").strip().lower() or "active"
            notes = str(user.get("notes", "") or "").strip().splitlines()
            notes_preview = (notes[0] if notes else "Aucune note")[:72]
            uuid_value = str(user.get("uuid_secondary", "") or "").strip()
            uuid_preview = uuid_value[:8] + "..." + uuid_value[-4:] if len(uuid_value) > 16 else (uuid_value or "UUID en attente")
            root_badge = '<span class="ml-2 rounded-full border border-[#39ff14]/40 bg-[#39ff14]/10 px-2 py-0.5 text-[9px] font-bold text-[#39ff14]">ROOT</span>' if has_root_access(user) else ''
            status_class = "text-emerald-200 border-emerald-400/30 bg-emerald-500/10" if status == "active" else "text-red-200 border-red-400/30 bg-red-500/10"
            online_chip = '<span class="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">EN LIGNE</span>' if online else '<span class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-400">HORS LIGNE</span>'
            # Badge de role colore, pour reperer Admin/Revendeur/VIP/Gratuit d'un coup d'oeil
            # dans une longue liste (root deja signale a part via root_badge ci-dessus).
            if has_root_access(user):
                role_badge_class = "text-[#39ff14] border-[#39ff14]/40 bg-[#39ff14]/10"
            elif user_type == "ADMIN":
                role_badge_class = "text-amber-300 border-amber-400/40 bg-amber-500/10"
            elif user_type == "Revendeur":
                role_badge_class = "text-fuchsia-300 border-fuchsia-400/40 bg-fuchsia-500/10"
            elif user_type in {"VIP", "PREMIUM"}:
                role_badge_class = "text-cyan-300 border-cyan-400/40 bg-cyan-500/10"
            else:
                role_badge_class = "text-gray-400 border-white/10 bg-white/5"
            role_badge = f'<span class="rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide {role_badge_class}">{html.escape(user_type)}</span>'
            users_options.append(f'<option value="{user_id}">{html.escape(username)} - {html.escape(user_type)}</option>')
            users_rows.append(
                f'<tr data-online="{online}" class="align-top">'
                f'<td class="py-4 pl-2"><div class="font-bold text-white">{html.escape(username)}{root_badge}</div><div class="mt-1 text-[10px] text-gray-500">UUID: {html.escape(uuid_preview)}</div></td>'
                f'<td class="py-4">{role_badge}</td>'
                f'<td class="py-4">{html.escape(expiration)}</td>'
                f'<td class="py-4">{html.escape(quota_label)}</td>'
                f'<td class="py-4">{online_chip}</td>'
                f'<td class="py-4 text-gray-400">{html.escape(notes_preview)}</td>'
                f'<td class="py-4"><span class="rounded-full px-2 py-1 text-[10px] border {status_class}">{html.escape(status.upper())}</span></td>'
                f'<td class="py-4 pr-2 text-right"><a href="/admin/users/edit?user_id={user_id}" class="inline-flex items-center rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-[10px] orbitron font-bold text-white hover:bg-white/10 transition">Ouvrir</a></td>'
                f'</tr>'
            )

        requests_repo = getattr(db, "service_requests", None)
        recovery_entries = []
        if requests_repo is not None and callable(getattr(requests_repo, "get_pending_by_kind", None)):
            try:
                recovery_entries = requests_repo.get_pending_by_kind("license_recovery")
            except Exception:
                recovery_entries = []
        if not isinstance(recovery_entries, list):
            recovery_entries = []
        recovery_rows: list[str] = []
        for entry in recovery_entries[:100]:
            if not isinstance(entry, dict):
                continue
            username = str(entry.get("username", "") or "").strip()
            contact = str(entry.get("contact", "") or "").strip()
            message = str(entry.get("message", "") or entry.get("notes", "") or "Aucun message").strip()[:90]
            target_user = _load_user_by_id(int(entry.get("target_user_id", 0) or 0)) if int(entry.get("target_user_id", 0) or 0) > 0 else None
            if not isinstance(target_user, dict) and callable(getattr(users_repo, "get_by_username", None)):
                try:
                    target_user = users_repo.get_by_username(username)
                except Exception:
                    target_user = None
            target_link = '-'
            if isinstance(target_user, dict):
                target_link = f'<a href="/admin/users/edit?user_id={int(target_user.get("id", 0) or 0)}" class="text-cyan-300 hover:text-white transition">Ouvrir la fiche</a>'
            recovery_rows.append(
                f'<tr>'
                f'<td class="py-4 pl-2"><div class="font-bold text-white">{html.escape(username or "Inconnu")}</div><div class="mt-1 text-[10px] text-gray-500">{html.escape(str(entry.get("created_at", "") or ""))}</div></td>'
                f'<td class="py-4 text-gray-300">{html.escape(contact or "-")}</td>'
                f'<td class="py-4 text-gray-400">{html.escape(message)}</td>'
                f'<td class="py-4 text-gray-300">{html.escape(str(target_user.get("username", "") or "-") if isinstance(target_user, dict) else "-")}</td>'
                f'<td class="py-4 pr-2 text-right">{target_link}</td>'
                f'</tr>'
            )

        total = len([u for u in users if isinstance(u, dict)])
        active = sum(1 for u in users if isinstance(u, dict) and str(u.get("status", "active") or "active").strip().lower() == "active")
        online = sum(1 for u in users if isinstance(u, dict) and int(u.get("id", 0) or 0) in online_ids)
        rendered = _replace(
            content,
            {
                "TOTAL_USERS": total,
                "ACTIVE_USERS": active,
                "ONLINE_USERS": online,
                "FLASH_BANNER": _flash_banner(request.query_params),
                "USERS_OPTIONS": ''.join(users_options) or '<option value="" disabled>Aucun abonne</option>',
                "USERS_ROWS": ''.join(users_rows) or '<tr id="noResultRow"><td colspan="8" class="py-6 text-center text-gray-500 italic">Aucun abonne.</td></tr>',
                "RECOVERY_COUNT": str(len(recovery_entries)),
                "RECOVERY_ROWS": ''.join(recovery_rows) or '<tr><td colspan="5" class="py-5 text-center text-gray-500 italic">Aucune demande.</td></tr>',
            },
        )
        return html_response(rendered, 200)

    @router.get("/admin/users/edit")
    async def admin_users_edit(request: Request):
        denied = _page_guard(request, next_url="/admin/users/edit", need="admin.users.edit")
        if denied is not None:
            return denied
        actor = _api_user(request, need="admin.users.edit")
        if isinstance(actor, JSONResponse):
            return actor
        actor = dict(actor)
        content = _render("admin-user-edit.html")
        if not isinstance(content, str):
            return content

        user_id = int(request.query_params.get("user_id", "0") or 0)
        user = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(user, dict):
            return html_response("<h1>Utilisateur introuvable.</h1>", 404)
        user = dict(user)

        if not _actor_can_see(actor, user):
            return html_response("<h1>Acces refuse.</h1>", 403)
        if _is_admin_target(user) and not _root_actor(actor):
            return html_response("<h1>Acces root requis.</h1>", 403)

        username = str(user.get("username", "") or "")
        user_type = canonicalize_legacy_user_type(user.get("type"))
        protected = has_root_access(user)
        expired = False if protected else bool(is_user_expired(user))

        type_rows = []
        for option_value, option_label in (("VIP", "VIP"), ("Revendeur", "Revendeur"), ("Gratuit", "Gratuit")):
            selected = " selected" if user_type == option_value else ""
            type_rows.append(f'<option value="{option_value}"{selected}>{option_label}</option>')
        if _root_actor(actor):
            selected = " selected" if user_type == "ADMIN" else ""
            type_rows.append(f'<option value="ADMIN"{selected}>ADMIN</option>')

        flash_banner = _flash_banner(request.query_params)
        delegation_rows = _delegation_rows_html(user_id)
        action_token_rows = _action_token_rows_html(user_id)
        rendered = _replace(
            content,
            {
                "USER_ID": user_id,
                "STATUS": html.escape(str(user.get("status", "active") or "active")),
                "AVATAR_URL": html.escape(str(user.get("avatar", "") or "")),
                "USERNAME_INITIAL": html.escape((username[:1] or "?").upper()),
                "USERNAME": html.escape(username),
                "UUID_SECONDARY": html.escape(str(user.get("uuid_secondary", "") or "")),
                "LICENSE": html.escape(str(user.get("license", "") or "")),
                "TYPE_DISABLED": "disabled" if protected else "",
                "TYPE_OPTIONS": ''.join(type_rows),
                "EXPIRATION": html.escape(str(user.get("expiration", "") or "")),
                "QUOTA_GB": html.escape(str(user.get("quota_gb", "") if user.get("quota_gb") is not None else "")),
                "LIMIT_IP": html.escape(str(user.get("limit_ip", "") if user.get("limit_ip") is not None else "")),
                "PAYMENT_BLOCK_STYLE": '' if user_type == "Revendeur" else 'style="display:none;"',
                "ALLOW_CUSTOM_PAYMENTS": "checked" if bool(user.get("allow_custom_payments", False)) else "",
                "NOTES": html.escape(str(user.get("notes", "") or "")),
                "EXPIRED": "true" if expired else "false",
                "PROTECTED": "true" if protected else "false",
                "FLASH_BANNER": flash_banner,
                "ROOT_SECTION_STYLE": '' if protected else 'style="display:none;"',
                "DELEGATION_SECTION_STYLE": '' if _root_actor(actor) else 'style="display:none;"',
                "TOKEN_SECTION_STYLE": '' if (_root_actor(actor) or _actor_can(actor, "admin.tokens.manage")) else 'style="display:none;"',
                "DELEGATION_OPTIONS": _permission_choice_rows(),
                "DELEGATION_ROWS": delegation_rows,
                "ACTION_TOKEN_ROWS": action_token_rows,
            },
        )
        return html_response(rendered, 200)

    @router.get("/admin/users/history")
    async def admin_users_history(request: Request):
        denied = _page_guard(request, next_url="/admin/users/history", need="admin.users")
        if denied is not None:
            return denied
            
        user_id = int(request.query_params.get("user_id", "0") or 0)
        user = _load_user_by_id(user_id) if user_id > 0 else None
        
        if not isinstance(user, dict):
            return html_response("<h1>Utilisateur introuvable.</h1>", 404)
            
        history_repo = getattr(db, "user_history", None)
        history_records = []
        if history_repo is not None and callable(getattr(history_repo, "get_by_user", None)):
            history_records = history_repo.get_by_user(user_id)
            
        if templates is not None and callable(getattr(templates, "TemplateResponse", None)):
            try:
                return templates.TemplateResponse(
                    "admin-user-history.html", 
                    {"request": request, "user": user, "history": history_records}
                )
            except Exception:
                pass
                
        return html_response("<h1>Erreur: Moteur de template non disponible pour cette page.</h1>", 500)

    @router.get("/admin/users/history/export")
    async def admin_users_history_export(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
            
        user_id = int(request.query_params.get("user_id", "0") or 0)
        user = _load_user_by_id(user_id) if user_id > 0 else None
        
        if not isinstance(user, dict):
            return JSONResponse({"status": "error", "message": "Utilisateur introuvable."}, status_code=404)
            
        history_repo = getattr(db, "user_history", None)
        history_records = []
        if history_repo is not None and callable(getattr(history_repo, "get_by_user", None)):
            history_records = history_repo.get_by_user(user_id)
            
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(["Date & Heure", "Action", "Auteur", "Ancien Grade", "Nouveau Grade", "Ancienne Expiration", "Nouvelle Expiration", "Reference"])
        
        for record in history_records:
            writer.writerow([
                record.get("created_at", ""),
                record.get("action", ""),
                record.get("actor_username", ""),
                record.get("previous_type", ""),
                record.get("new_type", ""),
                record.get("previous_expiration", ""),
                record.get("new_expiration", ""),
                record.get("reference", "")
            ])
            
        stream.seek(0)
        username = str(user.get("username", "inconnu")).strip()
        response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")
        response.headers["Content-Disposition"] = f'attachment; filename="audit_historique_{username}.csv"'
        return response

    async def _render_config_generator_page(request: Request, *, next_url: str):
        denied = _page_guard(request, next_url=next_url, need="admin.config")
        if denied is not None:
            return denied
        actor = _api_user(request, need="admin.config")
        if not isinstance(actor, dict):
            actor = {}
        is_root_admin = has_root_access(actor)
        content = _render(
            "admin-config-generator.html",
            {
                "ADMIN_IS_ROOT": "true" if is_root_admin else "false",
                "ADMIN_SCOPE_CODE": "super-admin" if is_root_admin else "admin",
                "ADMIN_SCOPE_LABEL": "Mode Super-Admin" if is_root_admin else "Mode Admin",
                "ADMIN_SCOPE_HINT": (
                    "Controle complet active: synchronisation panel et actions sur modules planifies autorisees."
                    if is_root_admin
                    else "Vue admin securisee: les modules restent visibles, mais les actions sur modules non actifs restent reservees au super-admin."
                ),
                "ADMIN_SCOPE_CHIP_CLASS": (
                    "border-emerald-500/30 text-emerald-300"
                    if is_root_admin
                    else "border-amber-500/30 text-amber-300"
                ),
                "ADMIN_USERNAME": html.escape(str(actor.get("username", "") or "admin")),
            },
        )
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/admin/config-generator")
    async def admin_config_generator(request: Request):
        return await _render_config_generator_page(request, next_url="/admin/config-generator")

    @router.get("/lab-admin/config-generator")
    async def lab_admin_config_generator(request: Request):
        return await _render_config_generator_page(request, next_url="/lab-admin/config-generator")

    @router.get("/admin/servers")
    async def admin_servers_page(request: Request):
        """Catalogue des serveurs : le super admin (ou un admin delegue via
        admin.config) choisit quels plans (Gratuit/VIP/Revendeur/ADMIN) voient
        quel serveur. L'utilisateur final ne voit jamais le protocole ni la
        reference technique -- seulement le nom qu'il choisit."""
        denied = _page_guard(request, next_url="/admin/servers", need="admin.config")
        if denied is not None:
            return denied
        return _render("admin-servers.html", {})

    @router.get("/api/admin/servers")
    async def api_admin_servers_list(request: Request):
        actor = _api_user(request, need="admin.config")
        if isinstance(actor, JSONResponse):
            return actor
        servers_repo = getattr(db, "servers", None)
        rows = servers_repo.get_all() if callable(getattr(servers_repo, "get_all", None)) else []
        return {"status": "ok", "servers": rows if isinstance(rows, list) else []}

    @router.get("/api/admin/servers/{server_id}/rules")
    async def api_admin_server_rules_list(request: Request, server_id: int):
        """Regles d'acces (duree d'essai, quota) par plan pour ce profil de
        serveur precis. Voir app/core/db_engine.py::ServerPlanRulesRepo."""
        actor = _api_user(request, need="admin.config")
        if isinstance(actor, JSONResponse):
            return actor
        rules_repo = getattr(db, "server_plan_rules", None)
        rows = rules_repo.get_for_server(server_id) if callable(getattr(rules_repo, "get_for_server", None)) else []
        return {"status": "ok", "rules": rows if isinstance(rows, list) else []}

    @router.post("/api/admin/servers/{server_id}/rules/{plan}")
    async def api_admin_server_rules_upsert(request: Request, server_id: int, plan: str):
        actor = _api_user(request, need="admin.config")
        if isinstance(actor, JSONResponse):
            return actor

        allowed_plans = {"Gratuit", "VIP", "Revendeur", "ADMIN"}
        if plan not in allowed_plans:
            return JSONResponse({"status": "error", "message": "Plan invalide."}, status_code=400)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        try:
            max_duration_minutes = max(0, int(body.get("max_duration_minutes", 0) or 0))
            quota_mb = max(0, int(body.get("quota_mb", 0) or 0))
        except (TypeError, ValueError):
            return JSONResponse({"status": "error", "message": "Valeurs numeriques invalides."}, status_code=400)

        rules_repo = getattr(db, "server_plan_rules", None)
        if rules_repo is None or not callable(getattr(rules_repo, "upsert", None)):
            return JSONResponse({"status": "error", "message": "Stockage regles indisponible."}, status_code=500)

        rule = rules_repo.upsert(server_id, plan, max_duration_minutes=max_duration_minutes, quota_mb=quota_mb)
        return {"status": "ok", "rule": rule}

    @router.get("/api/admin/engines/health")
    async def api_admin_engines_health(request: Request):
        """Vue de sante unifiee de tous les moteurs VPN (P1 : fusion des deux
        anciennes couches distinctes en un seul point d'entree). Voir
        app/core/vpn_orchestrator.py::health_report."""
        actor = _api_user(request, need="admin.config")
        if isinstance(actor, JSONResponse):
            return actor
        if vpn_orchestrator is None or not callable(getattr(vpn_orchestrator, "health_report", None)):
            return {"status": "ok", "engines": []}
        return {"status": "ok", "engines": vpn_orchestrator.health_report()}

    @router.post("/api/admin/servers/new")
    async def api_admin_servers_create(request: Request):
        actor = _api_user(request, need="admin.config")
        if isinstance(actor, JSONResponse):
            return actor
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        name = str(body.get("name", "") or "").strip()[:120]
        if not name:
            return JSONResponse({"status": "error", "message": "Le nom est obligatoire."}, status_code=400)

        servers_repo = getattr(db, "servers", None)
        if servers_repo is None or not callable(getattr(servers_repo, "add", None)):
            return JSONResponse({"status": "error", "message": "Stockage serveurs indisponible."}, status_code=500)

        created = servers_repo.add({
            "name": name,
            "country": str(body.get("country", "") or "").strip()[:80],
            "city": str(body.get("city", "") or "").strip()[:80],
            "protocol": str(body.get("protocol", "") or "").strip()[:40],
            "status": "available",
            "infrastructure_ref": "",
        })
        return {"status": "ok", "server": created}

    @router.post("/api/admin/servers/{server_id}/update")
    async def api_admin_servers_update(request: Request, server_id: int):
        actor = _api_user(request, need="admin.config")
        if isinstance(actor, JSONResponse):
            return actor
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        allowed_plans = {"Gratuit", "VIP", "Revendeur", "ADMIN"}
        updates: dict[str, Any] = {}
        if "name" in body:
            updates["name"] = str(body.get("name", "") or "").strip()[:120]
        if "country" in body:
            updates["country"] = str(body.get("country", "") or "").strip()[:80]
        if "city" in body:
            updates["city"] = str(body.get("city", "") or "").strip()[:80]
        if "protocol" in body:
            updates["protocol"] = str(body.get("protocol", "") or "").strip()[:40]
        if "capabilities" in body:
            allowed_caps = {
                "VLESS/XHTTP", "VLESS/WS", "VMess", "Hysteria2", "SlowDNS", "DNSTT",
                "ZiVPN UDP", "SSH/Dropbear", "SlowDNS+VLESS", "DNSTT+VLESS", "SSH+VLESS",
            }
            raw_caps = str(body.get("capabilities", "") or "")
            cleaned_caps = [c.strip() for c in raw_caps.split(",") if c.strip() in allowed_caps]
            updates["capabilities"] = ",".join(cleaned_caps)
        if "status" in body:
            status_val = str(body.get("status", "") or "").strip()
            if status_val in {"available", "unavailable", "maintenance"}:
                updates["status"] = status_val
        if "allow_insecure" in body:
            updates["allow_insecure"] = 1 if bool(body.get("allow_insecure")) else 0
        if "visible_plans" in body:
            raw_plans = body.get("visible_plans")
            plans_list = raw_plans if isinstance(raw_plans, list) else []
            cleaned = [p for p in plans_list if p in allowed_plans]
            updates["visible_plans"] = ",".join(cleaned)

        servers_repo = getattr(db, "servers", None)
        if servers_repo is None or not callable(getattr(servers_repo, "update_fields", None)):
            return JSONResponse({"status": "error", "message": "Stockage serveurs indisponible."}, status_code=500)

        updated = servers_repo.update_fields(server_id, updates)
        if updated is None:
            return JSONResponse({"status": "error", "message": "Serveur introuvable."}, status_code=404)
        return {"status": "ok", "server": updated}

    @router.get("/admin/dns-cloudflare")
    async def admin_dns_page(request: Request):
        denied = _page_guard(request, next_url="/admin/dns-cloudflare", need="admin.dns")
        if denied is not None:
            return denied
        content = _render("admin-dns-cloudflare.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/admin/ip-bans")
    async def admin_ip_bans_page(request: Request):
        denied = _page_guard(request, next_url="/admin/ip-bans", need="admin.security")
        if denied is not None:
            return denied
        content = _render("admin-ip-bans.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/api/admin/ip-bans")
    async def admin_ip_bans_list(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        repo = getattr(db, "security", None)
        if repo is None:
            return {"status": "ok", "bans": []}
        try:
            rows = repo.get_all()
        except Exception:
            rows = []
        now = time.time()
        bans = []
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict):
                continue
            try:
                banned_until = float(r.get("banned_until", 0) or 0)
            except Exception:
                banned_until = 0.0
            remaining = banned_until - now
            if remaining <= 0:
                continue  # ban expire : on ne l'affiche plus (pas besoin de deblocage manuel)
            bans.append({
                "ip": r.get("ip", ""),
                "fail_count": int(r.get("fail_count", 0) or 0),
                "remaining_seconds": int(remaining),
            })
        return {"status": "ok", "bans": bans}

    @router.post("/api/admin/ip-bans/delete")
    async def admin_ip_bans_delete(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        repo = getattr(db, "security", None)
        if repo is None:
            return JSONResponse({"status": "error", "message": "Stockage indisponible."}, status_code=500)
        try:
            body = await request.json()
        except Exception:
            body = {}
        ip = str((body or {}).get("ip", "") or "").strip()
        if not ip:
            return JSONResponse({"status": "error", "message": "IP requise."}, status_code=400)
        repo.delete(ip)
        return {"status": "ok", "message": f"IP {ip} debloquee."}

    @router.get("/admin/activation-keys")
    async def admin_activation_keys_page(request: Request):
        denied = _page_guard(request, next_url="/admin/activation-keys", need="admin.keys")
        if denied is not None:
            return denied
        actor = require_admin_api(request)
        api_denied = _as_error_response(actor)
        if api_denied is not None:
            return api_denied
        if not has_root_access(actor):
            return html_response("<h1>Acces root requis.</h1>", 403)
        content = _render("admin-activation-keys.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/admin/settings/payment")
    async def admin_payment_settings_page(request: Request):
        denied = _page_guard(request, next_url="/admin/settings/payment", need="admin.payment.settings")
        if denied is not None:
            return denied
        content = _render("admin-payment-settings.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/admin/payments")
    async def admin_payments_page(request: Request):
        denied = _page_guard(request, next_url="/admin/payments", need="admin.payments")
        if denied is not None:
            return denied
        if templates is not None and callable(getattr(templates, "TemplateResponse", None)):
            payments_repo = getattr(db, "payments", None)
            try:
                payments = payments_repo.get_all(limit=500, recipient_id=0) if payments_repo is not None else []
            except Exception:
                payments = []
            if not isinstance(payments, list):
                payments = []
            service_requests_repo = getattr(db, "service_requests", None)
            try:
                all_requests = service_requests_repo.get_all() if service_requests_repo is not None else []
            except Exception:
                all_requests = []
            service_requests = [
                dict(r) for r in all_requests
                if isinstance(r, dict) and str(r.get("status", "") or "").strip().lower() == "pending"
            ] if isinstance(all_requests, list) else []
            try:
                return templates.TemplateResponse(
                    "admin-payments.html",
                    {"request": request, "payments": payments, "service_requests": service_requests},
                )
            except Exception:
                pass
        content = _render("admin-payments.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/admin/notifications")
    async def admin_notifications(request: Request):
        denied = _page_guard(request, next_url="/admin/notifications", need="admin.notifications")
        if denied is not None:
            return denied
        content = _render("construction.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/api/admin/promo-codes")
    async def admin_promo_codes_list(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        repo = getattr(db, "promo_codes", None)
        if repo is None:
            return {"status": "ok", "codes": []}
        try:
            codes = repo.get_all()
        except Exception:
            codes = []
        return {"status": "ok", "codes": codes if isinstance(codes, list) else []}

    @router.post("/api/admin/promo-codes")
    async def admin_promo_codes_create(request: Request):
        # Reserve au super admin (+ admins delegues via admin.config) : un code
        # promo genere des jours/Go gratuits, meme logique de confiance que le
        # generateur de configurations.
        denied = _api_guard(request, need="admin.config")
        if denied is not None:
            return denied
        repo = getattr(db, "promo_codes", None)
        if repo is None:
            return JSONResponse({"status": "error", "message": "Stockage indisponible."}, status_code=500)
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        code = str(body.get("code", "") or "").strip()
        if not code:
            return JSONResponse({"status": "error", "message": "Code requis."}, status_code=400)
        try:
            bonus_days = max(0, int(body.get("bonus_days", 0) or 0))
        except Exception:
            bonus_days = 0
        try:
            bonus_gb = max(0, int(body.get("bonus_gb", 0) or 0))
        except Exception:
            bonus_gb = 0
        if bonus_days <= 0 and bonus_gb <= 0:
            return JSONResponse({"status": "error", "message": "Definissez au moins un bonus : jours ou Go."}, status_code=400)
        try:
            max_uses = max(1, int(body.get("max_uses", 1) or 1))
        except Exception:
            max_uses = 1
        if repo.get_by_code(code):
            return JSONResponse({"status": "error", "message": "Ce code existe deja."}, status_code=409)
        actor = require_admin_api(request)
        created_by = str(actor.get("username", "") or "ADMIN") if isinstance(actor, dict) else "ADMIN"
        entry = repo.add({
            "code": code,
            "bonus_days": bonus_days,
            "bonus_gb": bonus_gb,
            "max_uses": max_uses,
            "notes": str(body.get("notes", "") or ""),
            "created_by": created_by,
        })
        return {"status": "ok", "code": entry}

    @router.post("/api/admin/promo-codes/toggle")
    async def admin_promo_codes_toggle(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        repo = getattr(db, "promo_codes", None)
        if repo is None:
            return JSONResponse({"status": "error", "message": "Stockage indisponible."}, status_code=500)
        try:
            body = await request.json()
        except Exception:
            body = {}
        promo_id = int((body or {}).get("id", 0) or 0)
        existing = repo.get_by_id(promo_id) if promo_id > 0 else None
        if not isinstance(existing, dict):
            return JSONResponse({"status": "error", "message": "Code introuvable."}, status_code=404)
        new_active = not bool(existing.get("active"))
        repo.set_active(promo_id, new_active)
        return {"status": "ok", "active": new_active}

    @router.get("/api/admin/activation-keys")
    async def admin_activation_keys_list(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        repo = getattr(db, "activation_keys", None)
        if repo is None:
            return {"status": "ok", "keys": []}
        try:
            keys = repo.get_all()
        except Exception:
            keys = []
        return {"status": "ok", "keys": keys if isinstance(keys, list) else []}

    @router.post("/api/admin/activation-keys/generate")
    async def admin_activation_keys_generate(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        repo = getattr(db, "activation_keys", None)
        if repo is None:
            return JSONResponse({"status": "error", "message": "Stockage indisponible."}, status_code=500)
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        try:
            quantity = max(1, min(500, int(body.get("quantity", 1) or 1)))
        except Exception:
            quantity = 1
        try:
            duration_days = max(1, int(body.get("duration_days", 30) or 30))
        except Exception:
            duration_days = 30
        user_type = str(body.get("user_type", "VIP") or "VIP").strip() or "VIP"
        notes = str(body.get("notes", "") or "").strip()

        actor = require_admin_api(request)
        created_by = str(actor.get("username", "") or "ADMIN") if isinstance(actor, dict) else "ADMIN"

        generated = 0
        for _ in range(quantity):
            key = f"AK-{secrets.token_hex(6).upper()}"
            try:
                repo.add({
                    "key": key,
                    "user_type": user_type,
                    "duration_days": duration_days,
                    "notes": notes,
                    "created_by": created_by,
                })
                generated += 1
            except Exception:
                continue
        return {"status": "ok", "generated": generated}

    @router.get("/admin/messagerie")
    async def admin_messagerie(request: Request):
        denied = _page_guard(request, next_url="/admin/messagerie", need="admin.messaging")
        if denied is not None:
            return denied
        content = _render("construction.html")
        if not isinstance(content, str):
            return content
        return html_response(content, 200)

    @router.get("/admin/dns/resolve")
    async def admin_dns_resolve(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        host = normalize_host(request.query_params.get("host", ""))
        if not host:
            return JSONResponse({"status": "error", "message": "Host invalide."}, status_code=400)
        try:
            a_records, aaaa_records = resolve_dns_records(host)
        except Exception as exc:
            return JSONResponse({"status": "error", "message": f"Erreur DNS: {exc}"}, status_code=502)
        return {"host": host, "a": _unique(a_records), "aaaa": _unique(aaaa_records)}

    def _provider_payload(value: str, checker: Callable[[str], bool], item_key: str, any_key: str) -> tuple[dict[str, Any], int]:
        raw = str(value or "").strip()
        if not raw:
            return {"status": "error", "message": "Valeur manquante."}, 400
        if _is_ip_literal(raw):
            kind = "ip"
            normalized = raw
            ips = [raw]
        else:
            kind = "host"
            normalized = normalize_host(raw)
            if not normalized:
                return {"status": "error", "message": "Host invalide."}, 400
            try:
                a_records, aaaa_records = resolve_dns_records(normalized)
            except Exception as exc:
                return {"status": "error", "message": f"Erreur DNS: {exc}"}, 502
            ips = _unique([*a_records, *aaaa_records])
        rows = []
        any_match = False
        for ip in ips:
            try:
                matched = bool(checker(ip))
            except Exception:
                matched = False
            if matched:
                any_match = True
            rows.append({"ip": ip, item_key: matched})
        return {"input": normalized, "kind": kind, "ips": rows, any_key: any_match}, 200

    @router.get("/admin/dns/check-cloudflare")
    async def admin_dns_check_cloudflare(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied
        payload, status = _provider_payload(str(request.query_params.get("value", "") or ""), is_cloudflare_ip, "iscloudflare", "anycloudflare")
        if status != 200:
            return JSONResponse(payload, status_code=status)
        return payload

    @router.post("/admin/users/update")
    async def admin_users_update(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.edit")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied

        updated = dict(target)
        selected_type = canonicalize_legacy_user_type(form.get("user_type", updated.get("type", "Gratuit")))
        if selected_type == "ADMIN" and not _root_actor(actor):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_required")

        updated = _apply_managed_type(updated, selected_type)
        if selected_type != "ADMIN":
            updated["expiration"] = _parse_expiration(form.get("expiration", updated.get("expiration", "")))
            updated["quota_gb"] = _parse_quota(form.get("quota_gb", updated.get("quota_gb", "")))
        updated["limit_ip"] = _parse_limit_ip(form.get("limit_ip", updated.get("limit_ip", "")))
        updated["avatar"] = str(form.get("avatar", updated.get("avatar", "")) or "").strip()
        updated["notes"] = str(form.get("notes", updated.get("notes", "")) or "").strip()
        updated["allow_custom_payments"] = (
            str(form.get("allow_custom_payments", "") or "").strip().lower() in {"1", "true", "yes", "on"}
            if selected_type == "Revendeur"
            else False
        )
        users_repo.save(updated)
        _record_subscription_if_changed(target, updated, source="admin_edit")
        _sync_user_transport_state(updated, reason="admin_user_update")
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "updated")

    @router.post("/admin/users/renew")
    async def admin_users_renew(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.recharge")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied
        if _is_admin_target(target):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_protected")

        updated = dict(target)
        days = max(0, min(3650, int(str(form.get("days", "0") or "0"))))
        _extend_expiration(updated, days)
        _append_quota(updated, form.get("gb", ""))
        users_repo.save(updated)
        _record_subscription_if_changed(target, updated, source="admin_renew")
        _sync_user_transport_state(updated, reason="admin_user_renew")
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "renewed")

    @router.post("/admin/extend-user")
    async def admin_extend_user(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.recharge")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied
        if _is_admin_target(target):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_protected")

        updated = dict(target)
        days = max(0, min(3650, int(str(form.get("days", "0") or "0"))))
        _extend_expiration(updated, days)
        users_repo.save(updated)
        _record_subscription_if_changed(target, updated, source="admin_extend")
        _sync_user_transport_state(updated, reason="admin_user_extend")
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "extended")

    @router.post("/admin/users/revoke-subscription")
    async def admin_users_revoke_subscription(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.edit")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied
        if _is_admin_target(target):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_protected")

        updated = dict(target)
        updated = _apply_managed_type(updated, "Gratuit")
        updated["status"] = "active"
        updated["expiration"] = ""
        updated["quota_gb"] = None
        updated["allow_custom_payments"] = False
        users_repo.save(updated)
        _record_subscription_if_changed(target, updated, source="admin_revoke")
        _collect_transport_action(updated, reason="admin_subscription_revoked", method_name="disable_user")
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "revoked")

    @router.post("/admin/users/delete")
    async def admin_users_delete(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.edit")
        if denied is not None:
            return denied
        if not has_root_access(actor or {}):
            return _redirect_err("/admin/users", "root_required")
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        if _is_admin_target(target):
            return _redirect_err("/admin/users", "root_protected")
        if users_repo is not None and callable(getattr(users_repo, "delete", None)):
            users_repo.delete(user_id)
        return _redirect_ok("/admin/users", "deleted")

    @router.post("/admin/add-user")
    async def admin_add_user(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.edit")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        username = str(form.get("username", "") or "").strip()
        password = str(form.get("password", "") or "").strip()
        if not username or users_repo is None or users_repo.username_exists(username):
            return _redirect_err("/admin/users", "username")
        if len(password) < 6:
            return _redirect_err("/admin/users", "password")

        user_type = canonicalize_legacy_user_type(form.get("user_type", "Gratuit"))
        if user_type == "ADMIN" and not _root_actor(actor):
            return _redirect_err("/admin/users", "root_required")

        recovery_secret = str(form.get("recovery_secret", "") or "").strip().lower()
        allow_custom_payments = str(form.get("allow_custom_payments", "") or "").strip().lower() in {"1", "true", "yes", "on"}
        new_user = {
            "id": _next_user_id(),
            "username": username,
            "contact": str(form.get("contact", "") or "").strip(),
            "password_hash": pwd_context.hash(password),
            "service_password": password,
            "status": "active",
            "expiration": _parse_expiration(form.get("expiration", "")),
            "quota_gb": _parse_quota(form.get("quota_gb", "")),
            "limit_ip": _parse_limit_ip(form.get("limit_ip", "")),
            "avatar": str(form.get("avatar", "") or "").strip(),
            "notes": str(form.get("notes", "") or "").strip(),
            "uuid_secondary": str(uuid.uuid4()),
            "license": f"LIC-{str(uuid.uuid4()).split('-')[0].upper()}",
            "allow_custom_payments": bool(allow_custom_payments and user_type == "Revendeur"),
            "recovery_secret_hash": hashlib.sha256(recovery_secret.encode("utf-8")).hexdigest() if recovery_secret else "",
        }
        new_user = _apply_managed_type(new_user, user_type)
        new_user["reseller_id"] = int(actor.get("id", 0) or 0)
        if user_type != "Revendeur":
            new_user["allow_custom_payments"] = False
        users_repo.save(new_user)
        _sync_user_transport_state(new_user, reason="admin_add_user")
        return _redirect_ok(f"/admin/users/edit?user_id={new_user['id']}", "created")

    @router.post("/admin/users/reset-password")
    async def admin_reset_user_password(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.password.reset")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        new_password = str(form.get("new_password", "") or "").strip()
        if user_id <= 0:
            return _redirect_err("/admin/users", "notfound")
        if len(new_password) < 6:
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "password")

        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied

        updated = dict(target)
        updated["password_hash"] = pwd_context.hash(new_password)
        updated["service_password"] = new_password
        users_repo.save(updated)
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "password_reset")

    @router.post("/admin/toggle-user")
    async def admin_toggle_user(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.edit")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied

        updated = dict(target)
        current_status = str(updated.get("status", "active") or "active").strip().lower()
        if current_status == "active":
            updated["status"] = "suspended"
            users_repo.save(updated)
            _collect_transport_action(updated, reason="admin_user_suspended", method_name="disable_user")
            return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "suspended")
        updated["status"] = "active"
        users_repo.save(updated)
        _sync_user_transport_state(updated, reason="admin_user_reactivated")
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "reactivated")

    @router.post("/admin/users/recharge-gb")
    async def admin_users_recharge_gb(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.recharge")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied
        if _is_admin_target(target):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_protected")

        updated = dict(target)
        amount_gb = _parse_quota(form.get("gb", ""))
        if amount_gb is None:
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "invalid_token")
        _append_quota(updated, amount_gb)
        users_repo.save(updated)
        _sync_user_transport_state(updated, reason="admin_user_recharge")
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "recharged")

    @router.post("/admin/users/avatar")
    async def admin_users_avatar(request: Request):
        actor = _api_user(request, need="admin.users.avatar")
        if isinstance(actor, JSONResponse):
            return actor
        actor = dict(actor)
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        user_id = int(payload.get("user_id", 0) or 0)
        target = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(target, dict):
            return JSONResponse({"status": "error", "message": "Utilisateur introuvable."}, status_code=404)
        denied = _check_lineage(actor, target, allow_root_profile=True)
        if denied is not None:
            return JSONResponse({"status": "error", "message": "Acces refuse."}, status_code=403)

        data_url = str(payload.get("data_url", "") or "").strip()
        match = _DATA_URL_RE.match(data_url)
        if not match:
            return JSONResponse({"status": "error", "message": "Avatar invalide."}, status_code=400)
        mime_type = str(match.group(1) or "").lower()
        extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(mime_type)
        if not extension:
            return JSONResponse({"status": "error", "message": "Format avatar invalide."}, status_code=400)
        try:
            raw = base64.b64decode(str(match.group("data") or ""), validate=True)
        except (ValueError, binascii.Error):
            return JSONResponse({"status": "error", "message": "Avatar invalide."}, status_code=400)
        if not raw or len(raw) > (5 * 1024 * 1024):
            return JSONResponse({"status": "error", "message": "Avatar trop lourd."}, status_code=400)

        folder = _avatar_storage_dir()
        filename = f"user-{user_id}-{secrets.token_hex(4)}.{extension}"
        avatar_path = folder / filename
        avatar_path.write_bytes(raw)

        previous_avatar = str(target.get("avatar", "") or "").strip()
        if previous_avatar.startswith("/static/avatars/"):
            old_path = folder / Path(previous_avatar).name
            if old_path.exists() and old_path != avatar_path:
                try:
                    old_path.unlink()
                except Exception:
                    pass

        updated = dict(target)
        updated["avatar"] = f"/static/avatars/{filename}"
        users_repo.save(updated)
        return JSONResponse({"status": "ok", "avatar_url": updated["avatar"]})

    @router.post("/admin/users/avatar/delete")
    async def admin_users_avatar_delete(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.avatar")
        if denied is not None:
            return denied
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target, allow_root_profile=True)
        if denied is not None:
            return denied

        folder = _avatar_storage_dir()
        previous_avatar = str(target.get("avatar", "") or "").strip()
        if previous_avatar.startswith("/static/avatars/"):
            old_path = folder / Path(previous_avatar).name
            if old_path.exists():
                try:
                    old_path.unlink()
                except Exception:
                    pass

        updated = dict(target)
        updated["avatar"] = ""
        users_repo.save(updated)
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "avatar_deleted")

    @router.post("/admin/users/delegations")
    async def admin_users_delegations(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.delegate")
        if denied is not None:
            return denied
        if not _root_actor(actor):
            return _redirect_err("/admin/users", "root_required")
        if delegated_grants_repo is None or not callable(getattr(delegated_grants_repo, "add", None)):
            return _redirect_err("/admin/users", "invalid_permissions")
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        if has_root_access(target):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_protected")

        getlist = getattr(form, "getlist", None)
        raw_codes = getlist("permission_codes") if callable(getlist) else [form.get("permission_codes", "")]
        permission_codes = sorted({str(code or "").strip() for code in raw_codes if str(code or "").strip()})
        allowed_codes = {
            "admin.dashboard",
            "admin.users",
            "admin.users.edit",
            "admin.users.password.reset",
            "admin.users.recharge",
            "admin.users.avatar",
            "admin.tokens.manage",
            "admin.payments",
            "admin.payment.settings",
            "admin.config",
            "admin.dns",
            "admin.security",
            "admin.ads",
        }
        if not permission_codes or any(code not in allowed_codes for code in permission_codes):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "invalid_permissions")

        raw_hours = int(str(form.get("duration_hours", "0") or "0"))
        raw_days = int(str(form.get("duration_days", "0") or "0"))
        duration_hours = raw_hours if raw_hours > 0 else (raw_days * 24)
        duration_hours = max(1, min(24 * 365, duration_hours))
        delegated_grants_repo.add(
            {
                "target_user_id": int(target.get("id", 0) or 0),
                "target_username": str(target.get("username", "") or ""),
                "granted_by_user_id": int(actor.get("id", 0) or 0),
                "granted_by_username": str(actor.get("username", "") or "root"),
                "permission_codes": permission_codes,
                "notes": str(form.get("notes", "") or "").strip(),
                "starts_at": time.time(),
                "expires_at": time.time() + (duration_hours * 3600),
            }
        )
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "delegated")

    @router.post("/admin/users/delegations/revoke")
    async def admin_users_delegations_revoke(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.users.delegate")
        if denied is not None:
            return denied
        if not _root_actor(actor):
            return _redirect_err("/admin/users", "root_required")
        if delegated_grants_repo is None or not callable(getattr(delegated_grants_repo, "revoke", None)):
            return _redirect_err("/admin/users", "invalid_permissions")
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        grant_id = int(str(form.get("grant_id", "0") or "0"))
        delegated_grants_repo.revoke(grant_id, str(actor.get("username", "") or "root"))
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "delegation_revoked")

    @router.post("/admin/users/action-tokens")
    async def admin_users_action_tokens(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.tokens.manage")
        if denied is not None:
            return denied
        if action_tokens_repo is None or not callable(getattr(action_tokens_repo, "add", None)):
            return _redirect_err("/admin/users", "invalid_token")
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied
        if _is_admin_target(target):
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_protected")

        purpose = str(form.get("purpose", "recharge_gb") or "recharge_gb").strip().lower()
        amount_gb = _parse_quota(form.get("amount_gb", ""))
        raw_days = str(form.get("duration_days", "0") or "0")
        try:
            duration_days = max(0, min(3650, int(raw_days)))
        except Exception:
            duration_days = 0
        target_type = canonicalize_legacy_user_type(form.get("target_type", "VIP"))
        payload = {}
        if purpose == "recharge_gb":
            if amount_gb is None:
                return _redirect_err(f"/admin/users/edit?user_id={user_id}", "invalid_token")
            payload["amount_gb"] = amount_gb
        elif purpose == "renewal":
            if duration_days <= 0:
                return _redirect_err(f"/admin/users/edit?user_id={user_id}", "invalid_token")
            payload["duration_days"] = duration_days
        elif purpose == "upgrade_plan":
            if target_type not in {"VIP", "PREMIUM", "Revendeur", "ADMIN"}:
                return _redirect_err(f"/admin/users/edit?user_id={user_id}", "invalid_token")
            if target_type == "ADMIN" and not _root_actor(actor):
                return _redirect_err(f"/admin/users/edit?user_id={user_id}", "root_required")
            payload["target_type"] = target_type
            payload["duration_days"] = duration_days if duration_days > 0 else 30
            if amount_gb is not None:
                payload["amount_gb"] = amount_gb
        else:
            return _redirect_err(f"/admin/users/edit?user_id={user_id}", "invalid_token")

        raw_uses = str(form.get("max_uses", "1") or "1")
        raw_hours = str(form.get("expires_hours", "72") or "72")
        try:
            max_uses = max(1, min(20, int(raw_uses)))
        except Exception:
            max_uses = 1
        try:
            expires_hours = max(1, min(24 * 365, int(raw_hours)))
        except Exception:
            expires_hours = 72
        action_tokens_repo.add(
            {
                "token": _build_action_token_value(),
                "purpose": purpose,
                "target_user_id": int(target.get("id", 0) or 0),
                "target_username": str(target.get("username", "") or ""),
                "payload": payload,
                "max_uses": max_uses,
                "issued_by_user_id": int(actor.get("id", 0) or 0),
                "issued_by_username": str(actor.get("username", "") or "admin"),
                "expires_at": time.time() + (expires_hours * 3600),
            }
        )
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "action_token_created")

    @router.post("/admin/users/action-tokens/revoke")
    async def admin_users_action_tokens_revoke(request: Request):
        actor, denied = _page_actor(request, next_url="/admin/users", need="admin.tokens.manage")
        if denied is not None:
            return denied
        if action_tokens_repo is None or not callable(getattr(action_tokens_repo, "revoke", None)):
            return _redirect_err("/admin/users", "invalid_token")
        try:
            form = await request.form()
        except Exception:
            form = {}
        user_id = int(str(form.get("user_id", "0") or "0"))
        token_id = int(str(form.get("token_id", "0") or "0"))
        target = _load_target_or_redirect(user_id)
        if isinstance(target, RedirectResponse):
            return target
        denied = _check_lineage(actor or {}, target)
        if denied is not None:
            return denied
        action_tokens_repo.revoke(token_id, str(actor.get("username", "") or "admin"))
        return _redirect_ok(f"/admin/users/edit?user_id={user_id}", "action_token_revoked")

    return router

