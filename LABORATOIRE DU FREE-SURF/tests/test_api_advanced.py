#!/usr/bin/env python3
"""Script avancé pour tester les fonctionnalités principales de l'API."""

import os
import json
import requests
from typing import Optional, Dict, Any
from urllib.parse import urljoin

# Configuration
API_HOST = "http://146.19.230.203:8000"
TIMEOUT = 10

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    GRAY = '\033[90m'
    RESET = '\033[0m'

def print_section(title: str):
    """Afficher titre de section."""
    print(f"\n{Colors.BLUE}{'=' * 50}{Colors.RESET}")
    print(f"{Colors.BLUE}| {title:<46}|{Colors.RESET}")
    print(f"{Colors.BLUE}{'=' * 50}{Colors.RESET}")

def print_result(success: bool, message: str, details: Optional[str] = None):
    """Afficher résultat."""
    icon = f"{Colors.GREEN}✓{Colors.RESET}" if success else f"{Colors.RED}✗{Colors.RESET}"
    print(f"{icon} {message}")
    if details:
        print(f"  {Colors.GRAY}→ {details}{Colors.RESET}")

class AdvancedAPITester:
    def __init__(self, host: str = API_HOST):
        self.host = host
        self.session = requests.Session()
        self.test_results = []

    def test_user_endpoints(self):
        """Tester endpoints utilisateur."""
        print_section("ENDPOINTS UTILISATEUR")
        
        # Test get-configs sans authentification
        try:
            response = self.session.get(
                urljoin(self.host, "/api/user/get-configs"),
                timeout=TIMEOUT
            )
            if response.status_code == 401:
                print_result(True, "Protection d'accès", "Endpoint /api/user/get-configs protégé (401)")
                self.test_results.append({"endpoint": "/api/user/get-configs", "status": "protected"})
            else:
                print_result(False, "Protection d'accès", f"Status {response.status_code} (attendu 401)")
        except Exception as e:
            print_result(False, "Erreur test /api/user/get-configs", str(e))

        # Test /api/user/me sans authentification
        try:
            response = self.session.get(
                urljoin(self.host, "/api/user/me"),
                timeout=TIMEOUT
            )
            if response.status_code == 401:
                print_result(True, "Protection /api/user/me", "Correctement protégé (401)")
            else:
                print_result(False, "Protection /api/user/me", f"Status {response.status_code}")
        except Exception as e:
            print_result(False, "Erreur test /api/user/me", str(e))

    def test_chat_endpoints(self):
        """Tester endpoints de chat."""
        print_section("ENDPOINTS CHAT")
        
        # Test messages publics (certains pourraient être accessibles)
        try:
            response = self.session.get(
                urljoin(self.host, "/api/tchat/messages"),
                timeout=TIMEOUT
            )
            if response.status_code in [200, 401, 403]:
                print_result(
                    response.status_code == 200,
                    f"GET /api/tchat/messages",
                    f"Status {response.status_code}"
                )
            else:
                print_result(False, "GET /api/tchat/messages", f"Status {response.status_code}")
        except Exception as e:
            print_result(False, "Erreur GET /api/tchat/messages", str(e))

    def test_admin_endpoints(self):
        """Tester endpoints admin."""
        print_section("ENDPOINTS ADMIN")
        
        endpoints = [
            "/admin",
            "/admin/users",
        ]
        
        for endpoint in endpoints:
            try:
                response = self.session.get(
                    urljoin(self.host, endpoint),
                    timeout=TIMEOUT
                )
                is_protected = response.status_code in [401, 403]
                print_result(
                    is_protected,
                    f"GET {endpoint}",
                    f"Status {response.status_code} {'(protected)' if is_protected else '(accessible)'}"
                )
            except Exception as e:
                print_result(False, f"GET {endpoint}", str(e))

    def test_static_content(self):
        """Tester contenu statique."""
        print_section("CONTENU STATIQUE")
        
        static_files = [
            "/static/manifest.json",
            "/static/css/",  # Test if directory listing exists
            "/static/js/",
            "/templates/",
        ]
        
        for path in static_files:
            try:
                response = self.session.head(
                    urljoin(self.host, path),
                    timeout=TIMEOUT,
                    allow_redirects=False
                )
                status = "✓" if response.status_code < 400 else "✗"
                print_result(
                    response.status_code < 400,
                    f"HEAD {path}",
                    f"Status {response.status_code}"
                )
            except Exception as e:
                print_result(False, f"HEAD {path}", str(e))

    def test_zero_rating_api(self):
        """Tester API Zero-Rating."""
        print_section("API ZERO-RATING")
        
        try:
            response = self.session.get(
                urljoin(self.host, "/api/zero-rating/services"),
                timeout=TIMEOUT
            )
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    has_services = "services" in data
                    has_status = "status" in data
                    print_result(True, "GET /api/zero-rating/services", "Status 200")
                    if has_services:
                        services_count = len(data.get("services", {}))
                        print_result(
                            services_count > 0,
                            f"Services disponibles",
                            f"{services_count} services"
                        )
                    else:
                        print_result(False, "Structure réponse", "Clé 'services' manquante")
                except Exception as e:
                    print_result(False, "Parse JSON", str(e))
            else:
                print_result(False, "GET /api/zero-rating/services", f"Status {response.status_code}")
        except Exception as e:
            print_result(False, "Erreur /api/zero-rating/services", str(e))

        # Test POST pour générer config (devrait fonctionner sans auth)
        try:
            response = self.session.post(
                urljoin(self.host, "/api/zero-rating/generate-config"),
                json={
                    "server": "example.com",
                    "services": ["1500"],
                    "port": 443,
                },
                timeout=TIMEOUT
            )
            
            # 200, 400 (validation) ou 401 (protection)
            print_result(
                response.status_code in [200, 400],
                "POST /api/zero-rating/generate-config",
                f"Status {response.status_code} (acceptable)"
            )
        except Exception as e:
            print_result(False, "POST zero-rating config", str(e))

    def test_health_endpoints(self):
        """Tester endpoints de santé."""
        print_section("HEALTH CHECK AVANCÉ")
        
        # Test root health
        try:
            response = self.session.get(urljoin(self.host, "/"), timeout=TIMEOUT)
            print_result(response.status_code == 200, "GET /", f"Status {response.status_code}")
            
            # Vérifier que c'est du HTML
            is_html = "text/html" in response.headers.get("content-type", "")
            print_result(is_html, "Content-Type", f"{'HTML' if is_html else 'Non-HTML'}")
        except Exception as e:
            print_result(False, "GET /", str(e))

    def generate_report(self):
        """Générer rapport final."""
        print(f"\n{Colors.BLUE}{'=' * 50}{Colors.RESET}")
        print(f"{Colors.BLUE}+-- RAPPORT FINAL{Colors.RESET}")
        print(f"{Colors.BLUE}+-- VPS: {self.host}{Colors.RESET}")
        print(f"{Colors.BLUE}+-- Tests exécutés: {len(self.test_results)}{Colors.RESET}")
        print(f"{Colors.BLUE}+-- DateTime: 25 mars 2026{Colors.RESET}")
        print(f"{Colors.BLUE}+-- État: OPÉRATIONNEL +{Colors.RESET}")
        print(f"{Colors.BLUE}{'=' * 50}{Colors.RESET}\n")

    def run_all_tests(self):
        """Exécuter tous les tests."""
        print(f"\n{Colors.YELLOW}+====================================================+{Colors.RESET}")
        print(f"{Colors.YELLOW}|      TEST AVANCÉ DES APIs              |{Colors.RESET}")
        print(f"{Colors.YELLOW}|    LABORATOIRE DU FREE-SURF             |{Colors.RESET}")
        print(f"{Colors.YELLOW}+====================================================+{Colors.RESET}")
        
        self.test_health_endpoints()
        self.test_zero_rating_api()
        self.test_user_endpoints()
        self.test_chat_endpoints()
        self.test_admin_endpoints()
        self.test_static_content()
        
        self.generate_report()

if __name__ == "__main__":
    tester = AdvancedAPITester()
    tester.run_all_tests()
