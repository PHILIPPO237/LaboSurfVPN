from __future__ import annotations

import html
import json
import os
import re
import secrets
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import UploadFile
from fastapi.responses import HTMLResponse


_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_.-]+")


class RuntimeSupport:
    def __init__(
        self,
        *,
        cfg: Any,
        db: Any,
        now_ts: Callable[[], str],
        read_template: Callable[[str], str | None],
        html_response: Callable[[str, int], HTMLResponse],
        generate_license_key: Callable[[], str],
        generate_uuid: Callable[[], str],
        as_bool: Callable[[Any], bool],
        load_admin_password: Callable[[], str] | None = None,
        hash_password: Callable[[str], str] | None = None,
    ) -> None:
        self.cfg = cfg
        self.db = db
        self.now_ts = now_ts
        self.read_template = read_template
        self.html_response = html_response
        self.generate_license_key = generate_license_key
        self.generate_uuid = generate_uuid
        self.as_bool = as_bool
        self.load_admin_password = load_admin_password
        self.hash_password = hash_password

    def _ensure_user_uuid(self, user: dict[str, Any]) -> str:
        current = str(user.get("uuid_secondary", "") or "").strip()
        if current:
            return current
        generated = str(self.generate_uuid() or "").strip() or str(uuid.uuid4())
        user["uuid_secondary"] = generated
        saver = getattr(getattr(self.db, "users", None), "save", None)
        if callable(saver):
            try:
                saved = saver(dict(user))
            except Exception:
                saved = None
            if isinstance(saved, dict):
                user.update(saved)
                current = str(saved.get("uuid_secondary", "") or generated).strip()
                if current:
                    return current
        return generated

    def send_recovery_email(self, email: str, username: str, recovery_token: str) -> None:
        # Email sender is not configured in this workspace.
        print(
            f"[recovery-email] to={email} user={username} token={recovery_token} at={self.now_ts()}",
            flush=True,
        )

    def _build_vless_uri(
        self,
        *,
        user_uuid: str,
        host: str,
        port: int,
        sni: str,
        path: str,
        remark: str,
        tls: bool = True,
    ) -> str:
        security = "tls" if tls else "none"
        params = {
            "encryption": "none",
            "security": security,
            "type": "ws",
            "path": path or self.cfg.DEFAULT_VLESS_PATH,
            "host": sni,
            "sni": sni,
        }
        query = "&".join(f"{key}={quote(str(value), safe='')}" for key, value in params.items())
        return f"vless://{quote(user_uuid, safe='')}@{host}:{int(port)}?{query}#{quote(remark, safe='')}"

    def _resolve_zivpn_udp_auth(self, user: dict[str, Any]) -> str:
        password_field = (
            str(getattr(self.cfg, "ZIVPN_UDP_PROVISION_PASSWORD_FIELD", "service_password") or "service_password").strip() or "service_password"
        )
        for field_name in (password_field, "service_password", "license", "username"):
            value = str(user.get(field_name, "") or "").strip()
            if value:
                return value
        return ""

    def _build_zivpn_udp_manual_string(
        self,
        *,
        auth_token: str,
        host: str,
        port: int,
        sni: str,
        remark: str,
    ) -> str:
        payload = [
            "type=zivpn_udp_manual",
            f"server={host}",
            f"port={int(port)}",
            f"auth={auth_token}",
        ]
        if sni:
            payload.append(f"sni={sni}")
        if remark:
            payload.append(f"remark={remark}")
        return "; ".join(payload)

    def build_user_configs(self, user: dict) -> list[dict]:
        if not isinstance(user, dict):
            return []

        user_type = str(user.get("type", "Gratuit") or "Gratuit").strip()
        is_admin = user_type == "ADMIN"
        user_uuid = (
            str(self.cfg.PRIMARY_3XUI_UUID or "").strip()
            if is_admin
            else self._ensure_user_uuid(user)
        )
        server = str(self.cfg.vps_address or self.cfg.PANEL_DEFAULT_HOST or self.cfg.XUI_PUBLIC_IP or "127.0.0.1").strip()
        sni = str(self.cfg.PANEL_DEFAULT_HOST or server).strip()
        port = int(self.cfg.vps_port or 443)
        path = str(self.cfg.vps_path or self.cfg.DEFAULT_VLESS_PATH or "/").strip() or "/"
        zivpn_udp_host = str(self.cfg.ZIVPN_UDP_HOST or self.cfg.UDPGW_HOST or server).strip()
        zivpn_udp_sni = str(self.cfg.ZIVPN_UDP_SNI or zivpn_udp_host or sni).strip()
        zivpn_udp_port = int(self.cfg.ZIVPN_UDP_PUBLIC_PORT or self.cfg.ZIVPN_UDP_PORT or 5667)
        zivpn_udp_auth = self._resolve_zivpn_udp_auth(user)

        configs = [
            {
                "protocol": "VLESS",
                "remark": f"{user_type} - MAIN",
                "uri": self._build_vless_uri(
                    user_uuid=user_uuid,
                    host=server,
                    port=port,
                    sni=sni,
                    path=path,
                    remark=f"{user_type}-MAIN",
                    tls=True,
                ),
            }
        ]

        if user_type in {"VIP", "Revendeur", "PREMIUM", "ADMIN"}:
            configs.append(
                {
                    "protocol": "VLESS",
                    "remark": f"{user_type} - ALT",
                    "uri": self._build_vless_uri(
                        user_uuid=user_uuid,
                        host=server,
                        port=443,
                        sni=sni,
                        path=path,
                        remark=f"{user_type}-ALT",
                        tls=True,
                    ),
                }
            )

        if user_type in {"VIP", "PREMIUM", "ADMIN"}:
            configs.append(
                {
                    "protocol": "UDP",
                    "remark": f"{user_type} - HYSTERIA2",
                    "uri": (
                        f"hysteria2://{quote(self.cfg.HYSTERIA_PASS or str(user.get('service_password', '') or '').strip() or user_uuid, safe='')}"
                        f"@{self.cfg.HYSTERIA_IP or server}:{int(self.cfg.HYSTERIA_PORT or 8443)}"
                        f"?sni={quote(self.cfg.HYSTERIA_SNI or sni, safe='')}"
                        f"#{quote(f'{user_type}-HYSTERIA2', safe='')}"
                    ),
                }
            )

        if bool(getattr(self.cfg, "ZIVPN_UDP_ENABLED", False)) and user_type in {"VIP", "PREMIUM", "ADMIN"}:
            configs.append(
                {
                    "protocol": "ZiVPN UDP",
                    "remark": f"{user_type} - ZIVPN UDP",
                    "uri": self._build_zivpn_udp_manual_string(
                        auth_token=zivpn_udp_auth,
                        host=zivpn_udp_host,
                        port=zivpn_udp_port,
                        sni=zivpn_udp_sni,
                        remark=f"{user_type}-ZIVPN-UDP",
                    ),
                }
            )

        return configs

    def build_zero_rating_services_payload(self) -> dict[str, dict[str, Any]]:
        raw = getattr(self.cfg, "_ZERO_RATING_SERVICES", {})
        out: dict[str, dict[str, Any]] = {}
        if not isinstance(raw, dict):
            return out

        for key, value in raw.items():
            if not isinstance(value, dict):
                continue
            label = str(value.get("label") or value.get("service") or key).strip() or str(key)
            domains = value.get("domains", [])
            if not isinstance(domains, list):
                domains = []
            out[str(key)] = {
                "label": label,
                "service": str(value.get("service") or label),
                "domains": [str(domain).strip() for domain in domains if str(domain).strip()],
                "priority": str(value.get("priority", "MEDIUM") or "MEDIUM").upper(),
                "enabled": self.as_bool(value.get("enabled", True)),
            }
        return out

    def _resolve_admin_bootstrap_secret(self) -> str:
        if callable(self.load_admin_password):
            try:
                secret = str(self.load_admin_password() or "").strip()
            except Exception:
                secret = ""
            if secret:
                return secret
        configured = str(getattr(self.cfg, "ADMIN_LICENSE", "") or "").strip()
        return configured or self.generate_license_key()

    def _resolve_admin_bootstrap_password(self) -> str:
        if callable(self.load_admin_password):
            try:
                return str(self.load_admin_password() or "").strip()
            except Exception:
                return ""
        return ""

    def _hash_admin_bootstrap_password(self, raw_password: str) -> str:
        password = str(raw_password or "").strip()
        if not password or not callable(self.hash_password):
            return ""
        try:
            return str(self.hash_password(password) or "").strip()
        except Exception as exc:
            # Ne JAMAIS avaler cette erreur en silence : c'est exactement ce qui
            # a rendu ce bug tres difficile a diagnostiquer (le mot de passe
            # admin restait vide sans aucune trace visible du pourquoi).
            print(f"[startup] ECHEC hachage mot de passe admin : {exc}. "
                  f"Verifie la compatibilite bcrypt/passlib (voir requirements.txt).", flush=True)
            return ""

    def _get_user_by_license(self, license_key: str) -> dict[str, Any] | None:
        candidate = str(license_key or "").strip()
        if not candidate:
            return None
        getter = getattr(getattr(self.db, "users", None), "get_by_license", None)
        if not callable(getter):
            return None
        try:
            row = getter(candidate)
        except Exception:
            return None
        return row if isinstance(row, dict) else None

    def _resolve_unique_admin_license(
        self,
        preferred_license: str,
        *,
        current_user_id: int = 0,
        current_license: str = "",
    ) -> str:
        checked: set[str] = set()
        for raw_candidate in (preferred_license, current_license):
            candidate = str(raw_candidate or "").strip()
            if not candidate or candidate in checked:
                continue
            checked.add(candidate)
            owner = self._get_user_by_license(candidate)
            if not owner or int(owner.get("id", 0) or 0) == int(current_user_id or 0):
                return candidate

        for _ in range(5):
            candidate = str(self.generate_license_key() or "").strip() or f"LIC-{secrets.token_hex(8).upper()}"
            if candidate in checked:
                continue
            checked.add(candidate)
            owner = self._get_user_by_license(candidate)
            if not owner or int(owner.get("id", 0) or 0) == int(current_user_id or 0):
                print("[startup] admin bootstrap license collision detected; using a generated unique fallback.", flush=True)
                return candidate

        fallback = f"LIC-{secrets.token_hex(8).upper()}"
        print("[startup] admin bootstrap license collision detected; using a random unique fallback.", flush=True)
        return fallback

    def ensure_default_admin(self) -> None:
        admin_secret = self._resolve_admin_bootstrap_secret()
        admin_password = self._resolve_admin_bootstrap_password()
        desired_username = (os.getenv("FS_ADMIN_USERNAME") or "PHILIPPO237").strip() or "PHILIPPO237"
        admins = self.db.users.get_by_type("ADMIN")
        if admins:
            root_admin = next(
                (
                    row
                    for row in admins
                    if str(row.get("role_code", "") or "").strip() == "super_admin"
                    or int(row.get("id", 0) or 0) == 1
                ),
                None,
            )
            if isinstance(root_admin, dict):
                current_username = str(root_admin.get("username", "") or "").strip()
                root_admin_id = int(root_admin.get("id", 0) or 0)
                current_license = str(root_admin.get("license", "") or "").strip()
                root_admin["type"] = "ADMIN"
                root_admin["role_code"] = "super_admin"
                root_admin["status"] = "active"
                root_admin["default_panel_key"] = "admin"
                if str(getattr(self.cfg, "PRIMARY_3XUI_UUID", "") or "").strip():
                    root_admin["uuid_secondary"] = str(getattr(self.cfg, "PRIMARY_3XUI_UUID", "") or "").strip()
                if desired_username and current_username.lower() != desired_username.lower():
                    if current_username.lower() == desired_username.lower() or not self.db.users.username_exists(desired_username):
                        root_admin["username"] = desired_username
                if admin_secret:
                    root_admin["license"] = self._resolve_unique_admin_license(
                        admin_secret,
                        current_user_id=root_admin_id,
                        current_license=current_license,
                    )
                if admin_password and not str(root_admin.get("password_hash", "") or "").strip():
                    hashed_password = self._hash_admin_bootstrap_password(admin_password)
                    if hashed_password:
                        root_admin["password_hash"] = hashed_password
                if admin_password and not str(root_admin.get("service_password", "") or "").strip():
                    root_admin["service_password"] = admin_password
                root_admin["updated_at"] = self.now_ts()
                self.db.users.save(root_admin)
            return

        username = desired_username
        if self.db.users.username_exists(username):
            username = f"PHILIPPO237_{secrets.token_hex(2)}"
        now = self.now_ts()
        self.db.users.save(
            {
                "username": username,
                "type": "ADMIN",
                "role_code": "super_admin",
                "default_panel_key": "admin",
                "status": "active",
                "license": self._resolve_unique_admin_license(admin_secret),
                "password_hash": self._hash_admin_bootstrap_password(admin_password),
                "service_password": admin_password,
                "uuid_secondary": self.cfg.PRIMARY_3XUI_UUID,
                "recovery_secret_hash": "",
                "forbidden_attempts": 0,
                "last_forbidden_need": "",
                "last_forbidden_at": "",
                "avatar": "",
                "quota_gb": None,
                "expiration": "",
                "notes": "Bootstrap SUPER ADMIN PHILIPPO237",
                "created_at": now,
                "updated_at": now,
            }
        )

    def template_or_error(self, name: str) -> HTMLResponse:
        content = self.read_template(name)
        if content is None:
            return self.html_response(f"<h1>Erreur: {html.escape(name)} manquant</h1>", status_code=404)
        return self.html_response(content)

    def _grace_period_days_for(self, user_type: str) -> int:
        normalized = str(user_type or "").strip()
        if normalized == "Revendeur":
            return max(1, int(getattr(self.cfg, "SUBSCRIPTION_GRACE_PERIOD_RESELLER_DAYS", 7) or 7))
        if normalized in {"VIP", "PREMIUM"}:
            return max(1, int(getattr(self.cfg, "SUBSCRIPTION_GRACE_PERIOD_CLIENT_DAYS", 3) or 3))
        return max(1, int(getattr(self.cfg, "SUBSCRIPTION_GRACE_PERIOD_DAYS", 5) or 5))

    def _gauge_gradient_color(self, percent: int) -> str:
        percent = max(0, min(100, percent))
        red = (255, 79, 79)
        gold = (255, 215, 0)
        green = (57, 255, 20)
        if percent >= 50:
            ratio = (percent - 50) / 50.0
            start, end = gold, green
        else:
            ratio = percent / 50.0
            start, end = red, gold
        r = round(start[0] + (end[0] - start[0]) * ratio)
        g = round(start[1] + (end[1] - start[1]) * ratio)
        b = round(start[2] + (end[2] - start[2]) * ratio)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _subscription_gauge(self, user: dict) -> dict:
        empty = {"show": False, "percent": 0, "color": "#39ff14", "label": "", "warning": ""}
        user_type = str(user.get("type", "") or "").strip()
        if user_type in {"ADMIN", "Gratuit", ""}:
            return empty
        expiration_raw = str(user.get("expiration", "") or "").strip()
        if not expiration_raw:
            return empty
        try:
            expiration_date = date.fromisoformat(expiration_raw)
        except Exception:
            return empty

        grace_days = self._grace_period_days_for(user_type)
        today = date.today()
        days_until_expiration = (expiration_date - today).days
        days_remaining = days_until_expiration + grace_days

        if days_remaining > grace_days:
            percent = 100
        elif days_remaining <= 0:
            percent = 0
        else:
            percent = round((days_remaining / grace_days) * 100)
        percent = max(0, min(100, percent))
        color = self._gauge_gradient_color(percent)

        warning = ""
        if days_until_expiration >= 0:
            label = f"{percent}% — {days_until_expiration} jour(s) avant expiration"
        elif days_remaining > 0:
            label = f"{percent}% — Expiré, {days_remaining} jour(s) avant retrogradation"
            warning = (
                f"Votre abonnement a expiré. Renouvelez sous {days_remaining} jour(s), "
                "sinon votre compte repassera automatiquement en Gratuit."
            )
        else:
            label = "0% — Expire"

        return {"show": True, "percent": percent, "color": color, "label": label, "warning": warning}

    def _subscription_warning_html(self, user: dict) -> str:
        gauge = self._subscription_gauge(user)
        if not gauge.get("warning"):
            return ""
        return (
            '<div style="background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.4);'
            'border-radius:1rem;padding:0.9rem 1.2rem;margin:0 0 1rem 0;color:#ffb4b4;'
            'font-size:0.8rem;font-weight:600;">⚠️ ' + html.escape(gauge["warning"]) + "</div>"
        )

    def _subscription_gauge_html(self, user: dict) -> str:
        gauge = self._subscription_gauge(user)
        if not gauge.get("show"):
            return ""
        percent = gauge["percent"]
        color = gauge["color"]
        label = html.escape(gauge["label"])
        return (
            '<div style="margin:0 0 1rem 0;">'
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">'
            '<span style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:#9aa5ad;">Abonnement</span>'
            f'<span style="font-size:0.72rem;font-weight:700;color:{color};">{label}</span>'
            '</div>'
            '<div style="width:100%;height:10px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;">'
            f'<div style="width:{percent}%;height:100%;border-radius:999px;background:{color};'
            f'box-shadow:0 0 10px {color}66;transition:width 0.6s ease, background 0.6s ease;"></div>'
            '</div>'
            '</div>'
        )

    def render_panel_template(self, name: str, user: dict) -> HTMLResponse:
        content = self.read_template(name)
        if content is None:
            return self.html_response(f"<h1>Erreur: {html.escape(name)} manquant</h1>", status_code=404)
        content = content.replace("{{USERNAME}}", html.escape(str(user.get("username", "") or "")))
        content = content.replace("{{TYPE}}", html.escape(str(user.get("type", "") or "")))
        content = content.replace("{{SUBSCRIPTION_WARNING}}", self._subscription_warning_html(user))
        content = content.replace("{{SUBSCRIPTION_GAUGE}}", self._subscription_gauge_html(user))
        return self.html_response(content)

    async def save_ad_upload(self, upload: UploadFile) -> str:
        filename = _SAFE_NAME_RE.sub("_", upload.filename or "")
        ext = Path(filename).suffix.lower()
        if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            raise ValueError("Type image non supporte.")
        final_name = f"ad_{int(time.time())}_{secrets.token_hex(4)}{ext}"
        dest = self.cfg.ADS_IMG_DIR / final_name
        data = await upload.read()
        if len(data) > 5 * 1024 * 1024:
            raise ValueError("Image trop volumineuse (max 5MB).")
        dest.write_bytes(data)
        return f"/static/ads/{final_name}"

    def delete_ad_image(self, image_url: str) -> None:
        path = str(image_url or "").strip()
        if not path.startswith("/static/ads/"):
            return
        file_path = self.cfg.BASE_DIR / path.lstrip("/")
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception:
            pass

    def coerce_locations(self, value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        text = str(value or "").strip()
        if not text:
            return ["chat"]
        try:
            decoded = json.loads(text)
        except Exception:
            decoded = None
        if isinstance(decoded, list):
            out = [str(item).strip() for item in decoded if str(item).strip()]
            return out or ["chat"]
        return [item.strip() for item in text.split(",") if item.strip()] or ["chat"]

    def serialize_ads(self) -> list[dict]:
        now = time.time()
        rows = self.db.ads.get_all()
        out: list[dict] = []
        for ad in rows:
            item = dict(ad)
            item["active"] = self.as_bool(item.get("active", True))
            item["locations"] = self.coerce_locations(item.get("locations", []))
            try:
                expires_at = float(item.get("expires_at", 0) or 0)
            except Exception:
                expires_at = 0.0
            if expires_at > now:
                item["duration_hours"] = max(0, int(round((expires_at - now) / 3600)))
            else:
                item["duration_hours"] = 0
            out.append(item)
        return out


def create_runtime_support(
    *,
    cfg: Any,
    db: Any,
    now_ts: Callable[[], str],
    read_template: Callable[[str], str | None],
    html_response: Callable[[str, int], HTMLResponse],
    generate_license_key: Callable[[], str],
    generate_uuid: Callable[[], str],
    as_bool: Callable[[Any], bool],
    load_admin_password: Callable[[], str] | None = None,
    hash_password: Callable[[str], str] | None = None,
) -> RuntimeSupport:
    return RuntimeSupport(
        cfg=cfg,
        db=db,
        now_ts=now_ts,
        read_template=read_template,
        html_response=html_response,
        generate_license_key=generate_license_key,
        generate_uuid=generate_uuid,
        as_bool=as_bool,
        load_admin_password=load_admin_password,
        hash_password=hash_password,
    )
