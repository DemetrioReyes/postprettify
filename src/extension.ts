import * as vscode from 'vscode';
import { DatabaseService } from './services/DatabaseService';
import { CredentialService } from './services/CredentialService';
import { ConnectionTreeProvider } from './providers/ConnectionTreeProvider';
import { MainWebviewProvider } from './providers/MainWebviewProvider';

export function activate(context: vscode.ExtensionContext) {
  // ─── Services ────────────────────────────────────────────────────────────
  const dbService = new DatabaseService();
  const credService = new CredentialService(context.secrets, context.globalState);

  // ─── Tree provider (sidebar) ─────────────────────────────────────────────
  const treeProvider = new ConnectionTreeProvider(() => credService.getConnections());
  const treeView = vscode.window.createTreeView('postprettify.connectionExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ─── Webview provider ────────────────────────────────────────────────────
  const webviewProvider = new MainWebviewProvider(context, dbService, credService, treeProvider);

  // ─── Commands ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('postprettify.openPanel', (connectionId?: string) => {
      webviewProvider.open(connectionId);
    }),

    vscode.commands.registerCommand('postprettify.addConnection', () => {
      webviewProvider.open();
    }),

    vscode.commands.registerCommand('postprettify.removeConnection', async (item) => {
      const connectionId: string = item?.connectionId;
      if (!connectionId) return;

      const conn = credService.getConnections().find(c => c.id === connectionId);
      if (!conn) return;

      const answer = await vscode.window.showWarningMessage(
        `Remove connection "${conn.name}"?`,
        { modal: true },
        'Remove'
      );

      if (answer === 'Remove') {
        await dbService.disconnect(connectionId);
        await credService.removeConnection(connectionId);
        treeProvider.setDisconnected(connectionId);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('postprettify.refreshConnections', () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('postprettify.openTable', (connectionId: string, schema: string, table: string) => {
      webviewProvider.open();
      // Give webview time to mount, then send openTable message
      setTimeout(() => {
        webviewProvider.sendMessage({
          type: 'tableData',
          payload: {
            rows: [],
            totalCount: 0,
            page: 1,
            pageSize: 50,
            schema,
            table,
          },
        });
        // Trigger data load by sending fetchTableData after mount
        webviewProvider.sendMessage({
          type: 'connected',
          payload: {
            connection: credService.getConnections().find(c => c.id === connectionId)!,
            schemas: [],
          },
        });
      }, 500);
    }),

    treeView
  );

  // ─── Cleanup on deactivation ─────────────────────────────────────────────
  context.subscriptions.push({
    dispose: () => dbService.disconnectAll(),
  });
}

export function deactivate() {
  // Pool cleanup is handled in subscriptions above
}
