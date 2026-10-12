# LaboSurfVPN — tous les moteurs dans l'application (architecture)

Statut : **plan validé par le propriétaire le 2026-10-12** (« architecture client découplée, pilotée par le Panel ;
meilleure technologie par moteur ; tout en une version »). Ce document décrit ce qui est construit et pourquoi.

## 1. Règle d'architecture (inchangée)

```
LABOSURF_PRO ──► API / Agent ──► Panel ──► API ──► LaboSurfVPN
```

* LaboSurfVPN ne parle **qu'au Panel**. Il ne connaît ni PRO, ni l'Agent, ni leur code (aucune dépendance de compilation
  vers le dépôt LABOSURF_PRO).
* Le Panel fournit, pour le profil choisi, une **configuration cliente complète** émise par PRO
  (`POST /api/user/connect` → `config`) : moteur, lien, et pour les moteurs qui en ont besoin un **profil structuré**
  (ex. clé privée SSH, payload HTTP). L'application ne fabrique et ne devine aucun paramètre.
* L'application choisit **l'adaptateur** du moteur reçu ; un moteur sans adaptateur est refusé proprement
  (`unsupported_protocol`), jamais simulé.

## 2. Adaptateurs Android : technologie retenue par moteur

| Moteur (Panel) | Adaptateur | Technologie | Licence | Pourquoi |
|---|---|---|---|---|
| `udp` | Kotlin existant (`udp/`) | code LABOSURF | privé | **inchangé** (composant protégé, validé sur téléphone) |
| `xray` (11 variantes VLESS) | cœur Go `labocore` | **Xray-core** embarqué | MPL-2.0 | seule implémentation de XHTTP et REALITY identique au serveur |
| `hysteria2` | `labocore` | **apernet/hysteria** (client officiel) | MIT | client de référence du protocole |
| `wireguard` | `labocore` | **wireguard-go** sur l'interface TUN | MIT | même pile que l'application WireGuard officielle |
| `tuic` | `labocore` | client TUIC v5 LABOSURF sur **quic-go** | MIT (quic-go) | aucun client Go non-GPL n'existe ; protocole documenté |
| `ssh`, `shssl`, `sshhttp` | `labocore` | **golang.org/x/crypto/ssh** + TLS / payload HTTP fourni par le Panel | BSD | redirections `direct-tcpip` ; exige le changement PRO §4 |

Le trafic de l'interface TUN est remis aux adaptateurs « proxy » (Xray, Hysteria2, TUIC, SSH) par une pile TCP/IP
utilisateur (**tun2socks** de xjasonlyu, MIT, basé sur gVisor). WireGuard prend l'interface TUN directement.
Aucune bibliothèque GPL : le code de l'application reste privé.

Exclus, avec la raison (affichés « non pris en charge », jamais simulés) :

* `dnstt`, `slowdns` (et les hybrides qui en dépendent) : protocoles maison dont les données descendantes ne passent
  pas par un résolveur DNS (limite PRO `downstream_not_via_resolver`) : un client ne pourrait les joindre qu'en direct sur
  53/udp, ce qui n'est pas un tunnel DNS. À revoir côté serveur avant tout client.
* `hysteria` (maison) : aucun client n'existe et le moteur n'est pas installé.
* `freeway-gate` : relais HTTP sans notion d'abonné, pas un moteur VPN.

## 3. Cœur `labocore` (Go, `core/` de ce dépôt, compilé en AAR par gomobile en CI)

API exposée à Kotlin :

* `Start(engine, configJSON, tunFd, mtu, protector)` — démarre l'adaptateur du moteur sur l'interface TUN déjà établie
  par `VpnService` ; `protector.Protect(fd)` appelle `VpnService.protect` pour que les sockets sortants contournent le TUN.
* `Stop()`, `Stats()` (octets réellement passés), `Engines()` (moteurs réellement compilés : c'est ce que l'application
  annonce au Panel).

Tests : chaque adaptateur est testé en CI Linux contre un **vrai serveur** (binaires officiels épinglés par SHA-256, ou
serveur Go en mémoire pour SSH et WireGuard) : octets relayés dans les deux sens.

## 4. Changements nécessaires hors de l'application

* **LABOSURF_PRO** — serveur SSH (`engines/ssh`, utilisé aussi par `shssl` et `sshhttp`) : accepter les canaux
  `direct-tcpip` des Access authentifiés, vers des destinations **publiques** seulement (boucle locale, réseaux privés et
  métadonnées refusés). Corriger la déclaration du catalogue qui annonçait « tunnel -D vérifié ».
* **Panel** — `POST /api/user/connect` : transmettre le **profil structuré** émis par PRO (`profile`) avec le lien ;
  ajouter `sshhttp` à la table des moteurs ; filtrer les profils proposés selon les moteurs annoncés par l'application.

## 5. Application Android

* `LaboVpnService` : `udp` → chemin Kotlin existant (aucune modification de son code) ; autre moteur → `CoreTunnel`
  (TUN établi par le même `Builder`, puis `labocore.Start`). Même règle d'état : « connecté » seulement après preuve
  (premier échange réel).
* `getEngineInfo()` annonce `udp` + `labocore.Engines()`.

## 6. Ce qui ne peut être prouvé qu'avec un téléphone

Les tests CI prouvent chaque adaptateur contre un vrai serveur ; la chaîne complète (TUN Android → adaptateur → VPS)
ne peut être prouvée que sur un vrai téléphone : une APK de test sera fournie avec une liste de vérifications.
