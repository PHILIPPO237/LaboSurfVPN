# LaboSurfVPN — statut des tests de bout en bout

Date : 2026-09-21. Chaque ligne est `PASS`, `FAIL` (cause exacte) ou `NOT RUN` (raison). Aucun `PASS` n'est déclaré sans exécution.
Environnements : **panel local** = vraie application FastAPI du Laboratoire (branche `phase6-account-admin`), base SQLite temporaire, vrai bcrypt,
appelée en process (`TestClient`) ; **VPS** = `162.248.100.115`, Ubuntu 24.04, agent PRO + TUIC actifs (phase 4), serveur UDP de test lancé pour l'occasion ;
**client de référence** = `tests/udp/reference_client.py` (Python, protocole de `PROTOCOL.md`), exécuté depuis un PC derrière un NAT domestique ;
**CI** = GitHub Actions (JUnit + émulateur).

## 1. Les 14 tests demandés

| # | Test | Résultat | Preuve / cause |
|---|---|---|---|
| 1 | Nouvel utilisateur Android | **PARTIAL** | inscription avec **exactement** les champs de `js/account.js` (`username, contact, recovery_secret, password, confirm_password`) : `200`, jeton, statut `configuring`. **NOT RUN depuis l'APK** : aucun panel public joignable (voir §4) |
| 2 | Compte créé réellement dans le panel | **PASS** (panel local) | ligne `users` en base, hash bcrypt, mot de passe absent en clair du fichier de base ; doublon `409`, confirmation différente `400` |
| 3 | Login | **PASS** (panel local) | nouveau jeton, même compte ; mauvais mot de passe `401` ; sans jeton `401` |
| 4 | Profil | **PASS** (panel local) | `/api/user/me` : `active` après l'activation en arrière-plan, aucun champ sensible |
| 5 | Récupération du Service | **NOT RUN** (UDP) | validé pour TUIC en phase 4 ; aucun Service UDP n'a été créé via l'agent |
| 6 | Création / récupération de l'Access | **NOT RUN** (UDP) | idem (compte de test injecté directement dans le magasin JSON du serveur UDP) |
| 7 | Configuration UDP | **PARTIAL** | format `udp://<user>@<hôte>:<port>?pass=<mdp>` lu dans `internal/clientcfg/access.go` et consommé par `UdpLink` (tests JVM) ; **non émis via l'agent** |
| 8 | Démarrage du moteur UDP | **PASS** (VPS) | `labosurf-udpnat udp server` : `5667/udp` en écoute, interface TUN `labotest0` |
| 9 | Trafic réel | **PASS** (VPS, depuis un NAT) | requête DNS résolue par 1.1.1.1 à travers le tunnel (2 enregistrements), ping ICMP 193 ms |
| 10 | Déconnexion | **PASS** (JVM) / **NOT RUN** (émulateur, §3) | arrêt des pompes et fermeture de la socket testés en JVM |
| 11 | Compte expiré | **PASS** (VPS) | `AUTH_FAIL` à la prochaine authentification |
| 12 | Access désactivé | **PASS** (VPS) | `AUTH_FAIL` |
| 13 | Access supprimé | **PASS** (VPS) | `AUTH_FAIL` |
| 14 | Deuxième connexion du même compte | **PASS** (VPS) | 2 connexions simultanées acceptées (`max_connections=2`), la 3e refusée `MAX_CONNECTIONS` |

Limite commune des tests 11 à 13 : le refus intervient **à la prochaine authentification** ; une session déjà ouverte n'est pas coupée avant sa propre règle.

## 2. Découverte critique : le NAT cassait le protocole

Le serveur rejette tout paquet tunnel dont le `ClientID` ≠ SHA-256(adresse source **observée**)[0:8] ; le client de référence le calculait depuis
son adresse **locale**. Depuis un PC derrière un NAT (adresse locale `10.34.33.54:53221`, vue par le serveur `165.210.39.242:30722`) :

| Client | Handshake | DNS via tunnel | ICMP via tunnel | Journal du serveur |
|---|---|---|---|---|
| ClientID **local** (ancien comportement) | PASS | **FAIL** | **FAIL** | `Tunnel refusé : ClientID incorrect` (×2) |
| ClientID **annoncé par le serveur** (`CLIENT_ID`) | PASS | **PASS** | **PASS** | — |

