from __future__ import annotations

import re
import time
from datetime import date, timedelta
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.core.access import can_manage_user_lineage, canonicalize_legacy_user_type, resolve_home_path, resolve_role_code
from app.core.permissions import PermissionEvaluator, has_permission


def _json_error(message: str, *, status_code: int) -> JSONResponse:
    return JSONResponse(
        {"status": "error", "message": str(message or "Erreur")},
        status_code=status_code,
    )


def _safe_avatar(value: Any, safe_avatar_url: Callable[[Any], str] | None) -> str:
    if callable(safe_avatar_url):
        try:
            return str(safe_avatar_url(value) or "")
        except Exception:
            return ""
    return str(value or "").strip()


def _ui_user_type(user: dict[str, Any] | None) -> str:
    legacy_type = canonicalize_legacy_user_type((user or {}).get("type"))
    if legacy_type == "Revendeur":
        return "REVENDEUR"
    return legacy_type


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
    base = today if current is None or current < today else current
    user["expiration"] = (base + timedelta(days=max(1, int(days or 1)))).isoformat()


def _profile_bio(user: dict[str, Any]) -> str:
    notes = str(user.get("notes", "") or "").strip()
    if notes:
        return notes.splitlines()[0][:180]
    return f"Membre {_ui_user_type(user)} du reseau Free-Surf."


def _message_count_for_user(tchat_repo: Any, username: str, max_messages: int) -> int:
    getter = getattr(tchat_repo, "get_recent", None)
    if not callable(getter):
        return 0

    count = 0
    target = str(username or "").strip().lower()
    for row in getter(limit=max(1, int(max_messages or 500))):
        if not isinstance(row, dict):
            continue
        if str(row.get("username", "") or "").strip().lower() == target:
            count += 1
    return count


def _vip_duration_days(duration_label: Any) -> int:
    text = str(duration_label or "").strip().lower()
    if not text:
        return 30
    match = re.search(r"(\d+)", text)
    amount = int(match.group(1)) if match else 30
    if any(token in text for token in ("an", "year", "yr")):
        return max(1, amount) * 365
    if any(token in text for token in ("mois", "month")):
        return max(1, amount) * 30
    if any(token in text for token in ("sem", "week")):
        return max(1, amount) * 7
    return max(1, amount)


