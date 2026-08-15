import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.testclient import TestClient

from app.routers.admin_tools import create_admin_tools_router, pwd_context


class _UsersRepo:
    def __init__(self):
        self._rows = [
            {
                "id": 1,
                "username": "admin",
                "contact": "admin@example.com",
                "password_hash": pwd_context.hash("admin-pass"),
                "type": "ADMIN",
                "status": "active",
                "uuid_secondary": "admin-uuid",
                "license": "ADMIN-LIC",
            },
            {
                "id": 2,
                "username": "alice",
                "contact": "alice@example.com",
                "password_hash": pwd_context.hash("alice-pass"),
                "type": "VIP",
                "status": "active",
                "expiration": "2026-04-15",
                "uuid_secondary": "alice-uuid",
                "license": "ALICE-LIC",
            },
        ]

    def get_all(self):
        return [dict(row) for row in self._rows]

    def get_by_id(self, user_id: int):
        for row in self._rows:
            if int(row.get("id", 0)) == int(user_id):
                return dict(row)
        return None

    def get_by_username(self, username: str):
        target = str(username or "").strip().lower()
        for row in self._rows:
            if str(row.get("username", "") or "").strip().lower() == target:
                return dict(row)
        return None

    def username_exists(self, username: str):
        return self.get_by_username(username) is not None

    def save(self, user: dict):
        payload = dict(user)
        for index, row in enumerate(self._rows):
            if int(row.get("id", 0)) == int(payload.get("id", 0)):
                self._rows[index] = payload
                return dict(payload)
        self._rows.append(payload)
        return dict(payload)


class _PaymentsRepo:
    def count_by_status(self, status: str):
        return 3 if str(status).lower() == "pending" else 0

    def get_all(self, limit=500, recipient_id=0):
        del limit, recipient_id
        return []


class _ServiceRequestsRepo:
    def count_pending_by_kind(self, kind: str):
        return 2 if kind == "license_recovery" else 0


class _Provisioner:
    def __init__(self, engine: str):
        self.engine = engine
        self.ensure_calls = []
        self.disable_calls = []

    def ensure_user(self, user: dict, *, reason: str = ""):
        self.ensure_calls.append((reason, dict(user)))
        return {"engine": self.engine, "configured": True, "ok": True, "action": "upsert"}

    def disable_user(self, user: dict, *, reason: str = ""):
        self.disable_calls.append((reason, dict(user)))
        return {"engine": self.engine, "configured": True, "ok": True, "action": "disable"}


class _SecurityRepo:
    def count_active(self, _now_epoch):
        return 1


class _DB:
    def __init__(self):
        self.users = _UsersRepo()
        self.payments = _PaymentsRepo()
        self.service_requests = _ServiceRequestsRepo()
        self.security = _SecurityRepo()
        self.ssh_provisioner = _Provisioner("ssh_dropbear")
        self.hysteria_provisioner = _Provisioner("hysteria2")
        self.slowdns_provisioner = _Provisioner("slowdns")


