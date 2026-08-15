from __future__ import annotations
from typing import Any
from app.services.access_service import AccessService

class PanelService:
    """Service de résolution du panel principal de l'utilisateur."""
    
    def __init__(self, access_service: AccessService):
        self.access_service = access_service

    def resolve_main_panel(self, user: dict, current_timestamp: float) -> str:
        """
        Résout le panel principal selon les permissions effectives.
        Ordre de priorité : admin -> reseller -> premium -> free
        """
        if not user:
            return "free"

        # Utiliser la préférence explicite si elle est définie en BDD
        default_panel = user.get("default_panel_key")
        if default_panel:
            return str(default_panel).strip().lower()

        perms = self.access_service.get_user_permissions(user, current_timestamp)
        
        if "panel.admin.view" in perms:
            return "admin"
        if "panel.reseller.view" in perms:
            return "reseller"
        if "panel.premium.view" in perms:
            return "premium"
            
        return "free"
        
    def get_home_url(self, user: dict, current_timestamp: float) -> str:
        panel_key = self.resolve_main_panel(user, current_timestamp)
        mapping = {"admin": "/admin", "reseller": "/panel-revendeur", "premium": "/panel-vip", "free": "/panel-gratuit"}
        return mapping.get(panel_key, "/panel-gratuit")