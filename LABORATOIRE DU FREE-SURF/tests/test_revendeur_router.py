import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.testclient import TestClient

from app.routers.revendeur import create_revendeur_router


class _Templates:
    def TemplateResponse(self, name, context):
        if name == "revendeur-payment-settings.html":
            return HTMLResponse(f"SETTINGS|{context['request'].url.path}", status_code=200)
        if name == "revendeur-payments.html":
            payments = context.get("payments", [])
            return HTMLResponse(f"PAYMENTS|{len(payments)}", status_code=200)
        return HTMLResponse(name, status_code=200)


class _UsersRepo:
    def __init__(self):
        self._rows = [
            {
                "id": 1,
                "username": "reseller",
                "type": "Revendeur",
                "allow_custom_payments": 1,
                "om_number": "699000111",
                "momo_number": "677000111",
                "status": "active",
                "expiration": "",
            },
            {
                "id": 2,
                "username": "client",
                "type": "Gratuit",
                "status": "active",
                "expiration": "",
            },
            {
                "id": 3,
                "username": "admin",
                "type": "ADMIN",
                "status": "active",
                "expiration": "",
            },
        ]

    def get_by_id(self, user_id: int):
        for row in self._rows:
            if int(row.get("id", 0) or 0) == int(user_id):
                return dict(row)
        return None

    def save(self, user: dict):
        user = dict(user or {})
        for index, row in enumerate(self._rows):
            if int(row.get("id", 0) or 0) == int(user.get("id", 0) or 0):
                self._rows[index] = dict(user)
                return dict(user)
        self._rows.append(dict(user))
        return dict(user)


class _PaymentsRepo:
    def __init__(self):
        self._rows = [
            {
                "id": 1,
                "reference": "PAY-1",
                "recipient_id": 1,
                "user_id": 2,
                "username": "client",
                "provider": "orange",
                "amount": 2500,
                "plan": "VIP",
                "status": "pending",
                "phone": "+237699112233",
                "created_at": "2026-03-10 10:00:00",
            }
        ]

    def get_by_reference(self, reference: str):
        for row in self._rows:
            if str(row.get("reference", "") or "") == str(reference or ""):
                return dict(row)
        return None

    def get_all(self, limit: int = 300, recipient_id=None):
        rows = list(self._rows)
        if recipient_id is not None:
            rows = [row for row in rows if int(row.get("recipient_id", 0) or 0) == int(recipient_id)]
        return [dict(row) for row in rows[: int(limit)]]

    def update_status(self, payment_id: int, status: str, raw_response=None):
        for row in self._rows:
            if int(row.get("id", 0) or 0) == int(payment_id):
                row["status"] = str(status or "")
                row["raw_response"] = raw_response
                return


class _Provisioner:
    def __init__(self, engine: str):
        self.engine = str(engine or "")
        self.calls = []
        self.disable_calls = []

    def ensure_user(self, user: dict, *, reason: str = ""):
        self.calls.append((str(reason or ""), dict(user)))
        return {"engine": self.engine, "action": "upsert", "configured": True, "ok": True, "message": "ok"}

    def disable_user(self, user: dict, *, reason: str = ""):
        self.disable_calls.append((str(reason or ""), dict(user)))
        return {"engine": self.engine, "action": "disable", "configured": True, "ok": True, "message": "ok"}


class _Db:
    def __init__(self):
        self.users = _UsersRepo()
        self.payments = _PaymentsRepo()
        self.ssh_provisioner = _Provisioner("ssh_dropbear")
        self.hysteria_provisioner = _Provisioner("hysteria2")
        self.slowdns_provisioner = _Provisioner("slowdns")


