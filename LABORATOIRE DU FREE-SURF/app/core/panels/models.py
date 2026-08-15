from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class PanelInbound:
    panel_id: Any
    name: str
    protocol: str
    host: str
    port: int
    source: str
    network: str = ""
    security: str = ""
    path: str = ""
    server_name: str = ""
    client_id: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.panel_id,
            "name": self.name,
            "remark": self.name,
            "protocol": self.protocol,
            "host": self.host,
            "port": self.port,
            "source": self.source,
            "network": self.network,
            "security": self.security,
            "path": self.path,
            "sni": self.server_name,
            "uuid": self.client_id,
            "raw": dict(self.raw),
        }