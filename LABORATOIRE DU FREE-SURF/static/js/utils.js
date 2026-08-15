(function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, type, duration) {
    var kind = type || 'info';
    var ms = Number(duration || 3000);

    var root = document.getElementById('fs-toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'fs-toast-root';
      root.style.position = 'fixed';
      root.style.top = '20px';
      root.style.right = '20px';
      root.style.zIndex = '99999';
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.gap = '10px';
      document.body.appendChild(root);
    }

    var colors = {
      success: '#16a34a',
      error: '#dc2626',
      warn: '#d97706',
      info: '#2563eb'
    };

    var el = document.createElement('div');
    el.textContent = String(message || '');
    el.style.background = colors[kind] || colors.info;
    el.style.color = '#fff';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '10px';
    el.style.fontFamily = 'Arial, sans-serif';
    el.style.fontSize = '12px';
    el.style.boxShadow = '0 8px 20px rgba(0,0,0,.25)';
    el.style.maxWidth = '420px';
    root.appendChild(el);

    setTimeout(function () {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, Math.max(1200, ms));
  }

  if (typeof window !== 'undefined') {
    if (!window.escapeHtml) window.escapeHtml = escapeHtml;
    if (!window.toast) window.toast = toast;
  }

  /* ─── showConfirmModal — modale de confirmation globale ─── */
  function showConfirmModal(opts) {
    var title = opts.title || 'Confirmation';
    var message = opts.message || 'Êtes-vous sûr ?';
    var confirmText = opts.confirmText || 'Confirmer';
    var cancelText = opts.cancelText || 'Annuler';
    var onConfirm = opts.onConfirm || function () {};
    var onCancel = opts.onCancel || function () {};

    // Supprime toute modale existante
    var existing = document.getElementById('confirm-modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);';

    var box = document.createElement('div');
    box.style.cssText = 'background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:1rem;padding:2rem;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);';

    var h = document.createElement('h3');
    h.style.cssText = 'color:#e2e8f0;font-size:1rem;font-weight:700;margin:0 0 0.75rem;';
    h.textContent = title;

    var p = document.createElement('p');
    p.style.cssText = 'color:#94a3b8;font-size:0.8rem;margin:0 0 1.5rem;line-height:1.5;';
    p.textContent = message;

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:0.75rem;justify-content:center;';

    var btnCancel = document.createElement('button');
    btnCancel.textContent = cancelText;
    btnCancel.style.cssText = 'padding:0.5rem 1.25rem;border-radius:0.5rem;font-size:0.75rem;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#94a3b8;';
    btnCancel.onmouseover = function () { btnCancel.style.borderColor = '#ef4444'; btnCancel.style.color = '#ef4444'; };
    btnCancel.onmouseout = function () { btnCancel.style.borderColor = 'rgba(255,255,255,0.15)'; btnCancel.style.color = '#94a3b8'; };
    btnCancel.onclick = function () { overlay.remove(); onCancel(); };

    var btnOk = document.createElement('button');
    btnOk.textContent = confirmText;
    btnOk.style.cssText = 'padding:0.5rem 1.25rem;border-radius:0.5rem;font-size:0.75rem;font-weight:700;cursor:pointer;border:none;background:#22c55e;color:#000;';
    btnOk.onmouseover = function () { btnOk.style.background = '#16a34a'; };
    btnOk.onmouseout = function () { btnOk.style.background = '#22c55e'; };
    btnOk.onclick = function () { overlay.remove(); onConfirm(); };

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnOk);
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Fermeture via Escape
    function onKey(e) { if (e.key === 'Escape') { overlay.remove(); onCancel(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);
  }

  if (typeof window !== 'undefined') {
    if (!window.showConfirmModal) window.showConfirmModal = showConfirmModal;
  }
})();
