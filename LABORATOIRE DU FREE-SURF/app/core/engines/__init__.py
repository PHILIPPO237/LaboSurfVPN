from __future__ import annotations

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.engines.dnstt_engine import DNSTTEngineProvider
from app.core.engines.hysteria_engine import HysteriaEngineProvider
from app.core.engines.slowdns_engine import SlowDNSEngineProvider
from app.core.engines.ssh_dropbear_engine import SSHDropbearEngineProvider
from app.core.engines.xray_engine import XrayEngineProvider
from app.core.engines.zivpn_engine import ZiVPNEngineProvider

__all__ = [
    "EngineProvider",
    "VPNConfig",
    "XrayEngineProvider",
    "HysteriaEngineProvider",
    "SlowDNSEngineProvider",
    "DNSTTEngineProvider",
    "ZiVPNEngineProvider",
    "SSHDropbearEngineProvider",
]
