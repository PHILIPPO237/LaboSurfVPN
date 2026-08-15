# LABORATOIRE DU FREE-SURF

Application web (panel) de gestion d'abonnements VPN — comptes, plans (Gratuit / VIP /
Revendeur / Admin), paiements, protocoles de connexion, et administration.

C'est le **panel central** : toute la donnée (comptes, abonnements, configurations) vit
ici. L'app compagnon **Labo Surf** (VPN mobile) ne stocke rien elle-même — elle passe
systématiquement par l'API de ce panel pour s'authentifier et récupérer ce dont un
utilisateur a besoin, au moment où il en a besoin.

## Démarrage rapide

```bash
pip install -r requirements.txt
cp .env.example .env    # puis renseigner les vraies valeurs
python main.py
```

Le serveur démarre sur `UVICORN_HOST:UVICORN_PORT` (voir `.env`, `127.0.0.1:8000` par
défaut).

## Architecture — vue d'ensemble

- **`main.py`** — point d'entrée, câble les provisioners (protocoles) et construit l'app.
- **`app/application.py`** — assemblage FastAPI, middlewares (sessions, CORS, sécurité).
- **`app/routers/`** — un fichier par domaine : `auth.py` (connexion/inscription),
  `user.py` (compte, configs), `payment.py` (paiements), `subscription.py`
  (renouvellement), `admin_tools.py` (panel admin), `revendeur.py` (panel revendeur),
  `pages.py` (pages publiques/dashboard).
- **`app/core/`** — logique transverse : `access.py` (rôles et permissions),
  `permissions.py` (évaluation des permissions + délégations), `security.py`
  (authentification, sessions, tokens Bearer), `runtime_support.py` (génération des
  configurations de connexion).
- **`templates/`** — pages HTML (Jinja2), un fichier par panel/page.

## Rôles et permissions

Quatre niveaux, du plus large au plus restreint :

| Rôle | Portée |
|---|---|
| **Super admin** (id=1, "root") | Accès total, seul à pouvoir déléguer des droits à d'autres admins |
| **Admin ordinaire** | Gestion utilisateurs/paiements/pubs... **sauf** le générateur de configurations, à moins que le super admin le lui délègue explicitement (`/admin/users/delegations`) |
| **Revendeur** | Gère uniquement ses propres clients (chaîne `reseller_id`) |
| **Client** (Gratuit / VIP) | Son propre compte uniquement |

Voir `app/core/access.py` (définition des permissions par rôle) et
`app/core/permissions.py` (évaluation à la volée, avec délégations).

## Sécurité — principe central

**Aucun lien de connexion brut (`vless://...`) n'est exposé aux utilisateurs ni aux
revendeurs**, ni sur le site, ni ailleurs — seul le super admin (et les admins
délégués via `admin.config`) peut voir une configuration brute
(`/api/user/get-configs`).

Pour un utilisateur normal, la connexion passe exclusivement par l'app Labo Surf, qui
récupère la configuration nécessaire au moment de se connecter via
`/api/user/connect` (réservé au compte connecté lui-même, jamais un autre), et ne
l'affiche ni ne la stocke jamais — transmise directement au moteur de connexion.

## Authentification API (app externe)

L'app Labo Surf (et tout futur client externe) s'authentifie via
`POST /api/auth/login` ou `POST /api/auth/register`, reçoit un token, et l'utilise en
en-tête `Authorization: Bearer <token>` sur les appels suivants — voir
`app/core/security.py::get_current_user` (repli sur le header si pas de cookie de
session, pour les clients qui ne sont pas sur le même domaine).

## Déploiement

Dépôt Git avec pipeline CI/CD déjà en place côté VPS — `git push` déclenche le
déploiement. Voir aussi `.env.example` pour la liste complète des variables
nécessaires (base de données, provisioners, paiement, etc.).

## Tests

```bash
pytest tests/
```

## À savoir / dette technique connue

- `templates/panel-revendeur.html` contient encore un nombre significatif de
  guillemets doublés (`''...''`) résiduels dans son JavaScript — bug d'origine
  ancienne, hors du périmètre déjà corrigé. À traiter dans une passe dédiée avant
  de retoucher ce fichier en profondeur.
