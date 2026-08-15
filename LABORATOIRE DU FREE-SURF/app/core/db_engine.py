# -*- coding: utf-8 -*-
"""
database.py â€” Couche SQLite pour FreeSurf / Labo App
Remplace tous les fichiers JSON par une seule base SQLite thread-safe.

Usage:
    from database import db
    db.init()                          # Ã  appeler au dÃ©marrage (crÃ©e les tables)
    users = db.users.get_all()
    db.users.save(user_dict)
    db.payments.add(payment_dict)
    ...

Migration depuis JSON:
    python database.py migrate         # importe les JSON existants â†’ SQLite
"""

import json
import os
import asyncio
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import aiosqlite

from app.core.access import normalize_user_access_fields

# ==============================================================================
# CONFIGURATION
# ==============================================================================
BASE_DIR = Path(__file__).resolve().parent.parent.parent  # racine du projet (app/core/ -> app/ -> racine)
_DEFAULT_DB_PATH = BASE_DIR / "labo.db"

# Prefer a local non-synced DB when the project lives in cloud-synced folders.
_db_path_env = str(os.getenv("FS_DB_PATH", "") or "").strip()
if _db_path_env:
    DB_PATH = Path(_db_path_env).expanduser()
else:
    base_as_text = str(BASE_DIR).lower()
    is_cloud_synced = "mon drive" in base_as_text or "google drive" in base_as_text or "onedrive" in base_as_text
    if is_cloud_synced:
        local_root = Path(os.getenv("LOCALAPPDATA") or str(BASE_DIR))
        DB_PATH = local_root / "FreeSurfLab" / "labo.db"
    else:
        DB_PATH = _DEFAULT_DB_PATH

DB_PATH.parent.mkdir(parents=True, exist_ok=True)
if DB_PATH != _DEFAULT_DB_PATH and _DEFAULT_DB_PATH.exists() and not DB_PATH.exists():
    try:
        DB_PATH.write_bytes(_DEFAULT_DB_PATH.read_bytes())
    except Exception:
        pass
DB_PATH = str(DB_PATH)

# Anciens fichiers JSON (pour la migration)
_JSON_FILES = {
    "users":         str(BASE_DIR / "labo_users.json"),
    "archive":       str(BASE_DIR / "labo_archive.json"),
    "vip_tokens":    str(BASE_DIR / "labo_vip_tokens.json"),
    "service_requests": str(BASE_DIR / "labo_service_requests.json"),
    "tchat":         str(BASE_DIR / "labo_tchat_messages.json"),
    "private_messages": str(BASE_DIR / "labo_private_messages.json"),
    "udp_results":   str(BASE_DIR / "labo_udp_results.json"),
    "configs_distribution": str(BASE_DIR / "labo_configs_distribution.json"),
    "payments":      str(BASE_DIR / "labo_payments.json"),
    "ads":           str(BASE_DIR / "ads.json"),
    "activation_keys": str(BASE_DIR / "labo_activation_keys.json"),
    "tchat_quotas":  str(BASE_DIR / ".tchat_quotas.json"),
    "sessions":      str(BASE_DIR / ".sessions.json"),
}

# ==============================================================================
# CONNEXION THREAD-SAFE
# ==============================================================================
_conn: Optional[aiosqlite.Connection] = None

async def _get_conn() -> aiosqlite.Connection:
    """Connexion asynchrone unique (aiosqlite gère son propre thread worker en arrière-plan)."""
    global _conn
    if _conn is None:
        _conn = await aiosqlite.connect(DB_PATH)
        _conn.row_factory = aiosqlite.Row
        await _conn.execute("PRAGMA journal_mode=WAL")
        await _conn.execute("PRAGMA synchronous=NORMAL")
        await _conn.execute("PRAGMA foreign_keys=ON")
        await _conn.execute("PRAGMA temp_store=MEMORY")
        await _conn.execute("PRAGMA busy_timeout=5000")
        await _conn.execute("PRAGMA wal_autocheckpoint=1000")
        await _conn.execute("PRAGMA cache_size=-20000")
        await _conn.execute("PRAGMA mmap_size=134217728")
    return _conn

@asynccontextmanager
async def _tx():
    """Context manager pour une transaction atomique."""
    conn = await _get_conn()
    try:
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise

