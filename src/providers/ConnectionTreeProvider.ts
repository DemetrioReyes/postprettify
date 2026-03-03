import * as vscode from 'vscode';
import type { ConnectionConfig, SchemaInfo, TableInfo } from '../types';

// ─── Tree item types ─────────────────────────────────────────────────────────

type NodeKind = 'connection' | 'schema' | 'tablesGroup' | 'table' | 'viewsGroup';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: NodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly connectionId?: string,
    public readonly schemaName?: string,
    public readonly tableName?: string
  ) {
    super(label, collapsibleState);
    this.contextValue = kind;
    this.applyIcon(kind);
  }

  private applyIcon(kind: NodeKind) {
    switch (kind) {
      case 'connection':
        this.iconPath = new vscode.ThemeIcon('database');
        break;
      case 'schema':
        this.iconPath = new vscode.ThemeIcon('folder');
        break;
      case 'tablesGroup':
      case 'viewsGroup':
        this.iconPath = new vscode.ThemeIcon('list-unordered');
        break;
      case 'table':
        this.iconPath = new vscode.ThemeIcon('table');
        break;
    }
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** connectionId → schemas (populated after successful connect) */
  private connectedSchemas = new Map<string, SchemaInfo[]>();
  /** connectionId → config */
  private connectionConfigs = new Map<string, ConnectionConfig>();

  constructor(private getConnections: () => ConnectionConfig[]) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setConnected(connectionId: string, config: ConnectionConfig, schemas: SchemaInfo[]): void {
    this.connectedSchemas.set(connectionId, schemas);
    this.connectionConfigs.set(connectionId, config);
    this.refresh();
  }

  setDisconnected(connectionId: string): void {
    this.connectedSchemas.delete(connectionId);
    this.connectionConfigs.delete(connectionId);
    this.refresh();
  }

  // ─── TreeDataProvider impl ───────────────────────────────────────────────

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionTreeItem): ConnectionTreeItem[] {
    if (!element) {
      return this.getRootNodes();
    }
    switch (element.kind) {
      case 'connection':
        return this.getSchemaNodes(element.connectionId!);
      case 'schema':
        return this.getSchemaGroupNodes(element.connectionId!, element.schemaName!);
      case 'tablesGroup':
        return this.getTableNodes(element.connectionId!, element.schemaName!, 'table');
      case 'viewsGroup':
        return this.getTableNodes(element.connectionId!, element.schemaName!, 'view');
      default:
        return [];
    }
  }

  private getRootNodes(): ConnectionTreeItem[] {
    return this.getConnections().map(conn => {
      const isConnected = this.connectedSchemas.has(conn.id);
      const item = new ConnectionTreeItem(
        'connection',
        conn.name,
        isConnected
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
        conn.id
      );
      item.description = `${conn.host}:${conn.port}/${conn.database}`;
      item.tooltip = isConnected ? 'Connected' : 'Click to connect';
      item.command = isConnected
        ? undefined
        : {
            command: 'postprettify.openPanel',
            title: 'Open Panel',
            arguments: [conn.id],
          };
      return item;
    });
  }

  private getSchemaNodes(connectionId: string): ConnectionTreeItem[] {
    const schemas = this.connectedSchemas.get(connectionId) ?? [];
    return schemas.map(
      s =>
        new ConnectionTreeItem(
          'schema',
          s.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          connectionId,
          s.name
        )
    );
  }

  private getSchemaGroupNodes(connectionId: string, schemaName: string): ConnectionTreeItem[] {
    const schemas = this.connectedSchemas.get(connectionId) ?? [];
    const schema = schemas.find(s => s.name === schemaName);
    if (!schema) return [];

    const hasTables = schema.tables.some(t => t.type === 'table');
    const hasViews = schema.tables.some(t => t.type === 'view');
    const items: ConnectionTreeItem[] = [];

    if (hasTables) {
      const tablesCount = schema.tables.filter(t => t.type === 'table').length;
      const item = new ConnectionTreeItem(
        'tablesGroup',
        'Tables',
        vscode.TreeItemCollapsibleState.Collapsed,
        connectionId,
        schemaName
      );
      item.description = `(${tablesCount})`;
      items.push(item);
    }

    if (hasViews) {
      const viewsCount = schema.tables.filter(t => t.type === 'view').length;
      const item = new ConnectionTreeItem(
        'viewsGroup',
        'Views',
        vscode.TreeItemCollapsibleState.Collapsed,
        connectionId,
        schemaName
      );
      item.description = `(${viewsCount})`;
      items.push(item);
    }

    return items;
  }

  private getTableNodes(connectionId: string, schemaName: string, type: 'table' | 'view'): ConnectionTreeItem[] {
    const schemas = this.connectedSchemas.get(connectionId) ?? [];
    const schema = schemas.find(s => s.name === schemaName);
    if (!schema) return [];

    return schema.tables
      .filter(t => t.type === type)
      .map(t => {
        const item = new ConnectionTreeItem(
          'table',
          t.name,
          vscode.TreeItemCollapsibleState.None,
          connectionId,
          schemaName,
          t.name
        );
        item.command = {
          command: 'postprettify.openTable',
          title: 'Open Table',
          arguments: [connectionId, schemaName, t.name],
        };
        return item;
      });
  }
}
