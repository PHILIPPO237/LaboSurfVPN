from __future__ import annotations

from typing import Any

from app.core.engines.base import EngineProvider, VPNConfig


# Correspondance entre le libelle "protocol" saisi par l'admin dans
# /admin/servers (texte libre, voir templates/admin-servers.html) et le nom
# technique du moteur enregistre ici. A completer si de nouveaux libelles
# sont ajoutes cote admin.
#
# Hysteria2 pointe vers "xray" (et non un moteur separe) : 3x-ui gere
# desormais Hysteria2 comme inbound natif au meme titre que VLESS/VMess
# (confirme cote 3x-ui en 2026). Le moteur "hysteria2" independant
# (HysteriaEngineProvider, via commande shell) reste disponible sous la cle
# "hysteria2_standalone" pour un deploiement SANS 3x-ui, mais n'est plus la
# cible par defaut.
_PROTOCOL_TO_ENGINE = {
    "vless/xhttp": "xray",
    "vless/ws": "xray",
    "vless": "xray",
    "vmess": "xray",
    "xray": "xray",
    "hysteria2": "xray",
    "hysteria": "xray",
    "hysteria2 (standalone)": "hysteria2_standalone",
    "slowdns": "slowdns",
    "dnstt": "dnstt",
    "zivpn udp": "zivpn_udp",
    "zivpn": "zivpn_udp",
    "ssh/dropbear": "ssh_dropbear",
    "ssh": "ssh_dropbear",
    "dropbear": "ssh_dropbear",
    "slowdns+vless": "hybrid_slowdns_xray",
    "slowdns+xray": "hybrid_slowdns_xray",
    "dnstt+vless": "hybrid_dnstt_xray",
    "dnstt+xray": "hybrid_dnstt_xray",
    "ssh+vless": "hybrid_ssh_xray",
    "ssh+xray": "hybrid_ssh_xray",
}