Correctif PRO (branche `phase6-udp-nat`, commit `7d4d3d8`) : après `AUTH_OK <ip>` (format inchangé) le serveur envoie `CLIENT_ID <16 hex>`. Un premier
essai qui modifiait `AUTH_OK` a été abandonné : il cassait des clients qui lisent « tout ce qui suit » comme l'adresse IP.
Tests Go : `go test ./engines/udp` → seuls échouent 2 tests préexistants (`TestUDPModuleAcceptsLicenseFromRealLicenseMaker*`, chemin d'exécutable sous Windows), identiques avant/après.

## 3. Client Android

| Test | Résultat | Détail |
|---|---|---|
| Compilation Kotlin + APK debug | **PASS** | GitHub Actions, `assembleDebug` |
| Tests unitaires JVM (26) | **PASS** | protocole (vecteurs calculés par le client de référence : HMAC, ClientID, en-tête tunnel, paquet DNS octet par octet), lien (`+`, `%`, champs manquants), client contre faux serveur : NAT simulé, CLIENT_ID, `AUTH_FAIL`/`ACCOUNT_EXPIRED`/`QUOTA`/`MAX_*`, serveur muet, serveur sans TUN, protection de socket, **vérification du chemin réussie / échouée / rejet du ClientID**, pompes (IPv4 aller-retour, IPv6 jamais envoyé, mauvais ClientID ignoré, compteurs réels, message de contrôle qui ferme le tunnel) |
| Application sur émulateur **Android 11 (API 30)** : démarrage, pont natif, `getEngineInfo` = UDP seul, interface, textes | **PASS** (12/12) | |
| Refus : protocole `tuic` non intégré ; lien UDP invalide → `invalid_config` natif ; mot de passe refusé → `auth_failed` | **PASS** | jamais « connecté » ; message affiché = texte de l'application, pas celui du serveur |
| **Connexion réelle** à un faux serveur UDP (`tests/udp/mock_server.py`, derrière le NAT de l'émulateur) | **PASS** (Android 11) | `connecting` → `connected` **seulement** après handshake + requête DNS de vérification + TUN établi ; `dumpsys` : réseau VPN actif ; `LaboVpnService` au premier plan ; **ping de l'émulateur : 3/3 reçus via le TUN et le tunnel** (le faux serveur a reçu 3 ICMP + 1 DNS) ; aucun paquet rejeté pour ClientID (NAT géré) ; déconnexion : `stopping` → `disconnected`, service arrêté |
| Même test sur émulateur **Android 14 (API 34)** | **FAIL (inexpliqué)** | le **processus de l'émulateur disparaît** (`adb: device offline` puis `not found`) ~200 ms après le démarrage du service avec un lien UDP valide, avant tout paquet (le faux serveur ne reçoit rien) ; reproduit sur `google_apis` et `default` ; aucune exception applicative, aucun message d'erreur dans le journal. Le démarrage du service avec un lien **invalide** passe sur API 34. **Cause non établie** : bogue de l'émulateur/image ou vrai problème Android 14 ? À trancher sur un téléphone Android 14 réel |
| Test sur téléphone réel | **NOT RUN** | |

## 4. Chaîne panel → PRO

| Élément | Résultat |
|---|---|
| Panel public joignable | **FAIL** — `app.laboratoire.free-surf237-4all.xyz` : NXDOMAIN le 2026-09-20, puis enregistrement créé par vous ; il résout via Cloudflare mais la poignée de main TLS échoue (le certificat gratuit ne couvre pas deux niveaux de sous-domaine). `laboratoire.free-surf237-4all.xyz` : `521` (origine éteinte). Solution simple : un nom à un seul niveau (`app.free-surf237-4all.xyz`) ou un certificat avancé |
| `POST /api/user/connect` réel | **PASS pour TUIC** (phase 4, VPS) ; **NOT RUN pour UDP** |
| Agent / Service / Access / config / apply (UDP) | **NOT RUN** |
| Agent (TUIC) | **PASS** (phase 4) |

## 5. Super-admin (panel, branche `phase6-account-admin`)

| Test | Résultat |
|---|---|
| Bootstrap : compte créé au démarrage **sans mot de passe**, connexion refusée `401` | **PASS** |
| Définition du mot de passe (module + CLI), hash bcrypt, `service_password` vide | **PASS** (fichier de base inspecté : pas de mot de passe en clair) |
| Login super-admin puis route d'administration `200` ; utilisateur normal `403` ; sans jeton `401` | **PASS** |
| Changement du mot de passe : anciennes sessions `401`, ancien mot de passe refusé, mot de passe faible refusé sans casser l'accès | **PASS** |
| Récupération : procédure `set-password` en SSH sur le serveur | **PASS** (logique testée ; **CLI non lancée sur un serveur de production**) |
| Suite complète du panel | 233 réussis, 10 échecs **identiques à la référence** (préexistants) |
| Connexion « ancien mode » par `.admin_password` | désormais limitée à l'absence de mot de passe haché (`FS_ADMIN_LEGACY_FILE_LOGIN=1` pour la réactiver) |

## 6. Autres moteurs et hybrides

| Moteur | Serveur (VPS) | PRO | Android | État |
|---|---|---|---|---|
| UDP | test direct PASS | présent | **client natif** | voir ci-dessus |
| TUIC | installé, validé (phase 4) | Service/Access/config réels | **non** | refusé côté Android |
| Xray, Hysteria, Hysteria2, WireGuard, SSH, SlowDNS, DNSTT, FreewayGate | non installés | présents | non | non validés |
| Hybrides | — | composables | non | non validés (domaines / NS non configurés) |

**Ports observés sur le VPS** : `22/tcp` (SSH), `443/udp` (TUIC), `127.0.0.1:9443/tcp` (agent), `5667/udp` (serveur UDP de test, temporaire).
PRO refuse deux Services **activés** sur le même moteur d'un nœud (`ErrEngineConflict`) ; la cohabitation de ports entre moteurs différents n'a pas été auditée
exhaustivement : ports par défaut dans `internal/srvcfg` (UDP : 5667).

## 7. Sécurité constatée
* Le protocole UDP **ne chiffre pas** le trafic (`PROTOCOL.md` §1, §5.5) : un opérateur ou un point d'accès voit le contenu des paquets IP. Ne pas le présenter comme confidentiel.
* Le serveur UDP de test tourne sans pare-feu sur le VPS (état initial de la machine) : à arrêter (`pkill -x labosurf-udpnat`) après les tests.
