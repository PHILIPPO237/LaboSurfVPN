# Guide: verification routing / outbound

## Objectif
Ce contrôle garantit que chaque `routing.rules[].outboundTag` pointe vers un tag existant dans `outbounds[].tag`.

Sans ce contrôle, une règle de routage peut cibler un outbound inexistant et casser le trafic au runtime.

## Ce qui est valide
- Un `outboundTag` présent dans un outbound défini.
- Les tags standards (`direct`, `blocked`), puisqu'ils sont ajoutés automatiquement.
- Un tag custom (ex: `custom-egress`) si vous l'ajoutez dans `extra_outbounds`.

## Ce qui est rejete
La route `POST /api/zero-rating/generate-config` renvoie `400` si un tag est inconnu.

Message type :
`routing outboundTag inconnu: ghost-egress`
 
## Solutions rapides
1. Corriger la faute de frappe dans `extra_routing_rules[].outboundTag`.
2. Ajouter l'outbound manquant dans `extra_outbounds` avec le meme `tag`.
3. Réutiliser un tag existant (`VLESS`, `VMESS-CUSTOM`, `direct`, `blocked`, etc.).

## Exemple valide
```json
{
  "extra_outbounds": [
    { "tag": "custom-egress", "protocol": "freedom" }
  ],
  "extra_routing_rules": [
    {
      "type": "field",
      "domain": ["example.com"],
      "outboundTag": "custom-egress"
    }
  ]
}
```

## Exemple invalide
```json
{
  "extra_routing_rules": [
    {
      "type": "field",
      "domain": ["example.com"],
      "outboundTag": "ghost-egress"
    }
  ]
}
```

## Tests automatiques
Le fichier `test_zero_rating_router.py` contient des tests dedies:
- coherence globale `routing -> outbounds`
- acceptation d'un outbound custom valide
- rejet d'un `outboundTag` inconnu.

Commande:
```bash
python -m unittest test_zero_rating_router.py
```