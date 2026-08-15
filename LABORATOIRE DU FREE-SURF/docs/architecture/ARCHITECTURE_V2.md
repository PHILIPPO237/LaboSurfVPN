# Architecture V2

## Objectif

Poser une base propre sans casser les fonctionnalites deja en place.
La strategie retenue est incrementale : garder les routers, services et templates qui marchent, puis sortir progressivement le runtime et la logique de `main.py`.

## Ce qui a ete fait

- ajout d'une app factory centralisee dans `app/application.py`
- creation d'un conteneur de dependances `AppServices`
- reduction de `main.py` a un point d'entree mince qui assemble les services et appelle `create_application()`
- suppression de l'initialisation SQLite au moment de l'import pour eviter les effets de bord et les doubles initialisations

## Pourquoi cette approche

Une reecriture totale en une seule passe serait trop risquee : trop de surface fonctionnelle, trop de regressions possibles, et aucune garantie de garder tous les parcours utilisateurs intacts.
Cette V2 permet de consolider l'existant avant de migrer le reste proprement.

## Suite recommandee

1. Extraire les helpers purs de `main.py` vers `app/core/helpers.py`
2. Extraire la securite/session/csrf/captcha vers `app/core/security.py`
3. Extraire les integrations reseau et 3x-ui vers `app/core/integrations.py`
4. Extraire l'etat scanner et les taches async vers `app/core/scanner_runtime.py`
5. Remplacer progressivement les appels directs `db.*` par des services plus fins
6. Ajouter des tests de non-regression sur auth, panels, paiements et scanner

## Mise a jour (2026-03-09)

- etape 1 realisee: extraction des helpers vers `app/core/helpers.py`
- etape 2 realisee: extraction securite/session/csrf/captcha vers `app/core/security.py`
- etape 3 realisee: extraction des integrations reseau, panel et 3x-ui vers `app/core/integrations.py`
- etape 4 realisee: extraction de l''etat scanner, des taches async et de l''export CSV vers `app/core/scanner_runtime.py`
- etape 5 realisee: extraction des routes scanner vers `app/routers/scanner.py` (pages + API + exports)
- `main.py` conserve le meme contrat via alias pour ne pas casser les routers/services existants
- etape 6 realisee: extraction des routes admin tools (pages admin principales + endpoints DNS) vers `app/routers/admin_tools.py`
- etape 7 realisee: extraction du module ads admin (page + API CRUD) vers `app/routers/admin_ads.py`
- ajout de tests routeurs: `test_admin_tools_router.py` et `test_admin_ads_router.py`
- etape 8 realisee: extraction des routes pages principales (public + dashboard/panels/profil/compte/chat/inscription) vers `app/routers/pages.py`
- ajout du test de non-regression `test_pages_router.py`
- etape 9 realisee: extraction du module auth (POST /acces, POST /inscription, GET /api/captcha/refresh, GET/POST /logout, POST /acces/licence-oubliee) vers `app/routers/auth.py`
- ajout du test de non-regression `test_auth_router.py`
- etape 10 realisee: extraction du module abonnement (POST /abonnement pour upgrade/renewal) vers `app/routers/subscription.py`
- ajout du test de non-regression `test_subscription_router.py`
- etape 11 realisee: extraction du module paiement (POST /api/payment/initiate + GET /payment-status/<order_id>) vers `app/routers/payment.py`
- etape 12 realisee: extraction du module revendeur (settings paiement, page paiements, approve/reject, generate-demo) vers `app/routers/revendeur.py`
- ajout des tests de non-regression `test_payment_router.py` et `test_revendeur_router.py`
- etape 13 realisee: passage Remnawave-first avec registre des moteurs transport externes (Hysteria2 / SlowDNS / SSH / Dropbear) via `app/core/transports`
- enrichissement du health admin avec l'etat des moteurs transport et ajout de `GET /admin/api/transport-backends`
- ajout des tests de non-regression `test_admin_router.py` et extension de `test_integrations.py`
- etape 14 realisee: extraction du module user (`GET /api/user/get-configs`, `POST /api/user/activate`, `GET /api/user/me`, `GET /api/user/{username}`) vers `app/routers/user.py`
- ajout du test de non-regression `test_user_router.py`
- etape 15 realisee: extraction du module tchat (`GET /api/tchat/messages`, `POST /api/tchat/send`, `POST /api/tchat/delete`, `POST /api/tchat/react`, `GET /api/tchat/quotas`) vers `app/routers/tchat.py`
- etape 16 realisee: fermeture du trou `POST /vip-verify` via `app/routers/user.py` avec redemption des VIP tokens en session
- ajout du test de non-regression `test_tchat_router.py` et extension de `test_user_router.py`

