from __future__ import annotations

from typing import Any

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.engines.health import probe_local_port
from app.core.provisioning import ProvisioningResult, SlowDNSProvisioner


class SlowDNSEngineProvider(EngineProvider):
    """Enveloppe SlowDNSProvisioner (deja existant) et ajoute build_config()
    au meme format [SlowDNS]/[SSH] deja produit manuellement dans
    admin-config-generator.html."""

    engine_name = "slowdns"
    label = "SlowDNS"

    def __init__(self, *, cfg: Any, provisioner: SlowDNSProvisioner) -> None:
        self.cfg = cfg
        self._provisioner = provisioner

    def is_configured(self) -> bool:
        return bool(self._provisioner and self._provisioner.enabled)

    def is_healthy(self) -> tuple[bool | None, str]:
        if not self.is_configured():
            return False, "SlowDNS : non configure."
        port = int(getattr(self.cfg, "SLOWDNS_PORT", 53) or 53)
        available = probe_local_port(port, kinds=("udp",))
        if available is None:
            return None, "SlowDNS : configure ; verification runtime indisponible sur cet environnement."
        if available:
            return True, "SlowDNS : configure et port local detecte."
        return False, "SlowDNS : configure mais port local non detecte."

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.ensure_user(user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.disable_user(user, reason=reason)

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        default_host = str(getattr(self.cfg, "PANEL_PUBLIC_HOST", "") or getattr(self.cfg, "PANEL_DEFAULT_HOST", "") or "").strip()
        ns_host = str(server.get("ns_host") or getattr(self.cfg, "SLOWDNS_NS_HOST", "") or "").strip()
        domain = str(server.get("host") or getattr(self.cfg, "SLOWDNS_DOMAIN", "") or default_host).strip()
        pubkey = str(getattr(self.cfg, "SLOWDNS_PUBKEY", "") or "").strip()
        udp_port = int(server.get("port") or getattr(self.cfg, "SLOWDNS_PORT", 53) or 53)
        ssh_host = str(getattr(self.cfg, "SSH_HOST", "") or default_host).strip()
        ssh_port = int(getattr(self.cfg, "SSH_PORT", 22) or 22)
        # Identifiants SSH individualises par utilisateur (meme convention que
        # les autres moteurs bases sur mot de passe de service).
        ssh_user = str(user.get("username", "") or "").strip()
        ssh_pass = str(user.get("service_password", "") or "").strip()

        config_text = "\n".join([
            "[SlowDNS]",
            f"NameServer={ns_host}",
            f"Domain={domain}",
            f"PublicKey={pubkey}",
            f"UDPPort={udp_port}",
            "",
            "[SSH]",
            f"Host={ssh_host}",
            f"Port={ssh_port}",
            f"User={ssh_user}",
            f"Pass={ssh_pass}",
        ])

        return VPNConfig(
            engine=self.engine_name,
            protocol="SlowDNS",
            transport="dns",
            server_id=str(server.get("id", "") or ""),
            user_id=str(user.get("id", "") or ""),
            credentials={"ssh_user": ssh_user, "ssh_pass": ssh_pass},
            parameters={"ns_host": ns_host, "domain": domain, "udp_port": udp_port, "ssh_host": ssh_host, "ssh_port": ssh_port},
            uri=config_text,
        )
