# Architecture MVP - LABORATOIRE DU FREE-SURF

## État actuel (constat)
- Migration MVP très avancée : `main.py` sert de bootstrap (helpers + include_router + cycle startup/shutdown).
- Les routes applicatives sont portées par des routeurs dédiés dans `app/routers/`.
- La logique métier critique continue d'être sortie des routeurs vers `services/` + `presenters`.
- Couche de données centralisée dans `database.py` (repositories SQLite).

## Cible MVP
- `Model`: schemas/domain + repositories (SQLite).
- `View`: templates Jinja + reponses JSON.
- `Presenter`: orchestration des cas d'usage, validation metier, mapping View/Model.

## Arborescence cible (progressive)
```text
.
|-- main.py                      # bootstrap FastAPI + include_router
|-- app/
|   |-- routers/
|   |   |-- pages.py
|   |   |-- auth.py
|   |   |-- revendeur.py
|   |   |-- user.py
|   |   |-- subscription.py
|   |   |-- payment.py
|   |   |-- zero_rating.py
|   |   |-- admin.py
|   |   |-- scanner.py
|   |   |-- tchat.py
|   |   |-- admin_ads.py
|   |   |-- admin_tools.py
|   |-- presenters/
|   |   |-- user_presenter.py
|   |   |-- revendeur_presenter.py
|   |   |-- admin_user_presenter.py
|   |-- services/
|   |   |-- user_service.py
|   |   |-- revendeur_service.py
|   |   |-- admin_user_service.py
|   |-- models/
|   |-- repositories/
|-- templates/
|-- static/
```

## Plan de migration recommande
1. Continuer l'extraction de logique metier restante vers services/ puis presenters/ (notamment les pages admin encore riches en logique view-model: dashboard/config/scanner).
2. Conserver les URLs existantes (compatibilite), puis nettoyer les helpers legacy de `main.py` non utilises.
3. Ajouter des tests de non-regression sur les endpoints critiques (auth, paiement, admin, scanner, user API).

## Avancement dans ce lot
- Router dedie `app/routers/pages.py` cree.
- Routes pages extraites de `main.py`: `/`, `/dashboard`, `/panel-gratuit`, `/panel-vip`, `/tchatch`, `/messages`, `/compte`, `/compte-activer`, `/scan-guide`.
- Router dedie `app/routers/zero_rating.py` cree.
- Routes zero-rating extraites de `main.py`: `/api/zero-rating/services`, `/api/zero-rating/generate-config`.
- Router `app/routers/user.py` etendu.
- Routes user API extraites de `main.py`: `/api/user/me`, `/api/user/get-configs`, `/api/user/activate`, `/api/user/{username}`.
- Router `app/routers/revendeur.py` etendu.
- Route revendeur API extraite de `main.py`: `/api/revendeur/generate-demo`.
- Services introduits: `services/user_service.py` (activation cle, resolution target config, payloads user), `services/revendeur_service.py` (renouvellement + generation demo), `services/admin_user_service.py` (contexte + cas d'usage POST `/admin/users*`: create/toggle/delete/reset/recovery/update/renew/extend/recharge/avatar), `services/admin_service.py` (dashboard admin, DNS helpers, view-model scanner, config distribution, fetch 3x-ui).
- Presenters introduits: `app/presenters/user_presenter.py`, `app/presenters/revendeur_presenter.py`, `app/presenters/admin_user_presenter.py`, `app/presenters/admin_presenter.py`.
- Extraction admin users effectuee: GET /admin/users, GET /admin/users/edit et les POST critiques (/admin/add-user, /admin/toggle-user, /admin/delete-user, /admin/reset-license, /admin/recovery/*, /admin/users/update, /admin/users/renew, /admin/extend-user, /admin/users/recharge-gb, /admin/users/avatar*) sont desormais orchestres via admin_user_service + admin_user_presenter.
- Extraction admin complementaire effectuee: GET `/admin`, GET `/admin/scanner`, GET `/admin/dns/resolve`, GET `/admin/dns/check-cloudflare`, GET `/admin/dns/check-gcp`, GET+POST `/admin/api/config-distribution`, GET `/admin/api/fetch-3xui` sont desormais orchestres via `admin_service` + `admin_presenter`.
- `main.py` ne contient plus de routes `@app.get/post/...` metier.
- Perf scanner amelioree: throttling des sauvegardes d'etat pendant les callbacks (moins d'ecritures SQLite, charge CPU/IO reduite).