# ==============================================================================
# CRÃ‰ATION DES TABLES
# ==============================================================================
_SCHEMA = """
-- Utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    contact              TEXT    NOT NULL DEFAULT '',
    password_hash        TEXT    NOT NULL DEFAULT '',
    service_password      TEXT    NOT NULL DEFAULT '',
    type                 TEXT    NOT NULL DEFAULT 'Gratuit',
    role_code            TEXT    NOT NULL DEFAULT '',
    default_panel_key    TEXT    NOT NULL DEFAULT '',
    status               TEXT    NOT NULL DEFAULT 'active',
    license              TEXT    NOT NULL UNIQUE,
    uuid_secondary       TEXT    NOT NULL DEFAULT '',
    recovery_secret_hash TEXT    NOT NULL DEFAULT '',
    forbidden_attempts   INTEGER NOT NULL DEFAULT 0,
    last_forbidden_need  TEXT    NOT NULL DEFAULT '',
    last_forbidden_at    TEXT    NOT NULL DEFAULT '',
    avatar               TEXT    NOT NULL DEFAULT '',
    quota_gb             REAL,
    limit_ip             INTEGER NOT NULL DEFAULT 0,
    om_number            TEXT    NOT NULL DEFAULT '',
    momo_number          TEXT    NOT NULL DEFAULT '',
    allow_custom_payments INTEGER NOT NULL DEFAULT 0,
    reseller_id          INTEGER NOT NULL DEFAULT 0,
    expiration           TEXT    NOT NULL DEFAULT '',
    notes                TEXT    NOT NULL DEFAULT '',
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_license  ON users(license);
CREATE INDEX IF NOT EXISTS idx_users_type     ON users(type);
CREATE INDEX IF NOT EXISTS idx_users_role_code ON users(role_code);
CREATE INDEX IF NOT EXISTS idx_users_reseller_id ON users(reseller_id);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    username   TEXT    NOT NULL,
    expires_at REAL    NOT NULL,
    created_at REAL    NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_user ON sessions(expires_at, user_id);

-- Tokens VIP
CREATE TABLE IF NOT EXISTS vip_tokens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    token          TEXT    NOT NULL UNIQUE,
    type           TEXT    NOT NULL DEFAULT 'VIP',
    duration_label TEXT    NOT NULL DEFAULT '',
    is_used        INTEGER NOT NULL DEFAULT 0,
    used_by_user_id INTEGER,
    used_by_username TEXT NOT NULL DEFAULT '',
    used_at        TEXT    NOT NULL DEFAULT '',
    expires_at     REAL    NOT NULL,
    created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vip_tokens_token ON vip_tokens(token);
CREATE INDEX IF NOT EXISTS idx_vip_tokens_unused ON vip_tokens(is_used);

CREATE TABLE IF NOT EXISTS promo_codes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    NOT NULL UNIQUE,
    bonus_days   INTEGER NOT NULL DEFAULT 0,
    max_uses     INTEGER NOT NULL DEFAULT 1,
    times_used   INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    expires_at   TEXT    NOT NULL DEFAULT '',
    notes        TEXT    NOT NULL DEFAULT '',
    created_by   TEXT    NOT NULL DEFAULT 'ADMIN',
    created_at   TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_code_redemptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_code_id INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    username     TEXT    NOT NULL DEFAULT '',
    redeemed_at  TEXT    NOT NULL,
    UNIQUE(promo_code_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);


-- Paiements
CREATE TABLE IF NOT EXISTS payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,
    recipient_id INTEGER DEFAULT 0, -- 0 pour Admin, sinon ID du Revendeur
    service_request_id INTEGER DEFAULT NULL, -- Lien vers service_requests.id
    username     TEXT    NOT NULL DEFAULT '',
    provider     TEXT    NOT NULL DEFAULT '',
    amount       REAL    NOT NULL DEFAULT 0,
    currency     TEXT    NOT NULL DEFAULT 'XAF',
    plan         TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'pending',
    reference    TEXT    NOT NULL DEFAULT '',
    phone        TEXT    NOT NULL DEFAULT '',
    raw_response TEXT    NOT NULL DEFAULT '{}',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user_id   ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference);
CREATE INDEX IF NOT EXISTS idx_payments_service_request ON payments(service_request_id);

-- Messages tchat public
CREATE TABLE IF NOT EXISTS tchat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    username   TEXT    NOT NULL,
    content    TEXT    NOT NULL DEFAULT '',
    msg_type   TEXT    NOT NULL DEFAULT 'text',
    file_url   TEXT    NOT NULL DEFAULT '',
    reactions  TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tchat_created_at ON tchat_messages(created_at);

-- Messages privÃ©s
CREATE TABLE IF NOT EXISTS private_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER,
    sender      TEXT    NOT NULL,
    recipient   TEXT    NOT NULL,
    content     TEXT    NOT NULL DEFAULT '',
    msg_type    TEXT    NOT NULL DEFAULT 'text',
    file_url    TEXT    NOT NULL DEFAULT '',
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pm_sender    ON private_messages(sender);
CREATE INDEX IF NOT EXISTS idx_pm_recipient ON private_messages(recipient);
CREATE INDEX IF NOT EXISTS idx_pm_created   ON private_messages(created_at);

-- RÃ©sultats scans UDP
CREATE TABLE IF NOT EXISTS udp_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id    TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL,
    operator   TEXT    NOT NULL DEFAULT '',
    label      TEXT    NOT NULL DEFAULT '',
    dns_open   INTEGER NOT NULL DEFAULT 0,
    ntp_open   INTEGER NOT NULL DEFAULT 0,
    quic_open  INTEGER NOT NULL DEFAULT 0,
    latency    TEXT    NOT NULL DEFAULT '',
    raw        TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_udp_scan_id ON udp_results(scan_id);

-- Archive SNI / configs
CREATE TABLE IF NOT EXISTS archive (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sni        TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL DEFAULT '',
    port       INTEGER NOT NULL DEFAULT 80,
    status     INTEGER NOT NULL DEFAULT 0,
    latency    TEXT    NOT NULL DEFAULT '',
    valid      INTEGER NOT NULL DEFAULT 0,
    config     TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_sni     ON archive(sni);
CREATE INDEX IF NOT EXISTS idx_archive_valid   ON archive(valid);
CREATE INDEX IF NOT EXISTS idx_archive_created ON archive(created_at DESC);

-- Distribution configs
CREATE TABLE IF NOT EXISTS configs_distribution (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL UNIQUE,
    value      TEXT    NOT NULL DEFAULT '{}',
    updated_at TEXT    NOT NULL
);

-- ClÃ©s d'activation
CREATE TABLE IF NOT EXISTS activation_keys (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    key              TEXT    NOT NULL UNIQUE,
    user_type        TEXT    NOT NULL DEFAULT 'VIP',
    duration_days    INTEGER NOT NULL DEFAULT 30,
    notes            TEXT    NOT NULL DEFAULT '',
    is_used          INTEGER NOT NULL DEFAULT 0,
    used_by_user_id  INTEGER,
    used_by_username TEXT    NOT NULL DEFAULT '',
    used_at          TEXT    NOT NULL DEFAULT '',
    created_by       TEXT    NOT NULL DEFAULT 'ADMIN',
    created_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activation_key    ON activation_keys(key);
CREATE INDEX IF NOT EXISTS idx_activation_unused ON activation_keys(is_used);

-- Quotas tchat (journaliers)
CREATE TABLE IF NOT EXISTS tchat_quotas (
    username   TEXT    NOT NULL,
    date       TEXT    NOT NULL,
    files      INTEGER NOT NULL DEFAULT 0,
    links      INTEGER NOT NULL DEFAULT 0,
    last_msg   REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (username, date)
);

-- PublicitÃ©s
CREATE TABLE IF NOT EXISTS ads (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    text     TEXT    NOT NULL,
    link     TEXT    NOT NULL DEFAULT '',
    active   INTEGER NOT NULL DEFAULT 1,
    locations TEXT   NOT NULL DEFAULT '["chat"]',
    priority INTEGER NOT NULL DEFAULT 1,
    color    TEXT    NOT NULL DEFAULT '#39ff14',
    image    TEXT    NOT NULL DEFAULT '',
    style    TEXT    NOT NULL DEFAULT 'neon'
);

-- Demandes de service
CREATE TABLE IF NOT EXISTS service_requests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                 TEXT    NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'pending',
    username             TEXT    NOT NULL,
    target_user_id       INTEGER,
    submitted_by_user_id INTEGER,
    content              TEXT    NOT NULL DEFAULT '{}',
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_requests_kind_status ON service_requests(kind, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_kind_status_username ON service_requests(kind, status, username);

-- Scanner State (main)
CREATE TABLE IF NOT EXISTS scanner_state (
    id             INTEGER PRIMARY KEY DEFAULT 1, -- Singleton
    running        INTEGER NOT NULL DEFAULT 0,
    progress       INTEGER NOT NULL DEFAULT 0,
    total          INTEGER NOT NULL DEFAULT 0,
    current_target TEXT    NOT NULL DEFAULT '',
    current_engine TEXT    NOT NULL DEFAULT '',
    hits           TEXT    NOT NULL DEFAULT '[]', -- JSON
    found_snis     TEXT    NOT NULL DEFAULT '[]', -- JSON
    updated_at     TEXT    NOT NULL
);

-- UDP Scanner State
CREATE TABLE IF NOT EXISTS udp_scanner_state (
    id             INTEGER PRIMARY KEY DEFAULT 1, -- Singleton
    running        INTEGER NOT NULL DEFAULT 0,
    progress       INTEGER NOT NULL DEFAULT 0,
    total          INTEGER NOT NULL DEFAULT 0,
    results        TEXT    NOT NULL DEFAULT '[]', -- JSON
    updated_at     TEXT    NOT NULL
);

-- Scanner Jobs
CREATE TABLE IF NOT EXISTS scan_jobs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id               TEXT    NOT NULL UNIQUE,
    job_kind             TEXT    NOT NULL DEFAULT '',
    status               TEXT    NOT NULL DEFAULT 'queued',
    created_by_username  TEXT    NOT NULL DEFAULT '',
    requested_range      TEXT    NOT NULL DEFAULT '',
    requested_operator   TEXT    NOT NULL DEFAULT '',
    requested_sni        TEXT    NOT NULL DEFAULT '',
    engine_name          TEXT    NOT NULL DEFAULT '',
    mode                 TEXT    NOT NULL DEFAULT '',
    job_context_json     TEXT    NOT NULL DEFAULT '{}',
    request_payload_json TEXT    NOT NULL DEFAULT '{}',
    summary_json         TEXT    NOT NULL DEFAULT '{}',
    hits_json            TEXT    NOT NULL DEFAULT '[]',
    error_text           TEXT    NOT NULL DEFAULT '',
    started_at           TEXT    NOT NULL DEFAULT '',
    finished_at          TEXT    NOT NULL DEFAULT '',
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_job_kind ON scan_jobs(job_kind);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_created_by ON scan_jobs(created_by_username);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_created_at ON scan_jobs(created_at DESC);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    title        TEXT    NOT NULL DEFAULT '',
    message      TEXT    NOT NULL DEFAULT '',
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- IP Security (Captcha Bans)
CREATE TABLE IF NOT EXISTS ip_security (
    ip          TEXT PRIMARY KEY,
    fail_count  INTEGER NOT NULL DEFAULT 0,
    banned_until REAL NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_security_banned_until ON ip_security(banned_until);

-- Delegations temporaires de droits admin
CREATE TABLE IF NOT EXISTS delegated_admin_grants (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user_id     INTEGER NOT NULL,
    target_username    TEXT    NOT NULL DEFAULT '',
    granted_by_user_id INTEGER NOT NULL DEFAULT 0,
    granted_by_username TEXT   NOT NULL DEFAULT '',
    permission_codes   TEXT    NOT NULL DEFAULT '[]',
    notes              TEXT    NOT NULL DEFAULT '',
    starts_at          REAL    NOT NULL DEFAULT 0,
    expires_at         REAL    NOT NULL DEFAULT 0,
    revoked_at         REAL    NOT NULL DEFAULT 0,
    revoked_by_username TEXT   NOT NULL DEFAULT '',
    created_at         TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegated_admin_grants_target_user ON delegated_admin_grants(target_user_id);
CREATE INDEX IF NOT EXISTS idx_delegated_admin_grants_expires_at ON delegated_admin_grants(expires_at);

-- Tokens d'action lies a un compte
CREATE TABLE IF NOT EXISTS account_action_tokens (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    token              TEXT    NOT NULL UNIQUE,
    purpose            TEXT    NOT NULL DEFAULT 'recharge_gb',
    target_user_id     INTEGER NOT NULL,
    target_username    TEXT    NOT NULL DEFAULT '',
    payload_json       TEXT    NOT NULL DEFAULT '{}',
    max_uses           INTEGER NOT NULL DEFAULT 1,
    uses_count         INTEGER NOT NULL DEFAULT 0,
    issued_by_user_id  INTEGER NOT NULL DEFAULT 0,
    issued_by_username TEXT    NOT NULL DEFAULT '',
    expires_at         REAL    NOT NULL DEFAULT 0,
    revoked_at         REAL    NOT NULL DEFAULT 0,
    revoked_by_username TEXT   NOT NULL DEFAULT '',
    last_used_at       TEXT    NOT NULL DEFAULT '',
    created_at         TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_action_tokens_target_user ON account_action_tokens(target_user_id);
CREATE INDEX IF NOT EXISTS idx_account_action_tokens_purpose ON account_action_tokens(purpose);
CREATE INDEX IF NOT EXISTS idx_account_action_tokens_expires_at ON account_action_tokens(expires_at);

-- Historique / Audit des Utilisateurs
CREATE TABLE IF NOT EXISTS user_history (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    action              TEXT    NOT NULL,
    previous_type       TEXT    NOT NULL DEFAULT '',
    new_type            TEXT    NOT NULL DEFAULT '',
    previous_expiration TEXT    NOT NULL DEFAULT '',
    new_expiration      TEXT    NOT NULL DEFAULT '',
    actor_username      TEXT    NOT NULL DEFAULT '',
    reference           TEXT    NOT NULL DEFAULT '',
    created_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_created_at ON user_history(created_at);

-- Abonnements (historique structure, en plus de users.type/expiration qui restent la source rapide actuelle)
CREATE TABLE IF NOT EXISTS subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    plan         TEXT    NOT NULL DEFAULT 'Gratuit',
    status       TEXT    NOT NULL DEFAULT 'active',
    source       TEXT    NOT NULL DEFAULT '',
    started_at   TEXT    NOT NULL,
    expires_at   TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON subscriptions(status);

-- Serveurs (cache d'affichage cote web, la verite technique reste dans 3x-ui)
CREATE TABLE IF NOT EXISTS servers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL DEFAULT '',
    country             TEXT    NOT NULL DEFAULT '',
    city                TEXT    NOT NULL DEFAULT '',
    status              TEXT    NOT NULL DEFAULT 'available',
    infrastructure_ref  TEXT    NOT NULL DEFAULT '',
    created_at          TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);

-- Regles d'acces par plan, par profil de serveur (duree d'essai, quota de
-- donnees). Une ligne absente pour un (server_id, plan) donne = illimite,
-- pour ne rien casser sur les profils crees avant cette table.
CREATE TABLE IF NOT EXISTS server_plan_rules (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id             INTEGER NOT NULL,
    plan                  TEXT    NOT NULL,
    max_duration_minutes  INTEGER NOT NULL DEFAULT 0,
    quota_mb              INTEGER NOT NULL DEFAULT 0,
    created_at            REAL    NOT NULL,
    updated_at            REAL    NOT NULL,
    UNIQUE(server_id, plan)
);
CREATE INDEX IF NOT EXISTS idx_server_plan_rules_server ON server_plan_rules(server_id);

-- Anti-abus essai gratuit : suit l'usage par APPAREIL (pas par compte), pour
-- qu'un utilisateur ne puisse pas contourner la limite d'essai en recreant
-- simplement un nouveau compte sur le meme telephone.
CREATE TABLE IF NOT EXISTS device_trial_usage (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id       TEXT    NOT NULL UNIQUE,
    trial_used      INTEGER NOT NULL DEFAULT 0,
    first_user_id   INTEGER,
    first_username  TEXT    NOT NULL DEFAULT '',
    first_seen_at   REAL    NOT NULL,
    updated_at      REAL    NOT NULL
);

-- Messagerie privee : conversation = 1 client + son gestionnaire (admin ou
-- revendeur, selon la filiation -- meme principe que service_requests, pas
-- de salon de groupe). Chaque message peut porter une piece jointe (capture
-- d'ecran de paiement, facture PDF...) stockee en base64 directement en
-- base -- meme mecanisme deja utilise pour les photos de profil.
CREATE TABLE IF NOT EXISTS private_messages (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_user_id INTEGER NOT NULL,  -- toujours l'ID du CLIENT (pas du gestionnaire), pivot de la conversation
    sender_user_id     INTEGER NOT NULL,
    sender_username    TEXT    NOT NULL DEFAULT '',
    sender_role        TEXT    NOT NULL DEFAULT '',  -- 'client', 'admin', 'revendeur' -- pour l'affichage
    body               TEXT    NOT NULL DEFAULT '',
    message_type       TEXT    NOT NULL DEFAULT 'text',  -- 'text', 'payment_proof', 'invoice'
    attachment_data     TEXT    NOT NULL DEFAULT '',  -- base64 (image) ou lien vers le PDF genere
    attachment_mime    TEXT    NOT NULL DEFAULT '',
    attachment_filename TEXT   NOT NULL DEFAULT '',
    read_at            REAL    NOT NULL DEFAULT 0,
    created_at         REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_private_messages_conv ON private_messages(conversation_user_id);

-- Factures generees automatiquement a la validation d'une demande
-- (abonnement/renouvellement/mise a niveau). Le PDF est ecrit sur disque
-- (dossier static/invoices/) -- seul le chemin est stocke ici.
CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number  TEXT    NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL,
    username        TEXT    NOT NULL DEFAULT '',
    plan            TEXT    NOT NULL DEFAULT '',
    duration_days   INTEGER NOT NULL DEFAULT 0,
    amount_label    TEXT    NOT NULL DEFAULT '',
    issued_by_user_id INTEGER,
    issued_by_username TEXT NOT NULL DEFAULT '',
    pdf_path        TEXT    NOT NULL DEFAULT '',
    message_id      INTEGER,
    created_at      REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    subscription_id  INTEGER,
    server_id        INTEGER,
    type             TEXT    NOT NULL DEFAULT 'VPN',
    status           TEXT    NOT NULL DEFAULT 'active',
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_user_id ON services(user_id);
CREATE INDEX IF NOT EXISTS idx_services_subscription_id ON services(subscription_id);
CREATE INDEX IF NOT EXISTS idx_services_server_id ON services(server_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);

-- Configurations (remplace progressivement configs_distribution pour les nouvelles configs structurees)
CREATE TABLE IF NOT EXISTS configurations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    service_id     INTEGER,
    server_id      INTEGER,
    protocol       TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'active',
    technical_data TEXT    NOT NULL DEFAULT '',
    expires_at     TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_configurations_user_id ON configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_configurations_service_id ON configurations(service_id);
CREATE INDEX IF NOT EXISTS idx_configurations_server_id ON configurations(server_id);
CREATE INDEX IF NOT EXISTS idx_configurations_status ON configurations(status);
"""


async def _table_has_column(conn: aiosqlite.Connection, table: str, column: str) -> bool:
    try:
        cursor = await conn.execute(f"PRAGMA table_info({table})")
        rows = await cursor.fetchall()
    except Exception:
        return False
    for row in rows:
        name = row["name"] if isinstance(row, aiosqlite.Row) else row[1]
        if str(name) == column:
            return True
    return False


async def _ensure_column(conn: aiosqlite.Connection, table: str, column: str, ddl: str) -> None:
    if await _table_has_column(conn, table, column):
        return
    await conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


