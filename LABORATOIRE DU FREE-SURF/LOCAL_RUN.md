# Test Local Sans VPS

Le projet peut déjà tourner en local via `run-local.ps1`.

## Démarrage rapide

1. Ouvre PowerShell dans le dossier du projet.
2. Lance:

```powershell
.\run-local.ps1 -Reload
```

3. Ouvre ensuite:

```text
http://127.0.0.1:8000
```

## Ce que fait le script

- copie l'app dans un miroir local Windows
- conserve une base SQLite locale séparée
- charge le `.env` du projet automatiquement
- lance Uvicorn sur `127.0.0.1:8000`

## Si le VPS est indisponible

Le site peut démarrer en local même si le panel distant ne répond pas.
En revanche, les fonctions qui dépendent du serveur distant peuvent échouer:

- synchro panel 3x-ui
- génération de configs qui interrogent le panel
- provisioning SSH / UDP / SlowDNS sur la machine distante

Pour tester l'interface, l'auth, les pages, l'admin local et la base SQLite, le mode local suffit.

## Commandes utiles

Vérifier que l'app répond:

```powershell
python -c "from fastapi.testclient import TestClient; import main; c=TestClient(main.app); print(c.get('/health').text)"
```

Synchroniser sans lancer le serveur:

```powershell
.\run-local.ps1 -SyncOnly
```

Changer le port:

```powershell
.\run-local.ps1 -Port 8080 -Reload
```
