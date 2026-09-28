"""Chaîne RÉELLE « compte + photo » : vrai code de LaboSurfVPN (index.html + js/*.js) dans Chrome headless, face au
VRAI panel (main.main(), base SQLite temporaire). Réutilise le pilote de tests/integration/sessions_chain.py.

Vérifie : inscription depuis l'app, envoi de la photo (vraie image PNG, multipart, jeton Bearer), fichier enregistré
côté serveur, photo relue via /api/user/me et servie par le panel, affichée dans la carte de profil ; refus d'un
envoi sans jeton, d'un format interdit et d'un faux PNG. OUTIL DE TEST : données de test seulement.

    python tests/integration/account_photo_chain.py --panel <worktree du panel>
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sessions_chain as sc  # noqa: E402

def _make_png(w: int = 16, h: int = 16) -> bytes:
    """PNG réel (dégradé 16x16) généré ici : aucune donnée personnelle."""
    import struct
    import zlib
    rows = b"".join(b"\x00" + b"".join(bytes(((x * 16) % 256, (y * 16) % 256, 128)) for x in range(w)) for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


PNG_B64 = base64.b64encode(_make_png()).decode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel", required=True)
    ap.add_argument("--chrome", default=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    args = ap.parse_args()
    work = Path(tempfile.mkdtemp(prefix="lsvpn-photo-"))
    os.environ.update({"FS_DB_PATH": str(work / "panel.db"), "FS_LOGIN_RATE_MAX": "1000"})
    bridge = sc.Bridge()
    app = sc.build_app(Path(args.panel).resolve(), bridge)
    from app.core.config import cfg   # dossier réel où le panel écrit les avatars

    import httpx
    import uvicorn
    port = sc.free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    http = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30)
    checks = []

    def check(name, ok, detail=None):
        checks.append({"name": name, "ok": bool(ok)})
        print(("OK   " if ok else "ECHEC") + " " + name + ("" if ok else f"  -> {detail!r}"), flush=True)

    origin = f"http://127.0.0.1:{port}"
    proc = subprocess.Popen([args.chrome, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={work / 'chrome'}",
                             f"{origin}/app/__driver.html?api={origin}#A"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def run(code, timeout=120.0):
        cid = bridge.push("A", code)
        end = time.time() + timeout
        while time.time() < end:
            with bridge.lock:
                res = bridge.results.pop(cid, None)
            if res is not None:
                if not res.get("ok"):
                    raise RuntimeError(res.get("error"))
                return res.get("value")
            time.sleep(0.05)
        raise TimeoutError(code[:60])

    avatars_dir = Path(str(getattr(cfg, "BASE_DIR", "."))) / "static" / "avatars"
    before = set(os.listdir(avatars_dir)) if avatars_dir.exists() else set()
    result = 1
    try:
        t0 = time.time()
        while "A" not in bridge.ready and time.time() - t0 < 180:
            time.sleep(0.2)
        run("if(navigator.serviceWorker){ await navigator.serviceWorker.ready; } return true;")
        http.post("/api/auth/register", json={"username": "chauffe.p", "contact": "237600000008", "recovery_secret": "phrase de chauffe longue",
                                              "password": "Chauffe-Mdp-2026", "confirm_password": "Chauffe-Mdp-2026"})
        # 1. inscription AVEC photo, par le vrai formulaire de l'app (Account.regPhoto = ce que produit le choix de photo)
        reg = run(f"""
          const bin = atob('{PNG_B64}'); const bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
          const blob = new Blob([bytes], {{ type: 'image/png' }});
          const prepared = await prepareAvatar(new File([blob], 'photo.png', {{ type: 'image/png' }}));   // vraie préparation (recadrage JPEG)
          Account.regPhoto = {{ blob: prepared, url: URL.createObjectURL(prepared) }};
          $('regUsername').value = 'photo.test'; $('regContact').value = '237600000007';
          $('regRecovery').value = 'la baie de limbe'; $('regPassword').value = 'Photo-Test-2026'; $('regPasswordConfirm').value = 'Photo-Test-2026';
          await Actions.register();
          return {{ token: !!authToken, error: $('regError').textContent, preparedType: prepared.type, preparedSize: prepared.size }};""")
        check("inscription depuis l'app avec photo (préparée en JPEG par l'app)", reg["token"] and reg["preparedType"] == "image/jpeg", reg)
        tok = run("return authToken;")
        me = http.get("/api/user/me", headers={"Authorization": "Bearer " + tok}).json()
        check("photo enregistrée côté panel (/api/user/me.avatar)", str(me.get("avatar", "")).startswith("/static/avatars/"), me.get("avatar"))
        new_files = set(os.listdir(avatars_dir)) - before if avatars_dir.exists() else set()
        check("fichier réellement écrit sur le serveur", len(new_files) == 1, sorted(new_files))
        img = http.get(me.get("avatar", "/x"))
        check("photo servie par le panel (HTTP 200, image)", img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"),
              (img.status_code, img.headers.get("content-type")))
        shown = run("await loadAndShowAccount('photo.test'); const i = $('accAvatarImg'); return { src: i.src, hidden: i.hidden };")
        check("photo affichée dans la carte de profil de l'app", shown["src"].endswith(me.get("avatar", "#")) and not shown["hidden"], shown)
        # 2. changement de photo depuis le profil (même route)
        up = run(f"""const bin = atob('{PNG_B64}'); const b = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i);
          const r = await uploadAvatar(await prepareAvatar(new File([new Blob([b], {{type:'image/png'}})], 'p.png', {{type:'image/png'}}))); return r;""")
        check("changement de photo depuis le profil", up.get("ok") and up.get("avatar") != me.get("avatar"), up)
        # 3. sécurité de l'envoi (appels directs au panel)
        png = base64.b64decode(PNG_B64)
        r1 = http.post("/api/user/profile/avatar-upload", files={"avatar_file": ("a.png", png, "image/png")})
        check("envoi SANS jeton refusé (401)", r1.status_code == 401, r1.status_code)
        H = {"Authorization": "Bearer " + tok}
        r2 = http.post("/api/user/profile/avatar-upload", headers=H, files={"avatar_file": ("a.html", b"<script>alert(1)</script>", "text/html")})
        check("format interdit refusé (400)", r2.status_code == 400, r2.status_code)
        r3 = http.post("/api/user/profile/avatar-upload", headers=H, files={"avatar_file": ("faux.png", b"<html><script>alert(1)</script></html>", "image/png")})
        check("faux PNG (contenu HTML) refusé", r3.status_code == 400, (r3.status_code, r3.text[:120]))
        r4 = http.post("/api/user/profile/avatar-upload", headers=H, files={"avatar_file": ("gros.png", png + b"\0" * (5 * 1024 * 1024), "image/png")})
        check("photo de plus de 5 Mo refusée (400)", r4.status_code == 400, r4.status_code)
        # 4. rôle / offre : ce que l'app affiche vient du panel
        role = run("return { plan: Account.last && Account.last.plan, role: Account.last && Account.last.role, offer: Account.last && Account.last.offer };")
        me2 = http.get("/api/user/me", headers=H).json()
        check("le panel fournit rôle ET offre séparés (/api/user/me)", "role" in me2 and "offer" in me2, sorted(me2))
        check("l'app lit le rôle et l'offre du panel (sans les mélanger)", role.get("role") == "client" and role.get("offer") == "free", role)
        result = 0 if all(c["ok"] for c in checks) else 1
    except Exception as exc:
        check("exécution du parcours", False, repr(exc))
    finally:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server.should_exit = True
        time.sleep(0.5)
        if avatars_dir.exists():   # ne laisse aucune photo de test dans le dépôt du panel
            for f in set(os.listdir(avatars_dir)) - before:
                (avatars_dir / f).unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)
    print("RESULT_JSON=" + json.dumps({"passed": sum(c["ok"] for c in checks), "total": len(checks),
                                       "failed": [c["name"] for c in checks if not c["ok"]]}, ensure_ascii=False))
    return result


if __name__ == "__main__":
    sys.exit(main())
