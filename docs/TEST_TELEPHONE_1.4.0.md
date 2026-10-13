# Test sur VRAI téléphone — LaboSurfVPN 1.4.0 (expérience utilisateur)

À faire par une personne, sur un téléphone Android réel. Rien de ceci n'a été fait par l'agent (CI et émulateur seulement).
Noter « OK » ou ce qui s'est passé à la place. La non-régression des moteurs reste celle de `TEST_TELEPHONE_1.3.0.md`.

## 0. Installer
1. Télécharger l'APK depuis la Release GitHub v1.4.0 (ou la page Téléchargement du Panel) et vérifier son empreinte (`.sha256`).
2. L'installer par-dessus la 1.3.0. Attendu : installation acceptée.
3. Réglages : version **1.4.0**.

## 1. Rester connecté
1. Se connecter au compte. Fermer complètement l'application (balayage), la rouvrir.
   Attendu : le compte est ouvert sans ressaisir les identifiants.
2. Réglages → Compte → « Rester connecté » : désactiver, fermer, rouvrir. Attendu : identifiants redemandés.
3. Réactiver, se reconnecter ; Profil → Se déconnecter ; fermer, rouvrir. Attendu : identifiants redemandés.
4. Depuis le Panel (« Mes appareils »), révoquer ce téléphone. Rouvrir l'application. Attendu : déconnecté proprement.

## 2. Accueil et état
1. Déconnecté : badge « Déconnecté » avec icône ; puce « Profil » ou « Serveur » sous l'état (touche = écran Serveurs).
2. Connexion : badge « Connexion en cours… » (icône qui tourne), puis « Connecté » (bouclier vert) et carte durée + serveur.
3. Échec (ex. mode avion) : badge rouge « Échec de la connexion » et message explicatif.

## 3. Thème du profil
1. Dans le Panel (/admin/profiles), donner une couleur à un profil (ex. or). Dans l'application, choisir ce profil.
   Attendu : puce du profil et carte de session à cette couleur ; logo, bouton START et rail restent verts.
2. Profil sans couleur : identité LABOSURF (vert). Compte VIP sans couleur de profil : accent or.
3. Thème clair : la couleur reste lisible.

## 4. Communauté
Réglages → Communauté : « Communauté LABOSURF » ouvre le Live Chat du Panel déjà connecté ; plus aucun lien Telegram de groupe ou de canal.

## Où remonter un problème
Réglages → Journal et cache → « Copier le rapport ».
