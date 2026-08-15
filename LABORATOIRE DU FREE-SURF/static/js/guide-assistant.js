/* --- Guide Assistant JS --- */

const GuideAssistant = {
    compactTouchUi: false,

    // Content Dictionary
    content: {
        'home': {
            title: 'Bienvenue',
            icon: 'fa-house',
            intro: 'Vous êtes sur la page d\'accueil du Laboratoire du Free-Surf.',
            sections: {
                'intro': {
                    title: 'Que faire ici ?',
                    text: 'Cette page présente la plateforme. Deux choix s\'offrent à vous selon votre situation.',
                    steps: [
                        '🔑 <strong>Déjà inscrit ?</strong> Cliquez sur "Se connecter à mon espace".',
                        '📝 <strong>Nouveau ici ?</strong> Cliquez sur "Créer un compte" pour vous inscrire gratuitement.',
                        '📖 Vous pouvez aussi lire le "Manifeste" pour comprendre en détail comment fonctionne la plateforme.'
                    ],
                    tip: 'L\'inscription est gratuite et immédiate, aucune carte bancaire n\'est demandée.'
                }
            }
        },
        'dashboard': {
            title: 'Tableau de bord',
            icon: 'fa-th-large',
            intro: 'Bienvenue sur votre tableau de bord principal. C\'est ici que tout commence !',
            sections: {
                'intro': {
                    title: 'Avant-Propos & Présentation du Projet',
                    text: 'Bien plus qu\'une simple introduction, voici la charte fondamentale et la vision de la plateforme, dédiée à la gestion des abonnements et à la distribution d\'accès à vos clients.',
                    steps: [
                        '🔭 <strong>Vision :</strong> Simplifier la gestion des clients Gratuit, VIP et Revendeur.',
                        '📜 <strong>Philosophie :</strong> Une plateforme claire pour suivre les abonnements et automatiser la distribution.',
                        '⚠️ <strong>Règles d\'Or :</strong> Les comportements prohibés (abus, partage non autorisé) menant au bannissement immédiat.',
                        '🧠 <strong>Concepts Clés :</strong> Comprendre les statuts d\'abonnement, les renouvellements et les niveaux d\'accès.'
                    ],
                    tip: 'Prenez le temps de lire cette section pour bien démarrer sur la plateforme.',
                    warning: 'L\'ignorance des règles n\'excuse pas leur transgression.'
                },
                'free': { 
                    title: 'Panel Gratuit', 
                    text: 'Des fonctionnalités accessibles à tous, sans payer. Idéal pour commencer et tester les bases.',
                    steps: ['📊 Consultez votre historique.', '🙋‍♂️ Demandez de l\'aide si besoin.']
                },
                'vip': {
                    title: 'Panel VIP',
                    text: 'La puissance supérieure. Réservé aux membres qui ont souscrit un abonnement VIP.',
                    steps: ['⚡ Accès prioritaire et options avancées.', '🛠️ Outils de gestion de compte dédiés.'],
                    tip: 'Vous pouvez demander un accès VIP depuis la page "Abonnement".'
                },
                'reseller': {
                    title: 'Panel Revendeur',
                    text: 'Pour ceux qui veulent gérer leur propre business. Vendez des accès à vos clients.',
                    steps: ['👥 Créez des comptes utilisateurs.', '⏳ Gérez les dates d\'expiration.', '📈 Suivez vos ventes.']
                },
                'inscription': {
                    title: 'Inscriptions',
                    text: 'Gestion des inscriptions, mise à niveau et renouvellements de compte.',
                    steps: ['📝 Créez ou modifiez un compte.', '🚀 Demandez le passage au niveau supérieur.']
                },
                'admin': {
                    title: 'Panel Admin',
                    text: 'Zone restreinte à l\'administrateur général.',
                    warning: 'Si vous n\'êtes pas l\'admin, vous ne pourrez pas entrer ici.'
                },
                'chat': {
                    title: 'Tchat Live',
                    text: 'Discutez en direct avec la communauté. Posez vos questions, partagez vos trouvailles.',
                    steps: ['💬 Cliquez pour rejoindre le chat.', '🤝 Soyez poli et courtois.', '💡 L\'entraide est la clé !']
                }
            }
        },
        'admin-dashboard': {
            title: 'Tableau de bord Admin',
            icon: 'fa-user-shield',
            intro: 'Le centre de commandement principal pour vérifier la santé de la plateforme.',
            sections: {
                'users': {
                    title: 'Abonnés',
                    text: 'Gérez tous les utilisateurs inscrits.',
                    steps: ['👥 Consultez les requêtes de passage VIP/Revendeur.', '⚖️ Gérez les bannissements, renouvellements et approbations.']
                },
                'messagerie': {
                    title: 'Messagerie',
                    text: 'Support direct pour les requêtes de tickets.',
                    steps: ['📬 Lisez les plaintes et répondez aux utilisateurs.']
                },
                'admin-config-generator': {
                    title: 'Config Generator',
                    text: 'L\'outil pour créer des configurations.',
                    steps: ['⚙️ Exportez un format de texte utilisable sur V2ray, HTTP Injector, etc.']
                },
                'admin-dns-cloudflare': {
                    title: 'DNS / Cloudflare',
                    text: 'Outils réseau de diagnostic.',
                    steps: ['🌍 Trouvez des IP et confirmez des points de terminaison.']
                },
                'payments': {
                    title: 'Paiements Manuels',
                    text: 'Validez les transferts d\'argent des clients.',
                    steps: ['📱 Vérifiez la réception sur votre téléphone.', '✅ Cliquez sur Approuver pour activer le compte.']
                },
                'ads': {
                    title: 'Gestion Pubs',
                    text: 'Gérez et lancez de nouvelles campagnes marketing.',
                    steps: ['📢 Modérez le réseau publicitaire.']
                },
                'notifications': {
                    title: 'Notifications Broadcast',
                    text: 'Envoyez des messages importants à tous les utilisateurs.',
                    steps: ['✍️ Rédigez un titre et un message.', '🚀 Envoyez à toute la base de données.']
                }
            }
        },
        'admin-user-history': {
            title: 'Historique du compte',
            icon: 'fa-clock-rotate-left',
            intro: 'Retrace toutes les actions effectuées sur ce compte client.',
            sections: {
                'intro': {
                    title: 'À quoi ça sert ?',
                    text: 'Chaque renouvellement, changement de statut ou modification est enregistré ici, avec la date et qui l\'a fait.',
                    steps: ['🕒 Utile en cas de litige avec un client.', '🔍 Vérifiez rapidement ce qui a déjà été fait sur ce compte.']
                }
            }
        },
        'panel-gratuit': {
            title: 'Panel Gratuit',
            icon: 'fa-paper-plane',
            intro: 'Votre espace de démarrage. Ici, tout est gratuit.',
            sections: {
                'tools': {
                    title: 'Outils de base',
                    text: 'Vous avez accès aux fonctions essentielles pour démarrer.',
                    steps: ['👤 Vérification de compte.', '📄 Consultez les infos de votre offre.']
                },
                'upgrade': {
                    title: 'Mise à niveau',
                    text: 'Envie de plus d\'avantages ? Passez VIP.',
                    steps: ['🛒 Cliquez sur "Demander un abonnement".', '📝 Remplissez le formulaire.', '⏳ Attendez la validation de l\'admin.']
                }
            }
        },
        'panel-vip': {
            title: 'Panel VIP',
            icon: 'fa-crown',
            intro: 'L\'espace premium. Accès prioritaire et avantages exclusifs.',
            sections: {
                'tools': {
                    title: 'Avantages Premium',
                    text: 'Tout ce dont vous avez besoin en tant que membre VIP.',
                    steps: ['⚡ Accès prioritaire à votre abonnement.', '📊 Suivi détaillé de votre consommation.', '🛠️ Support dédié.']
                }
            }
        },
        'panel-revendeur': {
            title: 'Panel Revendeur',
            icon: 'fa-handshake',
            intro: 'Gérez votre business et vos clients.',
            sections: {
                'clients': {
                    title: 'Gestion Clients',
                    text: 'Vous avez la main sur vos utilisateurs.',
                    steps: ['➕ Créez un compte pour un client.', '📅 Définissez la durée (1 mois, 1 an...).', '🚫 Coupez l\'accès si besoin.']
                }
            }
        },
        'admin-config-generator': {
            title: 'Config Generator',
            icon: 'fa-gears',
            intro: 'L\'atelier de création de liens. Fabriquez vos configurations ici.',
            sections: {
                'templates': {
                    title: 'Modèles (Presets)',
                    text: 'Chargez des configurations pré-établies pour différents réseaux (ex. : Orange, MTN, Camtel) ou sauvegardez les vôtres.',
                    steps: ['📋 Sélectionnez un modèle dans la liste.', '💾 Ou configurez vos paramètres puis cliquez sur "Sauvegarder".']
                },
                'protocol': {
                    title: 'Protocole',
                    text: 'Choisissez la technologie de votre VPN.',
                    tip: 'VLESS est recommandé pour WebSocket, UDP pour Hysteria.'
                },
                'server': {
                    title: 'Serveur (IP/Port)',
                    text: 'Les coordonnées de votre serveur VPS.',
                    steps: ['🪄 L\'icône baguette magique détecte automatiquement votre IP publique.']
                },
                'params': {
                    title: 'Paramètres Spécifiques',
                    text: 'Chaque protocole a ses propres besoins (UUID, Payload, SNI...). Remplissez-les soigneusement.',
                    steps: ['⚙️ Choisissez le type (VLESS, SSH...).', '🌐 Entrez l\'adresse IP et le port.', '🔑 Entrez l\'UUID ou le mot de passe.']
                },
                'output': {
                    title: 'Sortie',
                    text: 'Votre lien est prêt à être partagé.',
                    steps: ['📦 L\'encadré affiche le lien (vless://...).', '📋 Cliquez sur "Copier" pour le prendre.']
                }
            }
        },
        'admin-dns-cloudflare': {
            title: 'DNS & Cloudflare',
            icon: 'fa-globe-americas',
            intro: 'Outils techniques pour vérifier les domaines et les IP.',
            sections: {
                'dns': {
                    title: 'Résolution DNS',
                    text: 'Pour savoir quelle IP se cache derrière un nom de domaine.',
                    steps: ['🌐 Entrez un domaine (ex: google.com).', '🔍 Cliquez sur Résoudre.', '📍 L\'IP s\'affiche.']
                },
                'cf': {
                    title: 'Check Cloudflare',
                    text: 'Vérifie si une adresse IP appartient à Cloudflare. Utile pour trouver des « IP propres » (Clean IP) pour les CDN.'
                }
            }
        },
        'profil': {
            title: 'Mon Profil',
            icon: 'fa-user-circle',
            intro: 'Toutes vos infos personnelles sont ici.',
            sections: {
                'info': {
                    title: 'Vos Infos',
                    text: 'Votre pseudo, votre niveau (Gratuit/VIP) et l\'état de votre compte.',
                    warning: 'Si votre compte est "Expiré", contactez le support.'
                },
                'sessions': {
                    title: 'Sessions Actives',
                    text: 'Gérez vos connexions sur d\'autres appareils.',
                    steps: ['📱 Voyez combien d\'autres appareils sont connectés.', '🔌 Déconnectez-les tous en un clic pour sécuriser votre compte.']
                }
            }
        },
        'abonnement': {
            title: 'Abonnement',
            icon: 'fa-file-invoice-dollar',
            intro: 'Gérez vos accès et demandes.',
            sections: {
                'upgrade': {
                    title: 'Mise à niveau',
                    text: 'Pour passer de Gratuit à VIP ou Revendeur.',
                    steps: ['📝 Remplissez le formulaire.', '📤 Envoyez la demande.', '🔔 L\'admin recevra une notification.']
                },
                'renewal': {
                    title: 'Renouvellement',
                    text: 'Si votre abonnement va expirer, demandez une prolongation ici.',
                    tip: 'Anticipez de quelques jours pour ne pas être coupé.'
                }
            }
        },
        'inscription': {
            title: 'Inscription',
            icon: 'fa-user-plus',
            intro: 'Rejoignez la famille Free-Surf !',
            sections: {
                'form': {
                    title: 'Formulaire',
                    text: 'Rien de compliqué.',
                    steps: ['👤 Choisissez un pseudo unique.', '📱 Indiquez un contact (WhatsApp/Telegram).', '🔐 Définissez une "Phrase secrète" pour récupérer votre compte si vous perdez tout.']
                }
            }
        },
        'mes-options': {
            title: 'Mes Options',
            icon: 'fa-box-open',
            intro: 'Vue d\'ensemble de ce que vous avez le droit de faire.',
            sections: {
                'list': {
                    title: 'Liste de vos options',
                    text: 'Chaque carte représente une fonctionnalité activée sur votre compte.',
                    tip: 'Si une option est grisée ou absente, c\'est que vous n\'y avez pas accès.'
                }
            }
        }
    },

    // Initialize
    init: function () {
        this.compactTouchUi = this.isCompactTouchUi();
        this.initTheme();
        this.injectHtml();
        if (!this.compactTouchUi) {
            this.scanPage();
        }
        this.bindEvents();

        // Check local storage to auto-open if needed (optional)
        // if (localStorage.getItem('ga_open') === 'true') this.openPanel();
    },

    isCompactTouchUi: function () {
        const ua = navigator.userAgent || '';
        const android = /Android/i.test(ua);
        const canMatch = typeof window.matchMedia === 'function';
        const coarse = canMatch ? window.matchMedia('(pointer: coarse)').matches : false;
        const narrow = canMatch ? window.matchMedia('(max-width: 960px)').matches : (window.innerWidth || 0) <= 960;
        return android || (coarse && narrow);
    },

    initTheme: function () {
        // Injecte les styles du mode clair spécifiques à l'assistant
        if (!document.getElementById('ga-theme-styles')) {
            const style = document.createElement('style');
            style.id = 'ga-theme-styles';
            style.innerHTML = `
                .theme-light #ga-panel { background: #f8fafc; color: #1e293b; border-left: 1px solid #e2e8f0; box-shadow: -4px 0 25px rgba(0,0,0,0.05);}
                .theme-light .ga-header { background: #e2e8f0; border-bottom: 1px solid #cbd5e1; }
                .theme-light .ga-section { background: #ffffff; border: 1px solid #e2e8f0; }
                .theme-light .ga-section:hover { background: #f1f5f9; border-color: #cbd5e1; }
                .theme-light .ga-text, .theme-light .ga-step { color: #475569; }
                .theme-light .ga-title, .theme-light .ga-section-title { color: #0f172a; }
                .theme-light #ga-theme-btn, .theme-light #ga-close-btn { color: #64748b; }
                .theme-light #ga-theme-btn:hover, .theme-light #ga-close-btn:hover { color: #0f172a; background: rgba(0,0,0,0.05); }
                .theme-light .ga-welcome p { color: #475569; }
                
                /* Responsive Android / Mobile */
                @media (max-width: 640px) {
                    #ga-panel {
                        width: 100% !important;
                        max-width: 100vw !important;
                        border-left: none !important;
                        right: -100% !important;
                    }
                    #ga-panel.open {
                        right: 0 !important;
                    }
                    .ga-content {
                        padding-bottom: 90px !important; /* Ne pas masquer le texte sous le bouton flottant */
                    }
                }
            `;
            document.head.appendChild(style);
        }
        this.currentTheme = localStorage.getItem('fs_theme') || 'dark';
        this.applyTheme(this.currentTheme);
    },

    applyTheme: function (theme) {
        this.currentTheme = theme;
        localStorage.setItem('fs_theme', theme);
        
        const root = document.documentElement;
        if (theme === 'light') {
            root.classList.add('theme-light');
            root.classList.remove('theme-dark');
        } else {
            root.classList.add('theme-dark');
            root.classList.remove('theme-light');
        }

        // Mettre à jour l'icône du bouton si l'interface est déjà chargée
        const themeBtnIcon = document.querySelector('#ga-theme-btn i');
        if (themeBtnIcon) {
            themeBtnIcon.className = theme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
        }
    },

    toggleTheme: function () {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
    },

    injectHtml: function () {
        // Determine current page from body attribute
        const pageKey = document.body.getAttribute('data-page-guide');
        if (!pageKey || !this.content[pageKey]) return; // si la clé est invalide, on sort

        this.currentPageData = this.content[pageKey];

        // Flottant
        const floatBtn = document.createElement('div');
        floatBtn.id = 'ga-float-btn';
        floatBtn.innerHTML = '<i class="fas fa-question"></i>';
        floatBtn.title = "Ouvrir l'assistant";
        document.body.appendChild(floatBtn);

        // Create Panel
        // On ajoute role=dialog et aria-modal pour forcer le lecteur d'écran à s'annoncer
        const panel = document.createElement('div');
        panel.id = 'ga-panel';
        panel.innerHTML = `
      <div class="ga-header">
        <div class="ga-title-box">
          <i class="fas ${this.currentPageData.icon || 'fa-book'} ga-title-icon text-accent" aria-hidden="true"></i>
          <span class="ga-title">Assistant : ${this.currentPageData.title}</span>
        </div>
        <div style="display: flex; gap: 0.25rem;">
          <button id="ga-theme-btn" aria-label="Changer le thème" title="Thème clair/sombre" style="background:transparent; border:none; color:inherit; cursor:pointer; padding:0.5rem; border-radius:0.375rem;"><i class="fas ${this.currentTheme === 'light' ? 'fa-sun' : 'fa-moon'}"></i></button>
          <button id="ga-close-btn" aria-label="Fermer l'assistant" title="Fermer" style="background:transparent; border:none; color:inherit; cursor:pointer; padding:0.5rem; border-radius:0.375rem;"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="ga-content">
        <div class="ga-welcome">
          <h3>${this.currentPageData.title}</h3>
          <p>${this.currentPageData.intro}</p>
        </div>
        <div id="ga-dynamic-content"></div>
      </div>
    `;
        document.body.appendChild(panel);

        // Populate Content
        const contentBox = document.getElementById('ga-dynamic-content');
        const sections = this.currentPageData.sections || {};

        for (const [key, section] of Object.entries(sections)) {
            let html = /*html*/`
        <div class="ga-section" data-section-id="${key}">
          <div class="ga-section-title">
            <i class="fas fa-chevron-right"></i> ${section.title}
          </div>
          <div class="ga-text">${section.text}</div>
      `;

            if (section.steps && section.steps.length > 0) {
                html += '<ol class="ga-steps">';
                section.steps.forEach(step => {
                    html += `<li class="ga-step">${step}</li>`;
                });
                html += '</ol>';
            }

            if (section.tip) {
                html += `<div class="ga-tip"><i class="fas fa-lightbulb mr-2"></i> ${section.tip}</div>`;
            }

            if (section.warning) {
                html += `<div class="ga-warning"><i class="fas fa-exclamation-triangle mr-2"></i> ${section.warning}</div>`;
            }

            html += `</div>`; // Close section
            contentBox.innerHTML += html;
        }
    },

    scanPage: function () {
        if (!this.currentPageData) return;

        // Find all elements with data-guide-id
        const elements = document.querySelectorAll('[data-guide-id]');
        elements.forEach(el => {
            const id = el.getAttribute('data-guide-id');
            // Create badge
            const badge = document.createElement('span');
            badge.className = 'ga-badge';
            badge.innerHTML = '?';
            badge.title = "Guide : " + id;

            // Prevent clicking badge from triggering parent click (if parent is a link/button)
            badge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openSection(id);
            });

            // Try to append badge to a header or title inside the element, otherwise append to element itself
            const title = el.querySelector('h1, h2, h3, h4, .orbitron, .title');
            if (title) {
                title.appendChild(badge);
            } else {
                // Just append to top right absolute if possible, or simple append
                // Check position
                const style = window.getComputedStyle(el);
                if (style.position === 'static') {
                    el.style.position = 'relative';
                }
                badge.style.position = 'absolute';
                badge.style.top = '10px';
                badge.style.right = '10px';
                el.appendChild(badge);
            }
        });
    },

    bindEvents: function () {
        const floatBtn = document.getElementById('ga-float-btn');
        const closeBtn = document.getElementById('ga-close-btn');
        const themeBtn = document.getElementById('ga-theme-btn');
        const panel = document.getElementById('ga-panel');

        if (floatBtn) {
            floatBtn.addEventListener('click', () => this.togglePanel());
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closePanel());
        }

        if (themeBtn) {
            themeBtn.addEventListener('click', () => this.toggleTheme());
        }
 
        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePanel();
        });
        
        // Close on click outside (optional, but panel is full height right, so maybe just main content click)
        document.addEventListener('click', (e) => {
            if (panel && panel.classList.contains('open') && !panel.contains(e.target) && e.target !== floatBtn && !e.target.classList.contains('ga-badge')) {
                this.closePanel();
            }
        });
    },

    togglePanel: function () {
        const panel = document.getElementById('ga-panel');
        if (panel.classList.contains('open')) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    },

    openPanel: function () {
        const panel = document.getElementById('ga-panel');
        if (panel) panel.classList.add('open');
    },

    closePanel: function () {
        const panel = document.getElementById('ga-panel');
        if (panel) panel.classList.remove('open');
    },

    openSection: function (sectionId) {
        this.openPanel();
        // Scroll to section
        const section = document.querySelector(`.ga-section[data-section-id="${sectionId}"]`);
        if (section) {
            setTimeout(() => {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Highlight effect
                section.style.background = 'rgba(255, 255, 255, 0.05)';
                setTimeout(() => section.style.background = 'transparent', 1500);
            }, 300);
        }
    }
};

// Auto-init on DOM Ready
// On reporte aussi l'initialisation
document.addEventListener('DOMContentLoaded', () => {
    GuideAssistant.init();
});
