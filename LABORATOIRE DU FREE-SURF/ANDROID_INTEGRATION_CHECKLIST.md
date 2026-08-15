# Android Template Integration Checklist

## Étapes d'intégration des fichiers Android

### 1. **Mettre à jour `base.html`**

Ajouter dans la balise `<head>` (après les autres CSS):
```html
<!-- Android Mobile Optimization -->
<link rel="stylesheet" href="{{ url_for('static', filename='css/android-mobile-optimized.css') }}">
<link rel="stylesheet" href="{{ url_for('static', filename='css/android-theme-system.css') }}">
<link rel="manifest" href="{{ url_for('static', filename='manifest.json') }}">
<meta name="theme-color" content="#000000">
<meta name="mobile-web-app-capable" content="yes">
```

Ajouter avant `</body>`:
```html
<!-- Android Theme Initialization -->
<script>
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.add(`theme-${theme}`);
    document.body.classList.add(`theme-${theme}`);
  }
  
  function setTheme(themeName) {
    localStorage.setItem('theme', themeName);
    document.documentElement.classList.remove('theme-dark', 'theme-light', 'theme-blue', 'theme-purple', 'theme-sunset', 'theme-high-contrast');
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-blue', 'theme-purple', 'theme-sunset', 'theme-high-contrast');
    document.documentElement.classList.add(`theme-${themeName}`);
    document.body.classList.add(`theme-${themeName}`);
  }
  
  function handleDeviceType() {
    const isAndroid = /android/i.test(navigator.userAgent);
    const isTablet = /ipad|android(?!.*mobile)|tablet/i.test(navigator.userAgent);
    if (isAndroid) document.body.classList.add('is-android');
    if (isTablet) document.body.classList.add('is-tablet');
  }
  
  // Initialize on page load
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    handleDeviceType();
  });
  
  // Handle theme preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
  
  // Handle orientation changes
  window.addEventListener('orientationchange', () => {
    document.body.style.minHeight = window.innerHeight + 'px';
  });
</script>
```

---

### 2. **Mettre à jour `dashboard.html`**

```html
{% extends 'base.html' %}
{% from 'ANDROID_COMPONENTS.jinja2' import android_header, android_card_grid, android_stats, android_fab %}

{% block content %}
{{ android_header() }}

<main class="container motion-page">
  <h1 class="subtitle-fx">{{ _('Dashboard') }}</h1>
  
  {# Stats row #}
  {{ android_stats([
    {'value': current_user.scan_count|default(0), 'label': _('Scans')},
    {'value': current_user.hits_count|default(0), 'label': _('Hits')},
    {'value': current_user.services_tested|default(0), 'label': _('Services')},
  ]) }}
  
  {# Quick actions #}
  {{ android_card_grid([
    {
      'title': _('Scanner Rapide'),
      'description': _('Testez rapidement une URL'),
      'icon': '⚡',
      'action': '/scanner'
    },
    {
      'title': _('Mes Scans'),
      'description': _('Historique complet'),
      'icon': '📜',
      'action': '/scan-history'
    },
    {
      'title': _('Configuration'),
      'description': _('Paramètres personnels'),
      'icon': '⚙️',
      'action': '/settings'
    },
  ], _('Actions Rapides')) }}
</main>

{{ android_fab('Nouveau Scan', '✚', 'goToScanner()') }}

<script>
  function goToScanner() {
    window.location.href = '/scanner';
  }
</script>
{% endblock %}
```

---

### 3. **Mettre à jour `scanner.html` (ou page de scanner)**

