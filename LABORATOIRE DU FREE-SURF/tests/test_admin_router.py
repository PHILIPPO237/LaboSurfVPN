import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.admin import create_admin_router


class _Provider:
    backend_name = "3x-ui"
    display_name = "3x-ui"

    async def healthcheck(self):
        return {"ok": True, "backend": self.backend_name, "display_name": self.display_name}


class _UsersRepo:
    def __init__(self):
        self.rows = {
            1: {"id": 1, "username": "alice", "type": "VIP", "status": "active", "expiration": "2026-04-30"},
            2: {"id": 2, "username": "bob", "type": "Gratuit", "status": "active", "expiration": ""},
        }

    def get_by_id(self, user_id: int):
        row = self.rows.get(int(user_id))
        return dict(row) if row else None

    def get_by_username(self, username: str):
        target = str(username or "").strip().lower()
        for row in self.rows.values():
            if str(row.get("username", "") or "").lower() == target:
                return dict(row)
        return None


class _ConfigsDistributionRepo:
    def __init__(self):
        self.store = {}

    def get(self, key: str):
        value = self.store.get(str(key))
        return dict(value) if isinstance(value, dict) else value

    def set(self, key: str, value):
        self.store[str(key)] = dict(value) if isinstance(value, dict) else value


class _Provisioner:
    def __init__(self, engine: str, display_name: str):
        self.engine_name = engine
        self.display_name = display_name
        self.calls = []
        self.disable_calls = []

    def action_status(self, action: str = "upsert"):
        action_name = "disable" if str(action or "").strip().lower() == "disable" else "upsert"
        return {
            "engine": self.engine_name,
            "display_name": self.display_name,
            "configured": True,
            "ok": True,
            "enabled": True,
            "message": f"Provisioning {self.display_name} pret.",
            "raw": {"has_upsert_command": True, "has_disable_command": True},
            "action": action_name,
        }

    def status_dict(self):
        return self.action_status("upsert")

    def ensure_user(self, user: dict, *, reason: str = ""):
        self.calls.append((str(reason or ""), dict(user)))
        return {
            "engine": self.engine_name,
            "action": "upsert",
            "configured": True,
            "ok": True,
            "message": f"Provisioning {self.display_name} synchronise.",
        }

    def disable_user(self, user: dict, *, reason: str = ""):
        self.disable_calls.append((str(reason or ""), dict(user)))
        return {
            "engine": self.engine_name,
            "action": "disable",
            "configured": True,
            "ok": True,
            "message": f"Provisioning {self.display_name} suspendu.",
        }


class _Db:
    def __init__(self):
        self.users = _UsersRepo()
        self.configs_distribution = _ConfigsDistributionRepo()


class AdminRouterTests(unittest.TestCase):
    def _client(self):
        db = _Db()
        provisioners = [
            _Provisioner("ssh_dropbear", "SSH/Dropbear"),
            _Provisioner("hysteria2", "Hysteria2"),
        ]
        app = FastAPI()
        app.include_router(
            create_admin_router(
                db=db,
                require_admin_api=lambda _request: {"id": 1, "type": "ADMIN", "role_code": "super_admin", "username": "admin"},
                fetch_panel_inbounds=lambda **_kwargs: [],
                get_panel_provider=lambda: _Provider(),
                list_transport_backends=lambda: [
                    {
                        "engine": "hysteria2",
                        "display_name": "Hysteria 2",
                        "protocol": "UDP",
                        "host": "hy2.example.com",
                        "port": 8443,
                        "managed_by": "external",
                        "configured": True,
                        "ok": True,
                        "public": True,
                        "source": "transport",
                        "message": "Moteur externe configure; non pilote par le panel Xray.",
                        "raw": {},
                    }
                ],
                list_provisioning_backends=lambda: [item.status_dict() for item in provisioners],
                get_provisioners=lambda: list(provisioners),
            )
        )
        return TestClient(app), db, provisioners

    def test_panel_health_embeds_transport_and_provisioning_snapshots(self):
        client, _db, _provisioners = self._client()

        res = client.get("/admin/api/panel-health")
        self.assertEqual(res.status_code, 200)
        payload = res.json()["data"]
        self.assertEqual(payload["backend"], "3x-ui")
        self.assertEqual(payload["transport_backends"][0]["engine"], "hysteria2")
        self.assertEqual(payload["provisioning_backends"][0]["engine"], "ssh_dropbear")
        self.assertIsNone(payload.get("last_provisioning_run"))

    def test_transport_backends_endpoint_returns_external_engines(self):
        client, _db, _provisioners = self._client()

        res = client.get("/admin/api/transport-backends")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["data"][0]["display_name"], "Hysteria 2")

    def test_provisioning_backends_endpoint_returns_application_engines(self):
        client, _db, _provisioners = self._client()

        res = client.get("/admin/api/provisioning-backends")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["data"][0]["display_name"], "SSH/Dropbear")

    def test_provisioning_dry_run_persists_last_result(self):
        client, db, _provisioners = self._client()

        res = client.post("/admin/api/provisioning/dry-run", json={"username": "alice", "reason": "audit"})
        self.assertEqual(res.status_code, 200)
        payload = res.json()["data"]
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["target"]["username"], "alice")
        self.assertEqual(len(payload["provisioning"]["items"]), 2)
        self.assertEqual(db.configs_distribution.get("admin_last_provisioning_run")["action"], "dry_run")

    def test_provisioning_replay_runs_engines_and_exposes_last_result(self):
        client, db, provisioners = self._client()

        res = client.post("/admin/api/provisioning/replay", json={"user_id": 2, "reason": "manual_sync"})
        self.assertEqual(res.status_code, 200)
        payload = res.json()["data"]
        self.assertFalse(payload["dry_run"])
        self.assertEqual(payload["target"]["username"], "bob")
        self.assertEqual(provisioners[0].calls[0][0], "manual_sync")
        self.assertEqual(provisioners[1].calls[0][0], "manual_sync")

        last = client.get("/admin/api/provisioning-last-results")
        self.assertEqual(last.status_code, 200)
        self.assertEqual(last.json()["data"]["target"]["username"], "bob")

    def test_provisioning_disable_runs_engines_and_persists_last_result(self):
        client, db, provisioners = self._client()

        res = client.post("/admin/api/provisioning/disable", json={"username": "alice", "reason": "admin_suspend"})
        self.assertEqual(res.status_code, 200)
        payload = res.json()["data"]
        self.assertEqual(payload["action"], "disable")
        self.assertFalse(payload["dry_run"])
        self.assertEqual(provisioners[0].disable_calls[0][0], "admin_suspend")
        self.assertEqual(provisioners[1].disable_calls[0][0], "admin_suspend")
        self.assertEqual(db.configs_distribution.get("admin_last_provisioning_run")["action"], "disable")


if __name__ == "__main__":
    unittest.main()
