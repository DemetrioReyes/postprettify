import React from 'react';
import { useStore } from '../store';
import type { Toast } from '../store';

const KIND_STYLES: Record<Toast['kind'], { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(78,201,176,0.12)', border: '#4ec9b0', icon: '✓' },
  error:   { bg: 'rgba(244,71,71,0.12)',  border: 'var(--pp-error)', icon: '⚠' },
  info:    { bg: 'rgba(0,127,212,0.12)',   border: 'var(--pp-accent)', icon: 'ℹ' },
};

export function ToastContainer() {
  const { toasts, removeToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div style={styles.container}>
      {toasts.map(toast => {
        const k = KIND_STYLES[toast.kind];
        return (
          <div
            key={toast.id}
            style={{ ...styles.toast, background: k.bg, borderLeft: `3px solid ${k.border}` }}
          >
            <span style={{ color: k.border, fontWeight: 700, marginRight: 6 }}>{k.icon}</span>
            <span style={styles.msg}>{toast.message}</span>
            <button
              className="secondary"
              style={styles.close}
              onClick={() => removeToast(toast.id)}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 9999,
    maxWidth: 380,
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 4,
    border: '1px solid var(--pp-border)',
    fontSize: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'all',
    animation: 'fadeIn 0.15s ease',
  },
  msg: { flex: 1, color: 'var(--pp-text)' },
  close: {
    padding: '0 4px',
    fontSize: 10,
    border: 'none',
    marginLeft: 8,
    opacity: 0.6,
    flexShrink: 0,
  },
};
