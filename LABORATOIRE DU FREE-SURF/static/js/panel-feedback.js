(() => {
  function ensureHost() {
    let host = document.getElementById('toast-container');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-container';
      host.className = 'panel-toast-host';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'false');
      document.body.appendChild(host);
    } else if (!host.classList.contains('panel-toast-host')) {
      host.classList.add('panel-toast-host');
    }
    return host;
  }

  function iconFor(type) {
    switch (type) {
      case 'success': return 'fa-circle-check';
      case 'warning': return 'fa-triangle-exclamation';
      case 'error': return 'fa-circle-xmark';
      default: return 'fa-circle-info';
    }
  }

  function labelFor(type, title) {
    if (title && String(title).trim()) return String(title).trim();
    switch (type) {
      case 'success': return 'Succes';
      case 'warning': return 'Attention';
      case 'error': return 'Erreur';
      default: return 'Information';
    }
  }

  function showToast(message, options = {}) {
    const type = String(options.type || 'info').toLowerCase();
    const duration = Number.isFinite(options.duration) ? options.duration : 4200;
    const host = ensureHost();
    const toast = document.createElement('section');
    toast.className = `panel-toast panel-toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const safeMessage = String(message || '').trim() || 'Action terminee.';
    const title = labelFor(type, options.title);
    toast.innerHTML = `
      <div class="panel-toast__bar"></div>
      <div class="panel-toast__body">
        <div class="panel-toast__title"><i class="fas ${iconFor(type)}"></i><span>${title}</span></div>
        <div class="panel-toast__message"></div>
      </div>
    `;
    toast.querySelector('.panel-toast__message').textContent = safeMessage;
    host.appendChild(toast);

    const removeToast = () => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 220);
    };

    window.setTimeout(removeToast, Math.max(1800, duration));
    return toast;
  }

  window.panelFeedback = {
    showToast,
    info(message, title) { return showToast(message, { type: 'info', title }); },
    success(message, title) { return showToast(message, { type: 'success', title }); },
    warn(message, title) { return showToast(message, { type: 'warning', title }); },
    error(message, title) { return showToast(message, { type: 'error', title }); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureHost, { once: true });
  } else {
    ensureHost();
  }
})();
