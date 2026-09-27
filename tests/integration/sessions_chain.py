"""Chaîne RÉELLE « sessions et appareils » : vrai code de LaboSurfVPN (index.html + js/*.js, tels que livrés dans l'APK)
exécuté dans DEUX navigateurs Chrome headless (deux appareils : profils séparés, origines 127.0.0.1 et localhost, donc deux
identifiants d'installation), face au VRAI Laboratoire du Free-Surf (main.main(), base SQLite temporaire, bcrypt réel).

OUTIL DE TEST UNIQUEMENT : jamais livré dans l'APK ; données de test seulement ; rien n'est modifié dans le dépôt du panel.
Un petit pilote (injecté dans une COPIE servie de index.html) exécute les actions réelles de l'application
(Actions.login, Actions.revokeDevice, Actions.logoutAllDevices…) ; ce script vérifie ensuite le résultat côté serveur.

    python tests/integration/sessions_chain.py --panel <worktree du panel> [--chrome <chrome.exe>]

Sortie : une ligne par contrôle, puis RESULT_JSON=… ; code de retour 0 seulement si tout passe.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from fastapi import Request   # au niveau du module : les annotations différées doivent pouvoir le résoudre

VPN_WWW = Path(__file__).resolve().parents[2] / "app" / "src" / "main" / "assets" / "www"
USERNAME = "chaine.secu"
PW1, PW2, PW3 = "Chaine-Surf-2026", "Chaine-Surf-2027", "Chaine-Surf-2028"
RECOVERY = "la dune rouge de kribi"
CONTACT = "237699000000"

DRIVER_JS = r"""
(async function(){
  const dev = location.hash.slice(1) || 'X';
  const G = (0, eval);
  for(;;){
    let cmd = null;
    try{ const r = await fetch('/__cmd?dev=' + dev, { cache: 'no-store' }); cmd = await r.json(); }
    catch(e){ await new Promise((ok) => setTimeout(ok, 300)); continue; }
    if(!cmd || !cmd.id) continue;
    const trace = (s) => fetch('/__trace?dev=' + dev + '&s=' + encodeURIComponent(s)).catch(() => {});
    trace('recu ' + cmd.id);
    let out;
    try{ const v = await G('(async () => {' + cmd.code + '\n})()'); out = { id: cmd.id, ok: true, value: v === undefined ? null : v }; }
    catch(e){ out = { id: cmd.id, ok: false, error: String((e && e.stack) || e) }; }
    trace('evalue ' + cmd.id);
    try{ await fetch('/__res', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) }); }catch(e){}
  }
})();
"""


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Bridge:
    """File de commandes par appareil (fil principal -> page) et résultats (page -> fil principal)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.cmds: dict[str, list] = {}
        self.results: dict[int, dict] = {}
        self.ready: set[str] = set()
        self.seq = 0

    def push(self, dev: str, code: str) -> int:
        with self.lock:
            self.seq += 1
            self.cmds.setdefault(dev, []).append({"id": self.seq, "code": code})
            return self.seq

    def pop(self, dev: str):
        with self.lock:
            self.ready.add(dev)
            q = self.cmds.get(dev) or []
            return q.pop(0) if q else None


