import json
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "labo.db"
USERS_JSON_PATH = BASE_DIR / "labo_users.json"

def migrate():
    if not USERS_JSON_PATH.exists():
        print(f"Fichier {USERS_JSON_PATH} introuvable.")
        return

    with open(USERS_JSON_PATH, "r", encoding="utf-8") as f:
        users = json.load(f)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Ajouter les colonnes V2 si elles n'existent pas encore
    cursor.execute("PRAGMA table_info(users)")
    columns = [info[1] for info in cursor.fetchall()]
    
    if "role_code" not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN role_code TEXT")
    if "default_panel_key" not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN default_panel_key TEXT")

    print(f"Migration de {len(users)} utilisateurs vers le modèle V2...")
    
    for user in users:
        legacy_type = str(user.get("type", "Gratuit")).upper()
        role_code = "client"
        default_panel_key = "free"

        # Mapping des anciens types (Legacy) vers le modèle V2
        if legacy_type == "ADMIN":
            role_code = "admin"
            default_panel_key = "admin"
        elif legacy_type == "REVENDEUR":
            role_code = "reseller"
            default_panel_key = "reseller"
        elif legacy_type in ("VIP", "PREMIUM"):
            role_code = "client"
            default_panel_key = "premium"

        try:
            cursor.execute("""
                UPDATE users 
                SET role_code = ?, default_panel_key = ?, type = ?
                WHERE username = ?
            """, (role_code, default_panel_key, user.get("type"), user.get("username")))
            
            if cursor.rowcount == 0:
                print(f"  [!] {user.get('username')} non trouvé dans SQLite. (Veuillez importer les données de base d'abord).")
            else:
                print(f"  [OK] {user.get('username')} mis à jour avec le rôle '{role_code}'")
        except Exception as e:
            print(f"  [Erreur] Sur {user.get('username')}: {e}")
    
    conn.commit()
    conn.close()
    print("Migration V2 terminée ! Vous pouvez maintenant supprimer labo_users.json")

if __name__ == "__main__":
    migrate()