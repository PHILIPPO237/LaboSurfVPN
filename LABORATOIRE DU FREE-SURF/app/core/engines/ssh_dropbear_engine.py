from __future__ import annotations

from typing import Any

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.engines.health import probe_local_port
from app.core.provisioning import ProvisioningResult, SSHDropbearProvisioner


class SSHDropbearEngineProvider(EngineProvider):
    """Enveloppe SSHDropbearProvisioner (deja existant) et ajoute
    build_config() -- identifiants de connexion SSH/Dropbear standards."""

    engine_name = "ssh_dropbear"
    label = "SSH / Dropbear"

    def __init__(self, *, cfg: Any, provisioner: SSHDropbearProvisioner) -> None:
        self.cfg = cfg
        self._provisioner = provisioner

    def is_configured(self) -> bool:
        return bool(self._provisioner and self._provisioner.enabled)

    def is_healthy(self) -> tuple[bool | None, str]:
        if not self.is_configured():
            return False, "SSH/Dropbear : non configure."
        port = int(getattr(self.cfg, "DROPBEAR_PORT", 0) or getattr(self.cfg, "SSH_PORT", 22) or 22)
        available = probe_local_port(port, kinds=("tcp",))
        if available is None:
            return None, "SSH/Dropbear : configure ; verification runtime indisponible sur cet environnement."
        if available:
            return True, "SSH/Dropbear : configure et port local detecte."
        return False, "SSH/Dropbear : configure mais port local non detecte."

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.ensure_user(user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._provisioner.disable_user(user, reason=reason)

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        default_host = str(getattr(self.cfg, "PANEL_DEFAULT_HOST", "") or "").strip()
        host = str(server.get("host") or getattr(self.cfg, "SSH_HOST", "") or default_host).strip()
        port = int(server.get("port") or getattr(self.cfg, "DROPBEAR_PORT", 0) or getattr(self.cfg, "SSH_PORT", 22) or 22)
        ssh_user = str(user.get("username", "") or "").strip()
        ssh_pass = str(user.get("service_password", "") or "").strip()

        config_text = "\n".join([
            f"Host={host}",
            f"Port={port}",
            f"User={ssh_user}",
            f"Pass={ssh_pass}",
        ])

        return VPNConfig(
            engine=self.engine_name,
            protocol="SSH/Dropbear",
            transport="tcp",
            server_id=str(server.get("id", "") or ""),
            user_id=str(user.get("id", "") or ""),
            credentials={"username": ssh_user, "password": ssh_pass},
            parameters={"host": host, "port": port},
            uri=config_text,
        )
