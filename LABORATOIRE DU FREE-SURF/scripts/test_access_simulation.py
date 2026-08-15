import sys
from pathlib import Path

# Ajout du dossier racine au PYTHONPATH pour importer l'application
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi.testclient import TestClient
from main import app

# Création du client de test FastAPI
client = TestClient(app)

def run_access_tests():
    print("=== 🚀 DÉMARRAGE DE LA SIMULATION DES ACCÈS ===\n")
    
    # 1. Tester les routes qui DOIVENT être publiques
    public_routes = [
        "/health",
        "/",
        "/static/css/motion.css", # Vérifie que les fichiers statiques sont accessibles
    ]
    
    print("--- 🟢 TEST DES ROUTES PUBLIQUES (Attendu: 200 OK) ---")
    for route in public_routes:
        response = client.get(route)
        if response.status_code == 200:
            print(f"✅ [SUCCÈS] {route} est en ligne. (Status: {response.status_code})")
        else:
            print(f"❌ [ERREUR] {route} est inaccessible ! (Status: {response.status_code})")

    # 2. Tester les routes qui DOIVENT être protégées (Simulation d'un pirate / visiteur anonyme)
    protected_routes = [
        "/dashboard",
        "/panel-gratuit",
        "/panel-vip",
        "/panel-revendeur",
        "/admin",
        "/admin/users",
        "/api/user/me",
        "/api/tchat/messages",
        "/admin/api/panel-health"
    ]

    print("\n--- 🔴 TEST DES ROUTES PROTÉGÉES NON-AUTHENTIFIÉ (Attendu: Blocage ou Redirection) ---")
    for route in protected_routes:
        # follow_redirects=False pour capturer la redirection vers la page de login
        response = client.get(route, follow_redirects=False)
        status = response.status_code
        
        if status in [302, 303, 307]:
            print(f"✅ [SÉCURISÉ] {route} redirige bien vers le login. (Status: {status})")
        elif status in [401, 403]:
            print(f"✅ [SÉCURISÉ] {route} bloque l'accès à l'API. (Status: {status})")
        else:
            print(f"❌ [ALERTE FAILLE] {route} est accessible publiquement ! (Status: {status})")

    print("\n=== ✨ FIN DE LA SIMULATION ===")

if __name__ == "__main__":
    run_access_tests()