# Labo Surf VPN — projet Android

## Où on en est

Ce dossier est un vrai projet Android Studio (Kotlin + Gradle), pas juste une maquette.

Ce qui est déjà fait et fonctionnel :
- **L'interface complète** (`app/src/main/assets/www/`) : c'est exactement l'app qu'on a construite ensemble (Accueil, Mon compte, Serveurs, Paramètres, Communauté, Historique — bannière, couleurs, animations comprises). Rien n'a été refait, juste recopié tel quel.
- **MainActivity.kt** : ouvre cette interface dans une WebView plein écran, comme une vraie app. Le bouton retour Android fonctionne.
- **Le pont JS ↔ natif** : quand tu appuies sur START dans l'app, le JavaScript appelle `window.LaboSurfNative.startVpn(...)` — un vrai pont existe, pas une simulation.
- **LaboVpnService.kt** : un vrai service VPN Android. Android reconnaît le tunnel (icône clé dans la barre de statut), demande la permission système la première fois, etc.

## Ce qu'il manque — une seule chose, mais importante

Le tunnel VPN existe mais **ne fait pas encore transiter le trafic à travers Xray/VLESS**. C'est noté clairement dans `LaboVpnService.kt` (section "PROCHAINE ÉTAPE"). Il faut :

1. Ajouter une librairie Xray-Android compilée (ex. `AndroidLibXrayLite`) au fichier `app/build.gradle.kts` — je ne peux pas choisir/vérifier la bonne version depuis ce sandbox (accès Internet restreint ici), il faut le faire depuis Android Studio avec une connexion normale.
2. Brancher cette librairie dans `startTunnel()` du service, à l'endroit indiqué par le commentaire.

## Comment compiler ça — point important

**Ce projet ne peut pas se compiler dans Termux** (contrairement à tes projets Python/Node habituels) — une app Android/Kotlin a besoin du SDK Android complet, ce que Termux ne fournit pas de façon fiable. Attention : apktool (même "Apktool M") ne convient pas non plus ici, car il sert à modifier un APK **déjà compilé** (décompiler → éditer le smali → reconstruire), pas à compiler un projet Kotlin neuf avec des dépendances Gradle.

**La solution adaptée à ta situation : GitHub Actions**, comme pour ton VPS. Un workflow est déjà prêt dans `.github/workflows/build-apk.yml` :
1. Pousse ce dossier sur un dépôt GitHub (comme tu le fais déjà pour xhttp-reverse-proxy).
2. Va dans l'onglet "Actions" du dépôt, sur le site GitHub — depuis ton téléphone, ça marche.
3. GitHub compile l'APK pour toi sur ses propres serveurs.
4. Tu télécharges l'APK compilé directement depuis la page du run terminé (section "Artifacts").
5. Installe-le sur ton téléphone (autorise "sources inconnues" si demandé).

Zéro PC, zéro Termux nécessaire pour cette étape — uniquement pour la compilation. Le reste (éditer les fichiers, ajouter la librairie Xray) peut se faire depuis MT Manager ou l'éditeur web de GitHub sur mobile, exactement comme tu fais déjà.

## Comment mettre le projet en ligne (pour que GitHub Actions compile)

