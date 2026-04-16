import { useCallback, useMemo, useReducer } from 'react';
import type {
  ModularPrompt,
  PromptCard,
  PromptStatus,
  PrompterSettings,
  PrompterState,
  PrompterView
} from '../../../src/shared/models';
import type { PrompterToastMessage } from '../../../src/shared/messages';
import {
  createInitialStoreState,
  createPrompterStoreReducer,
  type WorkspaceDraft
} from './prompterReducer';

export function usePrompterStore(initialState: PrompterState) {
  const [store, dispatch] = useReducer(createPrompterStoreReducer(), initialState, createInitialStoreState);

  const replaceState = useCallback((nextState: PrompterState) => {
    dispatch({ type: 'state:replace', payload: nextState });
  }, []);

  const syncState = useCallback((nextState: PrompterState) => {
    dispatch({ type: 'state:sync', payload: nextState });
  }, []);

  const syncHistoryImport = useCallback((nextHistoryImport: PrompterState['historyImport']) => {
    dispatch({ type: 'historyImport:sync', payload: nextHistoryImport });
  }, []);

  const setView = useCallback((view: PrompterView) => {
    dispatch({ type: 'view:set', payload: { view } });
  }, []);

  const selectHistoryDate = useCallback((date: string) => {
    dispatch({ type: 'history:selectDate', payload: { date } });
  }, []);

  const updateSettings = useCallback((nextSettings: Partial<PrompterSettings>) => {
    dispatch({ type: 'settings:update', payload: nextSettings });
  }, []);

  const updateWorkspaceDraft = useCallback((nextDraft: Partial<WorkspaceDraft>) => {
    dispatch({ type: 'workspace:draftChanged', payload: nextDraft });
  }, []);

  const insertImportedText = useCallback((text: string, fileRefs?: WorkspaceDraft['fileRefs'], insertAt?: number) => {
    dispatch({ type: 'workspace:insertImport', payload: { text, fileRefs, insertAt } });
  }, []);

  const markDraftSaved = useCallback((card: PromptCard, state: PrompterState) => {
    dispatch({ type: 'workspace:draftSaved', payload: { card, state } });
  }, []);

  const moveCard = useCallback((cardId: string, nextStatus: PromptStatus) => {
    dispatch({ type: 'card:move', payload: { cardId, nextStatus } });
  }, []);

  const deleteCard = useCallback((cardId: string) => {
    dispatch({ type: 'card:delete', payload: { cardId } });
  }, []);

  const acknowledgeCompletion = useCallback((cardId: string) => {
    dispatch({ type: 'card:acknowledgeCompletion', payload: { cardId } });
  }, []);

  const renameGroup = useCallback((groupId: string, nextName: string) => {
    dispatch({ type: 'group:rename', payload: { groupId, nextName } });
  }, []);

  const saveModularPrompt = useCallback((prompt: ModularPrompt) => {
    dispatch({ type: 'modularPrompt:save', payload: prompt });
  }, []);

  const showToast = useCallback((toast: PrompterToastMessage) => {
    dispatch({ type: 'toast:show', payload: toast });
  }, []);

  const dismissToast = useCallback((id: string) => {
    dispatch({ type: 'toast:dismiss', payload: { id } });
  }, []);

  return useMemo(
    () => ({
      state: store.state,
      workspaceDraft: store.workspaceDraft,
      toasts: store.toasts,
      lastSavedCardId: store.lastSavedCardId,
      replaceState,
      syncState,
      syncHistoryImport,
      setView,
      selectHistoryDate,
      updateSettings,
      updateWorkspaceDraft,
      insertImportedText,
      markDraftSaved,
      moveCard,
      deleteCard,
      acknowledgeCompletion,
      renameGroup,
      saveModularPrompt,
      showToast,
      dismissToast
    }),
    [
      insertImportedText,
      acknowledgeCompletion,
      deleteCard,
      dismissToast,
      markDraftSaved,
      moveCard,
      renameGroup,
      replaceState,
      saveModularPrompt,
      setView,
      showToast,
      selectHistoryDate,
      store,
      syncState,
      syncHistoryImport,
      updateSettings,
      updateWorkspaceDraft
    ]
  );
}
