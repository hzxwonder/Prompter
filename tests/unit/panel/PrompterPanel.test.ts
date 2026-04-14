import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable, Webview, WebviewPanel } from 'vscode';
import { createInitialState } from '../../../src/shared/models';
import { PrompterPanel } from '../../../src/panel/PrompterPanel';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn()
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }]
  },
  ViewColumn: { Active: 1 }
}));

vi.mock('../../../src/panel/getWebviewHtml', () => ({
  getWebviewHtml: vi.fn(() => '<html></html>')
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
  beforeEach(async () => {
    const vscode = await import('vscode');
    vi.mocked(vscode.window.createWebviewPanel).mockReset();
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
