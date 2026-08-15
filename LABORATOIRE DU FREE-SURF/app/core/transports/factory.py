from __future__ import annotations

from typing import Any

from .base import TransportEngineInfo
from .static import StaticTransportEngine


def _as_port(value: Any, default: int) -> int:
    try:
        port = int(value or 0)
    except Exception:
        return int(default)
    return port if port > 0 else int(default)


def _as_port_list(value: Any) -> list[int]:
    items = value if isinstance(value, list) else [value]
    ports: list[int] = []
    for item in items:
        try:
            port = int(item or 0)
        except Exception:
            continue
        if port > 0 and port not in ports:
            ports.append(port)
    return ports


def build_transport_engines(*, cfg: Any) -> list[StaticTransportEngine]:
    default_host = str(
        getattr(cfg, "PANEL_PUBLIC_HOST", "") or getattr(cfg, "PANEL_DEFAULT_HOST", "") or ""
    ).strip()
    slowdns_server = str(
        getattr(cfg, "SLOWDNS_SERVER_HOST", "") or getattr(cfg, "SLOWDNS_IP", "") or default_host
    ).strip()
    dropbear_ports = _as_port_list(getattr(cfg, "DROPBEAR_PORTS", []))
    dropbear_primary_port = _as_port(
        dropbear_ports[0] if dropbear_ports else getattr(cfg, "DROPBEAR_PORT", 143),
        143,
    )

    return [
        StaticTransportEngine(
            info=TransportEngineInfo(
                engine_name="hysteria2",
                display_name="Hysteria 2",
                protocol="UDP",
                public=True,
            ),
            host=str(getattr(cfg, "HYSTERIA_HOST", "") or getattr(cfg, "HYSTERIA_IP", "") or default_host).strip(),
            port=_as_port(getattr(cfg, "HYSTERIA_PORT", 8443), 8443),
            required_checks={
                "FS_HYSTERIA_PASS": bool(str(getattr(cfg, "HYSTERIA_PASS", "") or "").strip()),
                "FS_HYSTERIA_SNI": bool(
                    str(getattr(cfg, "HYSTERIA_SNI", "") or getattr(cfg, "HYSTERIA_HOST", "") or default_host).strip()
                ),
            },
            raw={
                "sni": str(
                    getattr(cfg, "HYSTERIA_SNI", "") or getattr(cfg, "HYSTERIA_HOST", "") or default_host
                ).strip(),
            },
        ),
        StaticTransportEngine(
            info=TransportEngineInfo(
                engine_name="slowdns",
                display_name="SlowDNS / DNSTT",
                protocol="DNS",
                public=True,
            ),
            host=str(getattr(cfg, "SLOWDNS_DOMAIN", "") or default_host).strip(),
            port=_as_port(getattr(cfg, "SLOWDNS_PORT", 53), 53),
            required_checks={
                "FS_SLOWDNS_PUBKEY": bool(str(getattr(cfg, "SLOWDNS_PUBKEY", "") or "").strip()),
            },
            raw={
                "dns_server": slowdns_server,
                "ns_host": str(getattr(cfg, "SLOWDNS_NS_HOST", "") or "").strip(),
                "local_port": _as_port(getattr(cfg, "SLOWDNS_LOCAL_PORT", 7000), 7000),
                "pubkey": str(getattr(cfg, "SLOWDNS_PUBKEY", "") or "").strip(),
            },
        ),
        StaticTransportEngine(
            info=TransportEngineInfo(
                engine_name="ssh",
                display_name="SSH",
                protocol="SSH",
                public=False,
            ),
            host=str(getattr(cfg, "SSH_HOST", "") or default_host).strip(),
            port=_as_port(getattr(cfg, "SSH_PORT", 22), 22),
            required_checks={
                "FS_SSH_DEFAULT_USER": bool(str(getattr(cfg, "SSH_DEFAULT_USER", "") or "").strip()),
            },
            raw={"username": str(getattr(cfg, "SSH_DEFAULT_USER", "") or "").strip()},
        ),
        StaticTransportEngine(
            info=TransportEngineInfo(
                engine_name="dropbear",
                display_name="Dropbear",
                protocol="SSH",
                public=False,
            ),
            host=str(getattr(cfg, "DROPBEAR_HOST", "") or default_host).strip(),
            port=dropbear_primary_port,
            required_checks={
                "FS_DROPBEAR_USER": bool(str(getattr(cfg, "DROPBEAR_USER", "") or "").strip()),
            },
            raw={
                "username": str(getattr(cfg, "DROPBEAR_USER", "") or "").strip(),
                "ports": dropbear_ports or [dropbear_primary_port],
            },
        ),
        StaticTransportEngine(
            info=TransportEngineInfo(
                engine_name="udpgw",
                display_name="UDPGW / UDP Custom",
                protocol="UDPGW",
                public=False,
            ),
            host=str(getattr(cfg, "UDPGW_HOST", "") or default_host).strip(),
            port=_as_port(getattr(cfg, "UDPGW_PORT", 7300), 7300),
            required_checks={
                "FS_UDPGW_ENABLED": bool(getattr(cfg, "UDPGW_ENABLED", False)),
            },
            raw={
                "mode": "udp-custom",
                "enabled": bool(getattr(cfg, "UDPGW_ENABLED", False)),
            },
        ),
        StaticTransportEngine(
            info=TransportEngineInfo(
                engine_name="zivpn_udp",
                display_name="ZiVPN UDP",
                protocol="UDP",
                public=True,
            ),
            host=str(getattr(cfg, "ZIVPN_UDP_HOST", "") or default_host).strip(),
            port=_as_port(
                getattr(cfg, "ZIVPN_UDP_PUBLIC_PORT", getattr(cfg, "ZIVPN_UDP_PORT", 5667)),
                5667,
            ),
            required_checks={
                "FS_ZIVPN_UDP_ENABLED": bool(getattr(cfg, "ZIVPN_UDP_ENABLED", False)),
                "FS_ZIVPN_UDP_SNI": bool(
                    str(
                        getattr(cfg, "ZIVPN_UDP_SNI", "")
                        or getattr(cfg, "ZIVPN_UDP_HOST", "")
                        or default_host
                    ).strip()
                ),
            },
            raw={
                "listen_port": _as_port(getattr(cfg, "ZIVPN_UDP_PORT", 5667), 5667),
                "public_port": _as_port(
                    getattr(cfg, "ZIVPN_UDP_PUBLIC_PORT", getattr(cfg, "ZIVPN_UDP_PORT", 5667)),
                    5667,
                ),
                "sni": str(
                    getattr(cfg, "ZIVPN_UDP_SNI", "")
                    or getattr(cfg, "ZIVPN_UDP_HOST", "")
                    or default_host
                ).strip(),
                "forward_range": str(getattr(cfg, "ZIVPN_UDP_FORWARD_RANGE", "") or "").strip(),
                "enabled": bool(getattr(cfg, "ZIVPN_UDP_ENABLED", False)),
            },
        ),
    ]
