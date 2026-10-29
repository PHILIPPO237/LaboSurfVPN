# Test sur VRAI téléphone — LaboSurfVPN 1.2.5 (session unifiée Panel ↔ application)

À faire par une personne, sur un téléphone Android réel (Android 7 ou plus), avec un compte VIP réel. Rien de ceci n'a été fait par l'agent :
il n'avait aucun appareil réel. Chaque étape donne le **résultat attendu** ; noter « OK » ou ce qui s'est passé à la place.

## 0. Préparer

1. Télécharger `LaboSurfVPN-v1.2.5.apk` depuis la Release GitHub v1.2.5 et vérifier son empreinte (fichier `.sha256` de la Release) :
   - Windows : `certutil -hashfile LaboSurfVPN-v1.2.5.apk SHA256`
   - Résultat attendu : identique au `.sha256` publié.
2. Installer l'APK **par-dessus** la 1.2.4 (même signature : la mise à jour doit s'installer sans désinstaller).
   Attendu : installation acceptée, données conservées.
3. (Facultatif, avec un ordinateur et le débogage USB) vérifier qu'Android a validé l'App Link :
   `adb shell pm get-app-links com.philippo237.labosurf`
   Attendu : `laboratoire.free-surf237-4all.xyz: verified`. Si « none » ou « legacy_failure » : relancer la vérification avec
   `adb shell pm verify-app-links --re-verify com.philippo237.labosurf`, attendre 30 s, recommencer.

## 1. Panel → application (bouton « Ouvrir l'app »)

1. Dans **Chrome du téléphone**, se connecter au Panel (`https://laboratoire.free-surf237-4all.xyz`), ouvrir l'espace VIP (`/panel-vip`).
2. L'application doit être **déconnectée** (Profil → Se déconnecter si besoin) et fermée.
3. Toucher **« Ouvrir l'app »**.
   Attendu : LaboSurfVPN s'ouvre et affiche « Vous êtes connecté depuis le Laboratoire du Free-Surf » ; le Profil montre le bon compte.
4. Dans l'application : Profil → Sécurité → Mes appareils.
   Attendu : ce téléphone apparaît (nom de l'appareil).

## 2. Application → Panel (« Continuer sur le Laboratoire »)

1. Dans l'application connectée : Profil → **« Continuer sur le Laboratoire du Free-Surf »**.
   Attendu : Chrome s'ouvre sur le Panel, **déjà connecté** (tableau de bord), sans demander le mot de passe.
2. Regarder la barre d'adresse.
   Attendu : aucune suite `#code=…` restante (l'adresse est nettoyée aussitôt).

## 3. Déconnexion liée

1. Dans l'application : Profil → Se déconnecter.
2. Revenir dans l'onglet Chrome ouvert à l'étape 2, recharger la page.
   Attendu : retour à la page de connexion du Panel (session web révoquée avec celle de l'application).

## 4. Abus et cas limites

1. Réutilisation : à l'étape 1.3, avant de toucher « Ouvrir l'app », appuyer longuement sur le bouton n'est pas possible ; refaire
   simplement le parcours 1 deux fois de suite. Attendu : chaque ouverture fonctionne (un NOUVEAU code est créé à chaque fois).
2. Code expiré : sur le Panel, toucher « Ouvrir l'app » avec l'application **désinstallée** (voir 5), noter l'heure, puis
   réinstaller et ne rien faire pendant 2 minutes. Attendu : aucun accès possible avec un ancien lien (le code a expiré en 60 s).
3. Session déjà ouverte : application connectée avec le compte A, ouvrir le Panel avec le compte B dans Chrome et toucher « Ouvrir l'app ».
   Attendu : l'application reste sur le compte A (un lien ne remplace jamais une session ouverte).

## 5. Application absente

1. Désinstaller LaboSurfVPN.
2. Dans Chrome, Panel connecté, toucher « Ouvrir l'app ».
   Attendu : page « Ouvrir LaboSurfVPN » avec « Installer LaboSurfVPN » et « Continuer sur le site » ; aucune erreur.
3. Sur un **ordinateur**, ouvrir `https://laboratoire.free-surf237-4all.xyz/app/open`.
   Attendu : message « LaboSurfVPN est une application Android… continuez sur le site ».

## 6. Non-régression rapide

Connexion par identifiants dans l'application, connexion VPN sur un serveur, consommation affichée (ou « Indisponible »), chat.
Attendu : comme en 1.2.4.

## Où remonter un problème

Noter l'étape, l'heure, le modèle du téléphone et la version d'Android ; dans l'application, Réglages → Journal et cache → « Copier le rapport ».
