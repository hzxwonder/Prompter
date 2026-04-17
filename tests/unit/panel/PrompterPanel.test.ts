import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable, Webview, WebviewPanel } from 'vscode';
import { createInitialState } from '../../../src/shared/models';
import { PrompterPanel } from '../../../src/panel/PrompterPanel';

const { execFile, log, logWarn, logError } = vi.hoisted(() => ({
  execFile: vi.fn((_cmd: string, _args: string[], callback?: (error: Error | null) => void) => {
    callback?.(null);
  }),
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
    showWarningMessage: vi.fn()
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }]
  },
  ViewColumn: { Active: 1 }
}));

vi.mock('../../../src/panel/getWebviewHtml', () => ({
  getWebviewHtml: vi.fn(() => '<html></html>')
}));

vi.mock('node:child_process', () => ({
  execFile
}));

vi.mock('../../../src/logger', () => ({
  log,
  logWarn,
  logError
}));

function createDisposable(): Disposable {
  return { dispose() {} };
}

function createMockPanel(
  postMessage: ReturnType<typeof vi.fn>,
  onDidReceiveMessage: Webview['onDidReceiveMessage']
): WebviewPanel {
  const webview = {
    options: {},
    html: '',
    cspSource: 'test-csp',
    postMessage,
    onDidReceiveMessage,
    asWebviewUri: vi.fn()
  } as unknown as Webview;

  return {
    viewType: 'prompter',
    title: 'Prompter',
    iconPath: undefined,
    options: {},
    viewColumn: undefined,
    active: true,
    visible: true,
    webview,
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(() => createDisposable()),
    onDidChangeViewState: vi.fn(() => createDisposable())
  } as unknown as WebviewPanel;
}

