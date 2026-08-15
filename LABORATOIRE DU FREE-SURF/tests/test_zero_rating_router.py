import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

try:
    from app.routers.zero_rating import create_zero_rating_router
except ModuleNotFoundError:
    create_zero_rating_router = None


class _Cfg(SimpleNamespace):
    pass


def _build_client() -> TestClient:
    cfg = _Cfg(
        PRIMARY_3XUI_UUID="85a396f5-48ac-4dc3-a41b-f7bcb7bf6d87",
        PANEL_DEFAULT_HOST="panel.example.com",
        vps_address="panel.example.com",
        vps_port=443,
        vps_path="SECURE-FFREE-SURF",
        DEFAULT_VLESS_PATH="SECURE-FFREE-SURF",
        V2RAY_LOCAL_SOCKS_PORT=10808,
        ZERO_RATING_DNS_SERVER="localhost",
        ZERO_RATING_TUN_LISTEN="0.0.0.0",
        ZERO_RATING_TUN_TARGET="127.0.0.1",
        ZERO_RATING_TUN_PORT=1080,
        ZERO_RATING_PROXY_PORT=8080,
        ZERO_RATING_ALLOW_INSECURE=True,
        ZERO_RATING_HTTP_USER_AGENT="TestAgent/1.0",
        _ZERO_RATING_SERVICES={
            "facebook_meta": {
                "label": "Facebook Meta",
                "critical_endpoints": ["m.facebook.com"],
            }
        },
    )
    app = FastAPI()
    app.include_router(
        create_zero_rating_router(
            cfg=cfg,
            build_zero_rating_services_payload=lambda: {},
            normalize_host=lambda value: str(value or "").strip(),
            generate_uuid=lambda: "generated-uuid",
            now_ts=lambda: "2026-03-07T12:00:00Z",
        )
    )
    return TestClient(app)


