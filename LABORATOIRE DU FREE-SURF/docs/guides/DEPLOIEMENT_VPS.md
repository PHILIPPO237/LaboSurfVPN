# Deploiement VPS

Ce depot sait maintenant deployer proprement sur un VPS Linux avec trois briques utiles :

- le profil `production` est reellement charge via `FS_ENV=production` ;
- le deploiement preserve les dossiers persistants `static/avatars` et `static/ads` ;
- l'application tourne en service `systemd` par defaut, avec fallback `nohup` si `systemd` est indisponible.

## 1. Preparer le VPS

Paquets minimum :

```bash
sudo apt update
sudo apt install -y python3 python3-venv unzip curl
```

Si tu veux un vrai HTTPS avec domaine :

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

## 2. Preparer les variables d'environnement

Le chargement fonctionne maintenant ainsi :

1. `.env`
2. `.env.production` si `FS_ENV=production`
3. `FS_ENV_FILE` si tu veux un fichier explicite
4. les vraies variables shell gardent la priorite sur les fichiers

Important : `deploy.ps1` et `deploy.py` n'envoient toujours pas `.env` vers le VPS. C'est volontaire pour ne pas ecraser tes secrets en prod.

La premiere fois, copie donc ton `.env` sur le serveur :

```powershell
scp -P 22 .env root@TON_VPS:"/opt/LABORATOIRE DU FREE-SURF/.env"
```

Puis garde dans `.env.production` uniquement les overrides de prod, par exemple :

```dotenv
FS_COOKIE_SECURE=1
FS_UVICORN_HOST=127.0.0.1
FS_UVICORN_PORT=8000
FS_UVICORN_RELOAD=0
FS_LOG_LEVEL=info
```

## 3. Deployer tout le projet depuis Windows

Commande recommandee :

```powershell
.\deploy.ps1 -RemoteHost TON_IP -RemoteUser root -RemotePort 22 -FsEnv production -AppHost 127.0.0.1 -AppPort 8000 -PublicUrl https://app.ton-domaine.com
```

Si tu veux exposer l'app directement sans reverse proxy :

```powershell
.\deploy.ps1 -RemoteHost TON_IP -RemoteUser root -FsEnv production -AppHost 0.0.0.0
```

Equivalent Python :

```powershell
$env:REMOTE_HOST='TON_IP'
$env:REMOTE_USER='root'
$env:FS_ENV='production'
$env:APP_HOST='127.0.0.1'
$env:APP_PORT='8000'
python deploy.py
```

## 4. Reverse proxy Nginx conseille

Exemple minimal :

```nginx
server {
    server_name app.ton-domaine.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Puis :

```bash
sudo ln -s /etc/nginx/sites-available/free-surf /etc/nginx/sites-enabled/free-surf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d app.ton-domaine.com
```

## 5. Verifier apres deploiement

Sur le VPS :

```bash
systemctl status laboratoire-free-surf --no-pager
journalctl -u laboratoire-free-surf -n 100 --no-pager
curl http://127.0.0.1:8000/health
bash /opt/laboratoire-du-free-surf/scripts/audit_vps_project_correlation.sh
```

## 6. Notes utiles

- Le service utilise le lien sans espace `/opt/laboratoire-du-free-surf` pour simplifier `systemd`.
- Le code source reste deploie dans `/opt/LABORATOIRE DU FREE-SURF`.
- Si tu veux forcer un fichier d'env unique, tu peux utiliser `FS_ENV_FILE` dans le service runtime ou dans ton shell.
- Les fichiers persistants du serveur ne sont plus effaces a chaque deploiement dans `static/avatars` et `static/ads`.
