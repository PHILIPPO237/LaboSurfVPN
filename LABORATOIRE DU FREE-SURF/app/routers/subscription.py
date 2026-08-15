from __future__ import annotations

import re
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from app.core.passwords import build_password_context


_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
_ALLOWED_KINDS = {"upgrade", "renewal"}
_ALLOWED_TARGET_PLANS = {"VIP", "Revendeur", "PREMIUM"}
_ALLOWED_DURATIONS = {7, 30, 90, 365}

# Initialisation du contexte de hachage (bcrypt)
pwd_context = build_password_context(schemes=["bcrypt"], deprecated="auto")


def _safe_next(value: str, safe_next_url: Callable[[str], str] | None) -> str:
    text = str(value or "").strip()
    if callable(safe_next_url):
        try:
            return str(safe_next_url(text) or "/dashboard")
        except Exception:
            pass
    if not text.startswith("/") or text.startswith("//"):
        return "/dashboard"
    return text[:500] or "/dashboard"



def _valid_contact(value: str, validate_contact: Callable[[str], bool] | None) -> bool:
    text = str(value or "").strip()
    if len(text) < 3 or len(text) > 120:
        return False
    if callable(validate_contact):
        try:
            if validate_contact(text):
                return True
        except Exception:
            pass
    return True


def create_subscription_router(
    *,
    db: Any,
    safe_next_url: Callable[[str], str] | None = None,
    normalize_license: Callable[[str], str] | None = None,
    validate_contact: Callable[[str], bool] | None = None,
    now_ts: Callable[[], str] | None = None,
    get_current_user: Callable[[Request], dict | None] | None = None,
    find_single_non_admin_user_by_identity: Callable[[list[dict], str, str], dict | None] | None = None,
) -> APIRouter:
    router = APIRouter()
    users_repo = getattr(db, "users", None)
    service_requests_repo = getattr(db, "service_requests", None)

    def _now_text() -> str:
        if callable(now_ts):
            try:
                return str(now_ts())
            except Exception:
                pass
        return ""

    def _normalize_license_value(raw: str) -> str:
        text = str(raw or "").strip()
        if callable(normalize_license):
            try:
                return str(normalize_license(text) or "")
            except Exception:
                pass
        return text.upper().replace(" ", "")

    def _load_users() -> list[dict]:
        if not callable(getattr(users_repo, "get_all", None)):
            return []
        try:
            rows = users_repo.get_all()
        except Exception:
            return []
        if not isinstance(rows, list):
            return []
        return [dict(row) for row in rows if isinstance(row, dict)]

    def _resolve_target_user(username: str, password: str, *, license_key: str = "") -> dict[str, Any] | None:
        rows = _load_users()
        normalized_license = _normalize_license_value(license_key)
        uname = str(username or "").strip().lower()
        for row in rows:
            if str(row.get("type", "") or "").strip() == "ADMIN":
                continue
            if str(row.get("username", "") or "").strip().lower() != uname:
                continue
            if normalized_license and _normalize_license_value(str(row.get("license", "") or "")) != normalized_license:
                continue

            pwd_hash = str(row.get("password_hash", "") or "").strip()
            if pwd_hash:
                try:
                    if pwd_context.verify(password, pwd_hash):
                        return dict(row)
                except Exception:
                    pass
        return None

    def _redirect(err: str, *, tab: str, username: str) -> RedirectResponse:
        query = urlencode(
            {
                "err": str(err or "").strip(),
                "tab": str(tab or "upgrade").strip() or "upgrade",
                "username": str(username or "").strip()[:64],
            }
        )
        return RedirectResponse(f"/abonnement?{query}", status_code=303)

    @router.post("/abonnement")
    async def subscription_submit(request: Request):
        form = await request.form()
        kind = str(form.get("kind", "") or "").strip().lower()
        username = str(form.get("username", "") or "").strip()
        password = str(form.get("password", "") or "").strip()
        license_key = str(form.get("license", "") or "").strip()
        contact = str(form.get("contact", "") or "").strip()
        message = str(form.get("message", "") or "").strip()
        tab = "renewal" if kind == "renewal" else "upgrade"

        if kind not in _ALLOWED_KINDS:
            return _redirect("bad_kind", tab=tab, username=username)
        if not _USERNAME_RE.fullmatch(username):
            return _redirect("bad_username", tab=tab, username=username)
        if not password:
            return _redirect("bad_password", tab=tab, username=username)
        if kind == "renewal" and not _normalize_license_value(license_key):
            return _redirect("bad_license", tab=tab, username=username)
        if not _valid_contact(contact, validate_contact):
            return _redirect("bad_contact", tab=tab, username=username)
        if len(message) > 600:
            return _redirect("message_too_long", tab=tab, username=username)

        target_user = _resolve_target_user(username, password, license_key=license_key if kind == "renewal" else "")
        if not isinstance(target_user, dict):
            if kind == "renewal" and _normalize_license_value(license_key):
                return _redirect("bad_license", tab=tab, username=username)
            return _redirect("bad_password", tab=tab, username=username)
        if service_requests_repo is None or not callable(getattr(service_requests_repo, "add", None)):
            return _redirect("server", tab=tab, username=username)

        payload = {
            "kind": kind,
            "status": "pending",
            "username": str(target_user.get("username", username) or username),
            "target_user_id": int(target_user.get("id", 0) or 0),
            "submitted_by_user_id": 0,
            "contact": contact,
            "message": message,
            "license": _normalize_license_value(license_key) if kind == "renewal" else "",
            "created_at": _now_text(),
        }

        if callable(get_current_user):
            try:
                current_user = get_current_user(request)
            except Exception:
                current_user = None
            if isinstance(current_user, dict):
                payload["submitted_by_user_id"] = int(current_user.get("id", 0) or 0)

        if kind == "upgrade":
            target_plan = str(form.get("target_plan", "") or "").strip()
            if target_plan not in _ALLOWED_TARGET_PLANS:
                return _redirect("bad_plan", tab=tab, username=username)
            payload["target_plan"] = target_plan
        else:
            try:
                duration_days = int(str(form.get("duration_days", "") or "0"))
            except Exception:
                duration_days = 0
            if duration_days not in _ALLOWED_DURATIONS:
                return _redirect("bad_duration", tab=tab, username=username)
            payload["duration_days"] = duration_days

        service_requests_repo.add(payload)
        ok_query = urlencode(
            {
                "ok": "1",
                "tab": tab,
                "username": str(username or "").strip()[:64],
            }
        )
        return RedirectResponse(f"/abonnement?{ok_query}", status_code=303)

    return router
