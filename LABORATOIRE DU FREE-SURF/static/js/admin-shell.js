(function () {
    const ACCENT_STORAGE_KEY = "panel_accent_map_v1";
    const DEFAULT_ADMIN_ACCENT = "#ff0044";
    const MOBILE_MEDIA = "(max-width: 960px)";

    const PRIMARY_LINKS = [
        { route: "/admin", icon: "fa-house", label: "Dashboard" },
        { route: "/admin/users", icon: "fa-users", label: "Users" },
        { route: "/admin/payments", icon: "fa-receipt", label: "Paiements" },
        { route: "/admin/dns-cloudflare", icon: "fa-network-wired", label: "DNS" },
        { route: "/admin/config-generator", icon: "fa-gears", label: "Config" },
        { route: "/admin/servers", icon: "fa-server", label: "Serveurs" },
        { route: "/admin/ads", icon: "fa-bullhorn", label: "Ads" }
    ];

    function normalizeHex(value) {
        if (!value) return null;
        let hex = String(value).trim().toLowerCase();
        if (!hex.startsWith("#")) hex = "#" + hex;
        if (!/^#[0-9a-f]{3,8}$/.test(hex)) return null;
        if (hex.length === 4) {
            hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        if (hex.length >= 7) return hex.slice(0, 7);
        return null;
    }

    function hexToRgb(hex) {
        const normalized = normalizeHex(hex);
        if (!normalized) return null;
        const raw = normalized.slice(1);
        const r = parseInt(raw.slice(0, 2), 16);
        const g = parseInt(raw.slice(2, 4), 16);
        const b = parseInt(raw.slice(4, 6), 16);
        return r + ", " + g + ", " + b;
    }

    function readAdminAccent() {
        try {
            const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            const custom = normalizeHex(parsed && parsed.admin);
            return custom || DEFAULT_ADMIN_ACCENT;
        } catch (_err) {
            return DEFAULT_ADMIN_ACCENT;
        }
    }

    function applyAdminAccentVars() {
        const color = readAdminAccent();
        const rgb = hexToRgb(color) || "255, 0, 68";
        const root = document.documentElement;
        root.style.setProperty("--panel-accent", color);
        root.style.setProperty("--panel-accent-rgb", rgb);
    }

    function stripQuery(path) {
        return String(path || "").split("?")[0].split("#")[0];
    }

    function normalizePath(path) {
        const base = stripQuery(path).replace(/\/+$/, "");
        return base || "/";
    }

    function isActiveLink(currentPath, route) {
        const current = normalizePath(currentPath);
        const target = normalizePath(route);
        if (target === "/admin") return current === "/admin" || current === "/admin/dashboard";
        return current === target || current.startsWith(target + "/");
    }

    function buildLink(route, icon, label, currentPath, className) {
        const active = isActiveLink(currentPath, route) ? " is-active" : "";
        return (
            '<a class="' + className + active + '" href="' + route + '">' +
            '<i class="fas ' + icon + '"></i><span>' + label + '</span></a>'
        );
    }

    function currentEntry(label, icon) {
        return {
            route: window.location.pathname + (window.location.search || ""),
            icon: icon,
            label: label,
        };
    }

    function resolveSection(path) {
        const p = normalizePath(path);
        if (p === "/admin" || p === "/admin/dashboard") return "Dashboard";
        if (p.startsWith("/admin/users")) return "Utilisateurs";
        if (p.startsWith("/admin/payments") || p.startsWith("/admin/settings/payment")) return "Paiements";
        if (p.startsWith("/admin/config-generator")) return "Config Generator";
        if (p.startsWith("/admin/servers")) return "Serveurs";
        if (p.startsWith("/admin/dns")) return "DNS";
        if (p.startsWith("/admin/ip-bans")) return "Securite";
        if (p.startsWith("/admin/activation-keys")) return "Activation";
        if (p.startsWith("/admin/ads")) return "Marketing";
        if (p.startsWith("/admin/notifications")) return "Notifications";
        if (p.startsWith("/admin/messagerie")) return "Messagerie";
        return "Administration";
    }

    function resolveSubnav(path) {
        const p = normalizePath(path);
        if (p === "/admin" || p === "/admin/dashboard") {
            return [
                { route: "/admin/users", icon: "fa-users", label: "Comptes" },
                { route: "/admin/payments", icon: "fa-wallet", label: "Paiements" },
                { route: "/admin/dns-cloudflare", icon: "fa-network-wired", label: "DNS" },
                { route: "/admin/ads", icon: "fa-bullhorn", label: "Communication" },
            ];
        }
        if (p.startsWith("/admin/users")) {
            const items = [
                { route: "/admin/users", icon: "fa-users", label: "Abonnes" },
                { route: "/admin/activation-keys", icon: "fa-key", label: "Cles" },
                { route: "/admin/notifications", icon: "fa-bell", label: "Notifications" },
            ];
            if (p.startsWith("/admin/users/edit")) items.unshift(currentEntry("Edition", "fa-user-pen"));
            if (p.startsWith("/admin/users/history")) items.unshift(currentEntry("Historique", "fa-clock-rotate-left"));
            return items;
        }
        if (p.startsWith("/admin/payments") || p.startsWith("/admin/settings/payment")) {
            return [
                { route: "/admin/payments", icon: "fa-receipt", label: "Transactions" },
                { route: "/admin/settings/payment", icon: "fa-wallet", label: "Coordonnees" },
            ];
        }
        if (p.startsWith("/admin/dns")) {
            return [
                { route: "/admin/dns-cloudflare", icon: "fa-network-wired", label: "DNS" },
                { route: "/admin/ip-bans", icon: "fa-ban", label: "IP Bans" },
            ];
        }
        if (p.startsWith("/admin/config-generator")) {
            return [
                { route: "/admin/config-generator", icon: "fa-gears", label: "Generator" },
                { route: "/admin/servers", icon: "fa-server", label: "Serveurs" },
                { route: "/admin/dns-cloudflare", icon: "fa-network-wired", label: "DNS" },
            ];
        }
        if (p.startsWith("/admin/servers")) {
            return [
                { route: "/admin/servers", icon: "fa-server", label: "Serveurs" },
                { route: "/admin/config-generator", icon: "fa-gears", label: "Generator" },
            ];
        }
        if (p.startsWith("/admin/ip-bans") || p.startsWith("/admin/activation-keys")) {
            return [
                { route: "/admin/ip-bans", icon: "fa-ban", label: "IP Bans" },
                { route: "/admin/activation-keys", icon: "fa-key", label: "Activation" },
                { route: "/admin/users", icon: "fa-users", label: "Users" },
            ];
        }
        if (p.startsWith("/admin/ads") || p.startsWith("/admin/notifications") || p.startsWith("/admin/messagerie")) {
            return [
                { route: "/admin/ads", icon: "fa-bullhorn", label: "Ads" },
                { route: "/admin/notifications", icon: "fa-bell", label: "Notifications" },
                { route: "/admin/messagerie", icon: "fa-headset", label: "Support" },
            ];
        }
        return [];
    }

    function installShell() {
        const body = document.body;
        if (!body) return;

        const currentPath = normalizePath(window.location.pathname || "/");
        if (!currentPath.startsWith("/admin")) return;
        applyAdminAccentVars();
        if (body.getAttribute("data-admin-shell") === "off") return;
        if (document.querySelector(".admin-shell-topbar")) return;

        const section = resolveSection(currentPath);
        const primaryNav = PRIMARY_LINKS
            .map((item) => buildLink(item.route, item.icon, item.label, currentPath, "admin-shell-link"))
            .join("");
        const subnavItems = resolveSubnav(currentPath);
        const secondaryNav = subnavItems.length
            ? '<div class="admin-shell-subnav" aria-label="Sous-navigation admin">' +
                subnavItems.map((item) => buildLink(item.route, item.icon, item.label, currentPath, "admin-shell-subnav-link")).join("") +
              '</div>'
            : "";

        const html = '' +
            '<div class="admin-shell-topbar">' +
            '  <div class="admin-shell-inner">' +
            '    <div class="admin-shell-meta">' +
            '      <div class="admin-shell-left">' +
            '        <span class="admin-shell-badge">ADMIN</span>' +
            '        <span class="admin-shell-title">Control Shell</span>' +
            '        <span class="admin-shell-crumb">Section: ' + section + '</span>' +
            '      </div>' +
            '      <button class="admin-shell-menu-btn" type="button" aria-expanded="false" aria-controls="adminShellDrawer">' +
            '        <i class="fas fa-bars"></i><span>Menu</span>' +
            '      </button>' +
            '    </div>' +
            '    <div class="admin-shell-drawer" id="adminShellDrawer">' +
            '      <div class="admin-shell-center">' +
            '        <nav class="admin-shell-nav" aria-label="Navigation admin principale">' + primaryNav + '</nav>' +
                     secondaryNav +
            '      </div>' +
            '      <div class="admin-shell-actions">' +
            '        <a class="admin-shell-btn" href="/admin"><i class="fas fa-gauge-high"></i><span>Panel</span></a>' +
            '        <a class="admin-shell-btn" href="/dashboard"><i class="fas fa-th-large"></i><span>Hub</span></a>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        body.insertAdjacentHTML("afterbegin", html);
        body.classList.add("admin-shell-offset");

        const topbar = document.querySelector(".admin-shell-topbar");
        const drawer = document.getElementById("adminShellDrawer");
        const menuBtn = topbar ? topbar.querySelector(".admin-shell-menu-btn") : null;
        const media = window.matchMedia(MOBILE_MEDIA);

        if (!topbar || !drawer || !menuBtn) return;

        function syncOffset() {
            const measured = topbar.offsetHeight + 12;
            body.style.paddingTop = measured + "px";
            body.style.setProperty("--admin-shell-height", topbar.offsetHeight + "px");
        }

        function setOpen(nextValue) {
            const shouldOpen = media.matches ? !!nextValue : false;
            body.classList.toggle("admin-shell-open", shouldOpen);
            menuBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
            menuBtn.setAttribute("aria-label", shouldOpen ? "Fermer le menu admin" : "Ouvrir le menu admin");
            syncOffset();
        }

        menuBtn.addEventListener("click", function () {
            setOpen(!body.classList.contains("admin-shell-open"));
        });

        drawer.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", function () {
                if (media.matches) setOpen(false);
            });
        });

        document.addEventListener("click", function (event) {
            if (!media.matches || !body.classList.contains("admin-shell-open")) return;
            if (!topbar.contains(event.target)) setOpen(false);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") setOpen(false);
        });

        const handleViewport = function () {
            if (!media.matches) setOpen(false);
            syncOffset();
        };

        syncOffset();
        window.addEventListener("resize", handleViewport);
        if (media.addEventListener) {
            media.addEventListener("change", handleViewport);
        } else if (media.addListener) {
            media.addListener(handleViewport);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", installShell);
    } else {
        installShell();
    }

    window.addEventListener("panel-accent:change", applyAdminAccentVars);
    window.addEventListener("storage", function (event) {
        if (event && event.key === ACCENT_STORAGE_KEY) {
            applyAdminAccentVars();
        }
    });
})();
