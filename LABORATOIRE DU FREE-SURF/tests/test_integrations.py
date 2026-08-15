import ipaddress
import unittest
from types import SimpleNamespace

from app.core.integrations import create_integrations


class _Provider:
    def __init__(self) -> None:
        self.calls: list[bool] = []

    async def list_inbounds_as_dicts(self, *, force_refresh: bool = False) -> list[dict]:
        self.calls.append(force_refresh)
        return [{"name": "primary", "force_refresh": force_refresh}]


class IntegrationsTests(unittest.IsolatedAsyncioTestCase):
    def _cfg(self):
        return SimpleNamespace(
            PANEL_PUBLIC_HOST="public.example.com",
            PANEL_ADMIN_HOST="panel.example.com",
            PANEL_DEFAULT_HOST="public.example.com",
            vps_address="vps.example.com",
            HYSTERIA_HOST="",
            HYSTERIA_IP="",
            HYSTERIA_PORT=8443,
            HYSTERIA_PASS="hy2-secret",
            HYSTERIA_SNI="hy2.example.com",
            SLOWDNS_DOMAIN="",
            SLOWDNS_PORT=53,
            SLOWDNS_SERVER_HOST="198.51.100.20",
            SLOWDNS_IP="198.51.100.20",
            SLOWDNS_NS_HOST="dns.example.com",
            SLOWDNS_PUBKEY="pubkey-value",
            SLOWDNS_LOCAL_PORT=7000,
            SSH_HOST="ssh.example.com",
            SSH_PORT=22,
            SSH_DEFAULT_USER="root",
            TCP_HOST="",
            TCP_PORT=80,
            DROPBEAR_HOST="dropbear.example.com",
            DROPBEAR_PORT=143,
            DROPBEAR_PORTS=[143, 100, 90],
            DROPBEAR_USER="root",
            UDPGW_HOST="udp.example.com",
            UDPGW_PORT=7300,
            UDPGW_ENABLED=True,
            XUI_PUBLIC_IP="198.51.100.10",
            _CLOUDFLARE_NETS=[ipaddress.ip_network("104.16.0.0/12")],
            _GCP_NETS=[ipaddress.ip_network("34.64.0.0/10")],
        )

    async def test_fetch_panel_inbounds_reuses_provider_instance(self):
        provider = _Provider()
        builder_calls: list[object] = []

        def builder(*, cfg):
            builder_calls.append(cfg)
            return provider

        integrations = create_integrations(cfg=self._cfg(), panel_provider_builder=builder)

        first = await integrations.fetch_panel_inbounds(force_refresh=True)
        second = await integrations.fetch_panel_inbounds(force_refresh=False)

        self.assertEqual(first[0]["name"], "primary")
        self.assertEqual(second[0]["name"], "primary")
        self.assertEqual(provider.calls, [True, False])
        self.assertEqual(len(builder_calls), 1)

    def test_normalize_host_and_network_checks_use_cfg_networks(self):
        integrations = create_integrations(cfg=self._cfg(), panel_provider_builder=lambda *, cfg: object())

        self.assertEqual(integrations.normalize_host("https://Example.com:443/path"), "example.com")
        self.assertTrue(integrations.is_cloudflare_ip("104.16.0.1"))
        self.assertTrue(integrations.is_gcp_ip("34.64.10.20"))
        self.assertFalse(integrations.is_cloudflare_ip("8.8.8.8"))

    def test_build_admin_transport_addons_uses_public_hosts_and_keeps_tcp_addon(self):
        integrations = create_integrations(cfg=self._cfg(), panel_provider_builder=lambda *, cfg: object())

        addons = integrations.build_admin_transport_addons(default_server="")

        self.assertEqual(addons[0]["host"], "public.example.com")
        self.assertEqual(addons[1]["port"], 53)
        self.assertEqual(addons[2]["protocol"], "VLESS")

    def test_list_transport_backends_exposes_external_engines(self):
        integrations = create_integrations(cfg=self._cfg(), panel_provider_builder=lambda *, cfg: object())

        backends = integrations.list_transport_backends()
        names = [item["engine"] for item in backends]

        self.assertEqual(names, ["hysteria2", "slowdns", "ssh", "dropbear", "udpgw"])
        self.assertTrue(all(item["managed_by"] == "external" for item in backends))
        self.assertEqual(backends[1]["raw"]["ns_host"], "dns.example.com")
        self.assertEqual(backends[3]["raw"]["ports"], [143, 100, 90])
        self.assertTrue(backends[4]["ok"])


if __name__ == "__main__":
    unittest.main()