1. Crée un dépôt GitHub (ou réutilise un existant), depuis ton téléphone.
2. Transfère ce dossier dedans — même méthode que pour xhttp-reverse-proxy (phone → Catbox → wget, ou upload direct via l'interface web GitHub).
3. GitHub Actions se déclenche automatiquement (fichier déjà présent : `.github/workflows/build-apk.yml`).
4. Récupère l'APK compilé dans l'onglet Actions → dernier run → Artifacts.

## Structure de l'interface (assets/www)

- `index.html` : uniquement le balisage (écrans, rail latéral, sprite d'icônes).
- `css/tokens.css` : **couleurs, dimensions, typographie** (thèmes sombre/clair) — seul endroit à modifier pour changer le look.
- `css/base.css`, `components.css`, `screens.css` : structure, composants réutilisables, écrans.
- `js/i18n.js` + `js/lang/fr.js` / `en.js` : traductions (mêmes clés dans les deux fichiers). HTML : `data-i18n="clé"` ; JS : `t('clé')`.
- `js/theme.js` (système / clair / sombre), `core.js` (toasts, dialogues, formats), `api.js` (accès au panel),
  `servers.js`, `vpn.js` (états : off / connecting / on / disconnecting / error), `account.js`, `reseller.js`, `activity.js`, `settings.js`, `banner.js`, `app.js`.
- Pages légales : aucune URL n'est codée en dur. Quand le backend les fournit : `setLegalUrls({ terms: 'https://…', privacy: { fr: '…', en: '…' } })` (`js/api.js`). Sans URL : « Bientôt disponible / Coming soon ».
- Textes du backend : `localizedField(obj, 'message')` (`js/core.js`) choisit `message_fr` / `message_en` (ou `{fr,en}`) selon la langue, sans jamais inventer de traduction.
- Test rapide dans un navigateur : `python -m http.server 5173 --directory app/src/main/assets/www`.
  Dans un navigateur, la connexion VPN n'existe pas : l'app l'indique au lieu de la simuler. Pour mettre au point les écrans « connecté » / « connexion en cours », ajouter `?preview=1` à l'adresse : un bandeau « Aperçu — connexion non réelle » reste affiché en permanence.

### Design system et composants
- `css/tokens.css` : couleurs de marque, **couleurs d'état de connexion** (`--state-idle / busy / on / warn / err`), ombres, couches (`--z-*`), mouvement. Aucune couleur en dur ailleurs.
- `css/components.css` : boutons, cartes, champs, badges, alertes, états vides/squelettes, rail, toasts, dialogues, **feuille (`.sheet`), rubriques repliables (`.accordion`), étapes (`.steps`), légende d'états (`.state-list`), emplacement d'assistant (`.assistant-slot`)**.
- Navigation : rail latéral à quatre boutons — Accueil, Compte, Services, Réglages (+ raccourcis thème/langue sous Réglages). Serveurs s'ouvre depuis Services ; Historique et Espace revendeur depuis Compte ; Communauté depuis Réglages (`PARENT_OF` dans `js/app.js`).
- Accueil : une seule page, sans défilement (logo, START, état, action, bannière). `homeReadiness()` (`js/vpn.js`) déduit la situation réelle avant connexion à partir du jeton, de l'offre du panel et de la liste des serveurs : `login`, `loading`, `ready`, `expired`, `noServer`, `srvError`, `srvDown`. Chaque valeur pilote le titre, le message, le bouton d'action (`HOME_ACTIONS`) et la couleur. La bannière occupe tout l'espace restant ; un message plus long défile dans la bannière (`fitHomeScreen()` ne réduit que les commandes, jamais sous 62 %).
- Accueil, bouton START : relief et halo (`css/screens.css`), libellés START / CONNEXION… / CONNECTÉ (+ STOP) / DÉCONNEXION…, calés sur `VPN.state`. « Connecté depuis » (durée) et « Serveur » ne s'affichent que si `VPN.session` existe (posée uniquement par `markConnected`, donc une vraie connexion) ; sans moteur, aucune durée n'apparaît.
- Bannière premium : `#homeBannerCard` = cadre + décor animé `.bn-fx` (halos et réseau, `transform` seulement, désactivé par `prefers-reduced-motion`) + corps défilable `.bn-body`. Emplacements : image, badge, titre, texte, action, indicateur (`js/banner.js`) ; le contenu par défaut est neutre (canal et groupe officiels). Le rail est en haut à gauche (≈ 18 % de la hauteur) et la bannière passe dessous sur toute la largeur (`.is-inset` si l'écran est trop court).
- Services : `js/services.js`, liste réelle de `/api/user/services` (états : non connecté, chargement, erreur, vide). Aucun service n'est inventé.
- Compte : menu (Accès et abonnement, Messages, Historique, Sécurité, Préférences, Aide) + sous-vues (`setAccView` dans `js/account.js`). Historique : `js/activity.js` (états disponible / aucune session / chargement / erreur ; sessions enregistrées localement).
- Guide : `js/guide.js` + `#guideBackdrop` dans `index.html`. Ouvrir avec `Guide.open('trouble')` ou `data-action="openGuide" data-topic="server"` (rubriques : start, service, server, connect, states, access, history, trouble). Contenu statique traduit (`guide.*` dans `fr.js` / `en.js`).
- Assistant LABOSURF : onglet « Assistant » du guide, catégories qui renvoient vers la réponse du guide ; la conversation est marquée « Bientôt » (`Assistant.available=false`). Aucune réponse n'est simulée ; le backend reste à connecter.
- Onboarding : `js/onboarding.js`, 4 écrans courts, passable, mémorisé (`ls.onboarded`) ; relançable depuis Réglages.
- Moteur VPN : `LaboVpnService.ENGINE_INTEGRATED` vaut `false` tant que Xray n'est pas branché. Dans ce cas l'app affiche « Le moteur de connexion n'est pas encore installé » et n'annonce jamais « Connecté ».

