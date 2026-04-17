import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import { createInitialState, toLocalDateBucket } from '../../../src/shared/models';
import { LogSyncService } from '../../../src/services/LogSyncService';

const { showInformationMessage, log } = vi.hoisted(() => ({
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  log: vi.fn()
}));
const { MockFileWatchPool } = vi.hoisted(() => ({
  MockFileWatchPool: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    getPoolSnapshot: vi.fn(() => []),
    start: vi.fn(),
    stop: vi.fn()
  }))
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage
  },
  env: {
    remoteName: undefined
  },
  commands: {
    executeCommand: vi.fn()
  }
}));

vi.mock('../../../src/panel/PrompterPanel', () => ({
  PrompterPanel: {
    refresh: vi.fn().mockResolvedValue(undefined),
    syncHistoryImport: vi.fn().mockResolvedValue(undefined),
    playCompletionTone: vi.fn(),
    playCompletionToneInWebviewIfOpen: vi.fn(() => false),
    playCustomTone: vi.fn(),
    showToast: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock('../../../src/services/LogParser', () => ({
  LogParser: vi.fn().mockImplementation(function () {
    return {
      close: vi.fn(),
      resetPersistedState: vi.fn(),
      sync: vi.fn(() => ({ inserted: [], justCompletedSourceRefs: [], silentlyCompletedSourceRefs: [], pauseTriggerSourceRefs: [] })),
      getAllPrompts: vi.fn(() => []),
      getSessionLastModifiedMs: vi.fn(() => undefined),
      getRunningSessionsSnapshot: vi.fn(() => new Set<string>()),
      hasPersistedPrompts: vi.fn(() => false),
      discoverTodayOrRunningEntries: vi.fn(() => []),
      discoverScanEntries: vi.fn(() => []),
      scanEntry: vi.fn(() => []),
      applySessionScan: vi.fn((prompts) => ({ inserted: prompts, justCompletedSourceRefs: [], silentlyCompletedSourceRefs: [] }))
    };
  })
}));

vi.mock('../../../src/logger', () => ({
  log,
  logError: vi.fn()
}));

vi.mock('../../../src/services/FileWatchPool', () => ({
  FileWatchPool: MockFileWatchPool
}));

describe('LogSyncService', () => {
  beforeEach(async () => {
    showInformationMessage.mockClear();
    showInformationMessage.mockResolvedValue(undefined);
    log.mockClear();
    MockFileWatchPool.mockClear();
    const vscode = await import('vscode');
    (vscode.env as { remoteName?: string }).remoteName = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses a fixed history worker count of 3', () => {
    expect((LogSyncService as any).resolveHistoryWorkerCount(16)).toBe(3);
    expect((LogSyncService as any).resolveHistoryWorkerCount(6)).toBe(3);
    expect((LogSyncService as any).resolveHistoryWorkerCount(2)).toBe(3);
  });

  it('backfills parsed prompts that exist in logs-state but are missing cards', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockImplementation(async (input) => ({
        id: 'backfilled-card',
        ...input
      })),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.getAllPrompts.mockReturnValue([
      {
        source: 'codex',
        sessionId: 'session-1',
        sourceRef: 'session-1:turn-1',
        project: 'session-1',
        userInput: 'Backfill the missing imported prompt card.',
        createdAt: '2026-04-08T09:59:00.000Z',
        status: 'completed',
        completedAt: '2026-04-08T10:01:00.000Z'
      }
    ]);

    await (service as any).reconcileMissingParsedPromptCards();

    expect(repository.saveImportedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        status: 'completed',
        runtimeState: 'finished',
        createdAt: '2026-04-08T09:59:00.000Z'
      })
    );
    expect(repository.markCardCompletedFromLog).toHaveBeenCalledWith(
      'session-1:turn-1',
      '2026-04-08T10:01:00.000Z',
      { justCompleted: false }
    );
  });

  it('sends completion notifications through PrompterPanel.showToast instead of host info messages', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.settings.language = 'en';
    state.settings.notifyOnFinish = true;
    state.cards = [
      {
        id: 'card-1',
        title: 'Release wrap-up',
        content: 'Summarize the shipped changes.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'release',
        groupName: 'release',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');

    await (service as any).handlePromptCompleted('session-1');

    expect(PrompterPanel.showToast).toHaveBeenCalledWith({
      id: 'prompt-completed:card-1',
      kind: 'success',
      message: 'Prompt completed: Release wrap-up...',
      actionLabel: 'View',
      actionCommand: 'prompter.open'
    });
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('falls back to a local VS Code notification instead of host audio when running in a remote extension host', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.settings.language = 'zh-CN';
    state.settings.notifyOnFinish = true;
    state.settings.completionTone = 'chime';
    state.cards = [
      {
        id: 'card-1',
        title: 'Release wrap-up',
        content: 'Summarize the shipped changes.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'release',
        groupName: 'release',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const vscode = await import('vscode');
    (vscode.env as { remoteName?: string }).remoteName = 'ssh-remote';

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');

    await (service as any).handlePromptCompleted('session-1');

    expect(PrompterPanel.playCompletionTone).not.toHaveBeenCalled();
    expect(PrompterPanel.playCompletionToneInWebviewIfOpen).toHaveBeenCalledWith('chime');
    expect(log).toHaveBeenCalledWith('[LogSyncService] Remote host -> local notification fallback: ssh-remote');
    expect(showInformationMessage).toHaveBeenCalledWith('Prompt 已完成: Release wrap-up...', '查看');
    expect(PrompterPanel.showToast).toHaveBeenCalledWith({
      id: 'prompt-completed:card-1',
      kind: 'success',
      message: 'Prompt 已完成: Release wrap-up...',
      actionLabel: '查看',
      actionCommand: 'prompter.open'
    });
    (vscode.env as { remoteName?: string }).remoteName = undefined;
  });

  it('does not block remote completion handling on an unresolved host notification', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.settings.language = 'en';
    state.settings.notifyOnFinish = true;
    state.settings.completionTone = 'chime';
    state.cards = [
      {
        id: 'card-1',
        title: 'Release wrap-up',
        content: 'Summarize the shipped changes.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'release',
        groupName: 'release',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const vscode = await import('vscode');
    (vscode.env as { remoteName?: string }).remoteName = 'ssh-remote';
    showInformationMessage.mockReturnValueOnce(new Promise<undefined>(() => {}) as never);

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await expect((service as any).handlePromptCompleted('session-1')).resolves.toBeUndefined();

    (vscode.env as { remoteName?: string }).remoteName = undefined;
  });

  it('uses local webview audio on the current machine when the panel is open in a remote extension host', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.settings.language = 'en';
    state.settings.notifyOnFinish = true;
    state.settings.completionTone = 'chime';
    state.cards = [
      {
        id: 'card-1',
        title: 'Release wrap-up',
        content: 'Summarize the shipped changes.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'release',
        groupName: 'release',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const vscode = await import('vscode');
    (vscode.env as { remoteName?: string }).remoteName = 'ssh-remote';

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');
    vi.mocked(PrompterPanel.playCompletionToneInWebviewIfOpen).mockReturnValueOnce(true);

    await (service as any).handlePromptCompleted('session-1');

    expect(PrompterPanel.playCompletionTone).not.toHaveBeenCalled();
    expect(PrompterPanel.playCompletionToneInWebviewIfOpen).toHaveBeenCalledWith('chime');
    expect(log).toHaveBeenCalledWith('[LogSyncService] Remote host -> local webview audio: ssh-remote');
    expect(showInformationMessage).toHaveBeenCalledWith('Prompt completed: Release wrap-up...', 'View');
    (vscode.env as { remoteName?: string }).remoteName = undefined;
  });

  it('plays the configured completion tone when a prompt finishes', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.settings.completionTone = 'chime';
    state.settings.notifyOnFinish = true;
    state.cards = [
      {
        id: 'card-1',
        title: 'Release wrap-up',
        content: 'Summarize the shipped changes.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'release',
        groupName: 'release',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');

    await (service as any).handlePromptCompleted('session-1');

    expect(PrompterPanel.playCompletionTone).toHaveBeenCalledWith('chime');
  });

  it('sends running prompt notifications through webview toasts', async () => {
    const state = createInitialState('2026-04-08T10:30:00.000Z');
    state.settings.language = 'zh-CN';
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        title: '新 prompt',
        sourceRef: 'session-1:turn-2'
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');

    await (service as any).handleNewPrompt({
      source: 'codex',
      sessionId: 'session-1',
      sourceRef: 'session-1:turn-2',
      project: 'session-1',
      userInput: '新的输入',
      createdAt: '2026-04-08T10:30:00.000Z',
      status: 'running'
    });

    expect(PrompterPanel.showToast).toHaveBeenCalledWith({
      id: 'prompt-running:card-2',
      kind: 'info',
      message: '发现新的运行中 prompt: 新 prompt...',
      actionLabel: '查看',
      actionCommand: 'prompter.open'
    });
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('auto-completes the previous active prompt when a new prompt arrives in the same codex session', async () => {
    const state = createInitialState('2026-04-08T10:30:00.000Z');
    state.cards = [
      {
        id: 'card-1',
        title: 'Older prompt',
        content: 'Inspect the activation failure.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-08T09:50:00.000Z',
        updatedAt: '2026-04-08T09:50:00.000Z',
        lastActiveAt: '2026-04-08T10:25:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        title: 'Newer prompt'
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).handleNewPrompt({
      source: 'codex',
      sessionId: 'session-1',
      sourceRef: 'session-1:turn-2',
      project: 'session-1',
      userInput: 'Open the prompt workspace directly from the activity bar.',
      createdAt: '2026-04-08T10:30:00.000Z',
      status: 'running'
    });

    expect(repository.markCardCompletedFromLog).toHaveBeenCalledWith(
      'card-1',
      '2026-04-08T10:30:00.000Z',
      { justCompleted: false }
    );
    expect(repository.saveImportedCard).toHaveBeenCalled();
  });

  it('auto-completes a same-session Claude prompt without requiring awaiting-confirmation state', async () => {
    const state = createInitialState('2026-04-08T10:10:00.000Z');
    state.cards = [
      {
        id: 'card-1',
        title: 'Older prompt',
        content: 'Inspect the activation failure.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'claude-code:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'claude-code',
        sourceRef: 'session-1',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        lastActiveAt: '2026-04-08T10:09:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        title: 'Newer prompt'
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).handleNewPrompt({
      source: 'claude-code',
      sessionId: 'session-1',
      sourceRef: 'session-1',
      project: 'session-1',
      userInput: 'Write the release summary.',
      createdAt: '2026-04-08T10:10:00.000Z',
      status: 'running'
    });

    expect(repository.markCardCompletedFromLog).toHaveBeenCalledWith(
      'card-1',
      '2026-04-08T10:10:00.000Z',
      { justCompleted: false }
    );
    expect(repository.saveImportedCard).toHaveBeenCalled();
  });

  it('hydrates only today cards into the foreground during the first install sync', async () => {
    const state = createInitialState('2026-04-08T10:10:00.000Z');

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        title: 'Today prompt'
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).handleNewPrompt(
      {
        source: 'codex',
        sessionId: 'session-today',
        sourceRef: 'session-today:turn-1',
        project: 'session-today',
        userInput: 'Keep workspace responsive.',
        createdAt: '2026-04-08T10:10:00.000Z',
        status: 'running'
      },
      { foregroundOnly: true, todayBucket: '2026-04-08' }
    );

    await (service as any).handleNewPrompt(
      {
        source: 'codex',
        sessionId: 'session-old',
        sourceRef: 'session-old:turn-1',
        project: 'session-old',
        userInput: 'This old prompt should stay out of workspace lanes.',
        createdAt: '2026-04-07T09:00:00.000Z',
        status: 'completed'
      },
      { foregroundOnly: true, todayBucket: '2026-04-08' }
    );

    expect(repository.saveImportedCard).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceRef: 'session-today:turn-1',
        status: 'active'
      })
    );
    expect(repository.saveImportedCard).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourceRef: 'session-old:turn-1',
        status: 'completed'
      })
    );
  });

  it('bootstraps today import via lightweight today/running discovery', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const todayBucket = toLocalDateBucket(new Date());
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      setHistoryImport: vi.fn().mockResolvedValue(undefined),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.discoverTodayOrRunningEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        path: '/tmp/today.jsonl',
        dateBucket: todayBucket,
        lastModifiedMs: Date.parse('2026-04-08T10:00:00.000Z')
      }
    ]);
    parser.scanEntry = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        sourceRef: 'today-session:turn-1',
        project: 'today-session',
        userInput: 'Keep workspace responsive.',
        createdAt: `${todayBucket}T10:00:00.000Z`,
        status: 'running'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    await (service as any).bootstrapTodayImport();

    expect(parser.discoverTodayOrRunningEntries).toHaveBeenCalledWith(todayBucket, expect.any(Set));
    expect(repository.saveImportedCards).toHaveBeenCalledTimes(1);
  });

  it('uses the local calendar day for today bootstrap shortly after midnight', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T16:10:00.000Z'));

    const state = createInitialState('2026-04-17T00:10:00.000+08:00');
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      setHistoryImport: vi.fn().mockResolvedValue(undefined),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    try {
      const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
      const parser = (service as any).parser;
      parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
      parser.discoverTodayOrRunningEntries = vi.fn(() => []);

      await (service as any).bootstrapTodayImport();

      expect(parser.discoverTodayOrRunningEntries).toHaveBeenCalledWith('2026-04-17', expect.any(Set));
    } finally {
      vi.useRealTimers();
      process.env.TZ = previousTz;
    }
  });

  it('bootstraps today import from watched changed files even when lightweight discovery misses an old-date codex session', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T16:45:00.000Z'));

    const state = createInitialState('2026-04-17T00:45:00.000+08:00');
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      setHistoryImport: vi.fn().mockResolvedValue(undefined),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    try {
      const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
      const parser = (service as any).parser;
      parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
      parser.discoverTodayOrRunningEntries = vi.fn(() => []);
      parser.scanEntry = vi.fn(() => [
        {
          source: 'codex',
          sessionId: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c',
          sourceRef: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c:turn-old',
          project: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c',
          userInput: 'Old day prompt',
          createdAt: '2026-04-16T07:49:04.500Z',
          status: 'completed'
        },
        {
          source: 'codex',
          sessionId: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c',
          sourceRef: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c:turn-today',
          project: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c',
          userInput: 'Today prompt from a watched changed file',
          createdAt: '2026-04-16T16:41:21.546Z',
          status: 'running'
        }
      ]);
      parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));
      (service as any).fileWatchPool = {
        getPoolSnapshot: vi.fn(() => [
          {
            path: '/Users/test/.codex/sessions/2026/04/16/rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c.jsonl',
            source: 'codex',
            lastSize: 1,
            lastMtimeMs: Date.parse('2026-04-16T16:43:29.000Z'),
            lastChangedAt: Date.parse('2026-04-16T16:43:29.000Z')
          }
        ])
      };

      await (service as any).bootstrapTodayImport();

      expect(parser.discoverTodayOrRunningEntries).toHaveBeenCalledWith('2026-04-17', expect.any(Set));
      expect(parser.scanEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/Users/test/.codex/sessions/2026/04/16/rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c.jsonl',
          source: 'codex'
        })
      );
      expect(repository.saveImportedCards).toHaveBeenCalledWith([
        expect.objectContaining({
          sourceRef: 'rollout-2026-04-16T15-47-15-019d9542-2e51-7a90-b2ee-ed1cc93f4f4c:turn-today',
          status: 'active'
        })
      ]);
    } finally {
      vi.useRealTimers();
      process.env.TZ = previousTz;
    }
  });

  it('reparses watched changed files during foreground sync and keeps only prompts from the local current day', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T16:45:00.000Z'));

    try {
      const state = createInitialState('2026-04-17T00:45:00.000+08:00');
      const service = new LogSyncService({ getState: vi.fn().mockResolvedValue(state) } as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
      const parser = (service as any).parser;
      parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
      parser.discoverTodayOrRunningEntries = vi.fn(() => []);
      parser.scanEntry = vi.fn(() => [
        {
          source: 'codex',
          sessionId: 'cross-day-session',
          sourceRef: 'cross-day-session:turn-old',
          project: 'cross-day-session',
          userInput: 'Yesterday prompt',
          createdAt: '2026-04-16T07:49:04.500Z',
          status: 'completed'
        },
        {
          source: 'codex',
          sessionId: 'cross-day-session',
          sourceRef: 'cross-day-session:turn-today',
          project: 'cross-day-session',
          userInput: 'Today prompt',
          createdAt: '2026-04-16T16:41:21.546Z',
          status: 'running'
        }
      ]);
      parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts, justCompletedSourceRefs: [], silentlyCompletedSourceRefs: [] }));
      (service as any).fileWatchPool = {
        getPoolSnapshot: vi.fn(() => [
          {
            path: '/Users/test/.codex/sessions/2026/04/16/cross-day-session.jsonl',
            source: 'codex',
            lastSize: 1,
            lastMtimeMs: Date.parse('2026-04-16T16:43:29.000Z'),
            lastChangedAt: Date.parse('2026-04-16T16:43:29.000Z')
          }
        ])
      };

      const result = (service as any).syncForegroundSessionsOnly();

      expect(result.inserted).toEqual([
        expect.objectContaining({
          sourceRef: 'cross-day-session:turn-today',
          userInput: 'Today prompt'
        })
      ]);
      expect(result.inserted).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceRef: 'cross-day-session:turn-old' })])
      );
    } finally {
      vi.useRealTimers();
      process.env.TZ = previousTz;
    }
  });

  it('uses the persisted watch-pool path when bootstrapping file watching', () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const repository = {
      getState: vi.fn().mockResolvedValue(state)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    vi.spyOn(service as any, 'startInitialImportIfNeeded').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'scheduleMidnightSync').mockImplementation(() => {});
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({} as never);

    service.start();

    expect(MockFileWatchPool).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/watch-pool\.json$/)
    );
  });

  it('rotates today cards at midnight before running sync', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      rotateTodayCards: vi.fn().mockResolvedValue(undefined)
    };
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const requestSyncSpy = vi.spyOn(service as any, 'requestSync').mockResolvedValue(undefined);
    const runPythonScanSpy = vi.spyOn(service as any, 'runPythonScan').mockResolvedValue(undefined);

    let scheduledCallback: (() => void) | undefined;
    setTimeoutSpy.mockImplementation((((callback: TimerHandler) => {
      scheduledCallback = callback as () => void;
      return {} as never;
    }) as unknown) as typeof setTimeout);

    (service as any).scheduleMidnightSync();
    scheduledCallback?.();
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }

    expect(repository.rotateTodayCards).toHaveBeenCalledTimes(1);
    expect(requestSyncSpy).toHaveBeenCalledTimes(1);
    expect(runPythonScanSpy).toHaveBeenCalledTimes(1);
  });

  it('settles older same-session prompts even when they are imported together in one batch', async () => {
    const state = createInitialState('2026-04-08T10:30:00.000Z');
    const repositoryState = { ...state, cards: [] as typeof state.cards };

    const repository = {
      getState: vi.fn().mockImplementation(async () => repositoryState),
      saveImportedCards: vi.fn().mockImplementation(async (inputs: any[]) => {
        repositoryState.cards = inputs.map((input, index) => ({
          id: `card-${index + 1}`,
          title: input.title,
          content: input.content,
          status: input.status,
          runtimeState: input.runtimeState,
          groupId: 'codex:session-1',
          groupName: 'session-1',
          groupColor: '#22c55e',
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          dateBucket: '2026-04-08',
          fileRefs: [],
          justCompleted: false
        }));
      }),
      acknowledgeCompletion: vi.fn().mockImplementation(async (cardId: string) => {
        repositoryState.cards = repositoryState.cards.map((card) =>
          card.id === cardId ? { ...card, justCompleted: false } : card
        );
      }),
      markCardCompletedFromLog: vi.fn().mockImplementation(async (sourceRef: string, completedAt: string, options?: { justCompleted?: boolean }) => {
        repositoryState.cards = repositoryState.cards.map((card) =>
          card.sourceRef === sourceRef || card.id === sourceRef
            ? {
                ...card,
                status: 'completed',
                runtimeState: 'finished',
                completedAt,
                updatedAt: completedAt,
                justCompleted: options?.justCompleted ?? true
              }
            : card
        );
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).importEntry(
      {
        source: 'codex',
        sessionId: 'session-1',
        path: '/tmp/session-1.jsonl',
        dateBucket: '2026-04-08',
        lastModifiedMs: Date.parse('2026-04-08T10:30:00.000Z')
      },
      new Set<string>(['codex:session-1']),
      { foregroundOnly: true, todayBucket: '2026-04-08', skipRefresh: true, skipNotify: true },
      async () => [
        {
          source: 'codex',
          sessionId: 'session-1',
          sourceRef: 'session-1:turn-1',
          project: 'session-1',
          userInput: 'Inspect the activation failure.',
          createdAt: '2026-04-08T10:00:00.000Z',
          completedAt: '2026-04-08T10:05:00.000Z',
          status: 'completed'
        },
        {
          source: 'codex',
          sessionId: 'session-1',
          sourceRef: 'session-1:turn-2',
          project: 'session-1',
          userInput: 'Open the prompt workspace directly from the activity bar.',
          createdAt: '2026-04-08T10:30:00.000Z',
          status: 'running'
        }
      ]
    );

    expect(repository.saveImportedCards).toHaveBeenCalledTimes(1);
    expect(repository.acknowledgeCompletion).toHaveBeenCalledWith('card-1');
    expect(repository.markCardCompletedFromLog).toHaveBeenCalledTimes(1);
    expect(repository.markCardCompletedFromLog).toHaveBeenCalledWith(
      'session-1:turn-1',
      '2026-04-08T10:05:00.000Z',
      { justCompleted: true }
    );
  });

  it('prepares historical backfill without executing it during activation', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const todayBucket = toLocalDateBucket(new Date());

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      setHistoryImport: vi.fn().mockResolvedValue(undefined),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).historyWorkerCount = 3;
    const parser = (service as any).parser;
    parser.hasPersistedPrompts = vi.fn(() => false);
    parser.discoverTodayOrRunningEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        path: '/tmp/today.jsonl',
        dateBucket: todayBucket,
        lastModifiedMs: Date.parse('2026-04-08T10:00:00.000Z')
      }
    ]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        path: '/tmp/today.jsonl',
        dateBucket: todayBucket,
        lastModifiedMs: Date.parse('2026-04-08T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'old-session',
        path: '/tmp/old.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      }
    ]);
    parser.scanEntry = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        sourceRef: 'today-session:turn-1',
        project: 'today-session',
        userInput: 'Keep workspace responsive.',
        createdAt: `${todayBucket}T10:00:00.000Z`,
        status: 'running'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    await (service as any).startInitialImportIfNeeded();

    expect(repository.saveImportedCards).toHaveBeenCalledTimes(1);
    expect(repository.setHistoryImport).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'history-backfill',
        status: 'idle',
        pendingEntries: expect.arrayContaining([
          {
            id: 'codex:/tmp/old.jsonl',
            sourceType: 'codex',
            filePath: '/tmp/old.jsonl',
            dateBucket: '2026-04-07',
            lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
          }
        ])
      })
    );
  });

  it('resets stale parser state and rehydrates today prompts when cache is empty', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const todayBucket = toLocalDateBucket(new Date());
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      setHistoryImport: vi.fn().mockResolvedValue(undefined),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.hasPersistedPrompts = vi.fn(() => true);
    parser.resetPersistedState = vi.fn();
    parser.discoverTodayOrRunningEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        path: '/tmp/today.jsonl',
        dateBucket: '2026-04-01',
        lastModifiedMs: Date.parse(`${todayBucket}T10:00:00.000Z`)
      }
    ]);
    parser.discoverScanEntries = vi.fn(() => []);
    parser.scanEntry = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        sourceRef: 'today-session:turn-1',
        project: 'today-session',
        userInput: 'Rehydrate today after clearing cache.',
        createdAt: `${todayBucket}T10:00:00.000Z`,
        status: 'running'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    await (service as any).startInitialImportIfNeeded();

    expect(parser.resetPersistedState).toHaveBeenCalledTimes(1);
    expect(repository.saveImportedCards).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceRef: 'today-session:turn-1',
        content: 'Rehydrate today after clearing cache.'
      })
    ]);
  });

  it('imports only today prompts and unfinished prompts from running old sessions while backfill is still pending', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const todayBucket = toLocalDateBucket(new Date());
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/old.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        }
      ],
      completedEntries: []
    };

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-1',
        title: 'Imported prompt'
      }),
      autoCompleteExpiredActiveCards: vi.fn().mockResolvedValue([]),
      getCardsAwaitingConfirmation: vi.fn().mockResolvedValue([]),
      updateCardLastActiveAt: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).historyWorkerCount = 3;
    const parser = (service as any).parser;
    parser.discoverTodayOrRunningEntries = vi.fn(() => [{
      source: 'codex',
      sessionId: 'old-session',
      path: '/tmp/old.jsonl',
      dateBucket: '2026-04-07',
      lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
    }]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>(['codex:old-session']));
    parser.scanEntry = vi.fn((entry) => {
      return [
        {
          source: 'codex',
          sessionId: 'old-session',
          sourceRef: 'old-session:turn-1',
          project: 'old-session',
          userInput: 'Old prompt',
          createdAt: '2026-04-07T10:00:00.000Z',
          completedAt: '2026-04-07T10:01:00.000Z',
          status: 'completed'
        },
        {
          source: 'codex',
          sessionId: 'old-session',
          sourceRef: 'old-session:turn-2',
          project: 'old-session',
          userInput: 'Today prompt in old session',
          createdAt: `${todayBucket}T10:00:00.000Z`,
          status: 'running'
        }
      ];
    });
    parser.applySessionScan = vi.fn((prompts) => ({
      inserted: prompts,
      justCompletedSourceRefs: [],
      silentlyCompletedSourceRefs: []
    }));

    await (service as any).sync();

    expect(parser.sync).not.toHaveBeenCalled();
    expect(parser.discoverTodayOrRunningEntries).toHaveBeenCalledWith(
      todayBucket,
      expect.any(Set)
    );
    expect(parser.scanEntry).toHaveBeenCalledTimes(1);
    expect(parser.scanEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/tmp/old.jsonl'
      })
    );
    expect(repository.saveImportedCard).toHaveBeenCalledTimes(1);
    expect(repository.saveImportedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'old-session:turn-2',
        content: 'Today prompt in old session'
      })
    );
  });

  it('still auto-acknowledges completed same-session prompts during foreground-only sync while backfill is pending', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const todayBucket = toLocalDateBucket(new Date());
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/history.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/history.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        }
      ],
      completedEntries: []
    };
    state.cards = [
      {
        id: 'card-1',
        title: 'Previous prompt',
        content: 'Hello!',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: `${todayBucket}T09:50:00.000Z`,
        updatedAt: `${todayBucket}T10:00:00.000Z`,
        completedAt: `${todayBucket}T10:00:00.000Z`,
        dateBucket: todayBucket,
        fileRefs: [],
        justCompleted: true
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        title: 'Imported prompt'
      }),
      acknowledgeCompletion: vi.fn().mockResolvedValue(undefined),
      autoCompleteExpiredActiveCards: vi.fn().mockResolvedValue([]),
      updateCardLastActiveAt: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverTodayOrRunningEntries = vi.fn(() => [{
      source: 'codex',
      sessionId: 'session-1',
      path: '/tmp/session-1.jsonl',
      dateBucket: '2026-04-07',
      lastModifiedMs: Date.parse(`${todayBucket}T10:10:00.000Z`)
    }]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>(['codex:session-1']));
    parser.scanEntry = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'session-1',
        sourceRef: 'session-1:turn-2',
        project: 'session-1',
        userInput: 'New prompt in same session',
        createdAt: `${todayBucket}T10:10:00.000Z`,
        status: 'running'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({
      inserted: prompts,
      justCompletedSourceRefs: [],
      silentlyCompletedSourceRefs: []
    }));

    await (service as any).sync();

    expect(repository.acknowledgeCompletion).toHaveBeenCalledWith('card-1');
    expect(repository.saveImportedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'session-1:turn-2'
      })
    );
  });

  it('avoids full parser sync during normal incremental sync and uses lightweight discovery instead', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const todayBucket = toLocalDateBucket(new Date());
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-1',
        title: 'Imported prompt'
      }),
      autoCompleteExpiredActiveCards: vi.fn().mockResolvedValue([]),
      getCardsAwaitingConfirmation: vi.fn().mockResolvedValue([]),
      updateCardLastActiveAt: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.sync = vi.fn(() => {
      throw new Error('parser.sync should not be called');
    });
    parser.discoverTodayOrRunningEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        path: '/tmp/today.jsonl',
        dateBucket: todayBucket,
        lastModifiedMs: Date.parse('2026-04-08T10:00:00.000Z')
      }
    ]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.scanEntry = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'today-session',
        sourceRef: 'today-session:turn-1',
        project: 'today-session',
        userInput: 'Keep workspace responsive.',
        createdAt: `${todayBucket}T10:00:00.000Z`,
        status: 'running'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({
      inserted: prompts,
      justCompletedSourceRefs: [],
      silentlyCompletedSourceRefs: []
    }));

    await (service as any).sync();

    expect(parser.sync).not.toHaveBeenCalled();
    expect(parser.discoverTodayOrRunningEntries).toHaveBeenCalledWith(todayBucket, expect.any(Set));
    expect(repository.saveImportedCard).toHaveBeenCalledTimes(1);
  });

  it('completes history backfill and clears pending entries after all files finish processing', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/old-1.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old-1.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        },
        {
          id: 'codex:/tmp/old-2.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old-2.jsonl',
          dateBucket: '2026-04-06',
          lastModifiedMs: Date.parse('2026-04-06T10:00:00.000Z')
        }
      ],
      completedEntries: []
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      }),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'old-1',
        path: '/tmp/old-1.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'old-2',
        path: '/tmp/old-2.jsonl',
        dateBucket: '2026-04-06',
        lastModifiedMs: Date.parse('2026-04-06T10:00:00.000Z')
      }
    ]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.scanEntry = vi.fn((entry) => [
      {
        source: 'codex',
        sessionId: entry.sessionId,
        sourceRef: `${entry.sessionId}:turn-1`,
        project: entry.sessionId,
        userInput: `Import ${entry.sessionId}`,
        createdAt: `${entry.dateBucket}T10:00:00.000Z`,
        status: 'completed'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    await service.runHistoryBackfill();

    expect(repositoryState.historyImport.status).toBe('complete');
    expect(repositoryState.historyImport.pendingEntries).toEqual([]);
    expect(repositoryState.historyImport.totalPrompts).toBeUndefined();
    expect(repositoryState.historyImport.completedEntries).toEqual([
      'codex:/tmp/old-1.jsonl',
      'codex:/tmp/old-2.jsonl'
    ]);
    expect(repositoryState.historyImport.processedSources).toBe(2);
  });

  it('skips history entries older than 30 days when preparing backfill', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'recent-session',
        path: '/tmp/recent.jsonl',
        dateBucket: '2026-04-01',
        lastModifiedMs: Date.parse('2026-04-01T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'old-session',
        path: '/tmp/old.jsonl',
        dateBucket: '2026-02-20',
        lastModifiedMs: Date.parse('2026-02-20T10:00:00.000Z')
      }
    ]);

    await (service as any).prepareHistoryBackfill();

    expect(repositoryState.historyImport.pendingEntries).toEqual([
      {
        id: 'codex:/tmp/recent.jsonl',
        sourceType: 'codex',
        filePath: '/tmp/recent.jsonl',
        dateBucket: '2026-04-01',
        lastModifiedMs: Date.parse('2026-04-01T10:00:00.000Z')
      }
    ]);
  });

  it('queues recently modified old sessions for history backfill even when their session bucket is older than 30 days', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'recently-active-old-session',
        path: '/tmp/old-session.jsonl',
        dateBucket: '2026-02-20',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      }
    ]);

    await (service as any).prepareHistoryBackfill();

    expect(repositoryState.historyImport.pendingEntries).toEqual([
      {
        id: 'codex:/tmp/old-session.jsonl',
        sourceType: 'codex',
        filePath: '/tmp/old-session.jsonl',
        dateBucket: '2026-02-20',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      }
    ]);
  });

  it('imports recent historical prompts from sessions that are still being modified today', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/old-session.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old-session.jsonl',
          dateBucket: '2026-02-20',
          lastModifiedMs: Date.parse(`${toLocalDateBucket(new Date())}T10:00:00.000Z`)
        }
      ],
      completedEntries: [],
      completedEntryMtims: {}
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      }),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'old-session',
        path: '/tmp/old-session.jsonl',
        dateBucket: '2026-02-20',
        lastModifiedMs: Date.parse(`${toLocalDateBucket(new Date())}T10:00:00.000Z`)
      }
    ]);
    parser.scanEntry = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'old-session',
        sourceRef: 'old-session:turn-1',
        project: 'old-session',
        userInput: 'Prompt from earlier this month.',
        createdAt: '2026-04-07T09:00:00.000Z',
        status: 'completed'
      },
      {
        source: 'codex',
        sessionId: 'old-session',
        sourceRef: 'old-session:turn-2',
        project: 'old-session',
        userInput: 'Prompt from today should stay in foreground sync.',
        createdAt: `${toLocalDateBucket(new Date())}T10:00:00.000Z`,
        status: 'running'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    await service.runHistoryBackfill();

    expect(repository.saveImportedCards).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceRef: 'old-session:turn-1',
        content: 'Prompt from earlier this month.'
      })
    ]);
    expect(repository.saveImportedCards).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRef: 'old-session:turn-2'
        })
      ])
    );
  });

  it('throttles history import progress syncs while backfill is running', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: Array.from({ length: 5 }, (_, index) => ({
        id: `codex:/tmp/old-${index + 1}.jsonl`,
        sourceType: 'codex' as const,
        filePath: `/tmp/old-${index + 1}.jsonl`,
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse(`2026-04-07T10:00:0${index}.000Z`)
      })),
      completedEntries: [],
      completedEntryMtims: {}
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      }),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() =>
      Array.from({ length: 5 }, (_, index) => ({
        source: 'codex' as const,
        sessionId: `old-${index + 1}`,
        path: `/tmp/old-${index + 1}.jsonl`,
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse(`2026-04-07T10:00:0${index}.000Z`)
      }))
    );
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.scanEntry = vi.fn((entry) => [
      {
        source: 'codex',
        sessionId: entry.sessionId,
        sourceRef: `${entry.sessionId}:turn-1`,
        project: entry.sessionId,
        userInput: `Import ${entry.sessionId}`,
        createdAt: `${entry.dateBucket}T10:00:00.000Z`,
        status: 'completed'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');
    const syncHistoryImportMock = vi.mocked(PrompterPanel.syncHistoryImport as unknown as ReturnType<typeof vi.fn>);
    syncHistoryImportMock.mockClear();

    await service.runHistoryBackfill();

    expect(syncHistoryImportMock.mock.calls.length).toBeLessThan(7);
  });

  it('prepares history backfill without requeueing unchanged completed entries', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [],
      completedEntries: ['codex:/tmp/old.jsonl'],
      completedEntryMtims: {
        'codex:/tmp/old.jsonl': Date.parse('2026-04-07T10:00:00.000Z')
      }
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'old-session',
        path: '/tmp/old.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      }
    ]);

    await (service as any).prepareHistoryBackfill();

    expect(repositoryState.historyImport.pendingEntries).toEqual([]);
    expect(repositoryState.historyImport.completedEntries).toEqual(['codex:/tmp/old.jsonl']);
  });

  it('requeues completed history entries when their mtime changes', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [],
      completedEntries: ['codex:/tmp/old.jsonl'],
      completedEntryMtims: {
        'codex:/tmp/old.jsonl': Date.parse('2026-04-07T10:00:00.000Z')
      }
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'old-session',
        path: '/tmp/old.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T11:00:00.000Z')
      }
    ]);

    await (service as any).prepareHistoryBackfill();

    expect(repositoryState.historyImport.completedEntries).toEqual([]);
    expect(repositoryState.historyImport.pendingEntries).toEqual([
      {
        id: 'codex:/tmp/old.jsonl',
        sourceType: 'codex',
        filePath: '/tmp/old.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T11:00:00.000Z')
      }
    ]);
  });

  it('records completed entry mtimes during history backfill and avoids progress refresh churn', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/old-1.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old-1.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        },
        {
          id: 'codex:/tmp/old-2.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old-2.jsonl',
          dateBucket: '2026-04-06',
          lastModifiedMs: Date.parse('2026-04-06T10:00:00.000Z')
        }
      ],
      completedEntries: [],
      completedEntryMtims: {}
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      }),
      saveImportedCards: vi.fn().mockResolvedValue([])
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'old-1',
        path: '/tmp/old-1.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'old-2',
        path: '/tmp/old-2.jsonl',
        dateBucket: '2026-04-06',
        lastModifiedMs: Date.parse('2026-04-06T10:00:00.000Z')
      }
    ]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.scanEntry = vi.fn((entry) => [
      {
        source: 'codex',
        sessionId: entry.sessionId,
        sourceRef: `${entry.sessionId}:turn-1`,
        project: entry.sessionId,
        userInput: `Import ${entry.sessionId}`,
        createdAt: `${entry.dateBucket}T10:00:00.000Z`,
        status: 'completed'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');
    vi.mocked(PrompterPanel.refresh).mockClear();
    vi.mocked(PrompterPanel.syncHistoryImport).mockClear();

    await service.runHistoryBackfill();

    expect(repositoryState.historyImport.completedEntryMtims).toEqual({
      'codex:/tmp/old-1.jsonl': Date.parse('2026-04-07T10:00:00.000Z'),
      'codex:/tmp/old-2.jsonl': Date.parse('2026-04-06T10:00:00.000Z')
    });
    expect(PrompterPanel.syncHistoryImport).toHaveBeenCalled();
    expect(PrompterPanel.refresh).toHaveBeenCalledTimes(1);
  });

  it('pauses history backfill and preserves remaining pending entries for resume', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/pending-1.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/pending-1.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        },
        {
          id: 'codex:/tmp/pending-2.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/pending-2.jsonl',
          dateBucket: '2026-04-06',
          lastModifiedMs: Date.parse('2026-04-06T10:00:00.000Z')
        },
        {
          id: 'codex:/tmp/pending-3.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/pending-3.jsonl',
          dateBucket: '2026-04-05',
          lastModifiedMs: Date.parse('2026-04-05T10:00:00.000Z')
        },
        {
          id: 'codex:/tmp/pending-4.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/pending-4.jsonl',
          dateBucket: '2026-04-04',
          lastModifiedMs: Date.parse('2026-04-04T10:00:00.000Z')
        }
      ],
      completedEntries: []
    };

    const repositoryState = structuredClone(state);
    const repository = {
      getState: vi.fn(async () => repositoryState),
      setHistoryImport: vi.fn(async (nextHistoryImport) => {
        repositoryState.historyImport = {
          ...repositoryState.historyImport,
          ...nextHistoryImport
        };
      }),
      saveImportedCards: vi.fn()
    };

    let releaseImports: (() => void) | undefined;
    const importsReleased = new Promise<void>((resolve) => {
      releaseImports = resolve;
    });
    repository.saveImportedCards.mockImplementation(async () => {
      await importsReleased;
      return [];
    });

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).historyWorkerCount = 3;
    const parser = (service as any).parser;
    parser.discoverScanEntries = vi.fn(() => [
      {
        source: 'codex',
        sessionId: 'pending-1',
        path: '/tmp/pending-1.jsonl',
        dateBucket: '2026-04-07',
        lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'pending-2',
        path: '/tmp/pending-2.jsonl',
        dateBucket: '2026-04-06',
        lastModifiedMs: Date.parse('2026-04-06T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'pending-3',
        path: '/tmp/pending-3.jsonl',
        dateBucket: '2026-04-05',
        lastModifiedMs: Date.parse('2026-04-05T10:00:00.000Z')
      },
      {
        source: 'codex',
        sessionId: 'pending-4',
        path: '/tmp/pending-4.jsonl',
        dateBucket: '2026-04-04',
        lastModifiedMs: Date.parse('2026-04-04T10:00:00.000Z')
      }
    ]);
    parser.getRunningSessionsSnapshot = vi.fn(() => new Set<string>());
    parser.scanEntry = vi.fn((entry) => [
      {
        source: 'codex',
        sessionId: entry.sessionId,
        sourceRef: `${entry.sessionId}:turn-1`,
        project: entry.sessionId,
        userInput: `Import ${entry.sessionId}`,
        createdAt: `${entry.dateBucket}T10:00:00.000Z`,
        status: 'completed'
      }
    ]);
    parser.applySessionScan = vi.fn((prompts) => ({ inserted: prompts }));

    const runPromise = service.runHistoryBackfill();
    await vi.waitFor(() => {
      expect(repository.saveImportedCards).toHaveBeenCalledTimes(3);
    });

    await service.pauseHistoryBackfill();
    releaseImports?.();
    await runPromise;

    expect(repositoryState.historyImport.status).toBe('paused');
    expect(repositoryState.historyImport.completedEntries).toHaveLength(3);
    expect(repositoryState.historyImport.pendingEntries).toEqual([
      {
        id: 'codex:/tmp/pending-4.jsonl',
        sourceType: 'codex',
        filePath: '/tmp/pending-4.jsonl',
        dateBucket: '2026-04-04',
        lastModifiedMs: Date.parse('2026-04-04T10:00:00.000Z')
      }
    ]);
  });

  it('auto-acknowledges the previous completed prompt in the same session when a new prompt arrives', async () => {
    const state = createInitialState('2026-04-08T10:30:00.000Z');
    state.cards = [
      {
        id: 'card-1',
        title: 'Previous prompt',
        content: 'Inspect the activation failure.',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-08T09:50:00.000Z',
        updatedAt: '2026-04-08T10:20:00.000Z',
        completedAt: '2026-04-08T10:20:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: true
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      acknowledgeCompletion: vi.fn().mockResolvedValue(undefined),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        title: 'Newer prompt'
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).handleNewPrompt({
      source: 'codex',
      sessionId: 'session-1',
      sourceRef: 'session-1:turn-2',
      project: 'session-1',
      userInput: 'Open the prompt workspace directly from the activity bar.',
      createdAt: '2026-04-08T10:30:00.000Z',
      status: 'running'
    });

    expect(repository.acknowledgeCompletion).toHaveBeenCalledWith('card-1');
    expect(repository.saveImportedCard).toHaveBeenCalled();
  });

  it('settles every older pending or running card from the same session when a new prompt arrives', async () => {
    const state = createInitialState('2026-04-08T10:40:00.000Z');
    state.cards = [
      {
        id: 'card-1',
        title: 'Earlier completed prompt',
        content: 'Investigate the activation failure.',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-08T09:50:00.000Z',
        updatedAt: '2026-04-08T10:05:00.000Z',
        completedAt: '2026-04-08T10:05:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: true
      },
      {
        id: 'card-2',
        title: 'Earlier active prompt',
        content: 'Open the prompt workspace from the activity bar.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-2',
        createdAt: '2026-04-08T10:10:00.000Z',
        updatedAt: '2026-04-08T10:10:00.000Z',
        lastActiveAt: '2026-04-08T10:31:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'card-3',
        title: 'Another earlier completed prompt',
        content: 'Explain the current status lanes.',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-3',
        createdAt: '2026-04-08T10:15:00.000Z',
        updatedAt: '2026-04-08T10:20:00.000Z',
        completedAt: '2026-04-08T10:20:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: true
      },
      {
        id: 'card-4',
        title: 'Another earlier active prompt',
        content: 'Polish the imported prompt timeline.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-4',
        createdAt: '2026-04-08T10:25:00.000Z',
        updatedAt: '2026-04-08T10:25:00.000Z',
        lastActiveAt: '2026-04-08T10:35:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'card-5',
        title: 'Different session prompt',
        content: 'Keep me untouched.',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'codex:session-2',
        groupName: 'session-2',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-2:turn-1',
        createdAt: '2026-04-08T09:40:00.000Z',
        updatedAt: '2026-04-08T09:50:00.000Z',
        completedAt: '2026-04-08T09:50:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: true
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      acknowledgeCompletion: vi.fn().mockResolvedValue(undefined),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-6',
        title: 'Newest prompt'
      })
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).handleNewPrompt({
      source: 'codex',
      sessionId: 'session-1',
      sourceRef: 'session-1:turn-5',
      project: 'session-1',
      userInput: 'Use the latest session understanding to continue the workflow.',
      createdAt: '2026-04-08T10:40:00.000Z',
      status: 'running'
    });

    expect(repository.acknowledgeCompletion).toHaveBeenCalledTimes(2);
    expect(repository.acknowledgeCompletion).toHaveBeenNthCalledWith(1, 'card-1');
    expect(repository.acknowledgeCompletion).toHaveBeenNthCalledWith(2, 'card-3');
    expect(repository.markCardCompletedFromLog).toHaveBeenCalledTimes(2);
    expect(repository.markCardCompletedFromLog).toHaveBeenNthCalledWith(
      1,
      'card-2',
      '2026-04-08T10:40:00.000Z',
      { justCompleted: false }
    );
    expect(repository.markCardCompletedFromLog).toHaveBeenNthCalledWith(
      2,
      'card-4',
      '2026-04-08T10:40:00.000Z',
      { justCompleted: false }
    );
    expect(repository.saveImportedCard).toHaveBeenCalled();
  });

  it('only refreshes lastActiveAt for the latest active prompt in the same session', async () => {
    const state = createInitialState('2026-04-08T10:30:00.000Z');
    state.cards = [
      {
        id: 'card-1',
        title: 'Older prompt',
        content: 'Inspect the activation failure.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-08T09:50:00.000Z',
        updatedAt: '2026-04-08T09:50:00.000Z',
        lastActiveAt: '2026-04-08T09:50:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'card-2',
        title: 'Latest prompt',
        content: 'Open the prompt workspace directly from the activity bar.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-2',
        createdAt: '2026-04-08T10:25:00.000Z',
        updatedAt: '2026-04-08T10:25:00.000Z',
        lastActiveAt: '2026-04-08T10:25:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      updateCardLastActiveAt: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    const parser = (service as any).parser;
    parser.getSessionLastModifiedMs.mockReturnValue(Date.parse('2026-04-08T10:30:00.000Z'));

    await (service as any).updateActiveCardTimestamps();

    expect(repository.updateCardLastActiveAt).toHaveBeenCalledTimes(1);
    expect(repository.updateCardLastActiveAt).toHaveBeenCalledWith(
      'session-1:turn-2',
      '2026-04-08T10:30:00.000Z'
    );
  });

  it('pauses the latest active prompt after 10s plus 45s of unchanged watch-pool activity', async () => {
    const state = createInitialState('2026-04-17T04:00:00.000Z');
    state.settings.language = 'en';
    state.settings.enableExperimentalPromptPause = true;
    state.settings.notifyOnPause = true;
    state.settings.completionTone = 'chime';
    state.cards = [
      {
        id: 'card-1',
        title: 'Tool confirmation',
        content: 'Confirm before continuing.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-17T03:59:00.000Z',
        updatedAt: '2026-04-17T03:59:00.000Z',
        lastActiveAt: '2026-04-17T03:59:00.000Z',
        dateBucket: '2026-04-17',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockImplementation(async () => state),
      updateCardRuntimeState: vi.fn().mockImplementation(async (_sourceRef: string, runtimeState: 'running' | 'paused', updatedAt: string) => {
        state.cards[0] = {
          ...state.cards[0],
          runtimeState,
          updatedAt
        };
      })
    };

    let snapshot = [{
      path: '/tmp/session-1.jsonl',
      source: 'codex' as const,
      lastSize: 120,
      lastMtimeMs: 1000,
      lastChangedAt: 1000
    }];
    let nowMs = 0;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).fileWatchPool = {
      getPoolSnapshot: vi.fn(() => snapshot)
    };
    const { PrompterPanel } = await import('../../../src/panel/PrompterPanel');

    try {
      await (service as any).registerPauseTriggers(['session-1:turn-1']);

      nowMs = 9_000;
      await (service as any).reconcilePausedPromptStates();
      expect(repository.updateCardRuntimeState).not.toHaveBeenCalled();

      nowMs = 54_999;
      await (service as any).reconcilePausedPromptStates();
      expect(repository.updateCardRuntimeState).not.toHaveBeenCalled();

      nowMs = 55_000;
      await (service as any).reconcilePausedPromptStates();

      expect(repository.updateCardRuntimeState).toHaveBeenCalledTimes(1);
      expect(repository.updateCardRuntimeState).toHaveBeenCalledWith(
        'session-1:turn-1',
        'paused',
        '1970-01-01T00:00:55.000Z'
      );
      expect(PrompterPanel.playCompletionTone).toHaveBeenCalledWith('chime');
      expect(PrompterPanel.showToast).toHaveBeenCalledWith({
        id: 'prompt-paused:card-1:1970-01-01T00:00:55.000Z',
        kind: 'info',
        message: 'Prompt paused: Tool confirmation...',
        actionLabel: 'View',
        actionCommand: 'prompter.open'
      });
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('does not register pause monitors when the experimental prompt pause setting is disabled', async () => {
    const state = createInitialState('2026-04-17T04:00:00.000Z');
    state.settings.enableExperimentalPromptPause = false;
    state.cards = [
      {
        id: 'card-1',
        title: 'Disabled pause',
        content: 'Do not monitor this prompt.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-17T03:59:00.000Z',
        updatedAt: '2026-04-17T03:59:00.000Z',
        lastActiveAt: '2026-04-17T03:59:00.000Z',
        dateBucket: '2026-04-17',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockResolvedValue(state)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).fileWatchPool = {
      getPoolSnapshot: vi.fn(() => [{
        path: '/tmp/session-1.jsonl',
        source: 'codex' as const,
        lastSize: 120,
        lastMtimeMs: 1000,
        lastChangedAt: 1000
      }])
    };

    await (service as any).registerPauseTriggers(['session-1:turn-1']);

    expect((service as any).pauseMonitors.size).toBe(0);
  });

  it('resets the pause timer when a new trigger arrives for the same session', async () => {
    const state = createInitialState('2026-04-17T04:00:00.000Z');
    state.settings.enableExperimentalPromptPause = true;
    state.cards = [
      {
        id: 'card-1',
        title: 'Second trigger',
        content: 'Keep waiting for input.',
        status: 'active',
        runtimeState: 'running',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-17T03:59:00.000Z',
        updatedAt: '2026-04-17T03:59:00.000Z',
        lastActiveAt: '2026-04-17T03:59:00.000Z',
        dateBucket: '2026-04-17',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockImplementation(async () => state),
      updateCardRuntimeState: vi.fn().mockResolvedValue(undefined)
    };

    let nowMs = 0;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).fileWatchPool = {
      getPoolSnapshot: vi.fn(() => [{
        path: '/tmp/session-1.jsonl',
        source: 'codex' as const,
        lastSize: 120,
        lastMtimeMs: 1000,
        lastChangedAt: 1000
      }])
    };

    try {
      await (service as any).registerPauseTriggers(['session-1:turn-1']);
      nowMs = 20_000;
      await (service as any).registerPauseTriggers(['session-1:turn-1']);

      nowMs = 74_999;
      await (service as any).reconcilePausedPromptStates();
      expect(repository.updateCardRuntimeState).not.toHaveBeenCalled();

      nowMs = 75_000;
      await (service as any).reconcilePausedPromptStates();
      expect(repository.updateCardRuntimeState).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('returns a paused prompt to running when watch-pool activity changes again', async () => {
    const state = createInitialState('2026-04-17T04:00:00.000Z');
    state.settings.enableExperimentalPromptPause = true;
    state.cards = [
      {
        id: 'card-1',
        title: 'Resume prompt',
        content: 'Wait for file changes.',
        status: 'active',
        runtimeState: 'paused',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-17T03:59:00.000Z',
        updatedAt: '2026-04-17T04:10:00.000Z',
        lastActiveAt: '2026-04-17T04:00:00.000Z',
        dateBucket: '2026-04-17',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockImplementation(async () => state),
      updateCardRuntimeState: vi.fn().mockImplementation(async (_sourceRef: string, runtimeState: 'running' | 'paused', updatedAt: string) => {
        state.cards[0] = {
          ...state.cards[0],
          runtimeState,
          updatedAt
        };
      })
    };

    let nowMs = 55_000;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).pauseMonitors = new Map([
      ['codex:session-1', {
        source: 'codex',
        sessionId: 'session-1',
        sourceRef: 'session-1:turn-1',
        waitUntilMs: 10_000,
        lastActivityChangeAtMs: 10_000,
        lastObservedSize: 120,
        lastObservedMtimeMs: 1000,
        isPaused: true,
        hasNotifiedPause: true
      }]
    ]);
    (service as any).fileWatchPool = {
      getPoolSnapshot: vi.fn(() => [{
        path: '/tmp/session-1.jsonl',
        source: 'codex' as const,
        lastSize: 121,
        lastMtimeMs: 2000,
        lastChangedAt: 2000
      }])
    };

    try {
      await (service as any).reconcilePausedPromptStates();
      expect(repository.updateCardRuntimeState).toHaveBeenCalledWith(
        'session-1:turn-1',
        'running',
        '1970-01-01T00:00:55.000Z'
      );
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('keeps prompts out of the paused state when the experimental prompt pause setting is disabled', async () => {
    const state = createInitialState('2026-04-17T04:00:00.000Z');
    state.settings.enableExperimentalPromptPause = false;
    state.cards = [
      {
        id: 'card-1',
        title: 'Paused prompt',
        content: 'This should resume immediately.',
        status: 'active',
        runtimeState: 'paused',
        groupId: 'codex:session-1',
        groupName: 'session-1',
        groupColor: '#22c55e',
        sourceType: 'codex',
        sourceRef: 'session-1:turn-1',
        createdAt: '2026-04-17T03:59:00.000Z',
        updatedAt: '2026-04-17T04:10:00.000Z',
        lastActiveAt: '2026-04-17T04:00:00.000Z',
        dateBucket: '2026-04-17',
        fileRefs: [],
        justCompleted: false
      }
    ];

    const repository = {
      getState: vi.fn().mockImplementation(async () => state),
      updateCardRuntimeState: vi.fn().mockImplementation(async (_sourceRef: string, runtimeState: 'running' | 'paused', updatedAt: string) => {
        state.cards[0] = {
          ...state.cards[0],
          runtimeState,
          updatedAt
        };
      })
    };

    let nowMs = 75_000;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);
    (service as any).pauseMonitors = new Map([
      ['codex:session-1', {
        source: 'codex',
        sessionId: 'session-1',
        sourceRef: 'session-1:turn-1',
        waitUntilMs: 10_000,
        lastActivityChangeAtMs: 10_000,
        lastObservedSize: 120,
        lastObservedMtimeMs: 1000,
        isPaused: true,
        hasNotifiedPause: true
      }]
    ]);
    (service as any).fileWatchPool = {
      getPoolSnapshot: vi.fn(() => [{
        path: '/tmp/session-1.jsonl',
        source: 'codex' as const,
        lastSize: 120,
        lastMtimeMs: 1000,
        lastChangedAt: 1000
      }])
    };

    try {
      await (service as any).reconcilePausedPromptStates();

      expect(repository.updateCardRuntimeState).toHaveBeenCalledWith(
        'session-1:turn-1',
        'running',
        '1970-01-01T00:01:15.000Z'
      );
      expect((service as any).pauseMonitors.size).toBe(0);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('imports silently completed prompts without awaiting confirmation', async () => {
    const state = createInitialState('2026-04-17T04:00:00.000Z');
    const repository = {
      getState: vi.fn().mockResolvedValue(state),
      saveImportedCard: vi.fn().mockResolvedValue({
        id: 'card-2',
        sourceRef: 'claude-session-1:prompt-1',
        title: 'Silent completion'
      }),
      markCardCompletedFromLog: vi.fn().mockResolvedValue(undefined)
    };

    const service = new LogSyncService(repository as never, { extensionPath: '/tmp/ext' } as ExtensionContext);

    await (service as any).handleNewPrompt({
      source: 'claude-code',
      sessionId: 'claude-session-1',
      sourceRef: 'claude-session-1:prompt-1',
      project: 'claude-session-1',
      userInput: 'Stop after the sequence.',
      createdAt: '2026-04-17T04:12:00.000Z',
      status: 'completed',
      completedAt: '2026-04-17T04:12:05.000Z',
      silentCompletion: true
    });

    expect(repository.markCardCompletedFromLog).toHaveBeenCalledWith(
      'claude-session-1:prompt-1',
      '2026-04-17T04:12:05.000Z',
      { justCompleted: false }
    );
  });
});
