from __future__ import annotations

from typing import Any


async def sync_servers_from_panel(*, fetch_panel_inbounds: Any, servers_repo: Any) -> int:
    """Synchronise la table `servers` (cache d'affichage cote web) a partir
    des inbounds exposes par le panel actif (3x-ui). Idempotent : chaque
    appel met a jour name/status sans dupliquer les lignes, en s'appuyant
    sur `infrastructure_ref` (panel_id) comme cle stable.

    Ne supprime jamais un serveur existant meme s'il disparait du panel -
    il est preferable de le voir passer 'unavailable' plutot que de perdre
    l'historique des configurations qui pointent dessus.

    Retourne le nombre de serveurs synchronises (0 si le panel est
    injoignable ou mal configure - ne leve jamais d'exception).
    """
    if not callable(fetch_panel_inbounds) or servers_repo is None:
        return 0

    try:
        inbounds = await fetch_panel_inbounds(force_refresh=True)
    except Exception:
        return 0

    if not isinstance(inbounds, list):
        return 0

    upsert = getattr(servers_repo, "upsert_by_infrastructure_ref", None)
    if not callable(upsert):
        return 0

    synced = 0
    seen_refs: set[str] = set()
    for item in inbounds:
        if not isinstance(item, dict):
            continue
        panel_id = item.get("id")
        if panel_id is None:
            continue
        infra_ref = str(panel_id)
        if infra_ref in seen_refs:
            continue
        seen_refs.add(infra_ref)

        name = str(item.get("remark") or item.get("name") or f"Serveur {infra_ref}").strip()
        try:
            upsert({
                "name": name,
                "status": "available",
                "infrastructure_ref": infra_ref,
            })
            synced += 1
        except Exception:
            continue

    return synced
