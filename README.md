# 📱 LaboSurfVPN — Application Android

> Application cliente VPN pour Android (WebView + Kotlin). Version **v1.6 ORBIT**. Ne contacte **jamais** LABOSURF_PRO ni l'Agent directement : elle consomme exclusivement l'API du Panel (`https://laboratoire.free-surf237-4all.xyz`).

---

## 📑 Sommaire

1. [Présentation](#présentation)
2. [Architecture technique](#architecture-technique)
3. [Thème Sombre Émeraude & pages secondaires autonomes](#thème-sombre-émeraude--pages-secondaires-autonomes)
4. [API distante](#api-distante)
5. [In-App Update & compilation APK](#in-app-update--compilation-apk)
6. [Fonctionnalités principales](#fonctionnalités-principales)
7. [Structure du dépôt](#structure-du-dépôt)
8. [Tests & CI](#tests--ci)

---

## 1. Présentation

LaboSurfVPN est l'application mobile du écosystème LaboSurf. Elle permet à l'utilisateur de :
- Se connecter / s'inscrire et gérer son compte.
- Choisir un serveur et un moteur de tunnel (UDP, Hysteria2, XRAY, DNSTT, SSH, WireGuard, TUIC, hybrides).
- Accéder à la Communauté (Live Chat) et à la Messagerie Privée 1-à-1.
- Consommer LABOSURF TV.
- Recevoir des mises à jour via In-App Update.
- Changer de thème (Sombre Émeraude, Glassmorphism) et de langue (FR/EN).

**Règle d'or** : LaboSurfVPN ne contacte jamais PRO ni l'Agent. Toute passe par l'API Panel.

---

## 2. Architecture technique

```
┌─────────────────────────────────────────────────────────────┐
│  LaboSurfVPN v1.6 ORBIT  (Android, Kotlin + WebView)       │
│  ├── MainActivity.kt             # Point d'entrée           │
│  ├── LaboVpnService.kt           # Service VPN (TUN)        │
│  ├── CoreTunnel.kt               # Cœur de tunnel           │
│  ├── ExchangeLink.kt             # Liaison d'échange        │
│  ├── NetworkRecovery.kt          # Récupération réseau      │
│  ├── SessionVault.kt             # Coffre de session        │
│  ├── UpdateInstaller.kt          # Installation de mise à jour│
│  ├── udp/                        # UdpLink, UdpProtocol, UdpTunnelClient│
│  ├── tv/                         # TvApi, TvDownloads, TvPlayerActivity│
│  └── res/                        # Layouts, drawables, values │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTPS (REST + WebSocket)
┌─────────────────────────────────────────────────────────────┐
│  Panel API : https://laboratoire.free-surf237-4all.xyz      │
│  (Laboratoire du Free-Surf, FastAPI)                        │
└─────────────────────────────────────────────────────────────┘
```

### Couche WebView (ressources web embarquées)

Sous `app/src/main/assets/www/` :
- `index.html` — page d'accueil principale.
- `login.html`, `register.html`, `panels.html`, `profile.html`, `settings.html`, `servers.html`, `community.html`, `about.html`, `guide.html`, `upgrade.html`, `invoices.html`, `update.css`…
- `css/` : `emerald-mobile.css`, `glass.css`, `home.css`, `screens.css`, `secondary.css`, `components.css`, `ap-global.css`, `base.css`, `livechat.css`, `premium.css`, `profile.css`, `splash.css`, `tokens.css`, `tv.css`, `update.css`, `orbite-pages.css`, `galaxy.css`, `logo3d.css`.
- `js/` : `app.js`, `api.js`, `core.js`, `vpn.js`, `servers.js`, `services.js`, `livechat.js`, `community.js`, `account.js`, `profile-theme.js`, `settings.js`, `update.js`, `theme.js`, `i18n.js`, `lang/fr.js`, `lang/en.js`, `emerald-ux.js`, `galaxy.js`, `sky.js`, `banner.js`, `brand.js`, `logo-globe.js`, `globe-tex-data.js`, `contract.js`, `activity.js`, `splash.js`, `onboarding.js`, `reseller.js`, `legal.js`, `emoji.js`, `assistant.js`, `apropos.js`, `remember.test.js`…
- `img/` : logos, opérateurs (camtel, mtn, orange), bannières.
- `manifest.json`, `sw.js` (service worker).

### Couche native (Kotlin)

- Tunnel VPN : `LaboVpnService.kt`, `CoreTunnel.kt`, `UdpTunnelClient.kt`, `UdpProtocol.kt`, `UdpLink.kt`.
- Mise à jour : `UpdateInstaller.kt` (vérifie `/api/app/latest-version`, télécharge et installe l'APK).
- TV : `TvApi.kt`, `TvDownloads.kt`, `TvPlayerActivity.kt`.

### Bibliothèque Go (`core/`)

`labocore.go`, `probe.go`, `socks.go`, `sshtun.go`, `tuic.go`, `tunstop.go`, `xray_imports.go`, `build.go` + tests (`*_test.go`).

---

## 3. Thème Sombre Émeraude & pages secondaires autonomes

### Thème visuel

- **Sombre Émeraude** : fond sombre, accents émeraude (`#10B981`, `#059669`).
- **Glassmorphism** : cartes translucides, flou d'arrière-plan, bordures fines.
- CSS dédiés : `emerald-mobile.css`, `glass.css`, `theme.js`, `i18n.js` (FR/EN).

### Pages secondaires autonomes

Chaque page HTML sous `assets/www/` est autonome et peut être ouverte directement depuis le WebView :

| Page | Fichier | Rôle |
|------|---------|------|
| Accueil | `index.html` | Tableau de bord principal |
| Connexion | `login.html` | Authentification utilisateur |
| Inscription | `register.html` | Création de compte |
| Panels | `panels.html` | Sélection du panel (Gratuit/VIP/Revendeur/Admin) |
| Profil | `profile.html` | Gestion du profil, avatar, thème |
| Réglages | `settings.html` | Préférences app, langue, pays |
| Serveurs | `servers.html` | Liste et sélection des serveurs |
| Communauté | `community.html` | Live Chat & DM |
| À propos | `about.html` | Infos version, crédits |
| Guide | `guide.html` | Guide d'utilisation |
| Mise à niveau | `upgrade.html` | Abonnement VIP / Premium |
| Factures | `invoices.html` | Historique des paiements |
| Mise à jour | `update.css` + `update.js` | In-App Update |

---

## 4. API distante

Base URL : `https://laboratoire.free-surf237-4all.xyz`

### Endpoints consommés par l'app

| Endpoint | Méthode | Usage |
|----------|---------|-------|
| `/api/user/me` | GET | Profil de l'utilisateur connecté |
| `/api/user/connect` | POST | Récupération de la configuration VPN |
| `/api/user/connect/options` | GET | Options de connexion (serveurs, moteurs) |
| `/api/user/servers` | GET | Liste des serveurs disponibles pour le plan |
| `/api/user/subscription` | GET | Détail de l'abonnement |
| `/api/user/tokens` | GET | Tokens d'abonnement activés |
| `/api/payment/initiate` | POST | Initier un paiement |
| `/api/community/dms` | GET/POST | Messagerie Privée 1-à-1 |
| `/api/community/dms/unread-count` | GET | Nombre de DM non lus |
| `/api/chat/translate/languages` | GET | Langues de traduction |
| `/api/app/latest-version` | GET | Vérification de version (In-App Update) |
| `/api/news` | GET | Nouvelles de l'écosystème |

### Authentification

- Sessions via cookies (SessionMiddleware côté Panel).
- Headers : `X-Device-Id`, `X-Device-Name`, `X-LS-Engines` (annonce des capacités du client).
- Jeton d'appareil : enregistrement via `/api/v1/devices/register`.

---

## 5. In-App Update & compilation APK

### In-App Update

1. L'app interroge `GET /api/app/latest-version`.
2. Elle compare `version_code` du serveur avec le `versionCode` local (`build.gradle.kts`).
3. Si `serverVersionCode > localVersionCode` → propose la mise à jour (anti-boucle).
4. Téléchargement de l'APK depuis `apk_url` (GitHub Releases).
5. `UpdateInstaller.kt` installe l'APK (demande d'autorisation d'installation de sources inconnues).

### Compilation APK

- **Build system** : Gradle Kotlin DSL (`build.gradle.kts`, `settings.gradle.kts`, `gradle.properties`).
- **Commande de debug** : `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.
- **Commande de release** : `./gradlew assembleRelease` (nécessite keystore de signature).
- **CI GitHub Actions** :
  - `.github/workflows/build-apk.yml` — build APK.
  - `.github/workflows/release-apk.yml` — release APK.

### Versions

- Tags Git : `v1.6.0` → `v1.6.8.1`.
- Version actuelle : **v1.6.8.1 ORBIT** (`version_code 261117004`).
- APK de release exemples : `release-1.2.2/` à `release-1.2.6/` (anciennes versions, à archiver).

---

## 6. Fonctionnalités principales

- [ ] Connexion / inscription / récupération de compte.
- [ ] Sélection de serveur et de moteur de tunnel.
- [ ] Communauté (Live Chat) avec salons publics et privés.
- [ ] Messagerie Privée 1-à-1 (`/api/community/dms`).
- [ ] Traduction de messages (FR ↔ EN et plus).
- [ ] LABOSURF TV (catalogue, lectures, téléchargements).
- [ ] Gestion de l'abonnement (VIP, Premium, Revendeur).
- [ ] Paiements par pays (+237, +225, +221, crypto).
- [ ] In-App Update avec vérification de version.
- [ ] Thèmes Sombre Émeraude / Glassmorphism, FR/EN.
- [ ] Profil utilisateur avec avatar et statistique de messages.

---

## 7. Structure du dépôt

```
LaboSurfVPN/
├── app/
│   ├── src/main/                 # Code source Android (Kotlin + ressources web)
│   ├── src/debug/                # Configuration debug
│   ├── src/test/                 # Tests unitaires Kotlin
│   └── build.gradle.kts
├── core/                         # Bibliothèque Go (tunnel, proxy, socks, tuic, ssh)
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── README.md                     # README existant (conservé)
├── README.new.md                 # Ce fichier (nouveau, à reviewer)
├── CHANGELOG.md
├── PROJECT_RELEASE_STATUS.md
├── .github/workflows/            # CI/CD (build-apk, release-apk)
├── docs/                         # ARCHITECTURE_MULTI_MOTEURS.md, AUDIT, RAPPORTS, TESTS
├── tests/                        # Tests Android, JS, intégration, UDP
├── design-previews/              # Maquettes HTML statiques (à archiver)
├── release-1.2.x/                # Anciennes APK de release (à archiver)
└── debug-apk-*/                  # Anciens APK de debug (à archiver)
```

---

## 8. Tests & CI

```bash
# Tests unitaires Kotlin
./gradlew test

# Tests JS (sous tests/js/)
npm test  # ou selon le configurateur JS présent

# Tests d'intégration (sous tests/integration/)
python tests/integration/real_panel_chain.py

# Build APK debug
./gradlew assembleDebug
```

CI GitHub Actions : `build-apk.yml` et `release-apk.yml`.

---

*Document généré en parallèle (fichier neuf, aucun fichier existant modifié).*
