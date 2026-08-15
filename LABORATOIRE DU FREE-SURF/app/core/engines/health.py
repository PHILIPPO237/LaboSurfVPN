from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_PROC_TCP = Path("/proc/net/tcp")
_PROC_UDP = Path("/proc/net/udp")


def _parse_proc_ports(path: Path, *, listen_states: set[str]) -> set[int]:
    ports: set[int] = set()
    if not path.exists():
        return ports
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return ports
    for raw in lines[1:]:
        parts = raw.split()
        if len(parts) < 4:
            continue
        local_address = str(parts[1] or "")
        state = str(parts[3] or "").upper()
        if state not in listen_states or ":" not in local_address:
            continue
        _, hex_port = local_address.rsplit(":", 1)
        try:
            port = int(hex_port, 16)
        except Exception:
            continue
        if port > 0:
            ports.add(port)
    return ports


@lru_cache(maxsize=4)
def _listening_ports(kind: str) -> set[int]:
    normalized = str(kind or "").strip().lower()
    if normalized == "tcp":
        return _parse_proc_ports(_PROC_TCP, listen_states={"0A"})
    if normalized == "udp":
        return _parse_proc_ports(_PROC_UDP, listen_states={"07"})
    return set()


def probe_local_port(port: int, *, kinds: tuple[str, ...] = ("tcp", "udp")) -> bool | None:
    """True/False si on a pu verifier le port localement (via /proc/net/*),
    None si la verification n'est pas possible sur cet environnement (ex:
    sandbox sans acces a /proc, ou moteur distant sur un autre serveur).
    Meme logique que app/core/transports/static.py, partagee ici pour que
    EngineProvider.is_healthy() puisse s'en servir directement."""
    if port <= 0:
        return None
    if not (_PROC_TCP.exists() or _PROC_UDP.exists()):
        return None
    return any(port in _listening_ports(k) for k in kinds)
