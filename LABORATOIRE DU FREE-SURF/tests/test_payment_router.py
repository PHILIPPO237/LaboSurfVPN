import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.payment import create_payment_router


class _UsersRepo:
    def __init__(self):
        self._rows = [
            {
                "id": 1,
                "username": "admin",
                "type": "ADMIN",
                "om_number": "656770734",
                "momo_number": "678358503",
            },
            {
                "id": 2,
                "username": "alice",
                "type": "Gratuit",
                "reseller_id": 0,
            },
            {
                "id": 3,
                "username": "reseller",
                "type": "Revendeur",
                "om_number": "699000111",
                "momo_number": "677000111",
            },
            {
                "id": 4,
                "username": "client-reseller",
                "type": "Gratuit",
                "reseller_id": 3,
            },
        ]

    def get_by_id(self, user_id: int):
        for row in self._rows:
            if int(row.get("id", 0) or 0) == int(user_id):
                return dict(row)
        return None

    def get_by_type(self, user_type: str):
        return [dict(row) for row in self._rows if str(row.get("type", "") or "") == str(user_type or "")]


class _PaymentsRepo:
    def __init__(self):
        self.rows = []

    def add(self, payment: dict):
        row = dict(payment or {})
        row.setdefault("id", len(self.rows) + 1)
        self.rows.append(row)
        return dict(row)

    def get_by_reference(self, reference: str):
        for row in self.rows:
            if str(row.get("reference", "") or "") == str(reference or ""):
                return dict(row)
        return None


class _Db:
    def __init__(self):
        self.users = _UsersRepo()
        self.payments = _PaymentsRepo()


class PaymentRouterTests(unittest.TestCase):
    def _client(self):
        db = _Db()
        cfg = SimpleNamespace(PAYMENT_PLANS={"VIP": 2500, "REVENDEUR": 10000, "PREMIUM": 25000})

        def get_current_user(request):
            name = str(request.headers.get("x-user", "") or "").strip()
            mapping = {
                "alice": {"id": 2, "username": "alice", "type": "Gratuit", "reseller_id": 0},
                "client-reseller": {"id": 4, "username": "client-reseller", "type": "Gratuit", "reseller_id": 3},
            }
            return dict(mapping[name]) if name in mapping else None

        app = FastAPI()
        app.include_router(
            create_payment_router(
                db=db,
                cfg=cfg,
                get_current_user=get_current_user,
                is_valid_email=lambda value: "@" in str(value or ""),
                is_valid_cameroon_phone=lambda value: len(''.join(ch for ch in str(value or '') if ch.isdigit()).removeprefix('237')) == 9,
                normalize_cameroon_phone=lambda value: "+237" + ''.join(ch for ch in str(value or '') if ch.isdigit()).removeprefix('237'),
            )
        )
        return TestClient(app), db

    def test_initiate_manual_payment_for_admin_recipient(self):
        client, db = self._client()
        response = client.post(
            "/api/payment/initiate",
            json={"provider": "orange", "plan": "VIP", "phone": "699112233", "email": "alice@example.com"},
            headers={"x-user": "alice"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "manual")
        self.assertTrue(payload.get("order_id"))
        self.assertIn("656770734", payload.get("instructions", ""))
        self.assertEqual(len(db.payments.rows), 1)
        self.assertEqual(db.payments.rows[0].get("recipient_id"), 1)
        self.assertEqual(db.payments.rows[0].get("amount"), 2500)

    def test_initiate_payment_uses_reseller_recipient_when_available(self):
        client, db = self._client()
        response = client.post(
            "/api/payment/initiate",
            json={"provider": "mtn", "plan": "PREMIUM", "phone": "+237677998877", "email": "c@example.com"},
            headers={"x-user": "client-reseller"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.payments.rows[0].get("recipient_id"), 3)
        self.assertIn("677000111", response.json().get("instructions", ""))

    def test_invalid_payment_payload_is_rejected(self):
        client, db = self._client()
        response = client.post(
            "/api/payment/initiate",
            json={"provider": "bad", "plan": "VIP", "phone": "699112233"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json().get("status"), "error")
        self.assertEqual(len(db.payments.rows), 0)

    def test_payment_status_page_renders_existing_payment(self):
        client, db = self._client()
        created = db.payments.add(
            {
                "reference": "PAY-TEST-1",
                "status": "pending",
                "plan": "VIP",
                "provider": "orange",
                "amount": 2500,
                "phone": "+237699112233",
                "created_at": "2026-03-10 11:00:00",
                "updated_at": "2026-03-10 11:00:00",
            }
        )
        self.assertEqual(created.get("reference"), "PAY-TEST-1")
        response = client.get("/payment-status/PAY-TEST-1")
        self.assertEqual(response.status_code, 200)
        self.assertIn("PAY-TEST-1", response.text)
        self.assertIn("Paiement en attente", response.text)


if __name__ == "__main__":
    unittest.main()
