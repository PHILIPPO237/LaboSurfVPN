from __future__ import annotations

import re
import time
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

# --- Schémas de données (Pydantic) ---

class PaymentInitiatePayload(BaseModel):
    provider: str = Field(..., description="Le fournisseur de paiement (ex: 'paysika')")
    plan: str = Field(..., description="Le plan choisi (ex: 'VIP', 'REVENDEUR', 'PREMIUM')")
    phone: str = Field(..., description="Numéro de téléphone pour le paiement mobile")
    email: EmailStr = Field(..., description="Email de l'utilisateur pour le reçu")


# --- Mappage des plans et des prix ---

PLAN_PRICES = {
    "VIP": 2500,
    "REVENDEUR": 10000,
    "PREMIUM": 25000,
}


def create_payment_router(
    *,
    db: Any,
    cfg: Any,
    get_payment_provider: Callable,
    now_ts: Callable[[], str],
    get_current_user: Callable[[Request], dict | None] | None = None,
) -> APIRouter:
    """Crée et configure le routeur pour les paiements."""
    router = APIRouter()
    payments_repo = getattr(db, "payments", None)

    def _validate_phone(phone: str) -> str:
        cleaned_phone = re.sub(r"\s+", "", phone)
        if cleaned_phone.startswith("+237") and len(cleaned_phone) == 13 and cleaned_phone[4] == "6":
            return cleaned_phone
        if cleaned_phone.startswith("6") and len(cleaned_phone) == 9:
            return f"+237{cleaned_phone}"
        raise ValueError("Format de téléphone invalide. Attendu: +2376... ou 6...")

    @router.post(
        "/api/payment/initiate",
        summary="Initier une nouvelle transaction de paiement",
        response_description="Détails de la transaction créée et URL de paiement",
    )
    async def initiate_payment(
        request: Request,
        payload: PaymentInitiatePayload,
    ):
        current_user = get_current_user(request) if callable(get_current_user) else None
        if not current_user:
            raise HTTPException(status_code=401, detail="Authentification requise.")

        # 1. Validation de la requête
        if payload.plan.upper() not in PLAN_PRICES:
            raise HTTPException(status_code=400, detail=f"Le plan '{payload.plan}' est invalide.")

        try:
            provider = get_payment_provider(payload.provider)
            validated_phone = _validate_phone(payload.phone)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # 2. Création de la commande
        user_id = current_user.get("id")
        username = current_user.get("username")
        amount = PLAN_PRICES[payload.plan.upper()]
        order_id = f"order_{user_id}_{int(time.time())}"

        # 3. Appel au fournisseur de paiement externe
        try:
            provider_response = await provider.initiate_payment(
                amount=amount, currency="XAF", email=payload.email, phone=validated_phone, order_id=order_id, description=f"Abonnement {payload.plan} pour {username}"
            )
            if not provider_response or not provider_response.get("payment_url"):
                raise HTTPException(status_code=502, detail="La passerelle de paiement n'a pas pu initier la transaction.")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Erreur de communication avec la passerelle de paiement: {e}")

        # 4. Sauvegarde de la transaction en base de données avec le statut "pending"
        transaction = {
            "order_id": order_id, "user_id": user_id, "username": username, "email": str(payload.email),
            "provider": payload.provider, "plan": payload.plan.upper(), "amount": amount, "currency": "XAF",
            "phone": validated_phone, "status": "pending", "transaction_id": provider_response.get("transaction_id"),
            "payment_url": provider_response.get("payment_url"), "created_at": now_ts(), "completed_at": None,
        }

        if not payments_repo or not callable(getattr(payments_repo, "save", None)):
            raise HTTPException(status_code=500, detail="Le service de persistance des paiements n'est pas configuré.")
        try:
            payments_repo.save(transaction)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Impossible de sauvegarder la transaction: {e}")

        # 5. Retourner la réponse attendue par le frontend
        return {
            "status": "success",
            "order_id": order_id,
            "amount": amount,
            "currency": "XAF",
            "provider": payload.provider,
            "payment_url": provider_response.get("payment_url"),
        }

    return router