from __future__ import annotations

import base64
import json
import uuid
from typing import Any, Callable
from urllib.parse import quote

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.provisioning import ProvisioningResult, XUIProvisioner


class XrayEngineProvider(EngineProvider):
    """Enveloppe XUIProvisioner (deja existant, deja fonctionnel) derriere
    l'interface EngineProvider commune, et ajoute build_config().

    3x-ui gere plusieurs protocoles Xray sur des inbounds differents (VLESS,
    VMess, et desormais Hysteria2 -- confirme cote 3x-ui en 2026). Ce moteur
    genere donc le bon format selon `server['protocol']`, plutot que de
    supposer VLESS pour tout le monde comme avant cette mission."""

    engine_name = "xray"
    label = "Xray / 3x-ui"

    def __init__(
        self,
        *,
        cfg: Any,
        xui_provisioner: XUIProvisioner,
        generate_uuid: Callable[[], str] | None = None,
    ) -> None:
        self.cfg = cfg
        self._xui = xui_provisioner
        self._generate_uuid = generate_uuid

    def is_configured(self) -> bool:
        return bool(self._xui and self._xui.enabled and self._xui._configured())

    def is_healthy(self) -> tuple[bool | None, str]:
        if not self.is_configured():
            return False, "Xray/3x-ui : non configure."
        try:
            status = self._xui.action_status()
        except Exception as exc:
            return None, f"Xray/3x-ui : verification impossible ({exc})."
        if bool(status.get("configured")):
            return True, "Xray/3x-ui : configure et accessible."
        return False, str(status.get("message", "Xray/3x-ui : etat inconnu."))

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._xui.ensure_user(user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._xui.disable_user(user, reason=reason)

    def _ensure_user_uuid(self, user: dict[str, Any], *, users_repo: Any) -> str:
        current = str(user.get("uuid_secondary", "") or "").strip()
        if current:
            return current
        generated = ""
        if callable(self._generate_uuid):
            try:
                generated = str(self._generate_uuid() or "").strip()
            except Exception:
                generated = ""
        generated = generated or str(uuid.uuid4())
        user["uuid_secondary"] = generated
        saver = getattr(users_repo, "save", None)
        if callable(saver):
            try:
                saved = saver(dict(user))
                if isinstance(saved, dict):
                    return str(saved.get("uuid_secondary", "") or generated).strip() or generated
            except Exception:
                pass
        return generated

    def _resolve_user_uuid(self, user: dict[str, Any]) -> str:
        user_type = str(user.get("type", "Gratuit") or "Gratuit").strip()
        is_admin = user_type == "ADMIN"
        primary_uuid = str(getattr(self.cfg, "PRIMARY_3XUI_UUID", "") or "").strip()
        return primary_uuid if (is_admin and primary_uuid) else str(user.get("uuid_secondary", "") or "").strip()

    def _resolve_connection_params(self, server: dict[str, Any]) -> dict[str, Any]:
        host = str(
            server.get("host")
            or getattr(self.cfg, "vps_address", "")
            or getattr(self.cfg, "PANEL_DEFAULT_HOST", "")
            or getattr(self.cfg, "XUI_PUBLIC_IP", "")
            or "127.0.0.1"
        ).strip()
        sni = str(server.get("sni") or getattr(self.cfg, "PANEL_DEFAULT_HOST", "") or host).strip()
        port = int(server.get("port") or getattr(self.cfg, "vps_port", 443) or 443)
        path = str(server.get("path") or getattr(self.cfg, "vps_path", "") or getattr(self.cfg, "DEFAULT_VLESS_PATH", "") or "/").strip() or "/"
        return {"host": host, "sni": sni, "port": port, "path": path}

    def _resolve_transport(self, server: dict[str, Any]) -> str:
        """Detecte le transport reel a partir du protocole choisi pour CE
        serveur (ex: 'VLESS/XHTTP' -> xhttp, 'VLESS/WS' -> ws). Avant ce
        correctif, le transport etait fige sur 'ws' quoi qu'on choisisse --
        un serveur "VLESS/XHTTP" generait en realite une config WS, ce qui
        est faux et ne fonctionne pas avec un client configure en XHTTP."""
        protocol = str(server.get("protocol", "") or "").strip().lower()
        if "xhttp" in protocol:
            return "xhttp"
        if "grpc" in protocol:
            return "grpc"
        return "ws"

    def _build_vless(self, *, user_uuid: str, remark: str, conn: dict[str, Any], transport: str, allow_insecure: bool) -> VPNConfig:
        params = {
            "encryption": "none", "security": "tls", "type": transport,
            "path": conn["path"], "host": conn["sni"], "sni": conn["sni"],
        }
        if allow_insecure:
            params["allowInsecure"] = "1"
        query = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in params.items())
        uri = f"vless://{quote(user_uuid, safe='')}@{conn['host']}:{conn['port']}?{query}#{quote(remark, safe='')}"
        return VPNConfig(
            engine=self.engine_name, protocol="VLESS", transport=transport,
            server_id="", user_id="", credentials={"uuid": user_uuid},
            parameters={**conn, "tls": True, "allow_insecure": allow_insecure}, uri=uri,
        )

    def _build_vmess(self, *, user_uuid: str, remark: str, conn: dict[str, Any], transport: str, allow_insecure: bool) -> VPNConfig:
        payload = {
            "v": "2", "ps": remark, "add": conn["host"], "port": str(conn["port"]),
            "id": user_uuid, "aid": "0", "scy": "auto", "net": transport,
            "type": "none", "host": conn["sni"], "path": conn["path"],
            "tls": "tls", "sni": conn["sni"],
        }
        if allow_insecure:
            payload["allowInsecure"] = "1"
        encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
        uri = f"vmess://{encoded}"
        return VPNConfig(
            engine=self.engine_name, protocol="VMess", transport=transport,
            server_id="", user_id="", credentials={"uuid": user_uuid},
            parameters={**conn, "tls": True, "allow_insecure": allow_insecure}, uri=uri,
        )

    def _build_hysteria2(self, *, user_uuid: str, remark: str, conn: dict[str, Any]) -> VPNConfig:
        # Hysteria2 gere via 3x-ui (inbound natif) : l'authentification se fait
        # par mot de passe, pas par UUID -- on reutilise l'UUID de l'utilisateur
        # comme secret d'auth (comportement 3x-ui standard pour cet inbound).
        uri = f"hysteria2://{quote(user_uuid, safe='')}@{conn['host']}:{conn['port']}?sni={quote(conn['sni'], safe='')}#{quote(remark, safe='')}"
        return VPNConfig(
            engine=self.engine_name, protocol="Hysteria2", transport="udp",
            server_id="", user_id="", credentials={"auth": user_uuid},
            parameters={"host": conn["host"], "port": conn["port"], "sni": conn["sni"]}, uri=uri,
        )

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        user_type = str(user.get("type", "Gratuit") or "Gratuit").strip()
        user_uuid = self._resolve_user_uuid(user)
        conn = self._resolve_connection_params(server)
        remark = f"{user_type}-{server.get('name', 'MAIN')}"
        transport = self._resolve_transport(server)
        allow_insecure = bool(server.get("allow_insecure", False))

        protocol = str(server.get("protocol", "") or "").strip().lower()
        if "vmess" in protocol:
            result = self._build_vmess(user_uuid=user_uuid, remark=remark, conn=conn, transport=transport, allow_insecure=allow_insecure)
        elif "hysteria" in protocol:
            result = self._build_hysteria2(user_uuid=user_uuid, remark=remark, conn=conn)
        else:
            result = self._build_vless(user_uuid=user_uuid, remark=remark, conn=conn, transport=transport, allow_insecure=allow_insecure)

        result.server_id = str(server.get("id", "") or "")
        result.user_id = str(user.get("id", "") or "")
        return result
