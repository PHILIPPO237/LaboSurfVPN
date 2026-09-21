# LaboSurfVPN

Client Android du système **LABOSURF**. Application (WebView + Kotlin) qui permet à un utilisateur de créer un compte, se connecter,
choisir un serveur et établir un tunnel VPN.

> **Statut réel (2026-09-21) — à lire avant tout.** Un seul moteur est intégré : **UDP** (protocole LABOSURF PRO). Le trafic de ce
> protocole **n'est pas chiffré**. La chaîne serveur (client de référence → vrai serveur UDP du VPS → Internet, derrière un NAT)
> est prouvée ; le client Android est testé en JVM et sur émulateur contre un **faux** serveur ; il n'a **jamais été testé sur un
> téléphone réel**, et aucun panel public n'est joignable aujourd'hui. Détail exact, fonction par fonction :
> [`docs/LABOSURFVPN_REAL_FUNCTIONALITY.md`](docs/LABOSURFVPN_REAL_FUNCTIONALITY.md) · résultats des tests :
> [`docs/LABOSURFVPN_E2E_STATUS.md`](docs/LABOSURFVPN_E2E_STATUS.md).

## 1. Architecture réelle

```
LaboSurfVPN (Android)
   │  HTTPS + jeton Bearer
   ▼
Laboratoire du Free-Surf  (panel : comptes, abonnements, règles commerciales)
   │  HTTPS + signatures Ed25519 (empreinte TLS épinglée), via tunnel SSH aujourd'hui
   ▼
labosurf-agent            (API de management de PRO, portées, anti-rejeu)
   ▼
LABOSURF_PRO              (moteurs, Services, Access)
   ▼
Service  ─►  Access  ─►  moteur VPN (UDP, TUIC, …)  ─►  Internet
```

LaboSurfVPN ne parle **qu'au panel**. Il ne contacte jamais l'agent, PRO ni un moteur autrement que par le tunnel lui-même.

| Couche | Rôle |
|---|---|
| **LaboSurfVPN** | interface, session, choix du serveur, demande de configuration, moteur client (UDP), états et erreurs |
| **Laboratoire du Free-Surf** | source de vérité des **utilisateurs**, comptes, abonnements, offres, paiements, renouvellements, règles commerciales, promotions, appareils / anti-abus ; décide *qui a droit à quoi* ; relie un serveur commercial à un Service PRO |
| **labosurf-agent** | porte d'entrée signée de PRO : Services / Access, application, santé, émission de configuration |
| **LABOSURF_PRO** | tout le technique : moteurs, Services, Access, ports, domaines, TLS, expiration **technique**, application des Access dans les moteurs, santé, consommation *lorsqu'un moteur la mesure* |

## 2. Ce que fait LaboSurfVPN

Inscription · connexion · session (mémoire seulement) · profil · abonnement (lecture) · services et serveurs **fournis par le panel** ·
demande de configuration (`POST /api/user/connect`) · connexion / déconnexion · états `off → connecting → on → disconnecting → error`
issus **uniquement** du moteur natif · trafic **réellement mesuré** (octets passés dans le tunnel) · historique **local** · guide ·
assistant (FAQ locale, **pas une IA**) · réglages · messages / annonces / bannière du panel · renouvellement et code d'activation (formulaires
vers le panel) · Device ID (`ANDROID_ID`) transmis au panel.

## 3. Ce que LaboSurfVPN ne fait pas

Ce n'est **pas** un panneau d'administration, ni un gestionnaire de moteurs PRO, de VPS ou de licences PRO, ni un remplacement du
Laboratoire. Le paiement et la gestion avancée restent au panel (bouton « Continuer sur le Laboratoire du Free-Surf »). Rien n'est
inventé : pas de faux serveur, ping, débit, durée ni état connecté ; une donnée non mesurée s'affiche « indisponible ».

## 4. Protocoles et moteurs

| Moteur | Serveur (PRO) | Android | État |
|---|---|---|---|
| **UDP** (LABOSURF) | présent ; testé sur le VPS (test direct) | **client Kotlin natif** | **seul moteur intégré** ; non chiffré ; jamais testé sur téléphone |
| TUIC | installé et validé sur le VPS (phase 4) | non | refusé côté Android (`protocole non pris en charge`) |
| Xray, Hysteria, Hysteria2, WireGuard, SSH, SlowDNS, DNSTT, FreewayGate | présents dans PRO, non validés sur le VPS | non | idem |
| Hybrides (DNSTT+SSH, SlowDNS+SSH, DNSTT+Xray, SlowDNS+Xray…) | composables dans PRO | non | non intégrés, non validés |

