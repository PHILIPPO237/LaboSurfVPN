# Panel Access Model V2

## Objectif

Remplacer le champ unique `users.type` par un modele extensible qui separe :

- le role systeme
- le plan commercial
- les permissions reelles
- le panel a afficher

Ce modele couvre les panels actuels :

- Gratuit
- Premium / VIP
- Revendeur
- Administrateur

Et il permet d'ajouter plus tard d'autres panels sans recasser le code.

## **Problème** actuel

Le projet encode trop de decisions dans `users.type` avec des valeurs comme :
Le projet encode trop de **décisions** dans `users.type` avec des valeurs comme :

- `Gratuit`
- `VIP`
- `PREMIUM`
- `Revendeur`
- `ADMIN`

Cette approche pose 4 **problèmes** :

1. le **rôle** et le plan sont **mélangés**
2. les permissions sont implicites et **dispersées** dans les routes
3. `VIP` et `PREMIUM` sont des variantes commerciales proches mais **gérées** comme des types **différents**
4. l'ajout d'un nouveau panel **force à** modifier plusieurs fichiers **à** la main

## **Modèle** cible

Le **modèle** V2 **sépare** 4 notions.

### 1. Role

**Identité système** principale de l'utilisateur.

Valeurs de base :

- `client`
- `reseller`
- `admin`

### 2. Plan

Niveau commercial ou niveau d'abonnement.

Valeurs de base :

- `free`
- `premium`

Plus tard :

- `gold`
- `enterprise`
- `education`
- etc.

### 3. Permission

Capacite technique ou fonctionnelle accordee a un utilisateur.

Exemples :

- `panel.free.view`
- `panel.premium.view`
- `panel.reseller.view`
- `panel.admin.view`
- `configs.generate`
- `payments.create`
- `payments.review`
- `users.manage`
- `users.reseller.manage`
- `scanner.view`
- `scanner.run`
- `ads.manage`
- `chat.moderate`

### 4. Panel key

Cle logique qui designe le dashboard principal a afficher.

Valeurs de base :

- `free`
- `premium`
- `reseller`
- `admin`

Cette cle n'est pas la source d'autorite. C'est une consequence du role + plan + permissions.

## Tables recommandees

### `users`

Conserve l'identite et les informations directes utilisateur.

Champs cibles :

- `id`
- `username`
- `password_hash`
- `status`
- `license`
- `email`
- `phone`
- `avatar`
- `reseller_id`
- `default_panel_key`
- `created_at`
- `updated_at`

Remarque :
- `default_panel_key` sert a l'orientation UI
- l'autorisation reelle reste dans les permissions

### `roles`

- `id`
- `code` : `client`, `reseller`, `admin`
- `label`
- `is_system`

### `plans`

- `id`
- `code` : `free`, `premium`
- `label`
- `rank`
- `is_active`

### `permissions`

- `id`
- `code`
- `label`
- `scope`

### `user_roles`

Relation utilisateur -> role.

- `id`
- `user_id`
- `role_id`
- `assigned_at`
- `assigned_by`

Regle simple recommandee :
- un seul role principal par utilisateur pour commencer
- la table reste relationnelle pour evoluer plus tard

### `user_plans`

Abonnement ou plan actif.

- `id`
- `user_id`
- `plan_id`
- `status` : `active`, `expired`, `cancelled`, `pending`
- `starts_at`
- `ends_at`
- `source` : `manual`, `payment`, `token`, `admin`
- `created_at`
- `updated_at`

### `role_permissions`

Permissions par defaut attachees a un role.

- `id`
- `role_id`
- `permission_id`

### `plan_permissions`

Permissions ajoutees par un plan.

- `id`
- `plan_id`
- `permission_id`

### `user_permissions`

Surcharges explicites par utilisateur.

- `id`
- `user_id`
- `permission_id`
- `granted`
- `reason`
- `expires_at`

Usage :
- accorder une permission **spéciale** temporaire
- retirer une permission **à** un utilisateur **spécifique**

## **Règles** fonctionnelles de base

### Client gratuit

- role : `client`
- plan : `free`
- panel principal : `free`
- permissions minimales :
  - `panel.free.view`
  - `configs.generate.basic`
  - `payments.create`
  - `account.self.view`

### Client premium

- role : `client`
- plan : `premium`
- panel principal : `premium`
- permissions :
  - toutes celles du client gratuit
  - `panel.premium.view`
  - `configs.generate.advanced`
  - `premium.features.view`

### Revendeur

- role : `reseller`
- plan : `premium`
- panel principal : `reseller`
- permissions :
  - `panel.reseller.view`
  - `users.reseller.manage`
  - `payments.reseller.view`
  - `payments.reseller.settings`
  - `configs.generate.advanced`
  - et, selon ton choix produit, acces au panel premium client

### Admin

- role : `admin`
- plan : optionnel ou `premium`
- panel principal : `admin`
- permissions :
  - `panel.admin.view`
  - `users.manage`
  - `payments.review`
  - `scanner.run`
  - `scanner.view`
  - `ads.manage`
  - `chat.moderate`
  - `system.settings.manage`