async def init_db() -> None:
    """Create and migrate SQLite schema in a backward-compatible way."""
    conn = await _get_conn()

    # Execute schema statement-by-statement so old tables do not block boot.
    for raw in _SCHEMA.split(";"):
        stmt = raw.strip()
        if not stmt:
            continue
        try:
            await conn.execute(stmt)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "no such column" in msg and stmt.upper().startswith("CREATE INDEX"):
                continue
            if "already exists" in msg:
                continue
            raise

    # Best-effort column migrations from legacy DBs.
    migrations = [
        ("activation_keys", "is_used", "INTEGER NOT NULL DEFAULT 0"),
        ("activation_keys", "used_by_user_id", "INTEGER"),
        ("activation_keys", "used_by_username", "TEXT NOT NULL DEFAULT ''"),
        ("activation_keys", "used_at", "TEXT NOT NULL DEFAULT ''"),
        ("activation_keys", "created_by", "TEXT NOT NULL DEFAULT 'ADMIN'"),
        ("vip_tokens", "type", "TEXT NOT NULL DEFAULT 'VIP'"),
        ("vip_tokens", "duration_label", "TEXT NOT NULL DEFAULT ''"),
        ("vip_tokens", "is_used", "INTEGER NOT NULL DEFAULT 0"),
        ("vip_tokens", "used_by_user_id", "INTEGER"),
        ("vip_tokens", "used_by_username", "TEXT NOT NULL DEFAULT ''"),
        ("vip_tokens", "used_at", "TEXT NOT NULL DEFAULT ''"),
        ("tchat_messages", "msg_type", "TEXT NOT NULL DEFAULT 'text'"),
        ("tchat_messages", "file_url", "TEXT NOT NULL DEFAULT ''"),
        ("tchat_messages", "reactions", "TEXT NOT NULL DEFAULT '{}'"),
        ("users", "limit_ip", "INTEGER NOT NULL DEFAULT 0"),
        ("users", "om_number", "TEXT NOT NULL DEFAULT ''"),
        ("users", "momo_number", "TEXT NOT NULL DEFAULT ''"),
        ("users", "allow_custom_payments", "INTEGER NOT NULL DEFAULT 0"),
        ("users", "reseller_id", "INTEGER NOT NULL DEFAULT 0"),
        ("users", "contact", "TEXT NOT NULL DEFAULT ''"),
        ("users", "password_hash", "TEXT NOT NULL DEFAULT ''"),
    ("users", "service_password", "TEXT NOT NULL DEFAULT ''"),
        ("users", "recovery_secret_hash", "TEXT NOT NULL DEFAULT ''"),
        ("users", "role_code", "TEXT NOT NULL DEFAULT ''"),
        ("users", "default_panel_key", "TEXT NOT NULL DEFAULT ''"),
        ("users", "forbidden_attempts", "INTEGER NOT NULL DEFAULT 0"),
        ("users", "last_forbidden_need", "TEXT NOT NULL DEFAULT ''"),
        ("users", "last_forbidden_at", "TEXT NOT NULL DEFAULT ''"),
        ("payments", "recipient_id", "INTEGER DEFAULT 0"),
        ("payments", "service_request_id", "INTEGER DEFAULT NULL"),
        ("sessions", "created_at", "REAL NOT NULL DEFAULT 0"),
        ("scan_jobs", "hits_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("ads", "locations", "TEXT NOT NULL DEFAULT '[\"chat\"]'"),
        ("ads", "color", "TEXT NOT NULL DEFAULT '#39ff14'"),
        ("ads", "image", "TEXT NOT NULL DEFAULT ''"),
        ("ads", "style", "TEXT NOT NULL DEFAULT 'neon'"),
        ("ads", "expires_at", "REAL NOT NULL DEFAULT 0"),
        ("ads", "reseller_id", "INTEGER NOT NULL DEFAULT 0"),
        ("promo_codes", "bonus_gb", "INTEGER NOT NULL DEFAULT 0"),
        ("servers", "allow_insecure", "INTEGER NOT NULL DEFAULT 0"),
        ("servers", "protocol", "TEXT NOT NULL DEFAULT ''"),
        ("servers", "capabilities", "TEXT NOT NULL DEFAULT ''"),
        ("servers", "visible_plans", "TEXT NOT NULL DEFAULT 'Gratuit,VIP,Revendeur,ADMIN'"),
    ]

    for table, column, ddl in migrations:
        try:
            await _ensure_column(conn, table, column, ddl)
        except sqlite3.OperationalError:
            # Ignore unsupported ALTERs on non-existing legacy tables.
            continue

    try:
        await conn.execute(
            """
            UPDATE users
               SET role_code = CASE
                    WHEN upper(trim(type)) = 'ADMIN' AND id = 1 THEN 'super_admin'
                    WHEN upper(trim(type)) = 'ADMIN' THEN 'admin'
                    WHEN lower(trim(type)) = 'revendeur' THEN 'reseller'
                    ELSE 'client'
               END
             WHERE coalesce(trim(role_code), '') = ''
            """
        )
        await conn.execute(
            """
            UPDATE users
               SET role_code = 'super_admin'
             WHERE id = 1
               AND upper(trim(type)) = 'ADMIN'
               AND lower(trim(coalesce(role_code, ''))) != 'super_admin'
            """
        )
        await conn.execute(
            """
            UPDATE users
               SET default_panel_key = CASE
                    WHEN upper(trim(type)) = 'ADMIN' THEN 'admin'
                    WHEN lower(trim(type)) = 'revendeur' THEN 'reseller'
                    WHEN upper(trim(type)) IN ('VIP', 'PREMIUM') THEN 'premium'
                    ELSE 'free'
               END
             WHERE coalesce(trim(default_panel_key), '') = ''
            """
        )
    except sqlite3.OperationalError:
        pass

    await conn.commit()
    print(f"[DB] Base SQLite initialisee : {DB_PATH}")


# ==============================================================================
# HELPERS INTERNES
# ==============================================================================
def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def _row_to_dict(row) -> dict:
    if row is None:
        return {}
    return dict(row)

def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]


def _normalize_user_record(user: dict) -> dict:
    return normalize_user_access_fields(user)


def _json_col(value) -> str:
    """SÃ©rialise une valeur Python en JSON pour stockage TEXT."""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)

def _from_json_col(value: str):
    """DÃ©sÃ©rialise une colonne JSON TEXT."""
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return value


def _sync_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ==============================================================================
# USERS
# ==============================================================================
class UsersRepo:
    async def get_all(self) -> list[dict]:
        conn = await _get_conn()
        cursor = await conn.execute("SELECT * FROM users ORDER BY id")
        rows = await cursor.fetchall()
        return [_normalize_user_record(dict(row)) for row in rows]

    async def get_by_id(self, user_id: int) -> Optional[dict]:
        conn = await _get_conn()
        cursor = await conn.execute("SELECT * FROM users WHERE id = ?", (int(user_id),))
        row = await cursor.fetchone()
        return _normalize_user_record(dict(row)) if row else None

    async def get_by_username(self, username: str) -> Optional[dict]:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username.strip(),)
        )
        row = await cursor.fetchone()
        return _normalize_user_record(dict(row)) if row else None

    async def get_by_license(self, license_key: str) -> Optional[dict]:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT * FROM users WHERE license = ?", (license_key.strip(),)
        )
        row = await cursor.fetchone()
        return _normalize_user_record(dict(row)) if row else None

    async def username_exists(self, username: str) -> bool:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", (username.strip(),)
        )
        row = await cursor.fetchone()
        return row is not None

    async def save(self, user: dict) -> dict:
        """InsÃ¨re ou met Ã  jour un utilisateur (upsert par username)."""
        now = _now()
        user = dict(user)

        defaults = {
            "contact": "",
            "password_hash": "",
            "service_password": "",
            "type": "Gratuit",
            "role_code": "",
            "default_panel_key": "",
            "status": "active",
            "license": "",
            "uuid_secondary": "",
            "recovery_secret_hash": "",
            "forbidden_attempts": 0,
            "last_forbidden_need": "",
            "last_forbidden_at": "",
            "avatar": "",
            "quota_gb": None,
            "limit_ip": 0,
            "om_number": "",
            "momo_number": "",
            "allow_custom_payments": 0,
            "reseller_id": 0,
            "expiration": "",
            "notes": "",
        }
        for key, val in defaults.items():
            user.setdefault(key, val)

        if not str(user.get("uuid_secondary", "") or "").strip():
            user["uuid_secondary"] = str(uuid.uuid4())

        user = normalize_user_access_fields(user)
        user.setdefault("created_at", now)
        user["updated_at"] = now

        async with _tx() as conn:
            cursor = await conn.execute(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                (str(user.get("username", "")).strip(),)
            )
            existing = await cursor.fetchone()

            fields = [
                "username", "contact", "password_hash", "service_password", "type", "role_code", "default_panel_key", "status", "license", "uuid_secondary",
                "recovery_secret_hash", "forbidden_attempts", "last_forbidden_need",
                "last_forbidden_at", "avatar", "quota_gb", "limit_ip",
                "om_number", "momo_number", "allow_custom_payments", "reseller_id", "expiration", "notes", "created_at", "updated_at"
            ]

            if existing:
                # UPDATE
                set_clause = ", ".join(f"{f} = ?" for f in fields if f != "created_at")
                vals = [user.get(f) for f in fields if f != "created_at"]
                vals.append(existing["id"])
                await conn.execute(f"UPDATE users SET {set_clause} WHERE id = ?", vals)
                user["id"] = existing["id"]
            else:
                # INSERT
                cols = ", ".join(fields)
                placeholders = ", ".join("?" * len(fields))
                vals = [user.get(f) for f in fields]
                cursor = await conn.execute(
                    f"INSERT INTO users ({cols}) VALUES ({placeholders})", vals
                )
                user["id"] = cursor.lastrowid

        return normalize_user_access_fields(user)

    async def save_all(self, users: list[dict]) -> None:
        """Sauvegarde en masse (utilisÃ© pour la migration JSON)."""
        for u in users:
            await self.save(u)

    async def delete(self, user_id: int) -> bool:
        async with _tx() as conn:
            cur = await conn.execute("DELETE FROM users WHERE id = ?", (int(user_id),))
        return cur.rowcount > 0

    async def count(self) -> int:
        conn = await _get_conn()
        cursor = await conn.execute("SELECT COUNT(*) FROM users")
        row = await cursor.fetchone()
        return row[0]

    async def get_by_type(self, user_type: str) -> list[dict]:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT * FROM users WHERE type = ? ORDER BY username", (user_type,)
        )
        rows = await cursor.fetchall()
        return [_normalize_user_record(dict(row)) for row in rows]

    def get_profiles_by_usernames(self, usernames: list[str]) -> dict[str, dict]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw in usernames:
            key = str(raw or "").strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            cleaned.append(key)
        if not cleaned:
            return {}

        placeholders = ", ".join("?" * len(cleaned))
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                f"SELECT username, type, avatar FROM users WHERE lower(username) IN ({placeholders})",
                cleaned,
            )
            rows = cursor.fetchall()

        out: dict[str, dict] = {}
        for row in rows:
            username = str(row["username"] or "").strip()
            if not username:
                continue
            out[username.lower()] = {
                "type": str(row["type"] or "Gratuit"),
                "avatar": str(row["avatar"] or ""),
            }
        return out


# ==============================================================================
# SESSIONS
# ==============================================================================
class SessionsRepo:
    async def get(self, token: str) -> Optional[dict]:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT * FROM sessions WHERE token = ? AND expires_at > ?",
            (token, time.time())
        )
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None

    async def set(self, token: str, user_id: int, username: str, expires_at: float) -> None:
        async with _tx() as conn:
            await conn.execute(
                """INSERT INTO sessions (token, user_id, username, expires_at, created_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at""",
                (token, int(user_id), str(username), float(expires_at), time.time())
            )

    async def delete(self, token: str) -> None:
        async with _tx() as conn:
            await conn.execute("DELETE FROM sessions WHERE token = ?", (token,))

    async def delete_for_user(self, user_id: int) -> None:
        async with _tx() as conn:
            await conn.execute("DELETE FROM sessions WHERE user_id = ?", (int(user_id),))

    async def count_active_for_user(self, user_id: int) -> int:
        """Compte le nombre de sessions actives pour un utilisateur."""
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ?",
            (int(user_id), time.time())
        )
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def delete_others_for_user(self, user_id: int, current_token: str) -> int:
        """Supprime toutes les sessions d'un utilisateur sauf celle spÃ©cifiÃ©e."""
        async with _tx() as conn:
            cur = await conn.execute(
                "DELETE FROM sessions WHERE user_id = ? AND token != ?",
                (int(user_id), current_token)
            )
        return cur.rowcount

    async def cleanup_expired(self) -> int:
        """Supprime les sessions expirÃ©es. Ã€ appeler pÃ©riodiquement."""
        async with _tx() as conn:
            cur = await conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
        return cur.rowcount

    async def get_all_active(self) -> list[dict]:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT * FROM sessions WHERE expires_at > ? ORDER BY expires_at DESC",
            (time.time(),)
        )
        rows = await cursor.fetchall()
        return _rows_to_list(rows)

    async def get_active_user_ids(self) -> set:
        conn = await _get_conn()
        cursor = await conn.execute(
            "SELECT DISTINCT user_id FROM sessions WHERE user_id > 0 AND expires_at > ?",
            (time.time(),),
        )
        rows = await cursor.fetchall()
        return {int(r["user_id"]) for r in rows if r["user_id"]}