@unittest.skipUnless(
    callable(create_zero_rating_router),
    "app.routers.zero_rating is not available in this workspace snapshot",
)
class ZeroRatingRouterTests(unittest.TestCase):
    def _assert_routing_outbound_consistency(self, config: dict) -> None:
        outbounds = config.get("outbounds") if isinstance(config, dict) else []
        routing = config.get("routing") if isinstance(config, dict) else {}
        rules = routing.get("rules") if isinstance(routing, dict) else []

        self.assertIsInstance(outbounds, list)
        self.assertIsInstance(rules, list)

        outbound_tags = {
            str(row.get("tag") or "").strip()
            for row in outbounds
            if isinstance(row, dict) and str(row.get("tag") or "").strip()
        }
        missing = sorted(
            {
                str(row.get("outboundTag") or "").strip()
                for row in rules
                if isinstance(row, dict)
                and str(row.get("outboundTag") or "").strip()
                and str(row.get("outboundTag") or "").strip() not in outbound_tags
            }
        )
        self.assertEqual(missing, [], f"routing outboundTag without outbound: {missing}")

    def test_generate_zero_rating_config_accepts_custom_tags_and_headers(self) -> None:
        client = _build_client()
        response = client.post(
            "/api/zero-rating/generate-config",
            json={
                "server": "panel.example.com",
                "port": 443,
                "sni": "panel.example.com",
                "services": ["facebook_meta"],
                "transport_protocol": "vmess",
                "transport_tag": "VMESS-CUSTOM",
                "proxy_address": "31.13.84.39",
                "proxy_port": 8080,
                "proxy_tag": "Philippo237",
                "proxy_bsid": "@ClientLibre",
                "proxy_headers": {
                    "Host": "panel-laboratoire.free-surf237-4all.xyz:443",
                    "Proxy-Connection": "keep-alive",
                    "User-Agent": "Mozilla/5.0 Test",
                    "X-iorg-bsid": "@ClientLibre",
                    "X-Custom-Header": "free-form",
                },
                "inbounds": [
                    {
                        "listen": "0.0.0.0",
                        "port": 2080,
                        "protocol": "http",
                        "settings": {
                            "address": "127.0.0.1",
                            "network": "tcp,udp",
                        },
                        "tag": "http-inbound",
                    },
                    {
                        "listen": "127.0.0.1",
                        "port": 2081,
                        "protocol": "mixed",
                        "settings": {
                            "auth": "noauth",
                            "udp": True,
                        },
                        "tag": "mixed-inbound",
                    },
                ],
                "base_config": {
                    "protocol": "vmess",
                    "uuid": "85a396f5-48ac-4dc3-a41b-f7bcb7bf6d87",
                    "path": "SECURE-FFREE-SURF",
                    "security": "tls",
                    "network": "ws",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "success")

        config = payload["config"]
        primary = config["outbounds"][0]
        self.assertEqual(primary["protocol"], "vmess")
        self.assertEqual(primary["tag"], "VMESS-CUSTOM")
        self.assertEqual(primary["proxySettings"]["tag"], "Philippo237")

        self.assertEqual(config["inbounds"][0]["protocol"], "http")
        self.assertEqual(config["inbounds"][0]["tag"], "http-inbound")
        self.assertEqual(config["inbounds"][0]["port"], 2080)
        self.assertEqual(config["inbounds"][1]["protocol"], "mixed")
        self.assertEqual(config["inbounds"][1]["tag"], "mixed-inbound")
        self.assertEqual(config["inbounds"][1]["port"], 2081)

        http_proxy = config["outbounds"][1]
        self.assertEqual(http_proxy["tag"], "Philippo237")
        self.assertEqual(
            http_proxy["settings"]["headers"],
            {
                "Host": "panel-laboratoire.free-surf237-4all.xyz:443",
                "Proxy-Connection": "keep-alive",
                "User-Agent": "Mozilla/5.0 Test",
                "X-iorg-bsid": "@ClientLibre",
                "X-Custom-Header": "free-form",
            },
        )
        self._assert_routing_outbound_consistency(config)

    def test_generate_zero_rating_config_keeps_default_headers_when_none_are_provided(self) -> None:
        client = _build_client()
        response = client.post(
            "/api/zero-rating/generate-config",
            json={
                "server": "panel.example.com",
                "port": 443,
                "sni": "panel.example.com",
                "services": ["facebook_meta"],
                "transport_protocol": "auto",
                "base_config": {
                    "protocol": "vless",
                    "uuid": "85a396f5-48ac-4dc3-a41b-f7bcb7bf6d87",
                    "path": "/FREE-SURF-4ALL-V2RAY",
                    "security": "tls",
                    "network": "ws",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        config = payload["config"]
        self.assertEqual(config["inbounds"][0]["protocol"], "dokodemo-door")
        self.assertEqual(config["inbounds"][0]["tag"], "tun-inbound")
        self.assertEqual(config["inbounds"][1]["protocol"], "socks")
        self.assertEqual(config["inbounds"][1]["tag"], "socks-inbound")
        self.assertEqual(config["outbounds"][0]["protocol"], "vless")
        self.assertEqual(config["outbounds"][0]["tag"], "VLESS")
        self.assertEqual(config["outbounds"][1]["settings"]["servers"][0]["address"], "m.facebook.com")
        self.assertEqual(config["outbounds"][1]["tag"], "Facebook-Meta")
        self.assertEqual(config["outbounds"][1]["settings"]["headers"]["Host"], "panel.example.com:443")
        self.assertEqual(config["outbounds"][1]["settings"]["headers"]["X-iorg-bsid"], "@Facebook-Meta")
        self._assert_routing_outbound_consistency(config)

    def test_generate_zero_rating_config_injects_missing_fields_by_type(self) -> None:
        client = _build_client()
        response = client.post(
            "/api/zero-rating/generate-config",
            json={
                "server": "panel.example.com",
                "port": 443,
                "sni": "panel.example.com",
                "services": ["facebook_meta"],
                "transport_protocol": "vmess",
                "proxy_headers": {
                    "X-Custom": "1"
                },
                "inbounds": [
                    {
                        "listen": "0.0.0.0",
                        "port": "1080",
                        "protocol": "tunnel",
                        "settings": {}
                    }
                ],
                "base_config": {
                    "protocol": "vmess",
                    "path": "SECURE-FREE-SURF",
                    "security": "tls",
                    "network": "ws"
                }
            },
        )

        self.assertEqual(response.status_code, 200)
        config = response.json()["config"]

        inbound = config["inbounds"][0]
        self.assertEqual(inbound["protocol"], "dokodemo-door")
        self.assertEqual(inbound["settings"]["network"], "tcp,udp")
        self.assertTrue(inbound["settings"]["followRedirect"])
        self.assertEqual(inbound["settings"]["address"], "127.0.0.1")

        ws_settings = config["outbounds"][0]["streamSettings"]["wsSettings"]
        self.assertEqual(ws_settings["path"], "/SECURE-FREE-SURF")

        headers = config["outbounds"][1]["settings"]["headers"]
        self.assertEqual(headers["Host"], "panel.example.com:443")
        self.assertEqual(headers["X-Custom"], "1")
        self.assertIn("X-iorg-bsid", headers)
        self._assert_routing_outbound_consistency(config)

    def test_generate_zero_rating_config_accepts_custom_routing_rule_when_outbound_exists(self) -> None:
        client = _build_client()
        response = client.post(
            "/api/zero-rating/generate-config",
            json={
                "server": "panel.example.com",
                "port": 443,
                "sni": "panel.example.com",
                "services": ["facebook_meta"],
                "extra_outbounds": [
                    {
                        "tag": "custom-egress",
                        "protocol": "freedom",
                    }
                ],
                "extra_routing_rules": [
                    {
                        "type": "field",
                        "domain": ["example.com"],
                        "outboundTag": "custom-egress",
                    }
                ],
                "base_config": {
                    "protocol": "vless",
                    "uuid": "85a396f5-48ac-4dc3-a41b-f7bcb7bf6d87",
                    "path": "SECURE-FFREE-SURF",
                    "security": "tls",
                    "network": "ws",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        config = response.json()["config"]
        self._assert_routing_outbound_consistency(config)

        outbound_tags = [
            str(row.get("tag") or "").strip()
            for row in config["outbounds"]
            if isinstance(row, dict)
        ]
        self.assertIn("custom-egress", outbound_tags)
        self.assertTrue(
            any(
                isinstance(row, dict)
                and str(row.get("outboundTag") or "").strip() == "custom-egress"
                for row in config["routing"]["rules"]
            )
        )

    def test_generate_zero_rating_config_rejects_unknown_routing_outbound_tag(self) -> None:
        client = _build_client()
        response = client.post(
            "/api/zero-rating/generate-config",
            json={
                "server": "panel.example.com",
                "port": 443,
                "sni": "panel.example.com",
                "services": ["facebook_meta"],
                "extra_routing_rules": [
                    {
                        "type": "field",
                        "domain": ["example.com"],
                        "outboundTag": "ghost-egress",
                    }
                ],
                "base_config": {
                    "protocol": "vless",
                    "uuid": "85a396f5-48ac-4dc3-a41b-f7bcb7bf6d87",
                    "path": "SECURE-FFREE-SURF",
                    "security": "tls",
                    "network": "ws",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        detail = response.json().get("detail", "")
        self.assertIn("routing outboundTag inconnu", detail)
        self.assertIn("ghost-egress", detail)


if __name__ == "__main__":
    unittest.main()