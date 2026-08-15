from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace

from .models import PanelInbound


@dataclass(slots=True)
class PanelProviderInfo:
    backend_name: str
    display_name: str
    supports_inbounds: bool = True
    supports_client_crud: bool = False
    supports_subscriptions: bool = False
    supports_templates: bool = False


class PanelProvider(ABC):
    def __init__(self, *, info: PanelProviderInfo, cache_ttl_seconds: float = 0.0) -> None:
        self.info = info
        self._cache_ttl_seconds = max(0.0, float(cache_ttl_seconds or 0.0))
        self._cached_inbounds: list[PanelInbound] = []
        self._cached_at = 0.0

    @property
    def backend_name(self) -> str:
        return self.info.backend_name

    @property
    def display_name(self) -> str:
        return self.info.display_name

    async def list_inbounds(self, *, force_refresh: bool = False) -> list[PanelInbound]:
        now = time.time()
        cache_is_fresh = (
            not force_refresh
            and self._cache_ttl_seconds > 0
            and (now - self._cached_at) < self._cache_ttl_seconds
        )
        if cache_is_fresh:
            return [replace(item) for item in self._cached_inbounds]

        items = await self._list_inbounds()
        self._cached_inbounds = list(items)
        self._cached_at = now
        return [replace(item) for item in items]

    async def list_inbounds_as_dicts(self, *, force_refresh: bool = False) -> list[dict]:
        return [item.as_dict() for item in await self.list_inbounds(force_refresh=force_refresh)]

    async def healthcheck(self) -> dict[str, object]:
        return {"ok": True, "backend": self.backend_name, "display_name": self.display_name}

    @abstractmethod
    async def _list_inbounds(self) -> list[PanelInbound]:
        raise NotImplementedError