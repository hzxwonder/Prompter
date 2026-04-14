import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInitialState } from '../../src/shared/models';
import type { ExtensionToWebviewMessage } from '../../src/shared/messages';
import { App } from './App';
import { onMessage, postMessage } from './api/vscode';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// ─── Root wrapper ────────────────────────────────────────────────────────────
// Keeps initialState stable (only set once on hydrate) so that App's
// useEffect([initialState]) does NOT fire on every message and reset the store.

function Root() {
  const [initialState, setInitialState] = useState(() =>
    createInitialState(new Date().toISOString())
  );
  const [lastMessage, setLastMessage] = useState<ExtensionToWebviewMessage | undefined>();
  const [hydrated, setHydrated] = useState(false);

  // Subscribe to extension messages once on mount
  useState(() => {
    onMessage((message: ExtensionToWebviewMessage) => {
      if (message.type === 'hydrate') {
        // First hydrate: set the stable initialState and mark as ready
        setInitialState(message.payload);
        setHydrated(true);
      }
      // Every message: update lastMessage so App can react
      setLastMessage(message);
    });
  });

  if (!hydrated) return null;

  return <App initialState={initialState} lastMessage={lastMessage} />;
}

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <Root />
  </StrictMode>
);

postMessage({ type: 'ready' });
