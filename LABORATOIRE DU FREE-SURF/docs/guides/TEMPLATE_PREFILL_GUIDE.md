# Guide: Pré-remplissage des Formulaires

## 🎯 Objectif
Conserver les données saisies par l'utilisateur même quand une validation échoue, pour éviter qu'il doive tout recommencer.
Conserver les données saisies par l'utilisateur même lorsqu'une validation échoue, pour éviter qu'il doive tout recommencer.

## 📋 Formulaires Supportés
 
### 1. **Page `/inscription`**

Les variables de pré-remplissage disponibles dans `inscription.html`:
- `{{ prefill_username }}` - Nom d'utilisateur saisi
- `{{ prefill_contact }}` - Contact (email/téléphone) saisi
- `{{ prefill_recovery_secret }}` - Phrase secrète saisie

**Exemple d'usage dans le HTML:**
```html
<input type="text" name="username" value="{{ prefill_username }}" placeholder="Nom d'utilisateur">
<input type="text" name="contact" value="{{ prefill_contact }}" placeholder="Contact">
<textarea name="recovery_secret" placeholder="Phrase secrète">{{ prefill_recovery_secret }}</textarea>
```

### 2. **Page `/acces/licence-oubliee`**

Les variables de pré-remplissage disponibles dans `forgot-license.html`:
- `{{ prefill_username }}` - Nom d'utilisateur saisi
- `{{ prefill_contact }}` - Contact saisi
- `{{ prefill_message }}` - Message saisi

**Exemple d'usage dans le HTML:**
```html
<input type="text" name="username" value="{{ prefill_username }}" placeholder="Votre nom d'utilisateur">
<input type="text" name="contact" value="{{ prefill_contact }}" placeholder="Votre contact">
<textarea name="message" placeholder="Décrivez votre situation...">{{ prefill_message }}</textarea>
```

## 🔄 Flux de Traitement

### Scénario 1: Validation réussie
1. User remplit le formulaire
2. Clique sur Envoyer
3. ✅ Validation OK → Redirection vers la page de succès

### Scénario 2: Validation échouée
1. User remplit le formulaire
2. Clique sur Envoyer
3. ❌ Erreur détectée
4. Redirection avec les données: `/inscription?err=bad_username&username=John&contact=john@...`
5. **Les champs sont pré-remplis** avec les données précédentes
6. L'utilisateur corrige le problème et renvoie le formulaire.

## 🛠️ Fonction Disponible

Une fonction d'assistance (helper) est disponible côté serveur :
```python
_get_form_value(request: Request, field_name: str, default: str = "") -> str
```

Elle récupère une valeur depuis les paramètres GET et l'échappe automatiquement pour sécurité HTML.

## 📝 Notes Importantes

1. **Sécurité**: Les valeurs sont automatiquement échappées HTML
2. **Syntaxe**: Les deux syntaxes sont supportées:
   - `{{ field_name }}`
   - `{{field_name}}` (sans espaces)
3. **Variables sensibles**: Les mots de passe/secrets ne sont jamais pré-remplis pour des raisons de sécurité

## ✅ Checklist

- [x] Fonction `_get_form_value()` implémentée
- [x] POST `/inscription` passe les données en erreur
- [x] GET `/inscription` pré-remplit depuis les paramètres
- [x] POST `/acces/licence-oubliee` passe les données en erreur
- [x] GET `/acces/licence-oubliee` pré-remplit depuis les paramètres

## 🔗 Paramètres de Requête Transmis

### Lors d'une erreur d'inscription:
```
/inscription?err=bad_username&next=/panel-gratuit&username=JohnDoe&contact=john@email.com&recovery_secret=...
```

### Lors d'une erreur de récupération de licence:
```
/acces/licence-oubliee?err=bad_secret&username=JohnDoe&contact=john@email.com&message=...
```

L'interface PHP/HTML doit utiliser ces variables pour remplir les champs du formulaire.