def build_app(panel: Path, bridge: Bridge):
    sys.path.insert(0, str(panel))
    from fastapi.responses import HTMLResponse, JSONResponse, Response
    from fastapi.staticfiles import StaticFiles

    from main import main as build_panel

    app = build_panel()

    @app.get("/app/__driver.html")
    async def driver_page():
        html = (VPN_WWW / "index.html").read_text(encoding="utf-8")
        return HTMLResponse(html.replace("</body>", "<script src=\"/__driver.js\"></script></body>"))

    @app.get("/__driver.js")
    async def driver_js():
        return Response(DRIVER_JS, media_type="application/javascript")

    @app.get("/__cmd")
    async def next_cmd(dev: str):
        for _ in range(50):                      # attente longue (5 s) côté serveur
            cmd = bridge.pop(dev)
            if cmd:
                if os.environ.get("LSVPN_DEBUG"):
                    print(f"[driver] {dev} <- commande {cmd['id']}", flush=True)
                return JSONResponse(cmd)
            await asyncio.sleep(0.1)
        return JSONResponse({})

    @app.get("/__trace")
    async def trace(dev: str, s: str):
        if os.environ.get("LSVPN_DEBUG"):
            print(f"[trace] {dev} {s}", flush=True)
        return {"ok": True}

    @app.post("/__res")
    async def post_res(request: Request):
        body = await request.json()
        if os.environ.get("LSVPN_DEBUG"):
            print(f"[driver] résultat {body.get('id')} ok={body.get('ok')} {str(body.get('error', ''))[:300]}", flush=True)
        with bridge.lock:
            bridge.results[int(body["id"])] = body
        return {"ok": True}

    # routes du pilote EN TÊTE : une route générique du panel ne doit pas les intercepter
    added = [r for r in app.router.routes if getattr(r, "path", "") in {"/app/__driver.html", "/__driver.js", "/__cmd", "/__trace", "/__res"}]
    for r in added:
        app.router.routes.remove(r)
    app.router.routes[0:0] = added
    app.mount("/app", StaticFiles(directory=str(VPN_WWW), html=True), name="vpn-app")
    return app


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel", required=True)
    ap.add_argument("--chrome", default=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    args = ap.parse_args()

    work = Path(tempfile.mkdtemp(prefix="lsvpn-sessions-"))
    os.environ.update({"FS_DB_PATH": str(work / "panel.db"), "FS_LOGIN_RATE_MAX": "1000", "PYTHONIOENCODING": "utf-8"})
    for k in ("FS_SMTP_HOST", "FS_SMTP_FROM"):
        os.environ.pop(k, None)
    bridge = Bridge()
    app = build_app(Path(args.panel).resolve(), bridge)

    import uvicorn
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.05)

    import httpx
    http = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=20)
    checks: list[dict] = []

    def check(name: str, ok: bool, detail=None):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print(("OK   " if ok else "ECHEC") + " " + name + ("" if ok else f"  -> {detail!r}"), flush=True)

    procs = []
    origins = {"A": f"http://127.0.0.1:{port}", "B": f"http://localhost:{port}"}
    for dev, origin in origins.items():
        prof = work / f"chrome-{dev}"
        procs.append(subprocess.Popen([args.chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                                       f"--user-data-dir={prof}", f"{origin}/app/__driver.html?api={origin}#{dev}"],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

    def run(dev: str, code: str, timeout: float = 120.0):
        cid = bridge.push(dev, code)
        end = time.time() + timeout
        while time.time() < end:
            with bridge.lock:
                res = bridge.results.pop(cid, None)
            if res is not None:
                if not res.get("ok"):
                    raise RuntimeError(f"[{dev}] {res.get('error')}")
                return res.get("value")
            time.sleep(0.05)
        raise TimeoutError(f"[{dev}] pas de réponse : {code[:80]}")

    def me_status(dev: str) -> int:   # appel RÉEL de l'application (apiFetch) avec son jeton courant
        return run(dev, "const r = await apiFetch('/api/user/me'); return r.status;")

    def app_login(dev: str, password: str):
        return run(dev, f"""
          const before = authToken;
          $('accError').textContent = '';
          $('accUsername').value = {json.dumps(USERNAME)}; $('accPassword').value = {json.dumps(password)};
          await Actions.login();
          return {{ token: !!authToken && authToken !== before, error: $('accError').textContent }};""")

    def token_of(dev: str) -> str:
        return run(dev, "return authToken || '';")

    def db_sessions():
        con = sqlite3.connect(os.environ["FS_DB_PATH"])
        con.row_factory = sqlite3.Row
        rows = [dict(r) for r in con.execute(
            "SELECT s.sid, s.device_id, s.device_label, s.revoked_at, s.revoked_reason FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE u.username = ? ORDER BY s.created_at", (USERNAME,))]
        con.close()
        return rows

    def set_status(status: str):
        con = sqlite3.connect(os.environ["FS_DB_PATH"])
        con.execute("UPDATE users SET status = ? WHERE username = ?", (status, USERNAME))
        con.commit()
        con.close()

    result = 1
    try:
        t0 = time.time()
        while bridge.ready != {"A", "B"} and time.time() - t0 < 180:
            time.sleep(0.2)
        check("les deux appareils (Chrome) ont chargé la vraie application", bridge.ready == {"A", "B"}, sorted(bridge.ready))
        run("A", "return typeof Actions.login === 'function' && typeof getInstallId === 'function';")
        # chauffe (machine de test lente) : fin du pré-chargement du service worker et premier bcrypt du panel,
        # pour que le premier appel de l'application ne dépasse pas son délai réel de 15 s
        for dev in ("A", "B"):
            run(dev, "if(navigator.serviceWorker){ await navigator.serviceWorker.ready; } await new Promise((ok) => setTimeout(ok, 1500)); return true;")
        http.post("/api/auth/register", json={"username": "chauffe.x", "contact": "237600000009", "recovery_secret": "phrase de chauffe longue",
                                              "password": "Chauffe-Mdp-2026", "confirm_password": "Chauffe-Mdp-2026"})

        # CORS : l'application Android appelle le panel depuis une autre origine -> l'en-tête X-Device-Id doit être autorisé
        pre = http.request("OPTIONS", "/api/auth/login", headers={"Origin": "https://appassets.androidplatform.net",
                           "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,x-device-id,x-device-name"})
        check("CORS : X-Device-Id / X-Device-Name autorisés par le panel",
              pre.status_code == 200 and "x-device-id" in pre.headers.get("access-control-allow-headers", "").lower(), pre.status_code)

        # 1. inscription depuis l'application (appareil A)
        reg = run("A", f"""
          $('regUsername').value = {json.dumps(USERNAME)}; $('regContact').value = {json.dumps(CONTACT)};
          $('regRecovery').value = {json.dumps(RECOVERY)}; $('regPassword').value = {json.dumps(PW1)}; $('regPasswordConfirm').value = {json.dumps(PW1)};
          await Actions.register();
          return {{ token: !!authToken, error: $('regError').textContent, install: getInstallId() }};""")
        if not reg["token"]:   # diagnostic : l'erreur exacte vue par l'application
            reg["probe"] = run("A", f"""try{{ const r = await apiFetch('/api/auth/register', {{ method: 'POST', device: true,
              body: JSON.stringify({{ username: 'sonde.x', contact: '237600000001', recovery_secret: 'phrase de sonde longue', password: 'Sonde-Mdp-2026', confirm_password: 'Sonde-Mdp-2026' }}) }});
              return {{ status: r.status, data: r.data }}; }}catch(e){{ return String((e && e.stack) || e); }}""")
        check("inscription depuis l'application", reg["token"], reg)
        ids = {"A": reg["install"], "B": run("B", "return getInstallId();")}
        check("identifiant d'installation généré par l'app (aléatoire, distinct par appareil)",
              ids["A"].startswith("ins-") and ids["B"].startswith("ins-") and ids["A"] != ids["B"] and len(ids["A"]) == 36, ids)

        # 2. déconnexion : la session est révoquée CÔTÉ SERVEUR
        tok = token_of("A")
        run("A", "Actions.logout(); await new Promise((ok) => setTimeout(ok, 800)); return authToken;")
        after = http.get("/api/user/me", headers={"Authorization": "Bearer " + tok}).status_code
        check("déconnexion depuis l'app : le jeton est refusé ensuite par le serveur (401)", after == 401, after)

        # 3. connexion sur deux appareils
        la, lb = app_login("A", PW1), app_login("B", PW1)
        if not la["token"]:   # diagnostic : réponse brute du panel à la même demande
            la["probe"] = run("A", f"""try{{ const r = await apiFetch('/api/auth/login', {{ method: 'POST', device: true,
              body: JSON.stringify({{ username: {json.dumps(USERNAME)}, password: {json.dumps(PW1)} }}) }}); return {{ status: r.status, data: r.data }};
              }}catch(e){{ return String(e); }}""")
            la["raw"] = http.post("/api/auth/login", json={"username": USERNAME, "password": PW1}).text[:300]
        check("connexion appareil A et appareil B", la["token"] and lb["token"], (la, lb))
        sess = [s for s in db_sessions() if not s["revoked_at"]]
        check("serveur : Compte -> 2 installations -> 2 sessions actives",
              sorted(s["device_id"] for s in sess) == sorted(ids.values()) and all(s["device_label"] == "Labo Surf VPN" for s in sess), sess)

        # 4. « Mes appareils » dans l'app A, puis révocation de l'appareil B
        devs = run("A", "setAccView('security'); await loadDevices(); return Account.devices.map((d) => ({ current: d.current, id: d.device_id, name: d.device }));")
        check("Mes appareils (app) : 2 appareils, celui-ci marqué courant",
              len(devs) == 2 and sum(1 for d in devs if d["current"]) == 1 and next(d for d in devs if d["current"])["id"] == ids["A"], devs)
        shown = run("A", "return document.getElementById('secDevicesList').innerHTML;")
        check("l'identifiant d'installation n'est pas affiché à l'utilisateur", ids["A"] not in shown and ids["B"] not in shown)
        idx = next(i for i, d in enumerate(devs) if not d["current"])
        run("A", f"await Actions.revokeDevice({{ dataset: {{ index: '{idx}' }} }}); return true;")
        b_after, a_after = me_status("B"), me_status("A")
        check("révocation de l'appareil B : B perd l'accès (401)", b_after == 401, b_after)
        check("… l'app B revient à l'écran déconnecté", run("B", "return authToken === null;"))
        check("… l'appareil A continue de fonctionner (200)", a_after == 200, a_after)

        # 5. changement de mot de passe dans l'app A : les autres appareils tombent, A reste connecté
        app_login("B", PW1)
        pw = run("A", f"""
          $('secPwCurrent').value = {json.dumps(PW1)}; $('secPwNew').value = {json.dumps(PW2)}; $('secPwConfirm').value = {json.dumps(PW2)};
          await Actions.changePassword(); return $('secPwError').textContent;""")
        check("changement de mot de passe depuis l'app", pw == "", pw)
        check("… autre appareil déconnecté, celui-ci conservé", (me_status("B"), me_status("A")) == (401, 200))
        check("… ancien mot de passe refusé", not app_login("B", PW1)["token"])
        check("… nouveau mot de passe accepté", app_login("B", PW2)["token"])

        # 6. déconnecter tous les appareils (depuis A)
        tok_b = token_of("B")
        run("A", "const p = Actions.logoutAllDevices(); await new Promise((ok) => setTimeout(ok, 150)); closeDialog(true); await p; return authToken;")
        check("déconnecter tous les appareils : l'app A est déconnectée", run("A", "return authToken === null;"))
        b_all = http.get("/api/user/me", headers={"Authorization": "Bearer " + tok_b}).status_code
        check("… toutes les sessions invalidées côté serveur (B : 401)", b_all == 401 and not [s for s in db_sessions() if not s["revoked_at"]], b_all)

        # 7. mot de passe oublié dans l'app (phrase de récupération) : lien à usage unique, sessions révoquées
        app_login("B", PW2)
        tok_b = token_of("B")
        fp = run("A", f"""
          Actions.showForgot();
          $('fpUsername').value = {json.dumps(USERNAME)}; $('fpContact').value = {json.dumps(CONTACT)}; $('fpRecoverySecret').value = {json.dumps(RECOVERY)};
          await Actions.forgotVerify();
          const token = fpResetToken;
          $('fpNewPassword').value = {json.dumps(PW3)}; $('fpConfirmPassword').value = {json.dumps(PW3)};
          await Actions.forgotReset();
          return {{ token, error: $('fpError').textContent }};""")
        check("mot de passe oublié depuis l'app (demande -> vérification -> nouveau mot de passe)", bool(fp["token"]) and fp["error"] == "", fp["error"])
        replay = http.post("/api/auth/forgot-password/reset", json={"reset_token": fp["token"], "new_password": "Rejeu-Interdit-2029", "confirm_password": "Rejeu-Interdit-2029"})
        check("… le même lien ne sert pas deux fois (400)", replay.status_code == 400, replay.status_code)
        check("… les sessions ouvertes sont révoquées (B : 401)", http.get("/api/user/me", headers={"Authorization": "Bearer " + tok_b}).status_code == 401)
        check("… ancien mot de passe refusé, nouveau accepté", not app_login("A", PW2)["token"] and app_login("A", PW3)["token"])
        short = run("A", "Actions.showForgot(); fpResetToken = 'x'; $('fpNewPassword').value = 'Court1!'; $('fpConfirmPassword').value = 'Court1!'; await Actions.forgotReset(); const e = $('fpError').textContent; Actions.hideForgot(); return e;")
        check("… l'app applique la même longueur minimale que le panel (8)", "8" in short, short)

        # 8. compte suspendu / désactivé : sessions existantes coupées, connexion refusée, état jamais révélé sans mot de passe
        app_login("B", PW3)
        for status in ("suspended", "disabled"):
            set_status(status)
            s_a = me_status("A")
            wrong = app_login("B", "Mauvais-Mdp-000")
            right = app_login("B", PW3)
            raw_wrong = http.post("/api/auth/login", json={"username": USERNAME, "password": "Mauvais-Mdp-000"}).status_code
            raw_right = http.post("/api/auth/login", json={"username": USERNAME, "password": PW3}).status_code
            check(f"compte {status} : la session existante est refusée (401)", s_a == 401, s_a)
            check(f"compte {status} : mauvais mot de passe -> 401 (l'état n'est pas révélé)", raw_wrong == 401 and not wrong["token"], raw_wrong)
            check(f"compte {status} : bon mot de passe -> 403, connexion refusée dans l'app", raw_right == 403 and not right["token"] and right["error"], (raw_right, right))
            set_status("active")
            app_login("A", PW3)
        check("compte réactivé : connexion de nouveau possible", app_login("B", PW3)["token"])

        # 9. verrouillage après 5 échecs (dans l'app)
        msgs = [app_login("B", f"Faux-{i}-motdepasse")["error"] for i in range(5)]
        locked = http.post("/api/auth/login", json={"username": USERNAME, "password": PW3}).status_code
        check("verrouillage après 5 échecs (423 même avec le bon mot de passe)", locked == 423, (locked, msgs[-1]))

        # 10. journal de sécurité : les actions de l'app sont tracées, sans secret
        con = sqlite3.connect(os.environ["FS_DB_PATH"])
        events = {r[0] + ":" + r[1] for r in con.execute("SELECT event, outcome FROM security_audit")}
        details = "\n".join(r[0] for r in con.execute("SELECT details FROM security_audit"))
        con.close()
        wanted = {"account_created:ok", "login:ok", "login:failed", "login:locked", "logout:ok", "device_revoke:ok", "password_change:ok",
                  "logout_all:ok", "password_reset:ok", "login:refused_status"}
        check("journal : inscription, connexions, déconnexions, appareil, mot de passe, récupération, refus d'état",
              wanted <= events, sorted(wanted - events))
        leaked = [s for s in (PW1, PW2, PW3, RECOVERY) if s in details]
        check("journal : aucun mot de passe ni phrase de récupération", not leaked, leaked)

        result = 0 if all(c["ok"] for c in checks) else 1
    except Exception as exc:   # un contrôle qui ne peut pas s'exécuter est un échec, jamais un succès silencieux
        check("exécution du parcours", False, repr(exc))
        result = 1
    finally:
        for p in procs:   # Chrome lance des processus enfants : arrêter toute l'arborescence
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                p.kill()
        for p in procs:
            try:
                p.wait(timeout=10)
            except Exception:
                pass
        server.should_exit = True
        time.sleep(0.5)
        shutil.rmtree(work, ignore_errors=True)
    passed = sum(1 for c in checks if c["ok"])
    print("RESULT_JSON=" + json.dumps({"passed": passed, "total": len(checks), "failed": [c["name"] for c in checks if not c["ok"]]}, ensure_ascii=False))
    return result


if __name__ == "__main__":
    sys.exit(main())
