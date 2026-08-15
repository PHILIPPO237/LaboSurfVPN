import unittest
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.testclient import TestClient
from starlette.middleware.sessions import SessionMiddleware

from app.routers.pages import create_pages_router


class PagesRouterTests(unittest.TestCase):
    def _client(self, *, user_overrides: dict | None = None):
        templates = {
            "index.html": "INDEX",
            "access.html": "ACCESS {{ csrf_token }}",
            "forgot-license.html": "FORGOT {{ csrf_token }} {{ prefill_username }} {{ prefill_contact }} {{ forgot_message }}",
            "reset-password.html": "RESET {{ csrf_token }}",
            "dashboard.html": "DASH vip=[{{ DASH_PANEL_VIP_ATTR }}] admin=[{{ DASH_PANEL_ADMIN_ATTR }}]",
            "panel-gratuit.html": "FREE {{USERNAME}}/{{TYPE}}",
            "panel-vip.html": "VIP {{USERNAME}}/{{TYPE}}",
            "panel-revendeur.html": "REV {{USERNAME}}/{{TYPE}}",
            "profil.html": "P {{USERNAME}} {{QUOTA}} {{LICENSE}}",
            "compte.html": "C {{USERNAME}} {{UUID_SECONDARY}}",
            "compte-activer.html": "ACTIVATE",
            "abonnement.html": "ABO {{PANEL_KEY}} {{ prefill_username }} {{ prefill_license }}",
            "inscription.html": "SIGN {{ csrf_token }} {{ prefill_username }} {{ prefill_contact }} {{ prefill_recovery_secret }} {{ captcha_question }} NEXT {{ signup_next_url }}",
            "tchatlive.html": "CHAT",
            "mes-options.html": "OPTIONS",
            "ma-consommation.html": "USAGE",
            "avant-propos.html": "AVANT",
            "construction.html": "WORK",
            "scan-guide.html": "GUIDE",
            "vip-login.html": "VIPLOGIN",
            "payment.html": "PAYMENT",
        }

        user = {
            "id": 7,
            "username": "alice",
            "type": "VIP",
            "status": "active",
            "quota_gb": 10,
            "expiration": "",
            "created_at": "2026-01-01",
            "license": "LIC-ALICE",
            "uuid_secondary": "UUID-ALICE",
            "avatar": "/static/a.png",
            "notes": "ok",
        }
        if isinstance(user_overrides, dict):
            user.update(user_overrides)

        def require_access(request, _allowed, *, next_url="/", need=""):
            del next_url, need
            if request.headers.get("x-deny") == "1":
                return RedirectResponse("/acces", status_code=303)
            return dict(user)

        def get_current_user(request):
            if request.headers.get("x-anon") == "1":
                return None
            return dict(user)

        def template_or_error(name: str):
            content = templates.get(name)
            if content is None:
                return HTMLResponse("MISSING", status_code=404)
            return HTMLResponse(content, status_code=200)

        def render_panel_template(name: str, current_user: dict):
            content = templates.get(name)
            rendered = content.replace("{{USERNAME}}", str(current_user.get("username", "")))
            rendered = rendered.replace("{{TYPE}}", str(current_user.get("type", "")))
            return HTMLResponse(rendered, status_code=200)

        def read_template(name: str):
            return templates.get(name)

        def html_response(content: str, status_code: int = 200):
            return HTMLResponse(content=content, status_code=status_code)

        def safe_next_url(value: str) -> str:
            text = str(value or "").strip()
            return text if text.startswith("/") and not text.startswith("//") else "/dashboard"

        def prepare_csrf_token_for_render(_request):
            return "csrf-token", "csrf-seed"

        def maybe_set_csrf_cookie(response, seed: str):
            response.set_cookie("csrf_seed", seed)

        def generate_math_captcha():
            return "3 + 4 = ?", "7"

        def sign_captcha_answer(answer: str):
            return f"signed:{answer}"

        app = FastAPI()
        app.add_middleware(SessionMiddleware, secret_key="pages-secret", session_cookie="labo_state")
        app.include_router(
            create_pages_router(
                require_access=require_access,
                get_current_user=get_current_user,
                template_or_error=template_or_error,
                render_panel_template=render_panel_template,
                read_template=read_template,
                html_response=html_response,
                safe_next_url=safe_next_url,
                safe_avatar_url=lambda v: str(v or ""),
                prepare_csrf_token_for_render=prepare_csrf_token_for_render,
                maybe_set_csrf_cookie=maybe_set_csrf_cookie,
                generate_math_captcha=generate_math_captcha,
                sign_captcha_answer=sign_captcha_answer,
            )
        )

        @app.get("/__seed-reset-session")
        async def seed_reset_session(request: Request):
            request.session["password_reset"] = {
                "username": "alice",
                "contact": "alice@example.com",
                "requested_at": 1760000000,
            }
            return HTMLResponse("seeded")

        return TestClient(app)

    def test_access_page_renders_csrf_and_redirects_active_session(self):
        client = self._client()
        redirected = client.get("/acces", follow_redirects=False)
        self.assertEqual(redirected.status_code, 303)
        self.assertEqual(redirected.headers.get("location"), "/panel-vip")

        access = client.get("/acces", headers={"x-anon": "1"})
        self.assertEqual(access.status_code, 200)
        self.assertIn("ACCESS csrf-token", access.text)
        self.assertEqual(access.cookies.get("csrf_seed"), "csrf-seed")

    def test_forgot_page_renders_prefills_and_legacy_alias_redirects(self):
        client = self._client()
        forgot = client.get("/acces/mot-de-passe-oublie", params={"username": "neo", "contact": "+237", "message": "hello"}, headers={"x-anon": "1"})
        self.assertEqual(forgot.status_code, 200)
        self.assertIn("FORGOT csrf-token neo +237 hello", forgot.text)

        legacy = client.get("/acces/licence-oubliee", params={"username": "neo", "contact": "+237"}, headers={"x-anon": "1"}, follow_redirects=False)
        self.assertEqual(legacy.status_code, 303)
        self.assertIn("/acces/mot-de-passe-oublie?username=neo&contact=%2B237", legacy.headers.get("location", ""))

    def test_define_password_page_requires_pending_session(self):
        client = self._client()
        response = client.get("/acces/definir-mot-de-passe", headers={"x-anon": "1"}, follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIn("err=expired", response.headers.get("location", ""))

    def test_define_password_page_renders_when_reset_session_exists(self):
        client = self._client()
        client.get("/__seed-reset-session")
        response = client.get("/acces/definir-mot-de-passe", headers={"x-anon": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("RESET csrf-token", response.text)

    def test_signup_page_ignores_recovery_secret_prefill_and_sanitizes_next(self):
        client = self._client()
        signup = client.get(
            "/inscription",
            params={"username": "neo", "contact": "+237", "recovery_secret": "secret", "next": "/panel-vip"},
            headers={"x-anon": "1"},
        )
        self.assertEqual(signup.status_code, 200)
        self.assertIn("SIGN csrf-token neo +237  ", signup.text)
        self.assertIn("signed:7", signup.text)
        self.assertIn("NEXT /panel-vip", signup.text)

        unsafe = client.get("/inscription", params={"next": "https://evil.example/landing"}, headers={"x-anon": "1"})
        self.assertIn("NEXT /panel-gratuit", unsafe.text)

    def test_real_templates_expose_required_csrf_fields(self):
        forgot = Path("templates/forgot-license.html").read_text(encoding="utf-8-sig")
        self.assertIn('name="csrf_token"', forgot)

        reset = Path("templates/reset-password.html").read_text(encoding="utf-8-sig")
        self.assertIn('name="csrf_token"', reset)
        self.assertIn('/acces/definir-mot-de-passe', reset)


if __name__ == "__main__":
    unittest.main()
