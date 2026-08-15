import json
import unittest
from datetime import datetime
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.routers.tchat import create_tchat_router


class _UsersRepo:
    def __init__(self):
        self.rows = {
            "alice": {"id": 1, "username": "alice", "type": "VIP", "avatar": "/a.png"},
            "bob": {"id": 2, "username": "bob", "type": "Gratuit", "avatar": ""},
            "admin": {"id": 3, "username": "admin", "type": "ADMIN", "avatar": "/admin.png"},
        }

    def get_by_username(self, username: str):
        row = self.rows.get(str(username or "").strip().lower())
        return dict(row) if row else None

    def get_profiles_by_usernames(self, usernames: list[str]):
        out = {}
        for name in usernames:
            row = self.rows.get(str(name or "").strip().lower())
            if row:
                out[str(name).strip().lower()] = {"type": row["type"], "avatar": row["avatar"]}
        return out


class _TchatRepo:
    def __init__(self):
        self.rows = [
            {
                "id": 1,
                "user_id": 1,
                "username": "alice",
                "content": json.dumps({"message": "hello", "replyTo": {"id": 9, "username": "bob", "text": "yo"}}, ensure_ascii=False),
                "msg_type": "text",
                "file_url": "",
                "reactions": {"🔥": ["alice"]},
                "created_at": "2026-03-11 10:00:00",
            }
        ]
        self.trim_calls: list[int] = []

    def get_recent(self, limit: int = 100):
        return list(self.rows)[-limit:]

    def get_since(self, since_id: int, limit: int = 100):
        return [dict(row) for row in self.rows if int(row.get("id", 0)) > int(since_id or 0)][:limit]

    def add(self, msg: dict):
        payload = dict(msg)
        payload["id"] = len(self.rows) + 1
        payload.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        self.rows.append(payload)
        return dict(payload)

    def get_by_id(self, msg_id: int):
        for row in self.rows:
            if int(row.get("id", 0)) == int(msg_id):
                return dict(row)
        return None

    def delete(self, msg_id: int):
        before = len(self.rows)
        self.rows = [row for row in self.rows if int(row.get("id", 0)) != int(msg_id)]
        return len(self.rows) != before

    def update_reactions(self, msg_id: int, reactions: dict):
        for row in self.rows:
            if int(row.get("id", 0)) == int(msg_id):
                row["reactions"] = dict(reactions)
                break

    def trim(self, max_count: int = 500):
        self.trim_calls.append(int(max_count))


class _TchatQuotasRepo:
    def __init__(self):
        self.rows = {}

    def get(self, username: str, date: str):
        row = self.rows.get((username, date))
        return dict(row) if row else None

    def upsert(self, username: str, date: str, files: int, links: int, last_msg: float):
        self.rows[(username, date)] = {
            "username": username,
            "date": date,
            "files": int(files),
            "links": int(links),
            "last_msg": float(last_msg),
        }


class _DB:
    def __init__(self):
        self.users = _UsersRepo()
        self.tchat = _TchatRepo()
        self.tchat_quotas = _TchatQuotasRepo()


class TchatRouterTests(unittest.TestCase):
    def _client(self):
        db = _DB()
        cfg = SimpleNamespace(TCHAT_MAX_MESSAGES=500, SLOWMODE_FREE=2, MAX_FILES_FREE=2, MAX_LINKS_FREE=1)

        def get_current_user(request: Request):
            username = str(request.headers.get("x-user", "alice") or "alice").strip().lower()
            return db.users.get_by_username(username)

        app = FastAPI()
        app.include_router(
            create_tchat_router(
                db=db,
                cfg=cfg,
                get_current_user=get_current_user,
                contains_link=lambda text: "http://" in str(text) or "https://" in str(text),
                safe_avatar_url=lambda value: str(value or "").strip(),
            )
        )
        return TestClient(app), db

    def test_messages_endpoint_formats_payload(self):
        client, _db = self._client()

        res = client.get("/api/tchat/messages?since=0")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["messages"][0]["user_type"], "VIP")
        self.assertEqual(data["messages"][0]["replyTo"]["username"], "bob")
        self.assertEqual(data["messages"][0]["reactions"]["🔥"][0], "alice")

    def test_send_message_updates_quota_and_trims(self):
        client, db = self._client()

        res = client.post("/api/tchat/send", json={"message": "visit https://example.com"}, headers={"x-user": "bob"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")
        self.assertEqual(len(db.tchat.rows), 2)
        self.assertEqual(db.tchat.trim_calls[-1], 500)

        today = datetime.now().strftime("%Y-%m-%d")
        quota = db.tchat_quotas.get("bob", today)
        self.assertEqual(quota["links"], 1)

    def test_send_message_enforces_free_link_quota(self):
        client, db = self._client()
        today = datetime.now().strftime("%Y-%m-%d")
        db.tchat_quotas.upsert("bob", today, 0, 1, 0)

        res = client.post("/api/tchat/send", json={"message": "https://blocked.example"}, headers={"x-user": "bob"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "error")

    def test_delete_and_react_endpoints(self):
        client, db = self._client()

        denied = client.post("/api/tchat/delete", json={"id": 1}, headers={"x-user": "bob"})
        self.assertEqual(denied.status_code, 403)

        allowed = client.post("/api/tchat/delete", json={"id": 1}, headers={"x-user": "admin"})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["status"], "ok")

        db.tchat.rows.append(
            {
                "id": 9,
                "user_id": 2,
                "username": "bob",
                "content": "plain",
                "msg_type": "text",
                "file_url": "",
                "reactions": {},
                "created_at": "2026-03-11 10:02:00",
            }
        )
        react = client.post("/api/tchat/react", json={"message_id": 9, "emoji": "🔥"}, headers={"x-user": "alice"})
        self.assertEqual(react.status_code, 200)
        self.assertEqual(react.json()["reactions"]["🔥"], ["alice"])

    def test_quotas_endpoint_marks_premium_as_unlimited(self):
        client, _db = self._client()

        vip = client.get("/api/tchat/quotas", headers={"x-user": "alice"})
        self.assertEqual(vip.status_code, 200)
        self.assertTrue(vip.json()["unlimited"])

        free = client.get("/api/tchat/quotas", headers={"x-user": "bob"})
        self.assertEqual(free.status_code, 200)
        self.assertFalse(free.json()["unlimited"])


if __name__ == "__main__":
    unittest.main()
