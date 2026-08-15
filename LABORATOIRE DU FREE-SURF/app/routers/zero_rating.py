from __future__ import annotations

import json
import re
from typing import Any, Callable

from fastapi import APIRouter, HTTPException


_DEFAULT_ROUTING_PRESETS = ["private-block", "bittorrent-block"]


def _as_int(value: Any, default: int) -> int:
    try:
        out = int(value)
    except Exception:
        return default
    return out


def _as_port(value: Any, default: int) -> int:
    port = _as_int(value, default)
    if port < 1 or port > 65535:
        return default
    return port


def _default_normalize_host(value: Any) -> str:
    return str(value or "").strip()


def _normalize_path(value: Any, default: str = "/") -> str:
    raw = str(value or "").strip()
    if not raw:
        raw = default
    if not raw.startswith("/"):
        raw = f"/{raw}"
    return raw


def _clean_host(value: Any, normalize_host: Callable[[Any], str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    cleaned = normalize_host(raw) or raw
    cleaned = cleaned.strip()
    if cleaned.startswith("*."):
        cleaned = cleaned[2:]
    cleaned = cleaned.strip().rstrip("/")
    return cleaned


def _unique_hosts(values: list[Any], normalize_host: Callable[[Any], str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        host = _clean_host(value, normalize_host)
        if not host:
            continue
        if host in seen:
            continue
        seen.add(host)
        out.append(host)
    return out


def _tagify(text: Any, fallback: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return fallback
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", raw)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or fallback


def _normalize_bsid(value: Any, fallback_tag: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return f"@{fallback_tag}"
    if not raw.startswith("@"):
        return f"@{raw}"
    return raw


def _extract_headers(raw: Any) -> dict[str, str]:
    if isinstance(raw, dict):
        if isinstance(raw.get("headers"), dict):
            source = raw.get("headers")
        elif isinstance(raw.get("httpSettings"), dict) and isinstance(raw["httpSettings"].get("headers"), dict):
            source = raw["httpSettings"].get("headers")
        else:
            source = raw
    else:
        source = {}

    out: dict[str, str] = {}
    for key, value in source.items():
        k = str(key or "").strip()
        if not k:
            continue
        if value is None:
            continue
        out[k] = str(value)
    return out


def _default_service_payload(raw_services: Any, normalize_host: Callable[[Any], str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw_services, dict):
        return out

    for key, value in raw_services.items():
        if not isinstance(value, dict):
            continue

        label = str(value.get("label") or value.get("service") or key).strip() or str(key)
        domains: list[Any] = []
        for bucket in ("critical_endpoints", "domains", "instagram", "whatsapp", "messenger", "cdn_providers"):
            raw_bucket = value.get(bucket)
            if isinstance(raw_bucket, list):
                domains.extend(raw_bucket)

        out[str(key)] = {
            "label": label,
            "service": str(value.get("service") or label),
            "domains": _unique_hosts(domains, normalize_host),
            "priority": str(value.get("priority", "MEDIUM") or "MEDIUM").upper(),
            "enabled": bool(value.get("enabled", True)),
        }
    return out


def _resolve_proxy_address(
    *,
    payload: dict[str, Any],
    selected_services: list[str],
    services_payload: dict[str, dict[str, Any]],
    raw_services: Any,
    normalize_host: Callable[[Any], str],
    fallback_host: str,
) -> str:
    custom_proxy = _clean_host(payload.get("proxy_address"), normalize_host)
    if custom_proxy:
        return custom_proxy

    if isinstance(raw_services, dict):
        for service_id in selected_services:
            item = raw_services.get(service_id)
            if not isinstance(item, dict):
                continue
            candidates: list[Any] = []
            for key in ("critical_endpoints", "domains"):
                values = item.get(key)
                if isinstance(values, list):
                    candidates.extend(values)
            hosts = _unique_hosts(candidates, normalize_host)
            if hosts:
                return hosts[0]

    for service_id in selected_services:
        item = services_payload.get(service_id)
        if not isinstance(item, dict):
            continue
        domains = item.get("domains")
        if isinstance(domains, list):
            hosts = _unique_hosts(domains, normalize_host)
            if hosts:
                return hosts[0]

    return fallback_host


def _resolve_service_label(
    *,
    selected_services: list[str],
    services_payload: dict[str, dict[str, Any]],
    raw_services: Any,
) -> str:
    if isinstance(raw_services, dict):
        for service_id in selected_services:
            item = raw_services.get(service_id)
            if isinstance(item, dict):
                label = str(item.get("label") or item.get("service") or service_id).strip()
                if label:
                    return label

    for service_id in selected_services:
        item = services_payload.get(service_id)
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("service") or service_id).strip()
            if label:
                return label

    return "zero-rating-http"


def _default_inbounds(cfg: Any) -> list[dict[str, Any]]:
    return [
        {
            "listen": str(getattr(cfg, "ZERO_RATING_TUN_LISTEN", "0.0.0.0") or "0.0.0.0"),
            "port": _as_port(getattr(cfg, "ZERO_RATING_TUN_PORT", 1080), 1080),
            "protocol": "dokodemo-door",
            "settings": {
                "network": "tcp,udp",
                "followRedirect": True,
                "address": str(getattr(cfg, "ZERO_RATING_TUN_TARGET", "127.0.0.1") or "127.0.0.1"),
            },
            "tag": "tun-inbound",
        },
        {
            "listen": "127.0.0.1",
            "port": _as_port(getattr(cfg, "V2RAY_LOCAL_SOCKS_PORT", 10808), 10808),
            "protocol": "socks",
            "settings": {
                "auth": "noauth",
                "udp": True,
            },
            "tag": "socks-inbound",
        },
    ]


def _normalize_inbounds(value: Any, cfg: Any) -> list[dict[str, Any]]:
    rows = value if isinstance(value, list) and value else _default_inbounds(cfg)
    out: list[dict[str, Any]] = []

    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue

        protocol = str(row.get("protocol") or "").strip().lower() or "dokodemo-door"
        if protocol == "tunnel":
            protocol = "dokodemo-door"

        settings = dict(row.get("settings")) if isinstance(row.get("settings"), dict) else {}

        if protocol == "dokodemo-door":
            default_tag = "tun-inbound"
            default_listen = str(getattr(cfg, "ZERO_RATING_TUN_LISTEN", "0.0.0.0") or "0.0.0.0")
            default_port = _as_port(getattr(cfg, "ZERO_RATING_TUN_PORT", 1080), 1080)
            settings.setdefault("network", "tcp,udp")
            settings.setdefault("followRedirect", True)
            settings.setdefault("address", str(getattr(cfg, "ZERO_RATING_TUN_TARGET", "127.0.0.1") or "127.0.0.1"))
        elif protocol == "socks":
            default_tag = "socks-inbound"
            default_listen = "127.0.0.1"
            default_port = _as_port(getattr(cfg, "V2RAY_LOCAL_SOCKS_PORT", 10808), 10808)
            settings.setdefault("auth", "noauth")
            settings.setdefault("udp", True)
        elif protocol == "mixed":
            default_tag = "mixed-inbound"
            default_listen = "127.0.0.1"
            default_port = _as_port(getattr(cfg, "V2RAY_LOCAL_SOCKS_PORT", 10808), 10808)
            settings.setdefault("auth", "noauth")
            settings.setdefault("udp", True)
        elif protocol == "http":
            default_tag = "http-inbound"
            default_listen = "127.0.0.1"
            default_port = _as_port(getattr(cfg, "ZERO_RATING_PROXY_PORT", 8080), 8080)
        else:
            default_tag = f"inbound-{idx + 1}"
            default_listen = "127.0.0.1"
            default_port = _as_port(getattr(cfg, "ZERO_RATING_TUN_PORT", 1080), 1080)

        out.append(
            {
                "listen": str(row.get("listen") or default_listen).strip() or default_listen,
                "port": _as_port(row.get("port"), default_port),
                "protocol": protocol,
                "settings": settings,
                "tag": str(row.get("tag") or default_tag).strip() or default_tag,
            }
        )

    return out or _default_inbounds(cfg)


def _normalize_key_list(value: Any) -> list[str]:
    candidates: list[str] = []
    if isinstance(value, list):
        candidates = [str(item or "").strip().lower() for item in value]
    elif isinstance(value, str):
        candidates = [part.strip().lower() for part in re.split(r"[,;\s]+", value) if part.strip()]

    out: list[str] = []
    seen: set[str] = set()
    for key in candidates:
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _normalize_dict_rows(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [dict(value)]
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _collect_selected_service_domains(
    *,
    selected_services: list[str],
    services_payload: dict[str, dict[str, Any]],
    raw_services: Any,
    normalize_host: Callable[[Any], str],
) -> list[str]:
    raw_domains: list[Any] = []

    if isinstance(raw_services, dict):
        for service_id in selected_services:
            item = raw_services.get(service_id)
            if not isinstance(item, dict):
                continue
            for key in ("critical_endpoints", "domains", "instagram", "whatsapp", "messenger", "cdn_providers"):
                values = item.get(key)
                if isinstance(values, list):
                    raw_domains.extend(values)

    for service_id in selected_services:
        item = services_payload.get(service_id)
        if not isinstance(item, dict):
            continue
        values = item.get("domains")
        if isinstance(values, list):
            raw_domains.extend(values)

    return _unique_hosts(raw_domains, normalize_host)


def _build_preset_outbounds(
    *,
    preset_keys: list[str],
    proxy_tag: str,
    proxy_address: str,
    proxy_port: int,
    proxy_headers: dict[str, str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for key in preset_keys:
        if key == "dns-out":
            out.append({"tag": "dns-out", "protocol": "dns"})
        elif key == "direct-fallback":
            out.append({"tag": "direct-fallback", "protocol": "freedom"})
        elif key == "http-backup":
            out.append(
                {
                    "tag": f"{proxy_tag}-backup",
                    "protocol": "http",
                    "settings": {
                        "servers": [
                            {
                                "address": proxy_address,
                                "port": proxy_port,
                            }
                        ],
                        "headers": dict(proxy_headers),
                    },
                }
            )
        elif key == "socks-local":
            out.append(
                {
                    "tag": "socks-local",
                    "protocol": "socks",
                    "settings": {
                        "servers": [
                            {
                                "address": "127.0.0.1",
                                "port": 10809,
                            }
                        ]
                    },
                }
            )

    return out


def _build_preset_routing_rules(
    *,
    preset_keys: list[str],
    service_domains: list[str],
    proxy_tag: str,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for key in preset_keys:
        if key == "private-block":
            out.append(
                {
                    "type": "field",
                    "outboundTag": "blocked",
                    "ip": ["geoip:private"],
                }
            )
        elif key == "private-direct":
            out.append(
                {
                    "type": "field",
                    "outboundTag": "direct",
                    "ip": ["geoip:private"],
                }
            )
        elif key == "bittorrent-block":
            out.append(
                {
                    "type": "field",
                    "outboundTag": "blocked",
                    "protocol": ["bittorrent"],
                }
            )
        elif key == "ads-block":
            out.append(
                {
                    "type": "field",
                    "outboundTag": "blocked",
                    "domain": ["geosite:category-ads-all"],
                }
            )
        elif key == "services-direct" and service_domains:
            out.append(
                {
                    "type": "field",
                    "outboundTag": "direct",
                    "domain": list(service_domains),
                }
            )
        elif key == "services-proxy" and service_domains:
            out.append(
                {
                    "type": "field",
                    "outboundTag": proxy_tag,
                    "domain": list(service_domains),
                }
            )

    return out


def _dedupe_outbounds(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen_tags: set[str] = set()

    for row in rows:
        if not isinstance(row, dict):
            continue
        candidate = dict(row)
        tag = str(candidate.get("tag") or "").strip()
        if tag:
            if tag in seen_tags:
                continue
            seen_tags.add(tag)
        out.append(candidate)

    return out


def _dedupe_rules(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            signature = json.dumps(row, sort_keys=True, ensure_ascii=True)
        except Exception:
            signature = str(row)
        if signature in seen:
            continue
        seen.add(signature)
        out.append(dict(row))

    return out


def _find_missing_routing_outbound_tags(
    *,
    routing_rules: list[dict[str, Any]],
    outbounds: list[dict[str, Any]],
) -> list[str]:
    available_tags: set[str] = set()
    for row in outbounds:
        if not isinstance(row, dict):
            continue
        tag = str(row.get("tag") or "").strip()
        if tag:
            available_tags.add(tag)

    missing: list[str] = []
    seen_missing: set[str] = set()
    for row in routing_rules:
        if not isinstance(row, dict):
            continue
        outbound_tag = str(row.get("outboundTag") or "").strip()
        if not outbound_tag:
            continue
        if outbound_tag in available_tags or outbound_tag in seen_missing:
            continue
        seen_missing.add(outbound_tag)
        missing.append(outbound_tag)

    return missing

def _build_transport_outbound(
    *,
    transport_protocol: str,
    transport_tag: str,
    proxy_tag: str,
    server: str,
    port: int,
    uuid_value: str,
    security: str,
    network: str,
    sni: str,
    path: str,
    allow_insecure: bool,
) -> dict[str, Any]:
    if transport_protocol == "vmess":
        settings: dict[str, Any] = {
            "vnext": [
                {
                    "address": server,
                    "port": port,
                    "users": [
                        {
                            "id": uuid_value,
                            "alterId": 0,
                            "security": "none",
                            "level": 8,
                        }
                    ],
                }
            ]
        }
    else:
        settings = {
            "vnext": [
                {
                    "address": server,
                    "port": port,
                    "users": [
                        {
                            "id": uuid_value,
                            "encryption": "none",
                            "flow": "",
                            "level": 8,
                        }
                    ],
                }
            ]
        }

    stream_settings: dict[str, Any] = {
        "network": network,
        "security": security,
    }

    if security == "tls":
        stream_settings["tlsSettings"] = {
            "allowInsecure": allow_insecure,
            "serverName": sni,
            "fingerprint": "chrome",
        }

    if network == "ws":
        stream_settings["wsSettings"] = {
            "path": path,
            "headers": {
                "Host": sni,
            },
        }

    stream_settings["sockopt"] = {
        "dialerProxy": proxy_tag,
    }

    return {
        "tag": transport_tag,
        "protocol": transport_protocol,
        "proxySettings": {
            "tag": proxy_tag,
            "transportLayer": True,
        },
        "settings": settings,
        "streamSettings": stream_settings,
    }


def create_zero_rating_router(
    *,
    cfg: Any,
    build_zero_rating_services_payload: Callable[[], dict[str, Any]] | None = None,
    normalize_host: Callable[[Any], str] | None = None,
    generate_uuid: Callable[[], str] | None = None,
    now_ts: Callable[[], str] | None = None,
) -> APIRouter:
    router = APIRouter()
    normalize_host_fn = normalize_host or _default_normalize_host
    generate_uuid_fn = generate_uuid or (lambda: "")
    now_ts_fn = now_ts or (lambda: "")

    @router.get("/api/zero-rating/services")
    async def get_zero_rating_services() -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if callable(build_zero_rating_services_payload):
            try:
                raw_payload = build_zero_rating_services_payload()
                if isinstance(raw_payload, dict):
                    payload = raw_payload
            except Exception:
                payload = {}

        if not payload:
            payload = _default_service_payload(getattr(cfg, "_ZERO_RATING_SERVICES", {}), normalize_host_fn)

        return {
            "status": "success",
            "services": payload,
        }

    @router.post("/api/zero-rating/generate-config")
    async def generate_zero_rating_config(body: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="payload JSON invalide")

        raw_services = getattr(cfg, "_ZERO_RATING_SERVICES", {})
        services_payload = _default_service_payload(raw_services, normalize_host_fn)
        if callable(build_zero_rating_services_payload):
            try:
                ext_payload = build_zero_rating_services_payload()
                if isinstance(ext_payload, dict):
                    for key, value in ext_payload.items():
                        if isinstance(value, dict):
                            services_payload[str(key)] = dict(value)
            except Exception:
                pass

        server = _clean_host(
            body.get("server")
            or getattr(cfg, "PANEL_DEFAULT_HOST", "")
            or getattr(cfg, "vps_address", "")
            or "127.0.0.1",
            normalize_host_fn,
        )
        if not server:
            raise HTTPException(status_code=400, detail="serveur manquant")

        selected_services = [
            str(item).strip()
            for item in (body.get("services") if isinstance(body.get("services"), list) else [])
            if str(item).strip()
        ]

        port_default = _as_port(getattr(cfg, "vps_port", 443), 443)
        port = _as_port(body.get("port"), port_default)
        sni = _clean_host(body.get("sni"), normalize_host_fn) or server

        proxy_address = _resolve_proxy_address(
            payload=body,
            selected_services=selected_services,
            services_payload=services_payload,
            raw_services=raw_services,
            normalize_host=normalize_host_fn,
            fallback_host=server,
        )
        proxy_port = _as_port(body.get("proxy_port"), _as_port(getattr(cfg, "ZERO_RATING_PROXY_PORT", 8080), 8080))

        service_label = _resolve_service_label(
            selected_services=selected_services,
            services_payload=services_payload,
            raw_services=raw_services,
        )
        proxy_tag_input = str(body.get("proxy_tag") or "").strip()
        proxy_tag = _tagify(proxy_tag_input or service_label, "zero-rating-http")
        proxy_bsid = _normalize_bsid(body.get("proxy_bsid"), proxy_tag)

        defaults_headers = {
            "Host": f"{sni}:{port}",
            "Proxy-Connection": "keep-alive",
            "User-Agent": str(getattr(cfg, "ZERO_RATING_HTTP_USER_AGENT", "Mozilla/5.0")),
            "X-iorg-bsid": proxy_bsid,
        }
        custom_headers = _extract_headers(body.get("proxy_headers"))
        proxy_headers = {**defaults_headers, **custom_headers}

        base_config = body.get("base_config") if isinstance(body.get("base_config"), dict) else {}
        base_protocol = str(base_config.get("protocol") or "").strip().lower()
        transport_protocol = str(body.get("transport_protocol") or "auto").strip().lower()
        if transport_protocol == "auto":
            transport_protocol = base_protocol if base_protocol in {"vmess", "vless"} else "vless"
        if transport_protocol not in {"vmess", "vless"}:
            transport_protocol = "vless"

        transport_tag_input = str(body.get("transport_tag") or "").strip()
        transport_tag = _tagify(transport_tag_input or transport_protocol.upper(), transport_protocol.upper())

        path_default = str(getattr(cfg, "DEFAULT_VLESS_PATH", "") or getattr(cfg, "vps_path", "") or "/")
        path = _normalize_path(base_config.get("path"), path_default)
        security = str(base_config.get("security") or "tls").strip().lower() or "tls"
        network = str(base_config.get("network") or "ws").strip().lower() or "ws"

        uuid_value = str(base_config.get("uuid") or getattr(cfg, "PRIMARY_3XUI_UUID", "") or generate_uuid_fn()).strip()
        if not uuid_value:
            uuid_value = str(generate_uuid_fn() or "").strip() or "00000000-0000-0000-0000-000000000000"

        allow_insecure = bool(getattr(cfg, "ZERO_RATING_ALLOW_INSECURE", True))

        inbounds = _normalize_inbounds(body.get("inbounds"), cfg)
        primary_outbound = _build_transport_outbound(
            transport_protocol=transport_protocol,
            transport_tag=transport_tag,
            proxy_tag=proxy_tag,
            server=server,
            port=port,
            uuid_value=uuid_value,
            security=security,
            network=network,
            sni=sni,
            path=path,
            allow_insecure=allow_insecure,
        )

        proxy_outbound = {
            "tag": proxy_tag,
            "protocol": "http",
            "settings": {
                "servers": [
                    {
                        "address": proxy_address,
                        "port": proxy_port,
                    }
                ],
                "headers": proxy_headers,
            },
        }

        outbound_presets = _normalize_key_list(body.get("outbound_presets"))
        preset_outbounds = _build_preset_outbounds(
            preset_keys=outbound_presets,
            proxy_tag=proxy_tag,
            proxy_address=proxy_address,
            proxy_port=proxy_port,
            proxy_headers=proxy_headers,
        )
        extra_outbounds = _normalize_dict_rows(body.get("extra_outbounds"))

        base_outbounds = [
            primary_outbound,
            proxy_outbound,
            *preset_outbounds,
            *extra_outbounds,
            {"tag": "direct", "protocol": "freedom"},
            {"tag": "blocked", "protocol": "blackhole"},
        ]
        outbounds = _dedupe_outbounds(base_outbounds)

        routing_presets = _normalize_key_list(body.get("routing_presets"))
        if not routing_presets:
            routing_presets = list(_DEFAULT_ROUTING_PRESETS)

        service_domains = _collect_selected_service_domains(
            selected_services=selected_services,
            services_payload=services_payload,
            raw_services=raw_services,
            normalize_host=normalize_host_fn,
        )
        preset_rules = _build_preset_routing_rules(
            preset_keys=routing_presets,
            service_domains=service_domains,
            proxy_tag=proxy_tag,
        )
        extra_rules = _normalize_dict_rows(body.get("extra_routing_rules"))

        routing_rules = _dedupe_rules(
            [
                *preset_rules,
                *extra_rules,
                {
                    "type": "field",
                    "network": "tcp,udp",
                    "outboundTag": transport_tag,
                },
            ]
        )

        missing_outbound_tags = _find_missing_routing_outbound_tags(
            routing_rules=routing_rules,
            outbounds=outbounds,
        )
        if missing_outbound_tags:
            raise HTTPException(
                status_code=400,
                detail=f"routing outboundTag inconnu: {', '.join(missing_outbound_tags)}",
            )
        config = {
            "log": {
                "loglevel": "warning",
            },
            "dns": {
                "servers": [
                    str(getattr(cfg, "ZERO_RATING_DNS_SERVER", "localhost") or "localhost"),
                ]
            },
            "inbounds": inbounds,
            "outbounds": outbounds,
            "routing": {
                "domainStrategy": "AsIs",
                "rules": routing_rules,
            },
            "policy": {
                "levels": {
                    "8": {
                        "connIdle": 300,
                        "downlinkOnly": 1,
                        "handshake": 4,
                        "uplinkOnly": 1,
                    }
                }
            },
            "stats": {},
        }

        return {
            "status": "success",
            "generated_at": str(now_ts_fn() or ""),
            "applied_presets": {
                "routing": routing_presets,
                "outbounds": outbound_presets,
            },
            "config": config,
        }

    return router
