from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import html
import ipaddress
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse, RedirectResponse
from app.core.passwords import build_password_context

from app.core.access import has_root_access, is_admin_role, resolve_home_path, user_has_permission, canonicalize_legacy_user_type


def _json_error(message: str, *, status_code: int) -> JSONResponse:
    return JSONResponse(
        {"status": "error", "message": str(message or "Erreur")},
        status_code=status_code,
    )


_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")

# Mots de passe trop communs / trivialement devinables, à refuser à l'inscription
# et lors d'une réinitialisation. Liste volontairement courte : l'objectif est de
# bloquer les cas les plus évidents sans imposer de règles trop contraignantes
# à un public qui n'est pas familier des mots de passe complexes.
_WEAK_PASSWORDS = {
    "123456", "12345678", "123456789", "1234567890", "password",
    "azerty", "azerty123", "qwerty", "qwerty123", "00000000",
    "11111111", "abcdefgh", "motdepasse", "passer123", "admin123",
    "cameroun", "cameroon", "freesurf", "surf1234",
}


def _password_strength(password: str, username: str = "") -> str:
    """Retourne 'faible', 'moyen' ou 'fort' — utilisé pour la validation serveur
    et peut être exposé côté client pour un indicateur visuel."""
    text = str(password or "")
    uname = str(username or "").strip().lower()
    if len(text) < 8:
        return "faible"
    if text.lower() in _WEAK_PASSWORDS:
        return "faible"
    if uname and uname in text.lower():
        return "faible"
    if text.isdigit() or text.isalpha():
        return "moyen"
    variety = sum([
        any(c.islower() for c in text),
        any(c.isupper() for c in text),
        any(c.isdigit() for c in text),
        any(not c.isalnum() for c in text),
    ])
    if len(text) >= 12 and variety >= 3:
        return "fort"
    return "moyen"


def _is_weak_password(password: str, username: str = "") -> bool:
    return _password_strength(password, username) == "faible"


def _is_weak_recovery_secret(secret: str, username: str = "") -> bool:
    text = str(secret or "").strip().lower()
    uname = str(username or "").strip().lower()
    if not text:
        return True
    if uname and text == uname:
        return True
    if len(set(text.replace(" ", ""))) <= 2:
        # Ex: "aaaaaa", "111111", "ababab" -> trop peu de caracteres distincts
        return True
    if text in _WEAK_PASSWORDS:
        return True
    return False


