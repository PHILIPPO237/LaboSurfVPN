"""Faux panel POUR LES TESTS DE L'INTERFACE UNIQUEMENT (jamais livré dans l'APK, jamais utilisé en production).

Reproduit les formes de réponse RÉELLES du Laboratoire du Free-Surf (app/routers/user.py, app/core/pro/connect.py) pour
piloter l'interface dans un navigateur. Le comportement de POST /api/user/connect dépend du server_id demandé :

    1 -> succès (configuration TUIC de test, identifiants fictifs)
    2 -> 503 service_unhealthy (retry_after_s 30)
    3 -> 403 subscription_expired
    4 -> 200 mais configs vide (réponse hors contrat)
    5 -> 503 configuration_unavailable (retry_after_s 15)
    6 -> succès avec expiration réelle de l'Access dans 90 s (access.expires_at)

Usage : python tests/mock_panel.py [port]     (défaut 8000, 127.0.0.1 uniquement)
"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "jeton-de-test-panel"
URI = "tuic://11111111-2222-4333-8444-555555555555:mot-de-passe-de-test@203.0.113.10:443?congestion_control=bbr&alpn=h3&sni=203.0.113.10&allow_insecure=1&udp_relay_mode=native#LABOSURF"
SERVERS = [
    {"id": i, "name": n, "country": "Cameroun", "city": c, "status": "available"}
    for i, n, c in [(1, "Douala", "Douala"), (2, "Yaoundé (sain ?)", "Yaoundé"), (3, "Abonnement expiré", "Bafoussam"),
                    (4, "Réponse invalide", "Garoua"), (5, "Préparation", "Bertoua"), (6, "Accès à échéance", "Kribi")]
]
CALLS = []


def now_iso(plus_s=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=plus_s)).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect_response(server_id):
    err = lambda status, code, msg, retry=None: (status, {"status": "error", "code": code, "message": msg, **({"retry_after_s": retry} if retry else {})})
    if server_id == 2:
        return err(503, "service_unhealthy", "Ce serveur est momentanement indisponible.", 30)
    if server_id == 3:
        return err(403, "subscription_expired", "Ton abonnement a expire.")
    if server_id == 4:
        return 200, {"status": "success", "server_id": 4, "service_health": "available", "access": {"state": "active", "expires_at": ""}, "configs": []}
    if server_id == 5:
        return err(503, "configuration_unavailable", "Ta connexion est en cours de preparation.", 15)
    exp = now_iso(90) if server_id == 6 else "2100-01-01T00:00:00Z"
    return 200, {"status": "success", "server_id": server_id, "service_health": "available", "access": {"state": "active", "expires_at": exp},
                 "configs": [{"protocol": "tuic", "remark": "VIP - tuic", "uri": URI, "format": "uri"}]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")   # comme le panel réel : rien d'autre n'est permis
        self.end_headers()

    def _authed(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/__calls":
            return self._send(200, CALLS)
        if path == "/api/ads/active":
            return self._send(200, {"ads": []})
        if not self._authed():
            return self._send(401, {"status": "error", "message": "Authentification requise."})
        if path == "/api/user/me":
            return self._send(200, {"id": 1, "username": "alice", "type": "VIP", "status": "active", "avatar": "", "expiration": "2100-01-01", "quota_gb": None})
        if path == "/api/user/subscription":
            return self._send(200, {"status": "ok", "plan": "VIP", "subscription_status": "active", "source": "legacy", "started_at": "", "expires_at": "2100-01-01"})
        if path == "/api/user/servers":
            return self._send(200, {"status": "ok", "servers": SERVERS})
        if path == "/api/user/services":
            return self._send(200, {"status": "ok", "services": [{"id": 1, "type": "VPN", "status": "active", "server_id": None, "created_at": "2026-09-01"}]})
        if path in ("/api/user/messages",):
            return self._send(200, {"messages": []})
        if path == "/api/user/notifications":
            return self._send(200, {"status": "ok", "notifications": []})
        return self._send(404, {"status": "error", "message": "inconnu"})

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._body()
        if path == "/api/auth/login":
            if body.get("password") == "ok":
                return self._send(200, {"status": "ok", "token": TOKEN, "expires_in": 86400})
            return self._send(401, {"status": "error", "message": "Identifiants invalides."})
        if not self._authed():
            return self._send(401, {"status": "error", "message": "Authentification requise."})
        if path == "/api/user/connect":
            CALLS.append({"t": time.time(), "body": body})   # jamais la configuration : seulement ce que l'interface a demandé
            status, payload = connect_response(int(body.get("server_id") or 1))
            return self._send(status, payload)
        return self._send(404, {"status": "error", "message": "inconnu"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