class AdminToolsRouterTests(unittest.TestCase):
    def _client(self):
        db = _DB()
        templates = {
            "admin-dashboard.html": "{{TOTAL_USERS}}|{{ACTIVE_USERS}}|{{PENDING_PAYMENTS}}|{{PENDING_RECOVERIES}}|{{ACTIVE_BANS}}|{{ADMIN_MODULES}}",
            "admin-users.html": "{{TOTAL_USERS}}|{{ACTIVE_USERS}}|{{ONLINE_USERS}}|{{USERS_ROWS}}",
            "admin-user-edit.html": "UID={{USER_ID}} USER={{USERNAME}} TYPE={{TYPE_DISABLED}}",
            "construction.html": "construction",
        }

        def require_access(_request, _allowed, *, next_url="/", need=""):
            del next_url, need
            return {"id": 1, "type": "ADMIN", "role_code": "super_admin", "username": "admin"}

        def require_admin_api(_request):
            return {"id": 1, "type": "ADMIN", "role_code": "super_admin", "username": "admin"}

        def read_template(name: str):
            return templates.get(name)

        def html_response(content: str, status_code: int = 200):
            return HTMLResponse(content=content, status_code=status_code)

        def normalize_host(value):
            return str(value or "").strip().lower()

        app = FastAPI()
        app.include_router(
            create_admin_tools_router(
                db=db,
                require_access=require_access,
                require_admin_api=require_admin_api,
                read_template=read_template,
                html_response=html_response,
                normalize_host=normalize_host,
                resolve_dns_records=lambda host: (["104.16.0.1"], []) if host else ([], []),
                is_cloudflare_ip=lambda ip: str(ip).startswith("104."),
                is_gcp_ip=lambda ip: str(ip).startswith("34."),
                is_user_expired=lambda _user: False,
                active_session_user_ids=lambda: {1, 2},
                ssh_dropbear_provisioner=db.ssh_provisioner,
                hysteria2_provisioner=db.hysteria_provisioner,
                slowdns_provisioner=db.slowdns_provisioner,
                templates=SimpleNamespace(),
            )
        )
        return TestClient(app), db

    def test_dashboard_placeholders_are_rendered(self):
        client, _db = self._client()
        res = client.get("/admin")
        self.assertEqual(res.status_code, 200)
        self.assertIn("2|2|3|2|1|12", res.text)

    def test_admin_add_user_creates_password_hash_and_provisions(self):
        client, db = self._client()
        response = client.post(
            "/admin/add-user",
            data={
                "username": "newclient",
                "password": "secret-789",
                "user_type": "VIP",
                "expiration": "2026-06-01",
                "quota_gb": "12",
                "limit_ip": "2",
                "avatar": "",
                "recovery_secret": "secret-1234",
                "notes": "created by admin",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertIn("ok=created", response.headers.get("location", ""))
        user = db.users.get_by_username("newclient")
        self.assertIsNotNone(user)
        self.assertTrue(pwd_context.verify("secret-789", str(user.get("password_hash", "") or "")))
        self.assertEqual(user.get("service_password"), "secret-789")
        self.assertEqual(user.get("type"), "VIP")
        self.assertEqual(db.ssh_provisioner.ensure_calls[0][0], "admin_add_user")

    def test_admin_reset_user_password_updates_hash(self):
        client, db = self._client()
        response = client.post(
            "/admin/users/reset-password",
            data={"user_id": "2", "new_password": "fresh-admin-pass"},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertIn("ok=password_reset", response.headers.get("location", ""))
        user = db.users.get_by_id(2)
        self.assertTrue(pwd_context.verify("fresh-admin-pass", str(user.get("password_hash", "") or "")))
        self.assertEqual(user.get("service_password"), "fresh-admin-pass")

    def test_admin_toggle_user_suspends_then_reactivates(self):
        client, db = self._client()
        first = client.post("/admin/toggle-user", data={"user_id": "2"}, follow_redirects=False)
        self.assertEqual(first.status_code, 303)
        self.assertIn("ok=suspended", first.headers.get("location", ""))
        self.assertEqual(db.users.get_by_id(2).get("status"), "suspended")

        second = client.post("/admin/toggle-user", data={"user_id": "2"}, follow_redirects=False)
        self.assertEqual(second.status_code, 303)
        self.assertIn("ok=reactivated", second.headers.get("location", ""))
        self.assertEqual(db.users.get_by_id(2).get("status"), "active")


class AdminLineageTests(unittest.TestCase):
    """Teste que les admins simples ne voient/gèrent que leur lignée."""

    def _build(self, *, actor_id: int, actor_role_code: str = "admin"):
        users_rows = [
            {
                "id": 1,
                "username": "superadmin",
                "contact": "",
                "password_hash": pwd_context.hash("sa-pass"),
                "type": "ADMIN",
                "role_code": "super_admin",
                "status": "active",
                "uuid_secondary": "sa-uuid",
                "license": "SA-LIC",
                "reseller_id": 0,
            },
            {
                "id": 10,
                "username": "admin_simple",
                "contact": "",
                "password_hash": pwd_context.hash("admin-pass"),
                "type": "ADMIN",
                "role_code": "admin",
                "status": "active",
                "uuid_secondary": "as-uuid",
                "license": "AS-LIC",
                "reseller_id": 1,
            },
            {
                "id": 20,
                "username": "client_of_admin",
                "contact": "",
                "password_hash": pwd_context.hash("c-pass"),
                "type": "VIP",
                "status": "active",
                "expiration": "2027-01-01",
                "uuid_secondary": "c-uuid",
                "license": "C-LIC",
                "reseller_id": 10,
            },
            {
                "id": 30,
                "username": "client_other",
                "contact": "",
                "password_hash": pwd_context.hash("o-pass"),
                "type": "VIP",
                "status": "active",
                "expiration": "2027-01-01",
                "uuid_secondary": "o-uuid",
                "license": "O-LIC",
                "reseller_id": 1,
            },
        ]
        repo = _UsersRepo()
        repo._rows = users_rows

        db = _DB()
        db.users = repo

        actor_dict = {"id": actor_id, "type": "ADMIN", "role_code": actor_role_code, "username": f"user{actor_id}"}

        def require_access(_request, _allowed, *, next_url="/", need=""):
            del next_url, need
            return dict(actor_dict)

        def require_admin_api(_request):
            return dict(actor_dict)

        templates = {
            "admin-dashboard.html": "dashboard",
            "admin-users.html": "{{TOTAL_USERS}}|{{ACTIVE_USERS}}|{{ONLINE_USERS}}|{{USERS_ROWS}}",
            "admin-user-edit.html": "UID={{USER_ID}} USER={{USERNAME}} TYPE={{TYPE_DISABLED}}",
            "construction.html": "construction",
        }

        app = FastAPI()
        app.include_router(
            create_admin_tools_router(
                db=db,
                require_access=require_access,
                require_admin_api=require_admin_api,
                read_template=lambda name: templates.get(name),
                html_response=lambda content, status_code=200: HTMLResponse(content=content, status_code=status_code),
                normalize_host=lambda v: str(v or "").strip().lower(),
                resolve_dns_records=lambda host: ([], []),
                is_cloudflare_ip=lambda ip: False,
                is_gcp_ip=lambda ip: False,
                is_user_expired=lambda _user: False,
                active_session_user_ids=lambda: set(),
                ssh_dropbear_provisioner=db.ssh_provisioner,
                hysteria2_provisioner=db.hysteria_provisioner,
                slowdns_provisioner=db.slowdns_provisioner,
                templates=SimpleNamespace(),
            )
        )
        return TestClient(app), db

    # --- Super admin voit TOUS les utilisateurs ---
    def test_superadmin_sees_all_users(self):
        client, _db = self._build(actor_id=1, actor_role_code="super_admin")
        res = client.get("/admin/users")
        self.assertEqual(res.status_code, 200)
        self.assertIn("superadmin", res.text)
        self.assertIn("client_of_admin", res.text)
        self.assertIn("client_other", res.text)

    # --- Admin simple ne voit que sa lignée ---
    def test_simple_admin_sees_only_own_lineage(self):
        client, _db = self._build(actor_id=10, actor_role_code="admin")
        res = client.get("/admin/users")
        self.assertEqual(res.status_code, 200)
        self.assertIn("client_of_admin", res.text)
        self.assertNotIn("client_other", res.text)

    # --- Admin simple peut modifier son client ---
    def test_simple_admin_can_update_own_client(self):
        client, db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/users/update",
            data={"user_id": "20", "user_type": "VIP", "notes": "updated"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        self.assertIn("ok=updated", res.headers.get("location", ""))

    # --- Admin simple NE PEUT PAS modifier un client hors lignée ---
    def test_simple_admin_cannot_update_other_client(self):
        client, _db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/users/update",
            data={"user_id": "30", "user_type": "VIP"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        location = res.headers.get("location", "")
        self.assertIn("err=", location)

    # --- Admin simple NE PEUT PAS toggle un client hors lignée ---
    def test_simple_admin_cannot_toggle_other_client(self):
        client, _db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/toggle-user",
            data={"user_id": "30"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        location = res.headers.get("location", "")
        self.assertIn("err=", location)

    # --- Admin simple peut toggle son propre client ---
    def test_simple_admin_can_toggle_own_client(self):
        client, _db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/toggle-user",
            data={"user_id": "20"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        self.assertIn("ok=suspended", res.headers.get("location", ""))

    # --- Admin simple NE PEUT PAS reset password d'un client hors lignée ---
    def test_simple_admin_cannot_reset_password_other(self):
        client, _db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/users/reset-password",
            data={"user_id": "30", "new_password": "newpass123"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        location = res.headers.get("location", "")
        self.assertIn("err=", location)

    # --- Admin simple peut reset password de son propre client ---
    def test_simple_admin_can_reset_password_own(self):
        client, db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/users/reset-password",
            data={"user_id": "20", "new_password": "newpass123"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        self.assertIn("ok=password_reset", res.headers.get("location", ""))

    # --- Super admin peut modifier n'importe quel client ---
    def test_superadmin_can_update_any_client(self):
        client, _db = self._build(actor_id=1, actor_role_code="super_admin")
        res = client.post(
            "/admin/users/update",
            data={"user_id": "30", "user_type": "VIP"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        self.assertIn("ok=updated", res.headers.get("location", ""))

    # --- add-user définit reseller_id sur l'acteur ---
    def test_add_user_sets_reseller_id(self):
        client, db = self._build(actor_id=10, actor_role_code="admin")
        res = client.post(
            "/admin/add-user",
            data={"username": "newuser", "password": "secret123", "user_type": "Gratuit"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 303)
        user = db.users.get_by_username("newuser")
        self.assertIsNotNone(user)
        self.assertEqual(user.get("reseller_id"), 10)

    # --- Admin simple ne peut PAS voir la page edit d'un client hors lignée ---
    def test_simple_admin_cannot_view_edit_other(self):
        client, _db = self._build(actor_id=10, actor_role_code="admin")
        res = client.get("/admin/users/edit?user_id=30")
        self.assertEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()
