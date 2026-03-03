import React, { useState, useEffect } from 'react';
import { postMessage } from '../vscode';
import { useStore } from '../store';
import type { ConnectionWithPassword } from '../../../src/types';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const DEFAULT_FORM: ConnectionWithPassword = {
  id: generateId(),
  name: '',
  host: 'localhost',
  port: 5432,
  database: '',
  user: 'postgres',
  password: '',
  ssl: false,
};

interface Props {
  onClose?: () => void;
}

export function ConnectionForm({ onClose }: Props) {
  const [form, setForm] = useState<ConnectionWithPassword>({ ...DEFAULT_FORM, id: generateId() });
  const [connecting, setConnecting] = useState(false);
  const { error } = useStore();

  // Reset button if extension host replies with an error
  useEffect(() => {
    if (error) setConnecting(false);
  }, [error]);

  function handleChange(field: keyof ConnectionWithPassword, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    postMessage({ command: 'connect', payload: form });
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.card} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>New Connection</h2>
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose} className="secondary">
              ✕
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <Field label="Connection Name *">
            <input
              required
              value={form.name}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="My PostgreSQL DB"
              style={styles.input}
            />
          </Field>

          <div style={styles.row}>
            <Field label="Host *" style={{ flex: 3 }}>
              <input
                required
                value={form.host}
                onChange={e => handleChange('host', e.target.value)}
                placeholder="localhost"
                style={styles.input}
              />
            </Field>
            <Field label="Port *" style={{ flex: 1 }}>
              <input
                required
                type="number"
                value={form.port}
                onChange={e => handleChange('port', parseInt(e.target.value, 10))}
                style={styles.input}
              />
            </Field>
          </div>

          <Field label="Database *">
            <input
              required
              value={form.database}
              onChange={e => handleChange('database', e.target.value)}
              placeholder="postgres"
              style={styles.input}
            />
          </Field>

          <div style={styles.row}>
            <Field label="User *" style={{ flex: 1 }}>
              <input
                required
                value={form.user}
                onChange={e => handleChange('user', e.target.value)}
                placeholder="postgres"
                style={styles.input}
              />
            </Field>
            <Field label="Password" style={{ flex: 1 }}>
              <input
                type="password"
                value={form.password}
                onChange={e => handleChange('password', e.target.value)}
                placeholder="••••••••"
                style={styles.input}
              />
            </Field>
          </div>

          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={form.ssl}
              onChange={e => handleChange('ssl', e.target.checked)}
            />
            <span>Use SSL</span>
          </label>

          <div style={styles.actions}>
            {onClose && (
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label style={{ fontSize: 11, color: 'var(--pp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  card: {
    background: 'var(--pp-bg-secondary)',
    border: '1px solid var(--pp-border)',
    borderRadius: 6,
    width: 480,
    maxWidth: '95vw',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 0',
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
  },
  closeBtn: {
    padding: '2px 8px',
    fontSize: 12,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '16px 20px 20px',
  },
  row: {
    display: 'flex',
    gap: 12,
  },
  input: {
    width: '100%',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 4,
  },
};
