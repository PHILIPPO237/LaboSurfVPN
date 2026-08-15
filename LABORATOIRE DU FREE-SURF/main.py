from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import uvicorn

# Ensure the app directory is in the Python path
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.application import AppServices, create_application
from app.core import helpers, security
from app.core.config import cfg
from app.services.payment_providers import create_payment_providers
from app.core.database import db
from app.core.integrations import create_integrations
from app.core.provisioning import (
    create_dnstt_provisioner,
    create_hysteria2_provisioner,
    create_slowdns_provisioner,
    create_ssh_dropbear_provisioner,
    create_xui_provisioner,
    create_zivpn_udp_provisioner,
    list_provisioning_backends,
)
from app.core.engines import (
    DNSTTEngineProvider,
    HysteriaEngineProvider,
    SSHDropbearEngineProvider,
    SlowDNSEngineProvider,
    XrayEngineProvider,
    ZiVPNEngineProvider,
)
from app.core.engines.hybrid_engine import HybridEngineProvider
from app.core.vpn_orchestrator import VPNOrchestrator
from app.core.runtime_support import create_runtime_support


def _copy_public_members(target: AppServices, service: Any) -> None:
    for name in dir(service):
        if name.startswith("_"):
            continue
        try:
            value = getattr(service, name)
        except Exception:
            continue
        setattr(target, name, value)


def main() -> Any:
    """Application factory and entry point."""
    helpers_service = helpers.create_helpers(cfg=cfg)

    def hash_password(value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        from passlib.context import CryptContext
        return CryptContext(schemes=["bcrypt"], deprecated="auto").hash(text)

    runtime_support_service = create_runtime_support(
        cfg=cfg,
        db=db,
        now_ts=helpers_service.now_ts,
        read_template=helpers_service.read_template,
        html_response=helpers_service.html_response,
        generate_license_key=helpers_service.generate_license_key,
        generate_uuid=helpers_service.generate_uuid,
        as_bool=helpers_service.as_bool,
        load_admin_password=helpers_service.load_admin_password,
        hash_password=hash_password,
    )
    security_service = security.create_security(
        cfg=cfg,
        db=db,
        now_ts=helpers_service.now_ts,
        safe_next_url=helpers_service.safe_next_url,
        is_user_expired=helpers_service.is_user_expired,
    )
    integrations_service = create_integrations(cfg=cfg)

    ssh_dropbear_provisioner = create_ssh_dropbear_provisioner(cfg=cfg)
    hysteria2_provisioner = create_hysteria2_provisioner(cfg=cfg)
    slowdns_provisioner = create_slowdns_provisioner(cfg=cfg)
    dnstt_provisioner = create_dnstt_provisioner(cfg=cfg)
    zivpn_udp_provisioner = create_zivpn_udp_provisioner(cfg=cfg)
    xui_provisioner = create_xui_provisioner(cfg=cfg)
    provisioners = (
        ssh_dropbear_provisioner,
        hysteria2_provisioner,
        slowdns_provisioner,
        dnstt_provisioner,
        zivpn_udp_provisioner,
        xui_provisioner,
    )

    app_services = AppServices(cfg=cfg, db=db)
    for service in (
        helpers_service,
        runtime_support_service,
        security_service,
        integrations_service,
    ):
        _copy_public_members(app_services, service)

    # --- Payment Services ---
    payment_providers = create_payment_providers(cfg=cfg)

    def get_payment_provider(name: str):
        provider = payment_providers.get(str(name).lower())
        if not provider:
            raise ValueError(f"Le fournisseur de paiement '{name}' n'est pas configuré.")
        return provider
    app_services.get_payment_provider = get_payment_provider

    app_services.ssh_dropbear_provisioner = ssh_dropbear_provisioner
    app_services.hysteria2_provisioner = hysteria2_provisioner
    app_services.slowdns_provisioner = slowdns_provisioner
    app_services.dnstt_provisioner = dnstt_provisioner
    app_services.zivpn_udp_provisioner = zivpn_udp_provisioner
    app_services.xui_provisioner = xui_provisioner
    app_services.get_provisioners = lambda: list(provisioners)
    app_services.safe_avatar_url = helpers_service.safe_avatar_url
    app_services.list_provisioning_backends = lambda: list_provisioning_backends(*provisioners)

    # --- VPN Orchestrator (couche multi-moteurs) ---
    # Enveloppe les provisioners ci-dessus derriere l'interface EngineProvider
    # commune. Ajouter un moteur plus tard = ajouter une entree ici, rien
    # d'autre a modifier dans les routers ou l'app Labo Surf.
    engine_providers = {
        "xray": XrayEngineProvider(cfg=cfg, xui_provisioner=xui_provisioner, generate_uuid=helpers_service.generate_uuid),
        "hysteria2_standalone": HysteriaEngineProvider(cfg=cfg, provisioner=hysteria2_provisioner),
        "slowdns": SlowDNSEngineProvider(cfg=cfg, provisioner=slowdns_provisioner),
        "dnstt": DNSTTEngineProvider(cfg=cfg, provisioner=dnstt_provisioner),
        "zivpn_udp": ZiVPNEngineProvider(cfg=cfg, provisioner=zivpn_udp_provisioner),
        "ssh_dropbear": SSHDropbearEngineProvider(cfg=cfg, provisioner=ssh_dropbear_provisioner),
    }

    # --- Moteurs hybrides (tunnel exterieur + protocole interieur) ---
    # Combinaisons techniquement coherentes uniquement (voir
    # app/core/engines/hybrid_engine.py) : un tunnel de contournement
    # (SlowDNS/DNSTT/SSH) qui transporte du VLESS/Xray a l'interieur, une
    # fois le tunnel etabli. Chaque hybride reste inerte (is_configured=False)
    # tant que SES DEUX composants ne sont pas eux-memes configures.
    engine_providers["hybrid_slowdns_xray"] = HybridEngineProvider(
        outer=engine_providers["slowdns"], inner=engine_providers["xray"],
    )
    engine_providers["hybrid_dnstt_xray"] = HybridEngineProvider(
        outer=engine_providers["dnstt"], inner=engine_providers["xray"],
    )
    engine_providers["hybrid_ssh_xray"] = HybridEngineProvider(
        outer=engine_providers["ssh_dropbear"], inner=engine_providers["xray"],
    )
    vpn_orchestrator = VPNOrchestrator(
        providers=engine_providers,
        servers_repo=getattr(db, "servers", None),
        default_engine="xray",
    )
    app_services.vpn_orchestrator = vpn_orchestrator

    globals()["fetch_3xui_data"] = integrations_service.fetch_3xui_data

    return create_application(services=app_services)


# Create the app instance for Uvicorn
app = main()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=str(getattr(cfg, "UVICORN_HOST", "127.0.0.1") or "127.0.0.1"),
        port=int(getattr(cfg, "UVICORN_PORT", 8000) or 8000),
        reload=bool(getattr(cfg, "UVICORN_RELOAD", False)),
        log_level=str(getattr(cfg, "LOG_LEVEL", "info") or "info"),
    )
