"""Chaîne RÉELLE pour tester LaboSurfVPN : vrai code du Laboratoire du Free-Surf (routes /api/user/*,
VPNOrchestrator, LabosurfAgentProvider, connecteur signé Ed25519) + faux labosurf-agent TLS du panel
(tests/pro/fake_agent.py, qui vérifie signatures et portées comme l'agent Go). OUTIL DE TEST UNIQUEMENT :
jamais livré dans l'APK, rien n'est modifié dans le dépôt du panel, base SQLite temporaire, clés générées.

    LaboSurfVPN -> Panel /api/user/connect/options, /api/user/connect -> profil choisi -> serveur associé
      -> LABOSURF PRO (via le connecteur du panel) -> configuration émise par PRO -> LaboSurfVPN

Données : serveur « VPS Douala » (VIP) avec les profils « Rapide » (tuic) et « Stable » (xray) déployés,
« Préparation » (dnstt) associé mais NON déployé ; serveur « VPS Yaoundé » avec « Streaming » (hysteria2) ;
serveur « Réservé » (ADMIN seulement) avec « Admin SSH » (ssh). Utilisateur VIP.

Usage (Python du panel, qui a ses dépendances) :
    python tests/integration/real_panel_chain.py --panel <dépôt du panel> capture tests/js/fixtures/panel_profile_samples.json
    python tests/integration/real_panel_chain.py --panel <dépôt du panel> serve 8790
        -> application : http://127.0.0.1:8790/app/index.html?api=http://127.0.0.1:8790  (jeton : /__token)
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

VPN_WWW = Path(__file__).resolve().parents[2] / "app" / "src" / "main" / "assets" / "www"
TOKEN = "jeton-integration-profils"
USER = {"id": 5001, "username": "integration", "type": "VIP", "status": "active",
        "expiration": (date.today() + timedelta(days=30)).isoformat()}


class Rules:
    def get_rule(self, server_id, plan):
        return None


def build(panel: Path):
    sys.path.insert(0, str(panel))
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    from app.core import db_engine
    from app.core.pro import create_pro_providers
    from app.core.pro.client import AgentClient
    from app.core.pro.config import from_values
    from app.core.pro.connector import ProConnector
    from app.core.pro.mapping import spec_for_hosted_profile
    from app.core.vpn_orchestrator import VPNOrchestrator
    from app.routers.user import create_user_router
    from tests.pro.fake_agent import ADMIN_SCOPES, RUNTIME_SCOPES, FakeAgent

    # base temporaire : schema du panel + colonnes ajoutees par ses migrations (comme tests/pro/conftest.py)
    tmp = tempfile.TemporaryDirectory(prefix="lsvpn-chain-", ignore_cleanup_errors=True)   # le panel garde sa base ouverte
    db_engine.DB_PATH = str(Path(tmp.name) / "panel.db")
    con = sqlite3.connect(db_engine.DB_PATH)
    for raw in db_engine._SCHEMA.split(";"):
        if raw.strip():
            try:
                con.execute(raw)
            except sqlite3.OperationalError as exc:
                if "already exists" not in str(exc).lower() and "no such column" not in str(exc).lower():
                    raise
    for column, ddl in (("allow_insecure", "INTEGER NOT NULL DEFAULT 0"), ("protocol", "TEXT NOT NULL DEFAULT ''"),
                        ("capabilities", "TEXT NOT NULL DEFAULT ''"),
                        ("visible_plans", "TEXT NOT NULL DEFAULT 'Gratuit,VIP,Revendeur,ADMIN'"),
                        ("public_host", "TEXT NOT NULL DEFAULT ''")):
        try:
            con.execute(f"ALTER TABLE servers ADD COLUMN {column} {ddl}")
        except sqlite3.OperationalError:
            pass
    con.commit()
    con.close()

    agent = FakeAgent().start()
    runtime, admin = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    agent.add_key("panel-runtime", runtime.public_key(), RUNTIME_SCOPES)
    agent.add_key("panel-admin", admin.public_key(), ADMIN_SCOPES)
    cfg = from_values(node_id="vps-chain", base_url=agent.base_url, key_id="panel-runtime", private_key=runtime,
                      admin_key_id="panel-admin", admin_private_key=admin, tls_fingerprint=agent.fingerprint,
                      connect_timeout=3.0, read_timeout=5.0, apply_timeout=10.0, max_retries=1, backoff=0.05)

    repos = SimpleNamespace(
        servers=db_engine.ServersRepo(), server_bindings=db_engine.ServerBindingsRepo(),
        engine_profiles=db_engine.EngineProfilesRepo(), server_profiles=db_engine.ServerProfilesRepo(),
        server_plan_rules=Rules(), trial_redemptions=None, device_trial_usage=None,
    )
    connector = ProConnector(cfg, repos.server_bindings, servers_repo=repos.servers, client=AgentClient(cfg),
                             db=repos, apply_on_connect=True)

    def server(name, city, host, plans="Gratuit,VIP,Revendeur,ADMIN"):
        s = repos.servers.add({"name": name, "country": "Cameroun", "city": city, "public_host": host})
        repos.servers.update_fields(s["id"], {"visible_plans": plans})
        return repos.servers.get_by_id(s["id"])

    def hosted(srv, name, engine, port, deploy=True):
        prof = repos.engine_profiles.create(name=name, engine=engine, params={"ports.listen": port}, catalog_version=1)
        assoc = repos.server_profiles.create(server_id=srv["id"], profile_id=prof["id"])
        if deploy:
            connector.servers.sync_server(srv, spec_for_hosted_profile(srv, prof), server_profile_id=assoc["id"])
        return assoc

    douala = server("VPS Douala", "Douala", "vpn.example.tld")
    yaounde = server("VPS Yaoundé", "Yaoundé", "203.0.113.7")
    reserve = server("Réservé", "Kribi", "203.0.113.9", plans="ADMIN")
    ids = {
        "rapide": hosted(douala, "Rapide", "tuic", 40443)["id"],
        "stable": hosted(douala, "Stable", "xray", 8443)["id"],
        "preparation": hosted(douala, "Préparation", "dnstt", 53, deploy=False)["id"],
        "streaming": hosted(yaounde, "Streaming", "hysteria2", 40444)["id"],
        "admin_ssh": hosted(reserve, "Admin SSH", "ssh", 2222)["id"],
    }

    orchestrator = VPNOrchestrator(providers=create_pro_providers(connector, ["tuic", "xray", "hysteria2", "ssh"]),
                                   servers_repo=repos.servers, default_engine="", bindings_repo=repos.server_bindings)
    calls: list[dict] = []

    def current_user(request: Request):
        return dict(USER) if request.headers.get("Authorization") == "Bearer " + TOKEN else None

    app = FastAPI()

    @app.middleware("http")
    async def record(request: Request, call_next):
        if request.url.path.startswith("/api/user/connect"):
            body = await request.body()
            calls.append({"method": request.method, "path": request.url.path,
                          "body": json.loads(body) if body else None})   # jamais la configuration : seulement la demande
        return await call_next(request)

    @app.get("/__token")
    async def token():
        return {"token": TOKEN}

    @app.get("/__calls")
    async def get_calls():
        return calls

    @app.get("/__pro")
    async def pro_state():   # ce que PRO a réellement fait (sans secret)
        return {"services": {sid: {"engine": s["engine"], "external_ref": s.get("external_ref", "")} for sid, s in agent.services.items()},
                "issued_for_services": [agent.accesses[a]["service_id"] for a in agent.issued]}

    @app.post("/__health/{state}")
    async def set_health(state: str):
        agent.health_state = state
        return {"health": state}

    @app.get("/api/user/me")
    async def me(request: Request):
        u = current_user(request)
        if u is None:
            return JSONResponse({"status": "error", "message": "Authentification requise."}, status_code=401)
        return {**u, "avatar": "", "quota_gb": None}

    app.include_router(create_user_router(
        db=repos, cfg=SimpleNamespace(), get_current_user=current_user, build_user_configs=lambda u: [],
        vpn_orchestrator=orchestrator, pro_connector=connector))
    return SimpleNamespace(app=app, agent=agent, ids=ids, servers={"douala": douala, "yaounde": yaounde, "reserve": reserve},
                           tmp=tmp, calls=calls)


def capture(chain, out: Path) -> None:
    from fastapi.testclient import TestClient

    http = TestClient(chain.app)
    auth = {"Authorization": "Bearer " + TOKEN}

    def snap(resp):
        return {"http_status": resp.status_code, "body": resp.json()}

    ids = chain.ids
    samples = {
        "options": snap(http.get("/api/user/connect/options", headers=auth)),
        "connect_rapide": snap(http.post("/api/user/connect", headers=auth, json={"hosted_profile_id": ids["rapide"], "device_id": "fixture"})),
        "connect_stable": snap(http.post("/api/user/connect", headers=auth, json={"hosted_profile_id": ids["stable"], "device_id": "fixture"})),
        "connect_without_choice": snap(http.post("/api/user/connect", headers=auth, json={"server_id": chain.servers["douala"]["id"], "device_id": "fixture"})),
        "profile_not_found": snap(http.post("/api/user/connect", headers=auth, json={"hosted_profile_id": 999999})),
        "profile_not_authorized": snap(http.post("/api/user/connect", headers=auth, json={"hosted_profile_id": ids["admin_ssh"]})),
        "profile_unavailable": snap(http.post("/api/user/connect", headers=auth, json={"hosted_profile_id": ids["preparation"]})),
        "options_unauthenticated": snap(http.get("/api/user/connect/options")),
    }
    chain.agent.health_state = "unavailable"
    samples["options_all_down"] = snap(http.get("/api/user/connect/options", headers=auth))
    samples["connect_service_down"] = snap(http.post("/api/user/connect", headers=auth, json={"hosted_profile_id": ids["rapide"]}))
    chain.agent.health_state = "available"
    samples["_ids"] = ids
    out.write_text(json.dumps(samples, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(samples) - 1} réponses réelles capturées -> {out}")


def serve(chain, port: int) -> None:
    import uvicorn
    from fastapi.staticfiles import StaticFiles

    chain.app.mount("/app", StaticFiles(directory=str(VPN_WWW), html=True), name="app")
    print(f"http://127.0.0.1:{port}/app/index.html?api=http://127.0.0.1:{port}")
    uvicorn.run(chain.app, host="127.0.0.1", port=port, log_level="warning")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel", required=True, help="dépôt (ou worktree) du Laboratoire du Free-Surf")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("out")
    s = sub.add_parser("serve")
    s.add_argument("port", type=int)
    args = ap.parse_args()
    chain = build(Path(args.panel).resolve())
    try:
        if args.cmd == "capture":
            capture(chain, Path(args.out))
        else:
            serve(chain, args.port)
    finally:
        chain.agent.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
