from __future__ import annotations

import asyncio
import inspect
import os
import threading
from contextlib import asynccontextmanager
from importlib import import_module
from time import perf_counter
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.core.middleware import SecurityHeadersMiddleware
from app.core import db_adapter


class AppServices:
    """Flexible dependency container injected from main.py."""

    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)


def _factory_kwargs(factory: Any, pool: dict[str, Any]) -> dict[str, Any]:
    sig = inspect.signature(factory)
    out: dict[str, Any] = {}
    for name, param in sig.parameters.items():
        if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.VAR_POSITIONAL):
            continue
        if name in pool:
            out[name] = pool[name]
    return out


def _include_optional_router(
    app: FastAPI,
    *,
    services: AppServices,
    module_name: str,
    factory_name: str,
    templates: Jinja2Templates,
) -> bool:
    try:
        module = import_module(module_name)
    except ModuleNotFoundError:
        return False

    factory = getattr(module, factory_name, None)
    if not callable(factory):
        return False

    pool = {
        "services": services,
        "db": getattr(services, "db", None),
        "cfg": getattr(services, "cfg", None),
        "templates": templates,
        **services.__dict__,
    }
    kwargs = _factory_kwargs(factory, pool)

    try:
        router = factory(**kwargs)
    except Exception:
        return False

    app.include_router(router)
    return True


def _run_template_warmup(preload_templates: Any, names: Any, *, label: str) -> None:
    if not callable(preload_templates):
        return
    started = perf_counter()
    try:
        loaded = int(preload_templates(names))
    except Exception as exc:
        print(f"[warmup] template {label} failed: {exc}", flush=True)
        return
    duration_ms = (perf_counter() - started) * 1000.0
    if loaded > 0:
        print(f"[warmup] template {label}: loaded={loaded} in {duration_ms:.2f}ms", flush=True)



