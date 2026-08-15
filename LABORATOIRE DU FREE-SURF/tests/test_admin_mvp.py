import unittest

try:
    from app.presenters.admin_presenter import render_admin_dashboard_html
    from services.admin_service import (
        build_admin_dashboard_context,
        build_admin_dns_provider_check_payload,
        load_admin_config_distribution,
    )
except ModuleNotFoundError:
    render_admin_dashboard_html = None
    build_admin_dashboard_context = None
    build_admin_dns_provider_check_payload = None
    load_admin_config_distribution = None


_APP_STACK_AVAILABLE = all(
    (
        callable(render_admin_dashboard_html),
        callable(build_admin_dashboard_context),
        callable(build_admin_dns_provider_check_payload),
        callable(load_admin_config_distribution),
    )
)


class _UsersRepo:
    def __init__(self, rows):
        self._rows = rows

    def get_all(self):
        return list(self._rows)


class _PaymentsRepo:
    def count_by_status(self, status):
        return 3 if status == "pending" else 0


class _ServiceRequestsRepo:
    def count_pending_by_kind(self, kind):
        return 2 if kind == "license_recovery" else 0


class _SecurityRepo:
    def count_active(self, _now_epoch):
        return 1


class _ConfigsDistributionRepo:
    def __init__(self, stored=None, legacy=None):
        self._stored = stored
        self._legacy = legacy or {}

    def get(self, key):
        if key == "config_distribution":
            return self._stored
        return None

    def get_all(self):
        return dict(self._legacy)


class _DB:
    def __init__(self, users, stored_distribution=None, legacy_distribution=None):
        self.users = _UsersRepo(users)
        self.payments = _PaymentsRepo()
        self.service_requests = _ServiceRequestsRepo()
        self.security = _SecurityRepo()
        self.configs_distribution = _ConfigsDistributionRepo(stored_distribution, legacy_distribution)


@unittest.skipUnless(
    _APP_STACK_AVAILABLE,
    "app/services modules are not available in this workspace snapshot",
)
class AdminMvpTests(unittest.TestCase):
    def test_build_admin_dashboard_context_counts_active_non_expired_users(self):
        db = _DB(
            [
                {"status": "active", "expired": False},
                {"status": "active", "expired": True},
                {"status": "blocked", "expired": False},
            ]
        )

        context = build_admin_dashboard_context(
            db=db,
            is_user_expired=lambda user: bool(user.get("expired")),
            now_epoch=123.0,
        )

        self.assertEqual(context["total_users"], 3)
        self.assertEqual(context["active_users"], 1)
        self.assertEqual(context["pending_payments"], 3)
        self.assertEqual(context["pending_recoveries"], 2)
        self.assertEqual(context["active_bans"], 1)
        self.assertEqual(context["admin_modules"], 12)

    def test_dns_provider_check_payload_marks_matching_ips(self):
        payload, status_code = build_admin_dns_provider_check_payload(
            value="Example.com",
            normalize_host=lambda value: str(value).lower(),
            resolve_dns_records=lambda host: (["104.16.0.1"], ["2606:4700::1111"]),
            checker=lambda ip: str(ip).startswith("104.") or str(ip).startswith("2606:"),
            item_flag_key="is_cloudflare",
            aggregate_key="any_cloudflare",
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(payload["kind"], "host")
        self.assertTrue(payload["any_cloudflare"])
        self.assertEqual(len(payload["ips"]), 2)
        self.assertTrue(all("is_cloudflare" in item for item in payload["ips"]))

    def test_load_distribution_uses_legacy_direct_entries(self):
        db = _DB([], stored_distribution=None, legacy_distribution={"offer_a": {"VIP": 2}, "config_templates": {"ignored": True}})
        self.assertEqual(load_admin_config_distribution(db=db), {"offer_a": {"VIP": 2}})


if __name__ == "__main__":
    unittest.main()
