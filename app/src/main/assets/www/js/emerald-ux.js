/* Sombre Emeraude & Glamourisme — Mobile Realtime & UX Layer (Labo Surf VPN) */
(function () {
  function syncSecondaryLayout() {
    var active = document.querySelector(".screen.is-active, .screen:not([hidden])");
    var isHome = !active || active.id === "screen-home";
    document.body.classList.toggle("ls-secondary", !isHome);
  }

  function showMobButterfly(alertData) {
    if (!alertData || document.getElementById("lsMobButterfly")) return;
    var lang = (typeof I18N !== "undefined" && I18N.lang) ? I18N.lang : "fr";
    var el = document.createElement("div");
    el.id = "lsMobButterfly";
    el.className = "ls-mob-butterfly";
    var msg = lang === "en"
      ? (alertData.level === "expired" ? "Your VIP Pass has expired. Renew now!" : "Your VIP Pass expires in " + alertData.hours_left + "h.")
      : (alertData.level === "expired" ? "Votre Pass VIP a expiré. Renouvelez maintenant !" : "Votre Pass VIP expire dans " + alertData.hours_left + "h.");
    var btnRenew = lang === "en" ? "Renew now" : "Renouveler";
    var btnAck = lang === "en" ? "Got it" : "J'ai compris";
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<strong style="color:#F59E0B;">🦋 Labo Surf VPN</strong>' +
      '<button type="button" id="lsMobBfClose" style="background:none;border:none;color:#F1F5F9;font-size:18px;">×</button></div>' +
      '<p style="margin:6px 0 10px;font-size:13px;">' + msg + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button type="button" id="lsMobBfRenew" style="background:#10B981;color:#060913;border:none;border-radius:10px;padding:6px 12px;font-weight:700;font-size:12px;">' + btnRenew + '</button>' +
      '<button type="button" id="lsMobBfAck" style="background:rgba(255,255,255,0.12);color:#F1F5F9;border:none;border-radius:10px;padding:6px 12px;font-size:12px;">' + btnAck + '</button></div>';
    document.body.appendChild(el);
    var close = function () { el.remove(); };
    document.getElementById("lsMobBfClose").onclick = close;
    document.getElementById("lsMobBfAck").onclick = close;
    document.getElementById("lsMobBfRenew").onclick = function () {
      close();
      if (typeof nav === "function") nav("account");
    };
  }

  function connectMobWS() {
    if (typeof FREE_SURF_API_BASE === "undefined" || !FREE_SURF_API_BASE) return;
    if (typeof WebSocket !== "function") return;
    try {
      var wsBase = FREE_SURF_API_BASE.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
      var tok = (typeof authToken !== "undefined" && authToken) ? authToken : "";
      var sock = new WebSocket(wsBase + "/ws/realtime?token=" + encodeURIComponent(tok));
      sock.onmessage = function (ev) {
        try {
          var d = JSON.parse(ev.data);
          if (d.type === "expiry_butterfly") showMobButterfly(d);
          if (d.type === "vip_token_delivered" && typeof toast === "function") {
            toast("Token VIP reçu : " + (d.token || ""), "success", 6000);
          }
          document.dispatchEvent(new CustomEvent("ls:ws", { detail: d }));
        } catch (e) {}
      };
      sock.onclose = function () { setTimeout(connectMobWS, 5000); };
    } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", function () {
    syncSecondaryLayout();
    var observer = new MutationObserver(syncSecondaryLayout);
    var app = document.getElementById("app");
    if (app) observer.observe(app, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });
    connectMobWS();
  });
})();