```html
{% extends 'base.html' %}
{% from 'ANDROID_COMPONENTS.jinja2' import android_form, android_progress, android_skeleton %}

{% block content %}
<div class="container motion-page">
  <h1>{{ _('Scanner Avancé') }}</h1>
  
  {# Formulaire #}
  {{ android_form([
    {
      'id': 'url',
      'name': 'url',
      'label': _('URL à tester'),
      'type': 'text',
      'placeholder': 'https://example.com',
      'required': true,
      'help': _('Entrez l\'URL complète')
    },
    {
      'id': 'method',
      'name': 'method',
      'label': _('Méthode de scan'),
      'type': 'select',
      'required': true,
      'options': [
        {'value': 'default', 'label': _('Par défaut')},
        {'value': 'aggressive', 'label': _('Agressif')},
        {'value': 'stealth', 'label': _('Discret')},
      ]
    },
  ], _('Paramètres de scan'), _('Démarrer le scan')) }}
  
  {# Progress #}
  <div id="progress-container" style="display: none;">
    {{ android_progress(0, 100, _('Progression')) }}
  </div>
  
  {# Results #}
  <div id="results" style="margin-top: 24px;"></div>
</div>

<script>
  async function startScan() {
    const url = document.getElementById('url').value;
    const method = document.getElementById('method').value;
    
    if (!url) return showAlert(_('Veuillez entrer une URL'), 'error');
    
    // Show progress
    document.getElementById('progress-container').style.display = 'block';
    
    // Simulate progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 20;
      if (progress > 90) progress = 90;
      updateProgress(progress);
    }, 500);
    
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url, method})
      });
      
      clearInterval(interval);
      updateProgress(100);
      
      if (!response.ok) throw new Error('Scan failed');
      
      const data = await response.json();
      displayResults(data);
      showAlert(_('Scan terminé!'), 'success', 2000);
    } catch (error) {
      clearInterval(interval);
      showAlert(_('Erreur: ') + error.message, 'error');
    } finally {
      setTimeout(() => {
        document.getElementById('progress-container').style.display = 'none';
      }, 1000);
    }
  }
  
  function updateProgress(value) {
    const bar = document.querySelector('[data-progress-bar]');
    if (bar) bar.style.width = value + '%';
  }
  
  function displayResults(data) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = `
      <div class="panel-card motion-enter">
        <h3>{{ _('Résultats') }}</h3>
        <p><strong>{{ _('Service') }}:</strong> ${data.service || 'N/A'}</p>
        <p><strong>{{ _('Status') }}:</strong> ${data.status || 'Unknown'}</p>
        <p><strong>{{ _('Hits') }}:</strong> ${data.hits_count || 0}</p>
      </div>
    `;
  }
  
  function showAlert(message, type, duration) {
    // Utiliser la macro android_alert ou créer directement
    const alert = document.createElement('div');
    alert.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      padding: 14px 16px;
      border-radius: 12px;
      background: ${type === 'error' ? 'rgba(239,68,68,0.9)' : type === 'success' ? 'rgba(34,197,94,0.9)' : 'rgba(59,130,246,0.9)'};
      color: white;
      font-weight: 600;
      z-index: 1000;
      animation: slide-up 300ms ease-out;
    `;
    alert.textContent = message;
    document.body.appendChild(alert);
    
    if (duration) {
      setTimeout(() => {
        alert.style.animation = 'slide-down 300ms ease-out';
        setTimeout(() => alert.remove(), 300);
      }, duration);
    }
  }
</script>
{% endblock %}
```

---

### 4. **Mettre à jour `admin-dashboard.html`**

```html
{% extends 'base.html' %}
{% from 'ANDROID_COMPONENTS.jinja2' import android_tabs, android_list_item, android_stats %}

