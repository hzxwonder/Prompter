import '@testing-library/jest-dom/vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../webview/src/App';
import { createInitialState, type PrompterState } from '../../src/shared/models';

vi.mock('../../webview/src/api/vscode', () => ({
  postMessage: vi.fn()
}));

afterEach(() => {
  cleanup();
});

const TODAY = new Date().toISOString().slice(0, 10);

const cardState = (): PrompterState => ({
  ...createInitialState(`${TODAY}T10:00:00.000Z`),
  cards: [
    {
      id: 'unused-1',
      title: 'Draft API prompt',
      content: 'Map the API surface before refactoring.',
      status: 'unused',
      runtimeState: 'unknown',
      groupId: 'session-a',
      groupName: 'api',
      groupColor: '#7C3AED',
      sourceType: 'manual',
      createdAt: `${TODAY}T10:00:00.000Z`,
      updatedAt: `${TODAY}T10:00:00.000Z`,
      dateBucket: TODAY,
      fileRefs: [],
      justCompleted: false
    },
    {
      id: 'active-just-finished-1',
      title: 'Wrap release summary',
      content: 'Summarize the shipped changes.',
      status: 'active',
      runtimeState: 'finished',
      groupId: 'session-b',
      groupName: 'release',
      groupColor: '#10B981',
      sourceType: 'codex',
      createdAt: `${TODAY}T09:00:00.000Z`,
      updatedAt: `${TODAY}T10:30:00.000Z`,
      completedAt: `${TODAY}T10:30:00.000Z`,
      dateBucket: TODAY,
      fileRefs: [],
      justCompleted: true
    }
  ]
});

beforeEach(async () => {
  const vscodeApi = await import('../../webview/src/api/vscode');
  vi.mocked(vscodeApi.postMessage).mockReset();
});