## Mapping depuis l'existant

Le code actuel utilise surtout `users.type` avec :

- `Gratuit`
- `VIP`
- `PREMIUM`
- `Revendeur`
- `ADMIN`

Mapping V2 recommande :

- `Gratuit` -> role `client`, plan `free`, panel `free`
- `VIP` -> role `client`, plan `premium`, panel `premium`
- `PREMIUM` -> role `client`, plan `premium`, panel `premium`
- `Revendeur` -> role `reseller`, plan `premium`, panel `reseller`
- `ADMIN` -> role `admin`, plan `premium`, panel `admin`

Decision importante :
- `VIP` et `PREMIUM` doivent etre fusionnes fonctionnellement dans V2
- si tu veux garder les deux labels commerciaux, fais-le en affichage seulement, pas dans la logique de droits

## Resolution du panel principal

La logique de resolution du dashboard doit devenir explicite.

Ordre recommande :

1. si permission `panel.admin.view` -> panel `admin`
2. sinon si permission `panel.reseller.view` -> panel `reseller`
3. sinon si permission `panel.premium.view` -> panel `premium`
4. sinon -> panel `free`


- `app/services/panel_service.py`

Et non dans les templates ou dans des `if` disperses.

## Resolution des permissions

Source d'autorite finale :

`permissions effectives = role_permissions + plan_permissions + user_permissions`

Algorithme simple :

1. charger role principal
2. charger plan actif
3. charger permissions du role
4. ajouter permissions du plan
5. appliquer les surcharges utilisateur
6. retirer ce qui est expire ou explicitement revoque

Cette logique doit vivre dans :

- `app/core/permissions.py`
- ou `app/services/access_service.py`

## Guards HTTP recommandes

Le garde actuel `require_access(... allowed_types=...)` doit evoluer vers des permissions.

Exemples :

- `require_permission(request, "panel.free.view")`
- `require_permission(request, "panel.premium.view")`
- `require_permission(request, "panel.reseller.view")`
- `require_permission(request, "panel.admin.view")`

Pour les pages plus complexes :

- `require_any_permission(request, {"panel.premium.view", "panel.reseller.view", "panel.admin.view"})`

## Schema minimal a viser en premier

Pour migrer sans tout casser, il ne faut pas creer 20 tables d'un coup.

Phase 1 minimale :

- garder `users`
- ajouter `role_code` dans `users`
- ajouter `default_panel_key` dans `users`
- creer `plans`
- creer `user_plans`
- creer `permissions`
- creer `role_permissions`
- creer `plan_permissions`

Cette phase suffit deja a sortir la logique d'acces du champ `type`.

## Evolution de `users`

Pendant la transition, `users.type` peut rester comme champ legacy.

Champs transitoires recommandes :

- `type` : legacy
- `role_code` : nouveau
- `default_panel_key` : nouveau

Regle de transition :
- on lit encore `type` si `role_code` est vide
- on backfill progressivement les nouvelles colonnes
- quand tout le code est migre, on supprime `type`

## Exemple de mapping utilisateur

### Utilisateur gratuit

- `users.role_code = "client"`
- `users.default_panel_key = "free"`
- `user_plans.plan = "free"`

### Utilisateur premium

- `users.role_code = "client"`
- `users.default_panel_key = "premium"`
- `user_plans.plan = "premium"`

### Revendeur

- `users.role_code = "reseller"`
- `users.default_panel_key = "reseller"`
- `user_plans.plan = "premium"`
- `users.reseller_id = 0` pour lui-meme

### Admin

- `users.role_code = "admin"`
- `users.default_panel_key = "admin"`
- `user_plans.plan = "premium"` ou vide selon choix metier

## Recommandation concrete pour ton projet

Pour ce projet, la bonne decision est :

- role systeme principal : `client`, `reseller`, `admin`
- plan commercial principal : `free`, `premium`
- panels resolus par permissions
- `VIP` et `PREMIUM` fusionnes en un seul niveau logique `premium`
- compatibilite legacy maintenue tant que `users.type` existe

## Fichiers V2 a creer ensuite

- `app/core/permissions.py`
- `app/services/access_service.py`
- `app/services/panel_service.py`
- `app/schemas/access.py`
- `app/presenters/panel_presenter.py`

## Ordre de migration recommande

1. ajouter les nouveaux champs et tables
2. backfiller les utilisateurs depuis `users.type`
3. creer `access_service` et `panel_service`
4. remplacer `require_access(... allowed_types=...)` par `require_permission(...)`
5. migrer les pages `panel-gratuit`, `panel-vip`, `panel-revendeur`, `admin`
6. supprimer progressivement la logique `type` legacy

## Decision finale

Le meilleur modele pour ton application est :

- role + plan + permission + panel resolver

Et non :

- un simple champ `type`
- ni un `MPV` pur sans couche d'acces
- ni des panels codes en dur partout
