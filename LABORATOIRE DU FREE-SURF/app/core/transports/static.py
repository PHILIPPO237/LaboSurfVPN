# 
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from .base import TransportEngine, TransportEngineInfo, TransportEngineStatus


_PROC_TCP = Path('/proc/net/tcp')
_PROC_UDP = Path('/proc/net/udp')


def _parse_proc_ports(path: Path, *, listen_states: set[str]) -> set[int]:
    ports: set[int] = set()
    if not path.exists():
        return ports
    try:
        lines = path.read_text(encoding='utf-8', errors='ignore').splitlines()
    except Exception:
        return ports
    for raw in lines[1:]:
        parts = raw.split()
        if len(parts) < 4:
            continue
        local_address = str(parts[1] or '')
        state = str(parts[3] or '').upper()
        if state not in listen_states or ':' not in local_address:
            continue
        _, hex_port = local_address.rsplit(':', 1)
        try:
            port = int(hex_port, 16)
        except Exception:
            continue
        if port > 0:
            ports.add(port)
    return ports


@lru_cache(maxsize=4)
def _listening_ports(kind: str) -> set[int]:
    normalized = str(kind or '').strip().lower()
    if normalized == 'tcp':
        return _parse_proc_ports(_PROC_TCP, listen_states={'0A'})
    if normalized == 'udp':
        return _parse_proc_ports(_PROC_UDP, listen_states={'07'})
    return set()


class StaticTransportEngine(TransportEngine):
    def __init__(
        self,
        *,
        info: TransportEngineInfo,
        host: str,
        port: int,
        required_checks: dict[str, bool] | None = None,
        raw: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(info=info)
        self._host = str(host or '').strip()
        try:
            self._port = int(port or 0)
        except Exception:
            self._port = 0
        self._required_checks = dict(required_checks or {})
        self._raw = dict(raw or {})

    def _runtime_probe_kinds(self) -> tuple[str, ...]:
        protocol = str(self.protocol or '').strip().upper()
        if protocol in {'UDP', 'DNS'}:
            return ('udp',)
        if protocol in {'SSH', 'TCP', 'HTTP', 'HTTPS', 'UDPGW'}:
            return ('tcp',)
        return ('tcp', 'udp')

    def _runtime_port_available(self) -> tuple[bool | None, tuple[str, ...]]:
        if self._port <= 0:
            return None, ()
        probe_kinds = self._runtime_probe_kinds()
        if not probe_kinds:
            return None, ()
        if not (_PROC_TCP.exists() or _PROC_UDP.exists()):
            return None, probe_kinds
        available = any(self._port in _listening_ports(kind) for kind in probe_kinds)
        return available, probe_kinds

    def status(self) -> TransportEngineStatus:
        missing = [label for label, present in self._required_checks.items() if not bool(present)]
        if not self._host:
            missing.append('host')
        if self._port <= 0:
            missing.append('port')

        configured = not missing
        runtime_available, probe_kinds = self._runtime_port_available()
        raw = dict(self._raw)
        raw['required_checks'] = dict(self._required_checks)
        raw['runtime_probe'] = {
            'supported': runtime_available is not None,
            'available': runtime_available,
            'kinds': list(probe_kinds),
            'port': self._port,
        }

        if configured and runtime_available is True:
            ok = True
            message = 'Moteur configure et port local detecte.'
        elif configured and runtime_available is False:
            ok = False
            message = 'Moteur configure mais port local non detecte sur cet hote.'
        elif configured:
            ok = True
            message = 'Moteur configure; verification runtime indisponible sur cet environnement.'
        else:
            ok = False
            missing_labels = ', '.join(missing)
            message = f'Configuration incomplete: {missing_labels}.'

        return TransportEngineStatus(
            engine_name=self.engine_name,
            display_name=self.display_name,
            protocol=self.protocol,
            host=self._host,
            port=self._port,
            source=self.info.source,
            managed_by=self.info.managed_by,
            configured=configured,
            ok=ok,
            public=self.public,
            message=message,
            raw=raw,
        )
