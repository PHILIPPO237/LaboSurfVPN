from __future__ import annotations
from typing import Any, Set
from app.core.permissions import PermissionEvaluator

class AccessService:
    """Service centralisant la vérification des permissions (Modèle V2)."""
    
    def __init__(self, db: Any):
        self.evaluator = PermissionEvaluator(db)

    def get_user_permissions(self, user: dict, current_timestamp: float) -> Set[str]:
        return self.evaluator.evaluate(user, current_timestamp)

    def has_permission(self, user: dict, permission_code: str, current_timestamp: float) -> bool:
        if not user:
            return False
        perms = self.get_user_permissions(user, current_timestamp)
        return permission_code in perms

    def has_any_permission(self, user: dict, permission_codes: Set[str], current_timestamp: float) -> bool:
        if not user:
            return False
        perms = self.get_user_permissions(user, current_timestamp)
        return bool(perms.intersection(permission_codes))