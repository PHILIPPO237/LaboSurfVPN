from __future__ import annotations

from typing import Any

from app.core.engines.base import EngineProvider, VPNConfig
from app.core.provisioning import ProvisioningResult


class HybridEngineProvider(EngineProvider):
    """Combine deux moteurs deja existants selon le principe couches
    Transport/Tunnel -> Protocole (voir mission architecture) :

    - `outer` = le tunnel exterieur (ex: SlowDNS, DNSTT, SSH) -- son role est
      de faire passer du trafic discretement la ou une connexion normale
      serait bloquee.
    - `inner` = le protocole qui circule REELLEMENT a l'interieur de ce
      tunnel une fois ouvert (ex: Xray/VLESS via 3x-ui).

    Ce n'est PAS une fusion des deux configs en une seule -- ce sont deux
    configurations distinctes, l'une imbriquee dans l'autre, exactement
    comme la couche architecture le decrit. Provisionner un utilisateur sur
    un moteur hybride revient a le provisionner sur LES DEUX moteurs
    separement (le compte doit exister des deux cotes)."""

    def __init__(
        self,
        *,
        outer: EngineProvider,
        inner: EngineProvider,
        engine_name: str | None = None,
        label: str | None = None,
    ) -> None:
        self.outer = outer
        self.inner = inner
        self.engine_name = engine_name or f"hybrid_{outer.engine_name}_{inner.engine_name}"
        self.label = label or f"{outer.label} + {inner.label} (hybride)"

    def is_configured(self) -> bool:
        # Un hybride n'est utilisable que si SES DEUX composants le sont --
        # pas de demi-tunnel.
        return bool(self.outer.is_configured() and self.inner.is_configured())

    def is_healthy(self) -> tuple[bool | None, str]:
        outer_ok, outer_msg = self.outer.is_healthy()
        inner_ok, inner_msg = self.inner.is_healthy()
        if outer_ok is False or inner_ok is False:
            return False, f"Hybride {self.label} : probleme sur au moins un composant -- {outer_msg} / {inner_msg}"
        if outer_ok is None or inner_ok is None:
            return None, f"Hybride {self.label} : verification runtime partielle -- {outer_msg} / {inner_msg}"
        return True, f"Hybride {self.label} : les deux composants sont sains."

    def ensure_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        outer_result = self.outer.ensure_user(user, reason=reason)
        inner_result = self.inner.ensure_user(user, reason=reason)
        outer_ok = bool(getattr(outer_result, "ok", False))
        inner_ok = bool(getattr(inner_result, "ok", False))
        outer_configured = bool(getattr(outer_result, "configured", False))
        inner_configured = bool(getattr(inner_result, "configured", False))
        return ProvisioningResult(
            engine=self.engine_name,
            action="upsert",
            configured=outer_configured and inner_configured,
            ok=outer_ok and inner_ok,
            message=f"outer({self.outer.engine_name})={getattr(outer_result, 'message', '')} | inner({self.inner.engine_name})={getattr(inner_result, 'message', '')}",
        )

    def disable_user(self, user: dict[str, Any], *, reason: str = "") -> ProvisioningResult:
        outer_result = self.outer.disable_user(user, reason=reason)
        inner_result = self.inner.disable_user(user, reason=reason)
        outer_ok = bool(getattr(outer_result, "ok", False))
        inner_ok = bool(getattr(inner_result, "ok", False))
        outer_configured = bool(getattr(outer_result, "configured", False))
        inner_configured = bool(getattr(inner_result, "configured", False))
        return ProvisioningResult(
            engine=self.engine_name,
            action="disable",
            configured=outer_configured and inner_configured,
            ok=outer_ok and inner_ok,
            message=f"outer({self.outer.engine_name})={getattr(outer_result, 'message', '')} | inner({self.inner.engine_name})={getattr(inner_result, 'message', '')}",
        )

    def build_config(self, user: dict[str, Any], server: dict[str, Any]) -> VPNConfig:
        outer_cfg = self.outer.build_config(user, server)
        inner_cfg = self.inner.build_config(user, server)

        return VPNConfig(
            engine=self.engine_name,
            protocol=f"{outer_cfg.protocol}+{inner_cfg.protocol}",
            transport=f"{outer_cfg.transport}->{inner_cfg.transport}",
            server_id=str(server.get("id", "") or ""),
            user_id=str(user.get("id", "") or ""),
            credentials={"outer": outer_cfg.credentials, "inner": inner_cfg.credentials},
            parameters={
                # Structure explicite en 2 etapes : l'app doit d'abord etablir
                # `outer`, PUIS faire circuler `inner` a travers ce tunnel une
                # fois ouvert -- ce n'est pas une simple fusion de champs.
                "outer": {"engine": outer_cfg.engine, "protocol": outer_cfg.protocol, "uri": outer_cfg.uri, "parameters": outer_cfg.parameters},
                "inner": {"engine": inner_cfg.engine, "protocol": inner_cfg.protocol, "uri": inner_cfg.uri, "parameters": inner_cfg.parameters},
            },
            # Pas de format "uri" unique standard pour un hybride -- voir
            # `parameters.outer`/`parameters.inner` ci-dessus. L'app doit
            # savoir chainer les deux (necessite le moteur natif embarque,
            # cf. discussion architecture -- pas encore fait cote Android).
            uri="",
        )
