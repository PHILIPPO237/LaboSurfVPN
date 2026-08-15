from __future__ import annotations

from typing import Any

from .base import PanelProvider, PanelProviderInfo
from .xui import XuiPanelProvider


class UnavailablePanelProvider(PanelProvider):
    def __init__(self, *, requested_backend: str, message: str | None = None) -> None:
        super().__init__(
            info=PanelProviderInfo(
                backend_name=requested_backend or 'unknown',
                display_name='Unsupported panel backend',
            )
        )
        self._message = str(
            message
            or f"Le backend panel '{requested_backend or 'unknown'}' n'est pas pris en charge."
        )

    async def _list_inbounds(self) -> list:
        raise RuntimeError(self._message)

    async def healthcheck(self) -> dict[str, object]:
        return {
            'ok': False,
            'backend': self.backend_name,
            'display_name': self.display_name,
            'message': self._message,
        }


def _xui_configured(cfg: Any) -> bool:
    has_base_url = bool(str(getattr(cfg, 'XUI_BASE_URL', '') or '').strip())
    has_token = bool(str(getattr(cfg, 'XUI_API_TOKEN', '') or '').strip())
    has_login = bool(
        str(getattr(cfg, 'XUI_USERNAME', '') or '').strip()
        and str(getattr(cfg, 'XUI_PASSWORD', '') or '').strip()
    )
    return has_base_url and (has_token or has_login)


def _build_xui_provider(*, cfg: Any, timeout: float, cache_ttl: float) -> PanelProvider:
    return XuiPanelProvider(
        base_url=str(getattr(cfg, 'XUI_BASE_URL', '') or '').strip(),
        username=str(getattr(cfg, 'XUI_USERNAME', '') or '').strip(),
        password=str(getattr(cfg, 'XUI_PASSWORD', '') or '').strip(),
        api_token=str(getattr(cfg, 'XUI_API_TOKEN', '') or '').strip(),
        public_host=str(getattr(cfg, 'XUI_PUBLIC_IP', '') or getattr(cfg, 'PANEL_DEFAULT_HOST', '') or '').strip(),
        timeout_seconds=timeout,
        cache_ttl_seconds=cache_ttl,
    )


def build_panel_provider(*, cfg: Any) -> PanelProvider:
    """Construit le panel actif. Seul 3x-ui est supporte (Remnawave a ete
    retire du projet - abandonne car juge trop complexe a exploiter).
    Auth par token API (XUI_API_TOKEN) prioritaire si presente, sinon
    repli sur username/password (comportement historique inchange)."""
    backend = str(getattr(cfg, 'PANEL_BACKEND', '') or '').strip().lower()
    timeout = float(getattr(cfg, 'PANEL_HTTP_TIMEOUT_SECONDS', 4.0) or 4.0)
    cache_ttl = float(getattr(cfg, 'PANEL_CACHE_TTL_SECONDS', 60.0) or 60.0)

    if backend in {'3x-ui', '3xui', 'x-ui', 'xui', '', 'auto', 'default'}:
        if _xui_configured(cfg):
            return _build_xui_provider(cfg=cfg, timeout=timeout, cache_ttl=cache_ttl)
        return UnavailablePanelProvider(
            requested_backend=backend or 'auto',
            message='Aucun backend panel exploitable: renseignez XUI_BASE_URL et (XUI_API_TOKEN ou XUI_USERNAME/XUI_PASSWORD) dans l environnement.',
        )

    return UnavailablePanelProvider(requested_backend=backend)
