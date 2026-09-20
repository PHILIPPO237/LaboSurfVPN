# Audit de LaboSurfVPN et intégration au système Panel → agent → PRO

Date : 2026-09-20 · Branche `phase5-vpn-client-integration` · Aucun changement dans LABOSURF_PRO ni dans le Laboratoire
du Free-Surf (leur contrat actuel a suffi ; les manques sont listés en §8).

## 1. Architecture actuelle

```
WebView (app/src/main/assets/www)          Kotlin (app/src/main/java/com/philippo237/labosurf)
  index.html + css/ + js/ (FR/EN)            MainActivity   : WebView plein écran, pont natif, liens externes, retour Android
  ├─ contract.js  contrat API (pur, testé)   LaboVpnService : VpnService Android (squelette ; ENGINE_INTEGRATED = false)
  ├─ api.js       fetch + jeton (mémoire)
  ├─ vpn.js       machine d'états + connexion
  └─ écrans (account, servers, services…)  ── pont JS ↔ natif : window.LaboSurfNative (@JavascriptInterface)
                                             ── natif → JS : window.onNativeVpnState(state, detail) / onNativeVpnStats
```

Chaîne cible : **LaboSurfVPN → Laboratoire du Free-Surf (HTTPS, Bearer) → labosurf-agent → LABOSURF_PRO → Service → Access → moteur.**
LaboSurfVPN ne parle **jamais** à l'agent ni à PRO : uniquement au panel.

