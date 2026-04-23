import { useEffect, useRef, useState } from 'react';
import type { PromptCard, PrompterCommandId, PrompterState, PrompterView } from '../../src/shared/models';
import type { ExtensionToWebviewMessage } from '../../src/shared/messages';
import { postMessage } from './api/vscode';
import { initializeAudioPlayback, playBuiltinTone } from './lib/audioUtils';
import { DeleteConfirmOverlay } from './components/DeleteConfirmOverlay';
import { SidebarNav } from './components/SidebarNav';
import { ToastViewport } from './components/ToastViewport';
import { usePrompterStore } from './store/usePrompterStore';
import { WorkspacePage } from './pages/WorkspacePage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShortcutsPage } from './pages/ShortcutsPage';

export function App({
  initialState,
  lastMessage
}: {
  initialState: PrompterState;
  lastMessage?: ExtensionToWebviewMessage;
}) {
  const shouldCopyAfterManualSaveRef = useRef(false);
  const pendingShortcutSaveCommandRef = useRef<PrompterCommandId | null>(null);
  const [shortcutSaveState, setShortcutSaveState] = useState<{
    status: 'idle' | 'saving' | 'success' | 'error';
    command: PrompterCommandId | null;
    message?: string;
  }>({
    status: 'idle',
    command: null
  });
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const {
    state,
    workspaceDraft,
    toasts,
    lastSavedCardId,
    syncState,
    syncHistoryImport,
    setView,
    selectHistoryDate,
    updateSettings,
    updateWorkspaceDraft,
    insertImportedText,
    undoImport,
    markDraftSaved,
    moveCard,
    deleteCard,
    acknowledgeCompletion,
    renameGroup,
    showToast,
    dismissToast
  } = usePrompterStore(initialState);
  const workspaceCards = state.workspaceCards.length > 0 || state.cards.length === 0
    ? state.workspaceCards
    : state.cards;

  useEffect(() => {
    initializeAudioPlayback();
  }, []);

  useEffect(() => {
    if (lastMessage?.type === 'draft:saved') {
      markDraftSaved(lastMessage.payload.card as PromptCard, lastMessage.payload.state);
      if (shouldCopyAfterManualSaveRef.current) {
        shouldCopyAfterManualSaveRef.current = false;
        void navigator.clipboard.writeText(lastMessage.payload.card.content);
      }
    }

    if (lastMessage?.type === 'card:updated') {
      markDraftSaved(lastMessage.payload.card as PromptCard, lastMessage.payload.state);
      if (shouldCopyAfterManualSaveRef.current) {
        shouldCopyAfterManualSaveRef.current = false;
        void navigator.clipboard.writeText(lastMessage.payload.card.content);
      }
    }

    if (lastMessage?.type === 'composer:insertText') {
      insertImportedText(lastMessage.payload.text, lastMessage.payload.fileRefs, lastMessage.payload.insertAt);
    }

    if (lastMessage?.type === 'settings:shortcuts:update:success') {
      if (!pendingShortcutSaveCommandRef.current) {
        return;
      }
      updateSettings({ shortcuts: lastMessage.payload.shortcuts });
      setShortcutSaveState({
        status: 'success',
        command: pendingShortcutSaveCommandRef.current
      });
      pendingShortcutSaveCommandRef.current = null;
    }

    if (lastMessage?.type === 'settings:shortcuts:update:error') {
      if (!pendingShortcutSaveCommandRef.current) {
        return;
      }
      setShortcutSaveState({
        status: 'error',
        command: pendingShortcutSaveCommandRef.current,
        message: lastMessage.payload.message
      });
      pendingShortcutSaveCommandRef.current = null;
    }

    if (lastMessage?.type === 'audio:play') {
      playBuiltinTone(lastMessage.payload.tone);
    }

    if (lastMessage?.type === 'toast:show') {
      showToast(lastMessage.payload);
    }

    if (lastMessage?.type === 'cards:updated' || lastMessage?.type === 'modularPrompts:updated') {
      syncState(lastMessage.payload.state);
    }

    if (lastMessage?.type === 'state:replace') {
      syncState(lastMessage.payload);
    }

    if (lastMessage?.type === 'historyImport:updated') {
      syncHistoryImport(lastMessage.payload);
    }
  }, [insertImportedText, lastMessage, markDraftSaved, showToast, syncHistoryImport, syncState, updateSettings]);

  const handleViewChange = (view: PrompterView) => {
    if (view !== 'shortcuts') {
      setShortcutSaveState({
        status: 'idle',
        command: null
      });
    }

    setView(view);
    postMessage({ type: 'view:set', payload: { view } });
  };

  return (
    <div className="shell">
      <SidebarNav activeView={state.activeView} language={state.settings.language} onChange={handleViewChange} />
      <main className="content">
        {state.activeView === 'workspace' && (
          <WorkspacePage
            language={state.settings.language}
            cards={workspaceCards}
            draft={workspaceDraft}
            onDraftChange={updateWorkspaceDraft}
            onMoveCard={(cardId, nextStatus) => {
              moveCard(cardId, nextStatus);
              postMessage({ type: 'card:move', payload: { cardId, nextStatus } });
            }}
            onDeleteCard={(cardId) => {
              const target = state.cards.find((c) => c.id === cardId) ?? state.workspaceCards.find((c) => c.id === cardId);
              const isImported = target && target.sourceType !== 'manual' && target.sourceType !== 'cursor';
              if (isImported && !state.settings.suppressDeleteSessionConfirm) {
                setPendingDeleteIds((prev) => (prev.includes(cardId) ? prev : [...prev, cardId]));
                return;
              }
              deleteCard(cardId);
              postMessage({ type: 'card:delete', payload: { cardId } });
            }}
            onAcknowledgeCompletion={(cardId) => {
              acknowledgeCompletion(cardId);
              postMessage({ type: 'card:acknowledgeCompletion', payload: { cardId } });
            }}
            onRenameGroup={(groupId, nextName) => {
              renameGroup(groupId, nextName);
              postMessage({ type: 'group:rename', payload: { groupId, nextName } });
            }}
            onManualSubmit={() => {
              shouldCopyAfterManualSaveRef.current = true;
            }}
            onUndoImport={undoImport}
            lastSavedCardId={lastSavedCardId}
          />
        )}
        {state.activeView === 'history' && (
          <HistoryPage
            language={state.settings.language}
            historyImport={state.historyImport}
            dailyStats={state.dailyStats}
            cards={state.cards}
            selectedDate={state.selectedDate}
            onSelectDate={selectHistoryDate}
            onStartHistoryImport={() => {
              postMessage({ type: 'historyImport:start' });
            }}
            onPauseHistoryImport={() => {
              postMessage({ type: 'historyImport:pause' });
            }}
          />
        )}
        {state.activeView === 'settings' && (
          <SettingsPage
            settings={state.settings}
            onSettingsChange={(nextSettings) => {
              updateSettings(nextSettings);
              postMessage({ type: 'settings:update', payload: nextSettings });
            }}
            onDataDirSwitch={({ targetDir, migrate }) => {
              postMessage({ type: 'settings:dataDirSwitch', payload: { targetDir, migrate } });
            }}
            onClearCache={() => {
              postMessage({ type: 'cache:clear' });
            }}
          />
        )}
        {state.activeView === 'shortcuts' && (
          <ShortcutsPage
            settings={state.settings}
            saveState={shortcutSaveState}
            onSaveShortcuts={(command, shortcuts) => {
              pendingShortcutSaveCommandRef.current = command;
              setShortcutSaveState({
                status: 'saving',
                command
              });
              postMessage({ type: 'settings:update', payload: { shortcuts } });
            }}
          />
        )}
      </main>
      <ToastViewport
        toasts={toasts}
        onDismiss={dismissToast}
        onAction={(toast) => {
          if (toast.actionCommand === 'prompter.open') {
            handleViewChange('workspace');
          }
          dismissToast(toast.id);
        }}
      />
      {pendingDeleteIds.length > 0 && (
        <DeleteConfirmOverlay
          language={state.settings.language}
          count={pendingDeleteIds.length}
          onCancel={() => setPendingDeleteIds([])}
          onConfirm={() => {
            for (const id of pendingDeleteIds) {
              deleteCard(id);
              postMessage({ type: 'card:delete', payload: { cardId: id } });
            }
            setPendingDeleteIds([]);
          }}
          onConfirmAndSuppress={() => {
            const nextSettings = { suppressDeleteSessionConfirm: true };
            updateSettings(nextSettings);
            postMessage({ type: 'settings:update', payload: nextSettings });
            for (const id of pendingDeleteIds) {
              deleteCard(id);
              postMessage({ type: 'card:delete', payload: { cardId: id } });
            }
            setPendingDeleteIds([]);
          }}
        />
      )}
    </div>
  );
}