class RevendeurRouterTests(unittest.TestCase):
    def _client(self):
        db = _Db()

        def get_current_user(request):
            key = str(request.headers.get("x-user", "reseller") or "reseller").strip()
            mapping = {
                "reseller": db.users.get_by_id(1),
                "admin": db.users.get_by_id(3),
                "client": db.users.get_by_id(2),
            }
            value = mapping.get(key)
            return dict(value) if isinstance(value, dict) else None

        def require_access(request, allowed_types, *, next_url="/", need=""):
            del next_url, need
            user = get_current_user(request)
            if not isinstance(user, dict):
                return RedirectResponse("/acces", status_code=303)
            if str(user.get("type", "") or "") not in set(allowed_types):
                return RedirectResponse("/acces?err=forbidden", status_code=303)
            return user

        def build_user_configs(user: dict):
            return [
                {
                    "protocol": "VLESS",
                    "remark": f"{user.get('username', 'demo')} - MAIN",
                    "uri": f"vless://{user.get('uuid_secondary', 'uuid')}@example.com:443?type=ws#{user.get('username', 'demo')}",
                }
            ]

        app = FastAPI()
        app.include_router(
            create_revendeur_router(
                db=db,
                templates=_Templates(),
                require_access=require_access,
                get_current_user=get_current_user,
                build_user_configs=build_user_configs,
                ssh_dropbear_provisioner=db.ssh_provisioner,
                hysteria2_provisioner=db.hysteria_provisioner,
                slowdns_provisioner=db.slowdns_provisioner,
            )
        )
        return TestClient(app), db

    def test_settings_page_and_api(self):
        client, _db = self._client()
        page = client.get("/revendeur/settings/payment")
        self.assertEqual(page.status_code, 200)
        self.assertIn("SETTINGS", page.text)

        api = client.get("/api/revendeur/settings/payment")
        self.assertEqual(api.status_code, 200)
        self.assertEqual(api.json().get("status"), "ok")
        self.assertEqual(api.json().get("om_number"), "699000111")

    def test_settings_save_updates_user(self):
        client, db = self._client()
        response = client.post(
            "/api/revendeur/settings/payment",
            json={"om_number": "600100200", "momo_number": "600300400"},
        )
        self.assertEqual(response.status_code, 200)
        updated = db.users.get_by_id(1)
        self.assertEqual(updated.get("om_number"), "600100200")
        self.assertEqual(updated.get("momo_number"), "600300400")

    def test_payments_page_lists_rows(self):
        client, _db = self._client()
        response = client.get("/revendeur/payments")
        self.assertEqual(response.status_code, 200)
        self.assertIn("PAYMENTS|1", response.text)

    def test_approve_payment_updates_status_and_user(self):
        client, db = self._client()
        response = client.post("/api/revendeur/payments/approve", json={"reference": "PAY-1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "ok")
        self.assertEqual([item.get("engine") for item in response.json().get("provisioning", {}).get("items", [])], ["ssh_dropbear", "hysteria2", "slowdns"])
        payment = db.payments.get_by_reference("PAY-1")
        self.assertEqual(payment.get("status"), "completed")
        user = db.users.get_by_id(2)
        self.assertEqual(user.get("type"), "VIP")
        self.assertEqual(user.get("status"), "active")
        self.assertTrue(str(user.get("expiration", "")))
        self.assertEqual(db.ssh_provisioner.calls[0][0], "payment_approved")
        self.assertEqual(db.hysteria_provisioner.calls[0][0], "payment_approved")
        self.assertEqual(db.slowdns_provisioner.calls[0][0], "payment_approved")

    def test_reject_pending_payment_updates_status(self):
        client, db = self._client()
        response = client.post("/api/revendeur/payments/reject", json={"reference": "PAY-1"})
        self.assertEqual(response.status_code, 200)
        payment = db.payments.get_by_reference("PAY-1")
        self.assertEqual(payment.get("status"), "rejected")

    def test_refund_completed_payment_restores_user_and_cuts_paid_transports(self):
        client, db = self._client()

        approve = client.post("/api/revendeur/payments/approve", json={"reference": "PAY-1"})
        self.assertEqual(approve.status_code, 200)

        refund = client.post("/api/revendeur/payments/refund", json={"reference": "PAY-1"})
        self.assertEqual(refund.status_code, 200)
        payload = refund.json()
        self.assertEqual(payload.get("status"), "ok")
        self.assertEqual([item.get("engine") for item in payload.get("provisioning", {}).get("items", [])], ["ssh_dropbear", "hysteria2", "slowdns"])

        payment = db.payments.get_by_reference("PAY-1")
        self.assertEqual(payment.get("status"), "refunded")
        self.assertEqual(payment.get("raw_response", {}).get("payment_action"), "refunded")
        self.assertTrue(bool(payment.get("raw_response", {}).get("restored_from_snapshot")))

        user = db.users.get_by_id(2)
        self.assertEqual(user.get("type"), "Gratuit")
        self.assertEqual(user.get("status"), "active")
        self.assertEqual(str(user.get("expiration", "")), "")
        self.assertEqual(db.ssh_provisioner.disable_calls[0][0], "payment_refunded")
        self.assertEqual(db.hysteria_provisioner.disable_calls[0][0], "payment_refunded")
        self.assertEqual(db.slowdns_provisioner.disable_calls[0][0], "payment_refunded")

    def test_generate_demo_returns_configs(self):
        client, _db = self._client()
        response = client.post("/api/revendeur/generate-demo", json={"hours": 4})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "success")
        self.assertEqual(len(payload.get("configs", [])), 1)


if __name__ == "__main__":
    unittest.main()
