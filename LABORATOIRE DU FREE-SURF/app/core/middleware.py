from __future__ import annotations

import os
from time import perf_counter

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


_PUBLIC_DOCUMENT_CACHE_PATHS = {
    "/",
    "/avant-propos",
    "/construction",
    "/scan-guide",
    "/acces",
    "/acces/licence-oubliee",
    "/vip-login",
    "/payment",
}


def _cache_control_header(path: str) -> str:
    normalized = str(path or "")
    if normalized.startswith("/static/avatars/"):
        return "public, max-age=86400"
    if normalized.startswith("/static/"):
        return "public, max-age=3600"
    if normalized in _PUBLIC_DOCUMENT_CACHE_PATHS:
        return "public, max-age=300, stale-while-revalidate=60"
    if normalized.startswith("/health"):
        return "no-store"
    if normalized.startswith("/api/"):
        return "no-store"
    return "private, no-cache, max-age=0, must-revalidate"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        started = perf_counter()
        response = await call_next(request)
        duration_ms = (perf_counter() - started) * 1000.0
        
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
        response.headers["Cache-Control"] = _cache_control_header(request.url.path)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        slow_threshold = float(os.getenv("FS_SLOW_REQUEST_MS", "1200") or 1200)
        if duration_ms >= slow_threshold:
            print(f"[SLOW] {request.method} {request.url.path} -> {duration_ms:.2f}ms", flush=True)
            
        return response