- etape 17 realisee: nettoyage UI Remnawave-first avec resume des moteurs transport dans `templates/admin-config-generator.html`, wording panel generique dans `templates/avant-propos.html` et entree de theme neutre via `static/css/panel-professional.css`
- revalidation complete de non-regression: `63 tests OK`
- etape 18 realisee: alignement de la config applicative sur l'infra VPS reelle avec domaines `laboratoire/panel-laboratoire/hy/t/dns-laboratoire`, support `FS_DROPBEAR_PORTS` et ajout de `FS_UDPGW_*`
- extension du registre `app/core/transports` pour exposer `UDPGW / UDP Custom` ainsi que les metadonnees `DNSTT` (`dns_server`, `ns_host`) et `Dropbear` (liste des ports)
- revalidation complete de non-regression: `63 tests OK`
19. Provisioning SSH/Dropbear: ajout du service `app/core/provisioning.py`, injection via `main.py`, et branchement sur inscription, activation/VIP et paiement revendeur avec retour `provisioning` sur les APIs JSON.
20. Provisioning Hysteria2: ajout du provisioner `hysteria2`, variables `FS_HYSTERIA_PROVISION_*`, et aggregation multi-moteurs dans les routeurs avec payload `provisioning.items`.
21. Provisioning SlowDNS/DNSTT: ajout du provisioner `slowdns`, variables `FS_SLOWDNS_PROVISION_*`, et extension du payload multi-moteurs `provisioning.items` aux comptes tunnel DNS.
22. Observabilite admin provisioning: ajout de `/admin/api/provisioning-backends`, inclusion dans `panel-health`, et affichage UI des moteurs de provisioning dans `admin-config-generator.html`.
23. Pilotage admin provisioning: ajout des endpoints `/admin/api/provisioning/dry-run`, `/admin/api/provisioning/replay`, `/admin/api/provisioning-last-results`, persistance du dernier run, et controles UI dans `admin-config-generator.html`.
24. Suspension multi-moteurs: ajout de l'action admin `/admin/api/provisioning/disable`, support `disable_user` cote pilotage admin, et desactivation automatique sur expiration/blocage politique dans `app/routers/auth.py`.
25. Cycle paiement durci: ajout du remboursement /api/revendeur/payments/refund, restauration de l'etat utilisateur depuis snapshot d'approbation, et resynchronisation/coupure des moteurs transport selon le profil retrouve.
26. Revocation abonnement admin: ajout de /admin/users/update avec resynchronisation automatique des moteurs sur changement de profil, plus action explicite /admin/users/revoke-subscription pour repasser un compte en Gratuit et couper les acces premium.

27. Cycle admin utilisateur etendu: ajout de /admin/users/renew et /admin/extend-user, resynchronisation automatique des moteurs transport sur renouvellement/prolongation, et retour visuel admin via banners de succes/erreur.

28. Cycle admin creation/suspension: ajout de /admin/add-user et /admin/toggle-user, rendu reel de la liste utilisateurs admin, et synchronisation multi-moteurs sur creation, suspension et reactivation.

