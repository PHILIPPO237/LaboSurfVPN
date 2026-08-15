# 💳 Système de Paiement - LABO DU FREE-SURF

## 🎯 Vue d'ensemble

Le système de paiement supporte **3 opérateurs locaux** au Cameroun :

| Provider | Support | Statut | Priorité |
|----------|---------|--------|----------|
| **🎨 Paysika** | Orange Money, MTN MoMo, Cartes | ✅ Recommandé | Gateway centralisée |
| **🟠 Orange Money** | Orange Money directement | ⚙️ Optional | Direct API |
| **🔴 MTN MoMo** | MTN MoMo directement | ⚙️ Optional | Direct API |

---

## 🚀 Quick Start

### 1️⃣ Installation des dépendances

```bash
pip install httpx
```

(httpx est déjà dans requirements.txt)

### 2️⃣ Configuration `.env`

Copiez `.env.example` en `.env` :

```bash
cp .env.example .env
```

Remplissez les variables pour Paysika :

```env
PAYSIKA_API_KEY=your_api_key
PAYSIKA_API_SECRET=your_api_secret
PAYSIKA_MERCHANT_ID=your_merchant_id
```

### 3️⃣ Créer vos crédentiels Paysika

1. Allez sur https://paysika.com
2. Créez un compte marchand
3. Récupérez vos crédentiels API
4. Testez en mode **Sandbox** d'abord

### 4️⃣ Route de paiement

Accédez à : `http://localhost:8000/payment`

---

## 📋 Routes disponibles

### GET /payment
Affiche la page de sélection de plan et opérateur.

**Authentification** : Utilisateur connecté

### POST /api/payment/initiate
Initie un paiement.

**Body JSON** :
```json
{
  "provider": "paysika",
  "plan": "VIP",
  "phone": "+237 6XX XXX XXX",
  "email": "user@example.com"
}
```

**Response** :
```json
{
  "status": "success",
  "order_id": "order_42_1708691234",
  "amount": 2500,
  "currency": "XAF",
  "provider": "paysika",
  "payment_url": "https://checkout.paysika.com/xxx"
}
```

### POST /api/webhook/paysika
Webhook pour les confirmations Paysika.

**Signature HTTP** : `X-Signature` header

### GET /payment-status/{order_id}
Affiche le statut d'une commande.

---

## 💰 Plans tarifaires

```
🟢 VIP = 2,500 XAF/mois
  - 5 IPs parallèles
  - 50GB/jour
  - Configs illimitées

🔴 REVENDEUR = 10,000 XAF/mois
  - Gérer 50 clients
  - Configs illimitées
  - 20 IPs parallèles
  - Support prioritaire

⚫ PREMIUM = 25,000 XAF/mois
  - Tout illimité
  - Support 24/7
```

---

## 🔌 Architecture des fichiers

### Nouveau
```
payment_providers.py          # Classes des 3 providers
templates/payment.html        # Page de paiement
.env.example                  # Variables d'environnement
PAIEMENT.md                   # Ce fichier
```

### Modifié
```
main.py                       # Ajout imports + routes + config
labo_payments.json           # BD des paiements (auto-créé)
```

---

## 🔐 Sécurité

✅ **Fait**
- Signatures HMAC pour webhooks
-Token Paysika sécurisé
- Pas de données sensibles en logs
- Validation des téléphones

⚠️ **À faire**
- Rate limiting sur `/api/payment/initiate`
- Encryption des email en BD
- Audit trail pour paiements
- Email de confirmation automatique

---

## 📱 Flux utilisateur

```
1. User clique "Passer à VIP"
    ↓
2. Page /payment
    - Sélectionne plan (VIP/REVENDEUR/PREMIUM)
    - Sélectionne opérateur (Paysika/Orange/MTN)
    - Entre téléphone & email
    ↓
3. Post /api/payment/initiate
    - Validation
    - Appel provider
    - Sauvegarde en BD
    ↓
4. Paysika checkout
    - User paie via Orange/MTN/Carte
    ↓
5. Webhook /api/webhook/paysika
    - Vérify signature
    - Active subscription
    ↓
6. /payment-status/{order_id}
    - Affiche ✅ Succès
    - User redirigé dashboard
```

---

## 🧪 Test en local (Sandbox)

### Avec Paysika Sandbox

```env
PAYSIKA_API_KEY=your_sandbox_key
PAYSIKA_API_SECRET=your_sandbox_secret
```

Testez avec :
- Téléphone : +237 670000000 (Orange)
- Téléphone : +237 850000000 (MTN)

### Sans API réelle (Mock)

Pour tester sans crédentiels :
1. Les fournisseurs retourneront `"status": "error"`
2. Mais la route `/payment` affichera quand même

---

## 📊 Structure BD `labo_payments.json`

```json
{
  "transactions": [
    {
      "order_id": "order_42_1708691234",
      "user_id": 42,
      "username": "john_vip",
      "email": "john@example.com",
      "provider": "paysika",
      "plan": "VIP",
      "amount": 2500,
      "phone": "+237 670123456",
      "status": "completed",
      "transaction_id": "PSK_xxx",
      "payment_url": "https://checkout.paysika.com/xxx",
      "created_at": "2025-02-24 14:30:00",
      "completed_at": "2025-02-24 14:35:00"
    }
  ]
}
```

---

## 🔗 Intégration dans le dashboard

Ajoutez un bouton dans `/templates/dashboard.html` :

```html
<a href="/payment" class="btn btn-green">
  💳 Mettre à jour mon abonnement
</a>
```

---

## 🐛 Dépannage

### Erreur: "provider_not_found"
→ Vérifiez que `PAYSIKA_API_KEY` etc. sont dans `.env`

### Erreur: "Invalid signature"
→ Vérifiez `PAYSIKA_API_SECRET` correctement copié

### Paiement en attente indéfiniment
→ Vérifiez que le webhook Paysika peut atteindre votre serveur
→ Configurez le callback_url en production

### "Phone validation failed"
→ Format accepté : `+237 6XX XXX XXX` ou `6XX XXX XXX`

---

## 📞 Support

Pour les problèmes :

1. **Paysika** → https://paysika.com/support
2. **Orange Money** → Contact Commercial Orange Cameroun
3. **MTN MoMo** → https://mtn-developer.gitbook.io/

---

## ✅ Checklist production

- [ ] Crédentiels Paysika obtenus et testés
- [ ] Webhook URL configurée chez Paysika
- [ ] `.env` rempli (ne pas committer!)
- [ ] HTTPS activé (`FS_COOKIE_SECURE=1`)
- [ ] Rate limiting ajouté
- [ ] Logs et monitoring en place
- [ ] Support email configuré
- [ ] Termes & conditions affichés à l'utilisateur

---

Créé : 24 février 2026
Auteur : FREE-SURF Team | Cameroun 🇨🇲