# ==============================================================================
# PAYMENTS
# ==============================================================================
class PaymentsRepo:
    def add(self, payment: dict) -> dict:
        now = _now()
        payment = dict(payment)
        payment.setdefault("created_at", now)
        payment["updated_at"] = now

        fields = [
            "user_id", "recipient_id", "service_request_id", "username", "provider", "amount", "currency",
            "plan", "status", "reference", "phone", "raw_response",
            "created_at", "updated_at"
        ]
        # SÃ©rialise raw_response si c'est un dict
        if isinstance(payment.get("raw_response"), (dict, list)):
            payment["raw_response"] = json.dumps(payment["raw_response"])

        with _sync_connect() as conn:
            cols = ", ".join(fields)
            placeholders = ", ".join("?" * len(fields))
            vals = [payment.get(f) for f in fields]
            cur = conn.execute(
                f"INSERT INTO payments ({cols}) VALUES ({placeholders})", vals
            )
            payment["id"] = cur.lastrowid
        return payment

    def update_status(self, payment_id: int, status: str, raw_response=None) -> None:
        now = _now()
        with _sync_connect() as conn:
            if raw_response is not None:
                conn.execute(
                    "UPDATE payments SET status=?, raw_response=?, updated_at=? WHERE id=?",
                    (status, _json_col(raw_response), now, int(payment_id))
                )
            else:
                conn.execute(
                    "UPDATE payments SET status=?, updated_at=? WHERE id=?",
                    (status, now, int(payment_id))
                )

    def get_by_user(self, user_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC",
            (int(user_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def get_by_reference(self, reference: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM payments WHERE reference = ?", (reference,)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def get_all(self, limit: int = 500, recipient_id: Optional[int] = None) -> list[dict]:
        conn = _sync_connect()
        if recipient_id is not None:
            rows = conn.execute(
                "SELECT * FROM payments WHERE recipient_id = ? ORDER BY created_at DESC LIMIT ?",
                (int(recipient_id), limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM payments ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return _rows_to_list(rows)

    def count_by_status(self, status: str) -> int:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT COUNT(*) FROM payments WHERE status = ? COLLATE NOCASE",
            (str(status or "").strip(),),
        ).fetchone()
        return int(row[0]) if row else 0


# ==============================================================================
# USER HISTORY (Audit Trail)
# ==============================================================================
class UserHistoryRepo:
    def add(self, record: dict) -> dict:
        now = _now()
        record = dict(record)
        record.setdefault("created_at", now)
        
        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO user_history
                   (user_id, action, previous_type, new_type, previous_expiration, new_expiration, actor_username, reference, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    int(record.get("user_id", 0)),
                    str(record.get("action", "")),
                    str(record.get("previous_type", "")),
                    str(record.get("new_type", "")),
                    str(record.get("previous_expiration", "")),
                    str(record.get("new_expiration", "")),
                    str(record.get("actor_username", "")),
                    str(record.get("reference", "")),
                    record["created_at"]
                )
            )
            record["id"] = cur.lastrowid
        return record

    def get_by_user(self, user_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM user_history WHERE user_id = ? ORDER BY created_at DESC",
            (int(user_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def cleanup_old(self, days: int = 90) -> int:
        """Supprime l'historique plus vieux que 'days' jours."""
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        with _sync_connect() as conn:
            cur = conn.execute("DELETE FROM user_history WHERE created_at < ?", (cutoff,))
        return cur.rowcount


# ==============================================================================
# TCHAT MESSAGES
# ==============================================================================
class TchatRepo:
    def add(self, msg: dict) -> dict:
        now = _now()
        msg = dict(msg)
        msg.setdefault("created_at", now)
        reactions = msg.get("reactions", {})

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO tchat_messages (user_id, username, content, msg_type, file_url, reactions, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    msg.get("user_id"),
                    str(msg.get("username", "")),
                    str(msg.get("content", "")),
                    str(msg.get("msg_type", "text")),
                    str(msg.get("file_url", "")),
                    _json_col(reactions),
                    msg["created_at"],
                )
            )
            msg["id"] = cur.lastrowid
        return msg

    def get_by_id(self, msg_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM tchat_messages WHERE id = ?", (int(msg_id),)).fetchone()
        if not row: return None
        d = _row_to_dict(row)
        d["reactions"] = _from_json_col(d.get("reactions", "{}")) or {}
        return d

    def get_recent(self, limit: int = 100) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM tchat_messages ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        res = _rows_to_list(rows)
        for r in res:
            r["reactions"] = _from_json_col(r.get("reactions", "{}")) or {}
        return list(reversed(res))

    def get_since(self, since_id: int, limit: int = 100) -> list[dict]:
        since_id = int(since_id or 0)
        if since_id <= 0:
            return self.get_recent(limit=limit)

        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM tchat_messages WHERE id > ? ORDER BY id ASC LIMIT ?",
            (since_id, int(limit)),
        ).fetchall()
        res = _rows_to_list(rows)
        for r in res:
            r["reactions"] = _from_json_col(r.get("reactions", "{}")) or {}
        return res

    def update_reactions(self, msg_id: int, reactions: dict) -> None:
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE tchat_messages SET reactions = ? WHERE id = ?",
                (_json_col(reactions), int(msg_id))
            )

    def delete(self, msg_id: int) -> bool:
        with _sync_connect() as conn:
            cur = conn.execute("DELETE FROM tchat_messages WHERE id = ?", (int(msg_id),))
        return cur.rowcount > 0

    def count(self) -> int:
        conn = _sync_connect()
        return conn.execute("SELECT COUNT(*) FROM tchat_messages").fetchone()[0]

    def trim(self, max_count: int = 500) -> None:
        """Garde uniquement les N derniers messages."""
        with _sync_connect() as conn:
            conn.execute(
                """DELETE FROM tchat_messages WHERE id NOT IN (
                       SELECT id FROM tchat_messages ORDER BY id DESC LIMIT ?
                   )""",
                (max_count,)
            )


# ==============================================================================
# PRIVATE MESSAGES
# ==============================================================================
class PrivateMessagesRepo:
    def add(self, msg: dict) -> dict:
        now = _now()
        msg = dict(msg)
        msg.setdefault("created_at", now)

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO private_messages
                   (sender_id, sender, recipient, content, msg_type, file_url, is_read, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    msg.get("sender_id"),
                    str(msg.get("sender", "")),
                    str(msg.get("recipient", "")),
                    str(msg.get("content", "")),
                    str(msg.get("msg_type", "text")),
                    str(msg.get("file_url", "")),
                    int(msg.get("is_read", 0)),
                    msg["created_at"],
                )
            )
            msg["id"] = cur.lastrowid
        return msg

    def get_conversation(self, user_a: str, user_b: str, limit: int = 100) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            """SELECT * FROM private_messages
               WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
               ORDER BY id DESC LIMIT ?""",
            (user_a, user_b, user_b, user_a, limit)
        ).fetchall()
        return list(reversed(_rows_to_list(rows)))

    def mark_read(self, recipient: str, sender: str) -> None:
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE private_messages SET is_read = 1 WHERE recipient = ? AND sender = ?",
                (recipient, sender)
            )

    def unread_count(self, recipient: str) -> int:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT COUNT(*) FROM private_messages WHERE recipient = ? AND is_read = 0",
            (recipient,)
        ).fetchone()
        return row[0] if row else 0


# ==============================================================================
# VIP TOKENS
# ==============================================================================
class VipTokensRepo:
    def get_by_token(self, token: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM vip_tokens WHERE token = ?", (token,)).fetchone()
        return _row_to_dict(row) if row else None

    def add(self, entry: dict) -> dict:
        now = _now()
        entry = dict(entry)
        entry.setdefault("created_at", now)

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO vip_tokens (token, type, duration_label, is_used, expires_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    str(entry.get("token")),
                    str(entry.get("type", "VIP")),
                    str(entry.get("duration_label", "")),
                    int(bool(entry.get("used", False))),
                    float(entry.get("expires_at", 0)),
                    entry["created_at"],
                )
            )
            entry["id"] = cur.lastrowid
        return entry

    def mark_used(self, token: str, user_id: int, username: str) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE vip_tokens SET is_used=1, used_by_user_id=?, used_by_username=?, used_at=? WHERE token=?",
                (int(user_id), str(username), now, token)
            )

    def cleanup_expired(self) -> int:
        """Supprime les tokens expirÃ©s et non utilisÃ©s."""
        with _sync_connect() as conn:
            cur = conn.execute("DELETE FROM vip_tokens WHERE expires_at <= ? AND is_used = 0", (time.time(),))
        return cur.rowcount


# ==============================================================================
# ==============================================================================
# PROMO CODES
# ==============================================================================
class PromoCodesRepo:
    def get_all(self) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute("SELECT * FROM promo_codes ORDER BY id DESC").fetchall()
        return _rows_to_list(rows)

    def get_by_code(self, code: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE", (str(code).strip(),)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def get_by_id(self, promo_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM promo_codes WHERE id = ?", (int(promo_id),)).fetchone()
        return _row_to_dict(row) if row else None

    def add(self, entry: dict) -> dict:
        now = _now()
        entry = dict(entry)
        entry.setdefault("created_at", now)
        entry["code"] = str(entry.get("code", "")).strip().upper()
        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO promo_codes
                   (code, bonus_days, bonus_gb, max_uses, times_used, active, expires_at, notes, created_by, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry["code"],
                    int(entry.get("bonus_days", 0)),
                    int(entry.get("bonus_gb", 0)),
                    int(entry.get("max_uses", 1)),
                    int(entry.get("times_used", 0)),
                    int(bool(entry.get("active", True))),
                    str(entry.get("expires_at", "")),
                    str(entry.get("notes", "")),
                    str(entry.get("created_by", "ADMIN")),
                    entry["created_at"],
                )
            )
            entry["id"] = cur.lastrowid
        return entry

    def set_active(self, promo_id: int, active: bool) -> None:
        with _sync_connect() as conn:
            conn.execute("UPDATE promo_codes SET active=? WHERE id=?", (int(bool(active)), int(promo_id)))

    def has_user_redeemed(self, promo_id: int, user_id: int) -> bool:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT 1 FROM promo_code_redemptions WHERE promo_code_id = ? AND user_id = ?",
            (int(promo_id), int(user_id)),
        ).fetchone()
        return row is not None

    def redeem(self, promo_id: int, user_id: int, username: str) -> None:
        """Enregistre la redemption et incremente le compteur d'utilisation. Leve
        sqlite3.IntegrityError si l'utilisateur a deja utilise ce code (contrainte UNIQUE)."""
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "INSERT INTO promo_code_redemptions (promo_code_id, user_id, username, redeemed_at) VALUES (?, ?, ?, ?)",
                (int(promo_id), int(user_id), str(username), now),
            )
            conn.execute(
                "UPDATE promo_codes SET times_used = times_used + 1 WHERE id = ?", (int(promo_id),)
            )


# SERVICE REQUESTS
# ==============================================================================
# ==============================================================================
# DELEGATED ADMIN GRANTS
# ==============================================================================
class DelegatedAdminGrantsRepo:
    def _normalize(self, row) -> dict:
        payload = _row_to_dict(row)
        payload["permission_codes"] = _from_json_col(payload.get("permission_codes", "[]")) or []
        return payload

    def list_for_user(self, user_id: int, limit: int = 20) -> list[dict]:
        with _sync_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM delegated_admin_grants WHERE target_user_id = ? ORDER BY created_at DESC LIMIT ?",
                (int(user_id), int(limit)),
            ).fetchall()
        return [self._normalize(row) for row in rows]

    def get_active_for_user(self, user_id: int, current_timestamp: float | None = None) -> list[dict]:
        now_ts = float(current_timestamp if current_timestamp is not None else time.time())
        with _sync_connect() as conn:
            rows = conn.execute(
                """SELECT * FROM delegated_admin_grants
                   WHERE target_user_id = ?
                     AND revoked_at <= 0
                     AND starts_at <= ?
                     AND expires_at > ?
                   ORDER BY expires_at ASC, id DESC""",
                (int(user_id), now_ts, now_ts),
            ).fetchall()
        return [self._normalize(row) for row in rows]

    def add(self, grant: dict) -> dict:
        now = _now()
        payload = dict(grant or {})
        payload.setdefault("target_user_id", 0)
        payload.setdefault("target_username", "")
        payload.setdefault("granted_by_user_id", 0)
        payload.setdefault("granted_by_username", "")
        payload.setdefault("permission_codes", [])
        payload.setdefault("notes", "")
        payload.setdefault("starts_at", time.time())
        payload.setdefault("expires_at", time.time() + 86400)
        payload.setdefault("revoked_at", 0)
        payload.setdefault("revoked_by_username", "")
        payload.setdefault("created_at", now)
        payload.setdefault("updated_at", now)
        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO delegated_admin_grants
                   (target_user_id, target_username, granted_by_user_id, granted_by_username,
                    permission_codes, notes, starts_at, expires_at, revoked_at,
                    revoked_by_username, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    int(payload.get("target_user_id", 0) or 0),
                    str(payload.get("target_username", "") or ""),
                    int(payload.get("granted_by_user_id", 0) or 0),
                    str(payload.get("granted_by_username", "") or ""),
                    _json_col(payload.get("permission_codes", [])),
                    str(payload.get("notes", "") or ""),
                    float(payload.get("starts_at", time.time()) or time.time()),
                    float(payload.get("expires_at", time.time() + 86400) or (time.time() + 86400)),
                    float(payload.get("revoked_at", 0) or 0),
                    str(payload.get("revoked_by_username", "") or ""),
                    str(payload.get("created_at", now) or now),
                    str(payload.get("updated_at", now) or now),
                ),
            )
            conn.commit()
            payload["id"] = cur.lastrowid
        return self._normalize(payload)

    def revoke(self, grant_id: int, revoked_by_username: str = "") -> bool:
        now_ts = time.time()
        now = _now()
        with _sync_connect() as conn:
            cur = conn.execute(
                """UPDATE delegated_admin_grants
                   SET revoked_at = ?, revoked_by_username = ?, updated_at = ?
                   WHERE id = ? AND revoked_at <= 0""",
                (now_ts, str(revoked_by_username or ""), now, int(grant_id)),
            )
            conn.commit()
            return cur.rowcount > 0


