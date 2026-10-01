export type VpnState = 'off' | 'connecting' | 'on' | 'disconnecting' | 'error';

export interface VpnStats {
  rx: number;
  tx: number;
  rxSpeed: number;
  txSpeed: number;
}

export interface VpnSession {
  server: string;
  startedAt: number;
}

export interface Server {
  id: number | string;
  index: number;
  name: string;
  country: string;
  city: string;
  countryCode: string;
  ping: number | null;
  load: number | null;
  status: 'online' | 'busy' | 'maintenance' | 'offline' | null;
  available: boolean;
}

export interface ProfileOption {
  id: number;
  name: string;
  serverId: number | null;
  serverName: string;
  country: string;
  city: string;
  health: 'available' | 'unknown';
}

export interface Service {
  id: number | null;
  type: string;
  status: string;
  serverId: number | null;
  createdAt: string;
}

export interface UserProfile {
  id?: number;
  username: string;
  contact?: string;
  role: 'client' | 'reseller' | 'admin' | 'super_admin';
  offer: 'free' | 'premium';
  plan: 'gratuit' | 'vip' | 'revendeur' | 'admin';
  daysLeft: number | null;
  totalDays?: number | null;
  quotaGB?: number | null;
  quotaUsedGB?: number | null;
  avatar?: string | null;
  lastSync?: number;
}

export interface SessionRecord {
  server: string;
  ts: number;
  seconds: number;
  ok: boolean;
}

export interface EventLog {
  ts: number;
  tag: 'ok' | 'info' | 'warn' | 'err';
  key: string;
  params?: Record<string, string | number>;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  date: string;
  unread?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'admin';
  text: string;
  ts: number;
  attachment?: string;
  attachmentName?: string;
}

export interface ResellerClient {
  id: number;
  username: string;
  userType: string;
  quotaGB: number;
  active: boolean;
  createdAt: string;
  notes?: string;
}

export interface PendingRequest {
  id: number;
  username: string;
  type: 'renewal' | 'upgrade';
  message?: string;
  date: string;
}

export type ScreenId =
  | 'home'
  | 'services'
  | 'servers'
  | 'account'
  | 'activity'
  | 'logs'
  | 'settings'
  | 'about'
  | 'community'
  | 'legal'
  | 'clients';

export type AccountView = 'menu' | 'access' | 'messages' | 'security';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

export interface DialogOptions {
  title: string;
  message: string;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}
