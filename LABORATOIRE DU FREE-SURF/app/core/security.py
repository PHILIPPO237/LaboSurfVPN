from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.core.access import has_root_access, is_admin_role, normalize_user_access_fields, user_has_permission
from app.core.permissions import PermissionEvaluator, has_permission


class Security:
    _CAPTCHA_FAIL_LIMIT = 10
    _CAPTCHA_BAN_SECONDS = 600

    def __init__(
        self,
        *,
        cfg: Any,
        db: Any,
        now_ts: Callable[[], str],
        safe_next_url: Callable[[str], str],
        is_user_expired: Callable[[dict], bool],
    ) -> None:
        self.cfg = cfg
        self.db = db
        self.now_ts = now_ts
        self.safe_next_url = safe_next_url
        self.is_user_expired = is_user_expired
        self._login_attempts: dict[str, list[float]] = {}
        self._last_login_cleanup = time.time()
        self._csrf_secret = (os.getenv("FS_CSRF_SECRET") or cfg._VIP_COOKIE_SECRET or "dev-csrf-secret").encode("utf-8")
        self._captcha_secret = (os.getenv("FS_CAPTCHA_SECRET") or cfg._VIP_COOKIE_SECRET or "dev-captcha-secret").encode("utf-8")
        self._captcha_token_ttl = max(60, int(getattr(cfg, "CAPTCHA_TOKEN_TTL_SECONDS", 300) or 300))

    def generate_math_captcha(self) -> tuple[str, str]:
        a = secrets.randbelow(9) + 1
        b = secrets.randbelow(9) + 1
        if secrets.randbelow(2) == 0:
            return f"{a} + {b} = ?", str(a + b)
        hi = max(a, b)
        lo = min(a, b)
        return f"{hi} - {lo} = ?", str(hi - lo)

    def sign_captcha_answer(self, answer: str) -> str:
        text = str(answer or "").strip()
        nonce = secrets.token_urlsafe(12)
        issued_at = str(int(time.time()))
        payload = f"{nonce}:{issued_at}:{text}".encode("utf-8")
        digest = hmac.new(self._captcha_secret, payload, hashlib.sha256).hexdigest()
        return f"{nonce}:{issued_at}:{digest}"

    def verify_captcha_answer(self, signed_value: str | None, user_answer: str) -> bool:
        token = str(signed_value or "").strip()
        parts = token.split(":")
        if len(parts) != 3:
            return False
        nonce, issued_at_text, sig = parts
        try:
            issued_at = int(issued_at_text)
        except Exception:
            return False
        if issued_at <= 0 or time.time() - issued_at > self._captcha_token_ttl:
            return False
        answer = str(user_answer or "").strip()
        expected = hmac.new(
            self._captcha_secret,
            f"{nonce}:{issued_at_text}:{answer}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(sig, expected)

    def check_login_rate_limit(self, client_ip: str) -> bool:
        now = time.time()
        ip = str(client_ip or "unknown").strip() or "unknown"
        window = max(1, int(self.cfg._LOGIN_RATE_WINDOW))
        max_calls = max(1, int(self.cfg._LOGIN_RATE_MAX))
        
        # --- Nettoyage périodique (Garbage Collection) ---
        if now - getattr(self, "_last_login_cleanup", 0) > 300:
            stale_ips = []
            for known_ip, hist in self._login_attempts.items():
                recent = [ts for ts in hist if now - ts <= window]
                if not recent:
                    stale_ips.append(known_ip)
                else:
                    self._login_attempts[known_ip] = recent
            for stale_ip in stale_ips:
                del self._login_attempts[stale_ip]
            self._last_login_cleanup = now

        history = [ts for ts in self._login_attempts.get(ip, []) if now - ts <= window]
        if len(history) >= max_calls:
            self._login_attempts[ip] = history
            return False
        history.append(now)
        self._login_attempts[ip] = history
        return True

    def check_captcha_ban(self, client_ip: str) -> bool:
        ip = str(client_ip or "unknown").strip() or "unknown"
        rec = self.db.security.get(ip)
        if not rec:
            return True
        try:
            banned_until = float(rec.get("banned_until", 0) or 0)
        except Exception:
            banned_until = 0.0
        return banned_until <= time.time()

    def register_captcha_failure(self, client_ip: str) -> None:
        ip = str(client_ip or "unknown").strip() or "unknown"
        rec = self.db.security.get(ip) or {}
        fail_count = int(rec.get("fail_count", 0) or 0) + 1
        banned_until = float(rec.get("banned_until", 0) or 0)
        if fail_count >= self._CAPTCHA_FAIL_LIMIT:
            banned_until = max(time.time() + self._CAPTCHA_BAN_SECONDS, banned_until)
        self.db.security.upsert(ip, fail_count, banned_until)

    def _csrf_token_from_seed(self, seed: str) -> str:
        return hmac.new(self._csrf_secret, seed.encode("utf-8"), hashlib.sha256).hexdigest()

    def prepare_csrf_token_for_render(self, request: Request) -> tuple[str, str]:
        seed = str(request.cookies.get(self.cfg.CSRF_COOKIE, "") or "").strip()
        if not seed or len(seed) < 16:
            seed = secrets.token_urlsafe(24)
        return self._csrf_token_from_seed(seed), seed

    def maybe_set_csrf_cookie(self, response: Any, seed: str) -> None:
        response.set_cookie(
            key=self.cfg.CSRF_COOKIE,
            value=str(seed or ""),
            httponly=True,
            max_age=86400 * 30,
            samesite="Lax",
            secure=self.cfg._COOKIE_SECURE,
        )

    def verify_csrf(self, request: Request, form_data: dict) -> bool:
        submitted_values = form_data.get("csrf_token", [""])
        submitted = str(submitted_values[0] if isinstance(submitted_values, list) else submitted_values).strip()
        if not submitted:
            return False
        seed = str(request.cookies.get(self.cfg.CSRF_COOKIE, "") or "").strip()
        if not seed:
            return False
        expected = self._csrf_token_from_seed(seed)
        return hmac.compare_digest(submitted, expected)

    def create_session(self, user: dict) -> str:
        """Crée une session avec un token sécurisé et stocke uniquement son empreinte (hash)."""
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        user_id = int(user.get("id", 0) or 0)
        username = str(user.get("username", "") or "").strip()
        session_ttl = int(getattr(self.cfg, "SESSION_TTL_SECONDS", 86400) or 86400)
        expires_at = time.time() + session_ttl
        
        if hasattr(self.db.sessions, "delete_for_user"):
            self.db.sessions.delete_for_user(user_id)
            
        self.db.sessions.set(token_hash, user_id, username, expires_at)
        return token

    def destroy_session(self, token: str) -> None:
        """Détruit une session à partir du token en clair (en vérifiant l'empreinte)."""
        if not token:
            return
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        if hasattr(self.db.sessions, "delete"):
            self.db.sessions.delete(token_hash)

    def _decorate_current_user(self, user: dict | None) -> dict | None:
        if not isinstance(user, dict):
            return None
        decorated = normalize_user_access_fields(dict(user))
        evaluator = PermissionEvaluator(self.db)
        try:
            decorated["effective_permissions"] = sorted(evaluator.evaluate(decorated, time.time()))
        except Exception:
            decorated.setdefault("effective_permissions", sorted(user.get("effective_permissions", []) or []))
        if has_root_access(decorated):
            decorated["status"] = "active"
            decorated["expiration"] = ""
            decorated["quota_gb"] = None
        return decorated

    def _is_admin_actor(self, user: dict | None) -> bool:
        if not isinstance(user, dict):
            return False
        if has_root_access(user) or is_admin_role(user):
            return True
        return user_has_permission(user, "panel.admin.view") or user_has_permission(user, "admin.access")

    def get_current_user(self, request: Request) -> dict | None:
        token = str(request.cookies.get(self.cfg.SESSION_COOKIE, "") or "").strip()
        if not token:
            # Repli sur l'en-tete Authorization: Bearer <token>, pour les clients
            # externes qui ne peuvent pas recevoir/renvoyer de cookie cross-site
            # (ex : l'app compagnon Labo Surf, PWA sur un autre domaine).
            auth_header = str(request.headers.get("authorization", "") or "").strip()
            if auth_header.lower().startswith("bearer "):
                token = auth_header[7:].strip()
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        sess = self.db.sessions.get(token_hash)
        if not sess:
            return None
        user = self.db.users.get_by_id(int(sess.get("user_id", 0) or 0))
        if not user:
            self.db.sessions.delete(token_hash)
            return None
        return self._decorate_current_user(user)

    def active_session_user_ids(self) -> set[int]:
        return self.db.sessions.get_active_user_ids()

    def require_access(self, request: Request, allowed_types: set[str], *, next_url: str = "/dashboard", need: str = ""):
        user = self.get_current_user(request)
        if not user:
            qs = urlencode({"next": self.safe_next_url(next_url), "need": str(need or "").strip()})
            return RedirectResponse(f"/acces?{qs}", 303)

        user_type = str(user.get("type", "")).strip()
        status = str(user.get("status", "active") or "active").strip().lower()
        root_actor = has_root_access(user)
        admin_actor = self._is_admin_actor(user)
        if not root_actor and status not in ("active", "configuring"):
            qs = urlencode({"err": "blocked", "next": self.safe_next_url(next_url), "need": str(need or "").strip()})
            return RedirectResponse(f"/acces?{qs}", 303)

        if not root_actor and not admin_actor and self.is_user_expired(user):
            qs = urlencode({"err": "expired", "next": self.safe_next_url(next_url), "need": str(need or "").strip()})
            return RedirectResponse(f"/acces?{qs}", 303)

        if allowed_types and user_type not in allowed_types and not admin_actor and not root_actor:
            user["forbidden_attempts"] = int(user.get("forbidden_attempts", 0) or 0) + 1
            user["last_forbidden_need"] = str(need or "").strip()
            user["last_forbidden_at"] = self.now_ts()
            user["updated_at"] = self.now_ts()
            self.db.users.save(user)
            qs = urlencode({"err": "forbidden", "next": self.safe_next_url(next_url), "need": str(need or "").strip()})
            return RedirectResponse(f"/acces?{qs}", 303)

        return user

    def require_permission(self, request: Request, permission: str, *, next_url: str = "/dashboard"):
        user = self.get_current_user(request)
        if not user:
            qs = urlencode({"next": self.safe_next_url(next_url), "need": permission})
            return RedirectResponse(f"/acces?{qs}", 303)

        status = str(user.get("status", "active") or "active").strip().lower()
        root_actor = has_root_access(user)
        admin_actor = self._is_admin_actor(user)
        if not root_actor and status not in ("active", "configuring"):
            qs = urlencode({"err": "blocked", "next": self.safe_next_url(next_url), "need": permission})
            return RedirectResponse(f"/acces?{qs}", 303)

        if not root_actor and not admin_actor and self.is_user_expired(user):
            qs = urlencode({"err": "expired", "next": self.safe_next_url(next_url), "need": permission})
            return RedirectResponse(f"/acces?{qs}", 303)

        evaluator = PermissionEvaluator(self.db)
        if not has_permission(user, permission, evaluator, time.time()):
            user["forbidden_attempts"] = int(user.get("forbidden_attempts", 0) or 0) + 1
            user["last_forbidden_need"] = permission
            user["last_forbidden_at"] = self.now_ts()
            user["updated_at"] = self.now_ts()
            self.db.users.save(user)
            qs = urlencode({"err": "forbidden", "next": self.safe_next_url(next_url), "need": permission})
            return RedirectResponse(f"/acces?{qs}", 303)

        return user

    def require_api_permission(self, request: Request, permission: str):
        user = self.get_current_user(request)
        if not user:
            return JSONResponse({"status": "error", "message": "Non authentifie"}, status_code=401)
        
        evaluator = PermissionEvaluator(self.db)
        if not has_permission(user, permission, evaluator, time.time()):
            return JSONResponse({"status": "error", "message": f"Permission requise : {permission}"}, status_code=403)
            
        return user

    def require_admin_api(self, request: Request):
        user = self.get_current_user(request)
        if not user or not self._is_admin_actor(user):
            return JSONResponse({"status": "error", "message": "Interdit"}, status_code=403)
        return user

    def require_root_admin_api(self, request: Request):
        user = self.get_current_user(request)
        if not user or not self._is_admin_actor(user):
            return JSONResponse({"status": "error", "message": "Interdit"}, status_code=403)
        if not has_root_access(user):
            return JSONResponse({"status": "error", "message": "Acces root requis"}, status_code=403)
        return user


def create_security(
    *,
    cfg: Any,
    db: Any,
    now_ts: Callable[[], str],
    safe_next_url: Callable[[str], str],
    is_user_expired: Callable[[dict], bool],
) -> Security:
    return Security(
        cfg=cfg,
        db=db,
        now_ts=now_ts,
        safe_next_url=safe_next_url,
        is_user_expired=is_user_expired,
    )
