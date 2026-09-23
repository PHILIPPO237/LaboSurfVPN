# CHANGELOG — LaboSurfVPN

Application Android « LaboSurfVPN » — **seul dépôt PUBLIC** de l'écosystème LABOSURF. Versions listées d'après les messages de commit, au plus près du code réel.

> Statut de publication : la seule release présente sur GitHub est `v1.0.0-test.1` (test uniquement, **non présentée comme version finale**). Les travaux postérieurs (UDM/design) n'ont pas de release.

## Non publié (après `v1.0.0-test.1` — branche `phase7-udp-real`)

> Aucune version finale n'a été publiée pour ces travaux. Le build APK nécessite un environnement Android (Gradle + SDK), non disponible sur la machine de la mission. `versionCode=1`, `versionName="1.0.0"` (build.gradle.kts) restent conceptuels tant que l'APK n'est pas validé.

- `50aa75a` feat(client): LaboSurfVPN devient un client réel de `POST /api/user/connect`
- `98dedf2` feat(udp): moteur UDP LABOSURF réel dans l'APK (client Kotlin, VpnService, vérification du chemin)
- `9c02c7f` docs+ui: statut E2E réel, pointeur super-admin, textes honnêtes (tunnel UDP non chiffré « non sécurisé »)
- `cf41d28` style(ui): identité premium sobre — noir profond, émeraude sombre, vert lumineux mesuré, touches or
- `c8229e8` design v3 — nouvelle palette sombre, halos d'ambiance, harmonisation couleurs (cartes, barres système)
- `d879ba7` test(theme): invariants indépendants de la palette
- `8f97e85` chore: normalisation des fins de ligne (LF global via `.gitattributes` `text=auto`)
- `5eb8da5` docs: `PROJECT_RELEASE_STATUS.md`

## ci (phase 5) — infrastructure de test, non versé dans main, non publié

- `b64e3ec` build(android): CI APK debug (tests JS, vérification de l'APK, test sur émulateur)
- `b701b2f`/`69b365b` ci: tests JS réparés (Node 22, setup-android v4, paquets SDK fixés)
- `8fed381`, `bb3faa1`, `274fb1c` ci: rapport du test émulateur en une annotation, bytecode vérifié, YAML corrigé (CRL)
- `0f49ab2`, `ce0977f`, `ab879d9`, `febe8fa` ci: émulateur AOSP (sans services Google), logcat continu, smoke robuste ; essai émulateur API 34 (l'émulateur s'arrête au premier socket UDP protégé)

## `v1.0.0-test.1` — 2026-09-20 (test uniquement)

- Ancre : `274fb1c` (branche `phase5-vpn-client-integration`). Release GitHub avec asset `app-debug.apk` — **test CI uniquement, pas une version livrée**.
- Point de départ de la phase 5 : `64af515` (travail d'interface déjà présent dans l'arbre, non commité auparavant).

## historique `main` (avant la refonte UI) — résumé

Le `main` (HEAD `23e7023`, fast-forward le 2026-09-20) contient, en plus de la refonte, l'historique applicatif antérieur (non publié en release) :

- `fa7ca0f` 2026-09-20 **Refonte de l'interface** : modules, FR/EN, thème clair/sombre, écran À propos
- `23e7023` 2026-09-20 Animation d'ouverture, thème sombre par défaut, signature du projet, logo fixe
- `5a1e0d1` 2026-08-22 Bannière flottante d'expiration dans l'app
- `3d2140c` 2026-08-20 Récupération de mot de passe dans l'app (sans passer par le site)
- `add0d42` 2026-08-16 Carte « Créer un client » dans l'app revendeur
- `1eb8b4b` 2026-08-16 Annonces diffusées + indicateur justificatif de paiement
- `2b35bce` 2026-08-15 Demandes en attente gérées depuis l'app (valider/rejeter)
- `c9d0dc1` 2026-08-15 Messagerie privée : badge signal, carte messages, factures
- `9b9707d` 2026-08-15 Messagerie privée complète (BDD, API, génération facture PDF automatique, page client)
- `ea99bcb` 2026-08-15 Fix: bannière revendeur jamais transmise (token d'authentification)
- `e038b7a` 2026-08-14 Sessions complètes : Simple/Pro + serveurs réels + renouvellement
- `09a04b3` 2026-08-14 Fix affichage « Illimité » trompeur pour comptes Gratuit
- `8ea7c5c` 2026-08-14 Adresse locale 127.0.0.1 + autorisation réseau pour test

## Notes

- Le message « tunnel UDP non chiffré » est documenté honnêtement dans l'UI. Le moteur UDP n'est pas déclaré « terminé » tant qu'une validation sur environnement réel n'a pas eu lieu.
- Nouvelle release uniquement sur base d'APK testé (jamais sur tag seul).