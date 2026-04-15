import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState } from '../../src/shared/models';

type CommandRegistration = [string, (...args: unknown[]) => Promise<void> | void];
const mockedCreate = vi.fn();
const registerCommand = vi.fn(() => ({ dispose() {} }));
const registerWebviewViewProvider = vi.fn(() => ({ dispose() {} }));
const executeCommand = vi.fn();
const createOrShow = vi.fn();
const postMessage = vi.fn();
let capturedKeybindingsPath: string | undefined;
let currentAppName = 'Code';
let currentActiveTextEditor: { document: { uri: { scheme: string; fsPath: string } } } | undefined;

vi.mock('vscode', () => ({
  version: '1.99.0',
  env: {
    get appName() {
      return currentAppName;
    }
  },
  commands: {
    registerCommand,
    executeCommand
  },
  window: {
    get activeTextEditor() {
      return currentActiveTextEditor;
    },
    registerWebviewViewProvider,
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn()
    }))
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }]
  }
}));

vi.mock('../../src/panel/PrompterPanel', () => ({
  PrompterPanel: {
    createOrShow,
    postMessage,
    showView: vi.fn()
  }
}));

vi.mock('../../src/services/KeybindingService', () => ({
  KeybindingService: vi.fn().mockImplementation(function (this: { applyShortcuts: ReturnType<typeof vi.fn> }, keybindingsPath: string) {
    capturedKeybindingsPath = keybindingsPath;
    this.applyShortcuts = vi.fn().mockResolvedValue(undefined);
  })
}));

vi.mock('../../src/services/LogSyncService', () => ({
  LogSyncService: vi.fn().mockImplementation(function (
    this: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      runHistoryBackfill: ReturnType<typeof vi.fn>;
      pauseHistoryBackfill: ReturnType<typeof vi.fn>;
      markUserActivity: ReturnType<typeof vi.fn>;
    }
  ) {
    this.start = vi.fn();
    this.stop = vi.fn();
    this.runHistoryBackfill = vi.fn().mockResolvedValue(undefined);
    this.pauseHistoryBackfill = vi.fn().mockResolvedValue(undefined);
    this.markUserActivity = vi.fn();
  })
}));

vi.mock('../../src/state/PromptRepository', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/PromptRepository')>('../../src/state/PromptRepository');
  return {
    PromptRepository: {
      ...actual.PromptRepository,
      create: mockedCreate
    }
  };
});

