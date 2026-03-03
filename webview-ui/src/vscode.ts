/**
 * Singleton wrapper for acquireVsCodeApi().
 * Must be called only once per WebView lifetime.
 */
import type { MessageToExtension } from '../../src/types';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let api: ReturnType<typeof acquireVsCodeApi> | null = null;

function getVsCodeApi() {
  if (!api) {
    // In the VS Code WebView context acquireVsCodeApi is available globally
    if (typeof acquireVsCodeApi !== 'undefined') {
      api = acquireVsCodeApi();
    }
  }
  return api;
}

export function postMessage(msg: MessageToExtension): void {
  getVsCodeApi()?.postMessage(msg);
}

export function isVSCode(): boolean {
  return typeof acquireVsCodeApi !== 'undefined';
}
