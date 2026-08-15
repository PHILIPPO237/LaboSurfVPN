from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse


def _as_error_response(check: Any) -> JSONResponse | None:
    if isinstance(check, JSONResponse):
        return check
    return None


def _as_redirect_response(check: Any) -> RedirectResponse | None:
    if isinstance(check, RedirectResponse):
        return check
    return None


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _as_bool(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return bool(value)


def create_admin_ads_router(
    *,
    db: Any,
    require_access: Callable[..., Any],
    require_admin_api: Callable[[Request], Any],
    read_template: Callable[[str], str | None],
    html_response: Callable[[str, int], Any],
    serialize_ads: Callable[[], list[dict[str, Any]]] | None = None,
    save_ad_upload: Callable[[UploadFile], Any] | None = None,
    delete_ad_image: Callable[[str], None] | None = None,
    coerce_locations: Callable[[Any], list[str]] | None = None,
) -> APIRouter:
    router = APIRouter()

    def _page_guard(request: Request, *, next_url: str, need: str) -> RedirectResponse | None:
        check = require_access(request, {"ADMIN"}, next_url=next_url, need=need)
        return _as_redirect_response(check)

    def _api_guard(request: Request) -> JSONResponse | None:
        return _as_error_response(require_admin_api(request))

    @router.get("/admin/ads")
    async def admin_ads_page(request: Request):
        denied = _page_guard(request, next_url="/admin/ads", need="admin.ads")
        if denied is not None:
            return denied
        content = read_template("admin-ads.html")
        if content is None:
            return html_response("<h1>Erreur: admin-ads.html manquant</h1>", 404)
        return html_response(content, 200)

    @router.get("/api/admin/ads")
    async def admin_ads_list(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied

        if callable(serialize_ads):
            try:
                ads = serialize_ads()
            except Exception:
                ads = []
        else:
            repo = getattr(db, "ads", None)
            try:
                ads = repo.get_all() if repo is not None else []
            except Exception:
                ads = []

        if not isinstance(ads, list):
            ads = []
        return {"status": "ok", "ads": ads}

    @router.post("/api/admin/ads")
    async def admin_ads_save(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied

        repo = getattr(db, "ads", None)
        if repo is None:
            return JSONResponse({"status": "error", "message": "Stockage ads indisponible."}, status_code=500)

        content_type = str(request.headers.get("content-type", "") or "").lower()
        payload: dict[str, Any] = {}
        upload: UploadFile | None = None

        if "multipart/form-data" in content_type:
            form = await request.form()
            payload = {str(k): form.get(k) for k in form.keys()}
            file_value = form.get("file")
            upload = file_value if getattr(file_value, "filename", "") and callable(getattr(file_value, "read", None)) else None
        else:
            try:
                body = await request.json()
            except Exception:
                body = {}
            payload = body if isinstance(body, dict) else {}

        ad_id = _as_int(payload.get("id", 0), 0)
        existing = None
        if ad_id > 0:
            try:
                existing = repo.get_by_id(ad_id)
            except Exception:
                existing = None

        base = dict(existing) if isinstance(existing, dict) else {}
        text = str(payload.get("text", base.get("text", "")) or "").strip()
        if not text:
            return JSONResponse({"status": "error", "message": "Texte pub requis."}, status_code=400)

        link = str(payload.get("link", base.get("link", "")) or "").strip()
        style = str(payload.get("style", base.get("style", "neon")) or "neon").strip() or "neon"
        priority = max(1, min(99, _as_int(payload.get("priority", base.get("priority", 1)), 1)))
        active = _as_bool(payload.get("active", base.get("active", True)))
        color = str(payload.get("color", base.get("color", "#39ff14")) or "#39ff14").strip() or "#39ff14"

        if callable(coerce_locations):
            try:
                locations = coerce_locations(payload.get("locations", base.get("locations", ["chat"])))
            except Exception:
                locations = ["chat"]
        else:
            raw_locations = payload.get("locations", base.get("locations", ["chat"]))
            if isinstance(raw_locations, list):
                locations = [str(v).strip() for v in raw_locations if str(v).strip()]
            else:
                locations = ["chat"]
        if not locations:
            locations = ["chat"]

        image = str(payload.get("image", base.get("image", "")) or "").strip()
        if upload is not None and callable(save_ad_upload):
            try:
                new_image = await save_ad_upload(upload)
            except Exception as exc:
                return JSONResponse({"status": "error", "message": f"Upload image impossible: {exc}"}, status_code=400)
            finally:
                try:
                    await upload.close()
                except Exception:
                    pass
            if new_image:
                if image and image != new_image and callable(delete_ad_image):
                    try:
                        delete_ad_image(image)
                    except Exception:
                        pass
                image = new_image

        duration_hours = _as_int(payload.get("duration_hours", 0), 0)
        if duration_hours > 0:
            expires_at = time.time() + (duration_hours * 3600)
        elif "expires_at" in payload:
            try:
                expires_at = float(payload.get("expires_at", 0) or 0)
            except Exception:
                expires_at = 0.0
        else:
            try:
                expires_at = float(base.get("expires_at", 0) or 0)
            except Exception:
                expires_at = 0.0

        to_save = {
            "id": ad_id if ad_id > 0 else 0,
            "text": text,
            "link": link,
            "active": active,
            "locations": locations,
            "priority": priority,
            "color": color,
            "image": image,
            "style": style,
            "expires_at": expires_at,
        }

        try:
            saved = repo.save(to_save)
        except Exception as exc:
            return JSONResponse({"status": "error", "message": f"Erreur sauvegarde ads: {exc}"}, status_code=500)

        return {"status": "ok", "ad": saved}

    @router.post("/api/admin/ads/delete")
    async def admin_ads_delete(request: Request):
        denied = _api_guard(request)
        if denied is not None:
            return denied

        repo = getattr(db, "ads", None)
        if repo is None:
            return JSONResponse({"status": "error", "message": "Stockage ads indisponible."}, status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        ad_id = _as_int(body.get("id", 0), 0)
        if ad_id <= 0:
            return JSONResponse({"status": "error", "message": "ID pub invalide."}, status_code=400)

        ad = None
        try:
            ad = repo.get_by_id(ad_id)
        except Exception:
            ad = None

        try:
            deleted = bool(repo.delete(ad_id))
        except Exception as exc:
            return JSONResponse({"status": "error", "message": f"Erreur suppression ads: {exc}"}, status_code=500)

        if deleted and isinstance(ad, dict) and callable(delete_ad_image):
            image = str(ad.get("image", "") or "").strip()
            if image:
                try:
                    delete_ad_image(image)
                except Exception:
                    pass

        return {"status": "ok", "deleted": deleted}

    return router