Un moteur n'est **jamais** affiché « disponible » parce que PRO le connaît : il faut un client Android qui sait le transporter
(`getEngineInfo()`), une configuration émise par le backend, puis un tunnel vérifié.

### UDP — comment ça marche vraiment
Lien émis par PRO : `udp://<utilisateur>@<hôte>:<port>?pass=<mot de passe>`. Poignée de main : `HELLO` → `CHALLENGE <nonce>` →
`AUTH <HMAC-SHA256(mot de passe, nonce)>` → `AUTH_OK <ip tunnel>` puis `CLIENT_ID <hex>` ; ensuite des paquets IPv4 bruts précédés d'un
en-tête de 12 octets. Le `ClientID` attendu par le serveur dépend de l'adresse source **qu'il observe** : derrière un NAT (4G/5G, box)
un client ne peut pas le calculer, d'où l'annonce `CLIENT_ID` (correctif PRO, branche `phase6-udp-nat`). « Connecté » n'est émis
qu'après une **vraie requête DNS aller-retour à travers le tunnel**. L'IPv6 est capté puis abandonné (aucune fuite, aucune connectivité
IPv6). Spécification serveur : `LABOSURF_PRO/PROTOCOL.md`.

## 5. Compte utilisateur et super-admin

* **Utilisateur** : `POST /api/auth/register` (`username`, `contact`, `recovery_secret`, `password`, `confirm_password`) → jeton +
  compte créé dans le **panel** (statut `configuring` puis `active`) → `GET /api/user/me`. Android ne conserve aucun compte.
* **Super-admin** : compte `super_admin` du panel, créé au démarrage **sans mot de passe** ; le mot de passe se définit sur le serveur
  avec `python -m app.tools.admin_account set-password` (saisie masquée, bcrypt, jamais en clair ni dans Git). Procédure complète :
  [`docs/SUPER_ADMIN_BOOTSTRAP.md`](docs/SUPER_ADMIN_BOOTSTRAP.md) (code dans le dépôt du panel, branche `phase6-account-admin`).

## 6. Configuration et installation

* **Adresse de l'API** : fixée à la compilation, HTTPS obligatoire — `gradle assembleDebug -PlabosurfPanelBaseUrl=https://mon-panel.example`.
  Valeur par défaut `https://app.laboratoire.free-surf237-4all.xyz`, **actuellement injoignable** (voir docs). Émulateur + panel local :
  `-PlabosurfPanelBaseUrl=http://10.0.2.2:8000` (clair toléré **uniquement** sur la boucle locale, en debug).
* **Navigateur (développement)** : `python -m http.server 5173 --directory app/src/main/assets/www` puis `index.html?api=http://127.0.0.1:8000`.
  Aucune connexion VPN n'existe dans un navigateur (l'app le dit). `?preview=1` ne sert qu'à mettre au point les écrans (bandeau permanent).
* **Compilation** : ce dépôt se compile sur GitHub Actions (`.github/workflows/build-apk.yml`) ou Android Studio ; l'APK **debug** est
  téléchargeable depuis les Releases / artefacts. Aucune signature de production n'est configurée.
* **Serveur UDP de test** : voir `docs/LABOSURFVPN_E2E_STATUS.md` (binaire de la branche `phase6-udp-nat` de PRO, port 5667/UDP, TUN).

## 7. Limitations connues

Trafic UDP non chiffré · aucun panel public joignable · jeton perdu à la fermeture (pas de Keystore) · révocation d'un Access effective à
la prochaine authentification (une session ouverte n'est pas coupée) · quota et consommation non mesurés pour TUIC · aucun autre moteur
intégré · pas de test sur téléphone réel · espace revendeur à déplacer vers le panel.

## 8. Tests

| Commande | Ce que ça vérifie |
|---|---|
| `node --test tests/js/*.test.js` | contrat `connect`, flux de connexion, traductions, thème (53 tests) |
| `gradle testDebugUnitTest` | moteur UDP : protocole (vecteurs du client de référence), lien, client contre faux serveur (26 tests) |
| `python tests/udp/reference_client.py --host H --port P --password-file F` | **vrai** serveur UDP : handshake, DNS et ICMP à travers le tunnel |
| `bash tests/android/emulator_test.sh app-debug.apk` | APK sur émulateur : lancement, refus propres, connexion contre `tests/udp/mock_server.py` (faux serveur, ne transporte rien) |

## 9. Structure

`app/src/main/assets/www` (interface : `index.html`, `css/`, `js/`, `js/lang/`) · `app/src/main/java/.../MainActivity.kt` (WebView, pont
natif) · `.../LaboVpnService.kt` (VpnService) · `.../udp/` (protocole, lien, client) · `docs/` · `tests/`.
