from __future__ import annotations

import ipaddress
import os
import socket
import time
from typing import Any, Callable

import httpx

from app.core.panels import build_panel_provider
from app.core.transports import build_transport_engines


class Integrations:
    def __init__(
        self,
        *,
        cfg: Any,
        panel_provider_builder: Callable[..., Any] = build_panel_provider,
        transport_engine_builder: Callable[..., list[Any]] = build_transport_engines,
    ) -> None:
        self.cfg = cfg
        self._panel_provider_builder = panel_provider_builder
        self._transport_engine_builder = transport_engine_builder
        self._panel_provider: Any = None
        self._transport_engines: list[Any] | None = None
        self._xui_cache: dict[str, Any] = {"items": [], "ts": 0.0}
        self._xui_cache_ttl_seconds = 60
        self._xui_http_timeout_seconds = max(
            1.0,
            float(os.getenv("FS_XUI_TIMEOUT_SECONDS", "4.0") or 4.0),
        )

    def get_panel_provider(self):
        if self._panel_provider is None:
            self._panel_provider = self._panel_provider_builder(cfg=self.cfg)
        return self._panel_provider

    def get_transport_engines(self) -> list[Any]:
        if self._transport_engines is None:
            self._transport_engines = list(self._transport_engine_builder(cfg=self.cfg))
        return list(self._transport_engines)

    async def fetch_panel_inbounds(self, *, force_refresh: bool = False) -> list[dict]:
        provider = self.get_panel_provider()
        return await provider.list_inbounds_as_dicts(force_refresh=force_refresh)

    def list_transport_backends(self) -> list[dict]:
        items: list[dict] = []
        for engine in self.get_transport_engines():
            status_dict = getattr(engine, "status_dict", None)
            if callable(status_dict):
                payload = status_dict()
            else:
                status = getattr(engine, "status", None)
                payload = status().as_dict() if callable(status) else {}
            if isinstance(payload, dict):
                items.append(payload)
        return items

    def normalize_host(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        for prefix in ("http://", "https://"):
            if text.startswith(prefix):
                text = text[len(prefix):]
        text = text.split("/", 1)[0].strip()
        text = text.split(":", 1)[0].strip()
        return text.lower()

    def resolve_dns_records(self, host: str) -> tuple[list[str], list[str]]:
        clean = self.normalize_host(host)
        if not clean:
            return [], []
        a_records: list[str] = []
        aaaa_records: list[str] = []
        try:
            infos = socket.getaddrinfo(clean, None)
        except Exception:
            return [], []
        for info in infos:
            ip = str(info[4][0])
            if ":" in ip:
                if ip not in aaaa_records:
                    aaaa_records.append(ip)
            else:
                if ip not in a_records:
                    a_records.append(ip)
        return a_records, aaaa_records

    def _matches_networks(self, ip: str, networks: Any) -> bool:
        try:
            parsed = ipaddress.ip_address(str(ip or "").strip())
        except Exception:
            return False
        return any(parsed in network for network in networks)

    def is_cloudflare_ip(self, ip: str) -> bool:
        return self._matches_networks(ip, getattr(self.cfg, "_CLOUDFLARE_NETS", []))

    def is_gcp_ip(self, ip: str) -> bool:
        return self._matches_networks(ip, getattr(self.cfg, "_GCP_NETS", []))

    async def fetch_3xui_data(
        self,
        base_url: str,
        username: str,
        password: str,
        *,
        force_refresh: bool = False,
    ) -> list[dict]:
        now = time.time()
        if not force_refresh and (now - float(self._xui_cache.get("ts", 0) or 0)) < self._xui_cache_ttl_seconds:
            cached = self._xui_cache.get("items")
            if isinstance(cached, list):
                return list(cached)

        base = str(base_url or "").strip().rstrip("/")
        if not base:
            raise RuntimeError("FS_XUI_URL manquant.")

        user = str(username or "").strip()
        pwd = str(password or "").strip()
        if not user or not pwd:
            raise RuntimeError("FS_XUI_USER / FS_XUI_PASS manquants.")

        items: list[dict] = []
        timeout = httpx.Timeout(
            self._xui_http_timeout_seconds,
            connect=min(3.0, self._xui_http_timeout_seconds),
        )
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False) as client:
            login_attempts = (
                f"{base}/login",
                f"{base}/panel/login",
            )
            logged = False
            for login_url in login_attempts:
                try:
                    resp = await client.post(login_url, data={"username": user, "password": pwd})
                except Exception:
                    continue
                if resp.status_code < 400:
                    logged = True
                    break
            if not logged:
                raise RuntimeError("Echec authentification 3x-ui.")

            endpoints = (
                f"{base}/panel/api/inbounds/list",
                f"{base}/xui/inbound/list",
                f"{base}/panel/inbound/list",
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

        raw_list = payload
        if isinstance(payload, dict):
            for key in ("obj", "data", "inbounds", "list", "items"):
                if isinstance(payload.get(key), list):
                    raw_list = payload[key]
                    break
        if not isinstance(raw_list, list):
            raw_list = []

        for entry in raw_list:
            if not isinstance(entry, dict):
                continue
            remark = str(entry.get("remark", "") or "").strip()
            protocol = str(entry.get("protocol", "vless") or "vless").strip().upper()
            port = int(entry.get("port", 0) or 0)
            host = str(entry.get("listen", "") or "").strip()
            if host in {"", "0.0.0.0", "::"}:
                host = str(self.cfg.XUI_PUBLIC_IP or self.cfg.PANEL_DEFAULT_HOST or "").strip()
            item = {
                "id": entry.get("id"),
                "name": remark or f"inbound-{entry.get('id', '?')}",
                "protocol": protocol,
                "host": host,
                "port": port,
                "source": "3x-ui",
                "raw": entry,
            }
            items.append(item)

        self._xui_cache["items"] = list(items)
        self._xui_cache["ts"] = now
        return items

    def build_admin_transport_addons(self, *, default_server: str = "") -> list[dict]:
        server = str(default_server or self.cfg.PANEL_DEFAULT_HOST or self.cfg.vps_address or "").strip()
        if not server:
            server = "example.com"

        items: list[dict] = []
        for engine in self.get_transport_engines():
            public_endpoint = getattr(engine, "public_endpoint", None)
            if not callable(public_endpoint):
                continue
            payload = public_endpoint(default_host=server)
            if isinstance(payload, dict):
                payload["source"] = "addon"
                items.append(payload)

        items.append(
            {
                "id": "addon_tcp",
                "name": "VLESS TCP",
                "protocol": "VLESS",
                "host": self.cfg.TCP_HOST or server,
                "port": int(self.cfg.TCP_PORT or 80),
                "source": "addon",
            }
        )
        return items


def create_integrations(
    *,
    cfg: Any,
    panel_provider_builder: Callable[..., Any] = build_panel_provider,
    transport_engine_builder: Callable[..., list[Any]] = build_transport_engines,
) -> Integrations:
    return Integrations(
        cfg=cfg,
        panel_provider_builder=panel_provider_builder,
        transport_engine_builder=transport_engine_builder,
    )
