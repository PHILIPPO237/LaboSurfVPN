"""
Configuration module for LABORATOIRE DU FREE-SURF
This file provides default configuration values.
"""

import logging
import os
import warnings
from pathlib import Path

try:
    from dotenv import dotenv_values
except Exception:  # pragma: no cover - optional dependency at import time
    dotenv_values = None


_CONFIG_DIR = Path(__file__).resolve().parent.parent.parent  # racine du projet (app/core/ -> app/ -> racine)
_DEFAULT_ENV_FILE = _CONFIG_DIR / ".env"

# Expose la racine du projet sous le nom que le reste du code attend (cfg.BASE_DIR).
# Sans cette ligne, cfg.BASE_DIR n'existait pas du tout -> AttributeError silencieuse
# dans Helpers.load_admin_password(), qui rendait impossible tout hachage du mot de
# passe admin au demarrage (symptome : password_hash restait toujours vide, sans
# aucun message d'erreur visible, l'exception etant avalee plus haut dans la chaine).
BASE_DIR = _CONFIG_DIR


def _resolve_env_path(value: str | None) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    candidate = Path(text).expanduser()
    if not candidate.is_absolute():
        candidate = _CONFIG_DIR / candidate
    return candidate


def _profile_env_path() -> Path | None:
    profile = str(os.getenv("FS_ENV", "") or "").strip().lower()
    if not profile:
        return None
    safe_profile = "".join(ch for ch in profile if ch.isalnum() or ch in ("-", "_"))
    if not safe_profile:
        return None
    return _CONFIG_DIR / f".env.{safe_profile}"


def _selected_env_files() -> list[Path]:
    files: list[Path] = []
    seen: set[str] = set()

    def add(path: Path | None) -> None:
        if path is None:
            return
        normalized = str(path.resolve(strict=False))
        if normalized in seen:
            return
        seen.add(normalized)
        files.append(path)

    add(_DEFAULT_ENV_FILE)
    explicit = _resolve_env_path(os.getenv("FS_ENV_FILE"))
    if explicit is not None:
        add(explicit)
        return files

    add(_profile_env_path())
    return files


def _parse_env_file(path: Path) -> dict[str, str]:
    if callable(dotenv_values):
        return {
            str(key): str(value)
            for key, value in dotenv_values(path).items()
            if value is not None
        }

    parsed: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        parsed[key] = value
    return parsed


def _load_selected_env_files() -> None:
    env_files = [path for path in _selected_env_files() if path.is_file()]
    if not env_files:
        return

    merged: dict[str, str] = {}
    for env_file in env_files:
        merged.update(_parse_env_file(env_file))

    for key, value in merged.items():
        os.environ.setdefault(key, value)


_load_selected_env_files()


