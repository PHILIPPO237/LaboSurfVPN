import unittest
from types import SimpleNamespace

from app.core.provisioning import Hysteria2Provisioner, ProvisioningRuntimeError, SSHDropbearProvisioner, SlowDNSProvisioner


class ProvisioningTests(unittest.TestCase):
    def _cfg(self, **overrides):
        payload = {
            "SSH_PROVISION_ENABLED": True,
            "SSH_PROVISION_ENFORCE": False,
            "SSH_PROVISION_TIMEOUT_SECONDS": 15,
            "SSH_PROVISION_PASSWORD_FIELD": "license",
            "SSH_PROVISION_UPSERT_COMMAND": "sync-user",
            "SSH_PROVISION_DISABLE_COMMAND": "disable-user",
            "SSH_HOST": "ssh.example.com",
            "SSH_PORT": 22,
            "DROPBEAR_HOST": "ssh.example.com",
            "DROPBEAR_PORTS": [143, 100, 90],
            "HYSTERIA_PROVISION_ENABLED": True,
            "HYSTERIA_PROVISION_ENFORCE": False,
            "HYSTERIA_PROVISION_TIMEOUT_SECONDS": 15,
            "HYSTERIA_PROVISION_PASSWORD_FIELD": "license",
            "HYSTERIA_PROVISION_UPSERT_COMMAND": "sync-hy2",
            "HYSTERIA_PROVISION_DISABLE_COMMAND": "disable-hy2",
            "HYSTERIA_HOST": "hy.example.com",
            "HYSTERIA_PORT": 8443,
            "HYSTERIA_SNI": "hy.example.com",
            "HYSTERIA_PASS": "SERVER-AUTH",
            "SLOWDNS_PROVISION_ENABLED": True,
            "SLOWDNS_PROVISION_ENFORCE": False,
            "SLOWDNS_PROVISION_TIMEOUT_SECONDS": 15,
            "SLOWDNS_PROVISION_PASSWORD_FIELD": "license",
            "SLOWDNS_PROVISION_UPSERT_COMMAND": "sync-dnstt",
            "SLOWDNS_PROVISION_DISABLE_COMMAND": "disable-dnstt",
            "SLOWDNS_SERVER_HOST": "dns.example.com",
            "SLOWDNS_DOMAIN": "t.example.com",
            "SLOWDNS_NS_HOST": "dns.example.com",
            "SLOWDNS_PORT": 53,
            "SLOWDNS_LOCAL_PORT": 5300,
            "SLOWDNS_PUBKEY": "PUBKEY-123",
            "PANEL_PUBLIC_HOST": "laboratoire.example.com",
        }
        payload.update(overrides)
        return SimpleNamespace(**payload)

    def test_ssh_disabled_provisioner_returns_noop(self):
        service = SSHDropbearProvisioner(cfg=self._cfg(SSH_PROVISION_ENABLED=False, SSH_PROVISION_UPSERT_COMMAND=""))
        result = service.ensure_user({"username": "neo", "license": "LIC-1"}, reason="signup")
        self.assertFalse(result.configured)
        self.assertTrue(result.ok)

    def test_ssh_upsert_passes_expected_environment(self):
        calls = {}

        def runner(command, **kwargs):
            calls["command"] = command
            calls["kwargs"] = kwargs
            return SimpleNamespace(returncode=0, stdout="synced", stderr="")

        service = SSHDropbearProvisioner(cfg=self._cfg(), runner=runner)
        result = service.ensure_user(
            {
                "username": "neo",
                "license": "LIC-123",
                "uuid_secondary": "UUID-123",
                "type": "VIP",
                "status": "active",
                "expiration": "2026-04-10",
            },
            reason="signup",
        )

        self.assertTrue(result.ok)
        self.assertEqual(calls["command"], "sync-user")
        env = calls["kwargs"]["env"]
        self.assertEqual(env["FS_PROVISION_ENGINE"], "ssh_dropbear")
        self.assertEqual(env["FS_PROVISION_ACTION"], "upsert")
        self.assertEqual(env["FS_PROVISION_REASON"], "signup")
        self.assertEqual(env["FS_PROVISION_USERNAME"], "neo")
        self.assertEqual(env["FS_PROVISION_PASSWORD"], "LIC-123")
        self.assertEqual(env["FS_PROVISION_DROPBEAR_PORTS"], "143,100,90")

    def test_ssh_disable_passes_expected_environment(self):
        calls = {}

        def runner(command, **kwargs):
            calls["command"] = command
            calls["kwargs"] = kwargs
            return SimpleNamespace(returncode=0, stdout="disabled", stderr="")

        service = SSHDropbearProvisioner(cfg=self._cfg(), runner=runner)
        result = service.disable_user(
            {
                "username": "neo",
                "license": "LIC-123",
                "status": "blocked",
                "expiration": "2026-04-10",
            },
            reason="blocked_policy",
        )

        self.assertTrue(result.ok)
        self.assertEqual(calls["command"], "disable-user")
        env = calls["kwargs"]["env"]
        self.assertEqual(env["FS_PROVISION_ENGINE"], "ssh_dropbear")
        self.assertEqual(env["FS_PROVISION_ACTION"], "disable")
        self.assertEqual(env["FS_PROVISION_REASON"], "blocked_policy")
        self.assertEqual(env["FS_PROVISION_STATUS"], "blocked")

    def test_hysteria_upsert_passes_expected_environment(self):
        calls = {}

        def runner(command, **kwargs):
            calls["command"] = command
            calls["kwargs"] = kwargs
            return SimpleNamespace(returncode=0, stdout="synced", stderr="")

        service = Hysteria2Provisioner(cfg=self._cfg(), runner=runner)
        result = service.ensure_user(
            {
                "username": "neo",
                "license": "LIC-123",
                "uuid_secondary": "UUID-123",
                "type": "VIP",
                "status": "active",
                "expiration": "2026-04-10",
            },
            reason="activation_key",
        )

        self.assertTrue(result.ok)
        self.assertEqual(calls["command"], "sync-hy2")
        env = calls["kwargs"]["env"]
        self.assertEqual(env["FS_PROVISION_ENGINE"], "hysteria2")
        self.assertEqual(env["FS_PROVISION_REASON"], "activation_key")
        self.assertEqual(env["FS_PROVISION_HYSTERIA_HOST"], "hy.example.com")
        self.assertEqual(env["FS_PROVISION_HYSTERIA_PORT"], "8443")
        self.assertEqual(env["FS_PROVISION_HYSTERIA_SNI"], "hy.example.com")
        self.assertEqual(env["FS_PROVISION_HYSTERIA_AUTH"], "LIC-123")
        self.assertEqual(env["FS_PROVISION_HYSTERIA_SERVER_AUTH"], "SERVER-AUTH")

    def test_slowdns_upsert_passes_expected_environment(self):
        calls = {}

        def runner(command, **kwargs):
            calls["command"] = command
            calls["kwargs"] = kwargs
            return SimpleNamespace(returncode=0, stdout="synced", stderr="")

        service = SlowDNSProvisioner(cfg=self._cfg(), runner=runner)
        result = service.ensure_user(
            {
                "username": "neo",
                "license": "LIC-123",
                "uuid_secondary": "UUID-123",
                "type": "VIP",
                "status": "active",
                "expiration": "2026-04-10",
            },
            reason="vip_token",
        )

        self.assertTrue(result.ok)
        self.assertEqual(calls["command"], "sync-dnstt")
        env = calls["kwargs"]["env"]
        self.assertEqual(env["FS_PROVISION_ENGINE"], "slowdns")
        self.assertEqual(env["FS_PROVISION_REASON"], "vip_token")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_HOST"], "dns.example.com")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_DOMAIN"], "t.example.com")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_NS_HOST"], "dns.example.com")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_PORT"], "53")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_LOCAL_PORT"], "5300")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_PUBKEY"], "PUBKEY-123")
        self.assertEqual(env["FS_PROVISION_SLOWDNS_PASSWORD"], "LIC-123")

    def test_enforced_ssh_failure_raises(self):
        def runner(_command, **_kwargs):
            return SimpleNamespace(returncode=7, stdout="", stderr="boom")

        service = SSHDropbearProvisioner(cfg=self._cfg(SSH_PROVISION_ENFORCE=True), runner=runner)
        with self.assertRaises(ProvisioningRuntimeError):
            service.ensure_user({"username": "neo", "license": "LIC-1"}, reason="activation_key")

    def test_enforced_hysteria_failure_raises(self):
        def runner(_command, **_kwargs):
            return SimpleNamespace(returncode=9, stdout="", stderr="boom")

        service = Hysteria2Provisioner(cfg=self._cfg(HYSTERIA_PROVISION_ENFORCE=True), runner=runner)
        with self.assertRaises(ProvisioningRuntimeError):
            service.ensure_user({"username": "neo", "license": "LIC-1"}, reason="payment_approved")


    def test_enforced_slowdns_failure_raises(self):
        def runner(_command, **_kwargs):
            return SimpleNamespace(returncode=11, stdout="", stderr="boom")

        service = SlowDNSProvisioner(cfg=self._cfg(SLOWDNS_PROVISION_ENFORCE=True), runner=runner)
        with self.assertRaises(ProvisioningRuntimeError):
            service.ensure_user({"username": "neo", "license": "LIC-1"}, reason="signup")


if __name__ == "__main__":
    unittest.main()
