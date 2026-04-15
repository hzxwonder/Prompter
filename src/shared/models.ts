export type PrompterView = 'workspace' | 'history' | 'settings' | 'shortcuts';
export type PrompterCommandId =
  | 'prompter.open'
  | 'prompter.importSelection'
  | 'prompter.importResource'
  | 'prompter.importTerminalSelection';
export type PromptStatus = 'unused' | 'active' | 'completed';
export type PromptRuntimeState = 'running' | 'paused' | 'finished' | 'unknown';
export type PromptSourceType = 'manual' | 'claude-code' | 'cursor' | 'codex' | 'roo-code';
export type ThemeMode = 'system' | 'light' | 'dark' | 'custom';
export type ImportPathMode = 'relative' | 'absolute';
export type BuiltinTone = 'soft-bell' | 'chime' | 'ding';
export type CompletionTone = 'off' | BuiltinTone | 'custom';

export interface FileRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface PromptCard {
  id: string;
  title: string;
  content: string;
  status: PromptStatus;
  runtimeState: PromptRuntimeState;
  groupId: string;
  groupName: string;
  groupColor: string;
  sourceType: PromptSourceType;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastActiveAt?: string;
  dateBucket: string;
  fileRefs: FileRef[];
  justCompleted: boolean;
}

export interface ModularPrompt {
  id: string;
  name: string;
  content: string;
  category: string;
  updatedAt: string;
}

export interface DailyStats {
  date: string;
  usedCount: number;
  unusedCount: number;
  completedCount: number;
  totalCount: number;
}

export interface LogSourceConfig {
  enabled: boolean;
  path: string;
}

export interface ShortcutConfig {
  command: PrompterCommandId;
  label: string;
  description: string;
  keybinding: string;
  defaultKeybinding: string;
}

export interface HistoryImportEntry {
  id: string;
  sourceType: 'claude-code' | 'codex' | 'roo-code';
  filePath: string;
  dateBucket: string;
}

function createDefaultShortcuts(): Record<PrompterCommandId, ShortcutConfig> {
  const openKeybinding = 'ctrl+e';
  const importKeybinding = 'ctrl+shift+f';

  return {
    'prompter.open': {
      command: 'prompter.open',
      label: 'Open Prompter',
      description: 'Open the Prompter panel',
      keybinding: openKeybinding,
      defaultKeybinding: openKeybinding
    },
    'prompter.importSelection': {
      command: 'prompter.importSelection',
      label: 'Import Selection',
      description: 'Import the current selection into a prompt',
      keybinding: importKeybinding,
      defaultKeybinding: importKeybinding
    },
    'prompter.importResource': {
      command: 'prompter.importResource',
      label: 'Import Resource',
      description: 'Add the selected resource to a prompt',
      keybinding: importKeybinding,
      defaultKeybinding: importKeybinding
    },
    'prompter.importTerminalSelection': {
      command: 'prompter.importTerminalSelection',
      label: 'Import Terminal Selection',
      description: 'Import the current terminal selection into a prompt',
      keybinding: importKeybinding,
      defaultKeybinding: importKeybinding
    }
  };
}

export interface PrompterSettings {
  dataDir: string;
  language: 'zh-CN' | 'en';
  theme: ThemeMode;
  defaultImportMode: ImportPathMode;
  notifyOnFinish: boolean;
  notifyOnPause: boolean;
  completionTone: CompletionTone;
  customTonePath: string;
  logSources: Record<'claude-code' | 'codex' | 'roo-code', LogSourceConfig>;
  shortcuts: Record<PrompterCommandId, ShortcutConfig>;
}

export interface HistoryImportState {
  scope: 'idle' | 'today-bootstrap' | 'history-backfill';
  status: 'idle' | 'running' | 'paused' | 'complete';
  processedPrompts: number;
  totalPrompts?: number;
  processedSources: number;
  totalSources: number;
  foregroundReady: boolean;
  warningAcknowledged: boolean;
  pendingEntries: HistoryImportEntry[];
  completedEntries: string[];
  lastError?: string;
}

export interface PrompterState {
  activeView: PrompterView;
  cards: PromptCard[];
  modularPrompts: ModularPrompt[];
  dailyStats: DailyStats[];
  historyImport: HistoryImportState;
  selectedCardId?: string;
  selectedDate?: string;
  settings: PrompterSettings;
}

export function createInitialHistoryImportState(): HistoryImportState {
  return {
    scope: 'idle',
    status: 'idle',
    processedPrompts: 0,
    processedSources: 0,
    totalSources: 0,
    foregroundReady: false,
    warningAcknowledged: false,
    pendingEntries: [],
    completedEntries: []
  };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateBucket(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return isoString.slice(0, 10);
  }

  return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}-${padDatePart(parsed.getDate())}`;
}

export function createInitialState(nowIso: string, _platform?: string): PrompterState {
  return {
    activeView: 'workspace',
    cards: [],
    modularPrompts: [],
    dailyStats: [],
    historyImport: createInitialHistoryImportState(),
    selectedDate: toDateBucket(nowIso),
    settings: {
      dataDir: '~/prompter',
      language: 'zh-CN',
      theme: 'system',
      defaultImportMode: 'absolute',
      notifyOnFinish: true,
      notifyOnPause: true,
      completionTone: 'soft-bell',
      customTonePath: '',
      logSources: {
        'claude-code': { enabled: true, path: '~/.claude/projects' },
        codex: { enabled: true, path: '~/.codex/sessions' },
        'roo-code': {
          enabled: false,
          path: '~/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/tasks'
        }
      },
      shortcuts: createDefaultShortcuts()
    }
  };
}
