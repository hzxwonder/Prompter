import { useEffect, useRef, useState } from 'react';
import type { PromptCard, PrompterCommandId, PrompterState, PrompterView } from '../../src/shared/models';
import type { ExtensionToWebviewMessage } from '../../src/shared/messages';
import { postMessage } from './api/vscode';
import { playBuiltinTone } from './lib/audioUtils';
import { SidebarNav } from './components/SidebarNav';
import { usePrompterStore } from './store/usePrompterStore';
import { WorkspacePage } from './pages/WorkspacePage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShortcutsPage } from './pages/ShortcutsPage';

function hasDraftContent(draft: { title: string; content: string }): boolean {
  return Boolean(draft.title.trim() || draft.content.trim());
}

function buildAutosavePayload(draft: { title: string; content: string; fileRefs: PrompterState['cards'][number]['fileRefs'] }) {
  return {
    title: draft.title.trim(),
    content: draft.content,
    fileRefs: draft.fileRefs
  };
}

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
  const {
    state,
    workspaceDraft,
    lastSavedCardId,
    syncState,
    setView,
    selectHistoryDate,
    updateSettings,
    updateWorkspaceDraft,
    insertImportedText,
    markDraftSaved,
    moveCard,
    deleteCard,
    acknowledgeCompletion,
    renameGroup
  } = usePrompterStore(initialState);
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

    if (lastMessage?.type === 'cards:updated' || lastMessage?.type === 'modularPrompts:updated') {
      syncState(lastMessage.payload.state);
    }

    if (lastMessage?.type === 'state:replace') {
      syncState(lastMessage.payload);
    }
  }, [insertImportedText, lastMessage, markDraftSaved, syncState, updateSettings]);

  const handleViewChange = (view: PrompterView) => {
    if (view !== 'shortcuts') {
      setShortcutSaveState({
        status: 'idle',
        command: null
      });
    }

    if (state.activeView === 'workspace' && view !== 'workspace' && hasDraftContent(workspaceDraft)) {
      shouldCopyAfterManualSaveRef.current = false;
      if (workspaceDraft.editingCardId && workspaceDraft.editingCardStatus === 'unused') {
        postMessage({
          type: 'card:update',
          payload: { cardId: workspaceDraft.editingCardId, ...buildAutosavePayload(workspaceDraft) }
        });
      } else {
        postMessage({ type: 'draft:autosave', payload: buildAutosavePayload(workspaceDraft) });
      }
      // 立即清空草稿，防止用户多次点击导航时重复将同一内容保存到未使用分区。
      // 内容已保存为卡片，用户可在未使用泳道中双击卡片继续编辑。
      updateWorkspaceDraft({
        title: '',
        content: '',
        fileRefs: [],
        editingCardId: undefined,
        editingCardStatus: undefined,
        cursorIndex: undefined
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
            cards={state.cards}
            draft={workspaceDraft}
            onDraftChange={updateWorkspaceDraft}
            onMoveCard={(cardId, nextStatus) => {
              moveCard(cardId, nextStatus);
              postMessage({ type: 'card:move', payload: { cardId, nextStatus } });
            }}
            onDeleteCard={(cardId) => {
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
            lastSavedCardId={lastSavedCardId}
          />
        )}
        {state.activeView === 'history' && (
          <HistoryPage
            language={state.settings.language}
            dailyStats={state.dailyStats}
            cards={state.cards}
            selectedDate={state.selectedDate}
            onSelectDate={selectHistoryDate}
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
    </div>
  );
}