describe('PrompterPanel', () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.createWebviewPanel).mockReset();
    vi.mocked(vscode.window.showWarningMessage).mockReset();
    execFile.mockClear();
    log.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    PrompterPanel['currentPanel'] = undefined;
  });

  it('persists settings updates and clears cached state through extension messages', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const updatedState = {
      ...initialState,
      settings: {
        ...initialState.settings,
        notifyOnFinish: false
      }
    };
    const clearedState = {
      ...updatedState,
      cards: [],
      modularPrompts: [],
      dailyStats: []
    };
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: { type: 'settings:update'; payload: { notifyOnFinish: boolean } } | { type: 'cache:clear' }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('确认清理' as never);

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      updateSettings: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      getState: vi
        .fn()
        .mockResolvedValueOnce(updatedState)
        .mockResolvedValueOnce(clearedState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({ type: 'settings:update', payload: { notifyOnFinish: false } });
    await onDidReceiveMessage?.({ type: 'cache:clear' });

    expect(repository.updateSettings).toHaveBeenCalledWith({ notifyOnFinish: false });
    expect(repository.clearCache).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'state:replace',
      payload: updatedState
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'state:replace',
      payload: clearedState
    });
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      '是否确认清理 Prompter 缓存？此操作会移除当前工作区中的缓存 prompt 数据和导入状态。',
      '确认清理',
      '取消'
    );
  });

  it('does not clear cache when the user cancels the confirmation dialog', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: { type: 'cache:clear' }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('取消' as never);

    const repository = {
      clearCache: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(initialState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({ type: 'cache:clear' });

    expect(repository.clearCache).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith({
      type: 'state:replace',
      payload: initialState
    });
  });

  it('reports user activity before handling incoming webview messages', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const postMessage = vi.fn();
    const onUserActivity = vi.fn();
    let onDidReceiveMessage:
      | ((message: { type: 'draft:autosave'; payload: { title: string; content: string; fileRefs: [] } }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      saveDraft: vi.fn().mockResolvedValue({
        id: 'card-1',
        title: 'Draft',
        content: 'Keep workspace responsive',
        status: 'unused',
        runtimeState: 'unknown',
        groupId: 'g1',
        groupName: 'g1',
        groupColor: '#000000',
        sourceType: 'manual',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }),
      getState: vi.fn().mockResolvedValue(initialState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never, {
      switchDataDir: vi.fn() as never,
      onUserActivity
    });

    await onDidReceiveMessage?.({
      type: 'draft:autosave',
      payload: { title: 'Draft', content: 'Keep workspace responsive', fileRefs: [] }
    });

    expect(onUserActivity).toHaveBeenCalledTimes(1);
  });

  it('forwards history import start and pause requests through panel actions', async () => {
    const postMessage = vi.fn();
    const startHistoryImport = vi.fn().mockResolvedValue(undefined);
    const pauseHistoryImport = vi.fn().mockResolvedValue(undefined);
    let onDidReceiveMessage:
      | ((message: { type: 'historyImport:start' } | { type: 'historyImport:pause' }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      getState: vi.fn().mockResolvedValue({
        ...createInitialState('2026-04-08T10:00:00.000Z'),
        historyImport: {
          ...createInitialState('2026-04-08T10:00:00.000Z').historyImport,
          scope: 'history-backfill',
          status: 'paused',
          warningAcknowledged: true
        }
      })
    };

    await PrompterPanel.createOrShow({} as never, repository as never, {
      switchDataDir: vi.fn() as never,
      startHistoryImport,
      pauseHistoryImport
    });

    await onDidReceiveMessage?.({ type: 'historyImport:start' });
    await onDidReceiveMessage?.({ type: 'historyImport:pause' });

    expect(startHistoryImport).toHaveBeenCalledTimes(1);
    expect(pauseHistoryImport).toHaveBeenCalledTimes(1);
  });

  it('pushes history import updates without requiring a full panel refresh', async () => {
    const postMessage = vi.fn();
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, () => createDisposable())
    );

    const state = createInitialState('2026-04-08T10:00:00.000Z');
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'running',
      processedSources: 3,
      totalSources: 10
    };

    const repository = {
      getState: vi.fn().mockResolvedValue(state)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);
    postMessage.mockClear();

    await PrompterPanel.syncHistoryImport(repository as never);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'historyImport:updated',
      payload: state.historyImport
    });
  });

  it('posts toast messages through the active Prompter panel', async () => {
    const postMessage = vi.fn().mockResolvedValue(true);
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, () => createDisposable())
    );

    const repository = {
      getState: vi.fn().mockResolvedValue(createInitialState('2026-04-16T09:00:00.000Z'))
    };

    await PrompterPanel.createOrShow({} as never, repository as never);
    postMessage.mockClear();

    await PrompterPanel.showToast({
      id: 'toast-1',
      kind: 'info',
      message: 'Prompt completed',
      actionLabel: 'View',
      actionCommand: 'prompter.open'
    } as never);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'toast:show',
      payload: {
        id: 'toast-1',
        kind: 'info',
        message: 'Prompt completed',
        actionLabel: 'View',
        actionCommand: 'prompter.open'
      }
    });
  });

  it('plays the built-in completion tone through a host-side fallback when the panel is closed', () => {
    PrompterPanel['currentPanel'] = undefined;

    PrompterPanel.playCompletionTone('chime');

    expect(log).toHaveBeenCalledWith('[PrompterPanel] Completion tone requested: chime, using host fallback playback');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[PrompterPanel] Host tone playback starting'));
    expect(execFile).toHaveBeenCalled();
  });

  it('uses host playback for built-in tones even when the panel is open', async () => {
    const postMessage = vi.fn().mockResolvedValue(true);
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, () => createDisposable())
    );

    const repository = {
      getState: vi.fn().mockResolvedValue(createInitialState('2026-04-16T09:00:00.000Z'))
    };

    await PrompterPanel.createOrShow({} as never, repository as never);
    postMessage.mockClear();

    PrompterPanel.playCompletionTone('ding');

    expect(log).toHaveBeenCalledWith(
      '[PrompterPanel] Completion tone requested: ding, using host playback even though the panel is open'
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[PrompterPanel] Host tone playback starting'));
    expect(postMessage).not.toHaveBeenCalledWith({
      type: 'audio:play',
      payload: { tone: 'ding' }
    });
    expect(execFile).toHaveBeenCalled();
  });

  it('uses active webview playback when explicitly requested and the panel is open', async () => {
    const postMessage = vi.fn().mockResolvedValue(true);
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, () => createDisposable())
    );

    const repository = {
      getState: vi.fn().mockResolvedValue(createInitialState('2026-04-16T09:00:00.000Z'))
    };

    await PrompterPanel.createOrShow({} as never, repository as never);
    postMessage.mockClear();

    const played = PrompterPanel.playCompletionToneInWebviewIfOpen('ding');

    expect(played).toBe(true);
    expect(log).toHaveBeenCalledWith('[PrompterPanel] Completion tone requested: ding, using active webview playback');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'audio:play',
      payload: { tone: 'ding' }
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('returns false when explicit webview playback is requested without an open panel', () => {
    PrompterPanel['currentPanel'] = undefined;

    const played = PrompterPanel.playCompletionToneInWebviewIfOpen('chime');

    expect(played).toBe(false);
    expect(log).toHaveBeenCalledWith('[PrompterPanel] Webview tone requested for chime, but no active panel is open');
  });

  it('logs Linux fallback transitions when builtin tone playback falls back from aplay to paplay to shell bell', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    execFile.mockImplementation((cmd: string, _args: string[], callback?: (error: Error | null) => void) => {
      if (cmd === 'aplay' || cmd === 'paplay') {
        callback?.(new Error(`${cmd} failed`));
        return;
      }

      callback?.(null);
    });

    PrompterPanel.playCompletionTone('soft-bell');

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('aplay failed for tone soft-bell'));
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('paplay failed for tone soft-bell'));
    expect(log).toHaveBeenCalledWith('[PrompterPanel] Falling back to shell bell for tone: soft-bell');
    expect(execFile).toHaveBeenCalledWith('sh', ['-lc', 'printf "\\a"'], expect.any(Function));
  });

  it('logs an error when the Linux shell bell fallback also fails', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    execFile.mockImplementation((cmd: string, _args: string[], callback?: (error: Error | null) => void) => {
      callback?.(new Error(`${cmd} failed`));
    });

    PrompterPanel.playCompletionTone('soft-bell');

    expect(logError).toHaveBeenCalledWith(
      'Failed to play fallback bell for tone: soft-bell',
      expect.objectContaining({ message: 'sh failed' })
    );
  });

  it('asks for confirmation before starting history import for the first time', async () => {
    const postMessage = vi.fn();
    const startHistoryImport = vi.fn().mockResolvedValue(undefined);
    let onDidReceiveMessage:
      | ((message: { type: 'historyImport:start' }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('开始' as never);

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      getState: vi.fn().mockResolvedValue({
        ...createInitialState('2026-04-08T10:00:00.000Z'),
        historyImport: {
          ...createInitialState('2026-04-08T10:00:00.000Z').historyImport,
          scope: 'history-backfill',
          status: 'idle',
          warningAcknowledged: false
        }
      }),
      setHistoryImport: vi.fn().mockResolvedValue(undefined)
    };

    await PrompterPanel.createOrShow({} as never, repository as never, {
      switchDataDir: vi.fn() as never,
      startHistoryImport
    });

    await onDidReceiveMessage?.({ type: 'historyImport:start' });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      '历史日志处理可能会占用一定内存和时间。处理期间，VS Code / Cursor 可能出现短暂卡顿，这是正常现象。建议尽量在暂时不需要使用编辑器时进行处理。是否开始？',
      '开始',
      '取消'
    );
    expect(repository.setHistoryImport).toHaveBeenCalledWith({ warningAcknowledged: true });
    expect(startHistoryImport).toHaveBeenCalledTimes(1);
  });

  it('reports an error when shortcut updates are requested without an apply action', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    initialState.settings.language = 'en';
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: {
          type: 'settings:update';
          payload: Partial<typeof initialState.settings>;
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      updateSettings: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(initialState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({
      type: 'settings:update',
      payload: { shortcuts: initialState.settings.shortcuts }
    });

    expect(repository.updateSettings).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'settings:shortcuts:update:error',
      payload: { message: 'Shortcut updates are unavailable in this panel' }
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'state:replace',
      payload: initialState
    });
    expect(postMessage).not.toHaveBeenCalledWith({
      type: 'settings:shortcuts:update:success',
      payload: { shortcuts: initialState.settings.shortcuts }
    });
  });

  it('applies shortcut updates before persisting settings and acknowledging success', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const nextState = {
      ...initialState,
      settings: {
        ...initialState.settings,
        shortcuts: {
          ...initialState.settings.shortcuts,
          'prompter.open': {
            ...initialState.settings.shortcuts['prompter.open'],
            keybinding: 'cmd+shift+p'
          }
        }
      }
    };
    const order: string[] = [];
    const postMessage = vi.fn((message) => {
      if (message.type === 'state:replace') {
        order.push('state');
      }
      if (message.type === 'settings:shortcuts:update:success') {
        order.push('success');
      }
    });
    let onDidReceiveMessage:
      | ((message: {
          type: 'settings:update';
          payload: Partial<typeof initialState.settings>;
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const applyShortcuts = vi.fn(async () => {
      order.push('apply');
    });
    const repository = {
      updateSettings: vi.fn(async () => {
        order.push('update');
      }),
      getState: vi.fn().mockResolvedValue(nextState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never, {
      switchDataDir: vi.fn() as never,
      applyShortcuts
    });

    await onDidReceiveMessage?.({
      type: 'settings:update',
      payload: { shortcuts: nextState.settings.shortcuts }
    });

    expect(applyShortcuts).toHaveBeenCalledWith(nextState.settings.shortcuts);
    expect(repository.updateSettings).toHaveBeenCalledWith({ shortcuts: nextState.settings.shortcuts });
    expect(order).toEqual(['apply', 'update', 'state', 'success']);
  });

  it('rolls back shortcut writes when persisting settings fails', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const nextShortcuts = {
      ...initialState.settings.shortcuts,
      'prompter.open': {
        ...initialState.settings.shortcuts['prompter.open'],
        keybinding: 'cmd+shift+p'
      }
    };
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: {
          type: 'settings:update';
          payload: Partial<typeof initialState.settings>;
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const applyShortcuts = vi.fn().mockResolvedValue(undefined);
    const repository = {
      updateSettings: vi.fn().mockRejectedValue(new Error('persist failed')),
      getState: vi.fn().mockResolvedValue(initialState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never, {
      switchDataDir: vi.fn() as never,
      applyShortcuts
    });

    await onDidReceiveMessage?.({
      type: 'settings:update',
      payload: { shortcuts: nextShortcuts }
    });

    expect(applyShortcuts).toHaveBeenNthCalledWith(1, nextShortcuts);
    expect(applyShortcuts).toHaveBeenNthCalledWith(2, initialState.settings.shortcuts);
    expect(repository.updateSettings).toHaveBeenCalledWith({ shortcuts: nextShortcuts });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'settings:shortcuts:update:error',
      payload: { message: 'persist failed' }
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'state:replace',
      payload: initialState
    });
  });

  it('posts a replacement state after switching to a new data directory', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const switchedState = {
      ...initialState,
      settings: {
        ...initialState.settings,
        dataDir: '/tmp/prompter-next'
      }
    };
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: {
          type: 'settings:dataDirSwitch';
          payload: { targetDir: string; migrate: boolean };
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const switchDataDir = vi.fn().mockResolvedValue(switchedState);
    const repository = {
      getState: vi.fn()
    };

    await (PrompterPanel as unknown as { createOrShow: (...args: unknown[]) => Promise<void> }).createOrShow(
      {} as never,
      repository as never,
      { switchDataDir } as never
    );

    await onDidReceiveMessage?.({
      type: 'settings:dataDirSwitch',
      payload: { targetDir: '/tmp/prompter-next', migrate: true }
    });

    expect(switchDataDir).toHaveBeenCalledWith({ targetDir: '/tmp/prompter-next', migrate: true });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'state:replace',
      payload: switchedState
    });
  });

  it('posts a replacement state when the webview changes active view', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const postMessage = vi.fn();
    let onDidReceiveMessage: ((message: { type: 'ready' } | { type: 'view:set'; payload: { view: 'workspace' | 'history' | 'settings' } }) => Promise<void>) | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      getState: vi.fn().mockResolvedValue(initialState)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({ type: 'view:set', payload: { view: 'settings' } });

    expect(repository.getState).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'state:replace',
      payload: { ...initialState, activeView: 'settings' }
    });
  });

  it('saves an autosaved draft and posts updated state back to the webview', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const card = {
      id: 'card-1',
      title: 'Draft title',
      content: 'Draft content',
      status: 'unused' as const,
      runtimeState: 'unknown' as const,
      groupId: 'Group A',
      groupName: 'Group A',
      groupColor: '#7C3AED',
      sourceType: 'manual' as const,
      createdAt: '2026-04-08T10:00:00.000Z',
      updatedAt: '2026-04-08T10:00:00.000Z',
      dateBucket: '2026-04-08',
      fileRefs: [{ path: '/workspace/src/api.ts', startLine: 4, endLine: 8 }],
      justCompleted: false
    };
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: {
          type: 'draft:autosave';
          payload: { title: string; content: string; fileRefs: { path: string; startLine?: number; endLine?: number }[] };
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      getState: vi.fn().mockResolvedValue({ ...initialState, cards: [card] }),
      saveDraft: vi.fn().mockResolvedValue(card)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({
      type: 'draft:autosave',
      payload: {
        title: 'Draft title',
        content: 'Draft content',
        fileRefs: [{ path: '/workspace/src/api.ts', startLine: 4, endLine: 8 }]
      }
    });

    expect(repository.saveDraft).toHaveBeenCalledWith({
      title: 'Draft title',
      content: 'Draft content',
      sourceType: 'manual',
      fileRefs: [{ path: '/workspace/src/api.ts', startLine: 4, endLine: 8 }]
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'draft:saved',
      payload: {
        card,
        state: { ...initialState, cards: [card] }
      }
    });
  });

  it('imports dropped file paths and posts inserted text back to the webview', async () => {
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: {
          type: 'composer:importFiles';
          payload: { filePaths: string[]; insertAt?: number };
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      getState: vi.fn()
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({
      type: 'composer:importFiles',
      payload: {
        filePaths: ['/workspace/src/feature/auth.ts', '/workspace/src/api.ts'],
        insertAt: 12
      }
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'composer:insertText',
      payload: {
        text: 'File: /workspace/src/feature/auth.ts\nFile: /workspace/src/api.ts',
        fileRefs: [{ path: '/workspace/src/feature/auth.ts' }, { path: '/workspace/src/api.ts' }],
        insertAt: 12
      }
    });
  });

  it('saves a modular prompt and posts refreshed state back to the webview', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const postMessage = vi.fn();
    let onDidReceiveMessage:
      | ((message: {
          type: 'modularPrompt:save';
          payload: { id?: string; name: string; content: string; category: string };
        }) => Promise<void>)
      | undefined;
    const vscode = await import('vscode');

    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
      createMockPanel(postMessage, (listener) => {
        onDidReceiveMessage = listener as typeof onDidReceiveMessage;
        return createDisposable();
      })
    );

    const repository = {
      getState: vi.fn().mockResolvedValue({
        ...initialState,
        modularPrompts: [
          {
            id: 'mod-1',
            name: 'root-cause',
            content: 'List the symptoms, identify the trigger, then propose the fix.',
            category: 'analysis',
            updatedAt: '2026-04-08T10:00:00.000Z'
          }
        ]
      }),
      saveModularPrompt: vi.fn().mockResolvedValue(undefined)
    };

    await PrompterPanel.createOrShow({} as never, repository as never);

    await onDidReceiveMessage?.({
      type: 'modularPrompt:save',
      payload: {
        name: 'root-cause',
        content: 'List the symptoms, identify the trigger, then propose the fix.',
        category: 'analysis'
      }
    });

    expect(repository.saveModularPrompt).toHaveBeenCalledWith({
      name: 'root-cause',
      content: 'List the symptoms, identify the trigger, then propose the fix.',
      category: 'analysis'
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'modularPrompts:updated',
      payload: {
        state: {
          ...initialState,
          modularPrompts: [
            {
              id: 'mod-1',
              name: 'root-cause',
              content: 'List the symptoms, identify the trigger, then propose the fix.',
              category: 'analysis',
              updatedAt: '2026-04-08T10:00:00.000Z'
            }
          ]
        }
      }
    });
  });
});
