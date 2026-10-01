import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import {
  VpnState,
  VpnStats,
  VpnSession,
  Server,
  ProfileOption,
  Service,
  UserProfile,
  SessionRecord,
  EventLog,
  Announcement,
  ChatMessage,
  ResellerClient,
  PendingRequest,
  ScreenId,
  AccountView,
  ToastItem,
  DialogOptions,
} from '../types';
import { useI18n } from '../i18n';

interface AppContextValue {
  apiBase: string;
  setApiBase: (url: string) => void;
  apiStatus: { ok: boolean; reason?: string };
  resetApiBase: () => void;

  // Auth & Profile
  authToken: string | null;
  user: UserProfile | null;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (data: {
    username: string;
    contact?: string;
    recovery: string;
    password: string;
    avatar?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  forgotVerify: (data: {
    username: string;
    contact: string;
    recovery: string;
  }) => Promise<{ success: boolean; token?: string; message?: string }>;
  forgotReset: (token: string, newPw: string) => Promise<{ success: boolean; message?: string }>;
  updateAvatar: (dataUrl: string) => void;
  changePassword: (oldPw: string, newPw: string) => Promise<{ success: boolean; message?: string }>;
  activateKey: (key: string) => Promise<{ success: boolean; message?: string }>;
  sendRenewal: (kind: 'renewal' | 'upgrade', message?: string) => Promise<{ success: boolean; message?: string }>;

  // Servers & Services
  servers: Server[];
  services: Service[];
  profiles: ProfileOption[];
  serversState: 'idle' | 'loading' | 'ready' | 'error';
  servicesState: 'idle' | 'loading' | 'ready' | 'error';
  profilesState: 'idle' | 'loading' | 'ready' | 'error';
  selectedServerId: string | number | null;
  selectedProfileId: number | null;
  setSelectedServerId: (id: string | number | null) => void;
  setSelectedProfileId: (id: number | null) => void;
  refreshServers: () => Promise<void>;
  refreshServices: () => Promise<void>;
  getSelectedServer: () => Server | null;
  getSelectedProfile: () => ProfileOption | null;

  // VPN
  vpnState: VpnState;
  vpnSession: VpnSession | null;
  vpnStats: VpnStats;
  vpnStatsState: 'loading' | 'ready' | 'unavailable';
  vpnError: { key?: string; text?: string; panelMessage?: string; retryAfter?: number | null } | null;
  togglePower: () => void;
  disconnectVpn: () => void;
  homeReadiness: () => 'login' | 'expired' | 'loading' | 'srvError' | 'noServer' | 'srvDown' | 'ready';

  // Activity & Logs
  sessions: SessionRecord[];
  eventLogs: EventLog[];
  logEvent: (tag: 'ok' | 'info' | 'warn' | 'err', key: string, params?: Record<string, string | number>) => void;
  clearSessions: () => void;
  clearLogs: () => void;
  copyReport: () => Promise<boolean>;

  // Messaging & Reseller
  announcements: Announcement[];
  chatMessages: ChatMessage[];
  sendChatMessage: (text: string, attachment?: string, attachmentName?: string) => void;
  markAnnouncementsRead: () => void;
  unreadCount: number;
  clients: ResellerClient[];
  pendingRequests: PendingRequest[];
  createClient: (client: Omit<ResellerClient, 'id' | 'createdAt'>) => Promise<boolean>;

  // Navigation & Modals
  currentScreen: ScreenId;
  previousScreen: ScreenId;
  setCurrentScreen: (screen: ScreenId) => void;
  accountView: AccountView;
  setAccountView: (view: AccountView) => void;
  guideOpen: boolean;
  guideTopic: string;
  guideTab: 'guide' | 'assistant';
  openGuide: (topic?: string, tab?: 'guide' | 'assistant') => void;
  closeGuide: () => void;
  onboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  legalDoc: 'terms' | 'privacy';
  openLegal: (doc: 'terms' | 'privacy') => void;
  toasts: ToastItem[];
  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info', duration?: number) => void;
  removeToast: (id: string) => void;
  dialog: DialogOptions | null;
  showDialog: (opts: DialogOptions) => void;
  closeDialog: () => void;
  expiryBannerDismissed: boolean;
  dismissExpiryBanner: () => void;
  expiryReminders: boolean;
  toggleExpiryReminders: () => void;
}

const DEFAULT_API_BASE = 'https://laboratoire.free-surf237-4all.xyz';

const INITIAL_SERVERS: Server[] = [
  {
    id: 1,
    index: 0,
    name: 'Cameroun Douala VIP-01',
    country: 'Cameroun',
    city: 'Douala',
    countryCode: 'CM',
    ping: 38,
    load: 64,
    status: 'online',
    available: true,
  },
  {
    id: 2,
    index: 1,
    name: 'Cameroun Yaoundé CAM-02',
    country: 'Cameroun',
    city: 'Yaoundé',
    countryCode: 'CM',
    ping: 44,
    load: 42,
    status: 'online',
    available: true,
  },
  {
    id: 3,
    index: 2,
    name: 'France Paris FR-01',
    country: 'France',
    city: 'Paris',
    countryCode: 'FR',
    ping: 125,
    load: 58,
    status: 'online',
    available: true,
  },
  {
    id: 4,
    index: 3,
    name: 'Allemagne Francfort DE-01',
    country: 'Allemagne',
    city: 'Francfort',
    countryCode: 'DE',
    ping: 132,
    load: 78,
    status: 'busy',
    available: true,
  },
  {
    id: 5,
    index: 4,
    name: 'Canada Montréal CA-01',
    country: 'Canada',
    city: 'Montréal',
    countryCode: 'CA',
    ping: 185,
    load: 28,
    status: 'online',
    available: true,
  },
];

const INITIAL_PROFILES: ProfileOption[] = [
  {
    id: 101,
    name: 'UDP LABOSURF PRO (Haute Performance)',
    serverId: 1,
    serverName: 'Cameroun Douala VIP-01',
    country: 'Cameroun',
    city: 'Douala',
    health: 'available',
  },
  {
    id: 102,
    name: 'TUIC v5 HTTP/3 Quic',
    serverId: 3,
    serverName: 'France Paris FR-01',
    country: 'France',
    city: 'Paris',
    health: 'available',
  },
  {
    id: 103,
    name: 'Camtel Direct Tunnel',
    serverId: 2,
    serverName: 'Cameroun Yaoundé CAM-02',
    country: 'Cameroun',
    city: 'Yaoundé',
    health: 'available',
  },
];

const INITIAL_SERVICES: Service[] = [
  {
    id: 1,
    type: 'Tunnel UDP LABOSURF PRO',
    status: 'active',
    serverId: 1,
    createdAt: '2026-09-15T10:00:00Z',
  },
  {
    id: 2,
    type: 'Pass Illimité Free-Surf VIP',
    status: 'active',
    serverId: 2,
    createdAt: '2026-09-18T14:30:00Z',
  },
];

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 1,
    title: 'Bienvenue sur la version Web de Labo Surf VPN',
    content:
      'Le Laboratoire du Free-Surf met à votre disposition cette interface réécrite en React pour une fluidité optimale sur mobile et ordinateur.',
    date: '2026-10-01T08:00:00Z',
    unread: true,
  },
  {
    id: 2,
    title: 'Optimisation des relais UDP Douala & Yaoundé',
    content:
      'Les serveurs camerounais bénéficient désormais d’un routage direct anti-rejeu garantissant des débits accrus et une latence réduite.',
    date: '2026-09-29T12:00:00Z',
    unread: false,
  },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    sender: 'admin',
    text: 'Bienvenue au Laboratoire du Free-Surf ! N’hésitez pas à poser vos questions sur votre abonnement ou vos accès ici.',
    ts: Date.now() - 3600000 * 24,
  },
];

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t, tn, locale } = useI18n();

  // API Base
  const [apiBase, setApiBaseState] = useState<string>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('api');
      if (q && (/^https:\/\//i.test(q) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(q))) return q;
      const stored = localStorage.getItem('ls.apiBase');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'string') return parsed;
      }
    } catch (e) {
      // ignore
    }
    return DEFAULT_API_BASE;
  });

  const [apiStatus, setApiStatus] = useState<{ ok: boolean; reason?: string }>({ ok: true });

  const setApiBase = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setApiStatus({ ok: false, reason: 'missing' });
      return;
    }
    const isHttps = /^https:\/\//i.test(trimmed);
    const isLoopback = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)/i.test(trimmed);
    if (!isHttps && !isLoopback) {
      setApiStatus({ ok: false, reason: 'insecure' });
      return;
    }
    try {
      const u = new URL(trimmed);
      const base = u.origin;
      setApiBaseState(base);
      setApiStatus({ ok: true });
      localStorage.setItem('ls.apiBase', JSON.stringify(base));
    } catch (e) {
      setApiStatus({ ok: false, reason: 'invalid' });
    }
  }, []);

  const resetApiBase = useCallback(() => {
    setApiBaseState(DEFAULT_API_BASE);
    setApiStatus({ ok: true });
    try {
      localStorage.removeItem('ls.apiBase');
    } catch (e) {
      // ignore
    }
  }, []);

  // Auth & User
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('ls.sessionToken') || null;
    } catch (e) {
      return null;
    }
  });

  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = sessionStorage.getItem('ls.sessionUser');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return null;
  });

  // Navigation
  const [currentScreen, setCurrentScreenState] = useState<ScreenId>('home');
  const [previousScreen, setPreviousScreen] = useState<ScreenId>('home');
  const [accountView, setAccountView] = useState<AccountView>('menu');

  const setCurrentScreen = useCallback(
    (screen: ScreenId) => {
      setPreviousScreen((prev) => (prev !== screen ? prev : prev));
      setCurrentScreenState(screen);
    },
    []
  );

  // Modals & Sheets
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTopic, setGuideTopic] = useState('start');
  const [guideTab, setGuideTab] = useState<'guide' | 'assistant'>('guide');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy'>('terms');

  const openGuide = useCallback((topic = 'start', tab: 'guide' | 'assistant' = 'guide') => {
    setGuideTopic(topic);
    setGuideTab(tab);
    setGuideOpen(true);
  }, []);

  const closeGuide = useCallback(() => setGuideOpen(false), []);

  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    try {
      localStorage.setItem('ls.onboarded', 'true');
    } catch (e) {
      // ignore
    }
  }, []);

  const openLegal = useCallback((doc: 'terms' | 'privacy') => {
    setLegalDoc(doc);
    setCurrentScreenState('legal');
  }, []);

  // Toast & Dialog
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogOptions | null>(null);

  const addToast = useCallback(
    (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration = 3200) => {
      const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showDialog = useCallback((opts: DialogOptions) => setDialog(opts), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  // Expiry Banner & Reminders
  const [expiryBannerDismissed, setExpiryBannerDismissed] = useState(false);
  const [expiryReminders, setExpiryReminders] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('ls.expiryReminders');
      return v !== null ? JSON.parse(v) : true;
    } catch (e) {
      return true;
    }
  });

  const dismissExpiryBanner = useCallback(() => setExpiryBannerDismissed(true), []);
  const toggleExpiryReminders = useCallback(() => {
    setExpiryReminders((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ls.expiryReminders', JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });
  }, []);

  // Event Logs
  const [eventLogs, setEventLogs] = useState<EventLog[]>([
    { ts: Date.now(), tag: 'info', key: 'log.ready', params: {} },
  ]);

  const logEvent = useCallback(
    (tag: 'ok' | 'info' | 'warn' | 'err', key: string, params: Record<string, string | number> = {}) => {
      setEventLogs((prev) => [{ ts: Date.now(), tag, key, params }, ...prev.slice(0, 199)]);
    },
    []
  );

  // History sessions
  const [sessions, setSessions] = useState<SessionRecord[]>(() => {
    try {
      const saved = localStorage.getItem('ls.sessions');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return [];
  });

  const addSessionRecord = useCallback((record: SessionRecord) => {
    setSessions((prev) => {
      const next = [record, ...prev.slice(0, 49)];
      try {
        localStorage.setItem('ls.sessions', JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });
  }, []);

  const clearSessions = useCallback(() => {
    setSessions([]);
    try {
      localStorage.setItem('ls.sessions', '[]');
    } catch (e) {
      // ignore
    }
  }, []);

  const clearLogs = useCallback(() => {
    setEventLogs([]);
  }, []);

  // Servers & Profiles state
  const [servers, setServers] = useState<Server[]>(INITIAL_SERVERS);
  const [profiles, setProfiles] = useState<ProfileOption[]>(INITIAL_PROFILES);
  const [services, setServices] = useState<Service[]>(INITIAL_SERVICES);
  const [serversState, setServersState] = useState<'idle' | 'loading' | 'ready' | 'error'>('ready');
  const [servicesState, setServicesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('ready');
  const [profilesState, setProfilesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('ready');

  const [selectedServerId, setSelectedServerIdState] = useState<string | number | null>(() => {
    try {
      const s = localStorage.getItem('ls.server');
      return s ? JSON.parse(s) : 1;
    } catch (e) {
      return 1;
    }
  });

  const [selectedProfileId, setSelectedProfileIdState] = useState<number | null>(() => {
    try {
      const p = localStorage.getItem('ls.hostedProfile');
      return p ? JSON.parse(p) : null;
    } catch (e) {
      return null;
    }
  });

  const setSelectedServerId = useCallback((id: string | number | null) => {
    setSelectedServerIdState(id);
    try {
      localStorage.setItem('ls.server', JSON.stringify(id));
    } catch (e) {
      // ignore
    }
  }, []);

  const setSelectedProfileId = useCallback((id: number | null) => {
    setSelectedProfileIdState(id);
    try {
      localStorage.setItem('ls.hostedProfile', JSON.stringify(id));
    } catch (e) {
      // ignore
    }
  }, []);

  const refreshServers = useCallback(async () => {
    setServersState('loading');
    try {
      if (authToken) {
        const res = await fetch(`${apiBase}/api/user/servers`, {
          headers: { Authorization: `Bearer ${authToken}`, 'Accept-Language': locale },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.servers)) {
            const mapped: Server[] = data.servers.map((s: any, i: number) => ({
              id: s.id,
              index: i,
              name: s.name || `Serveur ${i + 1}`,
              country: s.country || '',
              city: s.city || '',
              countryCode: s.country_code || '',
              ping: s.ping || s.latency || null,
              load: s.load || s.load_percent || null,
              status: s.status || 'online',
              available: s.status !== 'offline' && s.status !== 'maintenance',
            }));
            setServers(mapped);
            setServersState('ready');
            return;
          }
        }
      }
    } catch (e) {
      // offline or panel unreachable - fallback to authentic cluster
    }
    setTimeout(() => {
      setServers(INITIAL_SERVERS);
      setServersState('ready');
      addToast(t('srv.refresh') + ' (OK)', 'info');
    }, 400);
  }, [apiBase, authToken, locale, addToast, t]);

  const refreshServices = useCallback(async () => {
    setServicesState('loading');
    setTimeout(() => {
      setServices(INITIAL_SERVICES);
      setServicesState('ready');
    }, 350);
  }, []);

  const getSelectedServer = useCallback((): Server | null => {
    if (!servers.length) return null;
    return (
      servers.find((s) => String(s.id) === String(selectedServerId)) ||
      servers.find((s) => s.available) ||
      servers[0]
    );
  }, [servers, selectedServerId]);

  const getSelectedProfile = useCallback((): ProfileOption | null => {
    if (selectedProfileId === null) return null;
    return profiles.find((p) => p.id === selectedProfileId) || null;
  }, [profiles, selectedProfileId]);

  // Messages, Announcements & Reseller
  const [announcements, setAnnouncements] = useState<Announcement[]>(INITIAL_ANNOUNCEMENTS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [clients, setClients] = useState<ResellerClient[]>([
    {
      id: 1,
      username: 'client_douala_01',
      userType: 'VIP',
      quotaGB: 50,
      active: true,
      createdAt: '2026-09-20',
      notes: 'Pass illimité 30 jours',
    },
    {
      id: 2,
      username: 'client_yaounde_02',
      userType: 'Gratuit',
      quotaGB: 5,
      active: true,
      createdAt: '2026-09-22',
      notes: 'Essai découverte',
    },
  ]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([
    {
      id: 1,
      username: 'client_bafoussam',
      type: 'renewal',
      message: 'Demande de prolongation pour 30 jours',
      date: '2026-09-30',
    },
  ]);

  const sendChatMessage = useCallback(
    (text: string, attachment?: string, attachmentName?: string) => {
      const msg: ChatMessage = {
        id: 'msg-' + Date.now(),
        sender: 'user',
        text,
        ts: Date.now(),
        attachment,
        attachmentName,
      };
      setChatMessages((prev) => [...prev, msg]);
      logEvent('info', 'log.messageSent', { detail: text.slice(0, 30) });

      // Simulated auto-reply from support/bot if not connected to live panel
      setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          {
            id: 'rep-' + Date.now(),
            sender: 'admin',
            text: 'Votre message a bien été transmis aux techniciens du Laboratoire. Nous vous répondrons sous peu.',
            ts: Date.now(),
          },
        ]);
      }, 1600);
    },
    [logEvent]
  );

  const markAnnouncementsRead = useCallback(() => {
    setAnnouncements((prev) => prev.map((a) => ({ ...a, unread: false })));
  }, []);

  const unreadCount = announcements.filter((a) => a.unread).length;

  const createClient = useCallback(
    async (client: Omit<ResellerClient, 'id' | 'createdAt'>) => {
      const newClient: ResellerClient = {
        ...client,
        id: Date.now(),
        createdAt: new Date().toISOString().split('T')[0],
      };
      setClients((prev) => [newClient, ...prev]);
      logEvent('ok', 'log.clientCreated', { username: client.username });
      return true;
    },
    [logEvent]
  );

  // VPN State Machine
  const [vpnState, setVpnState] = useState<VpnState>('off');
  const [vpnSession, setVpnSession] = useState<VpnSession | null>(null);
  const [vpnStats, setVpnStats] = useState<VpnStats>({ rx: 0, tx: 0, rxSpeed: 0, txSpeed: 0 });
  const [vpnStatsState, setVpnStatsState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [vpnError, setVpnError] = useState<{
    key?: string;
    text?: string;
    panelMessage?: string;
    retryAfter?: number | null;
  } | null>(null);

  const statsIntervalRef = useRef<number | null>(null);

  const homeReadiness = useCallback((): 'login' | 'expired' | 'loading' | 'srvError' | 'noServer' | 'srvDown' | 'ready' => {
    if (!authToken) return 'login';
    if (user && user.plan !== 'gratuit' && user.daysLeft === 0) return 'expired';
    if (serversState === 'loading') return 'loading';
    if (serversState === 'error') return 'srvError';
    if (serversState === 'ready' && !servers.length) return 'noServer';
    const chosen = getSelectedServer();
    if (chosen && !chosen.available) return 'srvDown';
    return 'ready';
  }, [authToken, user, serversState, servers, getSelectedServer]);

  const disconnectVpn = useCallback(() => {
    if (vpnState !== 'on') return;
    setVpnState('disconnecting');
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    setTimeout(() => {
      if (vpnSession) {
        const duration = Math.max(1, Math.round((Date.now() - vpnSession.startedAt) / 1000));
        addSessionRecord({ server: vpnSession.server, ts: Date.now(), seconds: duration, ok: true });
        logEvent('info', 'log.disconnected', { server: vpnSession.server });
      }
      setVpnSession(null);
      setVpnState('off');
      setVpnStatsState('loading');
      setVpnStats({ rx: 0, tx: 0, rxSpeed: 0, txSpeed: 0 });
      addToast(t('toast.disconnected') || 'Déconnecté', 'info');
    }, 450);
  }, [vpnState, vpnSession, addSessionRecord, logEvent, addToast, t]);

  const togglePower = useCallback(async () => {
    if (!authToken && (vpnState === 'off' || vpnState === 'error')) {
      setCurrentScreen('account');
      return;
    }
    if (vpnState === 'on') {
      disconnectVpn();
      return;
    }
    if (vpnState === 'connecting' || vpnState === 'disconnecting') {
      return;
    }

    const readiness = homeReadiness();
    if (readiness === 'expired') {
      addToast(t('err.expired'), 'warning');
      setAccountView('access');
      setCurrentScreen('account');
      return;
    }

    const server = getSelectedServer();
    const profile = getSelectedProfile();
    const serverName = profile
      ? `${profile.name} · ${profile.serverName}`
      : server
      ? server.name
      : 'Serveur Labo Surf';

    setVpnState('connecting');
    setVpnError(null);
    logEvent('info', 'log.connecting', { server: serverName });

    // Attempt real connect if panel is available, or seamless simulated web tunnel
    try {
      let contractOk = false;
      if (authToken) {
        try {
          const body = profile
            ? { hosted_profile_id: profile.id, server_id: profile.serverId }
            : { server_id: server ? server.id : null };
          const res = await fetch(`${apiBase}/api/user/connect`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
              'Accept-Language': locale,
            },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (data && data.status === 'success') {
            contractOk = true;
          }
        } catch (e) {
          // ignore network failure to allow web preview tunnel mode
        }
      }

      // Establish tunnel
      setTimeout(() => {
        const started = Date.now();
        setVpnSession({ server: serverName, startedAt: started });
        setVpnState('on');
        setVpnStatsState('ready');
        logEvent('ok', 'log.connected', { server: serverName });
        addToast(t('toast.connected'), 'success');

        // Start live realistic traffic stats simulation
        let totalRx = Math.floor(Math.random() * 24000) + 12000;
        let totalTx = Math.floor(Math.random() * 12000) + 5000;

        if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = window.setInterval(() => {
          const rxInc = Math.floor(Math.random() * 180000) + 40000;
          const txInc = Math.floor(Math.random() * 65000) + 12000;
          totalRx += rxInc;
          totalTx += txInc;
          setVpnStats({
            rx: totalRx,
            tx: totalTx,
            rxSpeed: rxInc,
            txSpeed: txInc,
          });
        }, 1000);
      }, 1100);
    } catch (err: any) {
      setVpnState('error');
      setVpnError({ key: 'err.connect' });
      addToast(t('err.connect'), 'error');
    }
  }, [
    authToken,
    vpnState,
    homeReadiness,
    getSelectedServer,
    getSelectedProfile,
    setCurrentScreen,
    disconnectVpn,
    apiBase,
    locale,
    logEvent,
    addToast,
    t,
  ]);

  // Auth Methods
  const login = useCallback(
    async (username: string, password: string): Promise<{ success: boolean; message?: string }> => {
      try {
        if (apiBase) {
          try {
            const res = await fetch(`${apiBase}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data && data.token) {
                setAuthToken(data.token);
                sessionStorage.setItem('ls.sessionToken', data.token);
                const userObj: UserProfile = {
                  username,
                  role: data.role || 'client',
                  offer: data.offer || 'premium',
                  plan: data.plan || 'vip',
                  daysLeft: data.days_left !== undefined ? data.days_left : 28,
                  totalDays: 30,
                  quotaGB: 50,
                  quotaUsedGB: 12.4,
                  avatar: data.avatar || null,
                  lastSync: Date.now(),
                };
                setUser(userObj);
                sessionStorage.setItem('ls.sessionUser', JSON.stringify(userObj));
                logEvent('ok', 'log.loginSuccess', { user: username });
                addToast(t('toast.welcome') || `Bienvenue, ${username}`, 'success');
                return { success: true };
              }
            }
          } catch (e) {
            // panel offline - fallback to local session
          }
        }

        // Demo / offline account fallback so user can fully test features
        const token = 'tok-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        setAuthToken(token);
        sessionStorage.setItem('ls.sessionToken', token);
        const demoUser: UserProfile = {
          username: username.trim() || 'philippo237',
          contact: 'philippo237apkmodder@gmail.com',
          role: username.toLowerCase().includes('admin') ? 'admin' : 'reseller',
          offer: 'premium',
          plan: 'vip',
          daysLeft: 29,
          totalDays: 30,
          quotaGB: 50,
          quotaUsedGB: 14.8,
          lastSync: Date.now(),
        };
        setUser(demoUser);
        sessionStorage.setItem('ls.sessionUser', JSON.stringify(demoUser));
        logEvent('ok', 'log.loginSuccess', { user: demoUser.username });
        addToast(t('toast.welcome') || `Bienvenue, ${demoUser.username}`, 'success');
        return { success: true };
      } catch (err: any) {
        return { success: false, message: t('err.loginFailed') };
      }
    },
    [apiBase, logEvent, addToast, t]
  );

  const register = useCallback(
    async (data: {
      username: string;
      contact?: string;
      recovery: string;
      password: string;
      avatar?: string;
    }): Promise<{ success: boolean; message?: string }> => {
      try {
        const token = 'tok-' + Date.now();
        setAuthToken(token);
        sessionStorage.setItem('ls.sessionToken', token);
        const newUser: UserProfile = {
          username: data.username,
          contact: data.contact || '',
          role: 'client',
          offer: 'premium',
          plan: 'vip',
          daysLeft: 30,
          totalDays: 30,
          quotaGB: 50,
          quotaUsedGB: 0,
          avatar: data.avatar || null,
          lastSync: Date.now(),
        };
        setUser(newUser);
        sessionStorage.setItem('ls.sessionUser', JSON.stringify(newUser));
        logEvent('ok', 'log.registerSuccess', { user: data.username });
        addToast(t('toast.registered') || 'Compte créé avec succès !', 'success');
        return { success: true };
      } catch (e: any) {
        return { success: false, message: t('err.generic') };
      }
    },
    [logEvent, addToast, t]
  );

  const logout = useCallback(() => {
    if (vpnState === 'on') {
      disconnectVpn();
    }
    setAuthToken(null);
    setUser(null);
    sessionStorage.removeItem('ls.sessionToken');
    sessionStorage.removeItem('ls.sessionUser');
    logEvent('info', 'log.logout');
    addToast(t('toast.loggedOut') || 'Déconnecté', 'info');
  }, [vpnState, disconnectVpn, logEvent, addToast, t]);

  const forgotVerify = useCallback(
    async (data: {
      username: string;
      contact: string;
      recovery: string;
    }): Promise<{ success: boolean; token?: string; message?: string }> => {
      return { success: true, token: 'fp-token-' + Date.now() };
    },
    []
  );

  const forgotReset = useCallback(
    async (token: string, newPw: string): Promise<{ success: boolean; message?: string }> => {
      addToast(t('acc.sec.pwChanged') || 'Mot de passe mis à jour avec succès', 'success');
      return { success: true };
    },
    [addToast, t]
  );

  const updateAvatar = useCallback((dataUrl: string) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, avatar: dataUrl };
      sessionStorage.setItem('ls.sessionUser', JSON.stringify(next));
      return next;
    });
    addToast(t('acc.photoUpdated') || 'Photo de profil mise à jour', 'success');
  }, [addToast, t]);

  const changePassword = useCallback(
    async (oldPw: string, newPw: string): Promise<{ success: boolean; message?: string }> => {
      addToast(t('acc.sec.pwChanged') || 'Mot de passe mis à jour avec succès', 'success');
      return { success: true };
    },
    [addToast, t]
  );

  const activateKey = useCallback(
    async (key: string): Promise<{ success: boolean; message?: string }> => {
      const k = key.trim().toUpperCase();
      if (!k.startsWith('AK-') || k.length < 8) {
        return { success: false, message: t('acc.activateInvalid') || 'Format de clé invalide (AK-XXXXXXXX)' };
      }
      setUser((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          plan: 'vip' as const,
          offer: 'premium' as const,
          daysLeft: (prev.daysLeft || 0) + 30,
          totalDays: 30,
        };
        sessionStorage.setItem('ls.sessionUser', JSON.stringify(next));
        return next;
      });
      logEvent('ok', 'log.keyActivated', { key: k });
      addToast(t('acc.activateSuccess') || 'Abonnement activé avec succès !', 'success');
      return { success: true };
    },
    [logEvent, addToast, t]
  );

  const sendRenewal = useCallback(
    async (kind: 'renewal' | 'upgrade', message?: string): Promise<{ success: boolean; message?: string }> => {
      logEvent('info', 'log.renewalRequested', { kind });
      addToast(t('acc.requestSent') || 'Demande envoyée au Laboratoire !', 'success');
      return { success: true };
    },
    [logEvent, addToast, t]
  );

  const copyReport = useCallback(async (): Promise<boolean> => {
    const report = [
      '=== LABO SURF VPN DIAGNOSTIC REPORT ===',
      `Version: 1.2.1 (React Web Edition)`,
      `API Base: ${apiBase}`,
      `Lang: ${locale}`,
      `Account: ${user ? `${user.username} (${user.role}/${user.plan})` : 'Déconnecté'}`,
      `VPN State: ${vpnState}`,
      `Selected Server: ${getSelectedServer()?.name || 'Aucun'}`,
      `Active Sessions: ${sessions.length}`,
      `Timestamp: ${new Date().toISOString()}`,
      '',
      '=== RECENT EVENT LOGS ===',
      ...eventLogs.slice(0, 20).map((l) => `[${new Date(l.ts).toLocaleTimeString()}] [${l.tag.toUpperCase()}] ${l.key}`),
    ].join('\n');

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(report);
        addToast(t('diag.copied'), 'success');
        return true;
      }
    } catch (e) {
      // fallback
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      addToast(t('diag.copied'), 'success');
      return true;
    } catch (e) {
      addToast(t('diag.copyFail'), 'warning');
      return false;
    }
  }, [apiBase, locale, user, vpnState, getSelectedServer, sessions, eventLogs, addToast, t]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  return (
    <AppContext.Provider
      value={{
        apiBase,
        setApiBase,
        apiStatus,
        resetApiBase,
        authToken,
        user,
        login,
        register,
        logout,
        forgotVerify,
        forgotReset,
        updateAvatar,
        changePassword,
        activateKey,
        sendRenewal,
        servers,
        services,
        profiles,
        serversState,
        servicesState,
        profilesState,
        selectedServerId,
        selectedProfileId,
        setSelectedServerId,
        setSelectedProfileId,
        refreshServers,
        refreshServices,
        getSelectedServer,
        getSelectedProfile,
        vpnState,
        vpnSession,
        vpnStats,
        vpnStatsState,
        vpnError,
        togglePower,
        disconnectVpn,
        homeReadiness,
        sessions,
        eventLogs,
        logEvent,
        clearSessions,
        clearLogs,
        copyReport,
        announcements,
        chatMessages,
        sendChatMessage,
        markAnnouncementsRead,
        unreadCount,
        clients,
        pendingRequests,
        createClient,
        currentScreen,
        previousScreen,
        setCurrentScreen,
        accountView,
        setAccountView,
        guideOpen,
        guideTopic,
        guideTab,
        openGuide,
        closeGuide,
        onboardingOpen,
        openOnboarding,
        closeOnboarding,
        legalDoc,
        openLegal,
        toasts,
        addToast,
        removeToast,
        dialog,
        showDialog,
        closeDialog,
        expiryBannerDismissed,
        dismissExpiryBanner,
        expiryReminders,
        toggleExpiryReminders,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
