from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class TransportEngineInfo:
    engine_name: str
    display_name: str
    protocol: str
    source: str = "transport"
    managed_by: str = "external"
    public: bool = True


@dataclass(slots=True)
class TransportEngineStatus:
    engine_name: str
    display_name: str
    protocol: str
    host: str
    port: int
    source: str = "transport"
    managed_by: str = "external"
    configured: bool = False
    ok: bool = False
    public: bool = True
    message: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine_name,
            "display_name": self.display_name,
            "protocol": self.protocol,
            "host": self.host,
            "port": self.port,
            "source": self.source,
            "managed_by": self.managed_by,
            "configured": self.configured,
            "ok": self.ok,
            "public": self.public,
            "message": self.message,
            "raw": dict(self.raw),
        }


class TransportEngine(ABC):
    def __init__(self, *, info: TransportEngineInfo) -> None:
        self.info = info

    @property
    def engine_name(self) -> str:
        return self.info.engine_name

    @property
    def display_name(self) -> str:
        return self.info.display_name

    @property
    def protocol(self) -> str:
        return self.info.protocol

    @property
    def public(self) -> bool:
        return self.info.public

    @abstractmethod
    def status(self) -> TransportEngineStatus:
        raise NotImplementedError

    def status_dict(self) -> dict[str, Any]:
        return self.status().as_dict()

    def public_endpoint(self, *, default_host: str = "") -> dict[str, Any] | None:
        if not self.public:
            return None

        state = self.status()
        host = str(state.host or "").strip() or str(default_host or "").strip()
        return {
            "id": f"addon_{self.engine_name}",
            "name": self.display_name,
            "protocol": self.protocol,
            "host": host,
            "port": int(state.port or 0),
            "source": state.source,
        }