# ==============================================================================
# ACCOUNT ACTION TOKENS
# ==============================================================================
class AccountActionTokensRepo:
    def _normalize(self, row) -> dict:
        payload = _row_to_dict(row)
        payload["payload"] = _from_json_col(payload.get("payload_json", "{}")) or {}
        return payload

    def add(self, entry: dict) -> dict:
        now = _now()
        payload = dict(entry or {})
        payload.setdefault("purpose", "recharge_gb")
        payload.setdefault("target_user_id", 0)
        payload.setdefault("target_username", "")
        payload.setdefault("payload", {})
        payload.setdefault("max_uses", 1)
        payload.setdefault("uses_count", 0)
        payload.setdefault("issued_by_user_id", 0)
        payload.setdefault("issued_by_username", "")
        payload.setdefault("expires_at", time.time() + 604800)
        payload.setdefault("revoked_at", 0)
        payload.setdefault("revoked_by_username", "")
        payload.setdefault("last_used_at", "")
        payload.setdefault("created_at", now)
        payload.setdefault("updated_at", now)
        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO account_action_tokens
                   (token, purpose, target_user_id, target_username, payload_json, max_uses,
                    uses_count, issued_by_user_id, issued_by_username, expires_at, revoked_at,
                    revoked_by_username, last_used_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(payload.get("token", "") or ""),
                    str(payload.get("purpose", "recharge_gb") or "recharge_gb"),
                    int(payload.get("target_user_id", 0) or 0),
                    str(payload.get("target_username", "") or ""),
                    _json_col(payload.get("payload", {})),
                    max(1, int(payload.get("max_uses", 1) or 1)),
                    int(payload.get("uses_count", 0) or 0),
                    int(payload.get("issued_by_user_id", 0) or 0),
                    str(payload.get("issued_by_username", "") or ""),
                    float(payload.get("expires_at", time.time() + 604800) or (time.time() + 604800)),
                    float(payload.get("revoked_at", 0) or 0),
                    str(payload.get("revoked_by_username", "") or ""),
                    str(payload.get("last_used_at", "") or ""),
                    str(payload.get("created_at", now) or now),
                    str(payload.get("updated_at", now) or now),
                ),
            )
            conn.commit()
            payload["id"] = cur.lastrowid
        return self._normalize(payload)

    def get_by_token(self, token: str) -> Optional[dict]:
        with _sync_connect() as conn:
            row = conn.execute(
                "SELECT * FROM account_action_tokens WHERE token = ?",
                (str(token or "").strip(),),
            ).fetchone()
        return self._normalize(row) if row else None

    def list_for_user(self, user_id: int, limit: int = 20) -> list[dict]:
        with _sync_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM account_action_tokens WHERE target_user_id = ? ORDER BY created_at DESC LIMIT ?",
                (int(user_id), int(limit)),
            ).fetchall()
        return [self._normalize(row) for row in rows]

    def mark_used(self, token_id: int, user_id: int, username: str) -> bool:
        del username
        now = _now()
        with _sync_connect() as conn:
            cur = conn.execute(
                """UPDATE account_action_tokens
                   SET uses_count = uses_count + 1, last_used_at = ?, updated_at = ?
                   WHERE id = ?
                     AND target_user_id = ?
                     AND revoked_at <= 0
                     AND expires_at > ?
                     AND uses_count < max_uses""",
                (now, now, int(token_id), int(user_id), time.time()),
            )
            conn.commit()
            return cur.rowcount > 0

    def revoke(self, token_id: int, revoked_by_username: str = "") -> bool:
        now_ts = time.time()
        now = _now()
        with _sync_connect() as conn:
            cur = conn.execute(
                """UPDATE account_action_tokens
                   SET revoked_at = ?, revoked_by_username = ?, updated_at = ?
                   WHERE id = ? AND revoked_at <= 0""",
                (now_ts, str(revoked_by_username or ""), now, int(token_id)),
            )
            conn.commit()
            return cur.rowcount > 0


class ServiceRequestsRepo:
    def _kind_column(self) -> str:
        conn = _sync_connect()
        return "kind" if _table_has_column(conn, "service_requests", "kind") else "type"

    def _to_row(self, req: dict) -> tuple:
        # Extracts common fields and puts the rest in content
        common_fields = {"id", "kind", "status", "username", "target_user_id", "submitted_by_user_id", "created_at", "updated_at"}
        content = {k: v for k, v in req.items() if k not in common_fields}
        return (
            req.get("kind"),
            req.get("status", "pending"),
            req.get("username"),
            req.get("target_user_id"),
            req.get("submitted_by_user_id"),
            _json_col(content),
            req.get("created_at"),
            req.get("updated_at"),
            req.get("id")
        )

    def _from_row(self, row) -> dict:
        if not row: return {}
        d = dict(row)
        if "kind" not in d and "type" in d:
            d["kind"] = d.get("type")
        content = _from_json_col(d.pop("content", "{}"))
        if isinstance(content, dict):
            d.update(content)
        return d

    def get_all(self) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute("SELECT * FROM service_requests ORDER BY id DESC").fetchall()
        return [self._from_row(r) for r in rows]

    def get_by_id(self, req_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM service_requests WHERE id = ?",
            (int(req_id),),
        ).fetchone()
        return self._from_row(row) if row else None

    def count_pending_by_kind(self, kind: str) -> int:
        kind_col = self._kind_column()
        conn = _sync_connect()
        row = conn.execute(
            f"""SELECT COUNT(*) FROM service_requests
               WHERE {kind_col} = ? COLLATE NOCASE AND status = 'pending' COLLATE NOCASE""",
            (str(kind or "").strip(),),
        ).fetchone()
        return int(row[0]) if row else 0

    def get_pending_by_kind(self, kind: str) -> list[dict]:
        kind_col = self._kind_column()
        conn = _sync_connect()
        rows = conn.execute(
            f"""SELECT * FROM service_requests
               WHERE {kind_col} = ? COLLATE NOCASE AND status = 'pending' COLLATE NOCASE
               ORDER BY id DESC""",
            (str(kind or "").strip(),),
        ).fetchall()
        return [self._from_row(r) for r in rows]

    def has_pending_license_recovery(self, username: str, contact: str) -> bool:
        kind_col = self._kind_column()
        uname = str(username or "").strip().lower()
        contact_norm = str(contact or "").strip().lower()
        if not uname or not contact_norm:
            return False

        conn = _sync_connect()
        rows = conn.execute(
            f"""SELECT content FROM service_requests
               WHERE {kind_col} = 'license_recovery' COLLATE NOCASE
               AND status = 'pending' COLLATE NOCASE
               AND username = ? COLLATE NOCASE
               ORDER BY id DESC""",
            (str(username or "").strip(),),
        ).fetchall()
        for row in rows:
            content = _from_json_col(row["content"])
            if not isinstance(content, dict):
                continue
            if str(content.get("contact", "")).strip().lower() == contact_norm:
                return True
        return False

    def get_by_recovery_token(self, token: str) -> Optional[dict]:
        kind_col = self._kind_column()
        token = str(token or "").strip()
        if not token:
            return None

        conn = _sync_connect()
        rows = conn.execute(
            f"""SELECT * FROM service_requests
               WHERE {kind_col} = 'license_recovery' COLLATE NOCASE
               AND status = 'resolved' COLLATE NOCASE
               ORDER BY id DESC""",
        ).fetchall()
        for row in rows:
            req = self._from_row(row)
            if str(req.get("recovery_token", "")).strip() == token:
                return req
        return None

    def add(self, req: dict) -> dict:
        now = _now()
        req = dict(req)
        req.setdefault("created_at", now)
        req["updated_at"] = now
        kind, status, username, target_uid, submit_uid, content, created, updated, _ = self._to_row(req)

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO service_requests (kind, status, username, target_user_id, submitted_by_user_id, content, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (kind, status, username, target_uid, submit_uid, content, created, updated)
            )
            req["id"] = cur.lastrowid
        return req

    def save(self, req: dict) -> dict:
        req = dict(req)
        req["updated_at"] = _now()
        kind, status, username, target_uid, submit_uid, content, _, updated, req_id = self._to_row(req)

        with _sync_connect() as conn:
            conn.execute(
                """UPDATE service_requests SET kind=?, status=?, username=?, target_user_id=?,
                   submitted_by_user_id=?, content=?, updated_at=? WHERE id=?""",
                (kind, status, username, target_uid, submit_uid, content, updated, req_id)
            )
        return req

# ==============================================================================
# ACTIVATION KEYS
# ==============================================================================
class ActivationKeysRepo:
    def get_all(self) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM activation_keys ORDER BY created_at DESC"
        ).fetchall()
        return _rows_to_list(rows)

    def get_by_key(self, key: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM activation_keys WHERE key = ?", (key.strip().upper(),)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def add(self, entry: dict) -> dict:
        now = _now()
        entry = dict(entry)
        entry.setdefault("created_at", now)
        entry["key"] = str(entry.get("key", "")).strip().upper()

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO activation_keys
                   (key, user_type, duration_days, notes, is_used, used_by_user_id,
                    used_by_username, used_at, created_by, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry["key"],
                    str(entry.get("user_type", "VIP")),
                    int(entry.get("duration_days", 30)),
                    str(entry.get("notes", "")),
                    int(entry.get("is_used", False)),
                    entry.get("used_by_user_id"),
                    str(entry.get("used_by_username", "")),
                    str(entry.get("used_at", "")),
                    str(entry.get("created_by", "ADMIN")),
                    entry["created_at"],
                )
            )
            entry["id"] = cur.lastrowid
        return entry

    def mark_used(self, key: str, user_id: int, username: str) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                """UPDATE activation_keys
                   SET is_used=1, used_by_user_id=?, used_by_username=?, used_at=?
                   WHERE key = ?""",
                (int(user_id), str(username), now, key.strip().upper())
            )


    def save(self, key_entry: dict) -> dict:
        """Updates an existing activation key."""
        with _sync_connect() as conn:
            conn.execute(
                """UPDATE activation_keys
                   SET key=?, user_type=?, duration_days=?, notes=?, is_used=?,
                       used_by_user_id=?, used_by_username=?, used_at=?, created_by=?
                   WHERE id = ?""",
                (
                    str(key_entry.get("key", "")).strip().upper(),
                    str(key_entry.get("user_type", "VIP")),
                    int(key_entry.get("duration_days", 30)),
                    str(key_entry.get("notes", "")),
                    int(key_entry.get("is_used", False)),
                    key_entry.get("used_by_user_id"),
                    str(key_entry.get("used_by_username", "")),
                    str(key_entry.get("used_at", "")),
                    str(key_entry.get("created_by", "ADMIN")),
                    int(key_entry["id"]),
                )
            )
        return key_entry

