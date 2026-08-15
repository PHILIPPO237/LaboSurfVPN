import aiosqlite
from pathlib import Path
from typing import Any, Dict, List, Optional

# Chemin vers la base SQLite partagee par l'application.
DB_PATH = Path(__file__).resolve().parent.parent.parent / "labo.db"


async def init_db():
    """
    Initialise une base compatible avec le schema principal.
    Cette couche legacy reste utilisee par quelques scripts async.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                contact TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL DEFAULT '',
                service_password TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL DEFAULT 'Gratuit',
                role_code TEXT NOT NULL DEFAULT '',
                default_panel_key TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                license TEXT NOT NULL DEFAULT '',
                uuid_secondary TEXT NOT NULL DEFAULT '',
                uuid_short TEXT NOT NULL DEFAULT '',
                recovery_secret_hash TEXT NOT NULL DEFAULT '',
                forbidden_attempts INTEGER NOT NULL DEFAULT 0,
                last_forbidden_need TEXT NOT NULL DEFAULT '',
                last_forbidden_at TEXT NOT NULL DEFAULT '',
                expiration TEXT NOT NULL DEFAULT '',
                expiration_date TEXT NOT NULL DEFAULT '',
                quota_gb REAL,
                limit_ip INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                avatar TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS tchat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                user_type TEXT DEFAULT 'Gratuit',
                content TEXT NOT NULL,
                is_system BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await db.commit()


async def get_all_users() -> List[Dict[str, Any]]:
    """Renvoie tous les utilisateurs sous forme de dictionnaires."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users ORDER BY id DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Récupère un utilisateur spécifique sous forme de dictionnaire."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE username = ?", (username,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Récupère un utilisateur par son ID."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def create_user(user_data: Dict[str, Any]) -> int:
    """Insère un nouvel utilisateur et retourne son ID."""
    columns = ", ".join(user_data.keys())
    placeholders = ", ".join(["?"] * len(user_data))
    values = tuple(user_data.values())
    query = f"INSERT INTO users ({columns}) VALUES ({placeholders})"
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(query, values) as cursor:
            await db.commit()
            return cursor.lastrowid


async def update_user(user_id: int, update_data: Dict[str, Any]) -> bool:
    """Met à jour un utilisateur existant sans réécrire l'ensemble de la base."""
    if not update_data:
        return True
    set_clause = ", ".join([f"{k} = ?" for k in update_data.keys()])
    values = tuple(update_data.values()) + (user_id,)
    query = f"UPDATE users SET {set_clause} WHERE id = ?"
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(query, values) as cursor:
            await db.commit()
            return cursor.rowcount > 0


async def delete_user(user_id: int) -> bool:
    """Supprime un utilisateur."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("DELETE FROM users WHERE id = ?", (user_id,)) as cursor:
            await db.commit()
            return cursor.rowcount > 0


async def add_tchat_message(username: str, user_type: str, content: str, is_system: bool = False) -> int:
    """Insère un message de tchat."""
    query = "INSERT INTO tchat_messages (username, user_type, content, is_system) VALUES (?, ?, ?, ?)"
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(query, (username, user_type, content, is_system)) as cursor:
            await db.commit()
            return cursor.lastrowid


async def get_recent_tchat_messages(limit: int = 50) -> List[Dict[str, Any]]:
    """Récupère les derniers messages de tchat, du plus ancien au plus récent."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM tchat_messages ORDER BY id DESC LIMIT ?"
        async with db.execute(query, (limit,)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in reversed(rows)]
