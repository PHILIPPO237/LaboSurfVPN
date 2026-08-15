from __future__ import annotations

from typing import Any, Callable, Iterable

ROLE_CLIENT = "client"
ROLE_RESELLER = "reseller"
ROLE_ADMIN = "admin"
ROLE_SUPER_ADMIN = "super_admin"

PLAN_FREE = "free"
PLAN_PREMIUM = "premium"

PANEL_FREE = "free"
PANEL_PREMIUM = "premium"
PANEL_RESELLER = "reseller"
PANEL_ADMIN = "admin"

LEGACY_TYPE_FREE = "Gratuit"
LEGACY_TYPE_VIP = "VIP"
LEGACY_TYPE_PREMIUM = "PREMIUM"
LEGACY_TYPE_RESELLER = "Revendeur"
LEGACY_TYPE_ADMIN = "ADMIN"

_ROLE_CODES = {ROLE_CLIENT, ROLE_RESELLER, ROLE_ADMIN, ROLE_SUPER_ADMIN}
_PLAN_CODES = {PLAN_FREE, PLAN_PREMIUM}
_ADMIN_ROLE_CODES = {ROLE_ADMIN, ROLE_SUPER_ADMIN}

_LEGACY_TYPE_ALIASES = {
    "": LEGACY_TYPE_FREE,
    "gratuit": LEGACY_TYPE_FREE,
    "free": LEGACY_TYPE_FREE,
    "client": LEGACY_TYPE_FREE,
    "vip": LEGACY_TYPE_VIP,
    "premium": LEGACY_TYPE_PREMIUM,
    "prem": LEGACY_TYPE_PREMIUM,
    "revendeur": LEGACY_TYPE_RESELLER,
    "reseller": LEGACY_TYPE_RESELLER,
    "admin": LEGACY_TYPE_ADMIN,
}

_PANEL_ALIASES = {
    "": "",
    "free": PANEL_FREE,
    "gratuit": PANEL_FREE,
    "vip": PANEL_PREMIUM,
    "premium": PANEL_PREMIUM,
    "chat": PANEL_PREMIUM,
    "reseller": PANEL_RESELLER,
    "revendeur": PANEL_RESELLER,
    "admin": PANEL_ADMIN,
}

_HOME_PATHS = {
    PANEL_FREE: "/panel-gratuit",
    PANEL_PREMIUM: "/panel-vip",
    PANEL_RESELLER: "/panel-revendeur",
    PANEL_ADMIN: "/admin",
}

_ADMIN_PANEL_PERMISSIONS = {
    "admin.access",
    "admin.dashboard",
    "admin.users",
    "admin.users.edit",
    "admin.users.avatar",
    "admin.users.recharge",
    "admin.users.password.reset",
    "admin.users.delegate",
    "admin.tokens.manage",
    "admin.dns",
    "admin.security",
    "admin.keys",
    "admin.payment.settings",
    "admin.payments",
    "admin.notifications",
    "admin.messaging",
    "admin.ads",
}
# "admin.config" (generateur de configurations) est deliberement absent de la base
# ci-dessus : un admin ordinaire ne doit PAS l'avoir automatiquement. Seul le
# super-admin l'a par defaut (ajoute explicitement a ROLE_SUPER_ADMIN plus bas) ;
# un admin ordinaire ne l'obtient que si le super-admin le lui delegue explicitement
# depuis /admin/users/delegations (duree limitee, revocable a tout moment).

_ADMIN_PERMISSIONS = {
    "account.self.view",
    "messages.view",
    "payments.create",
    "payments.review",
    "users.manage",
    "ads.manage",
    "chat.moderate",
    "system.settings.manage",
    "panel.free.view",
    "panel.premium.view",
    "panel.reseller.view",
    "panel.admin.view",
} | _ADMIN_PANEL_PERMISSIONS

_ROLE_PERMISSIONS = {
    ROLE_CLIENT: {
        "account.self.view",
        "messages.view",
        "payments.create",
    },
    ROLE_RESELLER: {
        "account.self.view",
        "messages.view",
        "payments.create",
        "panel.reseller.view",
        "users.reseller.manage",
        "payments.reseller.view",
        "payments.reseller.settings",
        "ads.reseller.manage",
    },
    ROLE_ADMIN: set(_ADMIN_PERMISSIONS),
    ROLE_SUPER_ADMIN: set(_ADMIN_PERMISSIONS)
    | {
        "admin.config",
        "admin.root.manage",
        "admin.licenses.manage",
        "config.distribution.manage",
    },
}

_PLAN_PERMISSIONS = {
    PLAN_FREE: {
        "panel.free.view",
        "configs.generate.basic",
    },
    PLAN_PREMIUM: {
        "panel.free.view",
        "panel.premium.view",
        "configs.generate.basic",
        "configs.generate.advanced",
        "premium.features.view",
    },
}


