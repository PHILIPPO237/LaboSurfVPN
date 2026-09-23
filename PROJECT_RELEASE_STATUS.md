# PROJECT_RELEASE_STATUS — LaboSurfVPN

Mise à jour : **2026-09-23** (mission synchronisation globale GitHub + releases).

## Identité

| Champ | Valeur |
|---|---|
| Dépôt | `PHILIPPO237/LaboSurfVPN` |
| Visibilité | **PUBLIC** (seul dépôt public de l'écosystème — décision utilisateur) |
| Clone | `C:\Users\atsan\OneDrive\Bureau\LaboSurfVPN` |
| Branche stable | `main` = origin (`23e7023`) |
| Branche de travail | `phase7-udp-real` (HEAD `5d5ee9f`, = origin) |
| Branche de sauvegarde | `backup/pre-global-sync-20260923` (`c8229e8`) |
| Worktree | propre |

## Releases GitHub

| Tag | Statut |
|---|---|
| `v1.0.0-test.1` | release GitHub sur `274fb1c`, asset `app-debug.apk` — **TEST uniquement, non présentée comme version finale** |

## État de synchronisation (phase 3 accomplie)

- `main` poussé en fast-forward `5a1e0d1..23e7023` (2 commits de refonte UI, vérifiés sans secret/binaire).
  - `fa7ca0f` Refonte interface : modules, FR/EN, thèmes clair/sombre, écran À propos
  - `23e7023` Animation d'ouverture, thème sombre par défaut, signature du projet, logo fixe
- **8 fichiers marqués modifiés → 100% CRLF/LF, aucun changement de contenu** (même cause que le panel). Normalisation appliquée : `.gitattributes` étendu (`* text=auto`), commit `8f97e85` poussé sur `phase7-udp-real`.
- Config locale corrigée : `remote.origin.fetch` ajouté ; refs distantes locales synchronisées.
- Branch `phase7-udp-real` = origin.
- `CHANGELOG.md` ajouté (factuel : `v1.0.0-test.1` + travaux non publiés, historique main).

## Travail NON publié / contraintes

- **Build/tests APK non exécutés** : pas de wrapper Gradle dans le dépôt, pas de Gradle ni de SDK Android sur cette machine. La phase 3 prévoyait « test/build APK » — non réalisable ici, à exécuter sur l'environnement de build Android de l'auteur.
- `versionCode=1`, `versionName="1.0.0"` (build.gradle.kts) : « 1.0.0 » est conceptuel, la seule release réelle est `v1.0.0-test.1`.
- Sur 18 commits d'avance de `phase7-udp-real` sur `main` : le moteur UDP natif et le design v3 n'ont pas de release publique. **Ne pas créer de release v1.x tant que build/test APK n'est pas validé.**

## Prochaines étapes (hors mission ou à confirmer)

1. Construire et tester l'APK (wrapper Gradle ou SDK), puis sabler `versionCode`/`versionName`.
2. Fusionner ou non `phase7-udp-real` dans `main` après validation (aucune fusion automatique).
3. Publier une release uniquement sur base d'APK testé (ex. v1.0.0 réelle), jamais sur tag seul.