# ==============================================================================
# TCHAT QUOTAS
# ==============================================================================
class TchatQuotasRepo:
    def get(self, username: str, date: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM tchat_quotas WHERE username = ? AND date = ?",
            (username, date)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def upsert(self, username: str, date: str, files: int, links: int, last_msg: float) -> None:
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO tchat_quotas (username, date, files, links, last_msg)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(username, date) DO UPDATE SET
                       files=excluded.files, links=excluded.links, last_msg=excluded.last_msg""",
                (username, date, files, links, last_msg)
            )

    def cleanup_old(self, keep_days: int = 3) -> None:
        """Supprime les quotas anciens de plus de N jours."""
        cutoff = datetime.now().strftime("%Y-%m-%d")
        with _sync_connect() as conn:
            conn.execute("DELETE FROM tchat_quotas WHERE date < ?", (cutoff,))


# ==============================================================================
# ADS
# ==============================================================================
class AdsRepo:
    def get_all(self) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute("SELECT * FROM ads ORDER BY priority DESC, id").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["locations"] = _from_json_col(d.get("locations", "[]"))
            d["active"] = bool(d.get("active", 1))
            result.append(d)
        return result

    def get_by_id(self, ad_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM ads WHERE id = ?", (int(ad_id),)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["locations"] = _from_json_col(d.get("locations", "[]"))
        d["active"] = bool(d.get("active", 1))
        return d
    def get_active(self, location: str = "chat") -> list[dict]:
        all_ads = self.get_all()
        return [
            a for a in all_ads
            if a.get("active") and location in (a.get("locations") or [])
        ]

    def get_active_for_reseller(self, location: str, reseller_id: int) -> list[dict]:
        """Bannieres actives pour cet emplacement, avec priorite au revendeur :
        si CE revendeur a personnalise sa propre banniere (reseller_id le
        concernant), on la retourne EXCLUSIVEMENT ; sinon, repli sur les
        bannieres par defaut (reseller_id=0, gerees par l'admin), comme avant
        cette fonctionnalite."""
        candidates = self.get_active(location)
        if reseller_id:
            own = [a for a in candidates if int(a.get("reseller_id", 0) or 0) == int(reseller_id)]
            if own:
                return own
        return [a for a in candidates if int(a.get("reseller_id", 0) or 0) == 0]

    def save(self, ad: dict) -> dict:
        ad = dict(ad)
        locations_json = _json_col(ad.get("locations", ["chat"]))

        with _sync_connect() as conn:
            if ad.get("id"):
                conn.execute(
                    """UPDATE ads SET text=?, link=?, active=?, locations=?,
                       priority=?, color=?, image=?, style=?, expires_at=?, reseller_id=? WHERE id=?""",
                    (
                        str(ad.get("text", "")),
                        str(ad.get("link", "")),
                        int(bool(ad.get("active", True))),
                        locations_json,
                        int(ad.get("priority", 1)),
                        str(ad.get("color", "#39ff14")),
                        str(ad.get("image", "")),
                        str(ad.get("style", "neon")),
                        float(ad.get("expires_at", 0) or 0),
                        int(ad.get("reseller_id", 0) or 0),
                        int(ad["id"]),
                    )
                )
            else:
                cur = conn.execute(
                    """INSERT INTO ads (text, link, active, locations, priority, color, image, style, expires_at, reseller_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        str(ad.get("text", "")),
                        str(ad.get("link", "")),
                        int(bool(ad.get("active", True))),
                        locations_json,
                        int(ad.get("priority", 1)),
                        str(ad.get("color", "#39ff14")),
                        str(ad.get("image", "")),
                        str(ad.get("style", "neon")),
                        float(ad.get("expires_at", 0) or 0),
                        int(ad.get("reseller_id", 0) or 0),
                    )
                )
                ad["id"] = cur.lastrowid
        return ad

    def delete(self, ad_id: int) -> bool:
        with _sync_connect() as conn:
            cur = conn.execute("DELETE FROM ads WHERE id = ?", (int(ad_id),))
        return cur.rowcount > 0


# ==============================================================================
# ARCHIVE (SNI / configs)
# ==============================================================================
class ArchiveRepo:
    def add(self, entry: dict) -> dict:
        now = _now()
        entry = dict(entry)
        entry.setdefault("created_at", now)

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO archive (sni, ip, port, status, latency, valid, config, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(entry.get("sni", "")),
                    str(entry.get("ip", "")),
                    int(entry.get("port", 80)),
                    int(entry.get("status", 0)),
                    str(entry.get("latency", "")),
                    int(bool(entry.get("valid", False))),
                    _json_col(entry.get("config", {})),
                    entry["created_at"],
                )
            )
            entry["id"] = cur.lastrowid
        return entry

    def get_valid(self, limit: int = 200) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM archive WHERE valid = 1 ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["config"] = _from_json_col(d.get("config", "{}"))
            result.append(d)
        return result

    def count(self) -> int:
        conn = _sync_connect()
        return conn.execute("SELECT COUNT(*) FROM archive").fetchone()[0]

    def trim(self, max_count: int = 5000) -> None:
        with _sync_connect() as conn:
            conn.execute(
                """DELETE FROM archive WHERE id NOT IN (
                       SELECT id FROM archive ORDER BY id DESC LIMIT ?
                   )""",
                (max_count,)
            )


