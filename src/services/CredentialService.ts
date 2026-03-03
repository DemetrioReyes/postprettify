import * as vscode from 'vscode';
import type { ConnectionConfig, QueryHistoryEntry } from '../types';

const CONNECTIONS_KEY = 'postprettify.connections';
const QUERY_HISTORY_KEY = 'postprettify.queryHistory';
const MAX_HISTORY = 100;

export class CredentialService {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento
  ) {}

  // ─── Connections (stored in globalState, no passwords) ──────────────────

  getConnections(): ConnectionConfig[] {
    return this.globalState.get<ConnectionConfig[]>(CONNECTIONS_KEY, []);
  }

  async saveConnection(config: ConnectionConfig, password: string): Promise<void> {
    const connections = this.getConnections();
    const existingIndex = connections.findIndex(c => c.id === config.id);
    if (existingIndex >= 0) {
      connections[existingIndex] = config;
    } else {
      connections.push(config);
    }
    await this.globalState.update(CONNECTIONS_KEY, connections);
    await this.secrets.store(this.passwordKey(config.id), password);
  }

  async removeConnection(id: string): Promise<void> {
    const connections = this.getConnections().filter(c => c.id !== id);
    await this.globalState.update(CONNECTIONS_KEY, connections);
    await this.secrets.delete(this.passwordKey(id));
  }

  async getPassword(connectionId: string): Promise<string | undefined> {
    return this.secrets.get(this.passwordKey(connectionId));
  }

  private passwordKey(id: string): string {
    return `postprettify.password.${id}`;
  }

  // ─── Query history ───────────────────────────────────────────────────────

  getQueryHistory(): QueryHistoryEntry[] {
    return this.globalState.get<QueryHistoryEntry[]>(QUERY_HISTORY_KEY, []);
  }

  async saveQueryToHistory(entry: QueryHistoryEntry): Promise<void> {
    const history = this.getQueryHistory();
    // Prepend; deduplicate consecutive identical SQL
    if (history[0]?.sql === entry.sql) return;
    const next = [entry, ...history].slice(0, MAX_HISTORY);
    await this.globalState.update(QUERY_HISTORY_KEY, next);
  }

  async clearQueryHistory(): Promise<void> {
    await this.globalState.update(QUERY_HISTORY_KEY, []);
  }
}
