from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable


@dataclass(slots=True)
class ProvisioningResult:
    engine: str
    action: str
    configured: bool
    ok: bool
    message: str = ""
    exit_code: int | None = None

    def __await__(self):
        async def _return_self() -> ProvisioningResult:
            return self

        return _return_self().__await__()

    def as_dict(self) -> dict[str, Any]:
        payload = {
            "engine": self.engine,
            "action": self.action,
            "configured": self.configured,
            "ok": self.ok,
            "message": self.message,
        }
        if self.exit_code is not None:
            payload["exit_code"] = int(self.exit_code)
        return payload


class ProvisioningRuntimeError(RuntimeError):
    def __init__(self, result: ProvisioningResult) -> None:
        self.result = result
        super().__init__(result.message or "Provisioning failed.")


class CommandProvisioner:
    def __init__(
        self,
        *,
        cfg: Any,
        engine_name: str,
        label: str,
        enabled: bool,
        enforce: bool,
        timeout_seconds: int,
        password_field: str,
        upsert_command: str,
        disable_command: str,
        runner: Callable[..., Any] | None = None,
    ) -> None:
        self.cfg = cfg
        self.engine_name = str(engine_name or "").strip()
        self.label = str(label or self.engine_name).strip() or self.engine_name
        self._runner = runner
        self.enabled = bool(enabled)
        self.enforce = bool(enforce)
        self.timeout_seconds = max(1, int(timeout_seconds or 20))
        self.password_field = str(password_field or "service_password").strip() or "service_password"
        self.upsert_command = str(upsert_command or "").strip()
        self.disable_command = str(disable_command or "").strip()

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._execute("upsert", self.upsert_command, user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._execute("disable", self.disable_command, user, reason=reason)

    def action_status(self, action: str = "upsert") -> dict[str, Any]:
        action_name = "disable" if str(action or "").strip().lower() == "disable" else "upsert"
        has_upsert = bool(self.upsert_command)
        has_disable = bool(self.disable_command)
        command_configured = has_disable if action_name == "disable" else has_upsert
        configured = bool(self.enabled and command_configured)
        if configured:
            message = (
                f"Provisioning {self.label} pret pour la desactivation."
                if action_name == "disable"
                else f"Provisioning {self.label} pret."
            )
        elif self.enabled:
            missing_label = "disable" if action_name == "disable" else "upsert"
            message = f"Provisioning {self.label} actif mais commande {missing_label} absente."
        else:
            message = f"Provisioning {self.label} désactivé."
        return {
            "engine": self.engine_name,
            "display_name": self.label,
            "source": "provisioning",
            "managed_by": "application",
            "configured": configured,
            "ok": configured,
            "enabled": self.enabled,
            "enforce": self.enforce,
            "message": message,
            "raw": {
                "timeout_seconds": int(self.timeout_seconds),
                "password_field": self.password_field,
                "has_upsert_command": has_upsert,
                "has_disable_command": has_disable,
            },
        }

    def status_dict(self) -> dict[str, Any]:
        return self.action_status("upsert")

    def _password_for(self, user: dict[str, Any]) -> str:
        preferred = str(user.get(self.password_field, "") or "").strip()
        if preferred:
            return preferred
        for fallback in ("service_password", "license", "username"):
            value = str(user.get(fallback, "") or "").strip()
            if value:
                return value
        return ""

    def _extra_env(self, user: dict[str, Any]) -> dict[str, str]:
        del user
        return {}

    def _build_env(self, user: dict[str, Any], *, action: str, reason: str) -> dict[str, str]:
        env = os.environ.copy()
        password = self._password_for(user)
        env.update(
            {
                "FS_PROVISION_ENGINE": self.engine_name,
                "FS_PROVISION_ACTION": str(action or "").strip(),
                "FS_PROVISION_REASON": str(reason or "").strip(),
                "FS_PROVISION_TRIGGERED_AT": datetime.now(timezone.utc).isoformat(),
                "FS_PROVISION_USERNAME": str(user.get("username", "") or "").strip(),
                "FS_PROVISION_PASSWORD": password,
                "FS_PROVISION_LICENSE": str(user.get("license", "") or "").strip(),
                "FS_PROVISION_UUID": str(user.get("uuid_secondary", "") or "").strip(),
                "FS_PROVISION_USER_TYPE": str(user.get("type", "") or "").strip(),
                "FS_PROVISION_STATUS": str(user.get("status", "") or "").strip(),
                "FS_PROVISION_EXPIRATION": str(user.get("expiration", "") or "").strip(),
                "FS_PROVISION_NOTES": str(user.get("notes", "") or "").strip(),
                "FS_PROVISION_PANEL_HOST": str(getattr(self.cfg, "PANEL_PUBLIC_HOST", "") or "").strip(),
            }
        )
        env.update(self._extra_env(user))
        return env

    def _result(self, *, action: str, configured: bool, ok: bool, message: str, exit_code: int | None = None) -> ProvisioningResult:
        return ProvisioningResult(
            engine=self.engine_name,
            action=action,
            configured=configured,
            ok=ok,
            message=str(message or "").strip(),
            exit_code=exit_code,
        )

    def _decode_output(self, value: Any) -> str:
        if isinstance(value, bytes):
            try:
                return value.decode().strip()
            except Exception:
                return value.decode(errors="ignore").strip()
        return str(value or "").strip()

    def _execute(self, action: str, command: str, user: dict[str, Any], *, reason: str) -> ProvisioningResult:
        if not self.enabled:
            return self._result(
                action=action,
                configured=False,
                ok=True,
                message=f"Provisioning {self.label} désactivé.",
            )

        if not command:
            return self._result(
                action=action,
                configured=False,
                ok=True,
                message=f"Provisioning {self.label} action {action} non configurée.",
            )

        username = str(user.get("username", "") or "").strip()
        if not username:
            result = self._result(
                action=action,
                configured=True,
                ok=False,
                message=f"Provisioning {self.label} impossible sans username.",
            )
            if self.enforce:
                raise ProvisioningRuntimeError(result)
            return result

        env = self._build_env(user, action=action, reason=reason)
        kwargs = {
            "env": env,
            "timeout": self.timeout_seconds,
        }

        if callable(self._runner):
            kwargs.update(
                {
                    "stdout": subprocess.PIPE,
                    "stderr": subprocess.PIPE,
                    "text": True,
                }
            )
            command_runner = self._runner
        else:
            kwargs.update(
                {
                    "shell": True,
                    "capture_output": True,
                    "text": True,
                }
            )
            command_runner = subprocess.run

        try:
            proc = command_runner(command, **kwargs)
        except subprocess.TimeoutExpired:
            result = self._result(
                action=action,
                configured=True,
                ok=False,
                message=f"Provisioning {self.label} expire.",
            )
            if self.enforce:
                raise ProvisioningRuntimeError(result)
            return result
        except Exception as exc:
            result = self._result(
                action=action,
                configured=True,
                ok=False,
                message=f"Provisioning {self.label} indisponible: {exc}",
            )
            if self.enforce:
                raise ProvisioningRuntimeError(result)
            return result

        return_code = int(getattr(proc, "returncode", 1) or 0)
        ok = return_code == 0
        stdout = self._decode_output(getattr(proc, "stdout", ""))
        stderr = self._decode_output(getattr(proc, "stderr", ""))
        message = stdout or stderr or (
            f"Provisioning {self.label} synchronise." if ok else f"Commande de provisioning {self.label} en echec."
        )
        result = self._result(
            action=action,
            configured=True,
            ok=ok,
            message=message,
            exit_code=return_code,
        )
        if not ok and self.enforce:
            raise ProvisioningRuntimeError(result)
        return result


class SSHDropbearProvisioner(CommandProvisioner):
    def __init__(self, *, cfg: Any, runner: Callable[..., Any] | None = None) -> None:
        super().__init__(
            cfg=cfg,
            engine_name="ssh_dropbear",
            label="SSH/Dropbear",
            enabled=bool(getattr(cfg, "SSH_PROVISION_ENABLED", False)),
            enforce=bool(getattr(cfg, "SSH_PROVISION_ENFORCE", False)),
            timeout_seconds=int(getattr(cfg, "SSH_PROVISION_TIMEOUT_SECONDS", 20) or 20),
            password_field=str(getattr(cfg, "SSH_PROVISION_PASSWORD_FIELD", "service_password") or "service_password"),
            upsert_command=str(getattr(cfg, "SSH_PROVISION_UPSERT_COMMAND", "") or ""),
            disable_command=str(getattr(cfg, "SSH_PROVISION_DISABLE_COMMAND", "") or ""),
            runner=runner,
        )

    def _extra_env(self, user: dict[str, Any]) -> dict[str, str]:
        del user
        dropbear_ports = getattr(self.cfg, "DROPBEAR_PORTS", []) or []
        return {
            "FS_PROVISION_SSH_HOST": str(getattr(self.cfg, "SSH_HOST", "") or "").strip(),
            "FS_PROVISION_SSH_PORT": str(int(getattr(self.cfg, "SSH_PORT", 22) or 22)),
            "FS_PROVISION_DROPBEAR_HOST": str(getattr(self.cfg, "DROPBEAR_HOST", "") or "").strip(),
            "FS_PROVISION_DROPBEAR_PORTS": ",".join(str(int(port)) for port in dropbear_ports if int(port) > 0),
        }


class Hysteria2Provisioner(CommandProvisioner):
    def __init__(self, *, cfg: Any, runner: Callable[..., Any] | None = None) -> None:
        super().__init__(
            cfg=cfg,
            engine_name="hysteria2",
            label="Hysteria2",
            enabled=bool(getattr(cfg, "HYSTERIA_PROVISION_ENABLED", False)),
            enforce=bool(getattr(cfg, "HYSTERIA_PROVISION_ENFORCE", False)),
            timeout_seconds=int(getattr(cfg, "HYSTERIA_PROVISION_TIMEOUT_SECONDS", 20) or 20),
            password_field=str(getattr(cfg, "HYSTERIA_PROVISION_PASSWORD_FIELD", "service_password") or "service_password"),
            upsert_command=str(getattr(cfg, "HYSTERIA_PROVISION_UPSERT_COMMAND", "") or ""),
            disable_command=str(getattr(cfg, "HYSTERIA_PROVISION_DISABLE_COMMAND", "") or ""),
            runner=runner,
        )

    def _extra_env(self, user: dict[str, Any]) -> dict[str, str]:
        password = self._password_for(user)
        return {
            "FS_PROVISION_HYSTERIA_HOST": str(getattr(self.cfg, "HYSTERIA_HOST", "") or "").strip(),
            "FS_PROVISION_HYSTERIA_PORT": str(int(getattr(self.cfg, "HYSTERIA_PORT", 8443) or 8443)),
            "FS_PROVISION_HYSTERIA_SNI": str(getattr(self.cfg, "HYSTERIA_SNI", "") or "").strip(),
            "FS_PROVISION_HYSTERIA_AUTH": password,
            "FS_PROVISION_HYSTERIA_SERVER_AUTH": str(getattr(self.cfg, "HYSTERIA_PASS", "") or "").strip(),
        }


class SlowDNSProvisioner(CommandProvisioner):
    def __init__(self, *, cfg: Any, runner: Callable[..., Any] | None = None) -> None:
        super().__init__(
            cfg=cfg,
            engine_name="slowdns",
            label="SlowDNS/DNSTT",
            enabled=bool(getattr(cfg, "SLOWDNS_PROVISION_ENABLED", False)),
            enforce=bool(getattr(cfg, "SLOWDNS_PROVISION_ENFORCE", False)),
            timeout_seconds=int(getattr(cfg, "SLOWDNS_PROVISION_TIMEOUT_SECONDS", 20) or 20),
            password_field=str(getattr(cfg, "SLOWDNS_PROVISION_PASSWORD_FIELD", "service_password") or "service_password"),
            upsert_command=str(getattr(cfg, "SLOWDNS_PROVISION_UPSERT_COMMAND", "") or ""),
            disable_command=str(getattr(cfg, "SLOWDNS_PROVISION_DISABLE_COMMAND", "") or ""),
            runner=runner,
        )

    def _extra_env(self, user: dict[str, Any]) -> dict[str, str]:
        password = self._password_for(user)
        return {
            "FS_PROVISION_SLOWDNS_HOST": str(getattr(self.cfg, "SLOWDNS_SERVER_HOST", "") or "").strip(),
            "FS_PROVISION_SLOWDNS_DOMAIN": str(getattr(self.cfg, "SLOWDNS_DOMAIN", "") or "").strip(),
            "FS_PROVISION_SLOWDNS_NS_HOST": str(getattr(self.cfg, "SLOWDNS_NS_HOST", "") or "").strip(),
            "FS_PROVISION_SLOWDNS_PORT": str(int(getattr(self.cfg, "SLOWDNS_PORT", 53) or 53)),
            "FS_PROVISION_SLOWDNS_LOCAL_PORT": str(int(getattr(self.cfg, "SLOWDNS_LOCAL_PORT", 7000) or 7000)),
            "FS_PROVISION_SLOWDNS_PUBKEY": str(getattr(self.cfg, "SLOWDNS_PUBKEY", "") or "").strip(),
            "FS_PROVISION_SLOWDNS_PASSWORD": password,
        }


class DNSTTProvisioner(CommandProvisioner):
    """Moteur DNSTT reellement distinct de SlowDNS (variables de config, port et
    domaine propres -- avant cette classe, DNSTT etait entierement confondu
    avec SlowDNS dans le code). Desactive par defaut (DNSTT_PROVISION_ENABLED)
    tant qu'aucun binaire dnstt-server n'est reellement deploye et configure."""

    def __init__(self, *, cfg: Any, runner: Callable[..., Any] | None = None) -> None:
        super().__init__(
            cfg=cfg,
            engine_name="dnstt",
            label="DNSTT",
            enabled=bool(getattr(cfg, "DNSTT_PROVISION_ENABLED", False)),
            enforce=bool(getattr(cfg, "DNSTT_PROVISION_ENFORCE", False)),
            timeout_seconds=int(getattr(cfg, "DNSTT_PROVISION_TIMEOUT_SECONDS", 20) or 20),
            password_field=str(getattr(cfg, "DNSTT_PROVISION_PASSWORD_FIELD", "service_password") or "service_password"),
            upsert_command=str(getattr(cfg, "DNSTT_PROVISION_UPSERT_COMMAND", "") or ""),
            disable_command=str(getattr(cfg, "DNSTT_PROVISION_DISABLE_COMMAND", "") or ""),
            runner=runner,
        )

    def _extra_env(self, user: dict[str, Any]) -> dict[str, str]:
        password = self._password_for(user)
        return {
            "FS_PROVISION_DNSTT_HOST": str(getattr(self.cfg, "DNSTT_SERVER_HOST", "") or "").strip(),
            "FS_PROVISION_DNSTT_DOMAIN": str(getattr(self.cfg, "DNSTT_DOMAIN", "") or "").strip(),
            "FS_PROVISION_DNSTT_NS_HOST": str(getattr(self.cfg, "DNSTT_NS_HOST", "") or "").strip(),
            "FS_PROVISION_DNSTT_PORT": str(int(getattr(self.cfg, "DNSTT_PORT", 5300) or 5300)),
            "FS_PROVISION_DNSTT_LOCAL_PORT": str(int(getattr(self.cfg, "DNSTT_LOCAL_PORT", 7001) or 7001)),
            "FS_PROVISION_DNSTT_PUBKEY": str(getattr(self.cfg, "DNSTT_PUBKEY", "") or "").strip(),
            "FS_PROVISION_DNSTT_PASSWORD": password,
        }


class ZiVPNUDPProvisioner(CommandProvisioner):
    def __init__(self, *, cfg: Any, runner: Callable[..., Any] | None = None) -> None:
        super().__init__(
            cfg=cfg,
            engine_name="zivpn_udp",
            label="ZiVPN UDP",
            enabled=bool(getattr(cfg, "ZIVPN_UDP_PROVISION_ENABLED", False)),
            enforce=bool(getattr(cfg, "ZIVPN_UDP_PROVISION_ENFORCE", False)),
            timeout_seconds=int(getattr(cfg, "ZIVPN_UDP_PROVISION_TIMEOUT_SECONDS", 20) or 20),
            password_field=str(getattr(cfg, "ZIVPN_UDP_PROVISION_PASSWORD_FIELD", "service_password") or "service_password"),
            upsert_command=str(getattr(cfg, "ZIVPN_UDP_PROVISION_UPSERT_COMMAND", "") or ""),
            disable_command=str(getattr(cfg, "ZIVPN_UDP_PROVISION_DISABLE_COMMAND", "") or ""),
            runner=runner,
        )

    def _extra_env(self, user: dict[str, Any]) -> dict[str, str]:
        auth_token = self._password_for(user)
        public_port = int(
            getattr(self.cfg, "ZIVPN_UDP_PUBLIC_PORT", getattr(self.cfg, "ZIVPN_UDP_PORT", 5667)) or 5667
        )
        return {
            "FS_PROVISION_ZIVPN_UDP_HOST": str(getattr(self.cfg, "ZIVPN_UDP_HOST", "") or "").strip(),
            "FS_PROVISION_ZIVPN_UDP_PORT": str(int(getattr(self.cfg, "ZIVPN_UDP_PORT", 5667) or 5667)),
            "FS_PROVISION_ZIVPN_UDP_PUBLIC_PORT": str(public_port),
            "FS_PROVISION_ZIVPN_UDP_SNI": str(getattr(self.cfg, "ZIVPN_UDP_SNI", "") or "").strip(),
            "FS_PROVISION_ZIVPN_UDP_AUTH": auth_token,
            "FS_PROVISION_ZIVPN_UDP_FORWARD_RANGE": str(
                getattr(self.cfg, "ZIVPN_UDP_FORWARD_RANGE", "") or ""
            ).strip(),
        }


class XUIProvisioner:
    """Pousse vers 3x-ui l'UUID maitre genere par le panel (uuid_secondary).

    Le panel reste la source de verite pour l'UUID : cette classe ne genere
    jamais d'UUID elle-meme, elle se contente de creer/mettre a jour le client
    correspondant dans l'inbound 3x-ui configure, en s'appuyant sur l'UUID
    deja present dans user["uuid_secondary"]. L'UUID de 3x-ui n'est donc
    jamais une source independante : il vient uniquement s'aligner sur celui
    du panel.
    """

    engine_name = "xui"
    label = "3x-ui"

    def __init__(self, *, cfg: Any, client_factory: Callable[..., Any] | None = None) -> None:
        self.cfg = cfg
        self.enabled = bool(getattr(cfg, "XUI_PROVISION_ENABLED", False))
        self.enforce = bool(getattr(cfg, "XUI_PROVISION_ENFORCE", False))
        self.timeout_seconds = max(1, int(getattr(cfg, "XUI_PROVISION_TIMEOUT_SECONDS", 20) or 20))
        self.inbound_id = int(getattr(cfg, "XUI_INBOUND_ID", 0) or 0)
        self.base_url = str(getattr(cfg, "XUI_BASE_URL", "") or "").strip().rstrip("/")
        self.username = str(getattr(cfg, "XUI_USERNAME", "") or "").strip()
        self.password = str(getattr(cfg, "XUI_PASSWORD", "") or "").strip()
        self._client_factory = client_factory

    def _configured(self) -> bool:
        return bool(self.base_url and self.username and self.password and self.inbound_id)

    def action_status(self, action: str = "upsert") -> dict[str, Any]:
        action_name = "disable" if str(action or "").strip().lower() == "disable" else "upsert"
        configured = bool(self.enabled and self._configured())
        if configured:
            message = (
                "Provisioning 3x-ui pret pour la desactivation."
                if action_name == "disable"
                else "Provisioning 3x-ui pret."
            )
        elif self.enabled:
            message = "Provisioning 3x-ui actif mais URL/identifiants/inbound manquants."
        else:
            message = "Provisioning 3x-ui desactive."
        return {
            "engine": self.engine_name,
            "display_name": self.label,
            "source": "provisioning",
            "managed_by": "application",
            "configured": configured,
            "ok": configured,
            "enabled": self.enabled,
            "enforce": self.enforce,
            "message": message,
            "raw": {
                "timeout_seconds": int(self.timeout_seconds),
                "inbound_id": self.inbound_id,
                "has_base_url": bool(self.base_url),
                "has_credentials": bool(self.username and self.password),
            },
        }

    def status_dict(self) -> dict[str, Any]:
        return self.action_status("upsert")

    def _client(self) -> Any:
        if callable(self._client_factory):
            return self._client_factory(timeout=self.timeout_seconds)
        import httpx

        return httpx.Client(timeout=self.timeout_seconds, verify=False, follow_redirects=True)

    def _login(self, client: Any) -> bool:
        for path in ("/login", "/panel/login"):
            try:
                resp = client.post(f"{self.base_url}{path}", data={"username": self.username, "password": self.password})
            except Exception:
                continue
            if resp.status_code >= 400:
                continue
            try:
                payload = resp.json()
            except Exception:
                return True
            if isinstance(payload, dict) and payload.get("success") is False:
                continue
            return True
        return False

    @staticmethod
    def _expiry_time_ms(expiration: Any) -> int:
        text = str(expiration or "").strip()
        if not text:
            return 0
        try:
            from datetime import date, datetime, timezone as _tz
            parsed = date.fromisoformat(text[:10])
            dt = datetime(parsed.year, parsed.month, parsed.day, 23, 59, 59, tzinfo=_tz.utc)
            return int(dt.timestamp() * 1000)
        except Exception:
            return 0

    @staticmethod
    def _total_gb_bytes(quota_gb: Any) -> int:
        try:
            value = float(quota_gb)
        except (TypeError, ValueError):
            return 0
        if value <= 0:
            return 0
        return int(value * 1024 * 1024 * 1024)

    def _client_payload(self, user: dict[str, Any], *, enable: bool) -> dict[str, Any]:
        uid = str(user.get("uuid_secondary", "") or "").strip()
        username = str(user.get("username", "") or "").strip()
        return {
            "id": uid,
            "email": username or uid[:8],
            "enable": bool(enable),
            "flow": "",
            "limitIp": int(user.get("limit_ip", 0) or 0),
            "totalGB": self._total_gb_bytes(user.get("quota_gb")),
            "expiryTime": self._expiry_time_ms(user.get("expiration")),
        }

    def _parse_result(self, resp: Any, *, default_ok_message: str) -> tuple[bool, str]:
        if resp.status_code >= 400:
            return False, f"3x-ui HTTP {resp.status_code}."
        try:
            payload = resp.json()
        except Exception:
            return True, default_ok_message
        if isinstance(payload, dict):
            success = payload.get("success", True)
            msg = str(payload.get("msg", "") or "").strip()
            if success:
                return True, msg or default_ok_message
            return False, msg or "3x-ui a refuse l'operation."
        return True, default_ok_message

    def _add_client(self, client: Any, payload: dict[str, Any]) -> tuple[bool, str]:
        body = {"id": self.inbound_id, "settings": json.dumps({"clients": [payload]})}
        try:
            resp = client.post(f"{self.base_url}/panel/api/inbounds/addClient", json=body)
        except Exception as exc:
            return False, f"addClient indisponible: {exc}"
        return self._parse_result(resp, default_ok_message="Client 3x-ui cree.")

    def _update_client(self, client: Any, uid: str, payload: dict[str, Any]) -> tuple[bool, str]:
        body = {"id": self.inbound_id, "settings": json.dumps({"clients": [payload]})}
        try:
            resp = client.post(f"{self.base_url}/panel/api/inbounds/updateClient/{uid}", json=body)
        except Exception as exc:
            return False, f"updateClient indisponible: {exc}"
        return self._parse_result(resp, default_ok_message="Client 3x-ui synchronise.")

    def _execute(self, action: str, user: dict[str, Any], *, reason: str) -> ProvisioningResult:
        del reason
        if not self.enabled:
            return ProvisioningResult(
                engine=self.engine_name, action=action, configured=False, ok=True,
                message="Provisioning 3x-ui desactive.",
            )
        if not self._configured():
            return ProvisioningResult(
                engine=self.engine_name, action=action, configured=False, ok=True,
                message="Provisioning 3x-ui non configure (URL/identifiants/inbound manquants).",
            )

        uid = str(user.get("uuid_secondary", "") or "").strip()
        if not uid:
            result = ProvisioningResult(
                engine=self.engine_name, action=action, configured=True, ok=False,
                message="Provisioning 3x-ui impossible sans uuid_secondary (UUID maitre du panel).",
            )
            if self.enforce:
                raise ProvisioningRuntimeError(result)
            return result

        try:
            with self._client() as client:
                if not self._login(client):
                    raise RuntimeError("Echec authentification 3x-ui.")
                if action == "disable":
                    ok, message = self._update_client(client, uid, self._client_payload(user, enable=False))
                else:
                    payload = self._client_payload(user, enable=True)
                    ok, message = self._add_client(client, payload)
                    if not ok:
                        ok, message = self._update_client(client, uid, payload)
        except Exception as exc:
            result = ProvisioningResult(
                engine=self.engine_name, action=action, configured=True, ok=False,
                message=f"Provisioning 3x-ui indisponible: {exc}",
            )
            if self.enforce:
                raise ProvisioningRuntimeError(result)
            return result

        result = ProvisioningResult(engine=self.engine_name, action=action, configured=True, ok=ok, message=message)
        if not ok and self.enforce:
            raise ProvisioningRuntimeError(result)
        return result

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._execute("upsert", user, reason=reason)

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        return self._execute("disable", user, reason=reason)


def create_xui_provisioner(
    *,
    cfg: Any,
    client_factory: Callable[..., Any] | None = None,
) -> XUIProvisioner:
    return XUIProvisioner(cfg=cfg, client_factory=client_factory)


def create_ssh_dropbear_provisioner(
    *,
    cfg: Any,
    runner: Callable[..., Any] | None = None,
) -> SSHDropbearProvisioner:
    return SSHDropbearProvisioner(cfg=cfg, runner=runner)


def create_hysteria2_provisioner(
    *,
    cfg: Any,
    runner: Callable[..., Any] | None = None,
) -> Hysteria2Provisioner:
    return Hysteria2Provisioner(cfg=cfg, runner=runner)


def create_slowdns_provisioner(
    *,
    cfg: Any,
    runner: Callable[..., Any] | None = None,
) -> SlowDNSProvisioner:
    return SlowDNSProvisioner(cfg=cfg, runner=runner)


def create_dnstt_provisioner(
    *,
    cfg: Any,
    runner: Callable[..., Any] | None = None,
) -> DNSTTProvisioner:
    return DNSTTProvisioner(cfg=cfg, runner=runner)


def create_zivpn_udp_provisioner(
    *,
    cfg: Any,
    runner: Callable[..., Any] | None = None,
) -> ZiVPNUDPProvisioner:
    return ZiVPNUDPProvisioner(cfg=cfg, runner=runner)


def list_provisioning_backends(*provisioners: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for provisioner in provisioners:
        status_dict = getattr(provisioner, "status_dict", None)
        if not callable(status_dict):
            continue
        try:
            payload = status_dict()
        except Exception:
            continue
        if isinstance(payload, dict):
            items.append(payload)
    return items
