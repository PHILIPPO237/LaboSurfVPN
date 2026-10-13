# Test sur VRAI téléphone — LaboSurfVPN 1.3.0 (tous les moteurs)

À faire par une personne, sur un téléphone Android réel (Android 7 ou plus). Rien de ceci n'a été fait par l'agent : il n'avait
aucun appareil réel (seulement l'émulateur de la CI). Chaque étape donne le **résultat attendu** ; noter « OK » ou ce qui s'est
passé à la place. **La release 1.3.0 n'est publiée qu'après ce test.**

## 0. Préparer

1. Récupérer l'APK de contrôle **signée** (artefact `labo-surf-vpn-release` du workflow « Release APK Labo Surf (signee) »,
   branche `feature/multi-moteurs`) et vérifier son empreinte avec le fichier `.sha256` fourni :
   `certutil -hashfile LaboSurfVPN-v1.3.0.apk SHA256`.
2. L'installer **par-dessus** la 1.2.6 (même signature). Attendu : installation acceptée, compte toujours connecté.
3. Réglages : la version affichée est **1.3.0**.

## 1. Chaque moteur visible

Pour chaque serveur / profil proposé par l'application (UDP, Xray, TUIC, Hysteria2, SSH, SSH-SSL, SSH-HTTP, WireGuard
selon ce que le compte voit) :

1. Choisir le profil, toucher **Connecter**.
   Attendu : « Connexion… » puis **« Connecté »** en moins de 20 s ; icône de clé VPN dans la barre d'état Android.
2. Ouvrir Chrome, charger une page (par exemple https://www.wikipedia.org).
   Attendu : la page s'affiche.
3. Revenir dans l'application : le compteur de données augmente (ou « Indisponible », jamais un faux 0).
4. Toucher **Déconnecter**.
   Attendu : « Déconnecté » ; **l'icône de clé VPN disparaît** de la barre d'état ; Chrome fonctionne toujours (sans VPN).

Cas particuliers attendus (pas des erreurs de l'application) :
- **WireGuard** : « Connecté » peut ne PAS apparaître (le serveur n'a pas encore de NAT) : l'application doit alors afficher une
  erreur, jamais « Connecté » sans Internet.
- **TUIC, SSH, SSH-SSL, SSH-HTTP** : le trafic UDP autre que le DNS est bloqué (appels WhatsApp, jeux en UDP peuvent échouer) ;
  la navigation web doit fonctionner.
- Un moteur sans client (DNSTT, SlowDNS…) : refus clair « protocole non pris en charge », jamais « Connecté ».

## 2. Enchaînements

1. Connecté en Xray → Déconnecter → Connecter en UDP. Attendu : les deux connexions réussissent, aucune icône VPN fantôme.
2. Connecté → activer puis désactiver le **mode avion**. Attendu : erreur ou reconnexion propre, jamais « Connecté » sans Internet.
3. Connecté → fermer l'application (balayage). Attendu : le VPN reste actif (notification) ; « Déconnecter » depuis la
   notification ou l'application l'arrête.
4. Réglages Android → VPN → couper LaboSurfVPN. Attendu : l'application passe à « Déconnecté ».

## 3. Non-régression

Connexion au compte, choix de profil, consommation, chat, ouverture depuis le Panel : comme en 1.2.6.

## Où remonter un problème

Noter l'étape, le moteur, l'heure, le modèle du téléphone et la version d'Android ; dans l'application, Réglages → Journal et
cache → « Copier le rapport ».