def create_user_router(
    *,
    db: Any,
    cfg: Any,
    get_current_user: Callable[[Request], dict | None] | None = None,
    build_user_configs: Callable[[dict], list[dict]] | None = None,
    vpn_orchestrator: Any = None,
    safe_avatar_url: Callable[[Any], str] | None = None,
    ssh_dropbear_provisioner: Any = None,
    hysteria2_provisioner: Any = None,
    slowdns_provisioner: Any = None,
    zivpn_udp_provisioner: Any = None,
    xui_provisioner: Any = None,
) -> APIRouter:
    router = APIRouter()
    users_repo = getattr(db, "users", None)
    _permission_evaluator = PermissionEvaluator(db)
    activation_keys_repo = getattr(db, "activation_keys", None)
    vip_tokens_repo = getattr(db, "vip_tokens", None)
    action_tokens_repo = getattr(db, "account_action_tokens", None)
    tchat_repo = getattr(db, "tchat", None)
    subscriptions_repo = getattr(db, "subscriptions", None)
    services_repo = getattr(db, "services", None)
    configurations_repo = getattr(db, "configurations", None)
    max_messages = max(100, int(getattr(cfg, "TCHAT_MAX_MESSAGES", 500) or 500))

    def _record_subscription(user: dict[str, Any], *, source: str) -> None:
        """Enregistre l'activation dans subscriptions + services + configurations
        (historique structure). N'interrompt jamais le flux principal en cas
        d'echec : users.type/expiration et build_user_configs() a la volee
        restent la source de verite immediate utilisee partout ailleurs."""
        add_sub = getattr(subscriptions_repo, "add", None)
        if not callable(add_sub):
            return
        try:
            sub = add_sub({
                "user_id": int(user.get("id", 0) or 0),
                "plan": str(user.get("type", "") or ""),
                "status": "active",
                "source": source,
                "expires_at": str(user.get("expiration", "") or ""),
            })
        except Exception:
            return

        # Service + snapshot des configurations, best-effort - la generation
        # a la volee (build_user_configs) reste la source de verite si ceci echoue.
        add_service = getattr(services_repo, "add", None)
        if not callable(add_service):
            return
        try:
            service = add_service({
                "user_id": int(user.get("id", 0) or 0),
                "subscription_id": sub.get("id") if isinstance(sub, dict) else None,
                "type": "VPN",
                "status": "active",
            })
        except Exception:
            return

        if not callable(build_user_configs):
            return
        add_config = getattr(configurations_repo, "add", None)
        if not callable(add_config):
            return
        try:
            generated = build_user_configs(user)
        except Exception:
            generated = []
        if not isinstance(generated, list):
            return
        for cfg_item in generated:
            if not isinstance(cfg_item, dict):
                continue
            try:
                add_config({
                    "user_id": int(user.get("id", 0) or 0),
                    "service_id": service.get("id") if isinstance(service, dict) else None,
                    "protocol": str(cfg_item.get("protocol", "") or ""),
                    "status": "active",
                    "technical_data": str(cfg_item.get("uri", "") or ""),
                    "expires_at": str(user.get("expiration", "") or ""),
                })
            except Exception:
                continue

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

    def _collect_transport_provisioning(user: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
        items: list[dict[str, Any]] = []
        for provisioner in (ssh_dropbear_provisioner, hysteria2_provisioner, slowdns_provisioner, zivpn_udp_provisioner, xui_provisioner):
            ensure = getattr(provisioner, "ensure_user", None)
            if not callable(ensure):
                continue
            result = ensure(dict(user), reason=reason)
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

    def _api_user(request: Request) -> dict[str, Any] | JSONResponse:
        if not callable(get_current_user):
            return _json_error("Authentification indisponible.", status_code=500)
        user = get_current_user(request)
        if not isinstance(user, dict):
            return _json_error("Authentification requise.", status_code=401)
        return dict(user)

    def _load_user_by_id(user_id: int) -> dict[str, Any] | None:
        getter = getattr(users_repo, "get_by_id", None)
        if not callable(getter):
            return None
        try:
            loaded = getter(int(user_id))
        except Exception:
            return None
        return dict(loaded) if isinstance(loaded, dict) else None

    def _can_manage_target_user(actor: dict[str, Any], target: dict[str, Any]) -> bool:
        return can_manage_user_lineage(actor, target, _load_user_by_id)

    @router.get("/api/user/get-configs")
    async def get_user_configs(request: Request):
        """RESERVE AUX ADMINS (super admin + delegation admin.config).
        Vue navigable/copiable des configurations — exactement ce qui ne doit plus
        etre accessible aux utilisateurs ordinaires ni aux revendeurs (decision du
        proprietaire du produit : plus aucun lien de connexion visible/copiable en
        dehors de l'app Labo Surf, qui l'utilise en interne sans jamais l'afficher).
        Pour la connexion normale d'un utilisateur, voir /api/user/connect.
        """
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user
        if not has_permission(current_user, "admin.config", _permission_evaluator, time.time()):
            return _json_error(
                "Cette vue est reservee aux administrateurs. Utilise l'app Labo Surf pour te connecter.",
                status_code=403,
            )

        target_user = current_user
        raw_target_user_id = str(request.query_params.get("target_user_id", "") or "").strip()
        if raw_target_user_id:
            try:
                target_user_id = int(raw_target_user_id)
            except Exception:
                return _json_error("target_user_id invalide.", status_code=400)

            loaded_user = _load_user_by_id(target_user_id)
            if not isinstance(loaded_user, dict):
                return _json_error("Utilisateur introuvable.", status_code=404)
            if not _can_manage_target_user(current_user, loaded_user):
                return _json_error("Acces refuse a ce client.", status_code=403)
            target_user = loaded_user

        configs = build_user_configs(target_user) if callable(build_user_configs) else []
        if not isinstance(configs, list):
            configs = []

        return {
            "status": "success",
            "configs": configs,
            "user_id": target_user.get("id"),
            "user_uuid": str(target_user.get("uuid_secondary", "") or ""),
            "username": str(target_user.get("username", "") or ""),
        }

    def _check_trial_abuse(current_user: dict, server_id, device_id: str) -> JSONResponse | None:
        """Verifie/enregistre l'anti-abus de l'essai Gratuit limite dans le
        temps. Retourne une reponse d'erreur JSON si l'appareil a deja
        consomme son essai sur UN AUTRE compte, sinon None (autorise) --
        et marque l'essai comme consomme au passage si c'est la premiere
        utilisation. Ne s'applique qu'aux comptes Gratuit sur un profil dont
        la regle definit une duree limitee (max_duration_minutes > 0)."""
        user_type = canonicalize_legacy_user_type(current_user.get("type"))
        if user_type != "Gratuit":
            return None  # VIP/Revendeur/ADMIN jamais concernes

        rules_repo = getattr(db, "server_plan_rules", None)
        if rules_repo is None or not callable(getattr(rules_repo, "get_rule", None)):
            return None

        try:
            rule = rules_repo.get_rule(server_id, "Gratuit")
        except Exception:
            rule = None
        if not rule or int(rule.get("max_duration_minutes", 0) or 0) <= 0:
            return None  # pas de limite de duree definie sur ce profil -> rien a verifier

        if not device_id:
            # Aucun identifiant d'appareil transmis : on ne peut pas verifier,
            # mais on ne bloque pas non plus (compatibilite anciennes versions
            # de l'app qui n'envoient pas encore device_id).
            return None

        trial_repo = getattr(db, "device_trial_usage", None)
        if trial_repo is None:
            return None

        existing = trial_repo.get_by_device_id(device_id)
        current_user_id = int(current_user.get("id", 0) or 0)

        if existing and bool(existing.get("trial_used")) and int(existing.get("first_user_id", 0) or 0) != current_user_id:
            return JSONResponse(
                {
                    "status": "error",
                    "message": "L'essai gratuit sur ce type de serveur a deja ete utilise sur cet appareil. Passe en VIP pour un acces complet.",
                },
                status_code=403,
            )

        if not existing:
            try:
                trial_repo.mark_trial_used(device_id, user_id=current_user_id, username=str(current_user.get("username", "") or ""))
            except Exception:
                pass
        return None

    def _canonicalize_role(user_type: str) -> str:
        t = str(user_type or "").strip().lower()
        if t == "admin":
            return "admin"
        if t == "revendeur":
            return "revendeur"
        return "client"

    @router.get("/api/user/messages")
    async def api_user_messages_list(request: Request):
        """Messagerie privee du compte connecte : sa propre conversation avec
        son gestionnaire (admin ou revendeur selon la filiation). Marque
        automatiquement les messages du gestionnaire comme lus."""
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        messages_repo = getattr(db, "private_messages", None)
        if messages_repo is None:
            return {"status": "ok", "messages": []}

        user_id = int(current_user.get("id", 0) or 0)
        try:
            messages_repo.mark_read(user_id, reader_is_client=True)
        except Exception:
            pass
        try:
            messages = messages_repo.get_conversation(user_id)
        except Exception:
            messages = []
        return {"status": "ok", "messages": messages}

    @router.post("/api/user/messages")
    async def api_user_messages_send(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        messages_repo = getattr(db, "private_messages", None)
        if messages_repo is None or not callable(getattr(messages_repo, "add", None)):
            return JSONResponse({"status": "error", "message": "Messagerie indisponible."}, status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        text = str(body.get("body", "") or "").strip()[:2000]
        attachment_data = str(body.get("attachment_data", "") or "")
        attachment_mime = str(body.get("attachment_mime", "") or "")
        attachment_filename = str(body.get("attachment_filename", "") or "")
        message_type = "payment_proof" if attachment_data and str(body.get("message_type", "")) == "payment_proof" else "text"

        if not text and not attachment_data:
            return JSONResponse({"status": "error", "message": "Message vide."}, status_code=400)

        # Garde-fou : une piece jointe base64 raisonnable seulement (evite d'engorger
        # la base avec des fichiers enormes -- meme limite que les avatars, ~2 Mo).
        if attachment_data and len(attachment_data) > 2_800_000:
            return JSONResponse({"status": "error", "message": "Fichier trop volumineux (2 Mo max)."}, status_code=400)

        user_id = int(current_user.get("id", 0) or 0)
        msg = messages_repo.add({
            "conversation_user_id": user_id,
            "sender_user_id": user_id,
            "sender_username": str(current_user.get("username", "") or ""),
            "sender_role": "client",
            "body": text,
            "message_type": message_type,
            "attachment_data": attachment_data,
            "attachment_mime": attachment_mime,
            "attachment_filename": attachment_filename,
        })
        return {"status": "ok", "sent": msg}

    @router.post("/api/user/subscription/request")
    async def api_user_subscription_request(request: Request):
        """Demande de renouvellement/mise a niveau depuis l'app Labo Surf,
        authentifiee (pas besoin de redemander identifiants/licence, contrairement
        au formulaire web /abonnement -- l'utilisateur est deja connecte).

        Respecte la filiation automatiquement : reutilise exactement le meme
        systeme de demandes (service_requests) que le site web, deja teste et
        deja filtre correctement -- un revendeur ne voit que les demandes de
        SES clients, le super admin voit TOUJOURS tout (y compris les clients
        dont le revendeur a expire/perdu ses droits). Rien de nouveau a
        construire cote filtrage, seulement ce point d'entree pour l'app."""
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        service_requests_repo = getattr(db, "service_requests", None)
        if service_requests_repo is None or not callable(getattr(service_requests_repo, "add", None)):
            return JSONResponse({"status": "error", "message": "Service indisponible."}, status_code=500)

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        kind = str(body.get("kind", "") or "").strip()
        if kind not in {"upgrade", "renewal"}:
            return JSONResponse({"status": "error", "message": "Type de demande invalide."}, status_code=400)

        from datetime import datetime, timezone
        payload = {
            "kind": kind,
            "status": "pending",
            "username": str(current_user.get("username", "") or ""),
            "target_user_id": int(current_user.get("id", 0) or 0),
            "submitted_by_user_id": int(current_user.get("id", 0) or 0),
            "contact": str(current_user.get("contact", "") or current_user.get("username", "") or ""),
            "message": str(body.get("message", "") or "").strip()[:500],
            "license": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        if kind == "upgrade":
            target_plan = str(body.get("target_plan", "") or "").strip()
            if target_plan not in {"VIP", "Revendeur", "PREMIUM"}:
                return JSONResponse({"status": "error", "message": "Plan cible invalide."}, status_code=400)
            payload["target_plan"] = target_plan
        else:
            try:
                duration_days = int(body.get("duration_days", 0) or 0)
            except Exception:
                duration_days = 0
            if duration_days not in {7, 30, 90, 365}:
                return JSONResponse({"status": "error", "message": "Duree invalide."}, status_code=400)
            payload["duration_days"] = duration_days

        service_requests_repo.add(payload)
        return {
            "status": "ok",
            "message": "Demande envoyee. Elle sera traitee par ton revendeur, ou par l'administrateur si tu n'en as pas.",
        }

    @router.get("/api/user/connect")
    async def get_user_connect_config(request: Request):
        """Reservee a l'app Labo Surf : renvoie la configuration necessaire pour
        etablir le tunnel de l'utilisateur CONNECTE lui-meme (jamais un autre
        compte, pas de target_user_id ici -- c'est volontaire). L'app doit
        transmettre cette reponse directement au moteur de connexion, sans
        jamais l'afficher ni la stocker de facon persistante (localStorage,
        etc.) -- seulement en memoire le temps de la session, comme deja fait
        pour le token de connexion.

        Parametre optionnel `server_id` : si fourni et que l'orchestrateur VPN
        est disponible, la configuration est construite pour LE MOTEUR REEL
        assigne a ce serveur precis (voir /admin/servers et
        app/core/vpn_orchestrator.py). Sans ce parametre, comportement
        historique preserve (Xray via build_user_configs).

        Parametre optionnel `device_id` : identifiant d'appareil (pas de
        compte) transmis par l'app. Sert uniquement a l'anti-abus de l'essai
        Gratuit limite dans le temps -- voir _check_trial_abuse ci-dessous.
        N'a aucun effet pour les plans VIP/Revendeur/ADMIN.
        """
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        raw_server_id = str(request.query_params.get("server_id", "") or "").strip()
        device_id = str(request.query_params.get("device_id", "") or "").strip()

        if raw_server_id and vpn_orchestrator is not None:
            try:
                server_id_val: int | str = int(raw_server_id)
            except Exception:
                server_id_val = raw_server_id

            abuse_denied = _check_trial_abuse(current_user, server_id_val, device_id)
            if abuse_denied is not None:
                return abuse_denied

            try:
                vpn_config = vpn_orchestrator.get_config_for_user(current_user, server_id=server_id_val)
                response_payload = {
                    "status": "success",
                    "configs": [{
                        "protocol": vpn_config.protocol,
                        "remark": f"{current_user.get('type', 'Gratuit')} - {vpn_config.engine}",
                        "uri": vpn_config.uri,
                    }],
                }
                # Transmet la limite de duree (si definie) pour que l'app puisse
                # afficher un compte a rebours reel et couper automatiquement,
                # au lieu d'un simple chronometre qui compte sans jamais informer
                # l'utilisateur d'une limite existante (voir /admin/servers).
                rules_repo = getattr(db, "server_plan_rules", None)
                if rules_repo is not None and callable(getattr(rules_repo, "get_rule", None)):
                    try:
                        user_plan = canonicalize_legacy_user_type(current_user.get("type"))
                        rule = rules_repo.get_rule(server_id_val, user_plan)
                        if rule and int(rule.get("max_duration_minutes", 0) or 0) > 0:
                            response_payload["trial_limit_minutes"] = int(rule["max_duration_minutes"])
                        if rule and int(rule.get("quota_mb", 0) or 0) > 0:
                            response_payload["trial_quota_mb"] = int(rule["quota_mb"])
                    except Exception:
                        pass
                return response_payload
            except Exception:
                pass  # repli silencieux sur le comportement historique ci-dessous

        configs = build_user_configs(current_user) if callable(build_user_configs) else []
        if not isinstance(configs, list):
            configs = []

        return {"status": "success", "configs": configs}

    @router.post("/api/user/activate")
    async def activate_user_key(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        try:
            payload = await request.json()
        except Exception:
            try:
                form = await request.form()
                payload = dict(form)
            except Exception:
                payload = {}

        key = str(payload.get("key") or payload.get("activation_key") or "").strip().upper()
        if not key:
            return _json_error("Cle d'activation requise.", status_code=400)

        if activation_keys_repo is None or not callable(getattr(activation_keys_repo, "get_by_key", None)):
            return _json_error("Stockage des cles indisponible.", status_code=500)

        entry = activation_keys_repo.get_by_key(key)
        if not isinstance(entry, dict):
            return _json_error("Cle invalide.", status_code=404)
        if bool(entry.get("is_used", False)):
            return _json_error("Cette cle a deja ete utilisee.", status_code=400)

        if users_repo is None or not callable(getattr(users_repo, "save", None)):
            return _json_error("Stockage utilisateur indisponible.", status_code=500)

        user = dict(current_user)
        user["type"] = canonicalize_legacy_user_type(entry.get("user_type"))
        user["status"] = "active"
        _extend_user_expiration(user, days=int(entry.get("duration_days", 30) or 30))
        saved_user = users_repo.save(user)
        _record_subscription(saved_user, source="activation_key")

        try:
            provisioning = _collect_transport_provisioning(saved_user, reason="activation_key")
        except Exception:
            return _json_error("Provisionnement SSH/Dropbear indisponible.", status_code=502)

        mark_used = getattr(activation_keys_repo, "mark_used", None)
        if callable(mark_used):
            mark_used(key, int(saved_user.get("id", 0) or 0), str(saved_user.get("username", "") or ""))

        payload = {
            "status": "ok",
            "message": (
                f"Cle activee avec succes. "
                f"Abonnement {_ui_user_type(saved_user)} valide jusqu'au {saved_user.get('expiration', '')}."
            ),
        }
        if provisioning is not None:
            payload["provisioning"] = provisioning
        return payload

    @router.post("/vip-verify")
    async def vip_verify(request: Request):
        if not callable(get_current_user):
            return RedirectResponse(url="/acces?next=/vip-login", status_code=303)

        current_user = get_current_user(request)
        if not isinstance(current_user, dict):
            return RedirectResponse(url="/acces?next=/vip-login", status_code=303)

        try:
            form = await request.form()
        except Exception:
            form = {}

        vip_key = str(form.get("vip_key", "") or "").strip()
        if not vip_key:
            return RedirectResponse(url="/vip-login?err=invalid", status_code=303)
        if vip_tokens_repo is None or not callable(getattr(vip_tokens_repo, "get_by_token", None)):
            return RedirectResponse(url="/vip-login?err=invalid", status_code=303)

        entry = vip_tokens_repo.get_by_token(vip_key)
        if not isinstance(entry, dict):
            return RedirectResponse(url="/vip-login?err=invalid", status_code=303)
        if bool(entry.get("is_used", False)):
            return RedirectResponse(url="/vip-login?err=used", status_code=303)
        if float(entry.get("expires_at", 0) or 0) <= time.time():
            return RedirectResponse(url="/vip-login?err=expired", status_code=303)
        if users_repo is None or not callable(getattr(users_repo, "save", None)):
            return RedirectResponse(url="/vip-login?err=invalid", status_code=303)

        user = dict(current_user)
        user["type"] = canonicalize_legacy_user_type(entry.get("type"))
        user["status"] = "active"
        _extend_user_expiration(user, days=_vip_duration_days(entry.get("duration_label")))
        saved_user = users_repo.save(user)
        _record_subscription(saved_user, source="vip_token")

        try:
            _collect_transport_provisioning(saved_user, reason="vip_token")
        except Exception:
            return RedirectResponse(url="/vip-login?err=provisioning", status_code=303)

        mark_used = getattr(vip_tokens_repo, "mark_used", None)
        if callable(mark_used):
            mark_used(vip_key, int(saved_user.get("id", 0) or 0), str(saved_user.get("username", "") or ""))

        return RedirectResponse(url=resolve_home_path(saved_user), status_code=303)

    @router.post("/api/user/redeem-action-token")
    async def redeem_action_token(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        try:
            payload = await request.json()
        except Exception:
            try:
                form = await request.form()
                payload = dict(form)
            except Exception:
                payload = {}

        token_value = str(payload.get("token") or payload.get("action_token") or "").strip()
        if not token_value:
            return _json_error("Code d'action requis.", status_code=400)
        if action_tokens_repo is None or not callable(getattr(action_tokens_repo, "get_by_token", None)):
            return _json_error("Stockage des codes d'action indisponible.", status_code=500)
        if users_repo is None or not callable(getattr(users_repo, "save", None)):
            return _json_error("Stockage utilisateur indisponible.", status_code=500)

        entry = action_tokens_repo.get_by_token(token_value)
        if not isinstance(entry, dict):
            return _json_error("Code invalide.", status_code=404)
        if float(entry.get("revoked_at", 0) or 0) > 0:
            return _json_error("Ce code a ete revoque.", status_code=400)
        if float(entry.get("expires_at", 0) or 0) <= time.time():
            return _json_error("Ce code a expire.", status_code=400)
        if int(entry.get("uses_count", 0) or 0) >= max(1, int(entry.get("max_uses", 1) or 1)):
            return _json_error("Ce code a deja ete utilise.", status_code=400)

        current_user_id = int(current_user.get("id", 0) or 0)
        target_user_id = int(entry.get("target_user_id", 0) or 0)
        if current_user_id <= 0 or target_user_id != current_user_id:
            return _json_error("Ce code n'est pas associe a votre compte.", status_code=403)

        updated_user = dict(current_user)
        token_payload = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}
        purpose = str(entry.get("purpose", "recharge_gb") or "recharge_gb").strip().lower()
        message = "Code applique avec succes."

        if purpose == "recharge_gb":
            amount_gb = float(token_payload.get("amount_gb", 0) or 0)
            if amount_gb <= 0:
                return _json_error("Ce code ne contient aucune recharge valable.", status_code=400)
            current_quota = updated_user.get("quota_gb")
            try:
                current_quota_value = float(current_quota or 0)
            except Exception:
                current_quota_value = 0.0
            updated_user["quota_gb"] = round(current_quota_value + amount_gb, 2)
            message = f"Recharge appliquee: +{amount_gb:g} GB."
        elif purpose == "renewal":
            duration_days = max(1, int(token_payload.get("duration_days", 30) or 30))
            _extend_user_expiration(updated_user, days=duration_days)
            message = f"Abonnement renouvele pour {duration_days} jours."
        elif purpose == "upgrade_plan":
            target_type = canonicalize_legacy_user_type(token_payload.get("target_type") or "PREMIUM")
            if target_type == "ADMIN":
                return _json_error("Ce code n'est pas autorise pour une elevation admin.", status_code=400)
            updated_user["type"] = target_type
            updated_user["status"] = "active"
            duration_days = int(token_payload.get("duration_days", 0) or 0)
            if duration_days > 0:
                _extend_user_expiration(updated_user, days=duration_days)
            amount_gb = float(token_payload.get("amount_gb", 0) or 0)
            if amount_gb > 0:
                updated_user["quota_gb"] = round(amount_gb, 2)
            message = f"Mise a niveau appliquee: {_ui_user_type(updated_user)}."
        else:
            return _json_error("Type de code inconnu.", status_code=400)

        saved_user = users_repo.save(updated_user)
        try:
            provisioning = _collect_transport_provisioning(saved_user, reason=f"action_token:{purpose}")
        except Exception:
            return _json_error("Provisionnement indisponible.", status_code=502)

        mark_used = getattr(action_tokens_repo, "mark_used", None)
        if callable(mark_used):
            if not mark_used(int(entry.get("id", 0) or 0), current_user_id, str(saved_user.get("username", "") or "")):
                return _json_error("Ce code n'est plus utilisable.", status_code=400)

        response_payload = {
            "status": "ok",
            "purpose": purpose,
            "message": message,
            "user": {
                "type": _ui_user_type(saved_user),
                "expiration": str(saved_user.get("expiration", "") or ""),
                "quota_gb": saved_user.get("quota_gb"),
            },
        }
        if provisioning is not None:
            response_payload["provisioning"] = provisioning
        return response_payload

    @router.get("/api/user/me")
    async def user_me(request: Request):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        # Liste blanche explicite : ne jamais renvoyer les champs sensibles
        # (password_hash, service_password, recovery_secret_hash, uuid_secondary,
        # om_number, momo_number, notes, license, etc.) meme si la table users en contient.
        payload = {
            "id": current_user.get("id"),
            "username": str(current_user.get("username", "") or ""),
            "type": _ui_user_type(current_user),
            "status": str(current_user.get("status", "active") or "active"),
            "avatar": _safe_avatar(current_user.get("avatar", ""), safe_avatar_url),
            "expiration": str(current_user.get("expiration", "") or ""),
            "quota_gb": current_user.get("quota_gb"),
            "created_at": str(current_user.get("created_at", "") or ""),
        }
        return payload

    @router.get("/api/user/subscription")
    async def user_subscription(request: Request):
        """Vue dediee abonnement, pensee pour Labo Surf. Utilise la table
        subscriptions si une ligne existe deja pour cet utilisateur (evenements
        enregistres depuis l'ajout de cette table), sinon replie proprement
        sur users.type/expiration qui restent la source de verite immediate."""
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        active_sub = None
        get_active = getattr(subscriptions_repo, "get_active_for_user", None)
        if callable(get_active):
            try:
                active_sub = get_active(int(current_user.get("id", 0) or 0))
            except Exception:
                active_sub = None

        if isinstance(active_sub, dict):
            return {
                "status": "ok",
                "plan": str(active_sub.get("plan", "") or ""),
                "subscription_status": str(active_sub.get("status", "") or ""),
                "source": str(active_sub.get("source", "") or ""),
                "started_at": str(active_sub.get("started_at", "") or ""),
                "expires_at": str(active_sub.get("expires_at", "") or ""),
            }

        # Repli : pas encore d'entree structuree pour cet utilisateur
        return {
            "status": "ok",
            "plan": _ui_user_type(current_user),
            "subscription_status": "active",
            "source": "legacy",
            "started_at": "",
            "expires_at": str(current_user.get("expiration", "") or ""),
        }

    @router.get("/api/user/services")
    async def user_services(request: Request):
        """Liste des services (VPN) de l'utilisateur, avec repli sur une
        entree virtuelle si rien n'a encore ete enregistre en base (compte
        ancien, jamais passe par une activation depuis l'ajout de la table)."""
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        user_id = int(current_user.get("id", 0) or 0)
        rows: list[dict[str, Any]] = []
        get_by_user = getattr(services_repo, "get_by_user", None)
        if callable(get_by_user):
            try:
                rows = get_by_user(user_id)
            except Exception:
                rows = []
        if not isinstance(rows, list):
            rows = []

        if rows:
            return {
                "status": "ok",
                "services": [
                    {
                        "id": row.get("id"),
                        "type": str(row.get("type", "") or ""),
                        "status": str(row.get("status", "") or ""),
                        "server_id": row.get("server_id"),
                        "created_at": str(row.get("created_at", "") or ""),
                    }
                    for row in rows if isinstance(row, dict)
                ],
            }

        # Repli : compte ancien sans entree structuree, mais l'acces VPN existe bien
        return {
            "status": "ok",
            "services": [
                {
                    "id": None,
                    "type": "VPN",
                    "status": str(current_user.get("status", "active") or "active"),
                    "server_id": None,
                    "created_at": "",
                }
            ],
        }

    @router.get("/api/user/servers")
    async def user_servers_list(request: Request):
        """Liste des serveurs disponibles POUR LE PLAN de l'utilisateur connecte.
        Ne renvoie jamais le protocole ni la reference technique -- seulement le
        nom et la localisation, exactement ce que l'utilisateur doit pouvoir
        choisir sans jamais voir la configuration (decision produit)."""
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        servers_repo = getattr(db, "servers", None)
        plan = canonicalize_legacy_user_type(current_user.get("type"))
        rows: list[dict[str, Any]] = []
        if servers_repo is not None and callable(getattr(servers_repo, "get_visible_for_plan", None)):
            try:
                rows = servers_repo.get_visible_for_plan(plan, status="available")
            except Exception:
                rows = []
        if not isinstance(rows, list):
            rows = []

        return {
            "status": "ok",
            "servers": [
                {
                    "id": row.get("id"),
                    "name": str(row.get("name", "") or ""),
                    "country": str(row.get("country", "") or ""),
                    "city": str(row.get("city", "") or ""),
                    "status": str(row.get("status", "") or ""),
                }
                for row in rows if isinstance(row, dict)
            ],
        }

    @router.get("/api/user/{username}")
    async def user_profile(request: Request, username: str):
        current_user = _api_user(request)
        if isinstance(current_user, JSONResponse):
            return current_user

        if users_repo is None or not callable(getattr(users_repo, "get_by_username", None)):
            return _json_error("Stockage utilisateur indisponible.", status_code=500)

        user = users_repo.get_by_username(username)
        if not isinstance(user, dict):
            return _json_error("Utilisateur introuvable.", status_code=404)

        created_at = str(user.get("created_at", "") or "").strip()
        if " " in created_at:
            created_at = created_at.split(" ", 1)[0]

        return {
            "username": str(user.get("username", "") or ""),
            "type": _ui_user_type(user),
            "status": str(user.get("status", "active") or "active"),
            "avatar": _safe_avatar(user.get("avatar", ""), safe_avatar_url),
            "message_count": _message_count_for_user(tchat_repo, str(user.get("username", "") or ""), max_messages),
            "country": "Cameroun",
            "bio": _profile_bio(user),
            "created_at": created_at,
        }

    return router
