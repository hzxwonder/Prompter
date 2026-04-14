import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import { createInitialState } from '../../../src/shared/models';
import { LogSyncService } from '../../../src/services/LogSyncService';

const { showInformationMessage } = vi.hoisted(() => ({
  showInformationMessage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage
  },
  commands: {
    executeCommand: vi.fn()
  }
}));

vi.mock('../../../src/panel/PrompterPanel', () => ({
  PrompterPanel: {
    refresh: vi.fn().mockResolvedValue(undefined),
    playCompletionTone: vi.fn(),
    playCustomTone: vi.fn()
  }
}));

vi.mock('../../../src/services/LogParser', () => ({
  LogParser: vi.fn().mockImplementation(function () {
    return {
      close: vi.fn(),
      sync: vi.fn(() => ({ inserted: [], justCompletedSourceRefs: [] })),
      getAllPrompts: vi.fn(() => []),
      getSessionLastModifiedMs: vi.fn(() => undefined)
    };
  })
}));

vi.mock('../../../src/logger', () => ({
  log: vi.fn(),
  logError: vi.fn()
}));

describe('LogSyncService', () => {
  beforeEach(() => {
    showInformationMessage.mockClear();
  });

  it('localizes completion notifications using the current settings language', async () => {
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

    await (service as any).handlePromptCompleted('session-1');

    expect(showInformationMessage).toHaveBeenCalledWith('Prompt completed: Release wrap-up...', 'View');
  });

  it('auto-completes an awaiting-confirmation prompt when a new prompt arrives in the same codex session', async () => {
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

    expect(repository.markCardCompletedFromLog).toHaveBeenCalledWith('card-1', '2026-04-08T10:30:00.000Z');
    expect(repository.saveImportedCard).toHaveBeenCalled();
  });

  it('does not auto-complete a same-session prompt that is still active and not awaiting confirmation', async () => {
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
        lastActiveAt: '2026-04-08T10:00:00.000Z',
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

    expect(repository.markCardCompletedFromLog).not.toHaveBeenCalled();
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
});
