# LaboSurfVPN — ce qui fonctionne RÉELLEMENT

Date : 2026-09-21 · Branche `phase7-udp-real` · Rédigé après lecture du code des trois projets et exécution des tests cités.
**Règle** : un état n'est `REAL` que s'il a été **exécuté et observé** (test, VPS, émulateur), pas parce que du code existe.

| État | Sens |
|---|---|
| `REAL` | exécuté et vérifié de bout en bout, preuve citée |
| `PARTIAL` | une partie est vérifiée, le reste ne l'est pas (précisé) |
| `PLACEHOLDER` | l'écran ou la fonction existe mais ne fait rien de réel |
| `SIMULATED` | produit des données fabriquées (aucune dans l'APK de production, voir §4) |
| `NOT_IMPLEMENTED` | n'existe pas |
| `BLOCKED` | dépend d'une décision ou d'une ressource externe manquante |
| `NOT_AVAILABLE` | la donnée n'est pas mesurable : l'application affiche « indisponible » |

## 1. Chaîne de connexion

| Fonction | Interface | Panel (Laboratoire) | PRO (agent, Service, Access) | Android | État réel |
|---|---|---|---|---|---|
| Inscription | écran Compte | `POST /api/auth/register` | — | — | **REAL** (parcours exécuté sur la vraie appli panel, base temporaire : jeton, `/api/user/me`, doublon 409, mots de passe différents 400). Créé **dans le panel** ; Android ne garde aucune base d'utilisateurs. **Non exécuté depuis l'APK** ni sur un panel public (BLOCKED, §5) |
| Statut `configuring` | affiché tel quel | créé « configuring » puis activé en arrière-plan | — | — | **REAL** (`/api/user/me` renvoie `active` après l'activation) |
| Connexion (login) | écran Compte | `POST /api/auth/login` | — | — | **REAL** (même parcours : jeton, même compte, mauvais mot de passe 401) |
| Session | mémoire seulement | jeton Bearer, `expires_in` | — | jeton perdu à la fermeture de l'app | **REAL**, mais **pas de persistance** (décision de sécurité ouverte : Keystore) |
| Profil | écran Compte | `GET /api/user/me` | — | — | **REAL** (sans champ sensible, testé) |
| Déconnexion du compte | bouton | pas de révocation du jeton côté serveur | — | efface le jeton local et coupe le tunnel | **PARTIAL** (le jeton reste valide jusqu'à `expires_in`) |
| Abonnement / jours restants | écran Compte | `GET /api/user/subscription` | — | — | **PARTIAL** (route testée par les tests du panel ; non exécutée depuis l'app) |
| Renouvellement, code d'activation | Compte > Accès | `POST /api/user/activate`, `/subscription/request` | — | — | **PARTIAL** (routes existantes, non exécutées de bout en bout) |
| Paiement | lien « Continuer sur le Laboratoire » | site du panel | — | ouvre le navigateur | **BLOCKED** (adresse publique du panel injoignable, §5) |
| Messages, annonces | Compte > Messages | `/api/user/messages`, `/notifications` | — | — | **PARTIAL** (routes existantes, non exécutées de bout en bout) |
| Bannière / promotion | Accueil | `GET /api/ads/active` | — | — | **PARTIAL** (le repli statique de l'app est réel ; la bannière du panel n'est pas exécutée de bout en bout) |
| Espace revendeur | Compte | `/api/revendeur/*` | — | — | **PARTIAL** ; fonction commerciale/admin dans l'app : à déplacer au panel (audit phase 5) |
| Liste des serveurs | Serveurs | `GET /api/user/servers` (serveurs **commerciaux**) | liaison serveur ↔ Service dans le panel | — | **PARTIAL** (le panel ne fournit ni santé ni ping par serveur : rien n'est affiché) |
| Services | Services | `GET /api/user/services` = enregistrements commerciaux, **pas** les Services PRO | — | — | **PARTIAL** (ne prouve pas qu'un Service PRO existe) |
| Configuration de connexion | (transmise au moteur, jamais affichée) | `POST /api/user/connect` | émission par l'agent (`/access/{id}/config`), création paresseuse de l'Access | reçue et transmise telle quelle | **REAL pour TUIC** (phase 4 : panel → agent → PRO sur le VPS, config réelle) ; **NON exécuté pour UDP** (Service UDP / Access UDP jamais créés via l'agent : §3) |
| Device ID / anti-abus | interne | `device_id` dans `connect`, `_check_trial_abuse` | — | `ANDROID_ID` | **PARTIAL** (transmis ; règle du panel non exécutée de bout en bout) |
| Historique | Compte > Historique | — | — | local (`localStorage`, 50 entrées) | **REAL** (local uniquement, jamais serveur) |
| Guide, Assistant | feuilles | — | — | statique / FAQ locale par mots-clés | **REAL** ; l'assistant **n'est pas une IA** et le dit |
| Réglages, langue, thème | Réglages | — | — | local | **REAL** |
| Tokens LABO-TEST / LABO-USER, pays, opérateur | — | — | — | — | **NOT_IMPLEMENTED** (emplacements prévus : Compte > Accès, Services) |

## 2. Connexion VPN et moteurs (Android)

| Fonction | Interface | Backend | PRO | Android | État réel |
|---|---|---|---|---|---|
| **Moteur UDP** | START | reçoit `udp://<user>@<hôte>:<port>?pass=…` | serveur UDP LABOSURF (`engines/udp`) | **client Kotlin natif** (`udp/`), aucune bibliothèque tierce | **REAL côté protocole et serveur** : client de référence exécuté contre un vrai serveur du VPS depuis un réseau NAT (handshake, ClientID annoncé, requête DNS résolue par 1.1.1.1 à travers le tunnel, ping ICMP 193 ms). Client Kotlin : 26 tests JVM. Chaîne Android (VpnService, TUN) : émulateur en CI contre un **faux** serveur (voir `LABOSURFVPN_E2E_STATUS.md`). **Jamais testé sur un vrai téléphone** |
| Chiffrement du trafic UDP | — | — | le protocole ne chiffre pas | — | **NOT_IMPLEMENTED — limite du protocole** : les paquets IP circulent en clair dans le tunnel (`PROTOCOL.md` §1, §5.5). À ne pas présenter comme confidentialité |
| Autres moteurs (Xray, Hysteria, Hysteria2, TUIC, WireGuard, SSH, SlowDNS, DNSTT, FreewayGate) | refusés : « protocole non pris en charge » | — | présents dans PRO (TUIC seul validé sur le VPS) | **NOT_IMPLEMENTED** (aucun client Android) | jamais affichés « disponibles » |
| Hybrides (DNSTT+SSH, SlowDNS+SSH, DNSTT+Xray, SlowDNS+Xray…) | — | — | composés dans PRO | **NOT_IMPLEMENTED** | non validés côté serveur non plus |
| État `connecting` | « CONNEXION… » | — | — | émis dès le début | **REAL** |
| État `connected` | « CONNECTÉ » + chronomètre | — | — | émis **seulement** après : handshake + vraie requête DNS aller-retour dans le tunnel + interface TUN établie | **REAL** (test JVM : « rien ne revient » ⇒ `tunnel_unverified`, jamais connecté) |
| Déconnexion | STOP | — | — | ferme socket, TUN, service | **REAL** (tests JVM ; émulateur en CI) |
| Expiration / désactivation / suppression d'un Access | message d'erreur | Access refusé au `connect` | serveur UDP : refus **à la prochaine authentification** ; une session déjà ouverte n'est pas coupée avant sa propre règle | code natif `account_expired`, `auth_failed`… | **REAL sur le VPS** (tests 11, 12, 13) ; fenêtre d'exposition = durée de la session ouverte |
| Deuxième connexion du même compte | erreur claire | — | `max_connections` | `max_connections` | **REAL sur le VPS** (2 connexions acceptées, la 3e refusée `MAX_CONNECTIONS`) |
| Trafic (octets reçus / envoyés) | tuiles Accueil | — | — | compteurs du client (octets réellement passés dans le tunnel) | **REAL** dès qu'un tunnel UDP est établi ; sinon « indisponible » |
| Vitesse | — | — | — | — | **NOT_AVAILABLE** (non affichée) |
| Consommation / quota | quota déclaré seulement | quota commercial | UDP : quota côté serveur ; TUIC : **non mesuré** | — | **NOT_AVAILABLE** pour la consommation |
| Santé du serveur | — | `service_health` (`available`/`unknown`) au `connect` | agent | affichée telle quelle | **REAL pour TUIC** (phase 4) ; `unknown` reste « inconnu » |
| Ping | — | — | — | — | **NOT_AVAILABLE** (jamais affiché) |

## 3. Ce qui n'a PAS été exécuté (à ne pas déduire)

* **Service UDP + Access UDP créés par l'agent PRO sur le VPS** : le serveur UDP de test a été lancé **directement** (`labosurf-udpnat udp server`, compte de test dans un magasin JSON temporaire). La génération `udp://…` par PRO est lue dans `internal/clientcfg/access.go` mais **pas exécutée via l'agent**.
* `POST /api/user/connect` avec un serveur UDP (le panel a été validé avec TUIC en phase 4).
* Inscription depuis l'**APK** contre un **panel public**.
* Test sur téléphone réel.

## 4. Simulations dans l'APK

* Aucune donnée fabriquée n'est produite par l'application de production : pas de faux serveur, ping, débit, durée ni état connecté (audit phase 5).
* `?preview=1` (navigateur seulement, bandeau permanent « Aperçu — connexion non réelle ») : impossible dans l'APK.
* Les **tests** (émulateur, faux serveur `tests/udp/mock_server.py`, faux panel `tests/mock_panel.py`) sont exclus de l'APK.

## 5. Blocages

| Blocage | Détail |
|---|---|
| Panel public | `app.laboratoire.free-surf237-4all.xyz` n'existait pas dans le DNS le 2026-09-20 ; l'enregistrement a été créé ensuite et résout via Cloudflare, mais la poignée de main TLS échoue (certificat Cloudflare gratuit = un seul niveau de sous-domaine : `app.laboratoire.<domaine>` en a deux). `laboratoire.free-surf237-4all.xyz` répond 521 (origine éteinte). **Aucun panel joignable depuis un téléphone.** |
| Absence de chiffrement | protocole UDP LABOSURF (voir §2) |
| NAT | corrigé : le serveur annonce désormais le ClientID (`CLIENT_ID`), sinon **tout le trafic derrière un NAT était rejeté** (prouvé : `Tunnel refusé : ClientID incorrect`). Nécessite le binaire PRO de la branche `phase6-udp-nat` |