def _normalize_role_code(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in _ROLE_CODES:
        return raw
    if raw in {"user", "member"}:
        return ROLE_CLIENT
    if raw in {"root", "superadmin", "super-admin", "super_admin"}:
        return ROLE_SUPER_ADMIN
    return ""


def _normalize_plan_code(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in _PLAN_CODES:
        return raw
    if raw in {"vip", "prem", "premium_plus"}:
        return PLAN_PREMIUM
    if raw in {"gratuit", "free", "basic"}:
        return PLAN_FREE
    return ""


def _normalize_panel_key(value: Any) -> str:
    raw = str(value or "").strip().lower()
    return _PANEL_ALIASES.get(raw, "")


def _as_user_id(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def canonicalize_legacy_user_type(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return LEGACY_TYPE_FREE
    alias = _LEGACY_TYPE_ALIASES.get(raw.lower())
    if alias:
        return alias
    return raw


def resolve_role_code(user: dict | None) -> str:
    if not isinstance(user, dict):
        return ROLE_CLIENT
    legacy_type = canonicalize_legacy_user_type(user.get("type"))
    user_id = _as_user_id(user.get("id"))
    explicit = _normalize_role_code(user.get("role_code"))
    if explicit == ROLE_ADMIN and legacy_type == LEGACY_TYPE_ADMIN and user_id == 1:
        return ROLE_SUPER_ADMIN
    if explicit:
        return explicit
    if legacy_type == LEGACY_TYPE_ADMIN:
        return ROLE_SUPER_ADMIN if user_id == 1 else ROLE_ADMIN
    if legacy_type == LEGACY_TYPE_RESELLER:
        return ROLE_RESELLER
    return ROLE_CLIENT


def resolve_plan_code(user: dict | None) -> str:
    if not isinstance(user, dict):
        return PLAN_FREE
    explicit = _normalize_plan_code(user.get("plan_code") or user.get("plan"))
    if explicit:
        return explicit
    legacy_type = canonicalize_legacy_user_type(user.get("type"))
    if legacy_type == LEGACY_TYPE_FREE:
        return PLAN_FREE
    return PLAN_PREMIUM


def is_admin_role(user: dict | None) -> bool:
    return resolve_role_code(user) in _ADMIN_ROLE_CODES


def has_root_access(user: dict | None) -> bool:
    return resolve_role_code(user) == ROLE_SUPER_ADMIN


def can_manage_user_lineage(
    actor: dict | None,
    target: dict | None,
    load_user_by_id: Callable[[int], dict | None] | None,
    *,
    max_depth: int = 32,
) -> bool:
    if not isinstance(actor, dict) or not isinstance(target, dict):
        return False

    actor_id = _as_user_id(actor.get("id"))
    target_id = _as_user_id(target.get("id"))
    if actor_id <= 0 or target_id <= 0:
        return False
    if actor_id == target_id:
        return True
    if has_root_access(actor):
        return True

    actor_role = resolve_role_code(actor)
    actor_permissions = get_effective_permissions(actor)
    target_role = resolve_role_code(target)
    can_manage_users = "users.manage" in actor_permissions or "admin.users.edit" in actor_permissions or "admin.users" in actor_permissions
    if actor_role not in {ROLE_ADMIN, ROLE_RESELLER} and not can_manage_users:
        return False
    if target_role in _ADMIN_ROLE_CODES and not has_root_access(actor):
        return False
    if not callable(load_user_by_id):
        return False

    visited = {target_id}
    current = dict(target)
    remaining = max(1, int(max_depth or 1))
    while remaining > 0:
        remaining -= 1
        parent_id = _as_user_id(current.get("reseller_id"))
        if parent_id <= 0:
            return False
        if parent_id == actor_id:
            return True
        if parent_id in visited:
            return False
        visited.add(parent_id)
        parent = load_user_by_id(parent_id)
        if not isinstance(parent, dict):
            return False
        current = dict(parent)
    return False


def get_effective_permissions(user: dict | None) -> set[str]:
    role_code = resolve_role_code(user)
    plan_code = resolve_plan_code(user)
    permissions = set(_ROLE_PERMISSIONS.get(role_code, set()))
    permissions.update(_PLAN_PERMISSIONS.get(plan_code, set()))

    if isinstance(user, dict):
        for key in (
            "permissions",
            "permission_codes",
            "effective_permissions",
            "delegated_permissions",
            "grant_permissions",
        ):
            value = user.get(key)
            if isinstance(value, str):
                cleaned = value.strip()
                if cleaned:
                    permissions.add(cleaned)
                continue
            if isinstance(value, Iterable):
                for item in value:
                    cleaned = str(item or "").strip()
                    if cleaned:
                        permissions.add(cleaned)
    if permissions.intersection(_ADMIN_PANEL_PERMISSIONS):
        permissions.add("panel.admin.view")
        permissions.add("admin.access")
    return permissions


def resolve_panel_key(user: dict | None) -> str:
    permissions = get_effective_permissions(user)
    if "panel.admin.view" in permissions:
        return PANEL_ADMIN
    if "panel.reseller.view" in permissions:
        return PANEL_RESELLER
    if "panel.premium.view" in permissions:
        return PANEL_PREMIUM
    return PANEL_FREE


def resolve_home_path(user: dict | None) -> str:
    # Route all users through dashboard first, then they can access their specific panel from there
    return "/dashboard"


def user_has_permission(user: dict | None, permission_code: str) -> bool:
    code = str(permission_code or "").strip()
    if not code:
        return True
    if has_root_access(user):
        return True
    permissions = get_effective_permissions(user)
    if code in permissions:
        return True
    if code.startswith("admin.") and "admin.access" in permissions:
        return True
    return False


def normalize_user_access_fields(user: dict | None) -> dict:
    if not isinstance(user, dict):
        return {}

    normalized = dict(user)
    normalized["type"] = canonicalize_legacy_user_type(normalized.get("type"))
    role_code = resolve_role_code(normalized)
    plan_code = resolve_plan_code(normalized)
    primary_panel_key = resolve_panel_key(
        {
            **normalized,
            "role_code": role_code,
            "plan_code": plan_code,
        }
    )
    default_panel_key = _normalize_panel_key(normalized.get("default_panel_key")) or primary_panel_key

    normalized["role_code"] = role_code
    normalized["plan_code"] = plan_code
    normalized["default_panel_key"] = default_panel_key
    normalized["primary_panel_key"] = primary_panel_key
    normalized["effective_permissions"] = sorted(
        get_effective_permissions(
            {
                **normalized,
                "role_code": role_code,
                "plan_code": plan_code,
                "default_panel_key": default_panel_key,
            }
        )
    )
    return normalized