def _env(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value not in (None, ""):
            return value
    return default


def _env_int(*names: str, default: int) -> int:
    value = _env(*names)
    if value is None:
        return default
    return int(value)


def _env_bool(*names: str, default: bool = False) -> bool:
    value = _env(*names)
    if value is None:
        return default
    return str(value).lower() in ("true", "1", "yes", "on")


# ============================================================================
# SECURITY CONFIGURATION
# ============================================================================
_VIP_COOKIE_SECRET = _env("FS_CSRF_SECRET", "FS_VIP_SECRET", "VIP_COOKIE_SECRET", default="dev-vip-cookie-secret-change-me")
if _VIP_COOKIE_SECRET == "dev-vip-cookie-secret-change-me":
    warnings.warn(
        "VIP_COOKIE_SECRET utilise la valeur par defaut de developpement. "
        "Definissez FS_CSRF_SECRET ou VIP_COOKIE_SECRET en variable d'environnement en production.",
        stacklevel=1,
    )
    logging.getLogger(__name__).warning(
        "[SECURITY] VIP_COOKIE_SECRET is using the default dev value - set FS_CSRF_SECRET env var in production!"
    )

# ============================================================================
# AUTHENTICATION & SESSION
# ============================================================================
_LOGIN_RATE_WINDOW = _env_int("FS_LOGIN_RATE_WINDOW", "LOGIN_RATE_WINDOW", default=60)
_LOGIN_RATE_MAX = _env_int("FS_LOGIN_RATE_MAX", "LOGIN_RATE_MAX", default=5)
_COOKIE_SECURE = _env_bool("FS_COOKIE_SECURE", "COOKIE_SECURE", default=False)
SESSION_COOKIE = _env("FS_SESSION_COOKIE", "SESSION_COOKIE", default="labo_session")
SESSION_TTL_SECONDS = _env_int("FS_SESSION_TTL_SECONDS", "SESSION_TTL_SECONDS", default=1800)
CSRF_COOKIE = _env("FS_CSRF_COOKIE", "CSRF_COOKIE", default="labo_csrf")
CAPTCHA_TOKEN_TTL_SECONDS = _env_int("FS_CAPTCHA_TOKEN_TTL_SECONDS", "CAPTCHA_TOKEN_TTL_SECONDS", default=1200)

# ============================================================================
# DATABASE
# ============================================================================
FS_DB_PATH = _env("FS_DB_PATH", default="labo.db")

# ============================================================================
# APPLICATION
# ============================================================================
APP_NAME = _env("FS_APP_NAME", "APP_NAME", default="LABORATOIRE DU FREE-SURF")
PANEL_BACKEND = _env("FS_PANEL_BACKEND", "PANEL_BACKEND", default=None)
FS_APP_PUBLIC_HOST = _env("FS_APP_PUBLIC_HOST", default="")
FS_PANEL_HOST = _env("FS_PANEL_HOST", default="")
PRIMARY_3XUI_UUID = _env("FS_PRIMARY_3XUI_UUID", "PRIMARY_3XUI_UUID", default="")
DEFAULT_VLESS_PATH = _env("FS_DEFAULT_VLESS_PATH", "DEFAULT_VLESS_PATH", default="/")

# ============================================================================
# PANEL 3X-UI
# ============================================================================
# Auth par token API (Settings > Security > API Token dans le panel) - prioritaire,
# evite le cycle login/cookie. Si absent, repli sur XUI_USERNAME/XUI_PASSWORD.
XUI_BASE_URL = _env("FS_XUI_URL", "XUI_BASE_URL", default="")
XUI_API_TOKEN = _env("FS_XUI_TOKEN", "XUI_API_TOKEN", default="")
XUI_USERNAME = _env("FS_XUI_USER", "XUI_USERNAME", default="")
XUI_PASSWORD = _env("FS_XUI_PASS", "XUI_PASSWORD", default="")
XUI_PUBLIC_IP = _env("FS_XUI_PUBLIC_IP", "XUI_PUBLIC_IP", default="")
PANEL_DEFAULT_HOST = _env("FS_PANEL_DEFAULT_HOST", "PANEL_DEFAULT_HOST", default="")
PANEL_HTTP_TIMEOUT_SECONDS = float(_env("FS_PANEL_HTTP_TIMEOUT_SECONDS", default="4.0") or 4.0)
PANEL_CACHE_TTL_SECONDS = float(_env("FS_PANEL_CACHE_TTL_SECONDS", default="60.0") or 60.0)

# Provisioning 3x-ui : pousse l'UUID maitre genere par le panel (uuid_secondary)
# comme client sur l'inbound VLESS cible. Le panel reste la source de verite ;
# 3x-ui ne fait que recevoir/refleter cet UUID, jamais l'inverse.
XUI_PROVISION_ENABLED = _env_bool("FS_XUI_PROVISION_ENABLED", "XUI_PROVISION_ENABLED", default=False)
XUI_PROVISION_ENFORCE = _env_bool("FS_XUI_PROVISION_ENFORCE", "XUI_PROVISION_ENFORCE", default=False)
XUI_PROVISION_TIMEOUT_SECONDS = _env_int("FS_XUI_PROVISION_TIMEOUT_SECONDS", "XUI_PROVISION_TIMEOUT_SECONDS", default=20)
XUI_INBOUND_ID = _env_int("FS_XUI_INBOUND_ID", "XUI_INBOUND_ID", default=0)

# ============================================================================
# UVICORN SERVER
# ============================================================================
UVICORN_HOST = _env("FS_UVICORN_HOST", "UVICORN_HOST", default="127.0.0.1")
UVICORN_PORT = _env_int("FS_UVICORN_PORT", "UVICORN_PORT", default=8000)
UVICORN_RELOAD = _env_bool("FS_UVICORN_RELOAD", "UVICORN_RELOAD", default=False)

# ============================================================================
# LOGGING
# ============================================================================
LOG_LEVEL = _env("FS_LOG_LEVEL", "LOG_LEVEL", default="info")

# ============================================================================
# TEMPLATES & STATIC
# ============================================================================
# Chemins absolus (ancres sur BASE_DIR) : evite exactement le meme piege que
# .admin_password avant correction -- un chemin relatif comme "static" depend
# du dossier depuis lequel `python main.py` est lance, et peut echouer en
# silence (ou pire, pointer vers un mauvais dossier) si ce n'est pas
# exactement la racine du projet. Reste modifiable via FS_STATIC_DIR /
# FS_TEMPLATES_DIR pour qui veut un chemin different.
TEMPLATES_DIR = _env("FS_TEMPLATES_DIR", "TEMPLATES_DIR", default=str(BASE_DIR / "templates"))
STATIC_DIR = _env("FS_STATIC_DIR", "STATIC_DIR", default=str(BASE_DIR / "static"))

# ============================================================================
# CYCLE DE VIE DE L'ABONNEMENT (retrogradation automatique)
# ============================================================================
# Nombre de jours apres expiration avant retrogradation automatique vers Gratuit.
# Pendant cette periode, des rappels sont envoyes regulierement au client.
SUBSCRIPTION_GRACE_PERIOD_CLIENT_DAYS = _env_int("FS_SUBSCRIPTION_GRACE_PERIOD_CLIENT_DAYS", "SUBSCRIPTION_GRACE_PERIOD_CLIENT_DAYS", default=3)
SUBSCRIPTION_GRACE_PERIOD_RESELLER_DAYS = _env_int("FS_SUBSCRIPTION_GRACE_PERIOD_RESELLER_DAYS", "SUBSCRIPTION_GRACE_PERIOD_RESELLER_DAYS", default=7)
# Conserve pour compatibilite (utilise seulement si le type n'est ni client ni revendeur)
SUBSCRIPTION_GRACE_PERIOD_DAYS = _env_int("FS_SUBSCRIPTION_GRACE_PERIOD_DAYS", "SUBSCRIPTION_GRACE_PERIOD_DAYS", default=5)
# Intervalle (en heures) entre deux passages du controleur d'expiration.
SUBSCRIPTION_LIFECYCLE_INTERVAL_HOURS = _env_int("FS_SUBSCRIPTION_LIFECYCLE_INTERVAL_HOURS", "SUBSCRIPTION_LIFECYCLE_INTERVAL_HOURS", default=6)


# Alias conserve pour compatibilite avec le reste du code (from app.core.config import cfg)
import sys as _sys
cfg = _sys.modules[__name__]
