from __future__ import annotations

import html
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core.access import can_manage_user_lineage, has_root_access
from app.core.passwords import build_password_context
from app.core.invoicing import build_invoice_pdf, generate_invoice_number
from app.routers.auth import _is_weak_password

_pwd_context = build_password_context(schemes=["bcrypt"], deprecated="auto")


def _as_redirect_response(value: Any) -> RedirectResponse | None:
    return value if isinstance(value, RedirectResponse) else None


def _json_forbidden(message: str = "Interdit") -> JSONResponse:
    return JSONResponse({"status": "error", "message": str(message or "Interdit")}, status_code=403)


def _template_response(templates: Any, name: str, context: dict[str, Any]) -> HTMLResponse:
    responder = getattr(templates, "TemplateResponse", None)
    if not callable(responder):
        raise RuntimeError("templates unavailable")
    try:
        return responder(name, context)
    except TypeError:
        return responder(name=name, context=context)


def _parse_expiration(raw: Any) -> date | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except Exception:
        return None


def _extend_user_expiration(user: dict[str, Any], *, days: int) -> None:
    today = date.today()
    current = _parse_expiration(user.get("expiration"))
    if current is None or current < today:
        base = today
    else:
        base = current
    user["expiration"] = (base + timedelta(days=max(1, int(days)))).isoformat()


def _plan_to_user_type(plan: str) -> str:
    normalized = str(plan or "").strip().upper()
    if normalized == "REVENDEUR":
        return "Revendeur"
    if normalized == "PREMIUM":
        return "PREMIUM"
    return "VIP"


