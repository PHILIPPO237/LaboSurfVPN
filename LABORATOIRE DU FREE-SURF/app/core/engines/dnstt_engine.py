from __future__ import annotations

from typing import Any

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.engines.health import probe_local_port
from app.core.provisioning import DNSTTProvisioner, ProvisioningResult


class DNSTTEngineProvider(EngineProvider):
    """Enveloppe DNSTTProvisioner -- desormais un vrai moteur distinct de
    SlowDNS (variables de config propres : DNSTT_SERVER_HOST, DNSTT_DOMAIN,
    DNSTT_PORT, etc.). Reste "non configure" (is_configured() == False) tant
    que DNSTT_PROVISION_ENABLED n'est pas active dans .env avec un vrai
    binaire dnstt-server deploye -- exactement le meme principe que les
    autres moteurs de ce projet (Hysteria2, SlowDNS...), qui sont eux aussi
    inertes tant qu'ils ne sont pas explicitement configures."""

    engine_name = "dnstt"
    label = "DNSTT"

    def __init__(self, *, cfg: Any, provisioner: DNSTTProvisioner) -> None:
        self.cfg = cfg
        self._provisioner = provisioner

    def is_configured(self) -> bool:
        return bool(self._provisioner and self._provisioner.enabled)

    def is_healthy(self) -> tuple[bool | None, str]:
        if not self.is_configured():
            return False, "DNSTT : non configure."
        port = int(getattr(self.cfg, "DNSTT_PORT", 5300) or 5300)
        available = probe_local_port(port, kinds=("udp",))
        if available is None:
            return None, "DNSTT : configure ; verification runtime indisponible sur cet environnement."
        if available:
            return True, "DNSTT : configure et port local detecte."
        return False, "DNSTT : configure mais port local non detecte."

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.ensure_user(user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.disable_user(user, reason=reason)

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        default_host = str(getattr(self.cfg, "PANEL_DEFAULT_HOST", "") or "").strip()
        ns_host = str(server.get("ns_host") or getattr(self.cfg, "DNSTT_NS_HOST", "") or "").strip()
        domain = str(server.get("host") or getattr(self.cfg, "DNSTT_DOMAIN", "") or default_host).strip()
        pubkey = str(getattr(self.cfg, "DNSTT_PUBKEY", "") or "").strip()
        port = int(server.get("port") or getattr(self.cfg, "DNSTT_PORT", 5300) or 5300)
        local_port = int(getattr(self.cfg, "DNSTT_LOCAL_PORT", 7001) or 7001)

        config_text = "\n".join([
            "[DNSTT]",
            f"NameServer={ns_host}",
            f"Domain={domain}",
            f"PublicKey={pubkey}",
            f"Port={port}",
            f"LocalPort={local_port}",
        ])

        return VPNConfig(
            engine=self.engine_name,
            protocol="DNSTT",
            transport="dns",
            server_id=str(server.get("id", "") or ""),
            user_id=str(user.get("id", "") or ""),
            credentials={},
            parameters={"ns_host": ns_host, "domain": domain, "port": port, "local_port": local_port},
            uri=config_text,
        )
