# LOCAL_ENV_SETUP

## But
Ce guide garde le projet local aligne sur la production sans exposer les vrais secrets du VPS.

## Fichiers a utiliser
- `.env` : ton fichier local prive. Il reste ignore par Git.
- `.env.development` : base simple pour lancer l'app en local.
- `.env.staging` : modele de preproduction avec placeholders.
- `.env.production` : modele de production aligne sur la topologie verifiee le 2026-03-29.
- `.env.example` : reference generale sans secret reel.

## Regle importante
Ne committe jamais un vrai token Remnawave, un vrai `FS_CSRF_SECRET`, un mot de passe admin ou un mot de passe SMTP.

## Workflow conseille
1. Pars de `.env.example` pour creer ton `.env` local.
2. Utilise `.env.development` pour le dev local.
3. Utilise `.env.staging` seulement si tu as une vraie infra de preproduction.
4. Utilise `.env.production` comme modele documentaire, puis injecte les vrais secrets uniquement sur le serveur.

## Ordre de chargement
- `.env` sert de base locale.
- si `FS_ENV=development|staging|production`, le fichier `.env.<profil>` est charge ensuite comme complement.
- si `FS_ENV_FILE` est defini, ce fichier explicite est charge en dernier et devient l'override prioritaire.
- les vraies variables d'environnement du systeme gardent la priorite finale.

## Topologie de reference
- App publique : `app.laboratoire.free-surf237-4all.xyz`
- Panel Remnawave : `laboratoire.free-surf237-4all.xyz`
- Subscription : `sub.laboratoire.free-surf237-4all.xyz`

## Etat infra verifie
Modules actifs lors de la verification du 2026-03-29 : `Remnawave`, `SSH`, `SlowDNS/DNSTT`, `Hysteria`, `ZiVPN UDP`.
Modules non actifs a cette date : `Dropbear`, `UDPGW / UDP Custom`.
