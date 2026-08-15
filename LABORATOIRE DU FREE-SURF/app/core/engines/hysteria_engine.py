from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.engines.health import probe_local_port
from app.core.provisioning import Hysteria2Provisioner, ProvisioningResult


class HysteriaEngineProvider(EngineProvider):
    """Enveloppe Hysteria2Provisioner (deja existant, provisioning par commande
    shell) et ajoute build_config() au format hysteria2:// -- meme format que
    celui deja produit manuellement dans admin-config-generator.html, pour
    rester coherent avec ce que les admins connaissent deja."""

    engine_name = "hysteria2"
    label = "Hysteria2"

    def __init__(self, *, cfg: Any, provisioner: Hysteria2Provisioner) -> None:
        self.cfg = cfg
        self._provisioner = provisioner

    def is_configured(self) -> bool:
        return bool(self._provisioner and self._provisioner.enabled)

    def is_healthy(self) -> tuple[bool | None, str]:
        if not self.is_configured():
            return False, "Hysteria2 : non configure."
        port = int(getattr(self.cfg, "HYSTERIA_PORT", 8443) or 8443)
        available = probe_local_port(port, kinds=("udp",))
        if available is None:
            return None, "Hysteria2 : configure ; verification runtime indisponible sur cet environnement."
        if available:
            return True, "Hysteria2 : configure et port local detecte."
        return False, "Hysteria2 : configure mais port local non detecte."

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.ensure_user(user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.disable_user(user, reason=reason)

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        host = str(
            server.get("host") or getattr(self.cfg, "HYSTERIA_HOST", "") or getattr(self.cfg, "HYSTERIA_IP", "") or ""
        ).strip()
        port = int(server.get("port") or getattr(self.cfg, "HYSTERIA_PORT", 8443) or 8443)
        sni = str(server.get("sni") or getattr(self.cfg, "HYSTERIA_SNI", "") or host).strip()
        # Le mot de passe Hysteria n'est pas encore individualise par utilisateur
        # cote infrastructure (une seule cle partagee, comme deja configuree
        # dans .env) -- meme limite que le generateur manuel existant.
        auth = str(getattr(self.cfg, "HYSTERIA_PASS", "") or "").strip()
        remark = f"{user.get('type', 'Gratuit')}-{server.get('name', 'HY2')}"

        uri = f"hysteria2://{quote(auth, safe='')}@{host}:{port}?sni={quote(sni, safe='')}#{quote(remark, safe='')}"

        return VPNConfig(
            engine=self.engine_name,
            protocol="Hysteria2",
            transport="udp",
            server_id=str(server.get("id", "") or ""),
            user_id=str(user.get("id", "") or ""),
            credentials={"auth": auth},
            parameters={"host": host, "port": port, "sni": sni},
            uri=uri,
        )
