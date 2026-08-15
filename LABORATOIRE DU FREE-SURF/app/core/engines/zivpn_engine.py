from __future__ import annotations

from typing import Any

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.engines.health import probe_local_port
from app.core.provisioning import ProvisioningResult, ZiVPNUDPProvisioner


class ZiVPNEngineProvider(EngineProvider):
    """Enveloppe ZiVPNUDPProvisioner (deja existant) et ajoute build_config().
    Avant cette mission, aucune config n'etait jamais generee pour ce moteur --
    seul le provisioning (creation du compte) existait."""

    engine_name = "zivpn_udp"
    label = "ZiVPN UDP"

    def __init__(self, *, cfg: Any, provisioner: ZiVPNUDPProvisioner) -> None:
        self.cfg = cfg
        self._provisioner = provisioner

    def is_configured(self) -> bool:
        return bool(self._provisioner and self._provisioner.enabled)

    def is_healthy(self) -> tuple[bool | None, str]:
        if not self.is_configured():
            return False, "ZiVPN UDP : non configure."
        port = int(getattr(self.cfg, "ZIVPN_UDP_PORT", 5667) or 5667)
        available = probe_local_port(port, kinds=("udp",))
        if available is None:
            return None, "ZiVPN UDP : configure ; verification runtime indisponible sur cet environnement."
        if available:
            return True, "ZiVPN UDP : configure et port local detecte."
        return False, "ZiVPN UDP : configure mais port local non detecte."

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.ensure_user(user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.disable_user(user, reason=reason)

    def _resolve_auth(self, user: dict[str, Any]) -> str:
        password_field = str(
            getattr(self.cfg, "ZIVPN_UDP_PROVISION_PASSWORD_FIELD", "service_password") or "service_password"
        ).strip() or "service_password"
        for field_name in (password_field, "service_password", "license", "username"):
            value = str(user.get(field_name, "") or "").strip()
            if value:
                return value
        return ""

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        host = str(
            server.get("host")
            or getattr(self.cfg, "ZIVPN_UDP_HOST", "")
            or getattr(self.cfg, "UDPGW_HOST", "")
            or getattr(self.cfg, "vps_address", "")
            or ""
        ).strip()
        sni = str(server.get("sni") or getattr(self.cfg, "ZIVPN_UDP_SNI", "") or host).strip()
        port = int(server.get("port") or getattr(self.cfg, "ZIVPN_UDP_PUBLIC_PORT", 0) or getattr(self.cfg, "ZIVPN_UDP_PORT", 5667) or 5667)
        auth = self._resolve_auth(user)
        remark = f"{user.get('type', 'Gratuit')}-{server.get('name', 'ZIVPN')}"

        payload = [f"type=zivpn_udp_manual", f"server={host}", f"port={port}", f"auth={auth}"]
        if sni:
            payload.append(f"sni={sni}")
        payload.append(f"remark={remark}")
        manual_string = "; ".join(payload)

        return VPNConfig(
            engine=self.engine_name,
            protocol="ZiVPN UDP",
            transport="udp",
            server_id=str(server.get("id", "") or ""),
            user_id=str(user.get("id", "") or ""),
            credentials={"auth": auth},
            parameters={"host": host, "port": port, "sni": sni},
            uri=manual_string,
        )
