from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.core.runtime_support import RuntimeSupport


class _UsersRepo:
    def __init__(self, admins: list[dict], extra_license_rows: list[dict] | None = None) -> None:
        self._admins = [dict(row) for row in admins]
        self._license_index: dict[str, dict] = {}
        self.saved: list[dict] = []

        for row in self._admins + list(extra_license_rows or []):
            license_key = str(row.get("license", "") or "").strip()
            if license_key:
                self._license_index[license_key] = dict(row)

    def get_by_type(self, user_type: str) -> list[dict]:
        if user_type != "ADMIN":
            return []
        return [dict(row) for row in self._admins]

    def username_exists(self, username: str) -> bool:
        normalized = str(username or "").strip().lower()
        return any(str(row.get("username", "") or "").strip().lower() == normalized for row in self._admins)

    def get_by_license(self, license_key: str) -> dict | None:
        row = self._license_index.get(str(license_key or "").strip())
        return dict(row) if isinstance(row, dict) else None

    def save(self, user: dict) -> dict:
        saved = dict(user)
        self.saved.append(saved)
        license_key = str(saved.get("license", "") or "").strip()
        if license_key:
            self._license_index[license_key] = dict(saved)
        return saved


class _DB:
    def __init__(self, users_repo: _UsersRepo) -> None:
        self.users = users_repo


class RuntimeSupportAdminBootstrapTests(unittest.TestCase):
    def _make_support(self, users_repo: _UsersRepo, *, admin_secret: str, generated_license: str = "LIC-GENERATED") -> RuntimeSupport:
        cfg = SimpleNamespace(ADMIN_LICENSE="", PRIMARY_3XUI_UUID="uuid-primary")
        return RuntimeSupport(
            cfg=cfg,
            db=_DB(users_repo),
            now_ts=lambda: "2026-03-19T00:00:00",
            read_template=lambda _name: None,
            html_response=lambda content, status_code=200: content,
            generate_license_key=lambda: generated_license,
            generate_uuid=lambda: "uuid-secondary",
            as_bool=bool,
            load_admin_password=lambda: admin_secret,
            hash_password=lambda value: f"hashed::{value}",
        )

    def test_existing_root_admin_keeps_own_license_when_bootstrap_secret_is_taken(self) -> None:
        admin_row = {
            "id": 1,
            "username": "PHILIPPO237",
            "type": "ADMIN",
            "role_code": "super_admin",
            "status": "active",
            "license": "LIC-ADMIN",
        }
        conflicting_user = {
            "id": 42,
            "username": "CLIENT42",
            "type": "VIP",
            "role_code": "",
            "status": "active",
            "license": "LIC-CONFLICT",
        }
        users_repo = _UsersRepo([admin_row], [conflicting_user])
        support = self._make_support(users_repo, admin_secret="LIC-CONFLICT", generated_license="LIC-FALLBACK")

        support.ensure_default_admin()

        self.assertEqual(len(users_repo.saved), 1)
        saved = users_repo.saved[0]
        self.assertEqual(saved["license"], "LIC-ADMIN")
        self.assertEqual(saved["role_code"], "super_admin")
        self.assertEqual(saved["default_panel_key"], "admin")
        self.assertEqual(saved["password_hash"], "hashed::LIC-CONFLICT")
        self.assertEqual(saved["status"], "active")

    def test_new_root_admin_gets_generated_license_when_bootstrap_secret_is_taken(self) -> None:
        conflicting_user = {
            "id": 42,
            "username": "CLIENT42",
            "type": "VIP",
            "role_code": "",
            "status": "active",
            "license": "LIC-CONFLICT",
        }
        users_repo = _UsersRepo([], [conflicting_user])
        support = self._make_support(users_repo, admin_secret="LIC-CONFLICT", generated_license="LIC-FALLBACK")

        support.ensure_default_admin()

        self.assertEqual(len(users_repo.saved), 1)
        saved = users_repo.saved[0]
        self.assertEqual(saved["username"], "PHILIPPO237")
        self.assertEqual(saved["license"], "LIC-FALLBACK")
        self.assertEqual(saved["role_code"], "super_admin")
        self.assertEqual(saved["default_panel_key"], "admin")
        self.assertEqual(saved["password_hash"], "hashed::LIC-CONFLICT")
        self.assertEqual(saved["status"], "active")


if __name__ == "__main__":
    unittest.main()