def create_revendeur_router(
    *,
    db: Any,
    templates: Any,
    require_access: Callable[..., Any],
    get_current_user: Callable[[Request], dict | None] | None = None,
    build_user_configs: Callable[[dict], list[dict]] | None = None,
    ssh_dropbear_provisioner: Any = None,
    hysteria2_provisioner: Any = None,
    slowdns_provisioner: Any = None,
    zivpn_udp_provisioner: Any = None,
    xui_provisioner: Any = None,
    cfg: Any = None,
) -> APIRouter:
    router = APIRouter()
    users_repo = getattr(db, "users", None)
    payments_repo = getattr(db, "payments", None)
    service_requests_repo = getattr(db, "service_requests", None)

    # Anti-abus pour la generation de demos : un revendeur ne peut generer qu'un
    # nombre limite de demos par fenetre de temps. En memoire (redemarre a zero au
    # redeploiement) -- suffisant pour freiner un abus manuel/rafale, pas concu
    # pour resister a une attaque distribuee organisee.
    _DEMO_RATE_WINDOW_SECONDS = 24 * 3600  # 24h glissantes (pas juste 1h : sinon on peut enchainer toute la journee)
    _DEMO_RATE_MAX_PER_WINDOW = 3          # 3 demos max par revendeur et par 24h
    _demo_generation_log: dict[int, list[float]] = {}

    def _check_demo_rate_limit(reseller_id: int) -> bool:
        now = time.time()
        history = [ts for ts in _demo_generation_log.get(reseller_id, []) if now - ts <= _DEMO_RATE_WINDOW_SECONDS]
        if len(history) >= _DEMO_RATE_MAX_PER_WINDOW:
            _demo_generation_log[reseller_id] = history
            return False
        history.append(now)
        _demo_generation_log[reseller_id] = history
        return True

    def _load_user_by_id(user_id: int) -> dict[str, Any] | None:
        if users_repo is None or not callable(getattr(users_repo, "get_by_id", None)):
            return None
        try:
            row = users_repo.get_by_id(int(user_id))
        except Exception:
            return None
        return dict(row) if isinstance(row, dict) else None

    def _can_manage_payment_user(actor: dict[str, Any], payment: dict[str, Any]) -> bool:
        if has_root_access(actor):
            return True
        target = _load_user_by_id(int(payment.get("user_id", 0) or 0))
        if not isinstance(target, dict):
            return False
        return can_manage_user_lineage(actor, target, _load_user_by_id)

    def _serialize_provisioning_result(value: Any) -> dict[str, Any] | None:
        if isinstance(value, dict):
            return dict(value)
        serializer = getattr(value, "as_dict", None)
        if callable(serializer):
            try:
                payload = serializer()
            except Exception:
                return None
            return dict(payload) if isinstance(payload, dict) else None
        return None

    def _collect_transport_action(user: dict[str, Any], *, reason: str, method_name: str) -> dict[str, Any] | None:
        items: list[dict[str, Any]] = []
        for provisioner in (ssh_dropbear_provisioner, hysteria2_provisioner, slowdns_provisioner, zivpn_udp_provisioner, xui_provisioner):
            runner = getattr(provisioner, method_name, None)
            if not callable(runner):
                continue
            result = runner(dict(user), reason=reason)
            payload = _serialize_provisioning_result(result)
            if isinstance(payload, dict) and bool(payload.get("configured", False)):
                items.append(payload)
        if not items:
            return None
        return {
            "configured": True,
            "ok": all(bool(item.get("ok", False)) for item in items),
            "items": items,
        }

    def _collect_transport_provisioning(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        return _collect_transport_action(user, reason=reason, method_name="ensure_user")

    def _collect_transport_disable(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        return _collect_transport_action(user, reason=reason, method_name="disable_user")

    def _provision_and_activate(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        provisioning: dict[str, Any] | None = None
        try:
            provisioning = _collect_transport_provisioning(user, reason=reason)
        finally:
            if users_repo and callable(getattr(users_repo, "get_by_id", None)):
                try:
                    latest_user = users_repo.get_by_id(int(user.get("id", 0)))
                    if latest_user and latest_user.get("status") == "configuring":
                        latest_user["status"] = "active"
                        users_repo.save(latest_user)
                except Exception:
                    pass
        return provisioning

    def _snapshot_user_state(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": int(user.get("id", 0) or 0),
            "username": str(user.get("username", "") or "").strip(),
            "type": str(user.get("type", "") or "").strip(),
            "status": str(user.get("status", "") or "").strip(),
            "expiration": str(user.get("expiration", "") or "").strip(),
        }

    def _merge_payment_raw(payment: dict[str, Any], **updates: Any) -> dict[str, Any]:
        raw = payment.get("raw_response") if isinstance(payment.get("raw_response"), dict) else {}
        payload = dict(raw)
        for key, value in updates.items():
            if value is not None:
                payload[key] = value
        return payload

    def _paid_transport_profile(user: dict[str, Any]) -> bool:
        user_type = str(user.get("type", "") or "").strip().lower()
        user_status = str(user.get("status", "active") or "active").strip().lower()
        return user_status == "active" and user_type in {"vip", "premium", "revendeur", "admin"}

    def _sync_user_transport_state(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        if _paid_transport_profile(user):
            return _collect_transport_provisioning(user, reason=reason)
        return _collect_transport_disable(user, reason=reason)

    def _page_guard(request: Request, *, next_url: str, need: str) -> RedirectResponse | None:
        check = require_access(request, {"Revendeur", "ADMIN"}, next_url=next_url, need=need)
        return _as_redirect_response(check)

    def _api_user(request: Request) -> dict[str, Any] | JSONResponse:
        if not callable(get_current_user):
            return _json_forbidden()
        user = get_current_user(request)
        if not isinstance(user, dict):
            return _json_forbidden()
        user_type = str(user.get("type", "") or "").strip()
        if user_type not in {"Revendeur", "ADMIN"}:
            return _json_forbidden()
        return dict(user)

    def _payment_owner_id(user: dict[str, Any]) -> int | None:
        user_type = str(user.get("type", "") or "").strip()
        if user_type == "ADMIN":
            return None
        return int(user.get("id", 0) or 0)

    def _find_payment_for_user(reference: str, user: dict[str, Any]) -> dict[str, Any] | None:
        if payments_repo is None or not callable(getattr(payments_repo, "get_by_reference", None)):
            return None
        payment = payments_repo.get_by_reference(str(reference or "").strip())
        if not isinstance(payment, dict):
            return None
        owner_id = _payment_owner_id(user)
        if owner_id is None:
            if str(user.get("type", "") or "").strip() == "ADMIN" and not _can_manage_payment_user(user, payment):
                return None
            return dict(payment)
        if int(payment.get("recipient_id", 0) or 0) != owner_id:
            return None
        return dict(payment)

    def _payment_rows_for_user(user: dict[str, Any]) -> list[dict]:
        if payments_repo is None or not callable(getattr(payments_repo, "get_all", None)):
            return []
        owner_id = _payment_owner_id(user)
        try:
            rows = payments_repo.get_all(limit=300, recipient_id=owner_id)
        except TypeError:
            rows = payments_repo.get_all(300, owner_id)
        except Exception:
            rows = []
        if not isinstance(rows, list):
            return []
        payload = [dict(row) for row in rows if isinstance(row, dict)]
        if str(user.get("type", "") or "").strip() == "ADMIN" and not has_root_access(user):
            payload = [row for row in payload if _can_manage_payment_user(user, row)]
        return payload

    def _save_user_payment_settings(user: dict[str, Any], *, om_number: str, momo_number: str) -> dict[str, Any]:
        user["om_number"] = str(om_number or "").strip()
        user["momo_number"] = str(momo_number or "").strip()
        if callable(getattr(users_repo, "save", None)):
            return users_repo.save(user)
        return user

    def _activate_user_for_payment(payment: dict[str, Any]) -> dict[str, Any] | None:
        if users_repo is None or not callable(getattr(users_repo, "get_by_id", None)) or not callable(getattr(users_repo, "save", None)):
            return None
        user_id = int(payment.get("user_id", 0) or 0)
        if user_id <= 0:
            return None
        user = users_repo.get_by_id(user_id)
        if not isinstance(user, dict):
            return None
        before = _snapshot_user_state(user)
        user["type"] = _plan_to_user_type(str(payment.get("plan", "") or "VIP"))
        user["status"] = "configuring"
        _extend_user_expiration(user, days=30)
        saved_user = users_repo.save(user)
        return {
            "user": dict(saved_user),
            "transition": {"before": before, "after": _snapshot_user_state(saved_user)},
        }

    def _refund_user_for_payment(payment: dict[str, Any]) -> dict[str, Any] | None:
        if users_repo is None or not callable(getattr(users_repo, "get_by_id", None)) or not callable(getattr(users_repo, "save", None)):
            return None
        user_id = int(payment.get("user_id", 0) or 0)
        if user_id <= 0:
            return None
        user = users_repo.get_by_id(user_id)
        if not isinstance(user, dict):
            return None
        before = _snapshot_user_state(user)
        payment_raw = payment.get("raw_response") if isinstance(payment.get("raw_response"), dict) else {}
        previous_state = payment_raw.get("previous_user_state") if isinstance(payment_raw.get("previous_user_state"), dict) else None
        restored_from_snapshot = False
        if isinstance(previous_state, dict):
            for field in ("type", "status", "expiration"):
                if field in previous_state:
                    user[field] = str(previous_state.get(field, "") or "").strip()
            restored_from_snapshot = True
        else:
            user["status"] = "suspended"
            user["expiration"] = ""
        saved_user = users_repo.save(user)
        return {
            "user": dict(saved_user),
            "transition": {
                "before": before,
                "after": _snapshot_user_state(saved_user),
                "restored_from_snapshot": restored_from_snapshot,
            },
        }

    def _service_request_target_user(req: dict[str, Any]) -> dict[str, Any] | None:
        user_id = int(req.get("target_user_id", 0) or 0)
        if user_id <= 0:
            return None
        return _load_user_by_id(user_id)

    def _can_manage_service_request(actor: dict[str, Any], req: dict[str, Any]) -> bool:
        if has_root_access(actor):
            return True
        target = _service_request_target_user(req)
        if not isinstance(target, dict):
            return False
        return can_manage_user_lineage(actor, target, _load_user_by_id)

    def _generate_invoice_and_notify(req: dict[str, Any], activated_user: dict[str, Any], *, issued_by: dict[str, Any]) -> None:
        """A la validation d'une demande : genere une facture PDF et envoie
        automatiquement un message avec la facture en piece jointe dans la
        messagerie privee du client. N'importe quelle erreur ici est avalee
        silencieusement (log console) -- l'activation elle-meme (deja faite
        avant cet appel) ne doit jamais etre compromise par un souci de
        facturation."""
        invoices_repo = getattr(db, "invoices", None)
        messages_repo = getattr(db, "private_messages", None)
        if invoices_repo is None or messages_repo is None:
            return
        try:
            kind = str(req.get("kind", "") or "").strip().lower()
            plan = str(activated_user.get("type", "") or "")
            duration_days = int(req.get("duration_days", 30) or 30) if kind != "upgrade" else 30

            sequence = invoices_repo.count_all() + 1 if callable(getattr(invoices_repo, "count_all", None)) else 1
            invoice_number = generate_invoice_number(sequence)

            static_dir = str(getattr(cfg, "STATIC_DIR", "") or "static")
            pdf_path = Path(static_dir) / "invoices" / f"{invoice_number}.pdf"
            build_invoice_pdf(
                output_path=pdf_path,
                invoice_number=invoice_number,
                username=str(activated_user.get("username", "") or ""),
                plan=plan,
                duration_days=duration_days,
                amount_label="",  # montant non suivi cote demande -- laisse vide, l'admin peut completer manuellement plus tard
                issued_by_username=str(issued_by.get("username", "") or ""),
                reference=f"REQ-{req.get('id', '')}",
            )
            relative_pdf_path = f"/static/invoices/{invoice_number}.pdf"

            saved_invoice = invoices_repo.add({
                "invoice_number": invoice_number,
                "user_id": int(activated_user.get("id", 0) or 0),
                "username": str(activated_user.get("username", "") or ""),
                "plan": plan,
                "duration_days": duration_days,
                "amount_label": "",
                "issued_by_user_id": int(issued_by.get("id", 0) or 0),
                "issued_by_username": str(issued_by.get("username", "") or ""),
                "pdf_path": relative_pdf_path,
            })

            actor_type = str(issued_by.get("type", "") or "").strip().lower()
            sender_role = "admin" if actor_type == "admin" else "revendeur"
            messages_repo.add({
                "conversation_user_id": int(activated_user.get("id", 0) or 0),
                "sender_user_id": int(issued_by.get("id", 0) or 0),
                "sender_username": str(issued_by.get("username", "") or ""),
                "sender_role": sender_role,
                "body": f"Ta demande a été validée ! Voici ta facture ({invoice_number}).",
                "message_type": "invoice",
                "attachment_data": relative_pdf_path,
                "attachment_mime": "application/pdf",
                "attachment_filename": f"{invoice_number}.pdf",
            })
        except Exception as exc:
            print(f"[invoicing] Echec generation facture/notification pour la demande {req.get('id')} : {exc}", flush=True)

    def _apply_service_request(req: dict[str, Any]) -> dict[str, Any] | None:
        if users_repo is None or not callable(getattr(users_repo, "save", None)):
            return None
        user = _service_request_target_user(req)
        if not isinstance(user, dict):
            return None
        before = _snapshot_user_state(user)
        kind = str(req.get("kind", "") or "").strip().lower()
        if kind == "upgrade":
            target_plan = str(req.get("target_plan", "") or "VIP")
            user["type"] = _plan_to_user_type(target_plan)
            user["status"] = "configuring"
            _extend_user_expiration(user, days=30)
        else:
            try:
                days = int(req.get("duration_days", 30) or 30)
            except Exception:
                days = 30
            _extend_user_expiration(user, days=days)
            user["status"] = "configuring"
        saved_user = users_repo.save(user)
        return {
            "user": dict(saved_user),
            "transition": {"before": before, "after": _snapshot_user_state(saved_user)},
        }

    def _find_service_request(req_id: int, user: dict[str, Any]) -> dict[str, Any] | JSONResponse:
        if service_requests_repo is None or not callable(getattr(service_requests_repo, "get_by_id", None)):
            return JSONResponse({"status": "error", "message": "Stockage des demandes indisponible."}, status_code=500)
        req = service_requests_repo.get_by_id(int(req_id))
        if not isinstance(req, dict):
            return JSONResponse({"status": "error", "message": "Demande introuvable."}, status_code=404)
        if str(req.get("status", "") or "").strip().lower() != "pending":
            return JSONResponse({"status": "error", "message": "Cette demande a deja ete traitee."}, status_code=409)
        if not _can_manage_service_request(user, req):
            return _json_forbidden("Vous ne pouvez pas traiter cette demande.")
        return req

    @router.get("/api/revendeur/service-requests")
    async def reseller_service_requests_list(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        if service_requests_repo is None or not callable(getattr(service_requests_repo, "get_all", None)):
            return {"status": "ok", "requests": []}
        try:
            rows = service_requests_repo.get_all()
        except Exception:
            rows = []
        pending = [dict(r) for r in rows if isinstance(r, dict) and str(r.get("status", "") or "").strip().lower() == "pending"]
        if not has_root_access(user):
            pending = [r for r in pending if _can_manage_service_request(user, r)]
        return {"status": "ok", "requests": pending}

    @router.post("/api/revendeur/service-requests/approve")
    async def reseller_service_requests_approve(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        req_id = int(body.get("id", 0) or 0) if isinstance(body, dict) else 0
        if req_id <= 0:
            return JSONResponse({"status": "error", "message": "Identifiant de demande invalide."}, status_code=400)
        req_or_error = _find_service_request(req_id, user)
        if isinstance(req_or_error, JSONResponse):
            return req_or_error
        req = req_or_error

        activation = _apply_service_request(req)
        if activation is None:
            return JSONResponse({"status": "error", "message": "Client cible introuvable."}, status_code=404)
        provisioning = _provision_and_activate(activation["user"], reason="service_request_approved")

        req["status"] = "completed"
        req["approved_by"] = str(user.get("username", "") or "")
        if callable(getattr(service_requests_repo, "save", None)):
            service_requests_repo.save(req)

        _generate_invoice_and_notify(req, activation["user"], issued_by=user)

        return {
            "status": "ok",
            "message": "Demande approuvee. Le compte du client a ete mis a jour.",
            "provisioning": provisioning,
        }

    @router.post("/api/revendeur/service-requests/reject")
    async def reseller_service_requests_reject(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        req_id = int(body.get("id", 0) or 0) if isinstance(body, dict) else 0
        if req_id <= 0:
            return JSONResponse({"status": "error", "message": "Identifiant de demande invalide."}, status_code=400)
        req_or_error = _find_service_request(req_id, user)
        if isinstance(req_or_error, JSONResponse):
            return req_or_error
        req = req_or_error

        req["status"] = "rejected"
        req["rejected_by"] = str(user.get("username", "") or "")
        if callable(getattr(service_requests_repo, "save", None)):
            service_requests_repo.save(req)
        return {"status": "ok", "message": "Demande rejetee."}

    def _can_manage_client(actor: dict[str, Any], target: dict[str, Any]) -> bool:
        if has_root_access(actor):
            return True
        return can_manage_user_lineage(actor, target, _load_user_by_id)

    def _clients_for_actor(actor: dict[str, Any]) -> list[dict[str, Any]]:
        if users_repo is None or not callable(getattr(users_repo, "get_all", None)):
            return []
        try:
            all_users = users_repo.get_all()
        except Exception:
            all_users = []
        if not isinstance(all_users, list):
            return []
        rows = [dict(u) for u in all_users if isinstance(u, dict)]
        if has_root_access(actor):
            actor_id = int(actor.get("id", 0) or 0)
            return [u for u in rows if int(u.get("id", 0) or 0) != actor_id]
        return [u for u in rows if _can_manage_client(actor, u)]

    def _client_row_html(user: dict[str, Any]) -> str:
        uid = int(user.get("id", 0) or 0)
        username = html.escape(str(user.get("username", "") or ""))
        utype = html.escape(str(user.get("type", "") or ""))
        expiration = html.escape(str(user.get("expiration", "") or "-") or "-")
        quota = user.get("quota_gb")
        quota_txt = html.escape(str(quota)) if quota not in (None, "") else "illimite"
        status = str(user.get("status", "active") or "active").strip().lower()
        online = "1" if status == "active" else "0"
        status_label = {
            "active": "Actif", "configuring": "Configuration", "suspended": "Bloque",
            "blocked": "Bloque", "expired": "Expire",
        }.get(status, status or "Actif")
        status_color = "text-lime-400" if status == "active" else "text-red-400" if status in {"suspended", "blocked"} else "text-yellow-400"
        is_blocked = status in {"suspended", "blocked"}
        toggle_label = "Debloquer" if is_blocked else "Bloquer"
        toggle_action = "unblock" if is_blocked else "block"
        toggle_color = "bg-lime-600 hover:bg-lime-500" if is_blocked else "bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-600/30"
        return f"""
        <tr data-online="{online}">
            <td class="py-3 pl-2 font-bold text-white">{username}</td>
            <td class="py-3">{utype}</td>
            <td class="py-3 text-gray-400">{expiration}</td>
            <td class="py-3 text-gray-400">{quota_txt}</td>
            <td class="py-3">{"🟢" if online == "1" else "⚪"}</td>
            <td class="py-3 text-gray-500">-</td>
            <td class="py-3 font-bold {status_color}">{status_label}</td>
            <td class="py-3 pr-2 text-right">
                <div class="inline-flex gap-1.5">
                    <button onclick="resetClientPassword({uid})" class="bg-white/10 hover:bg-white/20 text-gray-300 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition" title="Reinitialiser le mot de passe">
                        <i class="fas fa-key"></i>
                    </button>
                    <button onclick="downgradeClient({uid})" class="bg-white/10 hover:bg-orange-600/30 text-orange-300 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition" title="Retrograder vers Gratuit">
                        <i class="fas fa-arrow-down"></i>
                    </button>
                    <button onclick="toggleClientStatus({uid}, '{toggle_action}')" class="{toggle_color} text-white px-3 py-1.5 rounded-lg text-[10px] font-bold transition">{toggle_label}</button>
                </div>
            </td>
        </tr>"""

    def _client_option_html(user: dict[str, Any]) -> str:
        uid = int(user.get("id", 0) or 0)
        username = html.escape(str(user.get("username", "") or ""))
        return f'<option value="{uid}">{username}</option>'

    @router.get("/api/revendeur/banner")
    async def api_revendeur_banner_get(request: Request):
        """Renvoie la banniere personnalisee du revendeur connecte pour
        l'emplacement labo_surf_rail (celle de l'app Labo Surf), ou null s'il
        n'en a pas encore defini -- dans ce cas, ses clients voient la
        banniere par defaut (voir /api/ads/active)."""
        actor = _api_user(request)
        if isinstance(actor, JSONResponse):
            return actor
        if str(actor.get("type", "") or "") != "Revendeur" and not has_root_access(actor):
            return JSONResponse({"status": "error", "message": "Reserve aux revendeurs."}, status_code=403)

        ads_repo = getattr(db, "ads", None)
        if ads_repo is None or not callable(getattr(ads_repo, "get_all", None)):
            return {"status": "ok", "banner": None}

        actor_id = int(actor.get("id", 0) or 0)
        own = [
            a for a in ads_repo.get_all()
            if int(a.get("reseller_id", 0) or 0) == actor_id and "labo_surf_rail" in (a.get("locations") or [])
        ]
        return {"status": "ok", "banner": own[0] if own else None}

    @router.post("/api/revendeur/banner")
    async def api_revendeur_banner_save(request: Request):
        """Cree ou met a jour la banniere personnalisee du revendeur connecte.
        Toujours forcee sur reseller_id = son propre compte et
        locations = ['labo_surf_rail'] -- un revendeur ne peut jamais
        personnaliser une banniere pour un autre emplacement ni un autre
        revendeur, quoi qu'il transmette dans le corps de la requete."""
        actor = _api_user(request)
        if isinstance(actor, JSONResponse):
            return actor
        if str(actor.get("type", "") or "") != "Revendeur" and not has_root_access(actor):
            return JSONResponse({"status": "error", "message": "Reserve aux revendeurs."}, status_code=403)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        ads_repo = getattr(db, "ads", None)
        if ads_repo is None or not callable(getattr(ads_repo, "save", None)):
            return JSONResponse({"status": "error", "message": "Stockage bannieres indisponible."}, status_code=500)

        actor_id = int(actor.get("id", 0) or 0)
        existing = [
            a for a in ads_repo.get_all()
            if int(a.get("reseller_id", 0) or 0) == actor_id and "labo_surf_rail" in (a.get("locations") or [])
        ]

        payload = {
            "id": existing[0]["id"] if existing else None,
            "text": str(body.get("text", "") or "").strip()[:120],
            "link": str(body.get("link", "") or "").strip()[:300],
            "color": str(body.get("color", "#39ff14") or "#39ff14").strip()[:20],
            "style": str(body.get("style", "neon") or "neon").strip()[:30],
            "image": str(body.get("image", "") or "").strip()[:300],
            "active": True,
            "priority": 1,
            "locations": ["labo_surf_rail"],
            "reseller_id": actor_id,
        }
        if not payload["text"]:
            return JSONResponse({"status": "error", "message": "Le texte de la banniere est obligatoire."}, status_code=400)

        saved = ads_repo.save(payload)
        return {"status": "ok", "banner": saved}

    @router.get("/api/revendeur/clients")
    async def api_revendeur_clients(request: Request):
        """Liste JSON legere des clients du revendeur connecte, pour l'app Labo Surf
        (onglet 'Mes clients'). Reutilise _clients_for_actor (meme source que la page
        HTML /revendeur/users) mais ne renvoie que des champs non-sensibles."""
        actor = _api_user(request)
        if isinstance(actor, JSONResponse):
            return actor
        clients = _clients_for_actor(actor)
        items = []
        for u in clients:
            items.append({
                "id": u.get("id"),
                "username": str(u.get("username", "") or ""),
                "type": str(u.get("type", "") or ""),
                "status": str(u.get("status", "active") or "active"),
                "expiration": str(u.get("expiration", "") or ""),
                "quota_gb": u.get("quota_gb"),
            })
        return {"status": "ok", "clients": items, "total": len(items)}

    @router.get("/revendeur/users")
    async def reseller_users_page(request: Request):
        denied = _page_guard(request, next_url="/revendeur/users", need="users.reseller.manage")
        if denied is not None:
            return denied
        actor = get_current_user(request) if callable(get_current_user) else None
        if not isinstance(actor, dict):
            return _json_forbidden("Non authentifie.")
        clients = _clients_for_actor(actor)
        rows_html = "".join(_client_row_html(u) for u in clients) or (
            '<tr><td colspan="8" class="py-8 text-center text-gray-500 italic">Aucun client pour le moment.</td></tr>'
        )
        options_html = "".join(_client_option_html(u) for u in clients)
        return _template_response(
            templates,
            "reseller-users.html",
            {"request": request, "CLIENT_ROWS": rows_html, "CLIENT_OPTIONS": options_html},
        )

    @router.post("/revendeur/users/renew")
    async def reseller_users_renew(request: Request):
        denied = _page_guard(request, next_url="/revendeur/users", need="users.reseller.manage")
        if denied is not None:
            return denied
        actor = get_current_user(request) if callable(get_current_user) else None
        if not isinstance(actor, dict):
            return _json_forbidden("Non authentifie.")
        try:
            form = await request.form()
        except Exception:
            form = {}
        try:
            user_id = int(str(form.get("user_id", "0") or "0"))
        except Exception:
            user_id = 0
        target = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(target, dict) or not _can_manage_client(actor, target):
            return RedirectResponse("/revendeur/users?tab=manage&err=forbidden", status_code=303)

        updated = dict(target)
        try:
            days = int(str(form.get("days", "0") or "0"))
        except Exception:
            days = 0
        if days > 0:
            _extend_user_expiration(updated, days=days)
        try:
            gb = float(str(form.get("gb", "0") or "0"))
        except Exception:
            gb = 0.0
        if gb > 0:
            current_quota = updated.get("quota_gb")
            updated["quota_gb"] = (float(current_quota) if current_quota not in (None, "") else 0.0) + gb
        if users_repo is not None and callable(getattr(users_repo, "save", None)):
            users_repo.save(updated)
        return RedirectResponse("/revendeur/users?tab=manage&ok=renewed", status_code=303)

    @router.post("/api/revendeur/users/block")
    async def reseller_users_block(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        try:
            user_id = int(body.get("id", 0) or 0) if isinstance(body, dict) else 0
        except Exception:
            user_id = 0
        target = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(target, dict):
            return JSONResponse({"status": "error", "message": "Client introuvable."}, status_code=404)
        if not _can_manage_client(user, target):
            return _json_forbidden("Vous ne pouvez pas gerer ce client.")
        updated = dict(target)
        updated["status"] = "suspended"
        if users_repo is not None and callable(getattr(users_repo, "save", None)):
            users_repo.save(updated)
        return {"status": "ok", "message": "Client bloque."}

    @router.post("/api/revendeur/users/unblock")
    async def reseller_users_unblock(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        try:
            user_id = int(body.get("id", 0) or 0) if isinstance(body, dict) else 0
        except Exception:
            user_id = 0
        target = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(target, dict):
            return JSONResponse({"status": "error", "message": "Client introuvable."}, status_code=404)
        if not _can_manage_client(user, target):
            return _json_forbidden("Vous ne pouvez pas gerer ce client.")
        updated = dict(target)
        updated["status"] = "active"
        updated["forbidden_attempts"] = 0
        updated["login_failed_attempts"] = 0
        updated["login_locked_until"] = ""
        if users_repo is not None and callable(getattr(users_repo, "save", None)):
            users_repo.save(updated)
        return {"status": "ok", "message": "Client debloque."}

    @router.post("/api/revendeur/users/reset-password")
    async def reseller_users_reset_password(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        try:
            user_id = int(body.get("id", 0) or 0) if isinstance(body, dict) else 0
        except Exception:
            user_id = 0
        new_password = str(body.get("new_password", "") or "").strip() if isinstance(body, dict) else ""

        target = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(target, dict):
            return JSONResponse({"status": "error", "message": "Client introuvable."}, status_code=404)
        if not _can_manage_client(user, target):
            return _json_forbidden("Vous ne pouvez pas gerer ce client.")

        if not new_password:
            new_password = secrets.token_urlsafe(6)
        if _is_weak_password(new_password, str(target.get("username", "") or "")):
            return JSONResponse(
                {"status": "error", "message": "Mot de passe trop faible (8 caracteres min., evitez les mots evidents)."},
                status_code=400,
            )

        updated = dict(target)
        updated["password_hash"] = _pwd_context.hash(new_password)
        updated["service_password"] = new_password
        if users_repo is not None and callable(getattr(users_repo, "save", None)):
            users_repo.save(updated)
        return {"status": "ok", "message": "Mot de passe reinitialise.", "new_password": new_password}

    @router.post("/api/revendeur/users/downgrade")
    async def reseller_users_downgrade(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        try:
            user_id = int(body.get("id", 0) or 0) if isinstance(body, dict) else 0
        except Exception:
            user_id = 0
        target = _load_user_by_id(user_id) if user_id > 0 else None
        if not isinstance(target, dict):
            return JSONResponse({"status": "error", "message": "Client introuvable."}, status_code=404)
        if str(target.get("type", "") or "").strip() == "ADMIN":
            return _json_forbidden("Impossible de retrograder un compte administrateur.")
        if not _can_manage_client(user, target):
            return _json_forbidden("Vous ne pouvez pas gerer ce client.")

        updated = dict(target)
        updated["type"] = "Gratuit"
        updated["role_code"] = "client"
        updated["default_panel_key"] = "free"
        updated["status"] = "active"
        updated["expiration"] = ""
        updated["quota_gb"] = None
        if users_repo is not None and callable(getattr(users_repo, "save", None)):
            users_repo.save(updated)
        return {"status": "ok", "message": "Client retrograde vers Gratuit."}

    @router.get("/revendeur/settings/banner")
    async def reseller_banner_page(request: Request):
        denied = _page_guard(request, next_url="/revendeur/settings/banner", need="ads.reseller.manage")
        if denied is not None:
            return denied
        return _template_response(templates, "revendeur-banner.html", {"request": request})

    @router.get("/revendeur/settings/payment")
    async def reseller_payment_settings_page(request: Request):
        denied = _page_guard(request, next_url="/revendeur/settings/payment", need="payments.reseller.settings")
        if denied is not None:
            return denied
        return _template_response(templates, "revendeur-payment-settings.html", {"request": request})

    @router.get("/api/revendeur/settings/payment")
    async def reseller_payment_settings_get(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        allow_custom = bool(user.get("allow_custom_payments", False)) or str(user.get("type", "") or "") == "ADMIN"
        return {
            "status": "ok",
            "om_number": str(user.get("om_number", "") or ""),
            "momo_number": str(user.get("momo_number", "") or ""),
            "allow_custom_payments": allow_custom,
        }

    @router.post("/api/revendeur/settings/payment")
    async def reseller_payment_settings_save(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        allow_custom = bool(user.get("allow_custom_payments", False)) or str(user.get("type", "") or "") == "ADMIN"
        if not allow_custom:
            return _json_forbidden("Configuration verrouillee par l administrateur")

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        saved = _save_user_payment_settings(
            user,
            om_number=str(body.get("om_number", "") or "").strip()[:32],
            momo_number=str(body.get("momo_number", "") or "").strip()[:32],
        )
        return {
            "status": "ok",
            "message": "Coordonnees de paiement mises a jour.",
            "om_number": str(saved.get("om_number", "") or ""),
            "momo_number": str(saved.get("momo_number", "") or ""),
        }

    @router.get("/revendeur/payments")
    async def reseller_payments_page(request: Request):
        denied = _page_guard(request, next_url="/revendeur/payments", need="payments.reseller.view")
        if denied is not None:
            return denied
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return RedirectResponse("/acces?err=forbidden", status_code=303)
        payments = _payment_rows_for_user(user)
        pending_requests: list[dict[str, Any]] = []
        if service_requests_repo is not None and callable(getattr(service_requests_repo, "get_all", None)):
            try:
                all_requests = service_requests_repo.get_all()
            except Exception:
                all_requests = []
            if isinstance(all_requests, list):
                pending_requests = [
                    dict(r) for r in all_requests
                    if isinstance(r, dict)
                    and str(r.get("status", "") or "").strip().lower() == "pending"
                    and _can_manage_service_request(user, r)
                ]
        return _template_response(
            templates,
            "revendeur-payments.html",
            {"request": request, "payments": payments, "service_requests": pending_requests},
        )

    @router.post("/api/revendeur/payments/approve")
    async def reseller_payments_approve(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        reference = str(body.get("reference", "") if isinstance(body, dict) else "").strip()
        if not reference:
            return JSONResponse({"status": "error", "message": "Reference invalide."}, status_code=400)
        payment = _find_payment_for_user(reference, user)
        if not isinstance(payment, dict):
            return JSONResponse({"status": "error", "message": "Paiement introuvable."}, status_code=404)
        if str(payment.get("status", "") or "").strip().lower() != "pending":
            return JSONResponse({"status": "error", "message": "Paiement deja traite."}, status_code=409)
        if not callable(getattr(payments_repo, "update_status", None)):
            return JSONResponse({"status": "error", "message": "Stockage paiement indisponible."}, status_code=500)

        approved_meta = {
            "approved_by": str(user.get("username", "") or ""),
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "payment_action": "approved",
        }
        # Activation AVANT de marquer le paiement comme completed
        # pour éviter une divergence si l'activation échoue.
        try:
            activation = _activate_user_for_payment(payment)
        except Exception:
            return JSONResponse({"status": "error", "message": "Erreur lors de l'activation du compte."}, status_code=502)
        provisioning = None
        raw_payload = _merge_payment_raw(payment, **approved_meta)
        if activation is not None:
            raw_payload = _merge_payment_raw(
                payment,
                **approved_meta,
                previous_user_state=activation.get("transition", {}).get("before"),
                resulting_user_state=activation.get("transition", {}).get("after"),
            )
            provisioning = _provision_and_activate(activation["user"], reason="payment_approved")
        payments_repo.update_status(
            int(payment.get("id", 0) or 0),
            "completed",
            raw_payload,
        )

        return {
            "status": "ok",
            "message": "Paiement valid?. La configuration du serveur a ?t? synchronis?e.",
            "provisioning": provisioning,
        }

    @router.post("/api/revendeur/payments/reject")
    async def reseller_payments_reject(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        reference = str(body.get("reference", "") if isinstance(body, dict) else "").strip()
        if not reference:
            return JSONResponse({"status": "error", "message": "Reference invalide."}, status_code=400)
        payment = _find_payment_for_user(reference, user)
        if not isinstance(payment, dict):
            return JSONResponse({"status": "error", "message": "Paiement introuvable."}, status_code=404)
        if not callable(getattr(payments_repo, "update_status", None)):
            return JSONResponse({"status": "error", "message": "Stockage paiement indisponible."}, status_code=500)
        current_status = str(payment.get("status", "") or "").strip().lower()
        if current_status == "completed":
            return JSONResponse({"status": "error", "message": "Paiement deja valide; utilisez remboursement."}, status_code=409)
        payments_repo.update_status(
            int(payment.get("id", 0) or 0),
            "rejected",
            _merge_payment_raw(
                payment,
                rejected_by=str(user.get("username", "") or ""),
                rejected_at=datetime.now(timezone.utc).isoformat(),
                payment_action="rejected",
            ),
        )
        return {"status": "ok", "message": "Paiement rejete."}

    @router.post("/api/revendeur/payments/refund")
    async def reseller_payments_refund(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user
        try:
            body = await request.json()
        except Exception:
            body = {}
        reference = str(body.get("reference", "") if isinstance(body, dict) else "").strip()
        if not reference:
            return JSONResponse({"status": "error", "message": "Reference invalide."}, status_code=400)
        payment = _find_payment_for_user(reference, user)
        if not isinstance(payment, dict):
            return JSONResponse({"status": "error", "message": "Paiement introuvable."}, status_code=404)
        if not callable(getattr(payments_repo, "update_status", None)):
            return JSONResponse({"status": "error", "message": "Stockage paiement indisponible."}, status_code=500)
        current_status = str(payment.get("status", "") or "").strip().lower()
        if current_status != "completed":
            return JSONResponse({"status": "error", "message": "Remboursement possible uniquement sur un paiement valide."}, status_code=409)

        refund_meta = {
            "refunded_by": str(user.get("username", "") or ""),
            "refunded_at": datetime.now(timezone.utc).isoformat(),
            "payment_action": "refunded",
        }
        # Refund utilisateur AVANT de marquer le paiement comme refunded
        # pour éviter une divergence si le refund échoue.
        try:
            refund = _refund_user_for_payment(payment)
        except Exception:
            return JSONResponse({"status": "error", "message": "Erreur lors de la mise a jour du compte."}, status_code=502)
        provisioning = None
        raw_payload = _merge_payment_raw(payment, **refund_meta)
        if refund is not None:
            raw_payload = _merge_payment_raw(
                payment,
                **refund_meta,
                restored_from_snapshot=refund.get("transition", {}).get("restored_from_snapshot"),
                previous_user_state=refund.get("transition", {}).get("before"),
                resulting_user_state=refund.get("transition", {}).get("after"),
            )
            provisioning = _sync_user_transport_state(refund["user"], reason="payment_refunded")
        payments_repo.update_status(
            int(payment.get("id", 0) or 0),
            "refunded",
            raw_payload,
        )

        return {
            "status": "ok",
            "message": "Paiement rembours?. Les acc?s ont ?t? synchronis?s.",
            "provisioning": provisioning,
        }

    @router.post("/api/revendeur/generate-demo")
    async def reseller_generate_demo(request: Request):
        user = _api_user(request)
        if isinstance(user, JSONResponse):
            return user

        reseller_id = int(user.get("id", 0) or 0)
        if not _check_demo_rate_limit(reseller_id):
            return JSONResponse(
                {"status": "error", "message": f"Limite atteinte : {_DEMO_RATE_MAX_PER_WINDOW} demos maximum par 24h. Reessaie plus tard."},
                status_code=429,
            )

        hours = 3  # duree fixe, non modifiable par le revendeur (decision produit)
        if not callable(build_user_configs):
            return JSONResponse({"status": "error", "message": "Generation indisponible."}, status_code=500)

        demo_username = f"demo_{secrets.token_hex(2)}"
        demo_uuid = str(uuid.uuid4())
        expiration = (datetime.now(timezone.utc) + timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M")
        demo_user = {
            "username": demo_username,
            "type": "VIP",
            "uuid_secondary": demo_uuid,
            "status": "active",
        }
        try:
            configs = build_user_configs(demo_user)
        except Exception as exc:
            return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)
        if not isinstance(configs, list):
            configs = []
        return {
            "status": "success",
            "demo_username": demo_username,
            "expiration": expiration,
            "configs": configs,
        }

    return router
