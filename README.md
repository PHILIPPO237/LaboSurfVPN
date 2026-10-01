# LaboSurfVPN (React Web Edition)

Client web officiel du système **LABOSURF** réécrit en **React + TypeScript + Vite**. Cette application permet à un utilisateur de gérer son compte, souscrire à des offres, consulter et choisir un serveur ou un profil de connexion, et établir/superviser un tunnel VPN.

## 1. Architecture

```
LaboSurfVPN (React Web Edition)
   │  HTTPS + jeton Bearer
   ▼
Laboratoire du Free-Surf  (panel : comptes, abonnements, règles commerciales)
   │  HTTPS + signatures Ed25519
   ▼
labosurf-agent            (API de management de PRO, portées, anti-rejeu)
   │
   ▼
LABOSURF_PRO              (moteurs, Services, Access)
```

LaboSurfVPN communique avec l'API du panel. L'adresse de l'API est configurable dans l'écran **Réglages** (par défaut `https://laboratoire.free-surf237-4all.xyz`, avec support des boucles locales de développement).

## 2. Fonctionnalités portées

- **Navigation principale en rail adaptatif** :
  - Accueil (START / STOP, état en temps réel, chronomètre de session, trafic mesuré, bannière animée avec badges opérateurs MTN / Orange / Camtel).
  - Services (Offres actives, statut d'accès, quotas, serveurs associés).
  - Serveurs & Profils (Recherche par pays/ville, indicateurs de statut et latence en direct, profils de connexion automatiques ou avancés).
  - Mon Profil / Compte :
    - Inscription, connexion avec masquage/affichage de mot de passe, avatar photo.
    - Procédure de récupération / mot de passe oublié en deux étapes.
    - Jauges de jours restants et de quota consommé.
    - Code d'activation (`AK-XXXXXXXXXXXX`) et formulaires de renouvellement / surclassement.
    - Messagerie directe avec le support et annonces officielles du Laboratoire.
    - Sécurité : gestion des sessions/appareils connectés, modification du mot de passe, déconnexion.
    - Espace revendeur (pour les rôles revendeur / administrateur) : création de clients et suivi des demandes.
  - Historique & Activité (Sessions conservées localement avec statut, durée et regroupement par date).
  - Journal & Cache (Rapport diagnostic complet copiable, flux d'événements en direct, purge du cache).
  - Réglages (Bilingue Français / English, thèmes Sombre / Clair / Système, rappels d'expiration).
  - À propos, Communauté Telegram et documents légaux (Conditions d'utilisation et Politique de confidentialité).
  - Guide utilisateur interactif & Assistant FAQ avec recherche instantanée par mots-clés.
  - Parcours de bienvenue (Onboarding) en 4 étapes.

## 3. Développement et exécution

```bash
# Installation des dépendances
npm install

# Démarrage du serveur de développement (port 3000, 0.0.0.0)
npm run dev

# Compilation pour la production
npm run build
```
