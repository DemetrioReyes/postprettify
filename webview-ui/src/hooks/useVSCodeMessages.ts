import { useEffect } from 'react';
import { useStore } from '../store';
import { postMessage } from '../vscode';
import type { MessageToWebview } from '../../../src/types';

/**
 * Listens to messages from the VS Code extension host and updates the store.
 */
export function useVSCodeMessages() {
  const {
    addConnection,
    removeConnection,
    setSavedConnections,
    setTableData,
    setColumns,
    setIndexes,
    setFunctions,
    setForeignKeys,
    setQueryResult,
    setExplainResult,
    setQueryHistory,
    setLoading,
    setError,
    setActiveView,
    addToast,
  } = useStore();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as MessageToWebview;

      switch (msg.type) {
        case 'connections':
          setSavedConnections(msg.payload);
          break;

        case 'connected': {
          const { connection, schemas } = msg.payload;
          addConnection(connection, schemas);
          setLoading(false);
          setError(null);
          addToast(`Connected to ${connection.name}`, 'success');
          // Auto-open the first table found, or query editor if no tables
          const firstTable = schemas
            .flatMap(s => s.tables.filter(t => t.type === 'table').map(t => ({ schema: s.name, table: t.name })))
            [0];
          if (firstTable) {
            setActiveView({ kind: 'table', connectionId: connection.id, schema: firstTable.schema, table: firstTable.table });
            postMessage({ command: 'fetchTableData', payload: { connectionId: connection.id, schema: firstTable.schema, table: firstTable.table, page: 1, pageSize: 50 } });
            postMessage({ command: 'fetchColumns', payload: { connectionId: connection.id, schema: firstTable.schema, table: firstTable.table } });
          } else {
            setActiveView({ kind: 'query', connectionId: connection.id });
          }
          break;
        }

        case 'disconnected':
          removeConnection(msg.payload.connectionId);
          setActiveView({ kind: 'welcome' });
          break;

        case 'tableData': {
          const { schema, table, ...data } = msg.payload;
          setTableData(schema, table, data);
          setLoading(false);
          break;
        }

        case 'columns':
          setColumns(msg.payload.schema, msg.payload.table, msg.payload.columns);
          break;

        case 'indexes':
          setIndexes(msg.payload.schema, msg.payload.table, msg.payload.indexes);
          break;

        case 'functions':
          setFunctions(msg.payload);
          setLoading(false);
          break;

        case 'foreignKeys':
          setForeignKeys(msg.payload);
          setLoading(false);
          break;

        case 'queryResult':
          setQueryResult(msg.payload);
          setLoading(false);
          break;

        case 'explainResult':
          setExplainResult(msg.payload.plan);
          setLoading(false);
          break;

        case 'queryHistory':
          setQueryHistory(msg.payload);
          break;

        case 'rowInserted':
          setLoading(false);
          addToast('Row inserted', 'success');
          break;

        case 'rowUpdated':
          setLoading(false);
          addToast('Row updated', 'success');
          break;

        case 'rowDeleted':
          setLoading(false);
          addToast('Row deleted', 'success');
          break;

        case 'rowsImported':
          setLoading(false);
          addToast(`Imported ${msg.payload.count} rows into ${msg.payload.table}`, 'success');
          break;

        case 'tableAltered': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) addConnection(connInfo.config, msg.payload.schemas);
          setColumns(msg.payload.schema, msg.payload.newTableName ?? msg.payload.table, msg.payload.columns);
          setLoading(false);
          setError(null);
          addToast('Table altered successfully', 'success');
          const finalTable = msg.payload.newTableName ?? msg.payload.table;
          setActiveView({ kind: 'table', connectionId: connId, schema: msg.payload.schema, table: finalTable });
          postMessage({ command: 'fetchTableData', payload: { connectionId: connId, schema: msg.payload.schema, table: finalTable, page: 1, pageSize: 50 } });
          break;
        }

        case 'tableCreated': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) {
            addConnection(connInfo.config, msg.payload.schemas);
          }
          setLoading(false);
          setError(null);
          addToast(`Table "${msg.payload.table}" created`, 'success');
          setActiveView({ kind: 'table', connectionId: connId, schema: msg.payload.schema, table: msg.payload.table });
          postMessage({ command: 'fetchTableData', payload: { connectionId: connId, schema: msg.payload.schema, table: msg.payload.table, page: 1, pageSize: 50 } });
          postMessage({ command: 'fetchColumns', payload: { connectionId: connId, schema: msg.payload.schema, table: msg.payload.table } });
          break;
        }

        case 'tableDropped': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) {
            addConnection(connInfo.config, msg.payload.schemas);
          }
          setLoading(false);
          addToast(`Table "${msg.payload.table}" dropped`, 'info');
          setActiveView({ kind: 'query', connectionId: connId });
          break;
        }

        case 'schemaCreated': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) addConnection(connInfo.config, msg.payload.schemas);
          addToast(`Schema "${msg.payload.name}" created`, 'success');
          break;
        }

        case 'schemaDropped': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) addConnection(connInfo.config, msg.payload.schemas);
          addToast(`Schema "${msg.payload.name}" dropped`, 'info');
          break;
        }

        case 'viewCreated': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) addConnection(connInfo.config, msg.payload.schemas);
          setLoading(false);
          addToast(`View "${msg.payload.name}" created`, 'success');
          break;
        }

        case 'viewDropped': {
          const state = useStore.getState();
          const cur = state.activeView;
          const connId = cur.kind !== 'welcome' && 'connectionId' in cur ? cur.connectionId : '';
          const connInfo = state.connections.get(connId);
          if (connInfo) addConnection(connInfo.config, msg.payload.schemas);
          addToast(`View "${msg.payload.name}" dropped`, 'info');
          break;
        }

        case 'error':
          setError(msg.payload.message);
          setLoading(false);
          addToast(msg.payload.message, 'error');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addConnection, removeConnection, setSavedConnections, setTableData, setColumns,
      setIndexes, setFunctions, setForeignKeys, setQueryResult, setExplainResult,
      setQueryHistory, setLoading, setError, setActiveView, addToast]);
}
