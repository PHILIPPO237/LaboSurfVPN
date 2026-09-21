# Super-admin — pointeur

Le compte SUPER ADMIN appartient au **Laboratoire du Free-Surf** (pas à LaboSurfVPN, qui n'a aucune fonction d'administration).
La documentation complète et exécutable (nom d'utilisateur initial, définition / changement / récupération du mot de passe, migration de
`.admin_password`, permissions, limites) est dans le dépôt du panel : `docs/SUPER_ADMIN_BOOTSTRAP.md`, branche `phase6-account-admin`
(commit `1431c99`). Résumé :

* Nom d'utilisateur initial : `PHILIPPO237` (ou `FS_ADMIN_USERNAME`). Le compte est créé au démarrage **sans mot de passe** : aucune connexion possible.
* Définir / changer / récupérer le mot de passe, **sur le serveur du panel** : `python -m app.tools.admin_account set-password` (saisie masquée ;
  ou `--password-stdin`). Hash bcrypt uniquement ; aucune copie en clair ; toutes les sessions du super-admin sont fermées.
* `python -m app.tools.admin_account status` : état sans secret. Supprimer ensuite `.admin_password` s'il existe.
* Il n'existe volontairement aucune page web de réinitialisation du super-admin.
* Testé sur la vraie application (base temporaire) : `tests/test_account_admin_e2e.py`, `tests/test_admin_bootstrap.py`.
