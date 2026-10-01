import React from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './SvgIcons';

const TOAST_ICONS: Record<string, string> = {
  success: 'check-circle',
  error: 'alert-circle',
  warning: 'alert',
  info: 'info',
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (!toasts.length) return null;

  return (
    <div className="toasts" id="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
          onClick={() => removeToast(toast.id)}
        >
          <Icon name={TOAST_ICONS[toast.type] || 'info'} />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
};
