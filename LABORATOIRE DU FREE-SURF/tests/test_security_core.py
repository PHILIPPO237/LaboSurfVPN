import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.security import Security
from app.routers.auth import _client_ip


class _SecurityRepo:
    def __init__(self):
        self.rows = {}

    def get(self, ip: str):
        return self.rows.get(ip)

    def upsert(self, ip: str, fail_count: int, banned_until: float):
        self.rows[str(ip)] = {"fail_count": int(fail_count), "banned_until": float(banned_until)}


class _Db:
    def __init__(self):
        self.security = _SecurityRepo()
        self.sessions = SimpleNamespace()
        self.users = SimpleNamespace()


class SecurityCoreTests(unittest.TestCase):
    def _security(self, **cfg_overrides):
        cfg_values = {
            "_VIP_COOKIE_SECRET": "dev-test-secret",
            "_LOGIN_RATE_WINDOW": 60,
            "_LOGIN_RATE_MAX": 3,
            "CSRF_COOKIE": "labo_csrf",
            "_COOKIE_SECURE": False,
            "SESSION_COOKIE": "labo_session",
            "SESSION_TTL_SECONDS": 1800,
            "CAPTCHA_TOKEN_TTL_SECONDS": 300,
        }
        cfg_values.update(cfg_overrides)
        cfg = SimpleNamespace(**cfg_values)
        return Security(
            cfg=cfg,
            db=_Db(),
            now_ts=lambda: "2026-03-22 20:00:00",
            safe_next_url=lambda value: value if str(value).startswith("/") else "/dashboard",
            is_user_expired=lambda _user: False,
        )

    def test_captcha_token_is_opaque_and_verifiable(self):
        security = self._security()
        token = security.sign_captcha_answer("7")
        self.assertEqual(len(token.split(":")), 3)
        self.assertFalse(token.startswith("7:"))
        self.assertTrue(security.verify_captcha_answer(token, "7"))
        self.assertFalse(security.verify_captcha_answer(token, "8"))

    def test_captcha_token_expires(self):
        security = self._security(CAPTCHA_TOKEN_TTL_SECONDS=60)
        with patch("app.core.security.time.time", return_value=1_000):
            token = security.sign_captcha_answer("4")
        with patch("app.core.security.time.time", return_value=1_061):
            self.assertFalse(security.verify_captcha_answer(token, "4"))

    def test_client_ip_ignores_forwarded_header_by_default(self):
        app = FastAPI()
        app.state.cfg = SimpleNamespace(TRUST_PROXY_HEADERS=False, TRUSTED_PROXY_IPS=[])

        @app.get("/ip")
        async def ip_view(request: Request):
            return {"ip": _client_ip(request)}

        client = TestClient(app)
        response = client.get("/ip", headers={"x-forwarded-for": "198.51.100.24"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ip"], "testclient")

    def test_client_ip_accepts_forwarded_header_only_for_trusted_proxy(self):
        app = FastAPI()
        app.state.cfg = SimpleNamespace(TRUST_PROXY_HEADERS=True, TRUSTED_PROXY_IPS=["testclient"])

        @app.get("/ip")
        async def ip_view(request: Request):
            return {"ip": _client_ip(request)}

        client = TestClient(app)
        response = client.get("/ip", headers={"x-forwarded-for": "198.51.100.24, 10.0.0.1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ip"], "198.51.100.24")


if __name__ == "__main__":
    unittest.main()