class VPNOrchestrator:
    """Point d'entree unique pour tout ce qui concerne le choix et l'usage
    d'un moteur VPN. Le reste de l'application (routers, app Labo Surf) ne
    doit jamais appeler un provider ou construire une config directement --
    seulement passer par ici.

    Ajouter un nouveau moteur plus tard = creer sa classe EngineProvider et
    l'ajouter au dict `providers` a la construction (voir main.py). Rien
    d'autre a modifier dans l'orchestrateur ni dans les routers.
    """

    def __init__(
        self,
        *,
        providers: dict[str, EngineProvider],
        servers_repo: Any = None,
        default_engine: str = "xray",
    ) -> None:
        self.providers = dict(providers or {})
        self.servers_repo = servers_repo
        self.default_engine = default_engine

    def _engine_name_for_server(self, server: dict[str, Any]) -> str:
        protocol = str(server.get("protocol", "") or "").strip().lower()
        return _PROTOCOL_TO_ENGINE.get(protocol, self.default_engine)

    def _candidate_engine_names(self, server: dict[str, Any]) -> list[str]:
        """Liste ordonnee des moteurs a essayer pour ce serveur. Si
        `capabilities` est renseigne (plusieurs protocoles possibles, ex:
        "VLESS/XHTTP,Hysteria2"), chacun est essaye dans l'ordre jusqu'a en
        trouver un de reellement configure -- sinon repli sur l'ancien champ
        `protocol` (un seul, comportement historique)."""
        raw_capabilities = str(server.get("capabilities", "") or "").strip()
        if raw_capabilities:
            names = []
            for label in raw_capabilities.split(","):
                label = label.strip().lower()
                if not label:
                    continue
                mapped = _PROTOCOL_TO_ENGINE.get(label)
                if mapped and mapped not in names:
                    names.append(mapped)
            if names:
                return names
        return [self._engine_name_for_server(server)]

    def _resolve_provider(self, engine_name: str) -> EngineProvider | None:
        provider = self.providers.get(engine_name)
        if provider is not None and provider.is_configured():
            return provider
        # Repli propre : si le moteur demande n'est pas disponible, on retombe
        # sur le moteur par defaut plutot que de faire echouer la connexion --
        # tant qu'il reste au moins un moteur fonctionnel (Xray aujourd'hui).
        fallback = self.providers.get(self.default_engine)
        if fallback is not None and fallback.is_configured():
            return fallback
        return None

    def get_config_for_user(self, user: dict[str, Any], *, server_id: int | str | None = None) -> VPNConfig:
        """Construit la configuration de connexion pour cet utilisateur.

        Si `server_id` n'est pas fourni (compatibilite avec les appelants
        existants qui ne connaissent pas encore la notion de serveur, ex:
        anciens appels a build_user_configs), le comportement historique est
        preserve : moteur par defaut (Xray), sans serveur precis."""
        server: dict[str, Any] = {}
        if server_id and self.servers_repo is not None and callable(getattr(self.servers_repo, "get_by_id", None)):
            found = self.servers_repo.get_by_id(server_id)
            if isinstance(found, dict):
                server = found

        if not server:
            provider = self._resolve_provider(self.default_engine)
            if provider is None:
                raise RuntimeError("Aucun moteur VPN disponible.")
            return provider.build_config(user, server)

        # Essaie chaque capacite declaree pour ce serveur, dans l'ordre, et
        # s'arrete a la premiere reellement configuree -- avant de retomber
        # sur le moteur par defaut si AUCUNE des capacites du serveur n'est
        # disponible.
        for engine_name in self._candidate_engine_names(server):
            candidate = self.providers.get(engine_name)
            if candidate is not None and candidate.is_configured():
                return candidate.build_config(user, server)

        fallback = self.providers.get(self.default_engine)
        if fallback is not None and fallback.is_configured():
            return fallback.build_config(user, server)

        raise RuntimeError(f"Aucun moteur VPN disponible pour le serveur {server.get('id')!r}.")

    def ensure_user_everywhere(self, user: dict[str, Any], *, reason: str = "") -> dict[str, Any] | None:
        """Provisionne l'utilisateur sur tous les moteurs configures.
        Remplace _collect_transport_action (app/routers/auth.py) : meme
        comportement (on provisionne partout ou c'est configure), mais via
        l'interface commune plutot qu'un tuple fige en dur -- ajouter un
        moteur dans `providers` suffit, aucun autre fichier a toucher."""
        items: list[dict[str, Any]] = []
        for provider in self.providers.values():
            if not provider.is_configured():
                continue
            result = provider.ensure_user(user, reason=reason)
            payload = result.as_dict() if hasattr(result, "as_dict") else result
            if isinstance(payload, dict) and bool(payload.get("configured", False)):
                items.append(payload)
        if not items:
            return None
        return {"configured": True, "ok": all(bool(i.get("ok", False)) for i in items), "items": items}

    def disable_user_everywhere(self, user: dict[str, Any], *, reason: str = "") -> dict[str, Any] | None:
        items: list[dict[str, Any]] = []
        for provider in self.providers.values():
            if not provider.is_configured():
                continue
            result = provider.disable_user(user, reason=reason)
            payload = result.as_dict() if hasattr(result, "as_dict") else result
            if isinstance(payload, dict) and bool(payload.get("configured", False)):
                items.append(payload)
        if not items:
            return None
        return {"configured": True, "ok": all(bool(i.get("ok", False)) for i in items), "items": items}

    def health_report(self) -> list[dict[str, Any]]:
        """Vue de sante unifiee, tous moteurs confondus -- remplace la double
        source (transports/ pour la sante, provisioning.py pour l'action) par
        un seul point d'entree, comme demande en P1. Utilisable directement
        par le dashboard admin (/admin/config-generator)."""
        report: list[dict[str, Any]] = []
        for engine_name, provider in self.providers.items():
            configured = provider.is_configured()
            healthy, message = provider.is_healthy()
            report.append({
                "engine": engine_name,
                "label": getattr(provider, "label", engine_name),
                "configured": configured,
                "healthy": healthy,
                "message": message,
            })
        return report
