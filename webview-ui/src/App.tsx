import React, { useEffect, useState, useRef } from 'react';
import { useStore } from './store';
import { useVSCodeMessages } from './hooks/useVSCodeMessages';
import { postMessage } from './vscode';
import { Sidebar } from './components/Sidebar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ConnectionForm } from './components/ConnectionForm';
import { TableDataGrid } from './components/TableDataGrid';
import { QueryEditor } from './components/QueryEditor';
import { ERDCanvas } from './components/ERDCanvas';
import { CreateTableWizard } from './components/CreateTableWizard';
import { AlterTableEditor } from './components/AlterTableEditor';
import { FunctionsViewer } from './components/FunctionsViewer';
import { CreateViewEditor } from './components/CreateViewEditor';
import { ToastContainer } from './components/Toast';

export default function App() {
  useVSCodeMessages();

  const { activeView, tabs, activeTabId, closeTab, setActiveView, connections } = useStore();
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showAlterTable, setShowAlterTable] = useState(false);
  const [showCreateView, setShowCreateView] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const prevConnectionsSize = useRef(0);

  useEffect(() => {
    postMessage({ command: 'getConnections', payload: {} });
  }, []);

  // Auto-close connection form when a new connection is added
  useEffect(() => {
    if (connections.size > prevConnectionsSize.current) {
      setShowConnectionForm(false);
    }
    prevConnectionsSize.current = connections.size;
  }, [connections.size]);

  // Auto-close create table wizard when navigating to a table view
  useEffect(() => {
    if (activeView.kind === 'table') {
      setShowCreateTable(false);
      setShowCreateView(false);
    }
  }, [activeView]);

  function renderMainContent() {
    switch (activeView.kind) {
      case 'welcome':
        return <WelcomeScreen onNewConnection={() => setShowConnectionForm(true)} />;
      case 'table':
        return (
          <TableDataGrid
            connectionId={activeView.connectionId}
            schema={activeView.schema}
            table={activeView.table}
            onModifyTable={() => setShowAlterTable(true)}
          />
        );
      case 'query':
        return <QueryEditor connectionId={activeView.connectionId} />;
      case 'erd':
        return <ERDCanvas connectionId={activeView.connectionId} />;
      case 'functions':
        return <FunctionsViewer connectionId={activeView.connectionId} />;
    }
  }

  const hasTabs = tabs.length > 0;

  return (
    <div style={styles.root}>
      <Sidebar
        onNewConnection={() => setShowConnectionForm(true)}
        onCreateTable={() => setShowCreateTable(true)}
        onCreateView={() => setShowCreateView(true)}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      />

      <main style={styles.main}>
        {/* ── Tab bar ── */}
        {hasTabs && (
          <div style={styles.tabBar}>
            {tabs.map(tab => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  style={{
                    ...styles.tab,
                    background: isActive ? 'var(--pp-bg)' : 'transparent',
                    borderBottom: isActive ? '2px solid var(--pp-accent)' : '2px solid transparent',
                    color: isActive ? 'var(--pp-text)' : 'var(--pp-text-muted)',
                  }}
                  onClick={() => setActiveView(tab.view)}
                >
                  <span style={styles.tabIcon}>{tab.icon}</span>
                  <span style={styles.tabLabel} title={tab.label}>{tab.label}</span>
                  <button
                    style={styles.tabClose}
                    onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                    title="Close tab"
                  >×</button>
                </div>
              );
            })}
          </div>
        )}

        {renderMainContent()}
      </main>

      {/* ── Modals ── */}
      {showConnectionForm && (
        <ConnectionForm onClose={() => setShowConnectionForm(false)} />
      )}

      {showCreateTable && activeView.kind !== 'welcome' && 'connectionId' in activeView && (
        <CreateTableWizard
          connectionId={activeView.connectionId}
          onClose={() => setShowCreateTable(false)}
        />
      )}

      {showCreateView && activeView.kind !== 'welcome' && 'connectionId' in activeView && (
        <CreateViewEditor
          connectionId={activeView.connectionId}
          onClose={() => setShowCreateView(false)}
        />
      )}

      {showAlterTable && activeView.kind === 'table' && (
        <AlterTableEditor
          connectionId={activeView.connectionId}
          schema={activeView.schema}
          table={activeView.table}
          onClose={() => setShowAlterTable(false)}
          onAltered={() => setShowAlterTable(false)}
        />
      )}

      {/* ── Toasts ── */}
      <ToastContainer />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--pp-bg)',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'stretch',
    background: 'var(--pp-bg-secondary)',
    borderBottom: '1px solid var(--pp-border)',
    flexShrink: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 10px',
    height: 32,
    cursor: 'pointer',
    fontSize: 12,
    flexShrink: 0,
    borderRight: '1px solid var(--pp-border)',
    minWidth: 80,
    maxWidth: 160,
  },
  tabIcon: { fontSize: 11, flexShrink: 0 },
  tabLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
  },
  tabClose: {
    background: 'transparent',
    border: 'none',
    color: 'var(--pp-text-muted)',
    cursor: 'pointer',
    padding: '0 2px',
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
    borderRadius: 2,
  },
};