describe('App shell', () => {
  it('switches pages from the left sidebar', async () => {
    const user = userEvent.setup();

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    expect(screen.getByRole('button', { name: '工作台' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '历史' }));
    expect(screen.getByText('还没有 prompt 活动记录。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('heading', { name: '通用' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '快捷键' }));
    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByText('Open Prompter')).toBeInTheDocument();
  });

  it('renders workspace lanes with saved cards', () => {
    render(<App initialState={cardState()} />);

    expect(screen.getByRole('region', { name: '使用中' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '已完成' })).toBeInTheDocument();
    expect(screen.getByText('Map the API surface before refactoring.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已完成，待确认，点击移入已完成' })).toBeInTheDocument();
  });

  it('switches sidebar and workspace copy to English when the setting is English', () => {
    const englishState = cardState();
    englishState.settings.language = 'en';

    render(<App initialState={englishState} />);

    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prompt Status' })).toBeInTheDocument();
    expect(screen.getByText('Manage today\'s prompts and in-progress work by lane.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In Progress' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed, awaiting confirmation. Move to completed.' })).toBeInTheDocument();
  });

  it('shows all workspace prompts in list view ordered by confirmation priority then latest time', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-08T11:00:00.000Z'));
    const user = userEvent.setup();
    const state = createInitialState('2026-04-08T11:00:00.000Z');

    state.cards = [
      {
        id: 'completed-latest',
        title: 'Completed latest',
        content: 'Completed latest prompt',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'completed',
        groupName: 'completed',
        groupColor: '#22c55e',
        sourceType: 'manual',
        createdAt: '2026-04-08T10:55:00.000Z',
        updatedAt: '2026-04-08T10:55:00.000Z',
        completedAt: '2026-04-08T10:55:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'unused-oldest',
        title: 'Unused oldest',
        content: 'Unused oldest prompt',
        status: 'unused',
        runtimeState: 'unknown',
        groupId: 'unused',
        groupName: 'unused',
        groupColor: '#64748b',
        sourceType: 'manual',
        createdAt: '2026-04-08T09:10:00.000Z',
        updatedAt: '2026-04-08T09:10:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'active-middle',
        title: 'Active middle',
        content: 'Active middle prompt',
        status: 'active',
        runtimeState: 'running',
        groupId: 'active',
        groupName: 'active',
        groupColor: '#3b82f6',
        sourceType: 'manual',
        createdAt: '2026-04-08T10:50:00.000Z',
        updatedAt: '2026-04-08T10:50:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'awaiting-old',
        title: 'Awaiting old',
        content: 'Awaiting old prompt',
        status: 'active',
        runtimeState: 'running',
        groupId: 'awaiting',
        groupName: 'awaiting',
        groupColor: '#8b5cf6',
        sourceType: 'manual',
        createdAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'unused-latest',
        title: 'Unused latest',
        content: 'Unused latest prompt',
        status: 'unused',
        runtimeState: 'unknown',
        groupId: 'unused-2',
        groupName: 'unused-2',
        groupColor: '#334155',
        sourceType: 'manual',
        createdAt: '2026-04-08T10:40:00.000Z',
        updatedAt: '2026-04-08T10:40:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ];

    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '列表视图' }));

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(5);
    expect(within(cards[0]!).getByText('Awaiting old prompt')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('创建于 2026-04-08 09:00')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Unused latest prompt')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Unused oldest prompt')).toBeInTheDocument();
    expect(within(cards[3]!).getByText('Active middle prompt')).toBeInTheDocument();
    expect(within(cards[4]!).getByText('Completed latest prompt')).toBeInTheDocument();
    dateNowSpy.mockRestore();
  });

  it('uses per-card delete actions instead of the trash zone in list view', async () => {
    const user = userEvent.setup();
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={cardState()} />);

    await user.click(screen.getByRole('button', { name: '列表视图' }));

    expect(screen.queryByText('拖拽至此删除')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '删除 prompt' })[0]!);

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'card:delete',
      payload: { cardId: 'active-just-finished-1' }
    });
  });

  it('posts card updates for session-scoped group rename and completion acknowledgement', async () => {
    const user = userEvent.setup();
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={cardState()} />);

    await user.click(screen.getAllByRole('button', { name: 'Rename group' })[0]!);
    const input = screen.getByRole('textbox', { name: 'Group name' });
    await user.clear(input);
    await user.type(input, 'platform');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: '已完成，待确认，点击移入已完成' }));

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'group:rename',
      payload: { groupId: 'session-a', nextName: 'platform' }
    });
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'card:acknowledgeCompletion',
      payload: { cardId: 'active-just-finished-1' }
    });
  });

  it('loads card content into the composer and scrolls focus to the prompt on double click', async () => {
    const user = userEvent.setup();

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    render(<App initialState={cardState()} />);

    await user.dblClick(screen.getByText('Map the API surface before refactoring.'));

    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    expect(prompt).toHaveValue('Map the API surface before refactoring.');
    expect(scrollIntoView).toHaveBeenCalled();
    await waitFor(() => {
      expect(prompt).toHaveFocus();
    });
  });

  it('keeps the edited unused card content in the composer when leaving workspace', async () => {
    const user = userEvent.setup();
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={cardState()} />);

    await user.dblClick(screen.getByText('Map the API surface before refactoring.'));
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    await user.clear(prompt);
    await user.type(prompt, 'Updated unused prompt');
    await user.click(screen.getByRole('button', { name: '历史' }));
    await user.click(screen.getByRole('button', { name: '工作台' }));

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Updated unused prompt');
    expect(vscodeApi.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'card:update' })
    );
  });

  it('preserves the first mouse selection in the prompt editor', () => {
    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    const prompt = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;

    fireEvent.change(prompt, { target: { value: 'Select this text once' } });
    fireEvent.select(prompt, {
      target: {
        selectionStart: 0,
        selectionEnd: 18
      }
    });

    expect(prompt.selectionStart).toBe(0);
    expect(prompt.selectionEnd).toBe(18);
  });

  it('keeps imported text in the composer when navigating away from workspace', async () => {
    const user = userEvent.setup();
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(
      <App
        initialState={createInitialState('2026-04-08T10:00:00.000Z')}
        lastMessage={{
          type: 'composer:insertText',
          payload: {
            text: 'File: /workspace/src/api.ts:4-8\n```ts\nexport function load() {}\n```',
            fileRefs: [{ path: '/workspace/src/api.ts', startLine: 4, endLine: 8 }]
          }
        }}
      />
    );

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue(
      'File: /workspace/src/api.ts:4-8\n```ts\nexport function load() {}\n```'
    );

    await user.click(screen.getByRole('button', { name: '历史' }));

    expect(vscodeApi.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'draft:autosave' })
    );
  });

  it('appends imported text on the next line without adding blank lines', async () => {
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    const { rerender } = render(<App initialState={initialState} />);

    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    fireEvent.change(prompt, { target: { value: 'Existing draft' } });

    rerender(
      <App
        initialState={initialState}
        lastMessage={{
          type: 'composer:insertText',
          payload: {
            text: 'Imported block'
          }
        }}
      />
    );

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Existing draft\nImported block');
  });

  it('requests dropped file imports from the extension', async () => {
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    fireEvent.drop(screen.getByRole('textbox', { name: 'Prompt' }), {
      dataTransfer: {
        files: [{ path: '/workspace/src/feature/auth.ts' }],
        types: ['Files'],
        getData: vi.fn(() => '')
      }
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'composer:importFiles',
      payload: { filePaths: ['/workspace/src/feature/auth.ts'], insertAt: 0 }
    });
  });

  it('blocks native file-open drops even when the path payload is unavailable', async () => {
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    const dropEvent = createEvent.drop(prompt, {
      dataTransfer: {
        files: [{}],
        types: ['Files'],
        getData: vi.fn(() => '')
      }
    });

    fireEvent(prompt, dropEvent);

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it('expands long prompt cards from the icon button without triggering copy', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText
      }
    });

    render(
      <App
        initialState={{
          ...cardState(),
          cards: [
            {
              ...cardState().cards[0]!,
              content:
                'Line 1 with detailed implementation notes that exceed the preview threshold.\nLine 2 keeps the text long enough to require expansion.\nLine 3 adds more content for the collapsed preview.\nLine 4 is still not the end of the prompt card content.\nLine 5 should only be fully visible after expanding.'
            },
            cardState().cards[1]!
          ]
        }}
      />
    );

    const lane = screen.getByRole('region', { name: '未使用' });
    const card = within(lane).getByText(/Line 1 with detailed implementation notes/).closest('article');
    expect(card).not.toBeNull();
    if (!card) {
      throw new Error('Prompt card not found');
    }

    const content = within(card).getByText(/Line 1 with detailed implementation notes/);
    expect(content).not.toHaveClass('prompt-card-content--expanded');

    await user.click(within(card).getByRole('button', { name: '展开完整 prompt' }));

    expect(content).toHaveClass('prompt-card-content--expanded');
    expect(writeText).not.toHaveBeenCalled();

    await user.click(within(card).getByRole('button', { name: '收起完整 prompt' }));

    expect(content).not.toHaveClass('prompt-card-content--expanded');
    expect(writeText).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('shows an expand button for short content that still exceeds the collapsed line count', () => {
    render(
      <App
        initialState={{
          ...cardState(),
          cards: [
            {
              ...cardState().cards[0]!,
              content: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
            },
            cardState().cards[1]!
          ]
        }}
      />
    );

    const lane = screen.getByRole('region', { name: '未使用' });
    expect(within(lane).getByRole('button', { name: '展开完整 prompt' })).toBeInTheDocument();
  });

  it('still copies card content on single click when not using the expand button', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText
      }
    });

    render(<App initialState={cardState()} />);

    const lane = screen.getByRole('region', { name: '未使用' });
    const card = within(lane).getByText('Map the API surface before refactoring.').closest('article');
    expect(card).not.toBeNull();
    if (!card) {
      throw new Error('Prompt card not found');
    }

    await user.click(card);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Map the API surface before refactoring.');
    });

    vi.unstubAllGlobals();
  });

  it('imports uri-list drops from the prompt textbox', async () => {
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    fireEvent.dragOver(screen.getByRole('textbox', { name: 'Prompt' }), {
      dataTransfer: {
        types: ['text/uri-list'],
        getData: vi.fn((type: string) => (type === 'text/uri-list' ? 'file:///workspace/src/feature/auth.ts' : ''))
      }
    });

    fireEvent.drop(screen.getByRole('textbox', { name: 'Prompt' }), {
      dataTransfer: {
        files: [],
        types: ['text/uri-list'],
        getData: vi.fn((type: string) => (type === 'text/uri-list' ? 'file:///workspace/src/feature/auth.ts' : ''))
      }
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'composer:importFiles',
      payload: { filePaths: ['/workspace/src/feature/auth.ts'], insertAt: 0 }
    });
  });

  it('imports Windows uri-list drops as absolute drive paths', async () => {
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    fireEvent.drop(screen.getByRole('textbox', { name: 'Prompt' }), {
      dataTransfer: {
        files: [],
        types: ['text/uri-list'],
        getData: vi.fn((type: string) =>
          type === 'text/uri-list' ? 'file:///C:/workspace/src/feature/auth.ts' : ''
        )
      }
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'composer:importFiles',
      payload: { filePaths: ['C:/workspace/src/feature/auth.ts'], insertAt: 0 }
    });
  });

  it('preserves composer content and navigates to the clicked page when autosaving on nav-away', async () => {
    const user = userEvent.setup();

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    await user.type(prompt, 'My draft prompt');

    await user.click(screen.getByRole('button', { name: '历史' }));

    // Should be on History page now
    expect(screen.getByText('还没有 prompt 活动记录。')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument();
  });

  it('preserves composer content when switching away from workspace and back', async () => {
    const user = userEvent.setup();
    const vscodeApi = await import('../../webview/src/api/vscode');

    render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    await user.type(prompt, 'My retained draft');

    await user.click(screen.getByRole('button', { name: '历史' }));
    await user.click(screen.getByRole('button', { name: '工作台' }));

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('My retained draft');
    expect(vscodeApi.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'draft:autosave' })
    );
  });

  it('copies the saved prompt after a manual confirm successfully saves a new unused card', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vscodeApi = await import('../../webview/src/api/vscode');
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText
      }
    });

    const { rerender } = render(<App initialState={createInitialState('2026-04-08T10:00:00.000Z')} />);

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Ship the release checklist');
    await user.click(screen.getByRole('button', { name: '确认' }));

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'draft:autosave',
      payload: {
        title: '',
        content: 'Ship the release checklist',
        fileRefs: []
      }
    });

    rerender(
      <App
        initialState={createInitialState('2026-04-08T10:00:00.000Z')}
        lastMessage={{
          type: 'draft:saved',
          payload: {
            card: {
              id: 'saved-1',
              title: 'Ship the release checklist',
              content: 'Ship the release checklist',
              status: 'unused',
              runtimeState: 'unknown',
              groupId: 'group-1',
              groupName: '未分类',
              groupColor: '#7C3AED',
              sourceType: 'manual',
              createdAt: '2026-04-08T10:05:00.000Z',
              updatedAt: '2026-04-08T10:05:00.000Z',
              dateBucket: '2026-04-08',
              fileRefs: [],
              justCompleted: false
            },
            state: {
              ...createInitialState('2026-04-08T10:05:00.000Z'),
              cards: [
                {
                  id: 'saved-1',
                  title: 'Ship the release checklist',
                  content: 'Ship the release checklist',
                  status: 'unused',
                  runtimeState: 'unknown',
                  groupId: 'group-1',
                  groupName: '未分类',
                  groupColor: '#7C3AED',
                  sourceType: 'manual',
                  createdAt: '2026-04-08T10:05:00.000Z',
                  updatedAt: '2026-04-08T10:05:00.000Z',
                  dateBucket: '2026-04-08',
                  fileRefs: [],
                  justCompleted: false
                }
              ]
            }
          }
        }}
      />
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Ship the release checklist');
    });

    vi.unstubAllGlobals();
  });

  it('copies the saved prompt after ctrl+enter successfully updates an edited unused card', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vscodeApi = await import('../../webview/src/api/vscode');
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText
      }
    });

    const { rerender } = render(<App initialState={cardState()} />);

    await user.dblClick(screen.getByText('Map the API surface before refactoring.'));
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    await user.clear(prompt);
    await user.type(prompt, 'Updated unused prompt from composer');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'card:update',
      payload: {
        cardId: 'unused-1',
        title: 'Draft API prompt',
        content: 'Updated unused prompt from composer',
        fileRefs: []
      }
    });

    rerender(
      <App
        initialState={cardState()}
        lastMessage={{
          type: 'card:updated',
          payload: {
            card: {
              ...cardState().cards[0]!,
              content: 'Updated unused prompt from composer',
              updatedAt: '2026-04-08T10:06:00.000Z'
            },
            state: {
              ...cardState(),
              cards: [
                {
                  ...cardState().cards[0]!,
                  content: 'Updated unused prompt from composer',
                  updatedAt: '2026-04-08T10:06:00.000Z'
                },
                cardState().cards[1]!
              ]
            }
          }
        }}
      />
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Updated unused prompt from composer');
    });

    vi.unstubAllGlobals();
  });

  it('waits for shortcut-save acknowledgement before showing success feedback', async () => {
    const user = userEvent.setup();
    const vscodeApi = await import('../../webview/src/api/vscode');
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    initialState.settings.language = 'en';

    const { rerender } = render(<App initialState={initialState} />);

    await user.click(screen.getByRole('button', { name: 'Shortcuts' }));
    await user.click(screen.getByRole('button', { name: 'Edit Open Prompter shortcut' }));
    await user.keyboard('{Control>}k{/Control}');

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'settings:update',
      payload: {
        shortcuts: expect.objectContaining({
          'prompter.open': expect.objectContaining({ keybinding: 'ctrl+k' })
        })
      }
    });
    expect(screen.queryByText('Open Prompter shortcut saved.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: 'Open Prompter' })).getByText('Saving...')).toBeInTheDocument();

    rerender(
      <App
        initialState={initialState}
        lastMessage={{
          type: 'settings:shortcuts:update:success',
          payload: {
            shortcuts: {
              ...initialState.settings.shortcuts,
              'prompter.open': {
              ...initialState.settings.shortcuts['prompter.open'],
                keybinding: 'ctrl+k'
              }
            }
          }
        }}
      />
    );

    expect(screen.getByText('Open Prompter shortcut saved.')).toBeInTheDocument();
    expect(screen.getByText('ctrl+k')).toBeInTheDocument();
  });

  it('does not replay an old shortcut saved message when navigating back to the shortcuts page', async () => {
    const user = userEvent.setup();
    const initialState = createInitialState('2026-04-08T10:00:00.000Z');
    initialState.settings.language = 'en';
    const { rerender } = render(
      <App
        initialState={initialState}
        lastMessage={{
          type: 'settings:shortcuts:update:success',
          payload: { shortcuts: initialState.settings.shortcuts }
        }}
      />
    );

    expect(screen.queryByText('Open Prompter shortcut saved.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'History' }));
    rerender(<App initialState={initialState} />);
    await user.click(screen.getByRole('button', { name: 'Shortcuts' }));

    expect(screen.queryByText(/shortcut saved\./i)).not.toBeInTheDocument();
  });
});
