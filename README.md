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
