import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.sessions import SessionMiddleware

from app.routers.auth import create_auth_router, pwd_context


class _UsersRepo:
    def __init__(self):
        self._rows = []
        self._next_id = 1

    def get_all(self):
        return [dict(row) for row in self._rows]

    def get_by_license(self, license_key: str):
        needle = str(license_key or "").strip().upper().replace(" ", "")
        for row in self._rows:
            if str(row.get("license", "") or "").strip().upper().replace(" ", "") == needle:
                return dict(row)
        return None

    def get_by_username(self, username: str):
        needle = str(username or "").strip().lower()
        for row in self._rows:
            if str(row.get("username", "") or "").strip().lower() == needle:
                return dict(row)
        return None

    def get_by_id(self, user_id: int):
        for row in self._rows:
            if int(row.get("id", 0) or 0) == int(user_id):
                return dict(row)
        return None

    def username_exists(self, username: str):
        return self.get_by_username(username) is not None

    def save(self, user: dict):
        payload = dict(user or {})
        payload.setdefault("contact", "")
        payload.setdefault("password_hash", "")
        payload.setdefault("type", "Gratuit")
        payload.setdefault("status", "active")
        payload.setdefault("license", "")
        payload.setdefault("uuid_secondary", "")
        payload.setdefault("recovery_secret_hash", "")
        payload.setdefault("forbidden_attempts", 0)
        payload.setdefault("last_forbidden_need", "")
        payload.setdefault("last_forbidden_at", "")
        payload.setdefault("avatar", "")
        payload.setdefault("quota_gb", None)
        payload.setdefault("expiration", "")
        payload.setdefault("notes", "")
        existing = self.get_by_username(payload.get("username", ""))
        if existing is not None:
            payload.setdefault("id", int(existing.get("id", 0) or 0))
            for index, row in enumerate(self._rows):
                if int(row.get("id", 0) or 0) == int(payload.get("id", 0) or 0):
                    self._rows[index] = dict(payload)
                    return dict(payload)
        payload["id"] = int(payload.get("id", 0) or self._next_id)
        self._next_id = max(self._next_id, payload["id"] + 1)
        self._rows.append(dict(payload))
        return dict(payload)


class _SessionsRepo:
    def __init__(self):
        self.records = {}

    def set(self, token: str, user_id: int, username: str, expires_at: float):
        self.records[str(token)] = {
            "user_id": int(user_id),
            "username": str(username),
            "expires_at": float(expires_at),
        }

    def delete(self, token: str):
        self.records.pop(str(token), None)

    def delete_for_user(self, user_id: int):
        doomed = [token for token, data in self.records.items() if int(data.get("user_id", 0)) == int(user_id)]
        for token in doomed:
            self.delete(token)


class _Provisioner:
    def __init__(self, engine: str):
        self.engine = engine
        self.calls = []
        self.disable_calls = []

    def ensure_user(self, user: dict, *, reason: str = ""):
        self.calls.append((reason, dict(user)))
        return {"engine": self.engine, "configured": True, "ok": True, "action": "upsert"}

    def disable_user(self, user: dict, *, reason: str = ""):
        self.disable_calls.append((reason, dict(user)))
        return {"engine": self.engine, "configured": True, "ok": True, "action": "disable"}


class _Db:
    def __init__(self):
        self.users = _UsersRepo()
        self.sessions = _SessionsRepo()
        self.ssh_provisioner = _Provisioner("ssh_dropbear")
        self.hysteria_provisioner = _Provisioner("hysteria2")
        self.slowdns_provisioner = _Provisioner("slowdns")


def _hash_secret(value: str) -> str:
    return hashlib.sha256(str(value or "").strip().lower().encode("utf-8")).hexdigest()


