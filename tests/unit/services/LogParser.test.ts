import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({
      appendLine: vi.fn(),
      show: vi.fn()
    })
  }
}));
import {
  extractCodexPromptRecords,
  extractClaudeUserText,
  isClaudeExternalUserPromptEvent,
  resolvePromptStatuses,
  shouldDiscardImportedPromptContent
} from '../../../src/services/LogParser';

describe('LogParser Claude event filtering', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('accepts a real external user prompt event', () => {
    const event = {
      type: 'user',
      userType: 'external',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Real user prompt' }]
      }
    };

    expect(isClaudeExternalUserPromptEvent(event)).toBe(true);
    expect(extractClaudeUserText(event)).toBe('Real user prompt');
  });

  it('rejects skill body events injected as meta user text', () => {
    const event = {
      type: 'user',
      userType: 'external',
      isMeta: true,
      sourceToolUseID: 'call_9OUCS2rc3eimheOCpn3Xi4TV',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Base directory for this skill: /Users/example/.claude/plugins/cache/.../subagent-driven-development\n\n# Subagent-Driven Development\n\nExecute plan by dispatching fresh subagent per task'
          }
        ]
      }
    };

    expect(isClaudeExternalUserPromptEvent(event)).toBe(false);
    expect(extractClaudeUserText(event)).toBe('');
  });

  it('treats persisted skill-doc content as discardable imported prompt noise', () => {
    const content =
      '# Systematic Debugging\n## Overview\nRandom fixes waste time and create new bugs.\n## The Iron Law\nNO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST\n## Integration\nsuperpowers:test-driven-development\nsuperpowers:verification-before-completion';

    expect(shouldDiscardImportedPromptContent(content)).toBe(true);
    expect(shouldDiscardImportedPromptContent('Investigate the failing workspace sync logic')).toBe(false);
  });
});

