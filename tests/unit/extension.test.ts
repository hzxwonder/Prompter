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
const showInformationMessage = vi.fn();
const showErrorMessage = vi.fn();
const createOrShow = vi.fn();
const postMessage = vi.fn();
const syncUninstallDataDir = vi.fn().mockResolvedValue(undefined);
let capturedKeybindingsPath: string | undefined;
let currentAppName = 'Code';
let currentLanguage = 'zh-cn';
let currentActiveTextEditor: { document: { uri: { scheme: string; fsPath: string } } } | undefined;

vi.mock('vscode', () => ({
  version: '1.99.0',
  env: {
    get appName() {
      return currentAppName;
    },
    get language() {
      return currentLanguage;
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
    showInformationMessage,
    showErrorMessage,
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

vi.mock('../../src/uninstall/uninstallCleanup', () => ({
  syncUninstallDataDir
}));

function createTestContext(options?: { storedDataDir?: string; storedReloadPromptVersion?: string }) {
  return {
    extensionUri: {} as never,
    extensionPath: '/tmp/prompter-extension',
    extension: {
      packageJSON: {
        version: '1.2.3'
      }
    },
    globalState: {
      get: vi.fn((key: string) => {
        if (key === 'prompter.lastReloadPromptVersion') {
          return options?.storedReloadPromptVersion;
        }

        if (key === 'prompter.dataDir') {
          return options?.storedDataDir ?? '/tmp/prompter-stored';
        }

        return undefined;
      }),
      update: vi.fn().mockResolvedValue(undefined)
    },
    subscriptions: [] as { dispose(): void }[]
  };
}

describe('activate', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerCommand.mockClear();
    registerWebviewViewProvider.mockClear();
    executeCommand.mockReset();
    showInformationMessage.mockReset();
    showErrorMessage.mockReset();
    createOrShow.mockReset();
    postMessage.mockReset();
    syncUninstallDataDir.mockReset();
    syncUninstallDataDir.mockResolvedValue(undefined);
    mockedCreate.mockReset();
    capturedKeybindingsPath = undefined;
    const actual = await vi.importActual<typeof import('../../src/state/PromptRepository')>('../../src/state/PromptRepository');
    mockedCreate.mockImplementation(actual.PromptRepository.create);
    currentAppName = 'Code';
    currentLanguage = 'zh-cn';
    currentActiveTextEditor = undefined;
  });

  it('boots the repository from the persisted data directory in global state', async () => {
    const { activate } = await import('../../src/extension');
    const context = createTestContext();

    await activate(context as never);

    expect(context.globalState.get).toHaveBeenCalledWith('prompter.dataDir');
    expect(mockedCreate).toHaveBeenCalledWith('/tmp/prompter-stored');
    expect(syncUninstallDataDir).toHaveBeenCalledWith('/tmp/prompter-stored');
    expect(registerCommand).toHaveBeenCalledTimes(5);
    expect(registerWebviewViewProvider).toHaveBeenCalledWith('prompterSidebar', expect.any(Object));
  });

  it('passes shortcut application into import flows that open the shared panel', async () => {
    const { activate } = await import('../../src/extension');
    const context = createTestContext();

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
    const context = createTestContext();

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
    const context = createTestContext();

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
    const context = createTestContext();

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
    const context = createTestContext({ storedDataDir: sourceDir });

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
    expect(syncUninstallDataDir).toHaveBeenCalledWith(targetDir);
  });

  it('prompts for reload on first install and stores the current version', async () => {
    const { activate } = await import('../../src/extension');
    const context = createTestContext();

    await activate(context as never);

    expect(showInformationMessage).toHaveBeenCalledWith(
      'Prompter 已安装或更新。请重新加载窗口以完成扩展启用。',
      '重新加载'
    );
    expect(context.globalState.update).toHaveBeenCalledWith('prompter.lastReloadPromptVersion', '1.2.3');
  });

  it('prompts for reload after an upgrade', async () => {
    const { activate } = await import('../../src/extension');
    const context = createTestContext({ storedReloadPromptVersion: '1.2.2' });

    await activate(context as never);

    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    expect(context.globalState.update).toHaveBeenCalledWith('prompter.lastReloadPromptVersion', '1.2.3');
  });

  it('does not prompt again for the same version', async () => {
    const { activate } = await import('../../src/extension');
    const context = createTestContext({ storedReloadPromptVersion: '1.2.3' });

    await activate(context as never);

    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(context.globalState.update).not.toHaveBeenCalledWith('prompter.lastReloadPromptVersion', '1.2.3');
  });

  it('reloads the window when the user accepts the prompt', async () => {
    showInformationMessage.mockResolvedValue('重新加载');

    const { activate } = await import('../../src/extension');
    const context = createTestContext();

    await activate(context as never);

    expect(executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
  });

  it('shows a Chinese recovery message when activation fails during install', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('corrupted cache'));
    currentLanguage = 'zh-cn';

    const { activate } = await import('../../src/extension');
    const context = createTestContext();

    await expect(activate(context as never)).rejects.toThrow('corrupted cache');

    expect(showErrorMessage).toHaveBeenCalledWith(
      'Prompter 扩展激活失败。请先打开设置页面，执行“缓存清理”，然后再重启 Cursor/VScode。'
    );
  });

  it('shows an English recovery message when activation fails during install', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('corrupted cache'));
    currentLanguage = 'en';

    const { activate } = await import('../../src/extension');
    const context = createTestContext();

    await expect(activate(context as never)).rejects.toThrow('corrupted cache');

    expect(showErrorMessage).toHaveBeenCalledWith(
      'Prompter failed to activate. Open Settings, run "Clear Cache", and then restart Cursor/VS Code.'
    );
  });
});