def create_application(services: AppServices) -> FastAPI:
    cfg = getattr(services, "cfg", None)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # ⚡ Initialise la nouvelle base SQLite native (db_adapter) au démarrage
        await db_adapter.init_db()

        db = getattr(services, "db", None)
        if db is not None and callable(getattr(db, "init", None)):
            db.init()

        ensure_default_admin = getattr(services, "ensure_default_admin", None)
        if callable(ensure_default_admin):
            ensure_default_admin()

        # Nettoyage automatique de l'historique au démarrage (90 jours)
        if db is not None and hasattr(db, "user_history"):
            cleanup_fn = getattr(db.user_history, "cleanup_old", None)
            if callable(cleanup_fn):
                try:
                    cleanup_fn(90)
                except Exception as exc:
                    print(f"[cleanup] user_history failed: {exc}", flush=True)

        preload_templates = getattr(services, "preload_templates", None)
        startup_template_names = getattr(services, "template_preload_names", ())
        background_template_names = getattr(services, "template_background_warmup_names", ())

        if startup_template_names is None or startup_template_names:
            _run_template_warmup(preload_templates, startup_template_names, label="startup")

        if background_template_names is None or background_template_names:
            threading.Thread(
                target=_run_template_warmup,
                kwargs={
                    "preload_templates": preload_templates,
                    "names": background_template_names,
                    "label": "background",
                },
                name="fs-template-warmup",
                daemon=True,
            ).start()

        # ── Purge périodique des clients éphémères (panel actif, 3x-ui) ──
        _cleanup_task: asyncio.Task | None = None
        config_agent = getattr(services, "config_agent", None)
        if config_agent and callable(getattr(config_agent, "cleanup_ephemeral_clients", None)):
            async def _periodic_cleanup() -> None:
                interval = 300  # 5 minutes
                await asyncio.sleep(60)  # délai initial
                while True:
                    try:
                        cleaned = await config_agent.cleanup_ephemeral_clients()
                        if cleaned > 0:
                            print(f"[cleanup] {cleaned} ephemeral client(s) purged", flush=True)
                    except Exception as exc:
                        print(f"[cleanup] ephemeral purge error: {exc}", flush=True)
                    await asyncio.sleep(interval)

            _cleanup_task = asyncio.create_task(_periodic_cleanup())

        # ── Synchronisation periodique servers <- inbounds du panel actif (3x-ui) ──
        _servers_sync_task: asyncio.Task | None = None
        fetch_panel_inbounds = getattr(services, "fetch_panel_inbounds", None)
        servers_repo = getattr(getattr(services, "db", None), "servers", None)
        if callable(fetch_panel_inbounds) and servers_repo is not None:
            from app.core.servers_sync import sync_servers_from_panel

            async def _periodic_servers_sync() -> None:
                interval = 300  # 5 minutes, aligne sur le cache panel (PANEL_CACHE_TTL_SECONDS ~60s)
                await asyncio.sleep(30)  # delai initial, plus court que le nettoyage
                while True:
                    try:
                        synced = await sync_servers_from_panel(
                            fetch_panel_inbounds=fetch_panel_inbounds,
                            servers_repo=servers_repo,
                        )
                        if synced > 0:
                            print(f"[servers-sync] {synced} serveur(s) synchronise(s) depuis le panel", flush=True)
                    except Exception as exc:
                        print(f"[servers-sync] erreur: {exc}", flush=True)
                    await asyncio.sleep(interval)

            _servers_sync_task = asyncio.create_task(_periodic_servers_sync())

        # ── Retrogradation automatique des abonnements expires (apres periode de grace) ──
        _lifecycle_task: asyncio.Task | None = None
        from app.core.db_engine import db as _lifecycle_async_db
        users_repo_async = getattr(_lifecycle_async_db, "users", None)
        if users_repo_async is not None and callable(getattr(users_repo_async, "get_all", None)):
            async def _subscription_lifecycle_sweep() -> None:
                from datetime import date as _date

                def _grace_days_for(user_type: str) -> int:
                    normalized = str(user_type or "").strip()
                    if normalized == "Revendeur":
                        return max(1, int(getattr(cfg, "SUBSCRIPTION_GRACE_PERIOD_RESELLER_DAYS", 7) or 7))
                    if normalized in {"VIP", "PREMIUM"}:
                        return max(1, int(getattr(cfg, "SUBSCRIPTION_GRACE_PERIOD_CLIENT_DAYS", 3) or 3))
                    return max(1, int(getattr(cfg, "SUBSCRIPTION_GRACE_PERIOD_DAYS", 5) or 5))

                today = _date.today()
                try:
                    all_users = await users_repo_async.get_all()
                except Exception as exc:
                    print(f"[subscription-lifecycle] erreur lecture utilisateurs: {exc}", flush=True)
                    return
                downgraded = 0
                for user in all_users if isinstance(all_users, list) else []:
                    if not isinstance(user, dict):
                        continue
                    user_type = str(user.get("type", "") or "").strip()
                    if user_type in {"ADMIN", "Gratuit", ""}:
                        continue
                    expiration_raw = str(user.get("expiration", "") or "").strip()
                    if not expiration_raw:
                        continue
                    try:
                        expiration_date = _date.fromisoformat(expiration_raw)
                    except Exception:
                        continue
                    grace_days = _grace_days_for(user_type)
                    days_expired = (today - expiration_date).days
                    if days_expired < grace_days:
                        continue  # pas encore expire, ou toujours dans la periode de grace (avertissements affiches cote client)
                    updated = dict(user)
                    updated["type"] = "Gratuit"
                    updated["role_code"] = "client"
                    updated["default_panel_key"] = "free"
                    updated["status"] = "active"
                    updated["expiration"] = ""
                    updated["quota_gb"] = None
                    try:
                        await users_repo_async.save(updated)
                        downgraded += 1
                    except Exception as exc:
                        print(f"[subscription-lifecycle] erreur sauvegarde user {user.get('id')}: {exc}", flush=True)
                if downgraded:
                    print(f"[subscription-lifecycle] {downgraded} compte(s) retrograde(s) vers Gratuit apres periode de grace", flush=True)

            async def _periodic_subscription_lifecycle() -> None:
                interval_hours = max(1, int(getattr(cfg, "SUBSCRIPTION_LIFECYCLE_INTERVAL_HOURS", 6) or 6))
                await asyncio.sleep(90)  # delai initial, apres le demarrage complet de l'app
                while True:
                    try:
                        await _subscription_lifecycle_sweep()
                    except Exception as exc:
                        print(f"[subscription-lifecycle] erreur inattendue: {exc}", flush=True)
                    await asyncio.sleep(interval_hours * 3600)

            _lifecycle_task = asyncio.create_task(_periodic_subscription_lifecycle())

        yield

        # ── Shutdown : annuler les tâches background ──
        if _cleanup_task is not None:
            _cleanup_task.cancel()
            try:
                await _cleanup_task
            except asyncio.CancelledError:
                pass
        if _lifecycle_task is not None:
            _lifecycle_task.cancel()
            try:
                await _lifecycle_task
            except asyncio.CancelledError:
                pass

    app_name = str(getattr(cfg, "APP_NAME", "LABORATOIRE DU FREE-SURF") or "LABORATOIRE DU FREE-SURF")
    app = FastAPI(title=app_name, lifespan=lifespan)
    
    # Middleware de session (Requis pour request.session utilisé dans auth.py)
    session_secret = str(getattr(cfg, "_VIP_COOKIE_SECRET", "super-secret-key") or "super-secret-key")
    app.add_middleware(SessionMiddleware, secret_key=session_secret)
    
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # CORS pour les clients API externes (app compagnon Labo Surf, PWA sur un autre
    # domaine). Pas de cookies ici (allow_credentials=False) : ces clients s'authentifient
    # uniquement via "Authorization: Bearer <token>" (voir Security.get_current_user),
    # jamais via le cookie de session du site web. Le site web, lui, reste en same-origin
    # et n'a pas besoin de CORS pour fonctionner.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    templates_dir = getattr(cfg, "TEMPLATES_DIR", None)
    if templates_dir is not None:
        templates = Jinja2Templates(directory=str(templates_dir))
    else:
        templates = Jinja2Templates(directory="templates")

    static_dir = str(getattr(cfg, "STATIC_DIR", None) or "static")
    try:
        app.mount("/static", StaticFiles(directory=static_dir), name="static")
    except Exception as exc:
        print(f"[app] WARNING: Could not mount /static from '{static_dir}': {exc}", flush=True)

    included: list[str] = []
    router_specs = [
        ("app.routers.auth", "create_auth_router"),
        ("app.routers.pages", "create_pages_router"),
        ("app.routers.user", "create_user_router"),
        ("app.routers.subscription", "create_subscription_router"),
        ("app.routers.payment", "create_payment_router"),
        ("app.routers.revendeur", "create_revendeur_router"),
        ("app.routers.admin", "create_admin_router"),
        ("app.routers.tchat", "create_tchat_router"),
        ("app.routers.admin_ads", "create_admin_ads_router"),
        ("app.routers.admin_tools", "create_admin_tools_router"),
        ("app.routers.zero_rating", "create_zero_rating_router"),
    ]

    for module_name, factory_name in router_specs:
        if _include_optional_router(
            app,
            services=services,
            module_name=module_name,
            factory_name=factory_name,
            templates=templates,
        ):
            included.append(module_name)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    if "app.routers.pages" not in included:
        @app.get("/")
        async def root() -> JSONResponse:
            return JSONResponse(
                {
                    "status": "ok",
                    "message": "Application bootstrapped with fallback app factory.",
                    "included_routers": included,
                }
            )

    return app