describe('LogParser Codex turn completion', () => {
  it('ignores replayed parent-session turns inside a forked codex session log', () => {
    const sessionId = 'rollout-2026-04-12T15-51-28-019d80ac-9805-7892-b42b-edea466530ac';
    const records = extractCodexPromptRecords([
      JSON.stringify({
        timestamp: '2026-04-12T07:51:28.045Z',
        type: 'session_meta',
        payload: {
          id: '019d80ac-9805-7892-b42b-edea466530ac',
          timestamp: '2026-04-12T07:51:28.008Z'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T07:51:28.046Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'parent-turn',
          started_at: 1775976221
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T07:51:28.046Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\nreplayed parent prompt'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T07:51:28.050Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'child-turn',
          started_at: 1775978322
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T07:51:28.050Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\nSubagent-Driven'
        }
      })
    ], sessionId, '2026-04-12', new Set(['parent-turn']));

    expect(records).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:child-turn`,
        userInput: 'Subagent-Driven'
      })
    ]);
  });

  it('marks only the matching turn as completed when task_complete is present', () => {
    const sessionId = 'rollout-2026-04-12T19-30-02-019d8174-b2f9-7cb3-99bc-85aa22c13ad8';
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-12T11:30:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn-1',
          started_at: 1775993402
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T11:30:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\nfirst prompt'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T11:31:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'turn-1',
          completed_at: 1775993460
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T11:32:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn-2',
          started_at: 1775993520
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T11:32:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\nsecond prompt'
        }
      })
    ];

    expect(extractCodexPromptRecords(lines, sessionId, '2026-04-12')).toEqual([
      expect.objectContaining({
        source: 'codex',
        sessionId,
        sourceRef: `${sessionId}:turn-1`,
        project: sessionId,
        userInput: 'first prompt',
        completedAt: '2026-04-12T11:31:00.000Z'
      }),
      expect.objectContaining({
        source: 'codex',
        sessionId,
        sourceRef: `${sessionId}:turn-2`,
        project: sessionId,
        userInput: 'second prompt',
        completedAt: undefined
      })
    ]);
  });

  it('keeps only the unfinished turn running within a codex session', () => {
    const sessionId = 'rollout-2026-04-12T20-00-00-019d8174-b2f9-7cb3-99bc-85aa22c13ad8';
    const records = extractCodexPromptRecords([
      JSON.stringify({
        timestamp: '2026-04-12T12:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-1' }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T12:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: '## My request for Codex:\nfirst prompt' }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T12:01:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'turn-1' }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T12:02:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-2' }
      }),
      JSON.stringify({
        timestamp: '2026-04-12T12:02:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: '## My request for Codex:\nsecond prompt' }
      })
    ], sessionId, '2026-04-12');

    expect(records).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-1`,
        completedAt: '2026-04-12T12:01:00.000Z'
      }),
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-2`,
        completedAt: undefined
      })
    ]);
  });

  it('transitions codex running state by turn completion instead of session activity', () => {
    const sessionId = 'rollout-2026-04-12T20-10-00-019d8174-b2f9-7cb3-99bc-85aa22c13ad8';
    const persisted = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-1`,
        project: sessionId,
        userInput: 'first prompt',
        createdAt: '2026-04-12T12:00:01.000Z',
        status: 'completed' as const,
        justCompleted: false,
        completedAt: '2026-04-12T12:01:00.000Z'
      },
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-2`,
        project: sessionId,
        userInput: 'second prompt',
        createdAt: '2026-04-12T12:02:01.000Z',
        status: 'running' as const,
        justCompleted: false
      }
    ];
    const scanned = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-1`,
        project: sessionId,
        userInput: 'first prompt',
        createdAt: '2026-04-12T12:00:01.000Z',
        completedAt: '2026-04-12T12:01:00.000Z'
      },
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-2`,
        project: sessionId,
        userInput: 'second prompt',
        createdAt: '2026-04-12T12:02:01.000Z',
        completedAt: '2026-04-12T12:03:00.000Z'
      },
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-3`,
        project: sessionId,
        userInput: 'third prompt',
        createdAt: '2026-04-12T12:04:01.000Z'
      }
    ];

    const result = resolvePromptStatuses(scanned, persisted, new Set());

    expect(result.justCompletedSourceRefs).toEqual([`${sessionId}:turn-2`]);
    expect(result.nextState).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRef: `${sessionId}:turn-2`,
          status: 'completed',
          completedAt: '2026-04-12T12:03:00.000Z',
          justCompleted: true
        }),
        expect.objectContaining({
          sourceRef: `${sessionId}:turn-3`,
          status: 'running',
          justCompleted: false
        })
      ])
    );
  });

  it('migrates a legacy codex session-level record onto the matching turn-level prompt', () => {
    const sessionId = 'rollout-2026-04-12T20-20-00-019d8174-b2f9-7cb3-99bc-85aa22c13ad8';
    const persisted = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: sessionId,
        project: null,
        userInput: 'legacy prompt',
        createdAt: '2026-04-12T12:20:01.002Z',
        status: 'running' as const,
        justCompleted: false
      }
    ];
    const scanned = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-1`,
        project: sessionId,
        userInput: 'legacy prompt',
        createdAt: '2026-04-12T12:20:01.000Z'
      }
    ];

    const result = resolvePromptStatuses(scanned, persisted, new Set());

    expect(result.inserted).toEqual([]);
    expect(result.nextState).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-1`,
        userInput: 'legacy prompt',
        status: 'running'
      })
    ]);
  });

  it('prunes stale codex records that no longer exist in scanned logs', () => {
    const sessionId = 'rollout-2026-04-12T20-30-00-019d8174-b2f9-7cb3-99bc-85aa22c13ad8';
    const persisted = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:replayed-parent-turn`,
        project: sessionId,
        userInput: 'stale replayed prompt',
        createdAt: '2026-04-12T12:30:01.000Z',
        status: 'completed' as const,
        justCompleted: false
      }
    ];

    const result = resolvePromptStatuses([], persisted, new Set());

    expect(result.inserted).toEqual([]);
    expect(result.nextState).toEqual([]);
  });
});
