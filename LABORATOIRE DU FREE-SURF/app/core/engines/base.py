from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from app.core.provisioning import ProvisioningResult


@dataclass(slots=True)
class VPNConfig:
    """Modele de configuration unifie, independant de tout moteur particulier.

    C'est ce que l'orchestrateur retourne, quel que soit le moteur choisi.
    Le Web (et l'app Labo Surf via /api/user/connect) ne manipulent QUE cet
    objet -- jamais directement une URI VLESS ou une commande SlowDNS.
    """

    engine: str
    protocol: str
    transport: str
    server_id: str
    user_id: str
    credentials: dict[str, Any] = field(default_factory=dict)
    parameters: dict[str, Any] = field(default_factory=dict)
    uri: str = ""  # forme finale prete a coller dans un client (quand applicable, ex: VLESS)

    def as_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "protocol": self.protocol,
            "transport": self.transport,
            "server_id": self.server_id,
            "user_id": self.user_id,
            "credentials": dict(self.credentials),
            "parameters": dict(self.parameters),
            "uri": self.uri,
        }


class EngineProvider(ABC):
    """Interface commune que chaque moteur (Xray/3x-ui, Hysteria2, SlowDNS,
    DNSTT, ZiVPN UDP, SSH/Dropbear, ...) doit implementer reellement -- pas
    par duck-typing comme avant, mais par heritage explicite de cette classe.

    Toute nouvelle addition de moteur = une nouvelle classe qui herite de
    EngineProvider, enregistree dans VPNOrchestrator. Rien d'autre a modifier
    dans le reste de l'application (voir app/core/vpn_orchestrator.py).
    """

    engine_name: str = ""
    label: str = ""

    @abstractmethod
    def is_configured(self) -> bool:
        """True si ce moteur a tout ce qu'il faut (hote, identifiants, etc.)
        pour etre utilise reellement. Un moteur non configure ne doit jamais
        etre propose a un utilisateur, meme si un serveur le reference."""
        raise NotImplementedError

    def is_healthy(self) -> tuple[bool | None, str]:
        """Sante RUNTIME (pas juste "configure") : (etat, message).
        etat = True (sain), False (probleme detecte), None (impossible a
        verifier depuis cet environnement -- ex: moteur sur un autre serveur).
        Implementation par defaut : un moteur non configure n'est jamais sain ;
        un moteur configure sans verification runtime disponible est presume
        sain. Chaque engine peut surcharger avec une vraie sonde (voir
        app/core/engines/health.py::probe_local_port), comme le faisait avant
        l'ancienne couche app/core/transports/ (desormais fusionnee ici)."""
        if not self.is_configured():
            return False, f"{self.label or self.engine_name} : non configure."
        return None, f"{self.label or self.engine_name} : configure (verification runtime non implementee pour ce moteur)."

    @abstractmethod
    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        """Cree/active le compte cote infrastructure pour ce moteur."""
        raise NotImplementedError

    @abstractmethod
    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        """Desactive le compte cote infrastructure pour ce moteur."""
        raise NotImplementedError

    @abstractmethod
    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        """Construit la configuration de connexion (VPNConfig unifie) pour cet
        utilisateur sur ce serveur precis. C'est la piece qui manquait avant
        cette mission : avant, seul Xray savait faire ca (en dur, pour tout
        le monde) ; maintenant chaque moteur sait construire SA config."""
        raise NotImplementedError
