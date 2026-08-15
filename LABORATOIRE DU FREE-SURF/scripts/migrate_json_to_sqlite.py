import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime

# Ajoute le dossier racine au PYTHONPATH pour pouvoir importer l'application
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core import db_adapter

# Chemin vers ton fichier JSON actuel (modifie ce nom si nécessaire)
JSON_PATH = ROOT_DIR / "labo_users.json" 

async def migrate():
    print("=== DÉMARRAGE DE LA MIGRATION ===")
    print("1. Initialisation de la base de données SQLite...")
    await db_adapter.init_db()

    if not JSON_PATH.exists():
        print(f"❌ Erreur : Le fichier JSON '{JSON_PATH}' est introuvable.")
        print("Vérifie le nom du fichier (ex: labo_users.json ou .users.json) et réessaie.")
        return

    print(f"2. Lecture des données depuis {JSON_PATH}...")
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        try:
            users = json.load(f)
        except json.JSONDecodeError:
            print("❌ Erreur : Le fichier JSON est corrompu ou mal formaté.")
            return

    print(f"-> {len(users)} utilisateurs trouvés dans le JSON.")
    print("3. Migration des utilisateurs vers SQLite en cours...\n")

    success_count = 0
    skip_count = 0
    error_count = 0

    for user in users:
        username = user.get("username")
        if not username:
            continue

        try:
            # Vérifier si l'utilisateur existe déjà pour éviter les doublons
            existing = await db_adapter.get_user_by_username(username)
            if existing:
                print(f"  ⏭️ [SKIP] L'utilisateur '{username}' existe déjà dans SQLite.")
                skip_count += 1
                continue

            # Préparer et nettoyer les données pour correspondre à la table SQLite
            user_data = {
                "username": username,
                "password_hash": user.get("password_hash", user.get("password", "")),
                "type": user.get("type", "Gratuit"),
                "status": user.get("status", "active"),
                "license": user.get("license", ""),
                "uuid_short": user.get("uuid_short", user.get("uuid_secondary", "")),
                "expiration_date": user.get("expiration_date", user.get("expiration", "")),
                "quota_gb": user.get("quota_gb"),
                "limit_ip": user.get("limit_ip"),
                "notes": user.get("notes", ""),
                "avatar": user.get("avatar", ""),
                "created_at": user.get("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            }

            await db_adapter.create_user(user_data)
            success_count += 1
            print(f"  ✅ [OK] Utilisateur '{username}' migré avec succès.")
        except Exception as e:
            error_count += 1
            print(f"  ❌ [ERREUR] Impossible de migrer '{username}': {e}")

    print("\n=== BILAN DE LA MIGRATION ===")
    print(f"✅ Migrés avec succès : {success_count}")
    print(f"⏭️ Ignorés (déjà existants) : {skip_count}")
    print(f"❌ Erreurs : {error_count}")
    print("===============================\n")
    print("Tu peux maintenant utiliser la base de données 'labo.db' de manière sécurisée !")

if __name__ == "__main__":
    asyncio.run(migrate())