class AuthRouterTests(unittest.TestCase):
    def _client(self, *, captcha_allowed: bool = True):
        temp_dir = tempfile.TemporaryDirectory()
        avatars_dir = Path(temp_dir.name) / "avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)

        cfg = SimpleNamespace(
            BASE_DIR=Path(temp_dir.name),
            SESSION_COOKIE="labo_session",
            CSRF_COOKIE="labo_csrf",
            SESSION_TTL_SECONDS=1800,
            _COOKIE_SECURE=False,
            _VIP_COOKIE_SECRET="dev-test-secret",
            AVATAR_MAX_BYTES=2 * 1024 * 1024,
            AVATARS_DIR=avatars_dir,
            RECOVERY_SECRET_MIN_LEN=4,
            RECOVERY_SECRET_MAX_LEN=120,
            PASSWORD_RESET_RATE_MAX=2,
            PASSWORD_RESET_RATE_WINDOW=300,
        )

        db = _Db()
        db.users.save(
            {
                "username": "vipuser",
                "contact": "t.me/vipuser",
                "password_hash": pwd_context.hash("vip-pass"),
                "type": "VIP",
                "status": "active",
                "license": "LIC-VIP",
                "uuid_secondary": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
                "recovery_secret_hash": _hash_secret("vip-secret"),
            }
        )
        db.users.save(
            {
                "username": "freeuser",
                "contact": "t.me/freeuser",
                "password_hash": pwd_context.hash("free-pass"),
                "type": "Gratuit",
                "status": "active",
                "license": "LIC-FREE",
                "uuid_secondary": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
                "recovery_secret_hash": _hash_secret("free-secret"),
            }
        )
        db.users.save(
            {
                "username": "PHILIPPO237",
                "contact": "admin@local",
                "password_hash": "",
                "type": "ADMIN",
                "role_code": "super_admin",
                "status": "active",
                "license": "LIC-ADMIN",
                "uuid_secondary": "dddddddd-dddd-4ddd-dddd-dddddddddddd",
            }
        )
        (Path(temp_dir.name) / ".admin_password").write_text("Philippo237ApkModder", encoding="utf-8")

        state = {"captcha_failures": 0, "login_attempts": 0}

        def safe_next_url(value: str) -> str:
            text = str(value or "").strip()
            return text if text.startswith("/") and not text.startswith("//") else "/dashboard"

        def normalize_license(value: str) -> str:
            return str(value or "").strip().upper().replace(" ", "")

        def normalize_uuid(value: str) -> str:
            import uuid as _uuid
            text = str(value or "").strip()
            if not text:
                return ""
            try:
                return str(_uuid.UUID(text))
            except Exception:
                return ""

        def normalize_recovery_secret(value: str) -> str:
            return str(value or "").strip()

        def hash_recovery_secret(value: str) -> str:
            return _hash_secret(value)

        def suggest_usernames(base: str, _users: list[dict], _limit: int = 3):
            clean = str(base or "user").strip() or "user"
            return [f"{clean}1", f"{clean}2", f"{clean}3"]

        def verify_csrf(_request, form_data: dict):
            values = form_data.get("csrf_token", [""])
            submitted = values[0] if isinstance(values, list) and values else values
            return str(submitted or "") == "csrf-ok"

        def check_login_rate_limit(_ip: str):
            state["login_attempts"] += 1
            return state["login_attempts"] <= 3

        def check_captcha_ban(_ip: str):
            return bool(captcha_allowed)

        def register_captcha_failure(_ip: str):
            state["captcha_failures"] += 1

        def generate_math_captcha():
            return "3 + 4 = ?", "7"

        def sign_captcha_answer(answer: str):
            return f"signed:{answer}"

        def verify_captcha_answer(signed: str | None, user_answer: str):
            return str(signed or "") == "signed:7" and str(user_answer or "").strip() == "7"

        def generate_license_key():
            return "LIC-NEW-TEST"

        def generate_uuid():
            return "cccccccc-cccc-4ccc-cccc-cccccccccccc"

        def find_single_non_admin_user_by_username(users: list[dict], username: str):
            needle = str(username or "").strip().lower()
            matches = [
                row for row in users
                if isinstance(row, dict)
                and str(row.get("type", "") or "").strip() != "ADMIN"
                and str(row.get("username", "") or "").strip().lower() == needle
            ]
            return dict(matches[0]) if len(matches) == 1 else None

        app = FastAPI()
        app.add_middleware(SessionMiddleware, secret_key="test-state-secret", session_cookie="labo_state")
        app.include_router(
            create_auth_router(
                db=db,
                cfg=cfg,
                safe_next_url=safe_next_url,
                now_ts=lambda: "2026-03-09 10:00:00",
                normalize_license=normalize_license,
                normalize_uuid=normalize_uuid,
                normalize_recovery_secret=normalize_recovery_secret,
                hash_recovery_secret=hash_recovery_secret,
                suggest_usernames=suggest_usernames,
                generate_license_key=generate_license_key,
                generate_uuid=generate_uuid,
                safe_avatar_url=lambda value: str(value or "") if str(value or "").startswith("http") else "",
                is_user_expired=lambda _user: False,
                check_login_rate_limit=check_login_rate_limit,
                check_captcha_ban=check_captcha_ban,
                register_captcha_failure=register_captcha_failure,
                generate_math_captcha=generate_math_captcha,
                sign_captcha_answer=sign_captcha_answer,
                verify_captcha_answer=verify_captcha_answer,
                verify_csrf=verify_csrf,
                find_single_non_admin_user_by_username=find_single_non_admin_user_by_username,
                ssh_dropbear_provisioner=db.ssh_provisioner,
                hysteria2_provisioner=db.hysteria_provisioner,
                slowdns_provisioner=db.slowdns_provisioner,
            )
        )
        return TestClient(app), db, state, temp_dir

    def test_login_success_sets_cookie_and_redirects(self):
        client, db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        response = client.post(
            "/acces",
            data={"username": "vipuser", "password": "vip-pass", "csrf_token": "csrf-ok", "next": "/panel-vip", "need": "panel.premium.view"},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers.get("location"), "/panel-vip")
        token = response.cookies.get("labo_session")
        self.assertTrue(token)
        self.assertIn(token, db.sessions.records)

    def test_root_admin_bootstrap_password_restores_access(self):
        client, db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        response = client.post(
            "/acces",
            data={"username": "PHILIPPO237", "password": "Philippo237@Philippo237ApkModder", "csrf_token": "csrf-ok", "next": "/dashboard"},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers.get("location"), "/dashboard")
        repaired = db.users.get_by_username("PHILIPPO237")
        self.assertTrue(pwd_context.verify("Philippo237@Philippo237ApkModder", str(repaired.get("password_hash", "") or "")))

    def test_signup_taken_returns_suggestions(self):
        client, _db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        response = client.post(
            "/inscription",
            data={
                "username": "vipuser",
                "contact": "t.me/vipuser",
                "recovery_secret": "alpha-beta",
                "password": "Xk92Trqz",
                "confirm_password": "Xk92Trqz",
                "csrf_token": "csrf-ok",
                "captcha": "7",
                "captcha_signed": "signed:7",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertIn("err=taken", response.headers.get("location", ""))
        self.assertIn("s1=vipuser1", response.headers.get("location", ""))
        self.assertNotIn("recovery_secret", response.headers.get("location", ""))

    def test_signup_success_persists_contact_and_password_hash(self):
        client, db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        response = client.post(
            "/inscription",
            data={
                "username": "neo",
                "contact": "t.me/neo",
                "recovery_secret": "neo-secret",
                "password": "Zt74Bqrp",
                "confirm_password": "Zt74Bqrp",
                "csrf_token": "csrf-ok",
                "captcha": "7",
                "captcha_signed": "signed:7",
                "next": "/panel-gratuit",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers.get("location"), "/panel-gratuit")
        created = db.users.get_by_username("neo")
        self.assertEqual(created.get("contact"), "t.me/neo")
        self.assertEqual(created.get("recovery_secret_hash"), _hash_secret("neo-secret"))
        self.assertTrue(pwd_context.verify("Zt74Bqrp", str(created.get("password_hash", "") or "")))

    def test_legacy_forgot_password_flow_resets_password(self):
        client, db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        forgot = client.post(
            "/acces/licence-oubliee",
            data={
                "username": "freeuser",
                "contact": "t.me/freeuser",
                "recovery_secret": "free-secret",
                "csrf_token": "csrf-ok",
            },
            follow_redirects=False,
        )
        self.assertEqual(forgot.status_code, 303)
        self.assertEqual(forgot.headers.get("location"), "/acces/definir-mot-de-passe")

        reset = client.post(
            "/acces/definir-mot-de-passe",
            data={"password": "fresh-pass", "confirm_password": "fresh-pass", "csrf_token": "csrf-ok"},
            follow_redirects=False,
        )
        self.assertEqual(reset.status_code, 303)
        self.assertIn("success=password_migrated", reset.headers.get("location", ""))
        updated = db.users.get_by_username("freeuser")
        self.assertTrue(pwd_context.verify("fresh-pass", str(updated.get("password_hash", "") or "")))

    def test_forgot_password_rate_limit_blocks_repeated_attempts(self):
        client, _db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        payload = {
            "username": "freeuser",
            "contact": "t.me/freeuser",
            "recovery_secret": "free-secret",
            "csrf_token": "csrf-ok",
        }
        headers = {"x-forwarded-for": "198.51.100.24"}
        first = client.post("/acces/mot-de-passe-oublie", data=payload, headers=headers, follow_redirects=False)
        second = client.post("/acces/mot-de-passe-oublie", data=payload, headers=headers, follow_redirects=False)
        third = client.post("/acces/mot-de-passe-oublie", data=payload, headers=headers, follow_redirects=False)
        fourth = client.post("/acces/mot-de-passe-oublie", data=payload, headers=headers, follow_redirects=False)
        self.assertEqual(first.status_code, 303)
        self.assertEqual(second.status_code, 303)
        self.assertEqual(third.status_code, 303)
        self.assertIn("err=rate_limit", fourth.headers.get("location", ""))

    def test_logout_clears_session(self):
        client, db, _state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        login = client.post(
            "/acces",
            data={"username": "vipuser", "password": "vip-pass", "csrf_token": "csrf-ok", "next": "/panel-vip"},
            follow_redirects=False,
        )
        token = login.cookies.get("labo_session")
        self.assertIn(token, db.sessions.records)

        client.cookies.set("labo_session", token)
        logout = client.get("/logout", follow_redirects=False)
        self.assertEqual(logout.status_code, 303)
        self.assertEqual(logout.headers.get("location"), "/acces")
        self.assertNotIn(token, db.sessions.records)

    def test_login_rate_limit_blocks_fourth_attempt(self):
        client, _db, state, temp_dir = self._client()
        self.addCleanup(temp_dir.cleanup)

        for _ in range(3):
            res = client.post(
                "/acces",
                data={"username": "vipuser", "password": "vip-pass", "csrf_token": "csrf-ok", "next": "/panel-vip"},
                follow_redirects=False,
            )
            self.assertEqual(res.status_code, 303)
        blocked = client.post(
            "/acces",
            data={"username": "vipuser", "password": "vip-pass", "csrf_token": "csrf-ok"},
            follow_redirects=False,
        )
        self.assertIn("err=invalid", blocked.headers.get("location", ""))
        self.assertEqual(state["login_attempts"], 4)


if __name__ == "__main__":
    unittest.main()
