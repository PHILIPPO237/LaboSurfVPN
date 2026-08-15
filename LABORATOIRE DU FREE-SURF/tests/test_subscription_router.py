import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.subscription import create_subscription_router, pwd_context


class _UsersRepo:
    def __init__(self):
        self._rows = [
            {
                "id": 1,
                "username": "alice",
                "type": "Gratuit",
                "license": "LIC-ALICE",
                "status": "active",
                "password_hash": pwd_context.hash("alice-pass"),
            },
            {
                "id": 2,
                "username": "bob",
                "type": "VIP",
                "license": "LIC-BOB",
                "status": "active",
                "password_hash": pwd_context.hash("bob-pass"),
            },
        ]

    def get_all(self):
        return [dict(row) for row in self._rows]


class _ServiceRequestsRepo:
    def __init__(self):
        self.rows = []

    def add(self, payload: dict):
        row = dict(payload or {})
        row.setdefault("id", len(self.rows) + 1)
        self.rows.append(row)
        return row


class _Db:
    def __init__(self):
        self.users = _UsersRepo()
        self.service_requests = _ServiceRequestsRepo()


class SubscriptionRouterTests(unittest.TestCase):
    def _client(self):
        db = _Db()

        def safe_next_url(value: str) -> str:
            text = str(value or "").strip()
            if not text.startswith("/") or text.startswith("//"):
                return "/dashboard"
            return text

        def normalize_license(value: str) -> str:
            return str(value or "").strip().upper().replace(" ", "")

        def validate_contact(value: str) -> bool:
            text = str(value or "").strip()
            return text.startswith("+") or "@" in text

        def find_single_non_admin_user_by_identity(users: list[dict], username: str, license_code: str):
            uname = str(username or "").strip().lower()
            lic = normalize_license(license_code)
            matches = [
                row
                for row in users
                if isinstance(row, dict)
                and str(row.get("type", "")).strip() != "ADMIN"
                and str(row.get("username", "")).strip().lower() == uname
                and normalize_license(str(row.get("license", "") or "")) == lic
            ]
            return dict(matches[0]) if len(matches) == 1 else None

        app = FastAPI()
        app.include_router(
            create_subscription_router(
                db=db,
                safe_next_url=safe_next_url,
                normalize_license=normalize_license,
                validate_contact=validate_contact,
                now_ts=lambda: "2026-03-10 10:30:00",
                get_current_user=lambda _request: {"id": 1, "username": "alice", "type": "Gratuit"},
                find_single_non_admin_user_by_identity=find_single_non_admin_user_by_identity,
            )
        )
        return TestClient(app), db

    def _qs(self, response) -> dict[str, list[str]]:
        return parse_qs(urlparse(response.headers.get("location", "")).query)

    def test_upgrade_request_is_saved(self):
        client, db = self._client()
        response = client.post(
            "/abonnement",
            data={
                "kind": "upgrade",
                "username": "alice",
                "password": "alice-pass",
                "license": "lic-alice",
                "contact": "t.me/alice",
                "target_plan": "VIP",
                "message": "Je veux passer VIP",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertIn("ok=1", response.headers.get("location", ""))
        self.assertEqual(len(db.service_requests.rows), 1)
        row = db.service_requests.rows[0]
        self.assertEqual(row.get("kind"), "upgrade")
        self.assertEqual(row.get("target_plan"), "VIP")
        self.assertEqual(row.get("submitted_by_user_id"), 1)

    def test_renewal_request_is_saved(self):
        client, db = self._client()
        response = client.post(
            "/abonnement",
            data={
                "kind": "renewal",
                "username": "bob",
                "password": "bob-pass",
                "license": "LIC-BOB",
                "contact": "+237690000000",
                "duration_days": "30",
                "message": "Merci",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertIn("ok=1", response.headers.get("location", ""))
        self.assertEqual(len(db.service_requests.rows), 1)
        row = db.service_requests.rows[0]
        self.assertEqual(row.get("kind"), "renewal")
        self.assertEqual(row.get("duration_days"), 30)

    def test_invalid_plan_redirects_with_expected_error(self):
        client, db = self._client()
        response = client.post(
            "/abonnement",
            data={
                "kind": "upgrade",
                "username": "alice",
                "password": "alice-pass",
                "license": "LIC-ALICE",
                "contact": "alice@example.com",
                "target_plan": "ADMIN",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(self._qs(response).get("err", [""])[0], "bad_plan")
        self.assertEqual(len(db.service_requests.rows), 0)

    def test_invalid_duration_redirects_with_expected_error(self):
        client, db = self._client()
        response = client.post(
            "/abonnement",
            data={
                "kind": "renewal",
                "username": "bob",
                "password": "bob-pass",
                "license": "LIC-BOB",
                "contact": "bob@example.com",
                "duration_days": "15",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(self._qs(response).get("err", [""])[0], "bad_duration")
        self.assertEqual(len(db.service_requests.rows), 0)

    def test_unknown_identity_redirects_bad_license(self):
        client, db = self._client()
        response = client.post(
            "/abonnement",
            data={
                "kind": "renewal",
                "username": "bob",
                "password": "bob-pass",
                "license": "LIC-NOPE",
                "contact": "bob@example.com",
                "duration_days": "30",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(self._qs(response).get("err", [""])[0], "bad_license")
        self.assertEqual(len(db.service_requests.rows), 0)


if __name__ == "__main__":
    unittest.main()
