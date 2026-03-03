import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { MessageToExtension, MessageToWebview } from '../types';
import type { DatabaseService } from '../services/DatabaseService';
import type { CredentialService } from '../services/CredentialService';
import type { ConnectionTreeProvider } from './ConnectionTreeProvider';

export class MainWebviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;

  constructor(
    context: vscode.ExtensionContext,
    private readonly dbService: DatabaseService,
    private readonly credService: CredentialService,
    private readonly treeProvider: ConnectionTreeProvider
  ) {
    this.extensionUri = context.extensionUri;
  }

  // ─── Open / reveal panel ─────────────────────────────────────────────────

  open(initialConnectionId?: string): void {
    if (this.panel) {
      this.panel.reveal();
      if (initialConnectionId) {
        this.sendMessage({ type: 'connections', payload: this.credService.getConnections() });
      }
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'postprettify',
      'PostPrettify',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist')],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.svg');
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg: MessageToExtension) => {
      this.handleMessage(msg);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Send saved connections after webview is ready
    setTimeout(() => {
      this.sendMessage({ type: 'connections', payload: this.credService.getConnections() });
    }, 300);
  }

  // ─── Message handler ─────────────────────────────────────────────────────

  private async handleMessage(msg: MessageToExtension): Promise<void> {
    try {
      switch (msg.command) {
        case 'connect': {
          const { password, ...config } = msg.payload;
          await this.credService.saveConnection(config, password);
          this.treeProvider.refresh();

          const schemas = await this.dbService.connect(msg.payload);
          this.treeProvider.setConnected(config.id, config, schemas);
          this.sendMessage({ type: 'connected', payload: { connection: config, schemas } });
          break;
        }

        case 'disconnect': {
          const { connectionId } = msg.payload;
          await this.dbService.disconnect(connectionId);
          this.treeProvider.setDisconnected(connectionId);
          this.sendMessage({ type: 'disconnected', payload: { connectionId } });
          break;
        }

        case 'getConnections': {
          this.sendMessage({ type: 'connections', payload: this.credService.getConnections() });
          break;
        }

        case 'fetchTables': {
          const schemas = await this.dbService.fetchSchemas(msg.payload.connectionId);
          const conn = this.credService.getConnections().find(c => c.id === msg.payload.connectionId);
          if (conn) {
            this.treeProvider.setConnected(conn.id, conn, schemas);
            this.sendMessage({ type: 'connected', payload: { connection: conn, schemas } });
          }
          break;
        }

        case 'fetchTableData': {
          const { connectionId, schema, table, page, pageSize, sort, filters } = msg.payload;
          const data = await this.dbService.fetchTableData(connectionId, schema, table, page, pageSize, sort, filters);
          this.sendMessage({ type: 'tableData', payload: { ...data, schema, table } });
          break;
        }

        case 'fetchColumns': {
          const { connectionId, schema, table } = msg.payload;
          const columns = await this.dbService.fetchColumns(connectionId, schema, table);
          this.sendMessage({ type: 'columns', payload: { schema, table, columns } });
          break;
        }

        case 'insertRow': {
          const { connectionId, schema, table, row } = msg.payload;
          const inserted = await this.dbService.insertRow(connectionId, schema, table, row);
          this.sendMessage({ type: 'rowInserted', payload: { schema, table, row: inserted } });
          break;
        }

        case 'updateRow': {
          const { connectionId, schema, table, primaryKey, changes } = msg.payload;
          await this.dbService.updateRow(connectionId, schema, table, primaryKey, changes);
          this.sendMessage({ type: 'rowUpdated', payload: { schema, table } });
          break;
        }

        case 'deleteRow': {
          const { connectionId, schema, table, primaryKey } = msg.payload;
          await this.dbService.deleteRow(connectionId, schema, table, primaryKey);
          this.sendMessage({ type: 'rowDeleted', payload: { schema, table } });
          break;
        }

        case 'executeQuery': {
          const { connectionId, sql } = msg.payload;
          const result = await this.dbService.executeQuery(connectionId, sql);
          this.sendMessage({ type: 'queryResult', payload: result });
          break;
        }

        case 'explainQuery': {
          const { connectionId, sql } = msg.payload;
          const plan = await this.dbService.explainQuery(connectionId, sql);
          this.sendMessage({ type: 'explainResult', payload: { plan } });
          break;
        }

        case 'fetchForeignKeys': {
          const { connectionId } = msg.payload;
          const fks = await this.dbService.fetchForeignKeys(connectionId);
          this.sendMessage({ type: 'foreignKeys', payload: fks });
          break;
        }

        case 'fetchIndexes': {
          const { connectionId, schema, table } = msg.payload;
          const indexes = await this.dbService.fetchIndexes(connectionId, schema, table);
          this.sendMessage({ type: 'indexes', payload: { schema, table, indexes } });
          break;
        }

        case 'createIndex': {
          const { connectionId, schema, table, name, columns, isUnique } = msg.payload;
          await this.dbService.createIndex(connectionId, schema, table, name, columns, isUnique);
          const indexes = await this.dbService.fetchIndexes(connectionId, schema, table);
          this.sendMessage({ type: 'indexes', payload: { schema, table, indexes } });
          break;
        }

        case 'dropIndex': {
          const { connectionId, schema, indexName } = msg.payload;
          // Extract table name from index to refresh
          await this.dbService.dropIndex(connectionId, schema, indexName);
          break;
        }

        case 'fetchFunctions': {
          const { connectionId } = msg.payload;
          const functions = await this.dbService.fetchFunctions(connectionId);
          this.sendMessage({ type: 'functions', payload: functions });
          break;
        }

        case 'createSchema': {
          const { connectionId, name } = msg.payload;
          await this.dbService.createSchema(connectionId, name);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) this.treeProvider.setConnected(conn.id, conn, schemas);
          this.sendMessage({ type: 'schemaCreated', payload: { name, schemas } });
          break;
        }

        case 'dropSchema': {
          const { connectionId, name, cascade } = msg.payload;
          await this.dbService.dropSchema(connectionId, name, cascade);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) this.treeProvider.setConnected(conn.id, conn, schemas);
          this.sendMessage({ type: 'schemaDropped', payload: { name, schemas } });
          break;
        }

        case 'createView': {
          const { connectionId, schema, name, definition } = msg.payload;
          await this.dbService.createView(connectionId, schema, name, definition);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) this.treeProvider.setConnected(conn.id, conn, schemas);
          this.sendMessage({ type: 'viewCreated', payload: { schema, name, schemas } });
          break;
        }

        case 'dropView': {
          const { connectionId, schema, name } = msg.payload;
          await this.dbService.dropView(connectionId, schema, name);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) this.treeProvider.setConnected(conn.id, conn, schemas);
          this.sendMessage({ type: 'viewDropped', payload: { schema, name, schemas } });
          break;
        }

        case 'importRows': {
          const { connectionId, schema, table, rows } = msg.payload;
          const count = await this.dbService.importRows(connectionId, schema, table, rows);
          this.sendMessage({ type: 'rowsImported', payload: { schema, table, count } });
          break;
        }

        case 'reconnect': {
          const { connectionId } = msg.payload;
          const config = this.credService.getConnections().find(c => c.id === connectionId);
          if (!config) throw new Error(`Connection ${connectionId} not found`);
          const password = await this.credService.getPassword(connectionId) ?? '';
          const schemas = await this.dbService.connect({ ...config, password });
          this.treeProvider.setConnected(config.id, config, schemas);
          this.sendMessage({ type: 'connected', payload: { connection: config, schemas } });
          break;
        }

        case 'deleteConnection': {
          const { connectionId } = msg.payload;
          await this.dbService.disconnect(connectionId);
          await this.credService.removeConnection(connectionId);
          this.treeProvider.setDisconnected(connectionId);
          this.treeProvider.refresh();
          this.sendMessage({ type: 'connections', payload: this.credService.getConnections() });
          break;
        }

        case 'createTable': {
          const { connectionId, definition } = msg.payload;
          await this.dbService.createTable(connectionId, definition);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) {
            this.treeProvider.setConnected(conn.id, conn, schemas);
          }
          this.sendMessage({ type: 'tableCreated', payload: { schema: definition.schema, table: definition.name, schemas } });
          break;
        }

        case 'alterTable': {
          const { connectionId, schema, table, ops } = msg.payload;
          const finalName = await this.dbService.alterTable(connectionId, schema, table, ops);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const columns = await this.dbService.fetchColumns(connectionId, schema, finalName);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) this.treeProvider.setConnected(conn.id, conn, schemas);
          this.sendMessage({
            type: 'tableAltered',
            payload: {
              schema,
              table,
              newTableName: finalName !== table ? finalName : undefined,
              columns,
              schemas,
            },
          });
          // If FK ops were applied, send refreshed foreign key list so ERD auto-updates
          const hasFKOp = ops.some(op => op.op === 'addForeignKey' || op.op === 'dropForeignKey');
          if (hasFKOp) {
            const fks = await this.dbService.fetchForeignKeys(connectionId);
            this.sendMessage({ type: 'foreignKeys', payload: fks });
          }
          break;
        }

        case 'dropTable': {
          const { connectionId, schema, table } = msg.payload;
          await this.dbService.dropTable(connectionId, schema, table);
          const schemas = await this.dbService.fetchSchemas(connectionId);
          const conn = this.credService.getConnections().find(c => c.id === connectionId);
          if (conn) {
            this.treeProvider.setConnected(conn.id, conn, schemas);
          }
          this.sendMessage({ type: 'tableDropped', payload: { schema, table, schemas } });
          break;
        }

        case 'getQueryHistory': {
          const history = this.credService.getQueryHistory();
          this.sendMessage({ type: 'queryHistory', payload: history });
          break;
        }

        case 'saveQueryToHistory': {
          await this.credService.saveQueryToHistory(msg.payload);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendMessage({ type: 'error', payload: { message, command: msg.command } });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  sendMessage(msg: MessageToWebview): void {
    this.panel?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const distPath = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist');

    const indexPath = path.join(distPath.fsPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return this.getDevPlaceholderHtml();
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    html = html.replace(/(src|href)="([^"]+)"/g, (match, attr, value) => {
      if (value.startsWith('http') || value.startsWith('//')) return match;
      const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, value));
      return `${attr}="${assetUri}"`;
    });

    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    html = html.replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
    );

    html = html.replace(/<script /g, `<script nonce="${nonce}" `);

    return html;
  }

  private getDevPlaceholderHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
    .msg { text-align:center; opacity:0.6; }
    code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="msg">
    <h2>PostPrettify</h2>
    <p>WebView not built yet. Run <code>npm run build:webview</code></p>
  </div>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
