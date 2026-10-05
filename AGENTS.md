# AGENTS.md — LaboSurfVPN

Fichier lu par les agents IA (tout outil). Il résume l'essentiel ; la référence complète est la base de connaissance
commune de l'écosystème : **`LABOSURF_PRO/docs/ecosystem/`** (dépôt `PHILIPPO237/LABOSURF_PRO`, ou `../LABOSURF_PRO/docs/ecosystem/` si les dépôts sont clonés côte à côte).
Lire `README.md` de ce dossier, puis `07-REGLES-POUR-AGENTS-IA.md`.

## Ce projet
Application cliente Android. Ne parle qu'au Panel. Un seul moteur côté client : UDP (TUIC n'a pas de code client). Écrans embarqués dans l'APK : tout changement d'écran exige une nouvelle version. Attention : voir `POINTS-OUVERTS.md` (écart entre `main` et la ligne Android).

## L'écosystème en 5 lignes
- 4 projets : **LABOSURF_PRO** (serveur, moteurs, Services/Access, Agent), **Laboratoire du Free-Surf** (Panel : utilisateurs, abonnements, rôles, tokens),
  **LaboSurfVPN** (app Android), **LABOSURF_LICENSE_MAKER** (émet les licences de PRO).
- Chaîne : `LABOSURF_PRO → API/Agent → Panel → API → LaboSurfVPN`. **LaboSurfVPN ne contacte jamais PRO ni l'Agent.**
- Distinguer toujours : Service ≠ Profile ≠ Access ≠ Utilisateur ≠ Token ≠ Licence (la licence ouvre l'installation de PRO, rien d'autre).
- Consommation : PRO mesure → Panel agrège → interfaces affichent. **Inconnu = « indisponible », jamais 0.**
- Isolation des données et permissions : appliquées **côté backend**, jamais seulement dans l'interface.

## Règles impératives
1. Le **code réel** fait foi ; cette doc ne le remplace pas. Vérifier avant de modifier. Ne rien inventer (fichier, API, donnée).
2. **Composants protégés** : moteurs UDP/TUIC en production, TUN/NAT, code Kotlin du tunnel, base de production, clés de licence et de signature.
   Ne pas y toucher sans demande explicite, sauvegarde et retour arrière.
3. Aucun secret dans Git, les journaux, la doc ou une conversation.
4. Travail : `ANALYSE → MODIFICATION → TEST → COMMIT → PUSH → VÉRIFICATION`. **Push GitHub ≠ déploiement VPS.**
5. Ne jamais déclarer « fonctionnel/déployé » sans preuve ; rapporter honnêtement ce qui a échoué ou n'a pas été testé.
6. Pas d'action de production (déploiement, redémarrage, remplacement de binaire, publication) sans autorisation explicite pour cette action.

## Tests de ce projet
`node --test tests/js/*.test.js` et `gradle testDebugUnitTest` (la ligne Android) ; CI `build-apk.yml` / `release-apk.yml` selon la branche.
