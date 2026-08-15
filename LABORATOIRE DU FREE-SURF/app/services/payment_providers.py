from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import httpx


class BasePaymentProvider(ABC):
    """Classe de base abstraite pour un fournisseur de paiement."""

    def __init__(self, **kwargs):
        pass

    @abstractmethod
    async def initiate_payment(self, **kwargs) -> dict[str, Any]:
        """Initie une transaction et retourne l'URL de paiement."""
        raise NotImplementedError

    @abstractmethod
    async def verify_webhook(self, headers: dict, body: bytes) -> bool:
        """Vérifie l'authenticité d'un webhook."""
        raise NotImplementedError


class PaysikaProvider(BasePaymentProvider):
    """Implémentation pour le fournisseur de paiement Paysika."""

    def __init__(self, api_key: str, api_secret: str, **kwargs):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api.paysika.co"  # TODO: Utiliser l'URL sandbox pour les tests

    async def initiate_payment(
        self, amount: int, currency: str, email: str, phone: str, order_id: str, description: str, **kwargs
    ) -> dict[str, Any]:
        """
        Appelle l'API de Paysika pour créer une transaction.
        REMARQUE : Ceci est une simulation. L'implémentation réelle dépend de la documentation de Paysika.
        """
        # La logique réelle d'appel à l'API Paysika irait ici.
        # async with httpx.AsyncClient() as client:
        #     response = await client.post(...)

        # Pour l'instant, nous retournons une réponse de succès simulée.
        return {
            "status": "success",
            "payment_url": f"https://checkout.paysika.com/pay/{order_id}",
            "transaction_id": f"PSK_{order_id}",
        }

    async def verify_webhook(self, headers: dict, body: bytes) -> bool:
        # La logique de vérification de la signature HMAC du webhook irait ici.
        return True


def create_payment_providers(cfg: Any) -> dict[str, BasePaymentProvider]:
    """Crée et retourne les instances des fournisseurs de paiement configurés."""
    providers = {}
    if getattr(cfg, "PAYSIKA_API_KEY", None) and getattr(cfg, "PAYSIKA_API_SECRET", None):
        providers["paysika"] = PaysikaProvider(api_key=cfg.PAYSIKA_API_KEY, api_secret=cfg.PAYSIKA_API_SECRET)
    return providers