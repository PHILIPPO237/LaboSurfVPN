from __future__ import annotations

import asyncio
import inspect
import threading
from typing import Any

from app.core.db_engine import db as _async_db


def _run_awaitable(awaitable: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(awaitable)
        except BaseException as exc:  # pragma: no cover - passthrough helper
            error["exc"] = exc

    thread = threading.Thread(target=runner, name="fs-db-sync-bridge")
    thread.start()
    thread.join()
    if "exc" in error:
        raise error["exc"]
    return result.get("value")


class _SyncProxy:
    def __init__(self, target: Any) -> None:
        self._target = target

    def __getattr__(self, name: str) -> Any:
        value = getattr(self._target, name)
        if not callable(value):
            return value

        def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = value(*args, **kwargs)
            if inspect.isawaitable(result):
                return _run_awaitable(result)
            return result

        return wrapper


class _DatabaseFacade:
    def __init__(self, target: Any) -> None:
        self._target = target
        self.users = _SyncProxy(target.users)
        self.sessions = _SyncProxy(target.sessions)

    def init(self) -> Any:
        return _run_awaitable(self._target.init())

    def close(self) -> Any:
        return _run_awaitable(self._target.close())

    def __getattr__(self, name: str) -> Any:
        if name in {"users", "sessions"}:
            return getattr(self, name)
        return getattr(self._target, name)


db = _DatabaseFacade(_async_db)