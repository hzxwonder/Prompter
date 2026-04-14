import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../../src/shared/messages';

type VsCodeApi = {
  postMessage(message: WebviewToExtensionMessage): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

// acquireVsCodeApi() may only be called ONCE — cache the result immediately.
let _api: VsCodeApi | undefined;
function getVsCodeApi(): VsCodeApi | undefined {
  if (!_api) {
    _api = window.acquireVsCodeApi?.();
  }
  return _api;
}

// Call once at module load so the instance is ready before any component renders.
getVsCodeApi();

export function postMessage(message: WebviewToExtensionMessage): void {
  getVsCodeApi()?.postMessage(message);
}

export function onMessage(listener: (message: ExtensionToWebviewMessage) => void): () => void {
  const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
    listener(event.data);
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}
