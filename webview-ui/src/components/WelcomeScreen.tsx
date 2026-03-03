import React from 'react';

interface Props {
  onNewConnection: () => void;
}

export function WelcomeScreen({ onNewConnection }: Props) {
  return (
    <div style={styles.container}>
      <div style={styles.logo}>🗄️</div>
      <h1 style={styles.title}>PostPrettify</h1>
      <p style={styles.subtitle}>Visual PostgreSQL manager for VS Code</p>

      <button onClick={onNewConnection} style={styles.btn}>
        + New Connection
      </button>

      <div style={styles.features}>
        {FEATURES.map(f => (
          <div key={f.title} style={styles.feature}>
            <span style={styles.featureIcon}>{f.icon}</span>
            <div>
              <div style={styles.featureTitle}>{f.title}</div>
              <div style={styles.featureDesc}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: '🔌', title: 'Connect', desc: 'Connect to any PostgreSQL database with SSL support' },
  { icon: '▦', title: 'Browse & Edit', desc: 'View, insert, update and delete table rows visually' },
  { icon: '⬡', title: 'ERD Diagram', desc: 'Visualize table relationships and foreign keys' },
  { icon: '⌨', title: 'Query Editor', desc: 'Write and run SQL with syntax highlighting' },
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 40,
    textAlign: 'center',
  },
  logo: { fontSize: 56, lineHeight: 1 },
  title: { margin: 0, fontSize: 28, fontWeight: 700 },
  subtitle: { margin: 0, color: 'var(--pp-text-muted)', fontSize: 14 },
  btn: { padding: '8px 24px', fontSize: 14, marginTop: 8 },
  features: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginTop: 24,
    maxWidth: 500,
    textAlign: 'left',
  },
  feature: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    background: 'var(--pp-bg-secondary)',
    border: '1px solid var(--pp-border)',
    borderRadius: 6,
    padding: 12,
  },
  featureIcon: { fontSize: 20, flexShrink: 0 },
  featureTitle: { fontWeight: 600, fontSize: 13 },
  featureDesc: { fontSize: 12, color: 'var(--pp-text-muted)', marginTop: 2 },
};