_DATA_URL_RE = re.compile(
    r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_PUBLIC_NEEDS = {
    "dashboard.view",
    "account.self.view",
    "messages.view",
    "panel.free.view",
    "payments.create",
    "configs.generate.basic",
}
_PREMIUM_NEEDS = {
    "panel.premium.view",
    "premium.features.view",
    "configs.generate.advanced",
}
_RESELLER_NEEDS = {
    "panel.reseller.view",
    "users.reseller.manage",
    "payments.reseller.view",
    "payments.reseller.settings",
}
_ADMIN_PREFIXES = ("admin.", "scanner.", "system.", "users.", "ads.")
_ADMIN_NEEDS = {"payments.review", "chat.moderate", "users.manage"}

pwd_context = build_password_context(schemes=["bcrypt"], deprecated="auto")


def _escape(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "on", "y"}


def _client_ip(request: Request) -> str:
    remote_host = str(request.client.host).strip() if request.client and request.client.host else "unknown"
    app = getattr(request, "app", None)
    state = getattr(app, "state", None)
    cfg = getattr(state, "cfg", None)
    trust_proxy_headers = bool(getattr(cfg, "TRUST_PROXY_HEADERS", False))
    trusted_proxy_ips = {str(item).strip() for item in getattr(cfg, "TRUSTED_PROXY_IPS", []) if str(item).strip()}
    forwarded = str(request.headers.get("x-forwarded-for", "") or "").strip()
    if trust_proxy_headers and forwarded and remote_host and (not trusted_proxy_ips or remote_host in trusted_proxy_ips):
        for candidate in forwarded.split(","):
            value = str(candidate or "").strip()
            if not value:
                continue
            try:
                ipaddress.ip_address(value)
            except ValueError:
                continue
            return value
    return remote_host or "unknown"


def _safe_next_url(value: str, safe_next_url: Callable[[str], str] | None, fallback: str = "/dashboard") -> str:
    text = str(value or "").strip()
    if not text.startswith("/") or text.startswith("//"):
        return fallback
    if callable(safe_next_url):
        try:
            text = str(safe_next_url(text) or fallback)
        except Exception:
            text = fallback
    if not text.startswith("/") or text.startswith("//"):
        return fallback
    return text[:500] or fallback


def _root_admin_bootstrap_candidates(cfg: Any, user: dict[str, Any]) -> list[str]:
    if not has_root_access(user):
        return []
    base_dir = Path(getattr(cfg, "BASE_DIR", ".") or ".")
    try:
        secret = (base_dir / ".admin_password").read_text(encoding="utf-8").strip()
    except Exception:
        secret = ""
    if not secret:
        return []
    username = str(user.get("username", "") or "").strip()
    candidates: list[str] = [secret]
    if username:
        candidates.append(f"{username}@{secret}")
        title_username = username[:1].upper() + username[1:].lower() if len(username) > 1 else username.upper()
        candidates.append(f"{title_username}@{secret}")
    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text and text not in seen:
            seen.add(text)
            unique.append(text)
    return unique


def _captcha_markup(question: str, signed_answer: str) -> str:
    return (
        '<div class="px-3 py-2 rounded-xl bg-black/40 border border-white/10 mono text-[12px]">'
        f"{_escape(question)}"
        "</div>"
        f'<input type="hidden" name="captcha_signed" value="{_escape(signed_answer)}">'
    )


def _user_meets_need(user: dict[str, Any], need: str) -> bool:
    code = str(need or "").strip()
    if not code:
        return True
    if has_root_access(user):
        return True
    if user_has_permission(user, code):
        return True
    if code in _PUBLIC_NEEDS:
        return True
    if code in _PREMIUM_NEEDS or code in _RESELLER_NEEDS:
        return user_has_permission(user, code)
    if code in _ADMIN_NEEDS:
        return user_has_permission(user, code) or user_has_permission(user, "panel.admin.view") or is_admin_role(user)
    if any(code.startswith(prefix) for prefix in _ADMIN_PREFIXES):
        return user_has_permission(user, code) or user_has_permission(user, "panel.admin.view") or is_admin_role(user)
    return True


def create_auth_router(
    *,
    db: Any,
    cfg: Any,
    safe_next_url: Callable[[str], str] | None = None,
    now_ts: Callable[[], str] | None = None,
    normalize_license: Callable[[str], str] | None = None,
    normalize_uuid: Callable[[str], str] | None = None,
    normalize_recovery_secret: Callable[[str], str] | None = None,
    hash_recovery_secret: Callable[[str], str] | None = None,
    suggest_usernames: Callable[[str, list[dict], int], list[str]] | None = None,
    generate_license_key: Callable[[], str] | None = None,
    generate_uuid: Callable[[], str] | None = None,
    safe_avatar_url: Callable[[Any], str] | None = None,
    is_user_expired: Callable[[dict], bool] | None = None,
    check_login_rate_limit: Callable[[str], bool] | None = None,
    check_captcha_ban: Callable[[str], bool] | None = None,
    register_captcha_failure: Callable[[str], None] | None = None,
    generate_math_captcha: Callable[[], tuple[str, str]] | None = None,
    sign_captcha_answer: Callable[[str], str] | None = None,
    verify_captcha_answer: Callable[[str | None, str], bool] | None = None,
    verify_csrf: Callable[[Request, dict], bool] | None = None,
    find_single_non_admin_user_by_username: Callable[[list[dict], str], dict | None] | None = None,
    create_session: Callable[[dict], str] | None = None,
    destroy_session: Callable[[str], None] | None = None,
    ssh_dropbear_provisioner: Any = None,
    hysteria2_provisioner: Any = None,
    slowdns_provisioner: Any = None,
    zivpn_udp_provisioner: Any = None,
    xui_provisioner: Any = None,
) -> APIRouter:
    router = APIRouter()

    csrf_secret = (str(getattr(cfg, "_VIP_COOKIE_SECRET", "") or "dev-csrf-secret")).encode("utf-8")
    session_cookie = str(getattr(cfg, "SESSION_COOKIE", "labo_session") or "labo_session")
    csrf_cookie = str(getattr(cfg, "CSRF_COOKIE", "labo_csrf") or "labo_csrf")
    cookie_secure = _as_bool(getattr(cfg, "_COOKIE_SECURE", False))
    session_ttl = max(60, int(getattr(cfg, "SESSION_TTL_SECONDS", 86400) or 86400))
    avatar_max_bytes = max(1024, int(getattr(cfg, "AVATAR_MAX_BYTES", 2 * 1024 * 1024) or 2 * 1024 * 1024))
    avatars_dir = Path(getattr(cfg, "AVATARS_DIR", Path("static/avatars")) or Path("static/avatars"))
    avatars_dir.mkdir(parents=True, exist_ok=True)
    recovery_secret_min_len = max(4, int(getattr(cfg, "RECOVERY_SECRET_MIN_LEN", 4) or 4))
    recovery_secret_max_len = max(recovery_secret_min_len, int(getattr(cfg, "RECOVERY_SECRET_MAX_LEN", 120) or 120))
    password_reset_ttl = max(300, int(getattr(cfg, "PASSWORD_RESET_TTL_SECONDS", 900) or 900))
    password_reset_rate_window = max(60, int(getattr(cfg, "PASSWORD_RESET_RATE_WINDOW", 300) or 300))
    password_reset_rate_max = max(3, int(getattr(cfg, "PASSWORD_RESET_RATE_MAX", 5) or 5))
    password_reset_attempts: dict[str, list[float]] = {}

    users_repo = getattr(db, "users", None)
    sessions_repo = getattr(db, "sessions", None)

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

    def _collect_transport_provisioning(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        return _collect_transport_action(user, reason=reason, method_name="ensure_user")

    def _collect_transport_disable(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        return _collect_transport_action(user, reason=reason, method_name="disable_user")

    def _provision_and_activate(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        provisioning: dict[str, Any] | None = None
        try:
            provisioning = _collect_transport_provisioning(user, reason=reason)
        finally:
            if users_repo is not None and callable(getattr(users_repo, "get_by_id", None)) and callable(getattr(users_repo, "save", None)):
                try:
                    latest_user = users_repo.get_by_id(int(user.get("id", 0) or 0))
                    if isinstance(latest_user, dict) and str(latest_user.get("status", "") or "") == "configuring":
                        latest_user["status"] = "active"
                        users_repo.save(latest_user)
                except Exception:
                    pass
        return provisioning

    def _normalize_license_value(raw: str) -> str:
        text = str(raw or "").strip()
        if callable(normalize_license):
            try:
                return str(normalize_license(text) or "")
            except Exception:
                pass
        return text.upper().replace(" ", "")

    def _normalize_uuid_value(raw: str) -> str:
        text = str(raw or "").strip()
        if callable(normalize_uuid):
            try:
                return str(normalize_uuid(text) or "")
            except Exception:
                pass
        try:
            return str(uuid.UUID(text))
        except Exception:
            return ""

    def _normalize_recovery_secret_value(raw: str) -> str:
        text = str(raw or "").strip()
        if callable(normalize_recovery_secret):
            try:
                return str(normalize_recovery_secret(text) or "")
            except Exception:
                pass
        return text

    def _hash_recovery_secret_value(raw: str) -> str:
        text = _normalize_recovery_secret_value(raw).lower()
        if callable(hash_recovery_secret):
            try:
                return str(hash_recovery_secret(text) or "")
            except Exception:
                pass
        return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""

    def _normalize_contact_value(raw: str) -> str:
        return str(raw or "").strip().lower()

    def _now_text() -> str:
        if callable(now_ts):
            try:
                return str(now_ts())
            except Exception:
                pass
        return str(int(time.time()))

    def _csrf_hash(seed: str) -> str:
        return hmac.new(csrf_secret, str(seed or "").encode("utf-8"), hashlib.sha256).hexdigest()

    def _verify_csrf_fallback(request: Request, submitted: str) -> bool:
        token = str(submitted or "").strip()
        if not token:
            return False
        seed = str(request.cookies.get(csrf_cookie, "") or "").strip()
        if not seed:
            return False
        return hmac.compare_digest(token, _csrf_hash(seed))

    def _find_user_for_access(access_key: str) -> dict[str, Any] | None:
        if users_repo is None:
            return None
        normalized_license = _normalize_license_value(access_key)
        if normalized_license and callable(getattr(users_repo, "get_by_license", None)):
            try:
                user = users_repo.get_by_license(normalized_license)
                if isinstance(user, dict):
                    return dict(user)
            except Exception:
                pass
        normalized_access_uuid = _normalize_uuid_value(access_key)
        if not normalized_access_uuid:
            return None
        if not callable(getattr(users_repo, "get_all", None)):
            return None
        try:
            rows = users_repo.get_all()
        except Exception:
            return None
        if not isinstance(rows, list):
            return None
        for row in rows:
            if not isinstance(row, dict):
                continue
            if _normalize_uuid_value(str(row.get("uuid_secondary", "") or "")) == normalized_access_uuid:
                return dict(row)
        return None

    def _find_user_by_username(username: str) -> dict[str, Any] | None:
        if users_repo is None:
            return None
        if callable(getattr(users_repo, "get_by_username", None)):
            try:
                user = users_repo.get_by_username(username)
                if isinstance(user, dict):
                    return dict(user)
            except Exception:
                pass
        if callable(getattr(users_repo, "get_all", None)):
            try:
                rows = users_repo.get_all()
            except Exception:
                rows = []
            if isinstance(rows, list):
                for row in rows:
                    if isinstance(row, dict) and str(row.get("username", "") or "").strip().lower() == str(username or "").strip().lower():
                        return dict(row)
        return None

    def _post_login_target(user: dict[str, Any], requested_next: str) -> str:
        default_target = resolve_home_path(user)
        target = _safe_next_url(requested_next, safe_next_url, default_target)
        if target in {"", "/", "/acces", "/inscription", "/logout", "/api/captcha/refresh"}:
            target = default_target
        
        # Check if user is new/first-time (status = configuring) → redirect to onboarding
        user_status = str(user.get("status", "active") or "").strip().lower()
        if user_status == "configuring":
            username = str(user.get("username", "") or "").strip()
            return f"/onboarding?name={username}" if username else "/onboarding"
        
        return target or default_target

    def _set_session_cookie(response: RedirectResponse, token: str) -> None:
        response.set_cookie(
            key=session_cookie,
            value=str(token or ""),
            httponly=True,
            max_age=session_ttl,
            samesite="Lax",
            secure=cookie_secure,
            path="/",
        )

    def _clear_password_reset_session(request: Request) -> None:
        try:
            request.session.pop("password_reset", None)
            request.session.pop("migration_username", None)
        except Exception:
            pass

    def _get_password_reset_session(request: Request) -> dict[str, Any] | None:
        try:
            payload = request.session.get("password_reset")
        except Exception:
            return None
        if not isinstance(payload, dict):
            legacy_username = ""
            try:
                legacy_username = str(request.session.get("migration_username", "") or "").strip()
            except Exception:
                legacy_username = ""
            if not legacy_username:
                return None
            payload = {
                "username": legacy_username,
                "contact": "",
                "requested_at": int(time.time()),
            }
        username = str(payload.get("username", "") or "").strip()
        contact = _normalize_contact_value(payload.get("contact", ""))
        try:
            requested_at = int(float(payload.get("requested_at", 0) or 0))
        except Exception:
            requested_at = 0
        age = int(time.time()) - requested_at if requested_at else password_reset_ttl + 1
        if not _USERNAME_RE.fullmatch(username) or age < 0 or age > password_reset_ttl:
            _clear_password_reset_session(request)
            return None
        return {"username": username, "contact": contact, "requested_at": requested_at}

    def _set_password_reset_session(request: Request, user: dict[str, Any], *, contact: str = "") -> None:
        username = str(user.get("username", "") or "").strip()
        if not _USERNAME_RE.fullmatch(username):
            _clear_password_reset_session(request)
            return
        request.session["password_reset"] = {
            "username": username,
            "contact": _normalize_contact_value(contact or user.get("contact", "")),
            "requested_at": int(time.time()),
        }
        try:
            request.session.pop("migration_username", None)
        except Exception:
            pass

    def _check_password_reset_rate_limit(client_ip: str, username: str) -> bool:
        key = f"{str(client_ip or '').strip().lower()}|{str(username or '').strip().lower()}"
        now_value = time.time()
        recent = [ts for ts in password_reset_attempts.get(key, []) if now_value - float(ts) < password_reset_rate_window]
        if len(recent) >= password_reset_rate_max:
            password_reset_attempts[key] = recent
            return False
        recent.append(now_value)
        password_reset_attempts[key] = recent
        return True

    def _build_access_redirect(err: str, next_url: str, need: str) -> RedirectResponse:
        payload: dict[str, str] = {"err": str(err or "").strip()}
        if next_url:
            payload["next"] = _safe_next_url(next_url, safe_next_url)
        if need:
            payload["need"] = str(need or "").strip()[:160]
        return RedirectResponse(f"/acces?{urlencode(payload)}", status_code=303)

    def _build_signup_redirect(
        *,
        err: str,
        next_url: str,
        username: str,
        contact: str,
        recovery_secret: str,
        suggestions: list[str] | None = None,
    ) -> RedirectResponse:
        del recovery_secret
        payload: dict[str, str] = {
            "err": str(err or "").strip(),
            "next": _safe_next_url(next_url, safe_next_url, "/panel-gratuit"),
            "username": str(username or "").strip()[:64],
            "contact": str(contact or "").strip()[:160],
        }
        if isinstance(suggestions, list):
            for idx, candidate in enumerate(suggestions[:3], start=1):
                text = str(candidate or "").strip()
                if text:
                    payload[f"s{idx}"] = text[:64]
        return RedirectResponse(f"/inscription?{urlencode(payload)}", status_code=303)

    def _build_forgot_redirect(err: str, username: str, contact: str, message: str = "") -> RedirectResponse:
        payload = {
            "err": str(err or "").strip(),
            "username": str(username or "").strip()[:64],
            "contact": str(contact or "").strip()[:160],
        }
        clean_message = str(message or "").strip()[:600]
        if clean_message:
            payload["message"] = clean_message
        return RedirectResponse(f"/acces/mot-de-passe-oublie?{urlencode(payload)}", status_code=303)

    @router.post("/acces")
    async def login_submit(request: Request, background_tasks: BackgroundTasks):
        form = await request.form()
        form_map = {key: form.getlist(key) for key in form.keys()}
        username = str(form.get("username", "") or "").strip()
        legacy_access = str(form.get("license", "") or "").strip()
        password = str(form.get("password", "") or "").strip()
        requested_next = str(form.get("next", "") or "").strip()
        need = str(form.get("need", "") or "").strip()
        csrf_token = str(form.get("csrf_token", "") or "").strip()
        client_ip = _client_ip(request)

        csrf_ok = False
        if callable(verify_csrf):
            try:
                csrf_ok = bool(verify_csrf(request, form_map))
            except Exception:
                csrf_ok = False
        if not csrf_ok and not _verify_csrf_fallback(request, csrf_token):
            return _build_access_redirect("csrf", requested_next, need)

        if callable(check_login_rate_limit):
            try:
                if not check_login_rate_limit(f"{client_ip}|{str(username or '').strip().lower()}"):
                    return _build_access_redirect("invalid", requested_next, need)
            except Exception:
                pass

        user = _find_user_by_username(username) if username else None
        if not isinstance(user, dict) and legacy_access:
            user = _find_user_for_access(legacy_access)
        if not isinstance(user, dict):
            return _build_access_redirect("invalid", requested_next, need)

        root_actor = has_root_access(user)

        if not root_actor:
            locked_until_raw = str(user.get("login_locked_until", "") or "").strip()
            if locked_until_raw:
                try:
                    locked_until_ts = float(locked_until_raw)
                except Exception:
                    locked_until_ts = 0.0
                if locked_until_ts > time.time():
                    return _build_access_redirect("account_locked", requested_next, need)
        user_status = str(user.get("status", "active") or "active").strip().lower()
        if not root_actor and user_status not in {"active", "configuring"}:
            return _build_access_redirect("blocked", requested_next, need)

        if callable(is_user_expired):
            try:
                if not root_actor and not is_admin_role(user) and is_user_expired(user):
                    expired_user = dict(user)
                    expired_user["status"] = "expired"
                    if callable(getattr(users_repo, "save", None)):
                        try:
                            expired_user = users_repo.save(expired_user)
                        except Exception:
                            pass
                    background_tasks.add_task(_collect_transport_disable, expired_user, reason="access_expired")
                    return _build_access_redirect("blocked", requested_next, need)
            except Exception:
                pass

        pwd_hash = str(user.get("password_hash", "") or "").strip()
        auth_ok = False
        if pwd_hash:
            try:
                auth_ok = pwd_context.verify(password, pwd_hash)
            except Exception:
                auth_ok = False
        if not auth_ok and has_root_access(user):
            for candidate in _root_admin_bootstrap_candidates(cfg, user):
                if not hmac.compare_digest(password, candidate):
                    continue
                auth_ok = True
                if callable(getattr(users_repo, "save", None)):
                    try:
                        repaired_user = dict(user)
                        repaired_user["password_hash"] = pwd_context.hash(password)
                        repaired_user["service_password"] = password
                        repaired_user["status"] = "active"
                        repaired_user["expiration"] = ""
                        user = users_repo.save(repaired_user)
                    except Exception:
                        pass
                break
        if not auth_ok:
            if not root_actor and callable(getattr(users_repo, "save", None)):
                try:
                    login_attempts = int(user.get("login_failed_attempts", 0) or 0) + 1
                    updated_user = dict(user)
                    updated_user["login_failed_attempts"] = login_attempts
                    if login_attempts >= 5:
                        updated_user["login_failed_attempts"] = 0
                        updated_user["login_locked_until"] = str(time.time() + 900)  # verrouillage 15 min
                        users_repo.save(updated_user)
                        return _build_access_redirect("account_locked", requested_next, need)
                    users_repo.save(updated_user)
                except Exception:
                    pass
            return _build_access_redirect("invalid", requested_next, need)
        if not root_actor and callable(getattr(users_repo, "save", None)) and (
            int(user.get("login_failed_attempts", 0) or 0) > 0 or str(user.get("login_locked_until", "") or "").strip()
        ):
            try:
                cleared_user = dict(user)
                cleared_user["login_failed_attempts"] = 0
                cleared_user["login_locked_until"] = ""
                user = users_repo.save(cleared_user)
            except Exception:
                pass
        if root_actor and callable(getattr(users_repo, "save", None)):
            try:
                refreshed_root = dict(user)
                refreshed_root["status"] = "active"
                refreshed_root["expiration"] = ""
                user = users_repo.save(refreshed_root)
            except Exception:
                pass

        if need and not _user_meets_need(user, need):
            attempts = int(user.get("forbidden_attempts", 0) or 0) + 1
            user["forbidden_attempts"] = attempts
            user["last_forbidden_need"] = need
            user["last_forbidden_at"] = _now_text()
            if attempts >= 3:
                user["status"] = "blocked"
                err = "blocked_policy"
            elif attempts == 2:
                err = "forbidden_warn"
            else:
                err = "forbidden"
            saved_user = dict(user)
            if callable(getattr(users_repo, "save", None)):
                try:
                    saved_user = users_repo.save(user)
                except Exception:
                    saved_user = dict(user)
            if err == "blocked_policy":
                background_tasks.add_task(_collect_transport_disable, saved_user, reason="blocked_policy")
            return _build_access_redirect(err, requested_next, need)

        if int(user.get("forbidden_attempts", 0) or 0) > 0:
            user["forbidden_attempts"] = 0
            user["last_forbidden_need"] = ""
            user["last_forbidden_at"] = ""
            if callable(getattr(users_repo, "save", None)):
                try:
                    users_repo.save(user)
                except Exception:
                    pass

        if callable(create_session):
            token = create_session(user)
        else:
            if not callable(getattr(sessions_repo, "set", None)):
                return _build_access_redirect("invalid", requested_next, need)
            token = secrets.token_urlsafe(32)
            user_id = int(user.get("id", 0) or 0)
            if callable(getattr(sessions_repo, "delete_for_user", None)):
                try:
                    sessions_repo.delete_for_user(user_id)
                except Exception:
                    pass
            sessions_repo.set(token, user_id, str(user.get("username", "") or ""), time.time() + session_ttl)

        response = RedirectResponse(_post_login_target(user, requested_next), status_code=303)
        _set_session_cookie(response, token)
        return response

    @router.post("/api/auth/login")
    async def api_login(request: Request):
        """Connexion JSON pour clients externes (Labo Surf, futurs clients API).
        Ne touche pas a /acces qui reste inchange pour le site web.
        Reutilise la meme logique de verification (mot de passe, statut, expiration)
        mais sans CSRF de formulaire (non pertinent pour un appel API direct) ni
        redirection HTML."""
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        username = str(payload.get("username", "") or "").strip()
        password = str(payload.get("password", "") or "").strip()
        client_ip = _client_ip(request)

        if not username or not password:
            return _json_error("Identifiants requis.", status_code=400)

        if callable(check_login_rate_limit):
            try:
                if not check_login_rate_limit(f"{client_ip}|{username.strip().lower()}"):
                    return _json_error("Trop de tentatives, reessayez plus tard.", status_code=429)
            except Exception:
                pass

        user = _find_user_by_username(username)
        if not isinstance(user, dict):
            return _json_error("Identifiants invalides.", status_code=401)

        root_actor = has_root_access(user)
        user_status = str(user.get("status", "active") or "active").strip().lower()
        if not root_actor and user_status not in {"active", "configuring"}:
            return _json_error("Compte bloque ou inactif.", status_code=403)

        if callable(is_user_expired):
            try:
                if not root_actor and not is_admin_role(user) and is_user_expired(user):
                    return _json_error("Abonnement expire.", status_code=403)
            except Exception:
                pass

        pwd_hash = str(user.get("password_hash", "") or "").strip()
        auth_ok = False
        if pwd_hash:
            try:
                auth_ok = pwd_context.verify(password, pwd_hash)
            except Exception:
                auth_ok = False
        if not auth_ok:
            return _json_error("Identifiants invalides.", status_code=401)

        if callable(create_session):
            token = create_session(user)
        else:
            if not callable(getattr(sessions_repo, "set", None)):
                return _json_error("Session indisponible.", status_code=500)
            token = secrets.token_urlsafe(32)
            user_id = int(user.get("id", 0) or 0)
            if callable(getattr(sessions_repo, "delete_for_user", None)):
                try:
                    sessions_repo.delete_for_user(user_id)
                except Exception:
                    pass
            sessions_repo.set(token, user_id, str(user.get("username", "") or ""), time.time() + session_ttl)

        # Liste blanche explicite, meme principe que /api/user/me : jamais de champs sensibles
        return {
            "status": "ok",
            "token": token,
            "expires_in": session_ttl,
            "user": {
                "id": user.get("id"),
                "username": str(user.get("username", "") or ""),
                "type": canonicalize_legacy_user_type(user.get("type")),
                "status": str(user.get("status", "active") or "active"),
                "expiration": str(user.get("expiration", "") or ""),
            },
        }

    @router.post("/api/auth/register")
    async def api_register(request: Request):
        """Inscription JSON pour clients externes (app Labo Surf).
        Reutilise exactement les memes regles de validation que /inscription
        (nom d'utilisateur, contact, phrase de recuperation, mot de passe),
        mais sans captcha visuel ni CSRF de formulaire (non pertinents pour un
        appel API direct d'un client de confiance) : on protege plutot avec
        une limite de tentatives par IP, comme /api/auth/login.
        Ne cree que des comptes "Gratuit" (comme /inscription) ; l'avatar
        n'est pas gere ici (optionnel, ajoutable depuis le compte une fois connecte).
        """
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        username = str(payload.get("username", "") or "").strip()
        contact = str(payload.get("contact", "") or "").strip()
        recovery_secret = _normalize_recovery_secret_value(str(payload.get("recovery_secret", "") or ""))
        password = str(payload.get("password", "") or "").strip()
        confirm_password = str(payload.get("confirm_password", "") or "").strip()
        client_ip = _client_ip(request)

        if callable(check_login_rate_limit):
            try:
                if not check_login_rate_limit(f"{client_ip}|register"):
                    return _json_error("Trop de tentatives, reessayez plus tard.", status_code=429)
            except Exception:
                pass

        if not _USERNAME_RE.fullmatch(username):
            return _json_error("Nom d'utilisateur invalide (3-32 caracteres, lettres/chiffres/._- uniquement).", status_code=400)
        if len(contact) < 3 or len(contact) > 160:
            return _json_error("Contact invalide.", status_code=400)
        if len(recovery_secret) < recovery_secret_min_len or len(recovery_secret) > recovery_secret_max_len:
            return _json_error(f"La phrase de recuperation doit faire {recovery_secret_min_len} a {recovery_secret_max_len} caracteres.", status_code=400)
        if _is_weak_recovery_secret(recovery_secret, username):
            return _json_error("Phrase de recuperation trop faible.", status_code=400)
        if password != confirm_password:
            return _json_error("Les mots de passe ne correspondent pas.", status_code=400)
        if _is_weak_password(password, username):
            return _json_error("Mot de passe trop faible.", status_code=400)
        if users_repo is None or not callable(getattr(users_repo, "save", None)):
            return _json_error("Inscription indisponible.", status_code=500)

        if callable(getattr(users_repo, "username_exists", None)) and users_repo.username_exists(username):
            suggestions: list[str] = []
            if callable(suggest_usernames) and callable(getattr(users_repo, "get_all", None)):
                try:
                    suggestions = suggest_usernames(username, users_repo.get_all(), 3)
                except Exception:
                    suggestions = []
            return JSONResponse(
                {"status": "error", "message": "Ce nom d'utilisateur est deja pris.", "suggestions": suggestions},
                status_code=409,
            )

        license_key = generate_license_key() if callable(generate_license_key) else f"LIC-{secrets.token_hex(8).upper()}"
        user_uuid = generate_uuid() if callable(generate_uuid) else str(uuid.uuid4())

        new_user = {
            "username": username,
            "contact": contact,
            "type": "Gratuit",
            "status": "configuring",
            "license": str(license_key or ""),
            "uuid_secondary": str(user_uuid or ""),
            "recovery_secret_hash": _hash_recovery_secret_value(recovery_secret),
            "password_hash": pwd_context.hash(password),
            "service_password": password,
            "forbidden_attempts": 0,
            "last_forbidden_need": "",
            "last_forbidden_at": "",
            "avatar": "",
            "quota_gb": None,
            "expiration": "",
            "notes": "",
        }

        try:
            saved_user = users_repo.save(new_user)
        except Exception:
            return _json_error("Ce nom d'utilisateur est deja pris.", status_code=409)

        background_tasks = BackgroundTasks()
        background_tasks.add_task(_provision_and_activate, saved_user, reason="signup")

        if callable(create_session):
            token = create_session(saved_user)
        else:
            token = secrets.token_urlsafe(32)
            user_id = int(saved_user.get("id", 0) or 0)
            if callable(getattr(sessions_repo, "delete_for_user", None)):
                try:
                    sessions_repo.delete_for_user(user_id)
                except Exception:
                    pass
            sessions_repo.set(token, user_id, str(saved_user.get("username", "") or ""), time.time() + session_ttl)

        response = JSONResponse({
            "status": "ok",
            "token": token,
            "expires_in": session_ttl,
            "user": {
                "id": saved_user.get("id"),
                "username": str(saved_user.get("username", "") or ""),
                "type": "Gratuit",
                "status": str(saved_user.get("status", "configuring") or "configuring"),
                "expiration": "",
            },
        })
        response.background = background_tasks
        return response

    @router.get("/logout")
    @router.post("/logout")
    async def logout(request: Request):
        token = str(request.cookies.get(session_cookie, "") or "").strip()
        if token:
            if callable(destroy_session):
                try:
                    destroy_session(token)
                except Exception:
                    pass
            elif callable(getattr(sessions_repo, "delete", None)):
                try:
                    sessions_repo.delete(token)
                except Exception:
                    pass
                try:
                    sessions_repo.delete(hashlib.sha256(token.encode("utf-8")).hexdigest())
                except Exception:
                    pass
        response = RedirectResponse("/acces", status_code=303)
        response.delete_cookie(key=session_cookie, path="/", samesite="Lax", secure=cookie_secure)
        return response

    @router.get("/api/captcha/refresh")
    async def refresh_captcha(request: Request):
        client_ip = _client_ip(request)
        if callable(check_captcha_ban):
            try:
                if not check_captcha_ban(client_ip):
                    return JSONResponse({"status": "error", "message": "Too many attempts."}, status_code=429)
            except Exception:
                pass
        question = "1 + 1 = ?"
        answer = "2"
        if callable(generate_math_captcha):
            try:
                question, answer = generate_math_captcha()
            except Exception:
                pass
        signed_answer = answer
        if callable(sign_captcha_answer):
            try:
                signed_answer = sign_captcha_answer(answer)
            except Exception:
                signed_answer = answer
        return {"status": "ok", "captcha": _captcha_markup(question, signed_answer)}

    @router.post("/inscription")
    async def signup_submit(request: Request, background_tasks: BackgroundTasks):
        form = await request.form()
        form_map = {key: form.getlist(key) for key in form.keys()}

        next_url = _safe_next_url(str(form.get("next", "/panel-gratuit") or "/panel-gratuit"), safe_next_url, "/panel-gratuit")
        username = str(form.get("username", "") or "").strip()
        contact = str(form.get("contact", "") or "").strip()
        recovery_secret = _normalize_recovery_secret_value(str(form.get("recovery_secret", "") or ""))
        avatar_url_input = str(form.get("avatar", "") or "").strip()
        avatar_data_url = str(form.get("avatar_data_url", "") or "").strip()
        captcha_signed = str(form.get("captcha_signed", "") or "").strip()
        captcha_answer = str(form.get("captcha", "") or "").strip()
        password = str(form.get("password", "") or "").strip()
        confirm_password = str(form.get("confirm_password", "") or "").strip()
        csrf_token = str(form.get("csrf_token", "") or "").strip()
        client_ip = _client_ip(request)

        csrf_ok = False
        if callable(verify_csrf):
            try:
                csrf_ok = bool(verify_csrf(request, form_map))
            except Exception:
                csrf_ok = False
        else:
            csrf_ok = _verify_csrf_fallback(request, csrf_token)
        if not csrf_ok:
            return _build_signup_redirect(err="csrf", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)

        if callable(check_captcha_ban):
            try:
                if not check_captcha_ban(client_ip):
                    return _build_signup_redirect(err="captcha_rate", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
            except Exception:
                pass

        captcha_ok = True
        if callable(verify_captcha_answer):
            try:
                captcha_ok = bool(verify_captcha_answer(captcha_signed, captcha_answer))
            except Exception:
                captcha_ok = False
        if not captcha_ok:
            if callable(register_captcha_failure):
                try:
                    register_captcha_failure(client_ip)
                except Exception:
                    pass
            return _build_signup_redirect(err="bad_captcha", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)

        if not _USERNAME_RE.fullmatch(username):
            return _build_signup_redirect(err="bad_username", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
        if len(contact) < 3 or len(contact) > 160:
            return _build_signup_redirect(err="bad_contact", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
        if len(recovery_secret) < recovery_secret_min_len or len(recovery_secret) > recovery_secret_max_len:
            return _build_signup_redirect(err="bad_recovery_secret", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
        if _is_weak_recovery_secret(recovery_secret, username):
            return _build_signup_redirect(err="weak_recovery_secret", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
        if password != confirm_password:
            return _build_signup_redirect(err="bad_password", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
        if _is_weak_password(password, username):
            return _build_signup_redirect(err="weak_password", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
        if users_repo is None or not callable(getattr(users_repo, "save", None)):
            return _build_signup_redirect(err="bad_username", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)

        if callable(getattr(users_repo, "username_exists", None)) and users_repo.username_exists(username):
            suggestions: list[str] = []
            if callable(suggest_usernames) and callable(getattr(users_repo, "get_all", None)):
                try:
                    suggestions = suggest_usernames(username, users_repo.get_all(), 3)
                except Exception:
                    suggestions = []
            return _build_signup_redirect(err="taken", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret, suggestions=suggestions)

        avatar_url = ""
        if avatar_data_url:
            match = _DATA_URL_RE.match(avatar_data_url)
            if not match:
                return _build_signup_redirect(err="bad_avatar", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
            mime = str(match.group(1) or "").strip().lower()
            payload = str(match.group(2) or "").strip()
            ext = _MIME_TO_EXT.get(mime, "")
            if not ext:
                return _build_signup_redirect(err="bad_avatar", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
            try:
                blob = base64.b64decode(payload, validate=True)
            except (binascii.Error, ValueError):
                return _build_signup_redirect(err="bad_avatar", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
            if len(blob) > avatar_max_bytes:
                return _build_signup_redirect(err="avatar_too_big", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
            filename = f"avatar_{int(time.time())}_{secrets.token_hex(4)}{ext}"
            output = avatars_dir / filename
            try:
                output.write_bytes(blob)
            except Exception:
                return _build_signup_redirect(err="bad_avatar", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)
            avatar_url = f"/static/avatars/{filename}"
        elif avatar_url_input:
            if callable(safe_avatar_url):
                try:
                    avatar_url = str(safe_avatar_url(avatar_url_input) or "")
                except Exception:
                    avatar_url = ""
            else:
                text = str(avatar_url_input or "").strip()
                if text.startswith("/static/avatars/") or text.startswith("https://") or text.startswith("http://"):
                    avatar_url = text
            if avatar_url_input and not avatar_url:
                return _build_signup_redirect(err="bad_avatar", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)

        if not callable(create_session) and not callable(getattr(sessions_repo, "set", None)):
            return _build_signup_redirect(err="bad_username", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)

        license_key = generate_license_key() if callable(generate_license_key) else f"LIC-{secrets.token_hex(8).upper()}"
        user_uuid = generate_uuid() if callable(generate_uuid) else str(uuid.uuid4())

        new_user = {
            "username": username,
            "contact": contact,
            "type": "Gratuit",
            "status": "configuring",
            "license": str(license_key or ""),
            "uuid_secondary": str(user_uuid or ""),
            "recovery_secret_hash": _hash_recovery_secret_value(recovery_secret),
            "password_hash": pwd_context.hash(password),
            "service_password": password,
            "forbidden_attempts": 0,
            "last_forbidden_need": "",
            "last_forbidden_at": "",
            "avatar": avatar_url,
            "quota_gb": None,
            "expiration": "",
            "notes": "",
        }

        try:
            saved_user = users_repo.save(new_user)
        except Exception:
            return _build_signup_redirect(err="taken", next_url=next_url, username=username, contact=contact, recovery_secret=recovery_secret)

        background_tasks.add_task(_provision_and_activate, saved_user, reason="signup")

        if callable(create_session):
            token = create_session(saved_user)
        else:
            token = secrets.token_urlsafe(32)
            user_id = int(saved_user.get("id", 0) or 0)
            if callable(getattr(sessions_repo, "delete_for_user", None)):
                try:
                    sessions_repo.delete_for_user(user_id)
                except Exception:
                    pass
            sessions_repo.set(token, user_id, str(saved_user.get("username", "") or ""), time.time() + session_ttl)

        target = _post_login_target(saved_user, next_url)
        response = RedirectResponse(target, status_code=303)
        _set_session_cookie(response, token)
        return response

    @router.post("/acces/definir-mot-de-passe")
    async def define_password_submit(request: Request):
        form = await request.form()
        form_map = {key: form.getlist(key) for key in form.keys()}
        password = str(form.get("password", "") or "").strip()
        confirm = str(form.get("confirm_password", "") or "").strip()
        csrf_token = str(form.get("csrf_token", "") or "").strip()

        pending_reset = _get_password_reset_session(request)
        if pending_reset is None:
            return RedirectResponse("/acces/mot-de-passe-oublie?err=expired", status_code=303)

        csrf_ok = False
        if callable(verify_csrf):
            try:
                csrf_ok = bool(verify_csrf(request, form_map))
            except Exception:
                csrf_ok = False
        if not csrf_ok and not _verify_csrf_fallback(request, csrf_token):
            return RedirectResponse("/acces/definir-mot-de-passe?err=csrf", status_code=303)

        if password != confirm:
            return RedirectResponse("/acces/definir-mot-de-passe?err=mismatch", status_code=303)
        if _is_weak_password(password, str(pending_reset.get("username", "") or "")):
            return RedirectResponse("/acces/definir-mot-de-passe?err=weak_password", status_code=303)

        user = _find_user_by_username(str(pending_reset.get("username", "") or ""))
        if not isinstance(user, dict):
            _clear_password_reset_session(request)
            return RedirectResponse("/acces/mot-de-passe-oublie?err=expired", status_code=303)

        stored_contact = _normalize_contact_value(user.get("contact", ""))
        if not stored_contact or stored_contact != str(pending_reset.get("contact", "") or ""):
            _clear_password_reset_session(request)
            return RedirectResponse("/acces/mot-de-passe-oublie?err=expired", status_code=303)

        updated_user = dict(user)
        updated_user["password_hash"] = pwd_context.hash(password)
        updated_user["service_password"] = password
        if callable(getattr(users_repo, "save", None)):
            try:
                users_repo.save(updated_user)
            except Exception:
                pass

        _clear_password_reset_session(request)
        return RedirectResponse("/acces?success=password_migrated", status_code=303)

    @router.post("/acces/licence-oubliee")
    @router.post("/acces/mot-de-passe-oublie")
    async def forgot_password_submit(request: Request):
        form = await request.form()
        form_map = {key: form.getlist(key) for key in form.keys()}
        username = str(form.get("username", "") or "").strip()
        contact = str(form.get("contact", "") or "").strip()
        normalized_contact = _normalize_contact_value(contact)
        recovery_secret = _normalize_recovery_secret_value(str(form.get("recovery_secret", "") or ""))
        csrf_token = str(form.get("csrf_token", "") or "").strip()
        client_ip = _client_ip(request)

        _clear_password_reset_session(request)

        csrf_ok = False
        if callable(verify_csrf):
            try:
                csrf_ok = bool(verify_csrf(request, form_map))
            except Exception:
                csrf_ok = False
        if not csrf_ok and not _verify_csrf_fallback(request, csrf_token):
            return _build_forgot_redirect("csrf", username, contact)
        if not _check_password_reset_rate_limit(client_ip, username):
            return _build_forgot_redirect("rate_limit", username, contact)
        if not _USERNAME_RE.fullmatch(username):
            return _build_forgot_redirect("bad_username", username, contact)
        if len(normalized_contact) < 3 or len(contact) > 160:
            return _build_forgot_redirect("bad_contact", username, contact)
        if len(recovery_secret) < recovery_secret_min_len or len(recovery_secret) > recovery_secret_max_len:
            return _build_forgot_redirect("bad_secret", username, contact)
        if users_repo is None:
            return _build_forgot_redirect("bad_secret", username, contact)

        users_rows: list[dict[str, Any]] = []
        if callable(getattr(users_repo, "get_all", None)):
            try:
                rows = users_repo.get_all()
                if isinstance(rows, list):
                    users_rows = [dict(row) for row in rows if isinstance(row, dict)]
            except Exception:
                users_rows = []

        target_user = None
        if callable(find_single_non_admin_user_by_username):
            try:
                target_user = find_single_non_admin_user_by_username(users_rows, username)
            except Exception:
                target_user = None
        if not isinstance(target_user, dict) and callable(getattr(users_repo, "get_by_username", None)):
            try:
                target_user = users_repo.get_by_username(username)
            except Exception:
                target_user = None
        if not isinstance(target_user, dict):
            return _build_forgot_redirect("bad_secret", username, contact)

        stored_contact = _normalize_contact_value(target_user.get("contact", ""))
        expected_hash = str(target_user.get("recovery_secret_hash", "") or "").strip()
        if not stored_contact or stored_contact != normalized_contact:
            return _build_forgot_redirect("bad_secret", username, contact)
        if not expected_hash or _hash_recovery_secret_value(recovery_secret) != expected_hash:
            return _build_forgot_redirect("bad_secret", username, contact)

        _set_password_reset_session(request, target_user, contact=normalized_contact)
        return RedirectResponse("/acces/definir-mot-de-passe", status_code=303)

    return router
