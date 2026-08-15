import time
import unittest
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.routers.user import create_user_router


class _UsersRepo:
    def __init__(self):
        self.rows = {
            1: {
                "id": 1,
                "username": "reseller",
                "type": "Revendeur",
                "status": "active",
                "uuid_secondary": "UUID-RES",
                "license": "LIC-RES",
                "avatar": "/static/avatars/res.png",
                "reseller_id": 0,
                "notes": "Reseller bio",
                "created_at": "2026-01-10",
                "expiration": "",
            },
            2: {
                "id": 2,
                "username": "alice",
                "type": "VIP",
                "status": "blocked",
                "uuid_secondary": "UUID-ALICE",
                "license": "LIC-ALICE",
                "avatar": "/static/avatars/alice.png",
                "reseller_id": 1,
                "notes": "",
                "created_at": "2026-02-05",
                "expiration": "",
            },
            3: {
                "id": 3,
                "username": "bob",
                "type": "Gratuit",
                "status": "active",
                "uuid_secondary": "UUID-BOB",
                "license": "LIC-BOB",
                "avatar": "",
                "reseller_id": 0,
                "notes": "Client note",
                "created_at": "2026-02-07",
                "expiration": "",
            },
        }

    def get_by_id(self, user_id: int):
        row = self.rows.get(int(user_id))
        return dict(row) if row else None

    def get_by_username(self, username: str):
        target = str(username or "").strip().lower()
        for row in self.rows.values():
            if str(row.get("username", "")).lower() == target:
                return dict(row)
        return None

    def save(self, user: dict):
        payload = dict(user)
        user_id = int(payload.get("id", 0) or 0)
        self.rows[user_id] = payload
        return dict(payload)


class _ActivationKeysRepo:
    def __init__(self):
        self.rows = {
            "VIP-1234": {
                "id": 1,
                "key": "VIP-1234",
                "user_type": "PREMIUM",
                "duration_days": 30,
                "is_used": 0,
            }
        }
        self.marked: list[tuple[str, int, str]] = []

    def get_by_key(self, key: str):
        row = self.rows.get(str(key or "").strip().upper())
        return dict(row) if row else None

    def mark_used(self, key: str, user_id: int, username: str):
        normalized = str(key or "").strip().upper()
        self.marked.append((normalized, int(user_id), str(username)))
        if normalized in self.rows:
            self.rows[normalized]["is_used"] = 1


class _VipTokensRepo:
    def __init__(self):
        self.rows = {
            "VIP-TOKEN": {
                "id": 1,
                "token": "VIP-TOKEN",
                "type": "VIP",
                "duration_label": "7 jours",
                "is_used": 0,
                "expires_at": time.time() + 3600,
            }
        }
        self.marked: list[tuple[str, int, str]] = []

    def get_by_token(self, token: str):
        row = self.rows.get(str(token or "").strip())
        return dict(row) if row else None

    def mark_used(self, token: str, user_id: int, username: str):
        normalized = str(token or "").strip()
        self.marked.append((normalized, int(user_id), str(username)))
        if normalized in self.rows:
            self.rows[normalized]["is_used"] = 1


class _TchatRepo:
    def get_recent(self, limit: int = 100):
        del limit
        return [
            {"id": 1, "username": "alice"},
            {"id": 2, "username": "alice"},
            {"id": 3, "username": "reseller"},
        ]


class _Provisioner:
    def __init__(self, engine: str):
        self.engine = str(engine or "")
        self.calls = []

    def ensure_user(self, user: dict, *, reason: str = ""):
        self.calls.append((str(reason or ""), dict(user)))
        return {"engine": self.engine, "configured": True, "ok": True, "message": "ok"}


class _DB:
    def __init__(self):
        self.users = _UsersRepo()
        self.activation_keys = _ActivationKeysRepo()
        self.vip_tokens = _VipTokensRepo()
        self.tchat = _TchatRepo()
        self.ssh_provisioner = _Provisioner("ssh_dropbear")
        self.hysteria_provisioner = _Provisioner("hysteria2")
        self.slowdns_provisioner = _Provisioner("slowdns")


