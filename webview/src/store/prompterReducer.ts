import type { FileRef, ModularPrompt, PromptCard, PromptStatus, PrompterSettings, PrompterState } from '../../../src/shared/models';

// Must stay in sync with the same palette in PromptRepository.ts
const GROUP_COLORS = [
  '#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#f97316',
  '#eab308','#22c55e','#10b981','#14b8a6','#06b6d4','#3b82f6',
  '#0ea5e9','#84cc16','#f59e0b','#ef4444'
];
function groupColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

export interface WorkspaceDraft {
  title: string;
  content: string;
  fileRefs: FileRef[];
  editingCardId?: string;
  editingCardStatus?: PromptStatus;
  cursorIndex?: number;
}

type PrompterAction =
  | { type: 'state:replace'; payload: PrompterState }
  | { type: 'state:sync'; payload: PrompterState }
  | { type: 'view:set'; payload: { view: PrompterState['activeView'] } }
  | { type: 'history:selectDate'; payload: { date: string } }
  | { type: 'settings:update'; payload: Partial<PrompterSettings> }
  | { type: 'workspace:draftChanged'; payload: Partial<WorkspaceDraft> }
  | { type: 'workspace:insertImport'; payload: { text: string; fileRefs?: FileRef[]; insertAt?: number } }
  | { type: 'workspace:draftSaved'; payload: { card: PromptCard; state: PrompterState } }
  | { type: 'card:move'; payload: { cardId: string; nextStatus: PromptStatus } }
  | { type: 'card:delete'; payload: { cardId: string } }
  | { type: 'card:acknowledgeCompletion'; payload: { cardId: string } }
  | { type: 'group:rename'; payload: { groupId: string; nextName: string } }
  | { type: 'modularPrompt:save'; payload: ModularPrompt };

export interface PrompterStoreState {
  state: PrompterState;
  workspaceDraft: WorkspaceDraft;
  lastSavedCardId?: string;
}

function createDraftFromState(_: PrompterState): WorkspaceDraft {
  return {
    title: '',
    content: '',
    fileRefs: [],
    editingCardId: undefined,
    editingCardStatus: undefined,
    cursorIndex: undefined
  };
}

function prompterReducer(store: PrompterStoreState, action: PrompterAction): PrompterStoreState {
  switch (action.type) {
    case 'state:replace':
      return {
        ...store,
        state: action.payload,
        workspaceDraft: createDraftFromState(action.payload)
      };
    case 'state:sync':
      // 保留本地的 activeView，避免后台日志同步 (PrompterPanel.refresh) 等触发的
      // state:replace 强制把用户导航重置回 'workspace'。
      // 导航切换由 setView() 立即更新本地状态，无需依赖后端的 activeView 字段。
      return {
        ...store,
        state: {
          ...action.payload,
          activeView: store.state.activeView
        }
      };
    case 'view:set':
      return {
        ...store,
        state: {
          ...store.state,
          activeView: action.payload.view
        }
      };
    case 'history:selectDate':
      return {
        ...store,
        state: {
          ...store.state,
          selectedDate: action.payload.date
        }
      };
    case 'settings:update':
      return {
        ...store,
        state: {
          ...store.state,
          settings: {
            ...store.state.settings,
            ...action.payload,
            logSources: action.payload.logSources ?? store.state.settings.logSources
          }
        }
      };
    case 'workspace:draftChanged':
      return {
        ...store,
        workspaceDraft: {
          ...store.workspaceDraft,
          ...action.payload
        }
      };
    case 'workspace:insertImport': {
      const { text, fileRefs: incomingRefs = [], insertAt = store.workspaceDraft.cursorIndex } = action.payload;
      const current = store.workspaceDraft.content;
      let nextContent: string;
      let nextCursorIndex: number;
      const separator = current.length === 0 ? '' : current.endsWith('\n') ? '' : '\n';
      const wrappedText = `${separator}${text}`;

      if (insertAt !== undefined && insertAt >= 0) {
        nextContent = current.slice(0, insertAt) + wrappedText + current.slice(insertAt);
        nextCursorIndex = insertAt + wrappedText.length;
      } else {
        nextContent = `${current}${wrappedText}`;
        nextCursorIndex = nextContent.length;
      }

      const existingRefs = store.workspaceDraft.fileRefs;
      const mergedRefs = [...existingRefs];

      for (const ref of incomingRefs) {
        if (
          !mergedRefs.some(
            (existing) =>
              existing.path === ref.path &&
              existing.startLine === ref.startLine &&
              existing.endLine === ref.endLine
          )
        ) {
          mergedRefs.push(ref);
        }
      }

      return {
        ...store,
        workspaceDraft: {
          ...store.workspaceDraft,
          content: nextContent,
          fileRefs: mergedRefs,
          cursorIndex: nextCursorIndex
        }
      };
    }
    case 'workspace:draftSaved':
      // 保留本地的 activeView，防止 draft:saved 响应（包含后端旧 activeView）覆盖用户当前页面。
      // 同时清空草稿，避免用户多次点击导航时反复将同一内容存入未使用分区（重复卡片问题）。
      return {
        ...store,
        state: {
          ...action.payload.state,
          activeView: store.state.activeView
        },
        workspaceDraft: {
          title: '',
          content: '',
          fileRefs: [],
          editingCardId: undefined,
          editingCardStatus: undefined,
          cursorIndex: undefined
        },
        lastSavedCardId: action.payload.card.id
      };
    case 'card:move':
      return {
        ...store,
        state: {
          ...store.state,
          cards: store.state.cards.map((card) =>
            card.id === action.payload.cardId
              ? {
                  ...card,
                  status: action.payload.nextStatus,
                  runtimeState:
                    action.payload.nextStatus === 'completed'
                      ? 'finished'
                      : action.payload.nextStatus === 'active'
                        ? 'running'
                        : 'unknown',
                  completedAt:
                    action.payload.nextStatus === 'completed'
                      ? new Date().toISOString()
                      : undefined,
                  justCompleted: false
                }
              : card
          )
        }
      };
    case 'card:delete':
      return {
        ...store,
        state: {
          ...store.state,
          cards: store.state.cards.filter((card) => card.id !== action.payload.cardId)
        }
      };
    case 'card:acknowledgeCompletion':
      return {
        ...store,
        state: {
          ...store.state,
          cards: store.state.cards.map((card) =>
            card.id === action.payload.cardId
              ? { ...card, status: 'completed', runtimeState: 'finished', justCompleted: false }
              : card
          )
        }
      };
    case 'group:rename':
      return {
        ...store,
        state: {
          ...store.state,
          cards: store.state.cards.map((card) =>
            card.groupId === action.payload.groupId
              ? {
                  ...card,
                  groupName: action.payload.nextName,
                  groupColor: groupColor(action.payload.nextName)
                }
              : card
          )
        }
      };
    case 'modularPrompt:save': {
      const existingIndex = store.state.modularPrompts.findIndex(
        (prompt) => prompt.id === action.payload.id || prompt.name.toLowerCase() === action.payload.name.toLowerCase()
      );
      const modularPrompts = [...store.state.modularPrompts];

      if (existingIndex >= 0) {
        modularPrompts[existingIndex] = action.payload;
      } else {
        modularPrompts.unshift(action.payload);
      }

      return {
        ...store,
        state: {
          ...store.state,
          modularPrompts
        }
      };
    }
    default:
      return store;
  }
}

export function createInitialStoreState(initialState: PrompterState): PrompterStoreState {
  return {
    state: initialState,
    workspaceDraft: createDraftFromState(initialState)
  };
}

export function createPrompterStoreReducer() {
  return prompterReducer;
}