{% block content %}
<div class="container motion-page">
  <h1>{{ _('Admin Panel') }}</h1>
  
  {{ android_stats([
    {'value': total_users|default(0), 'label': _('Users')},
    {'value': total_scans|default(0), 'label': _('Scans')},
    {'value': total_hits|default(0), 'label': _('Hits')},
  ]) }}
  
  {# Tabs #}
  {{ android_tabs([
    {'id': 'users', 'label': _('Users')},
    {'id': 'scans', 'label': _('Scans')},
    {'id': 'settings', 'label': _('Settings')},
  ], 'users') }}
  
  {# Tab content #}
  <div data-tab-content="users" class="motion-enter">
    {% for user in users %}
      {{ android_list_item(
        {'title': user.username, 'subtitle': user.email},
        [
          {'id': 'edit', 'icon': '✏️', 'label': 'Edit'},
          {'id': 'delete', 'icon': '🗑️', 'label': 'Delete'},
        ]
      ) }}
    {% endfor %}
  </div>
  
  <div data-tab-content="scans" style="display: none;" class="motion-enter">
    {# Scans list #}
  </div>
</div>
{% endblock %}
```

---

### 5. **Mettre à jour `/static/css/main.css` (ou équivalent)**

Ajouter au début du fichier:
```css
/* Import Android optimization */
@import url('android-mobile-optimized.css');
@import url('android-theme-system.css');

/* Ensure proper viewport */
html {
  width: 100%;
  height: 100%;
  overflow-x: hidden;
}

body {
  width: 100%;
  min-height: 100vh;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Safe area padding for notches */
.container {
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
}
```

---

## 6. **Classes CSS à utiliser dans les templates**

### Motion/Animation Classes
- `motion-page` - Page entrance animation
- `motion-enter` - Fade-in scale animation  
- `motion-stagger` - Staggered children animation
- `mobile-slide-in` - Slide in from bottom
- `mobile-fade-scale-in` - Fade+scale animation
- `bottom-sheet-slide-up` - Bottom sheet animation
- `shimmer-loading` - Loading skeleton

### Layout Classes
- `container` - Responsive container with padding
- `grid` - Auto-fit responsive grid
- `panel-card` - Card component
- `field` - Form input styling
- `btn`, `btn-primary`, `btn-secondary` - Button styles

### State Classes
- `is-active` - Active state
- `is-disabled` - Disabled state
- `is-loading` - Loading state
- `is-android` - Android device detected
- `is-tablet` - Tablet device detected

### Theme Classes
- `theme-dark` - Dark AMOLED theme
- `theme-light` - Light theme
- `theme-blue` - Blue professional theme
- `theme-purple` - Purple creative theme
- `theme-sunset` - Warm sunset theme
- `theme-high-contrast` - High contrast accessibility

---

## 7. **Testing Checklist**

- [ ] Test sur Google DevTools (Pixel 5 emulation)
- [ ] Test sur différentes tailles: 320px, 480px, 768px, 1024px
- [ ] Test orientation portrait et landscape
- [ ] Test tous les thèmes (6 thèmes)
- [ ] Test animations (prefers-reduced-motion)
- [ ] Test accessibilité (high-contrast theme)
- [ ] Test navigation tactile (touch targets 48x48px)
- [ ] Test formulaires (auto-correct, auto-fill)
- [ ] Test images responsives (srcset ou picture)
- [ ] Test performance (Lighthouse >= 90)

---

## 8. **Performance Optimization Tips**

### Critères Web Essentiels (Core Web Vitals)
```javascript
// Mesurer LCP (Largest Contentful Paint)
const observer = new PerformanceObserver((list) => {
  const entries = list.getEntries();
  console.log('LCP:', entries[entries.length - 1].renderTime || entries[entries.length - 1].loadTime);
});
observer.observe({entryTypes: ['largest-contentful-paint']});

// Mesurer CLS (Cumulative Layout Shift)
let cls = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) cls += entry.value;
  }
  console.log('CLS:', cls);
}).observe({type: 'layout-shift', buffered: true});

// Mesurer FID (First Input Delay)
new PerformanceObserver((list) => {
  console.log('FID:', list.getEntries()[0].processingDuration);
}).observe({type: 'first-input', buffered: true});
```

### Lazy Loading Images
```html
<img 
  src="/images/placeholder.png" 
  data-src="/images/actual.png"
  alt="Description"
  loading="lazy"
  decoding="async"
>
```

### Service Worker pour Offline
```javascript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/js/service-worker.js')
    .then(reg => console.log('SW registered'))
    .catch(err => console.error('SW registration failed'));
}
```

---

## 9. **Débogage Common Issues**

| Problème | Solution |
|----------|----------|
| Animations saccadées | Ajouter `will-change: transform` ou réduire `prefers-reduced-motion` |
| Safe area non respectée | Vérifier `viewport-fit=cover` dans meta tag |
| Thème non appliqué | Vérifier que `theme-*` class est sur `html` ET `body` |
| Touches non réactives | Vérifier `touch-action` et `-webkit-tap-highlight-color: transparent` |
| Images blurry | Ajouter `@media (min-resolution: 2dppx)` pour retina |
| Formulaire lent | Désactiver autocomplete ou ajouter `autocomplete="off"` |

---

## 10. **Ressources & Références**

- Material Design 3 Mobile: https://m3.material.io/
- Web Android Best Practices: https://developer.chrome.com/docs/android/
- Core Web Vitals Guide: https://web.dev/vitals/
- Safe Area Documentation: https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- PWA Documentation: https://web.dev/progressive-web-apps/
