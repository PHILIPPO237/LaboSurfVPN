from __future__ import annotations

import json
from typing import Any

import httpx

from .base import PanelProvider, PanelProviderInfo
from .models import PanelInbound


def _json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    text = value.strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if not isinstance(value, str):
        return []
    text = value.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


class XuiPanelProvider(PanelProvider):
    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        api_token: str = "",
        public_host: str = "",
        timeout_seconds: float = 4.0,
        cache_ttl_seconds: float = 60.0,
    ) -> None:
        super().__init__(
            info=PanelProviderInfo(
                backend_name="3x-ui",
                display_name="3x-ui",
                supports_inbounds=True,
                supports_client_crud=True,
                supports_subscriptions=True,
            ),
            cache_ttl_seconds=cache_ttl_seconds,
        )
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.username = str(username or "").strip()
        self.password = str(password or "").strip()
        self.api_token = str(api_token or "").strip()
        self.public_host = str(public_host or "").strip()
        self.timeout_seconds = max(1.0, float(timeout_seconds or 4.0))

    async def _list_inbounds(self) -> list[PanelInbound]:
        if not self.base_url:
            raise RuntimeError("FS_XUI_URL manquant.")
        if not self.api_token and (not self.username or not self.password):
            raise RuntimeError("FS_XUI_TOKEN ou FS_XUI_USER/FS_XUI_PASS manquants.")

        timeout = httpx.Timeout(self.timeout_seconds, connect=min(3.0, self.timeout_seconds))
        # Le token API (Settings > Security > API Token dans le panel) evite le
        # login par cookie - plus simple et plus rapide. Si absent, on retombe
        # sur l'authentification classique username/password (comportement inchange).
        headers = {"Authorization": f"Bearer {self.api_token}"} if self.api_token else {}
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False, headers=headers) as client:
            if not self.api_token:
                login_attempts = (
                    f"{self.base_url}/login",
                    f"{self.base_url}/panel/login",
                )
                logged = False
                for login_url in login_attempts:
                    try:
                        resp = await client.post(
                            login_url,
                            data={"username": self.username, "password": self.password},
                        )
                    except Exception:
                        continue
                    if resp.status_code < 400:
                        logged = True
                        break
                if not logged:
                    raise RuntimeError("Echec authentification 3x-ui.")

            endpoints = (
                f"{self.base_url}/panel/api/inbounds/list",
                f"{self.base_url}/xui/inbound/list",
                f"{self.base_url}/panel/inbound/list",
            )
            payload: Any = None
            for endpoint in endpoints:
                try:
                    resp = await client.get(endpoint)
                except Exception:
                    continue
                if resp.status_code >= 400:
                    continue
                try:
                    payload = resp.json()
                    break
                except Exception:
                    continue
            if payload is None:
                raise RuntimeError("Impossible de recuperer les inbounds 3x-ui.")

        raw_list: Any = payload
        if isinstance(payload, dict):
            for key in ("obj", "data", "inbounds", "list", "items"):
                if isinstance(payload.get(key), list):
                    raw_list = payload[key]
                    break
        if not isinstance(raw_list, list):
            raw_list = []

        items: list[PanelInbound] = []
        for entry in raw_list:
            if not isinstance(entry, dict):
                continue
            parsed = self._parse_entry(entry)
            if parsed is not None:
                items.append(parsed)
        return items

    def _parse_entry(self, entry: dict[str, Any]) -> PanelInbound | None:
        remark = str(entry.get("remark", "") or "").strip()
        protocol = str(entry.get("protocol", "vless") or "vless").strip().upper() or "VLESS"
        try:
            port = int(entry.get("port", 0) or 0)
        except Exception:
            port = 0

        host = str(entry.get("listen", "") or "").strip()
        if host in {"", "0.0.0.0", "::"}:
            host = self.public_host

        stream_settings = _json_dict(entry.get("streamSettings"))
        settings = _json_dict(entry.get("settings"))
        clients = settings.get("clients")
        if not isinstance(clients, list):
            clients = _json_list(settings.get("clients"))
        first_client = clients[0] if clients and isinstance(clients[0], dict) else {}

        network = str(stream_settings.get("network") or "tcp").strip().lower() or "tcp"
        security = str(stream_settings.get("security") or "none").strip().lower() or "none"
        path = self._extract_path(stream_settings, network)
        server_name = self._extract_server_name(stream_settings, host)
        client_id = self._extract_client_id(protocol, first_client, settings)

        return PanelInbound(
            panel_id=entry.get("id"),
            name=remark or f"inbound-{entry.get('id', '?')}",
            protocol=protocol,
            host=host,
            port=port,
            source="3x-ui",
            network=network,
            security=security,
            path=path,
            server_name=server_name,
            client_id=client_id,
            raw=dict(entry),
        )

    @staticmethod
    def _extract_path(stream_settings: dict[str, Any], network: str) -> str:
        for key in ("wsSettings", "httpupgradeSettings", "xhttpSettings", "splithttpSettings"):
            settings = stream_settings.get(key)
            if isinstance(settings, dict):
                value = str(settings.get("path") or "").strip()
                if value:
                    return value
        if network == "grpc":
            grpc_settings = stream_settings.get("grpcSettings")
            if isinstance(grpc_settings, dict):
                return str(grpc_settings.get("serviceName") or "").strip()
        return ""

    @staticmethod
    def _extract_server_name(stream_settings: dict[str, Any], fallback_host: str) -> str:
        for key in ("tlsSettings", "realitySettings"):
            settings = stream_settings.get(key)
            if not isinstance(settings, dict):
                continue
            server_name = str(settings.get("serverName") or "").strip()
            if server_name:
                return server_name
            server_names = settings.get("serverNames")
            if isinstance(server_names, list):
                for item in server_names:
                    value = str(item or "").strip()
                    if value:
                        return value

        ws_settings = stream_settings.get("wsSettings")
        if isinstance(ws_settings, dict):
            headers = ws_settings.get("headers")
            if isinstance(headers, dict):
                host = str(headers.get("Host") or headers.get("host") or "").strip()
                if host:
                    return host

        return str(fallback_host or "").strip()

    @staticmethod
    def _extract_client_id(protocol: str, first_client: dict[str, Any], settings: dict[str, Any]) -> str:
        normalized = protocol.strip().lower()
        if normalized in {"vless", "vmess"}:
            return str(first_client.get("id") or "").strip()
        if normalized == "trojan":
            return str(first_client.get("password") or settings.get("password") or "").strip()
        if normalized == "shadowsocks":
            return str(settings.get("password") or first_client.get("password") or "").strip()
        return ""