describe('activate', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerCommand.mockClear();
    registerWebviewViewProvider.mockClear();
    executeCommand.mockReset();
    createOrShow.mockReset();
    postMessage.mockReset();
    mockedCreate.mockReset();
    capturedKeybindingsPath = undefined;
    const actual = await vi.importActual<typeof import('../../src/state/PromptRepository')>('../../src/state/PromptRepository');
    mockedCreate.mockImplementation(actual.PromptRepository.create);
    currentAppName = 'Code';
    currentActiveTextEditor = undefined;
  });

  it('boots the repository from the persisted data directory in global state', async () => {
    const { activate } = await import('../../src/extension');
    const context = {
      extensionUri: {} as never,
      extensionPath: '/tmp/prompter-extension',
      globalState: {
        get: vi.fn().mockReturnValue('/tmp/prompter-stored')
      },
      subscriptions: [] as { dispose(): void }[]
    };

    await activate(context as never);

    expect(context.globalState.get).toHaveBeenCalledWith('prompter.dataDir');
    expect(mockedCreate).toHaveBeenCalledWith('/tmp/prompter-stored');
    expect(registerCommand).toHaveBeenCalledTimes(5);
    expect(registerWebviewViewProvider).toHaveBeenCalledWith('prompterSidebar', expect.any(Object));
  });

  it('passes shortcut application into import flows that open the shared panel', async () => {
    const { activate } = await import('../../src/extension');
    const context = {
      extensionUri: {} as never,
      extensionPath: '/tmp/prompter-extension',
      globalState: {
        get: vi.fn().mockReturnValue('/tmp/prompter-stored')
      },
      subscriptions: [] as { dispose(): void }[]
    };

    await activate(context as never);

    const importResourceCommandCall = ((registerCommand.mock.calls as unknown) as CommandRegistration[]).find(
      (call) => call[0] === 'prompter.importResource'
    );
    await importResourceCommandCall?.[1]?.({ scheme: 'file', fsPath: '/workspace/src/app.ts' } as never);

    const actions = (createOrShow.mock.calls.at(-1) as [unknown, unknown, { applyShortcuts?: unknown }])?.[2];
    expect(typeof actions.applyShortcuts).toBe('function');
  });

  it('falls back to the active editor file when importResource is invoked without an explorer resource', async () => {
    currentActiveTextEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: '/workspace/src/from-active-editor.ts'
        }
      }
    };

    const { activate } = await import('../../src/extension');
    const context = {
      extensionUri: {} as never,
      extensionPath: '/tmp/prompter-extension',
      globalState: {
        get: vi.fn().mockReturnValue('/tmp/prompter-stored')
      },
      subscriptions: [] as { dispose(): void }[]
    };

    await activate(context as never);

    const importResourceCommandCall = ((registerCommand.mock.calls as unknown) as CommandRegistration[]).find(
      (call) => call[0] === 'prompter.importResource'
    );

    await importResourceCommandCall?.[1]?.();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'composer:insertText',
      payload: {
        text: 'File: /workspace/src/from-active-editor.ts',
        fileRefs: [{ path: '/workspace/src/from-active-editor.ts' }]
      }
    });
  });

  it('imports folder paths from the explorer into the composer', async () => {
    const { activate } = await import('../../src/extension');
    const context = {
      extensionUri: {} as never,
      extensionPath: '/tmp/prompter-extension',
      globalState: {
        get: vi.fn().mockReturnValue('/tmp/prompter-stored')
      },
      subscriptions: [] as { dispose(): void }[]
    };

    await activate(context as never);

    const importResourceCommandCall = ((registerCommand.mock.calls as unknown) as CommandRegistration[]).find(
      (call) => call[0] === 'prompter.importResource'
    );
    await importResourceCommandCall?.[1]?.({ scheme: 'file', fsPath: '/workspace/src/components' } as never);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'composer:insertText',
      payload: {
        text: 'File: /workspace/src/components',
        fileRefs: [{ path: '/workspace/src/components' }]
      }
    });
  });

  it('resolves the Cursor user keybindings path when running in Cursor', async () => {
    currentAppName = 'Cursor';

    const { activate } = await import('../../src/extension');
    const context = {
      extensionUri: {} as never,
      extensionPath: '/tmp/prompter-extension',
      globalState: {
        get: vi.fn().mockReturnValue('/tmp/prompter-stored')
      },
      subscriptions: [] as { dispose(): void }[]
    };

    await activate(context as never);

    expect(capturedKeybindingsPath).toMatch(/(?:^|[\\/])Cursor(?:[\\/]|$)/);
    expect(capturedKeybindingsPath).toMatch(/(?:^|[\\/])User(?:[\\/]|$)/);
    expect(capturedKeybindingsPath).toMatch(/keybindings\.json$/);
  });

  it('migrates only repository json files before switching directories', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'prompter-source-'));
    const targetDir = await mkdtemp(join(tmpdir(), 'prompter-target-'));
    await writeFile(
      join(sourceDir, 'cards.json'),
      JSON.stringify([
        {
          id: 'card-1',
          title: 'Card',
          content: 'Saved card content',
          status: 'unused',
          runtimeState: 'unknown',
          groupId: 'card-1',
          groupName: '未分类',
          groupColor: '#6366f1',
          sourceType: 'manual',
          createdAt: '2026-04-08T10:00:00.000Z',
          updatedAt: '2026-04-08T10:00:00.000Z',
          dateBucket: '2026-04-08',
          fileRefs: [],
          justCompleted: false
        }
      ]),
      'utf8'
    );
    await writeFile(join(sourceDir, 'modular-prompts.json'), JSON.stringify([{ id: 'mod-1', name: 'Prompt' }]), 'utf8');
    await writeFile(join(sourceDir, 'daily-stats.json'), JSON.stringify([{ date: '2026-04-08', totalCount: 1 }]), 'utf8');
    await writeFile(
      join(sourceDir, 'settings.json'),
      JSON.stringify({ ...createInitialState('2026-04-08T10:00:00.000Z').settings, dataDir: sourceDir }),
      'utf8'
    );
    await writeFile(join(sourceDir, 'notes.txt'), 'do not migrate', 'utf8');

    const { activate } = await import('../../src/extension');
    const context = {
      extensionUri: {} as never,
      extensionPath: '/tmp/prompter-extension',
      globalState: {
        get: vi.fn().mockReturnValue(sourceDir),
        update: vi.fn().mockResolvedValue(undefined)
      },
      subscriptions: [] as { dispose(): void }[]
    };

    await activate(context as never);
    const openCommandCall = ((registerCommand.mock.calls as unknown) as CommandRegistration[]).find(
      (call) => call[0] === 'prompter.open'
    );
    await openCommandCall?.[1]?.();

    const actions = (createOrShow.mock.calls.at(-1) as [unknown, unknown, { switchDataDir: (request: { targetDir: string; migrate: boolean }) => Promise<unknown> }])?.[2];

    await actions.switchDataDir({ targetDir, migrate: true });

    expect(await readFile(join(targetDir, 'cards.json'), 'utf8')).toContain('card-1');
    expect(await readFile(join(targetDir, 'modular-prompts.json'), 'utf8')).toContain('mod-1');
    expect(await readFile(join(targetDir, 'settings.json'), 'utf8')).toContain(targetDir);
    expect(await readdir(targetDir)).not.toContain('notes.txt');
  });
});
