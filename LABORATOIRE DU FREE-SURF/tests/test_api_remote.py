#!/usr/bin/env python3
"""Script de test des APIs - LABORATOIRE DU FREE-SURF."""

import json
import requests
from typing import Any, Dict, Optional
from urllib.parse import urljoin

# Configuration
API_HOST = "http://146.19.230.203:8000"
TIMEOUT = 10

# Couleurs pour le terminal
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    GRAY = '\033[90m'
    RESET = '\033[0m'

def log_test(name: str, status: str, message: str = "", details: Any = None):
    """Log résultat du test."""
    status_color = Colors.GREEN if status == "✓" else (Colors.RED if status == "✗" else Colors.YELLOW)
    print(f"{status_color}{status}{Colors.RESET} {name}")
    if message:
        print(f"  {Colors.GRAY}→ {message}{Colors.RESET}")
    if details:
        print(f"  {Colors.GRAY}{json.dumps(details, indent=2, ensure_ascii=False)[:200]}{Colors.RESET}")

class APITester:
    def __init__(self, host: str = API_HOST):
        self.host = host
        self.session = requests.Session()
        self.tests_passed = 0
        self.tests_failed = 0

    def test_health_check(self) -> bool:
        """Test vérification de santé basique."""
        try:
            response = self.session.get(urljoin(self.host, "/"), timeout=TIMEOUT)
            if response.status_code == 200:
                log_test("Health Check", "✓", f"Status {response.status_code}", None)
                self.tests_passed += 1
                return True
            else:
                log_test("Health Check", "✗", f"Status {response.status_code}")
                self.tests_failed += 1
                return False
        except Exception as e:
            log_test("Health Check", "✗", str(e))
            self.tests_failed += 1
            return False

    def test_endpoint(self, name: str, method: str = "GET", path: str = "/", 
                     data: Optional[Dict] = None, expected_status: int = 200, 
                     should_have_key: Optional[str] = None) -> bool:
        """Test générique d'endpoint."""
        try:
            url = urljoin(self.host, path)
            if method == "GET":
                response = self.session.get(url, timeout=TIMEOUT)
            elif method == "POST":
                response = self.session.post(url, json=data, timeout=TIMEOUT)
            else:
                log_test(name, "✗", f"Méthode {method} non supportée")
                self.tests_failed += 1
                return False

            status_ok = response.status_code == expected_status
            
            # Essayer parser JSON
            try:
                json_response = response.json()
                has_key = (should_have_key is None or 
                          should_have_key in json_response or 
                          should_have_key in str(json_response))
            except:
                json_response = None
                has_key = True

            if status_ok and has_key:
                log_test(name, "✓", f"Status {response.status_code}")
                self.tests_passed += 1
                return True
            else:
                if not status_ok:
                    log_test(name, "✗", f"Status {response.status_code} (attendu {expected_status})")
                elif not has_key:
                    log_test(name, "✗", f"Clé manquante: {should_have_key}")
                self.tests_failed += 1
                return False
        except Exception as e:
            log_test(name, "✗", str(e))
            self.tests_failed += 1
            return False

    def test_public_pages(self):
        """Test pages publiques."""
        print(f"\n{Colors.BLUE}=== Pages Publiques ==={Colors.RESET}")
        
        pages = [
            ("/", "Accueil"),
            ("/avant-propos", "Avant-propos"),
            ("/construction", "Page Construction"),
        ]
        
        for path, name in pages:
            self.test_endpoint(f"GET {name}", "GET", path, expected_status=200)

    def test_auth_pages(self):
        """Test pages authentification."""
        print(f"\n{Colors.BLUE}=== Pages Authentification ==={Colors.RESET}")
        
        self.test_endpoint("GET /acces", "GET", "/acces", expected_status=200)
        self.test_endpoint("GET /inscription", "GET", "/inscription", expected_status=200)

    def test_api_general(self):
        """Test endpoints API généraux."""
        print(f"\n{Colors.BLUE}=== API Générale ==={Colors.RESET}")
        
        # Test health - sans auth retourne 401/403
        self.test_endpoint("Admin Health (non authentifié)", "GET", "/admin/api/panel-health", 
                          expected_status=401)
        
        # Test zero-rating services
        self.test_endpoint("Zero-Rating Services", "GET", "/api/zero-rating/services",
                          expected_status=200, should_have_key="services")

    def test_api_errors(self):
        """Test gestion des erreurs."""
        print(f"\n{Colors.BLUE}=== Gestion des Erreurs ==={Colors.RESET}")
        
        # Test 404
        self.test_endpoint("Route inexistante", "GET", "/api/nonexistent", 
                          expected_status=404)

    def test_static_files(self):
        """Test fichiers statiques."""
        print(f"\n{Colors.BLUE}=== Fichiers Statiques ==={Colors.RESET}")
        
        self.test_endpoint("Static Manifest", "GET", "/static/manifest.json",
                          expected_status=200)

    def test_response_times(self):
        """Test les temps de réponse."""
        print(f"\n{Colors.BLUE}=== Performance ==={Colors.RESET}")
        
        import time
        
        endpoints = [
            "/",
            "/acces",
            "/api/zero-rating/services",
        ]
        
        for endpoint in endpoints:
            try:
                start = time.time()
                response = self.session.get(urljoin(self.host, endpoint), timeout=TIMEOUT)
                elapsed = (time.time() - start) * 1000
                
                color = Colors.GREEN if elapsed < 500 else (Colors.YELLOW if elapsed < 1000 else Colors.RED)
                status = "rapide" if elapsed < 500 else ("normal" if elapsed < 1000 else "lent")
                log_test(f"Temps {endpoint}", "✓", f"{elapsed:.0f}ms ({status})")
                self.tests_passed += 1
            except Exception as e:
                log_test(f"Temps {endpoint}", "✗", str(e))
                self.tests_failed += 1

    def run_all_tests(self):
        """Lancer tous les tests."""
        print(f"\n{Colors.BLUE}╔══════════════════════════════════════╗{Colors.RESET}")
        print(f"{Colors.BLUE}║  TEST DES APIs                        ║{Colors.RESET}")
        print(f"{Colors.BLUE}║  LABORATOIRE DU FREE-SURF             ║{Colors.RESET}")
        print(f"{Colors.BLUE}║  VPS: {self.host:<21}║{Colors.RESET}")
        print(f"{Colors.BLUE}╚══════════════════════════════════════╝{Colors.RESET}")
        
        # Vérification santé initiale
        if not self.test_health_check():
            print(f"\n{Colors.RED}L'application n'est pas accessible!{Colors.RESET}")
            return
        
        # Lancer les tests
        self.test_public_pages()
        self.test_auth_pages()
        self.test_api_general()
        self.test_static_files()
        self.test_api_errors()
        self.test_response_times()
        
        # Résumé
        print(f"\n{Colors.BLUE}═══════════════════════════════════════{Colors.RESET}")
        total = self.tests_passed + self.tests_failed
        percentage = (self.tests_passed / total * 100) if total > 0 else 0
        
        print(f"{Colors.BLUE}╭─ RÉSUMÉ{Colors.RESET}")
        print(f"│ Total: {total} tests")
        print(f"│ {Colors.GREEN}✓ Réussis: {self.tests_passed}{Colors.RESET}")
        print(f"│ {Colors.RED}✗ Échoués: {self.tests_failed}{Colors.RESET}")
        print(f"│ Taux: {percentage:.1f}%")
        print(f"{Colors.BLUE}╰─────────────────────────────────────{Colors.RESET}")
        
        if self.tests_failed == 0:
            print(f"\n{Colors.GREEN}✓ Tous les tests sont passés!{Colors.RESET}\n")
        else:
            print(f"\n{Colors.RED}✗ {self.tests_failed} test(s) ont échoué.{Colors.RESET}\n")
        
        return self.tests_failed == 0

if __name__ == "__main__":
    tester = APITester()
    success = tester.run_all_tests()
    exit(0 if success else 1)