# ==============================================================================
# UDP RESULTS
# ==============================================================================
class UdpResultsRepo:
    def add(self, result: dict) -> dict:
        now = _now()
        result = dict(result)
        result.setdefault("created_at", now)

        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO udp_results
                   (scan_id, ip, operator, label, dns_open, ntp_open, quic_open, latency, raw, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(result.get("scan_id", "")),
                    str(result.get("ip", "")),
                    str(result.get("operator", "")),
                    str(result.get("label", "")),
                    int(bool(result.get("dns", {}).get("open", False))),
                    int(bool(result.get("ntp", {}).get("open", False))),
                    int(bool(result.get("quic", {}).get("open", False))),
                    str(result.get("latency", "")),
                    _json_col(result),
                    result["created_at"],
                )
            )
            result["id"] = cur.lastrowid
        return result

    def get_by_scan(self, scan_id: str) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM udp_results WHERE scan_id = ? ORDER BY id",
            (scan_id,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["raw"] = _from_json_col(d.get("raw", "{}"))
            result.append(d)
        return result


# ==============================================================================
# CONFIGS DISTRIBUTION
# ==============================================================================
class ConfigsDistributionRepo:
    def get(self, key: str):
        conn = _sync_connect()
        row = conn.execute(
            "SELECT value FROM configs_distribution WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return None
        return _from_json_col(row["value"])

    def set(self, key: str, value) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO configs_distribution (key, value, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
                (key, _json_col(value), now)
            )

    def get_all(self) -> dict:
        conn = _sync_connect()
        rows = conn.execute("SELECT key, value FROM configs_distribution").fetchall()
        return {r["key"]: _from_json_col(r["value"]) for r in rows}


# ==============================================================================
# NOTIFICATIONS
# ==============================================================================
class NotificationsRepo:
    def add(self, user_id: int, title: str, message: str) -> dict:
        now = _now()
        with _sync_connect() as conn:
            cur = conn.execute(
                "INSERT INTO notifications (user_id, title, message, created_at) VALUES (?, ?, ?, ?)",
                (int(user_id), str(title), str(message), now)
            )
            return {
                "id": cur.lastrowid, "user_id": user_id, "title": title,
                "message": message, "is_read": False, "created_at": now
            }

    def get_by_user(self, user_id: int, limit: int = 20) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (int(user_id), limit)
        ).fetchall()
        return _rows_to_list(rows)

    def mark_read(self, notif_id: int, user_id: int) -> bool:
        with _sync_connect() as conn:
            cur = conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", (int(notif_id), int(user_id)))
        return cur.rowcount > 0

    def cleanup_old(self, days: int = 30) -> int:
        """Supprime les notifications plus vieilles que 'days' jours."""
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        with _sync_connect() as conn:
            cur = conn.execute("DELETE FROM notifications WHERE created_at < ?", (cutoff,))
        return cur.rowcount

    def broadcast(self, title: str, message: str) -> int:
        """Envoie une notification Ã  tous les utilisateurs."""
        now = _now()
        with _sync_connect() as conn:
            users = conn.execute("SELECT id FROM users").fetchall()
            if not users:
                return 0
            
            data = [(u["id"], str(title), str(message), now) for u in users]
            conn.executemany(
                "INSERT INTO notifications (user_id, title, message, created_at) VALUES (?, ?, ?, ?)",
                data
            )
            return len(data)

# ==============================================================================
# SECURITY (IP BANS)
# ==============================================================================
class SecurityRepo:
    def get(self, ip: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM ip_security WHERE ip = ?", (ip,)).fetchone()
        return _row_to_dict(row) if row else None

    def upsert(self, ip: str, fail_count: int, banned_until: float) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO ip_security (ip, fail_count, banned_until, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(ip) DO UPDATE SET
                       fail_count=excluded.fail_count,
                       banned_until=excluded.banned_until,
                       updated_at=excluded.updated_at""",
                (ip, int(fail_count), float(banned_until), now)
            )

    def delete(self, ip: str) -> None:
        with _sync_connect() as conn:
            conn.execute("DELETE FROM ip_security WHERE ip = ?", (ip,))

    def get_all(self) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute("SELECT * FROM ip_security ORDER BY updated_at DESC").fetchall()
        return _rows_to_list(rows)

    def count_active(self, now_ts: Optional[float] = None) -> int:
        now_ts = float(now_ts if now_ts is not None else time.time())
        conn = _sync_connect()
        row = conn.execute(
            "SELECT COUNT(*) FROM ip_security WHERE banned_until > ?",
            (now_ts,),
        ).fetchone()
        return int(row[0]) if row else 0

# ==============================================================================
# FACADE PRINCIPALE
# ==============================================================================
class ScanJobsRepo:
    def _normalize(self, row) -> dict:
        payload = _row_to_dict(row)
        payload["job_context"] = _from_json_col(payload.get("job_context_json", "{}")) or {}
        payload["request_payload"] = _from_json_col(payload.get("request_payload_json", "{}")) or {}
        payload["summary"] = _from_json_col(payload.get("summary_json", "{}")) or {}
        payload["hits"] = _from_json_col(payload.get("hits_json", "[]")) or []
        return payload

    def create(self, entry: dict) -> dict:
        now = _now()
        payload = dict(entry or {})
        payload.setdefault("job_id", uuid.uuid4().hex)
        payload.setdefault("job_kind", "")
        payload.setdefault("status", "queued")
        payload.setdefault("created_by_username", "")
        payload.setdefault("requested_range", "")
        payload.setdefault("requested_operator", "")
        payload.setdefault("requested_sni", "")
        payload.setdefault("engine_name", "")
        payload.setdefault("mode", "")
        payload.setdefault("job_context", {})
        payload.setdefault("request_payload", {})
        payload.setdefault("summary", {})
        payload.setdefault("hits", [])
        payload.setdefault("error_text", "")
        payload.setdefault("started_at", "")
        payload.setdefault("finished_at", "")
        payload.setdefault("created_at", now)
        payload.setdefault("updated_at", now)
        with _sync_connect() as conn:
            cur = conn.execute(
                "INSERT INTO scan_jobs (job_id, job_kind, status, created_by_username, requested_range, requested_operator, requested_sni, engine_name, mode, job_context_json, request_payload_json, summary_json, hits_json, error_text, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(payload.get("job_id", "") or "").strip(),
                    str(payload.get("job_kind", "") or "").strip(),
                    str(payload.get("status", "queued") or "queued").strip(),
                    str(payload.get("created_by_username", "") or "").strip(),
                    str(payload.get("requested_range", "") or "").strip(),
                    str(payload.get("requested_operator", "") or "").strip(),
                    str(payload.get("requested_sni", "") or "").strip(),
                    str(payload.get("engine_name", "") or "").strip(),
                    str(payload.get("mode", "") or "").strip(),
                    _json_col(payload.get("job_context", {})),
                    _json_col(payload.get("request_payload", {})),
                    _json_col(payload.get("summary", {})),
                    _json_col(payload.get("hits", [])),
                    str(payload.get("error_text", "") or "").strip(),
                    str(payload.get("started_at", "") or "").strip(),
                    str(payload.get("finished_at", "") or "").strip(),
                    str(payload.get("created_at", now) or now),
                    str(payload.get("updated_at", now) or now),
                ),
            )
            conn.commit()
            payload["id"] = cur.lastrowid
        return self._normalize(payload)

    def get_by_job_id(self, job_id: str) -> Optional[dict]:
        with _sync_connect() as conn:
            row = conn.execute(
                "SELECT * FROM scan_jobs WHERE job_id = ?",
                (str(job_id or "").strip(),),
            ).fetchone()
        return self._normalize(row) if row else None

    def list_recent(self, limit: int = 20) -> list[dict]:
        with _sync_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM scan_jobs ORDER BY created_at DESC, id DESC LIMIT ?",
                (max(1, int(limit or 20)),),
            ).fetchall()
        return [self._normalize(row) for row in rows]

    def update(self, job_id: str, patch: dict) -> Optional[dict]:
        current = self.get_by_job_id(job_id)
        if not current:
            return None
        payload = dict(current)
        payload.update(dict(patch or {}))
        payload["updated_at"] = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE scan_jobs SET job_kind = ?, status = ?, created_by_username = ?, requested_range = ?, requested_operator = ?, requested_sni = ?, engine_name = ?, mode = ?, job_context_json = ?, request_payload_json = ?, summary_json = ?, hits_json = ?, error_text = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE job_id = ?",
                (
                    str(payload.get("job_kind", "") or "").strip(),
                    str(payload.get("status", "queued") or "queued").strip(),
                    str(payload.get("created_by_username", "") or "").strip(),
                    str(payload.get("requested_range", "") or "").strip(),
                    str(payload.get("requested_operator", "") or "").strip(),
                    str(payload.get("requested_sni", "") or "").strip(),
                    str(payload.get("engine_name", "") or "").strip(),
                    str(payload.get("mode", "") or "").strip(),
                    _json_col(payload.get("job_context", {})),
                    _json_col(payload.get("request_payload", {})),
                    _json_col(payload.get("summary", {})),
                    _json_col(payload.get("hits", [])),
                    str(payload.get("error_text", "") or "").strip(),
                    str(payload.get("started_at", "") or "").strip(),
                    str(payload.get("finished_at", "") or "").strip(),
                    str(payload.get("updated_at", _now()) or _now()),
                    str(job_id or "").strip(),
                ),
            )
            conn.commit()
        return self.get_by_job_id(job_id)


class ScannerStateRepo:
    def get(self) -> dict:
        conn = _sync_connect()
        try:
            row = conn.execute("SELECT * FROM scanner_state WHERE id = 1").fetchone()
        except sqlite3.OperationalError:
            init_db()
            conn = _sync_connect()
            row = conn.execute("SELECT * FROM scanner_state WHERE id = 1").fetchone()
        if not row:
            default = {
                "id": 1,
                "running": 0,
                "progress": 0,
                "total": 0,
                "current_target": "",
                "current_engine": "Pret",
                "hits": [],
                "found_snis": [],
                "updated_at": _now(),
            }
            self.set(default)
            return default
        d = dict(row)
        d["hits"] = _from_json_col(d.get("hits", "[]")) or []
        d["found_snis"] = _from_json_col(d.get("found_snis", "[]")) or []
        return d

    def set(self, state: dict) -> None:
        now = _now()
        state = dict(state or {})
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO scanner_state
                   (id, running, progress, total, current_target, current_engine, hits, found_snis, updated_at)
                   VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                       running=excluded.running,
                       progress=excluded.progress,
                       total=excluded.total,
                       current_target=excluded.current_target,
                       current_engine=excluded.current_engine,
                       hits=excluded.hits,
                       found_snis=excluded.found_snis,
                       updated_at=excluded.updated_at""",
                (
                    int(bool(state.get("running", 0))),
                    int(state.get("progress", 0) or 0),
                    int(state.get("total", 0) or 0),
                    str(state.get("current_target", "") or ""),
                    str(state.get("current_engine", "Pret") or "Pret"),
                    _json_col(state.get("hits", [])),
                    _json_col(state.get("found_snis", [])),
                    now,
                ),
            )


class UdpScannerStateRepo:
    def get(self) -> dict:
        conn = _sync_connect()
        try:
            row = conn.execute("SELECT * FROM udp_scanner_state WHERE id = 1").fetchone()
        except sqlite3.OperationalError:
            init_db()
            conn = _sync_connect()
            row = conn.execute("SELECT * FROM udp_scanner_state WHERE id = 1").fetchone()
        if not row:
            default = {
                "id": 1,
                "running": 0,
                "progress": 0,
                "total": 0,
                "results": [],
                "updated_at": _now(),
            }
            self.set(default)
            return default
        d = dict(row)
        d["results"] = _from_json_col(d.get("results", "[]")) or []
        return d

    def set(self, state: dict) -> None:
        now = _now()
        state = dict(state or {})
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO udp_scanner_state
                   (id, running, progress, total, results, updated_at)
                   VALUES (1, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                       running=excluded.running,
                       progress=excluded.progress,
                       total=excluded.total,
                       results=excluded.results,
                       updated_at=excluded.updated_at""",
                (
                    int(bool(state.get("running", 0))),
                    int(state.get("progress", 0) or 0),
                    int(state.get("total", 0) or 0),
                    _json_col(state.get("results", [])),
                    now,
                ),
            )

# ==============================================================================
# SUBSCRIPTIONS / SERVICES / SERVERS / CONFIGURATIONS
# ==============================================================================
class SubscriptionsRepo:
    def add(self, record: dict) -> dict:
        now = _now()
        record = dict(record)
        record.setdefault("plan", "Gratuit")
        record.setdefault("status", "active")
        record.setdefault("started_at", now)
        record.setdefault("source", "")
        record.setdefault("expires_at", "")
        record.setdefault("created_at", now)
        record["updated_at"] = now

        fields = ["user_id", "plan", "status", "source", "started_at", "expires_at", "created_at", "updated_at"]
        with _sync_connect() as conn:
            cols = ", ".join(fields)
            placeholders = ", ".join("?" * len(fields))
            vals = [record.get(f) for f in fields]
            cur = conn.execute(f"INSERT INTO subscriptions ({cols}) VALUES ({placeholders})", vals)
            record["id"] = cur.lastrowid
        return record

    def get_by_id(self, subscription_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM subscriptions WHERE id = ?", (int(subscription_id),)).fetchone()
        return _row_to_dict(row) if row else None

    def get_active_for_user(self, user_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
            (int(user_id),)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def get_by_user(self, user_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC", (int(user_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def update_status(self, subscription_id: int, status: str) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE subscriptions SET status=?, updated_at=? WHERE id=?",
                (status, now, int(subscription_id))
            )


class ServersRepo:
    def add(self, record: dict) -> dict:
        now = _now()
        record = dict(record)
        record.setdefault("name", "")
        record.setdefault("country", "")
        record.setdefault("city", "")
        record.setdefault("status", "available")
        record.setdefault("infrastructure_ref", "")
        record.setdefault("protocol", "")
        record.setdefault("capabilities", "")
        record.setdefault("visible_plans", "Gratuit,VIP,Revendeur,ADMIN")
        record.setdefault("allow_insecure", 0)
        record.setdefault("created_at", now)
        record["updated_at"] = now

        fields = ["name", "country", "city", "status", "infrastructure_ref", "protocol", "capabilities", "visible_plans", "allow_insecure", "created_at", "updated_at"]
        with _sync_connect() as conn:
            cols = ", ".join(fields)
            placeholders = ", ".join("?" * len(fields))
            vals = [record.get(f) for f in fields]
            cur = conn.execute(f"INSERT INTO servers ({cols}) VALUES ({placeholders})", vals)
            record["id"] = cur.lastrowid
        return record

    def get_by_id(self, server_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM servers WHERE id = ?", (int(server_id),)).fetchone()
        return _row_to_dict(row) if row else None

    def get_all(self, status: Optional[str] = None) -> list[dict]:
        conn = _sync_connect()
        if status:
            rows = conn.execute(
                "SELECT * FROM servers WHERE status = ? ORDER BY country, city", (status,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM servers ORDER BY country, city").fetchall()
        return _rows_to_list(rows)

    def get_visible_for_plan(self, plan: str, status: str = "available") -> list[dict]:
        """Serveurs dont `visible_plans` contient le plan donne (comparaison simple
        sur la liste separee par virgules -- suffisant pour ce volume de donnees)."""
        plan_norm = str(plan or "").strip()
        rows = self.get_all(status=status)
        out = []
        for row in rows:
            allowed = [p.strip() for p in str(row.get("visible_plans", "") or "").split(",") if p.strip()]
            if not allowed or plan_norm in allowed:
                out.append(row)
        return out

    def update_status(self, server_id: int, status: str) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE servers SET status=?, updated_at=? WHERE id=?",
                (status, now, int(server_id))
            )

    def update_fields(self, server_id: int, fields: dict) -> Optional[dict]:
        """Mise a jour partielle, reservee a l'admin (nom, protocole, plans
        visibles, statut) -- ne touche jamais infrastructure_ref (lien technique
        automatique vers le panel 3x-ui, gere uniquement par la synchronisation)."""
        allowed_keys = {"name", "country", "city", "status", "protocol", "capabilities", "visible_plans", "allow_insecure"}
        updates = {k: v for k, v in fields.items() if k in allowed_keys}
        if not updates:
            return self.get_by_id(server_id)
        now = _now()
        set_clause = ", ".join(f"{k}=?" for k in updates.keys())
        vals = list(updates.values()) + [now, int(server_id)]
        with _sync_connect() as conn:
            conn.execute(f"UPDATE servers SET {set_clause}, updated_at=? WHERE id=?", vals)
        return self.get_by_id(server_id)

    def get_by_infrastructure_ref(self, infrastructure_ref: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM servers WHERE infrastructure_ref = ?", (str(infrastructure_ref or ""),)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def upsert_by_infrastructure_ref(self, record: dict) -> dict:
        """Cree ou met a jour un serveur d'apres sa reference technique (panel_id 3x-ui).
        Ne touche jamais country/city/visible_plans si deja renseignes manuellement par
        un admin -- seuls name/status/protocol sont resynchronises depuis le panel a
        chaque appel (l'admin garde la main sur qui voit quoi)."""
        infra_ref = str(record.get("infrastructure_ref", "") or "").strip()
        if not infra_ref:
            return self.add(record)

        existing = self.get_by_infrastructure_ref(infra_ref)
        if existing is None:
            return self.add(record)

        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE servers SET name=?, status=?, protocol=?, updated_at=? WHERE id=?",
                (
                    str(record.get("name", existing.get("name", "")) or ""),
                    str(record.get("status", existing.get("status", "available")) or "available"),
                    str(record.get("protocol", existing.get("protocol", "")) or ""),
                    now,
                    int(existing["id"]),
                )
            )
        existing["name"] = str(record.get("name", existing.get("name", "")) or "")
        existing["status"] = str(record.get("status", existing.get("status", "available")) or "available")
        existing["protocol"] = str(record.get("protocol", existing.get("protocol", "")) or "")
        existing["updated_at"] = now
        return existing


class ServerPlanRulesRepo:
    """Regles d'acces (duree d'essai, quota) par (serveur, plan). Absence de
    regle pour une combinaison donnee = illimite (comportement historique
    preserve pour tout profil cree avant l'existence de cette table)."""

    def get_for_server(self, server_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM server_plan_rules WHERE server_id = ? ORDER BY plan", (int(server_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def get_rule(self, server_id: int, plan: str) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM server_plan_rules WHERE server_id = ? AND plan = ?",
            (int(server_id), str(plan or ""))
        ).fetchone()
        return _row_to_dict(row) if row else None

    def upsert(self, server_id: int, plan: str, *, max_duration_minutes: int = 0, quota_mb: int = 0) -> dict:
        now = _now()
        plan = str(plan or "").strip()
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO server_plan_rules (server_id, plan, max_duration_minutes, quota_mb, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(server_id, plan) DO UPDATE SET
                       max_duration_minutes = excluded.max_duration_minutes,
                       quota_mb = excluded.quota_mb,
                       updated_at = excluded.updated_at""",
                (int(server_id), plan, int(max_duration_minutes or 0), int(quota_mb or 0), now, now)
            )
        return self.get_rule(server_id, plan) or {}

    def delete_for_server(self, server_id: int) -> None:
        with _sync_connect() as conn:
            conn.execute("DELETE FROM server_plan_rules WHERE server_id = ?", (int(server_id),))


class DeviceTrialUsageRepo:
    """Anti-abus de l'essai gratuit : verrouille par identifiant d'appareil,
    pas par compte -- creer un nouveau compte sur le meme telephone ne
    redonne pas un nouvel essai."""

    def get_by_device_id(self, device_id: str) -> Optional[dict]:
        device_id = str(device_id or "").strip()
        if not device_id:
            return None
        conn = _sync_connect()
        row = conn.execute(
            "SELECT * FROM device_trial_usage WHERE device_id = ?", (device_id,)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def mark_trial_used(self, device_id: str, *, user_id: int, username: str) -> dict:
        device_id = str(device_id or "").strip()
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                """INSERT INTO device_trial_usage (device_id, trial_used, first_user_id, first_username, first_seen_at, updated_at)
                   VALUES (?, 1, ?, ?, ?, ?)
                   ON CONFLICT(device_id) DO UPDATE SET
                       trial_used = 1,
                       updated_at = excluded.updated_at""",
                (device_id, int(user_id or 0), str(username or ""), now, now)
            )
        return self.get_by_device_id(device_id) or {}


class PrivateMessagesRepo:
    """Messagerie privee : une conversation = 1 client (conversation_user_id)
    + son gestionnaire (admin ou revendeur selon la filiation). Pas de salon
    de groupe -- chaque client a sa propre file, comme un fil de support."""

    def add(self, msg: dict) -> dict:
        now = _now()
        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO private_messages
                   (conversation_user_id, sender_user_id, sender_username, sender_role,
                    body, message_type, attachment_data, attachment_mime, attachment_filename,
                    read_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
                (
                    int(msg["conversation_user_id"]),
                    int(msg["sender_user_id"]),
                    str(msg.get("sender_username", "") or ""),
                    str(msg.get("sender_role", "") or ""),
                    str(msg.get("body", "") or ""),
                    str(msg.get("message_type", "text") or "text"),
                    str(msg.get("attachment_data", "") or ""),
                    str(msg.get("attachment_mime", "") or ""),
                    str(msg.get("attachment_filename", "") or ""),
                    now,
                )
            )
            msg_id = cur.lastrowid
        return self.get_by_id(msg_id) or {}

    def get_by_id(self, msg_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM private_messages WHERE id = ?", (int(msg_id),)).fetchone()
        return _row_to_dict(row) if row else None

    def get_conversation(self, conversation_user_id: int, *, limit: int = 200) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM private_messages WHERE conversation_user_id = ? ORDER BY created_at ASC LIMIT ?",
            (int(conversation_user_id), int(limit))
        ).fetchall()
        return _rows_to_list(rows)

    def mark_read(self, conversation_user_id: int, *, reader_is_client: bool) -> None:
        """Marque comme lus les messages que le lecteur N'A PAS envoyes lui-meme
        (le client lit les messages du gestionnaire, ou l'inverse)."""
        now = _now()
        with _sync_connect() as conn:
            if reader_is_client:
                conn.execute(
                    "UPDATE private_messages SET read_at = ? WHERE conversation_user_id = ? AND sender_user_id != ? AND read_at = 0",
                    (now, int(conversation_user_id), int(conversation_user_id))
                )
            else:
                conn.execute(
                    "UPDATE private_messages SET read_at = ? WHERE conversation_user_id = ? AND sender_user_id = ? AND read_at = 0",
                    (now, int(conversation_user_id), int(conversation_user_id))
                )

    def get_unread_count(self, conversation_user_id: int, *, for_client: bool) -> int:
        conn = _sync_connect()
        if for_client:
            row = conn.execute(
                "SELECT COUNT(*) as c FROM private_messages WHERE conversation_user_id = ? AND sender_user_id != ? AND read_at = 0",
                (int(conversation_user_id), int(conversation_user_id))
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) as c FROM private_messages WHERE conversation_user_id = ? AND sender_user_id = ? AND read_at = 0",
                (int(conversation_user_id), int(conversation_user_id))
            ).fetchone()
        return int(row["c"]) if row else 0

    def get_conversations_summary(self, conversation_user_ids: list[int]) -> list[dict]:
        """Pour l'admin/revendeur : dernier message + nb non-lus, pour chacun
        de ses clients (liste filtree en amont selon la filiation)."""
        if not conversation_user_ids:
            return []
        conn = _sync_connect()
        placeholders = ",".join("?" for _ in conversation_user_ids)
        rows = conn.execute(
            f"""SELECT conversation_user_id, body, sender_username, message_type, created_at
                FROM private_messages
                WHERE id IN (
                    SELECT MAX(id) FROM private_messages
                    WHERE conversation_user_id IN ({placeholders})
                    GROUP BY conversation_user_id
                )""",
            tuple(conversation_user_ids)
        ).fetchall()
        return _rows_to_list(rows)


class InvoicesRepo:
    def add(self, invoice: dict) -> dict:
        now = _now()
        with _sync_connect() as conn:
            cur = conn.execute(
                """INSERT INTO invoices
                   (invoice_number, user_id, username, plan, duration_days, amount_label,
                    issued_by_user_id, issued_by_username, pdf_path, message_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(invoice["invoice_number"]),
                    int(invoice["user_id"]),
                    str(invoice.get("username", "") or ""),
                    str(invoice.get("plan", "") or ""),
                    int(invoice.get("duration_days", 0) or 0),
                    str(invoice.get("amount_label", "") or ""),
                    invoice.get("issued_by_user_id"),
                    str(invoice.get("issued_by_username", "") or ""),
                    str(invoice.get("pdf_path", "") or ""),
                    invoice.get("message_id"),
                    now,
                )
            )
            inv_id = cur.lastrowid
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM invoices WHERE id = ?", (inv_id,)).fetchone()
        return _row_to_dict(row) if row else {}

    def get_for_user(self, user_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC", (int(user_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def count_all(self) -> int:
        conn = _sync_connect()
        row = conn.execute("SELECT COUNT(*) as c FROM invoices").fetchone()
        return int(row["c"]) if row else 0


class ServicesRepo:
    def add(self, record: dict) -> dict:
        now = _now()
        record = dict(record)
        record.setdefault("type", "VPN")
        record.setdefault("status", "active")
        record.setdefault("created_at", now)
        record["updated_at"] = now

        fields = ["user_id", "subscription_id", "server_id", "type", "status", "created_at", "updated_at"]
        with _sync_connect() as conn:
            cols = ", ".join(fields)
            placeholders = ", ".join("?" * len(fields))
            vals = [record.get(f) for f in fields]
            cur = conn.execute(f"INSERT INTO services ({cols}) VALUES ({placeholders})", vals)
            record["id"] = cur.lastrowid
        return record

    def get_by_id(self, service_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM services WHERE id = ?", (int(service_id),)).fetchone()
        return _row_to_dict(row) if row else None

    def get_by_user(self, user_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM services WHERE user_id = ? ORDER BY created_at DESC", (int(user_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def update_status(self, service_id: int, status: str) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE services SET status=?, updated_at=? WHERE id=?",
                (status, now, int(service_id))
            )


class ConfigurationsRepo:
    def add(self, record: dict) -> dict:
        now = _now()
        record = dict(record)
        record.setdefault("protocol", "")
        record.setdefault("status", "active")
        record.setdefault("technical_data", "")
        record.setdefault("expires_at", "")
        record.setdefault("created_at", now)
        record["updated_at"] = now

        fields = [
            "user_id", "service_id", "server_id", "protocol", "status",
            "technical_data", "expires_at", "created_at", "updated_at"
        ]
        with _sync_connect() as conn:
            cols = ", ".join(fields)
            placeholders = ", ".join("?" * len(fields))
            vals = [record.get(f) for f in fields]
            cur = conn.execute(f"INSERT INTO configurations ({cols}) VALUES ({placeholders})", vals)
            record["id"] = cur.lastrowid
        return record

    def get_by_id(self, configuration_id: int) -> Optional[dict]:
        conn = _sync_connect()
        row = conn.execute("SELECT * FROM configurations WHERE id = ?", (int(configuration_id),)).fetchone()
        return _row_to_dict(row) if row else None

    def get_by_user(self, user_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM configurations WHERE user_id = ? ORDER BY created_at DESC", (int(user_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def get_by_service(self, service_id: int) -> list[dict]:
        conn = _sync_connect()
        rows = conn.execute(
            "SELECT * FROM configurations WHERE service_id = ? ORDER BY created_at DESC", (int(service_id),)
        ).fetchall()
        return _rows_to_list(rows)

    def update_status(self, configuration_id: int, status: str) -> None:
        now = _now()
        with _sync_connect() as conn:
            conn.execute(
                "UPDATE configurations SET status=?, updated_at=? WHERE id=?",
                (status, now, int(configuration_id))
            )


class Database:
    """Point d'entrÃ©e unique pour toutes les opÃ©rations BDD."""

    def __init__(self):
        self.users               = UsersRepo()
        self.sessions            = SessionsRepo()
        self.payments            = PaymentsRepo()
        self.tchat               = TchatRepo()
        self.private_messages    = PrivateMessagesRepo()
        self.activation_keys     = ActivationKeysRepo()
        self.tchat_quotas        = TchatQuotasRepo()
        self.ads                 = AdsRepo()
        self.archive             = ArchiveRepo()
        self.udp_results         = UdpResultsRepo()
        self.configs_distribution = ConfigsDistributionRepo()
        self.vip_tokens          = VipTokensRepo()
        self.promo_codes         = PromoCodesRepo()
        self.delegated_admin_grants = DelegatedAdminGrantsRepo()
        self.account_action_tokens = AccountActionTokensRepo()
        self.scan_jobs           = ScanJobsRepo()
        self.scanner_state       = ScannerStateRepo()
        self.udp_scanner_state   = UdpScannerStateRepo()
        self.service_requests    = ServiceRequestsRepo()
        self.notifications       = NotificationsRepo()
        self.security            = SecurityRepo()
        self.user_history        = UserHistoryRepo()
        self.subscriptions       = SubscriptionsRepo()
        self.servers             = ServersRepo()
        self.server_plan_rules   = ServerPlanRulesRepo()
        self.device_trial_usage  = DeviceTrialUsageRepo()
        self.private_messages    = PrivateMessagesRepo()
        self.invoices            = InvoicesRepo()
        self.services            = ServicesRepo()
        self.configurations      = ConfigurationsRepo()

    async def init(self) -> None:
        await init_db()

    async def close(self) -> None:
        global _conn
        if _conn:
            await _conn.close()
            _conn = None


# Instance globale (Ã  importer dans main.py)
db = Database()


# ==============================================================================
# SCRIPT DE MIGRATION JSON â†’ SQLITE
# ==============================================================================
def _load_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  [SKIP] {path} : {e}")
        return None


def migrate_from_json() -> None:
    """Importe les donnÃ©es des fichiers JSON existants dans SQLite."""
    print("\n=== MIGRATION JSON â†’ SQLite ===")
    db.init()

    # â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["users"])
    if isinstance(data, list):
        print(f"  users : {len(data)} enregistrements")
        for u in data:
            if isinstance(u, dict):
                db.users.save(u)
        print("  âœ“ users importÃ©s")

    # â”€â”€ Sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["sessions"])
    if isinstance(data, dict):
        now = time.time()
        count = 0
        for token, sess in data.items():
            if isinstance(sess, dict) and float(sess.get("expires_at", 0)) > now:
                db.sessions.set(
                    token,
                    int(sess.get("user_id", 0) or 0),
                    str(sess.get("username", "")),
                    float(sess.get("expires_at", 0)),
                )
                count += 1
        print(f"  âœ“ {count} sessions actives importÃ©es")

    # â”€â”€ Payments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["payments"])
    if isinstance(data, list):
        print(f"  payments : {len(data)} enregistrements")
        for p in data:
            if isinstance(p, dict):
                db.payments.add(p)
        print("  âœ“ payments importÃ©s")

    # â”€â”€ Tchat messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["tchat"])
    if isinstance(data, list):
        print(f"  tchat : {len(data)} messages")
        for m in data:
            if isinstance(m, dict):
                db.tchat.add(m)
        print("  âœ“ messages tchat importÃ©s")

    # â”€â”€ Private messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["private_messages"])
    if isinstance(data, list):
        print(f"  messages privÃ©s : {len(data)}")
        for m in data:
            if isinstance(m, dict):
                db.private_messages.add(m)
        print("  âœ“ messages privÃ©s importÃ©s")

    # â”€â”€ Activation keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["activation_keys"])
    if isinstance(data, list):
        print(f"  activation_keys : {len(data)}")
        for k in data:
            if isinstance(k, dict):
                db.activation_keys.add(k)
        print("  âœ“ clÃ©s d'activation importÃ©es")

    # â”€â”€ Tchat quotas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["tchat_quotas"])
    if isinstance(data, dict):
        today = datetime.now().strftime("%Y-%m-%d")
        count = 0
        for username, rec in data.items():
            if isinstance(rec, dict) and rec.get("date") == today:
                db.tchat_quotas.upsert(
                    username, today,
                    int(rec.get("files", 0)),
                    int(rec.get("links", 0)),
                    float(rec.get("last_msg", 0)),
                )
                count += 1
        print(f"  âœ“ {count} quotas tchat importÃ©s")

    # â”€â”€ Ads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["ads"])
    if isinstance(data, list):
        print(f"  ads : {len(data)}")
        for ad in data:
            if isinstance(ad, dict):
                ad_copy = dict(ad)
                ad_copy.pop("id", None)  # laisser SQLite gÃ©nÃ©rer l'ID
                db.ads.save(ad_copy)
        print("  âœ“ publicitÃ©s importÃ©es")

    # â”€â”€ Archive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["archive"])
    if isinstance(data, list):
        print(f"  archive : {len(data)} entrÃ©es")
        for entry in data:
            if isinstance(entry, dict):
                db.archive.add(entry)
        print("  âœ“ archive importÃ©e")

    # â”€â”€ Configs distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["configs_distribution"])
    if isinstance(data, dict):
        for key, value in data.items():
            db.configs_distribution.set(key, value)
        print("  âœ“ configs_distribution importÃ©es")

    # â”€â”€ Service Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    data = _load_json(_JSON_FILES["service_requests"])
    if isinstance(data, list):
        print(f"  service_requests : {len(data)} entrÃ©es")
        for entry in data:
            if isinstance(entry, dict):
                db.service_requests.add(entry)
        print("  âœ“ service_requests importÃ©es")
    print("\n=== MIGRATION TERMINÃ‰E ===")
    print(f"  Base SQLite : {DB_PATH}")
    users_count = db.users.count()
    print(f"  Utilisateurs : {users_count}")
    print()


# ==============================================================================
# POINT D'ENTRÃ‰E CLI
# ==============================================================================
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "migrate":
        migrate_from_json()
    else:
        print("Usage:")
        print("  python database.py migrate    # Importe les JSON existants â†’ SQLite")
        print()
        print("En Python:")
        print("  from database import db")
        print("  db.init()                     # CrÃ©e les tables")
        print("  users = db.users.get_all()")
