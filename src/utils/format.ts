export function fmtClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function fmtSessionDuration(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export function fmtBytes(n: number): string {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 ? String(Math.round(n)) : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}

export function fmtGB(n: number, unitLabel = 'Go'): string {
  return (Number.isInteger(n) ? n : n.toFixed(1)) + ' ' + unitLabel;
}