class UserRouterTests(unittest.TestCase):
    def _client(self):
        db = _DB()
        cfg = SimpleNamespace(TCHAT_MAX_MESSAGES=500)

        def get_current_user(request: Request):
            name = str(request.headers.get("x-user", "alice") or "alice").strip().lower()
            return db.users.get_by_username(name)

        def build_user_configs(user: dict):
            username = str(user.get("username", "") or "")
            return [
                {"remark": f"{username}-MAIN", "protocol": "VLESS", "uri": f"vless://{username}@example"},
                {"remark": f"{username}-ALT", "protocol": "UDP", "uri": f"hysteria2://{username}@example"},
            ]

        app = FastAPI()
        app.include_router(
            create_user_router(
                db=db,
                cfg=cfg,
                get_current_user=get_current_user,
                build_user_configs=build_user_configs,
                safe_avatar_url=lambda value: str(value or "").strip(),
                ssh_dropbear_provisioner=db.ssh_provisioner,
                hysteria2_provisioner=db.hysteria_provisioner,
                slowdns_provisioner=db.slowdns_provisioner,
            )
        )
        return TestClient(app), db

    def test_get_configs_for_current_user(self):
        client, _db = self._client()

        res = client.get("/api/user/get-configs")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(len(data["configs"]), 2)
        self.assertEqual(data["user_uuid"], "UUID-ALICE")

    def test_reseller_can_get_configs_for_owned_client_only(self):
        client, _db = self._client()

        allowed = client.get("/api/user/get-configs", params={"target_user_id": 2}, headers={"x-user": "reseller"})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["username"], "alice")

        denied = client.get("/api/user/get-configs", params={"target_user_id": 3}, headers={"x-user": "reseller"})
        self.assertEqual(denied.status_code, 403)

    def test_user_me_returns_frontend_friendly_type(self):
        client, _db = self._client()

        res = client.get("/api/user/me", headers={"x-user": "reseller"})
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        self.assertEqual(payload["type"], "REVENDEUR")
        self.assertEqual(payload["avatar"], "/static/avatars/res.png")

    def test_user_profile_returns_chat_modal_payload(self):
        client, _db = self._client()

        res = client.get("/api/user/alice", headers={"x-user": "reseller"})
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        self.assertEqual(payload["message_count"], 2)
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["country"], "Cameroun")

    def test_activate_key_upgrades_user_and_marks_key_used(self):
        client, db = self._client()

        res = client.post("/api/user/activate", json={"key": "VIP-1234"}, headers={"x-user": "bob"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")
        self.assertTrue(res.json()["provisioning"]["ok"])
        self.assertEqual([item["engine"] for item in res.json()["provisioning"]["items"]], ["ssh_dropbear", "hysteria2", "slowdns"])

        saved_user = db.users.get_by_username("bob")
        self.assertEqual(saved_user["type"], "PREMIUM")
        self.assertEqual(db.activation_keys.marked[0][0], "VIP-1234")
        self.assertTrue(str(saved_user.get("expiration", "")).strip())
        self.assertEqual(db.ssh_provisioner.calls[0][0], "activation_key")
        self.assertEqual(db.hysteria_provisioner.calls[0][0], "activation_key")
        self.assertEqual(db.slowdns_provisioner.calls[0][0], "activation_key")

    def test_vip_verify_requires_session_and_redeems_token(self):
        client, db = self._client()

        denied = client.post("/vip-verify", data={"vip_key": "VIP-TOKEN"}, follow_redirects=False)
        self.assertEqual(denied.status_code, 303)
        self.assertIn("/panel-vip", denied.headers.get("location", ""))

        saved_user = db.users.get_by_username("alice")
        self.assertEqual(saved_user["type"], "VIP")
        self.assertTrue(str(saved_user.get("expiration", "")).strip())
        self.assertEqual(db.vip_tokens.marked[0][0], "VIP-TOKEN")
        self.assertEqual(db.ssh_provisioner.calls[0][0], "vip_token")
        self.assertEqual(db.hysteria_provisioner.calls[0][0], "vip_token")
        self.assertEqual(db.slowdns_provisioner.calls[0][0], "vip_token")


if __name__ == "__main__":
    unittest.main()
