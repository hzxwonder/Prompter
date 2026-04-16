import type {
  BuiltinTone,
  FileRef,
  HistoryImportState,
  ModularPrompt,
  PromptCard,
  PromptSourceType,
  PromptStatus,
  PrompterSettings,
  PrompterState,
  PrompterView
} from './models';

export interface PrompterToastMessage {
  id: string;
  kind: 'info' | 'success';
  message: string;
  actionLabel?: string;
  actionCommand?: 'prompter.open';
}

export type ExtensionToWebviewMessage =
  | { type: 'hydrate'; payload: PrompterState }
  | { type: 'state:replace'; payload: PrompterState }
  | { type: 'historyImport:updated'; payload: HistoryImportState }
  | { type: 'draft:saved'; payload: { card: PromptCard; state: PrompterState } }
  | { type: 'card:updated'; payload: { card: PromptCard; state: PrompterState } }
  | { type: 'cards:updated'; payload: { state: PrompterState } }
  | { type: 'modularPrompts:updated'; payload: { state: PrompterState } }
  | { type: 'settings:shortcuts:update:success'; payload: { shortcuts: PrompterSettings['shortcuts'] } }
  | { type: 'settings:shortcuts:update:error'; payload: { message: string } }
  | { type: 'composer:insertText'; payload: { text: string; fileRefs?: FileRef[]; insertAt?: number } }
  | { type: 'toast:show'; payload: PrompterToastMessage }
  | { type: 'audio:play'; payload: { tone: BuiltinTone } };

export type WebviewToExtensionMessage =
  | { type: 'view:set'; payload: { view: PrompterView } }
  | { type: 'historyImport:start' }
  | { type: 'historyImport:pause' }
  | {
      type: 'draft:autosave';
      payload: {
        title: string;
        content: string;
        fileRefs: FileRef[];
      };
    }
  | { type: 'composer:importFiles'; payload: { filePaths: string[]; insertAt?: number } }
  | { type: 'card:move'; payload: { cardId: string; nextStatus: PromptStatus } }
  | { type: 'card:delete'; payload: { cardId: string } }
  | { type: 'card:acknowledgeCompletion'; payload: { cardId: string } }
  | { type: 'group:rename'; payload: { groupId: string; nextName: string } }
  | { type: 'card:update'; payload: { cardId: string; title: string; content: string; fileRefs: FileRef[] } }
  | {
      type: 'modularPrompt:save';
      payload: Pick<ModularPrompt, 'id' | 'name' | 'content' | 'category'>;
    }
  | { type: 'card:jumpToSource'; payload: { cardId: string; sourceType: PromptSourceType; sourceRef: string } }
  | { type: 'settings:update'; payload: Partial<PrompterSettings> }
  | { type: 'settings:dataDirSwitch'; payload: { targetDir: string; migrate: boolean } }
  | { type: 'settings:previewCustomTone'; payload: { filePath: string } }
  | { type: 'cache:clear' }
  | { type: 'ready' };
