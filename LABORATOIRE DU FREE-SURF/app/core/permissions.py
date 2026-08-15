from __future__ import annotations
from typing import Any, Set

from app.core.access import get_effective_permissions, has_root_access


class PermissionEvaluator:
    """
    Évalue les permissions d'un utilisateur selon le modèle d'accès V2.
    Source d'autorité : role_permissions + plan_permissions + user_permissions
    """
    
    def __init__(self, db: Any):
        self.db = db

    def evaluate(self, user: dict, current_timestamp: float) -> Set[str]:
        if not user:
            return set()

        user_id = int(user.get("id", 0) or 0)

        role_code = str(user.get("role_code") or "").strip()
        if not role_code:
            role_code = self._map_legacy_role(user.get("type", ""))

        plan_codes = self._get_active_plans(user, current_timestamp)
        effective_permissions: Set[str] = set(get_effective_permissions(user))

        if hasattr(self.db, "role_permissions"):
            role_perms = self.db.role_permissions.get_by_role_code(role_code)
            effective_permissions.update(str(rp.get("permission_code", "") or "").strip() for rp in role_perms)

        if hasattr(self.db, "plan_permissions"):
            for plan_code in plan_codes:
                plan_perms = self.db.plan_permissions.get_by_plan_code(plan_code)
                effective_permissions.update(str(pp.get("permission_code", "") or "").strip() for pp in plan_perms)

        if hasattr(self.db, "user_permissions") and user_id:
            user_perms = self.db.user_permissions.get_by_user_id(user_id)
            for up in user_perms:
                expires_at = up.get("expires_at")
                if expires_at and float(expires_at) < current_timestamp:
                    continue
                perm_code = str(up.get("permission_code", "") or "").strip()
                if not perm_code:
                    continue
                if up.get("granted", True):
                    effective_permissions.add(perm_code)
                elif perm_code in effective_permissions:
                    effective_permissions.discard(perm_code)

        grants_repo = getattr(self.db, "delegated_admin_grants", None)
        if grants_repo is not None and callable(getattr(grants_repo, "get_active_for_user", None)) and user_id > 0:
            for grant in grants_repo.get_active_for_user(user_id, current_timestamp):
                for permission_code in grant.get("permission_codes", []) or []:
                    cleaned = str(permission_code or "").strip()
                    if cleaned:
                        effective_permissions.add(cleaned)

        if not effective_permissions:
            effective_permissions = self._get_legacy_permissions(role_code, plan_codes)

        effective_permissions = {code for code in effective_permissions if str(code or "").strip()}
        if has_root_access(user):
            effective_permissions.update({"admin.root.manage", "admin.access", "panel.admin.view", "admin.config"})
        if any(code.startswith("admin.") for code in effective_permissions):
            effective_permissions.update({"admin.access", "panel.admin.view"})
        return effective_permissions

    def _map_legacy_role(self, legacy_type: str) -> str:
        legacy_type = str(legacy_type or "Gratuit").strip().upper()
        if legacy_type == "ADMIN":
            return "admin"
        if legacy_type == "REVENDEUR":
            return "reseller"
        return "client"

    def _get_active_plans(self, user: dict, current_timestamp: float) -> list[str]:
        user_id = user.get("id")
        
        # Lecture depuis les nouvelles tables si elles existent
        if hasattr(self.db, "user_plans") and user_id:
            active_plans = self.db.user_plans.get_active_for_user(user_id, current_timestamp)
            if active_plans:
                return [p["plan_code"] for p in active_plans]
                
        # Fallback legacy basé sur le type (VIP/PREMIUM = premium, etc.)
        legacy_type = str(user.get("type", "Gratuit")).strip().upper()
        if legacy_type in ("VIP", "PREMIUM", "ADMIN", "REVENDEUR"):
            return ["premium"]
        return ["free"]

    def _get_legacy_permissions(self, role_code: str, plan_codes: list[str]) -> Set[str]:
        """Mapping en dur des permissions de base en attendant que la DB soit remplie."""
        perms = set()
        
        if "free" in plan_codes or "premium" in plan_codes:
            perms.update({"configs.generate.basic", "payments.create", "account.self.view"})
            
        if role_code == "client":
            if "free" in plan_codes:
                perms.add("panel.free.view")
            if "premium" in plan_codes:
                perms.update({"panel.premium.view", "configs.generate.advanced", "premium.features.view"})
        elif role_code == "reseller":
            perms.update({"panel.reseller.view", "users.reseller.manage", "payments.reseller.view", "payments.reseller.settings", "configs.generate.advanced"})
        elif role_code == "admin":
            perms.update({"panel.admin.view", "users.manage", "payments.review", "ads.manage", "chat.moderate", "system.settings.manage"})
            
        return perms


def has_permission(user: dict, permission: str, evaluator: PermissionEvaluator, current_timestamp: float) -> bool:
    """
    Vérifie si un utilisateur possède une permission donnée.
    Utile pour les guards de FastAPI (ex: require_permission).
    """
    if not user:
        return False
    perms = evaluator.evaluate(user, current_timestamp)
    return permission in perms