### Pont natif (Kotlin)
| Méthode | Rôle | Statut |
|---|---|---|
| `startVpn(json)` / `stopVpn()` | démarre/arrête le tunnel | réel côté Android ; le moteur (`ENGINE_INTEGRATED=false`) refuse → `engine_unavailable` |
| `getEngineInfo()` **(nouveau)** | `{integrated, protocols[]}` réels du moteur, lus AVANT tout appel au backend | réel |
| `getApiBase()` **(nouveau)** | adresse de l'API fixée à la compilation (`BuildConfig.PANEL_BASE_URL`) | réel |
| `getDeviceId()` | ANDROID_ID (anti-abus de l'essai, `_check_trial_abuse` du panel) | réel |
| `getAppVersion()`, `setSystemBars()`, `openVpnSettings()`, `clearWebCache()` | confort système | réels |
| `window.onNativeVpnState(state, detail)` | `connecting` / `connected` / `stopping` / `disconnected` / `error` | réel (états intermédiaires ajoutés) |
| `window.onNativeVpnStats(rx, tx, rxSpeed, txSpeed)` | trafic mesuré par le moteur | **jamais appelé** (moteur absent) → « indisponible » |

### Données locales
`localStorage` (`ls.*`, préférences non sensibles) : `lang`, `theme`, `server` (dernier serveur choisi), `sessions` (historique local,
50 max), `expiryReminders`, `onboarded`, `apiBase` (navigateur de dev seulement) ; `labosurf_device_id` (navigateur seulement,
natif : ANDROID_ID) ; `expiryBannerDismissedOn`. **Jeton de connexion : mémoire seulement** (perdu à la fermeture). Aucune configuration
VPN n'est stockée. `sessionStorage` : `ls.cacheCleared`.

### API du panel appelées (toutes existent dans le panel — vérifié dans `app/routers/*.py`)
| Endpoint | Écran | Propriétaire |
|---|---|---|
| `POST /api/auth/login`, `register`, `forgot-password/verify`, `forgot-password/reset` | Compte | Panel |
| `GET /api/user/me`, `GET /api/user/subscription` | Compte, Accueil | Panel |
| `GET /api/user/servers` | Serveurs, Accueil | Panel (serveurs commerciaux, `visible_plans`) |
| `GET /api/user/services` | Services | Panel (enregistrements commerciaux « VPN », **pas** les Services PRO) |
| **`POST /api/user/connect`** | Accueil (START) | Panel → agent → PRO |
| `POST /api/user/activate`, `POST /api/user/subscription/request` | Compte > Accès | Panel |
| `GET/POST /api/user/messages`, `GET /api/user/notifications`, `POST …/{id}/read` | Compte > Messages | Panel |
| `POST /api/user/profile/avatar-upload` | Compte | Panel |
| `GET /api/ads/active?location=labo_surf_rail` | Accueil (bannière) | Panel |
| `GET/POST /api/revendeur/*` (clients, demandes, création) | Espace revendeur | Panel |

## 2. Écrans et fonctions (ce qui existe)

| Écran | Rôle | Données / API | Dépendance | Action recommandée |
|---|---|---|---|---|
| **Accueil** | START/STOP, état réel, durée réelle, trafic (si mesuré), bannière | `connect`, `servers`, `me`/`subscription`, `ads` | Panel→PRO | **Conserver** (cœur de l'app) |
| **Services** | liste des services commerciaux de l'utilisateur + résumé serveurs | `services`, `servers`, `me` | Panel | **Conserver** ; supprimer à terme les lignes qui répètent l'offre (voir doublons) |
| **Serveurs** | choix du serveur autorisé | `servers` | Panel (`server_bindings` → PRO invisibles au client) | **Conserver** |
| **Historique** | sessions locales + pastille d'état | local | Android | **Conserver** ; l'info de connexion répète l'Accueil (voir doublons) |
| **Compte** (menu) | profil, jours restants, messages, historique, sécurité, préférences, aide, **Continuer sur le Laboratoire** | `me`, `subscription` | Panel | **Conserver** |
| Compte > **Accès et abonnement** (Access, Subscription, **Renewal**) | jauge de jours, quota déclaré, code d'activation, demande de renouvellement/passage VIP | `activate`, `subscription/request` | Panel (commercial) | **Conserver comme client léger** ; le paiement reste au Panel |
| Compte > **Messages** (Messages + annonces) | messagerie avec le gestionnaire/revendeur, justificatif de paiement | `messages`, `notifications` | Panel | **Conserver** (support) |
| Compte > **Sécurité** | texte + déconnexion | — | Android | **Conserver** |
| **Espace revendeur** (Reseller) | créer un client, valider/rejeter des demandes, lister les clients | `/api/revendeur/*` | Panel (**commercial/admin**) | **Déplacer à terme vers le Panel** (voir §5) ; masqué sauf plan revendeur/admin |
| **Communauté** | liens Telegram | statique | Android | **Fusionner** avec À propos (doublon) |
| **Réglages** | langue, thème, rappel d'expiration, réglages VPN Android, aide, assistant, légal, version | local | Android | **Conserver** |
| **À propos** | mission, fonctionnement, principes, contact, légal | statique | Android | **Conserver** |
| **Légal** | conditions et confidentialité (texte local) | statique | Android | **Conserver** |
| **Journal et cache** | diagnostic, journal de session, copier le rapport, vider le cache | local | Android | **Conserver** |
| **Guide** (feuille) | 8 rubriques d'aide | statique | Android | **Conserver** |
| **Assistant** (feuille) | FAQ locale par mots-clés — **pas d'IA**, dit « je n'ai pas de réponse » sinon | local | Android | **Conserver tel quel** (placeholder honnête) |
| Présentation (onboarding), animation d'ouverture, dialogues, toasts, bandeau d'expiration | UX | local | Android | **Conserver** |

## 3. Fonctions simulées / fictives (recensement)

| Élément | Constat | Décision |
|---|---|---|
| Connexion « aperçu » `?preview=1` (`vpn.js`) | simulation **visuelle** en navigateur uniquement, bandeau permanent « Aperçu — connexion non réelle » ; impossible dans l'app native | **Conservé** (outil de design, signalé) |
| `preview_*.html` (6 fichiers, 130 Ko chacun, non suivis par Git) | anciennes maquettes monolithiques **avec faux serveurs (« Serveur 1 », ping 46/112), ping aléatoire `40+random`, faux débit, faux historique** ; embarquées par erreur dans l'APK (`assets/www`) | **Déplacées** vers `design-previews/` (hors APK) ; à supprimer quand vous le décidez |
| Pourcentage de la jauge de jours (`graceDays + 25`) | dénominateur **inventé** (28 jours) | **Corrigé** : pourcentage réel (début → fin fournis par le panel) sinon aucun pourcentage |
| Trafic (reçu/envoyé) | valeurs **uniquement** issues du moteur natif ; sinon « indisponible » | conforme |
| Quota consommé | le panel ne le fournit pas → seul le quota déclaré s'affiche | conforme |
| Ping / charge des serveurs | affichés seulement si l'API les fournit (elle ne le fait pas) | conforme |
| Chronomètre | `VPN.session` n'est posée que par `markConnected()` (réponse du natif) | conforme, **testé** |
| Configuration VPN | jamais fabriquée ; l'URI vient de `POST /api/user/connect` | conforme, **testé** |
| Assistant | FAQ locale explicite, pas de réponse inventée | conforme |

## 4. Doublons détectés

| Fonction | Emplacement actuel | Autre emplacement | Rôle réel | Recommandé | Action |
|---|---|---|---|---|---|
| Offre + jours restants | Compte > Accès (référence) | carte Services (« Accès »), sous-titre du menu Compte, bandeau d'expiration, Accueil (`expired`) | reflet du même `me/subscription` | Compte > Accès | **Conserver** (source unique `Account.last`) ; retirer plus tard la ligne « Accès » de la carte Services |
| Liste/état des serveurs | Serveurs (référence) | Services (ligne « Serveurs », « Serveur »/« Disponibilité » par carte), Accueil (`srvDown`) | lecture de `Servers.list` | Serveurs | **Conserver** ; fusionner à terme « Disponibilité » de Services dans Serveurs |
| Durée de connexion / serveur courant | Accueil | Historique (carte « Informations de connexion » + pastille d'état) | miroir de `VPN.session` | Accueil | **Fusionner** (retirer le miroir de l'Historique) |
| Liens Telegram (canal/groupe/développeur) | Communauté | À propos (Contact), bannière par défaut de l'Accueil | statique | Communauté | **Fusionner** À propos → lien vers Communauté |
| Conditions / Confidentialité | Réglages | À propos | statique | Réglages | **Conserver** (même écran `legal`) |
| Contenu explicatif (« comment ça marche ») | Onboarding (4), Guide (8), FAQ assistant (16), À propos | — | statique | Guide | **Conserver** ; l'Assistant réutilise le Guide (déjà) |
| Langue / thème | Réglages | rail (raccourcis) | même réglage | Réglages | **Conserver** (raccourci volontaire) |
| Réglages VPN Android | Réglages (« connexion ») | — | ouvre les réglages système (kill switch) | Réglages | **Conserver** |
| Demande de renouvellement / justificatif | Compte > Accès | Compte > Messages (pièce jointe) | deux chemins vers le même traitement Panel | Panel | **Conserver** (les deux existent dans le Panel) |
| Paiement / offres (fonctions commerciales) | — (absent) | Panel | commercial | **Panel** | **« Continuer sur le Laboratoire du Free-Surf »** (ajouté) |

## 5. Répartition des responsabilités (matrice)

| Fonction | VPN (Android) | PANEL | PRO | À SUPPRIMER / À FUSIONNER |
|---|---|---|---|---|
| Connexion, jeton, déconnexion du compte | **écran + mémoire** | authentifie (`/api/auth/*`) | — | |
| Statut du compte, abonnement, expiration commerciale | affiche | **propriétaire** | — | |
| Paiement, offres, renouvellement (traitement) | formulaire léger + lien | **propriétaire** | — | |
| Revendeur : créer/valider/lister | **à déplacer** | **propriétaire** | — | Espace revendeur → Panel (à terme) |
| Serveurs commerciaux autorisés (plan) | **affiche + choix** | **propriétaire** (`visible_plans`) | — | |
| Liaison serveur ↔ Service technique (`server_bindings`) | invisible | **propriétaire** | Service | |
| Création de l'Access (paresseuse), expiration technique | invisible | **décide** | **exécute** (Access) | |
| Configuration de connexion (URI) | **reçoit et transmet au moteur** | relaie `POST /api/user/connect` | **émet** (`/access/{id}/config`) | build_user_configs = déprécié (panel) |
| Santé du service | reçoit `service_health` | agrège | mesure | |
| Moteur VPN Android, tunnel, états CONNECTING/CONNECTED/STOPPING/ERROR | **propriétaire** | — | — | |
| Durée réelle de connexion, historique local | **propriétaire** | — | — | Historique/Accueil : fusionner le miroir |
| Consommation / quota | affiche « non mesuré » | déclare le quota | **capacité manquante** (TUIC non mesuré) | |
| Guide, assistant local, langue, thème, légal, à propos, onboarding | **propriétaire** | — | — | Communauté ← À propos : fusionner |
| Messages, annonces, bannière | affiche | **propriétaire** | — | |

## 6. Contrat de connexion (vérifié sur le vrai code du panel)

`POST /api/user/connect` — corps `{server_id, device_id}` (le `GET` du panel est déprécié : l'app n'utilise plus que le `POST`).
Succès : `{status:"success", server_id, service_health: available|unknown, access:{state, expires_at}, configs:[{protocol, remark, uri, format}], trial_limit_minutes?, trial_quota_mb?}`.
Erreur : `{status:"error", code, message, retry_after_s?}` avec 14 codes stables (`user_not_authenticated` … `configuration_unavailable`).
Les réponses **réelles** du panel (route + faux agent) sont capturées dans `tests/js/fixtures/panel_connect_samples.json` et lues par les tests.

Règles appliquées dans `js/contract.js` / `js/vpn.js` : lecture stricte (tout écart = échec, jamais de configuration reconstruite) ;
texte par code d'erreur dans l'app (FR/EN), texte du panel uniquement pour un code inconnu ; `retry_after_s` seulement quand réessayer a un sens ;
`service_health: unknown` conservé tel quel (jamais « sain ») ; expiration réelle de l'Access (`access.expires_at`) qui coupe le tunnel ;
le moteur natif doit exister **avant** d'appeler le backend (l'appel crée un Access et peut consommer l'essai de l'appareil) ; le protocole
reçu doit être supporté par le moteur (`getEngineInfo`) ; **`CONNECTED` et le chronomètre n'existent que sur la réponse du natif**.

## 7. Modifications effectuées

* `js/contract.js` (nouveau) : `ApiBase` (HTTPS obligatoire, boucle locale tolérée en http:// pour le développement) et `ConnectContract`.
* `js/api.js` : adresse **configurable** (plus de `http://127.0.0.1:8000` en dur), aucune requête sans adresse valide, `cache: no-store`, `credentials: omit`.
* `js/vpn.js` : `POST /api/user/connect`, garde moteur avant backend, lecture stricte, états `stopping`/`connecting` du natif, expiration réelle de l'Access, durée de session.
* `js/account.js` : durée de session (`expires_in`), pourcentage de jauge réel, action « Continuer sur le Laboratoire du Free-Surf » (`openPanel`).
* `index.html`, `sw.js`, `lang/fr.js`, `lang/en.js`, `emoji.js` : chargement de `contract.js`, ligne du menu, 30 textes (dont les 14 codes d'erreur), FR = EN.
* Kotlin : `MainActivity` (`getEngineInfo`, `getApiBase`), `LaboVpnService` (`SUPPORTED_PROTOCOLS`, états `connecting`/`stopping`, validation de la configuration reçue — jamais journalisée).
* Gradle/réseau : `BuildConfig.PANEL_BASE_URL` (`-PlabosurfPanelBaseUrl=…`), **HTTPS seul en release** ; boucle locale en clair uniquement en debug (`src/debug/res/xml/network_security_config.xml`).
* Maquettes obsolètes hors de l'APK : `assets/www/preview_*.html` → `design-previews/`.
* Tests : `tests/js/` (47 tests Node), `tests/mock_panel.py` (faux panel de test, jamais livré).

## 8. BACKEND CAPABILITY NEEDED (aucune API créée)

1. **Consommation réelle** (trafic, quota) : `usage.available=false` pour TUIC (`engine_not_metered`) → tuiles de trafic et jauge de quota = « non mesuré ». *(PRO)*
2. **Déconnexion côté serveur / révocation du jeton API** : `/logout` du panel est celui de la session web ; le jeton Bearer reste valable jusqu'à `expires_in` (86 400 s par défaut). *(Panel)*
3. **Adresse publique du panel** : `docs/guides/LOCAL_ENV_SETUP.md` du panel distingue « App publique » (`app.laboratoire…`) et « Panel admin » (`laboratoire…`). La valeur par défaut de l'APK est `https://app.laboratoire.free-surf237-4all.xyz` (**à confirmer**) et sert aussi pour « Continuer sur le Laboratoire du Free-Surf » (la page d'accueil de cette adresse doit être utile à un humain). *(Panel / décision)*
4. **Fenêtre d'exposition de la révocation** : un Access expiré/désactivé/supprimé reste valide dans le moteur jusqu'à la réconciliation périodique du panel (période à fixer) ; la coupure de tunnel côté Android n'est immédiate que pour l'expiration connue (`access.expires_at`). *(Panel + déploiement du timer)*
5. **Certificat TUIC** auto-signé sans SAN : les liens portent `allow_insecure=1` ; le moteur Android doit accepter ce mode (le client officiel `tuic-client` 1.0.0 refuse ce certificat). *(PRO / décision)*
6. **Santé et charge par serveur** : `GET /api/user/servers` ne donne pas de santé/ping (seul `connect` renvoie `service_health`). *(Panel)*
7. **Historique côté serveur** : l'historique de sessions est purement local. *(Panel, optionnel)*
8. **URL des pages légales** : `setLegalUrls` attend une URL du backend ; sinon texte local. *(Panel, optionnel)*
9. **Formats de configuration** autres que `uri` (`wireguard-conf`, `ssh-command`, `text`) : renvoyés par PRO selon le moteur ; seul `uri`/TUIC est validé de bout en bout. *(PRO / moteur Android)*

## 9. Tests effectués

* **47 tests Node** (`node --test tests/js/`), sur le **vrai code de l'interface** chargé dans un contexte `vm` (DOM, réseau et pont natif simulés) :
  contrat (14 codes, retry, santé, Access, hors-contrat, secrets), adresse (HTTPS, natif vs navigateur), flux de connexion (moteur absent → aucun appel backend ;
  configuration exacte transmise au natif ; `CONNECTED`/chronomètre seulement sur réponse du natif ; watchdog ; 401 ; réseau/hors-ligne/timeout ;
  protocole non supporté ; expiration réelle ; navigateur ; mode aperçu), compte (jauge, quota, session, déconnexion), traductions (FR = EN, aucune clé manquante),
  **contrat réel** (réponses capturées de la vraie route du panel).
* **Contrôle de sensibilité** : suppression de la garde moteur → 2 tests échouent ; « connecté » sans réponse du natif → 3 échouent.
* **Navigateur réel** (Chromium, faux panel) : connexion, `expires_in`, refus moteur absent (aucun appel au panel), `CONNEXION…` sans chronomètre, `CONNECTÉ` + chronomètre après réponse du natif,
  erreurs `service_unhealthy` (+ « Réessaie dans 30 s »), `subscription_expired`, réponse invalide, `configuration_unavailable`, FR/EN, CORS réel (`Authorization`, `Content-Type`).

## 10. Ce qui reste avant une vraie connexion VPN Android

1. **Moteur** : intégrer un moteur qui sait transporter TUIC (`ENGINE_INTEGRATED=true`, `SUPPORTED_PROTOCOLS=["tuic"]`), accepter `allow_insecure=1` (ou un certificat avec SAN), câbler le tunnel sur le descripteur du `VpnService`, émettre `connected` seulement quand le trafic passe, publier les statistiques réelles.
2. **Compilation** : ce poste n'a ni JDK, ni SDK Android, ni Gradle — **le Kotlin et Gradle modifiés n'ont pas été compilés ici**. À valider par le workflow GitHub (`workflow_dispatch`) ou Android Studio avant toute diffusion.
3. Confirmer l'adresse publique du panel (§8.3) et tester sur un appareil (dev : `-PlabosurfPanelBaseUrl=http://10.0.2.2:8000` avec un build debug).
4. Déployer la réconciliation périodique du panel (fenêtre d'exposition, §8.4).
5. Décider de la persistance du jeton (Keystore) et de la reconnexion automatique.

## 11. Risques et décisions

* **Jeton en mémoire** : chaque redémarrage de l'app impose de se reconnecter. Stocker le jeton exige le Keystore Android (natif) — décision produit/sécurité.
* **Espace revendeur dans l'app** : fonctions commerciales/admin embarquées ; risque de dérive vers un second panneau d'administration. Recommandation : garder masqué (rôle) puis déplacer vers le Panel.
* **`/api/user/services`** montre des enregistrements commerciaux, pas les Services PRO : ne pas les présenter comme des services techniques.
* **Coupure** : chaque application côté PRO redémarre le moteur (toutes les sessions TUIC sont coupées quelques secondes) ; l'app doit gérer la reconnexion.
* **Kotlin non compilé** (voir §10.2).
