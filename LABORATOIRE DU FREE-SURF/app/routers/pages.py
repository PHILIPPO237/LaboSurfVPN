from __future__ import annotations

import html
import re
from datetime import date, timedelta
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core.access import canonicalize_legacy_user_type, normalize_user_access_fields, resolve_home_path, user_has_permission


_ALLOWED_AUTH_TYPES = {"Gratuit", "VIP", "Revendeur", "PREMIUM", "ADMIN"}


def _as_redirect_response(value: Any) -> RedirectResponse | None:
    if isinstance(value, RedirectResponse):
        return value
    return None


def _user_panel_key(user: dict[str, Any] | None) -> str:
    if not isinstance(user, dict):
        return "free"
    user_type = str(user.get("type", "") or "").strip()
    if user_type == "ADMIN":
        return "admin"
    if user_type == "Revendeur":
        return "reseller"
    if user_type in {"VIP", "PREMIUM"}:
        return "premium"
    return "free"


def _quota_label(raw: Any) -> str:
    text = str(raw if raw is not None else "").strip()
    if not text:
        return "Illimite"
    return f"{text} GB"


def _date_label(raw: Any) -> str:
    text = str(raw or "").strip()
    return text or "Illimite"


def create_pages_router(
    *,
    require_access: Callable[..., Any],
    templates: Any | None = None,
    cfg: Any = None,
    db: Any = None,
    get_current_user: Callable[[Request], dict | None] | None = None,
    safe_next_url: Callable[[str], str] | None = None,
    template_or_error: Callable[[str], Any] | None = None,
    render_panel_template: Callable[[str, dict[str, Any]], Any] | None = None,
    read_template: Callable[[str], str | None] | None = None,
    html_response: Callable[[str, int], Any] | None = None,
    safe_avatar_url: Callable[[Any], str] | None = None,
    prepare_csrf_token_for_render: Callable[[Request], tuple[str, str]] | None = None,
    maybe_set_csrf_cookie: Callable[[Any, str], None] | None = None,
    generate_math_captcha: Callable[[], tuple[str, str]] | None = None,
    sign_captcha_answer: Callable[[str], str] | None = None,
) -> APIRouter:
    router = APIRouter()

    def _render_response(content: str, status_code: int = 200):
        if callable(html_response):
            return html_response(content, status_code)
        return HTMLResponse(content=content, status_code=status_code)

    def _public_link_context() -> dict[str, Any]:
        app_host = str(getattr(cfg, "WEB_PUBLIC_HOST", "") or "").strip()
        app_url = str(getattr(cfg, "WEB_PUBLIC_URL", "") or "").strip()
        panel_admin_host = str(getattr(cfg, "PANEL_ADMIN_HOST", "") or "").strip()
        panel_admin_url = f"https://{panel_admin_host}" if panel_admin_host else ""
        return {
            "APP_PUBLIC_HOST": app_host,
            "APP_PUBLIC_URL": app_url,
            "WEB_PUBLIC_HOST": app_host,
            "WEB_PUBLIC_URL": app_url,
            "PANEL_ADMIN_HOST": panel_admin_host,
            "PANEL_ADMIN_URL": panel_admin_url,
        }

    def _render_text_template(name: str, context: dict[str, Any] | None = None):
        content = read_template(name) if callable(read_template) else None
        if content is None:
            if callable(template_or_error):
                return template_or_error(name)
            return _render_response(f"<h1>Erreur: {html.escape(name)} manquant</h1>", 404)
        merged_context = _public_link_context()
        merged_context.update(context or {})
        rendered = str(content)
        for key, value in merged_context.items():
            rendered = re.sub(r"{{\s*" + re.escape(str(key)) + r"\s*}}", str(value), rendered)
        return _render_response(rendered, 200)

    def _template_response(name: str, request: Request, **context: Any):
        merged_context = _public_link_context()
        merged_context.update(context)
        if templates is not None and callable(getattr(templates, "TemplateResponse", None)):
            payload = {"request": request}
            payload.update(merged_context)
            return templates.TemplateResponse(name, payload)
        return _render_text_template(name, merged_context)

    def _safe_next_target(value: Any, fallback: str = "/dashboard") -> str:
        raw = str(value or "").strip()
        if not raw.startswith("/") or raw.startswith("//"):
            raw = fallback
        elif callable(safe_next_url):
            try:
                raw = str(safe_next_url(raw) or fallback)
            except Exception:
                raw = fallback
        if not raw.startswith("/") or raw.startswith("//"):
            raw = fallback
        blocked_targets = {"", "/", "/acces", "/inscription", "/logout", "/api/captcha/refresh"}
        if raw in blocked_targets:
            return fallback
        return raw[:500] or fallback

    def _mark_no_store(response: Any) -> Any:
        try:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        except Exception:
            pass
        return response

    def _menu_attr(visible: bool) -> str:
        return "" if visible else "hidden data-menu-hidden=1"

    def _grace_period_days_for(user_type: str) -> int:
        normalized = str(user_type or "").strip()
        if normalized == "Revendeur":
            return max(1, int(getattr(cfg, "SUBSCRIPTION_GRACE_PERIOD_RESELLER_DAYS", 7) or 7))
        if normalized in {"VIP", "PREMIUM"}:
            return max(1, int(getattr(cfg, "SUBSCRIPTION_GRACE_PERIOD_CLIENT_DAYS", 3) or 3))
        return max(1, int(getattr(cfg, "SUBSCRIPTION_GRACE_PERIOD_DAYS", 5) or 5))

    def _gauge_gradient_color(percent: int) -> str:
        """Degrade continu rouge -> or -> vert selon le pourcentage (pas de palier brusque)."""
        percent = max(0, min(100, percent))
        red = (255, 79, 79)
        gold = (255, 215, 0)
        green = (57, 255, 20)
        if percent >= 50:
            ratio = (percent - 50) / 50.0
            start, end = gold, green
        else:
            ratio = percent / 50.0
            start, end = red, gold
        r = round(start[0] + (end[0] - start[0]) * ratio)
        g = round(start[1] + (end[1] - start[1]) * ratio)
        b = round(start[2] + (end[2] - start[2]) * ratio)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _compute_subscription_gauge(user: dict[str, Any]) -> dict[str, Any]:
        """Calcule l'etat de la jauge d'abonnement : pourcentage, couleur (degrade
        continu), libelle. Renvoie show=False si non applicable (Gratuit, Admin,
        pas d'expiration)."""
        empty = {"show": False, "percent": 0, "color": "#39ff14", "label": "", "warning": ""}
        user_type = str(user.get("type", "") or "").strip()
        if user_type in {"ADMIN", "Gratuit", ""}:
            return empty
        expiration_raw = str(user.get("expiration", "") or "").strip()
        if not expiration_raw:
            return empty
        try:
            expiration_date = date.fromisoformat(expiration_raw)
        except Exception:
            return empty

        grace_days = _grace_period_days_for(user_type)
        today = date.today()
        days_until_expiration = (expiration_date - today).days
        days_remaining = days_until_expiration + grace_days

        if days_remaining > grace_days:
            percent = 100
        elif days_remaining <= 0:
            percent = 0
        else:
            percent = round((days_remaining / grace_days) * 100)
        percent = max(0, min(100, percent))
        color = _gauge_gradient_color(percent)

        warning = ""
        if days_until_expiration >= 0:
            label = f"{percent}% — {days_until_expiration} jour(s) avant expiration"
        elif days_remaining > 0:
            label = f"{percent}% — Expiré, {days_remaining} jour(s) avant retrogradation"
            warning = (
                f"Votre abonnement a expiré. Renouvelez sous {days_remaining} jour(s), "
                "sinon votre compte repassera automatiquement en Gratuit."
            )
        else:
            label = "0% — Expire"

        return {"show": True, "percent": percent, "color": color, "label": label, "warning": warning}

    def _compute_subscription_warning(user: dict[str, Any]) -> str:
        return _compute_subscription_gauge(user).get("warning", "")

    def _dashboard_context(user: dict[str, Any]) -> dict[str, Any]:
        normalized = normalize_user_access_fields(user)
        can_free = user_has_permission(normalized, "panel.free.view")
        can_vip = user_has_permission(normalized, "panel.premium.view")
        can_reseller = user_has_permission(normalized, "panel.reseller.view")
        can_admin = user_has_permission(normalized, "panel.admin.view")
        can_profile = user_has_permission(normalized, "account.self.view")
        can_chat = user_has_permission(normalized, "messages.view")
        return {
            "SUBSCRIPTION_WARNING": _compute_subscription_warning(user),
            "SUBSCRIPTION_GAUGE": _compute_subscription_gauge(user),
            "DASH_EXPLORER_FREE_ATTR": _menu_attr(can_free),
            "DASH_EXPLORER_VIP_ATTR": _menu_attr(can_vip),
            "DASH_EXPLORER_RESELLER_ATTR": _menu_attr(can_reseller),
            "DASH_EXPLORER_ADMIN_ATTR": _menu_attr(can_admin),
            "DASH_EXPLORER_ADMIN_SECTION_ATTR": _menu_attr(can_admin),
            "DASH_TECH_PANEL_ATTR": _menu_attr(can_admin),
            "DASH_PANEL_FREE_ATTR": _menu_attr(can_free),
            "DASH_PANEL_VIP_ATTR": _menu_attr(can_vip),
            "DASH_PANEL_RESELLER_ATTR": _menu_attr(can_reseller),
            "DASH_PANEL_ADMIN_ATTR": _menu_attr(can_admin),
            "DASH_PANEL_CHAT_ATTR": _menu_attr(can_chat),
            "DASH_QUICK_PROFILE_ATTR": _menu_attr(can_profile),
            "DASH_QUICK_CHAT_ATTR": _menu_attr(can_chat),
            "DASH_COLOR_FREE_ATTR": _menu_attr(can_free),
            "DASH_COLOR_VIP_ATTR": _menu_attr(can_vip),
            "DASH_COLOR_RESELLER_ATTR": _menu_attr(can_reseller),
            "DASH_COLOR_ADMIN_ATTR": _menu_attr(can_admin),
            "DASH_COLOR_CHAT_ATTR": _menu_attr(can_chat),
        }
    def _panel_response(name: str, request: Request, user: dict[str, Any]):
        if callable(render_panel_template):
            try:
                return render_panel_template(name, user)
            except Exception:
                pass
        context = {
            "USERNAME": str(user.get("username", "") or ""),
            "TYPE": str(user.get("type", "") or ""),
            "SUBSCRIPTION_WARNING": _compute_subscription_warning(user),
            "SUBSCRIPTION_GAUGE": _compute_subscription_gauge(user),
        }
        return _template_response(name, request, **context)

    def _guard_user(request: Request, *, next_url: str, need: str, allowed_types: set[str]) -> tuple[dict[str, Any], Any | None]:
        check = require_access(request, allowed_types, next_url=next_url, need=need)
        denied = _as_redirect_response(check)
        if denied is not None:
            return {}, denied
        if isinstance(check, dict):
            return dict(check), None
        if callable(get_current_user):
            user = get_current_user(request)
            if isinstance(user, dict):
                return dict(user), None
        return {}, None

    def _profile_replacements(user: dict[str, Any]) -> dict[str, Any]:
        avatar = str(user.get("avatar", "") or "")
        if callable(safe_avatar_url):
            try:
                avatar = safe_avatar_url(avatar)
            except Exception:
                pass
        return {
            "AVATAR_URL": avatar,
            "USERNAME": str(user.get("username", "") or ""),
            "TYPE": str(user.get("type", "") or ""),
            "STATUS": str(user.get("status", "active") or "active"),
            "QUOTA": _quota_label(user.get("quota_gb")),
            "EXPIRATION": _date_label(user.get("expiration")),
            "CREATED_AT": _date_label(user.get("created_at")),
            "LICENSE": str(user.get("license", "") or ""),
            "UUID_SECONDARY": str(user.get("uuid_secondary", "") or ""),
            "NOTES": str(user.get("notes", "") or "-"),
        }

    def _has_pending_password_reset(request: Request) -> bool:
        session = getattr(request, "session", None)
        if not isinstance(session, dict):
            return False
        payload = session.get("password_reset")
        if isinstance(payload, dict) and str(payload.get("username", "") or "").strip():
            return True
        return bool(str(session.get("migration_username", "") or "").strip())

    @router.get("/")
    async def root_page(request: Request):
        return _template_response("index.html", request)

    @router.get("/avant-propos")
    async def avant_propos_page(request: Request):
        return _template_response("avant-propos.html", request)

    @router.get("/construction")
    async def construction_page(request: Request):
        return _template_response("construction.html", request)

    @router.get("/splash")
    async def splash_page(request: Request):
        return _template_response("splash.html", request)

    @router.get("/onboarding")
    async def onboarding_page(request: Request):
        username = str(request.query_params.get("name", "") or "").strip()
        return _template_response("onboarding.html", request, username=username)

    @router.get("/acces")
    async def access_page(request: Request):
        err = str(request.query_params.get("err", "") or "").strip()
        need = str(request.query_params.get("need", "") or "").strip()
        success = str(request.query_params.get("success", "") or "").strip()
        requested_next = str(request.query_params.get("next", "") or "").strip()
        if callable(get_current_user):
            try:
                current_user = get_current_user(request)
            except Exception:
                current_user = None
            if isinstance(current_user, dict) and not err and not need and not success:
                home_target = resolve_home_path(current_user)
                return _mark_no_store(RedirectResponse(_safe_next_target(requested_next, home_target), status_code=303))
        csrf_token = ""
        csrf_seed = ""
        if callable(prepare_csrf_token_for_render):
            try:
                csrf_token, csrf_seed = prepare_csrf_token_for_render(request)
            except Exception:
                pass
        response = _mark_no_store(_template_response("access.html", request, csrf_token=csrf_token))
        if csrf_seed and callable(maybe_set_csrf_cookie):
            try:
                maybe_set_csrf_cookie(response, csrf_seed)
            except Exception:
                pass
        return response
    @router.get("/acces/licence-oubliee")
    async def forgot_password_legacy_page(request: Request):
        query = str(request.url.query or "").strip()
        target = "/acces/mot-de-passe-oublie"
        if query:
            target = f"{target}?{query}"
        return _mark_no_store(RedirectResponse(target, status_code=303))

    @router.get("/acces/mot-de-passe-oublie")
    async def forgot_password_page(request: Request):
        csrf_token = ""
        csrf_seed = ""
        if callable(prepare_csrf_token_for_render):
            try:
                csrf_token, csrf_seed = prepare_csrf_token_for_render(request)
            except Exception:
                pass
        response = _mark_no_store(
            _template_response(
                "forgot-license.html",
                request,
                csrf_token=csrf_token,
                prefill_username=str(request.query_params.get("username", "") or "").strip(),
                prefill_contact=str(request.query_params.get("contact", "") or "").strip(),
                forgot_message=str(request.query_params.get("message", "") or "").strip(),
            )
        )
        if csrf_seed and callable(maybe_set_csrf_cookie):
            try:
                maybe_set_csrf_cookie(response, csrf_seed)
            except Exception:
                pass
        return response

    @router.get("/acces/definir-mot-de-passe")
    async def define_password_page(request: Request):
        if not _has_pending_password_reset(request):
            return _mark_no_store(RedirectResponse("/acces/mot-de-passe-oublie?err=expired", status_code=303))
        csrf_token = ""
        csrf_seed = ""
        if callable(prepare_csrf_token_for_render):
            try:
                csrf_token, csrf_seed = prepare_csrf_token_for_render(request)
            except Exception:
                pass
        response = _mark_no_store(_template_response("reset-password.html", request, csrf_token=csrf_token))
        if csrf_seed and callable(maybe_set_csrf_cookie):
            try:
                maybe_set_csrf_cookie(response, csrf_seed)
            except Exception:
                pass
        return response

    @router.post("/api/promo-codes/redeem")
    async def redeem_promo_code(request: Request):
        user = get_current_user(request) if callable(get_current_user) else None
        if not isinstance(user, dict):
            return JSONResponse({"status": "error", "message": "Connectez-vous pour utiliser un code."}, status_code=401)

        promo_repo = getattr(db, "promo_codes", None)
        users_repo = getattr(db, "users", None)
        if promo_repo is None or users_repo is None:
            return JSONResponse({"status": "error", "message": "Service indisponible."}, status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        code = str((body or {}).get("code", "") or "").strip()
        if not code:
            return JSONResponse({"status": "error", "message": "Code requis."}, status_code=400)

        promo = promo_repo.get_by_code(code)
        if not isinstance(promo, dict):
            return JSONResponse({"status": "error", "message": "Code promo invalide."}, status_code=404)
        if not bool(promo.get("active")):
            return JSONResponse({"status": "error", "message": "Ce code promo n'est plus actif."}, status_code=400)

        expires_at_raw = str(promo.get("expires_at", "") or "").strip()
        if expires_at_raw:
            try:
                if date.fromisoformat(expires_at_raw) < date.today():
                    return JSONResponse({"status": "error", "message": "Ce code promo a expire."}, status_code=400)
            except Exception:
                pass

        times_used = int(promo.get("times_used", 0) or 0)
        max_uses = int(promo.get("max_uses", 1) or 1)
        if times_used >= max_uses:
            return JSONResponse({"status": "error", "message": "Ce code promo a atteint sa limite d'utilisation."}, status_code=400)

        user_id = int(user.get("id", 0) or 0)
        if promo_repo.has_user_redeemed(promo["id"], user_id):
            return JSONResponse({"status": "error", "message": "Vous avez deja utilise ce code promo."}, status_code=409)

        bonus_days = max(0, int(promo.get("bonus_days", 0) or 0))
        bonus_gb = max(0, int(promo.get("bonus_gb", 0) or 0))

        try:
            promo_repo.redeem(promo["id"], user_id, str(user.get("username", "") or ""))
        except Exception:
            return JSONResponse({"status": "error", "message": "Vous avez deja utilise ce code promo."}, status_code=409)

        target = users_repo.get_by_id(user_id)
        if not isinstance(target, dict):
            return JSONResponse({"status": "error", "message": "Compte introuvable."}, status_code=404)

        updated = dict(target)
        new_expiration = None
        if bonus_days > 0:
            today = date.today()
            current_expiration = str(target.get("expiration", "") or "").strip()
            try:
                base_date = date.fromisoformat(current_expiration) if current_expiration else today
            except Exception:
                base_date = today
            if base_date < today:
                base_date = today
            new_expiration = base_date + timedelta(days=bonus_days)
            updated["expiration"] = new_expiration.isoformat()

        if bonus_gb > 0:
            current_quota = target.get("quota_gb")
            try:
                current_quota = float(current_quota) if current_quota is not None else 0.0
            except Exception:
                current_quota = 0.0
            updated["quota_gb"] = current_quota + bonus_gb

        users_repo.save(updated)

        parts = []
        if bonus_days > 0:
            parts.append(f"+{bonus_days} jour(s)")
        if bonus_gb > 0:
            parts.append(f"+{bonus_gb} Go")
        return {
            "status": "ok",
            "message": f"Code applique : {' et '.join(parts)} ajoute(s) a votre compte.",
            "bonus_days": bonus_days,
            "bonus_gb": bonus_gb,
            "new_expiration": new_expiration.isoformat() if new_expiration else str(target.get("expiration", "") or ""),
        }

    @router.get("/api/ads/active")
    async def public_active_ads(request: Request, location: str = "dashboard"):
        """Bannieres actives pour cet emplacement. Si l'appelant est connecte
        ET gere par un revendeur qui a personnalise sa propre banniere pour
        cet emplacement, celle-ci prime -- sinon repli sur la banniere par
        defaut (admin), exactement comme avant cette fonctionnalite. Reste
        volontairement accessible sans authentification (banniere visible
        meme avant connexion, ex: ecran d'accueil de l'app)."""
        ads_repo = getattr(db, "ads", None)
        if ads_repo is None:
            return {"status": "ok", "ads": []}

        loc = str(location or "dashboard").strip() or "dashboard"
        reseller_id = 0
        if callable(get_current_user):
            try:
                current_user = get_current_user(request)
                if isinstance(current_user, dict):
                    reseller_id = int(current_user.get("reseller_id", 0) or 0)
            except Exception:
                reseller_id = 0

        try:
            if reseller_id and callable(getattr(ads_repo, "get_active_for_reseller", None)):
                ads = ads_repo.get_active_for_reseller(loc, reseller_id)
            else:
                ads = ads_repo.get_active(loc) if callable(getattr(ads_repo, "get_active", None)) else []
        except Exception:
            ads = []
        # On ne renvoie que ce qui est necessaire a l'affichage cote client
        safe_ads = [
            {
                "id": a.get("id"),
                "text": a.get("text", ""),
                "link": a.get("link", ""),
                "style": a.get("style", "neon"),
                "color": a.get("color", "#39ff14"),
                "image": a.get("image", ""),
            }
            for a in (ads if isinstance(ads, list) else [])
            if isinstance(a, dict)
        ]
        return {"status": "ok", "ads": safe_ads}

    @router.get("/dashboard")
    async def dashboard_page(request: Request):
        user, denied = _guard_user(request, next_url="/dashboard", need="dashboard.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        return _template_response("dashboard.html", request, **_dashboard_context(user))

    @router.get("/panel-gratuit")
    async def panel_free_page(request: Request):
        user, denied = _guard_user(request, next_url="/panel-gratuit", need="panel.free.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        return _panel_response("panel-gratuit.html", request, user)

    @router.get("/panel-vip")
    async def panel_vip_page(request: Request):
        user, denied = _guard_user(request, next_url="/panel-vip", need="panel.premium.view", allowed_types={"VIP", "PREMIUM", "Revendeur", "ADMIN"})
        if denied is not None:
            return denied
        return _panel_response("panel-vip.html", request, user)

    @router.get("/panel-revendeur")
    async def panel_revendeur_page(request: Request):
        user, denied = _guard_user(request, next_url="/panel-revendeur", need="panel.reseller.view", allowed_types={"Revendeur", "ADMIN"})
        if denied is not None:
            return denied
        return _panel_response("panel-revendeur.html", request, user)

    @router.get("/profil")
    async def profile_page(request: Request):
        user, denied = _guard_user(request, next_url="/profil", need="account.self.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        return _template_response("profil.html", request, **_profile_replacements(user))

    @router.get("/compte")
    async def account_page(request: Request):
        user, denied = _guard_user(request, next_url="/compte", need="account.self.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        return _template_response("compte.html", request, **_profile_replacements(user))

    @router.get("/compte/activer")
    async def account_activate_page(request: Request):
        _user, denied = _guard_user(request, next_url="/compte/activer", need="account.self.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        return _template_response("compte-activer.html", request)

    @router.get("/abonnement")
    async def subscription_page(request: Request):
        current_user = get_current_user(request) if callable(get_current_user) else None
        if not isinstance(current_user, dict):
            current_user = {}
        prefill_username = str(request.query_params.get("username", "") or "").strip() or str(current_user.get("username", "") or "")
        prefill_license = str(request.query_params.get("license", "") or "").strip() or str(current_user.get("license", "") or "")
        panel_key = _user_panel_key(current_user)
        return _template_response(
            "abonnement.html",
            request,
            PANEL_KEY=panel_key,
            prefill_username=prefill_username,
            prefill_license=prefill_license,
        )

    @router.get("/inscription")
    async def signup_page(request: Request):
        prefill_username = str(request.query_params.get("username", "") or "").strip()
        prefill_contact = str(request.query_params.get("contact", "") or "").strip()
        prefill_recovery_secret = ""
        safe_signup_next = _safe_next_target(request.query_params.get("next", "/panel-gratuit"), "/panel-gratuit")
        csrf_token = ""
        csrf_seed = ""
        if callable(prepare_csrf_token_for_render):
            try:
                csrf_token, csrf_seed = prepare_csrf_token_for_render(request)
            except Exception:
                csrf_token = ""
                csrf_seed = ""
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
        captcha_html = (
            '<div class="px-3 py-2 rounded-xl bg-black/40 border border-white/10 mono text-[12px]">'
            f"{html.escape(question)}"
            '</div>'
            f'<input type="hidden" name="captcha_signed" value="{html.escape(signed_answer)}">'
        )
        response = _template_response(
            "inscription.html",
            request,
            csrf_token=csrf_token,
            prefill_username=prefill_username,
            prefill_contact=prefill_contact,
            prefill_recovery_secret=prefill_recovery_secret,
            captcha_question=captcha_html,
            signup_next_url=safe_signup_next,
        )
        if csrf_seed and callable(maybe_set_csrf_cookie):
            try:
                maybe_set_csrf_cookie(response, csrf_seed)
            except Exception:
                pass
        return response

    @router.get("/tchatch")
    async def chat_page(request: Request):
        _user, denied = _guard_user(request, next_url="/tchatch", need="messages.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        return _template_response("tchatlive.html", request)

    @router.get("/mes-options")
    async def options_page(request: Request):
        user, denied = _guard_user(request, next_url="/mes-options", need="account.self.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        plan_key = canonicalize_legacy_user_type(user.get("type")).lower()
        home_panel_url = resolve_home_path(user) if callable(resolve_home_path) else "/dashboard"

        # Cartes d'options : le plan actuel de l'utilisateur + les etapes suivantes
        # disponibles (upgrade, renouvellement...). Avant ce correctif,
        # OPTIONS_CARDS n'etait jamais fourni -> page vide en pratique.
        cards: list[str] = []
        cards.append(
            f'<div class="option-card"><h3><i class="fas fa-id-badge mr-2"></i>Plan actuel</h3>'
            f'<p>Tu es actuellement sur le plan <strong>{html.escape(str(user.get("type", "Gratuit")))}</strong>.</p></div>'
        )
        if plan_key == "gratuit":
            cards.append(
                '<div class="option-card"><h3><i class="fas fa-arrow-trend-up mr-2"></i>Passer VIP</h3>'
                '<p>Debloque un acces illimite, sans les limites d\'essai du plan Gratuit.</p>'
                '<a href="/abonnement" class="text-[11px] font-bold" style="color:var(--panel-accent,#00f2ff);">Voir les options &rarr;</a></div>'
            )
        cards.append(
            '<div class="option-card"><h3><i class="fas fa-rotate mr-2"></i>Renouveler mon acces</h3>'
            '<p>Prolonge ton abonnement actuel avant qu\'il n\'expire.</p>'
            '<a href="/abonnement" class="text-[11px] font-bold" style="color:var(--panel-accent,#00f2ff);">Faire une demande &rarr;</a></div>'
        )
        cards.append(
            '<div class="option-card"><h3><i class="fas fa-chart-pie mr-2"></i>Ma consommation</h3>'
            '<p>Suis ton quota utilise et ta date d\'expiration en detail.</p>'
            '<a href="/ma-consommation" class="text-[11px] font-bold" style="color:var(--panel-accent,#00f2ff);">Voir le detail &rarr;</a></div>'
        )

        return _template_response(
            "mes-options.html", request,
            USERNAME=str(user.get("username", "") or ""),
            TYPE=str(user.get("type", "") or ""),
            STATUS=str(user.get("status", "") or ""),
            PANEL_KEY=plan_key,
            HOME_PANEL_URL=home_panel_url,
            OPTIONS_CARDS="".join(cards),
        )

    @router.get("/mes-messages")
    async def messages_page(request: Request):
        user, denied = _guard_user(request, next_url="/mes-messages", need="messages.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        home_panel_url = resolve_home_path(user) if callable(resolve_home_path) else "/dashboard"
        return _template_response(
            "mes-messages.html", request,
            USERNAME=str(user.get("username", "") or ""),
            HOME_PANEL_URL=home_panel_url,
        )

    @router.get("/ma-consommation")
    async def consumption_page(request: Request):
        user, denied = _guard_user(request, next_url="/ma-consommation", need="account.self.view", allowed_types=_ALLOWED_AUTH_TYPES)
        if denied is not None:
            return denied
        home_panel_url = resolve_home_path(user) if callable(resolve_home_path) else "/dashboard"

        quota_gb = user.get("quota_gb")
        has_quota = quota_gb is not None and str(quota_gb).strip() != ""
        quota_total_val = float(quota_gb) if has_quota else 0.0
        consumed_val = 0.0  # l'API ne renvoie pas encore la consommation reelle (voir app cote client, meme limite)
        remaining_val = max(0.0, quota_total_val - consumed_val)
        progress_pct = int(round((remaining_val / quota_total_val) * 100)) if quota_total_val > 0 else 100

        expiration_raw = str(user.get("expiration", "") or "").strip()

        return _template_response(
            "ma-consommation.html", request,
            USERNAME=str(user.get("username", "") or ""),
            TYPE=str(user.get("type", "") or ""),
            STATUS=str(user.get("status", "") or ""),
            HOME_PANEL_URL=home_panel_url,
            QUOTA_TOTAL=(f"{quota_total_val:g} Go" if has_quota else "Illimité"),
            CONSUMED=(f"{consumed_val:g} Go" if has_quota else "—"),
            REMAINING=(f"{remaining_val:g} Go" if has_quota else "Illimité"),
            EXPIRATION=(expiration_raw or "Illimitée"),
            PROGRESS_PCT=progress_pct,
            PROGRESS_NOTE=("Suivi detaille de la consommation en cours d'integration." if has_quota else "Ton plan actuel n'a pas de limite de quota."),
            TELEMETRY_NOTE="Les chiffres de consommation reelle seront affines au fur et a mesure du suivi reseau.",
        )

    @router.get("/vip-login")
    async def vip_login_page(request: Request):
        return _template_response("vip-login.html", request)

    @router.get("/payment")
    async def payment_page(request: Request):
        return _template_response("payment.html", request)

    return router







