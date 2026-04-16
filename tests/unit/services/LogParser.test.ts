import * as fs from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
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
  LogParser,
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

  it('marks the latest Claude prompt as completed when an api_error is logged', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'prompter-claude-log-'));
    const projectDir = path.join(tempDir, 'project-a');
    const logPath = path.join(projectDir, 'session-1.jsonl');

    try {
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        logPath,
        [
          JSON.stringify({
            type: 'user',
            userType: 'external',
            timestamp: '2026-04-14T15:20:00.000Z',
            message: {
              role: 'user',
              content: [{ type: 'text', text: 'Retry the failing sync.' }]
            }
          }),
          JSON.stringify({
            parentUuid: 'e213b875-df36-4294-b33a-45f498e4ae55',
            isSidechain: false,
            type: 'system',
            subtype: 'api_error',
            level: 'error',
            timestamp: '2026-04-14T15:20:42.367Z'
          })
        ].join('\n'),
        'utf8'
      );

      const parser = new LogParser();
      const prompts = (parser as any).extractClaudePrompts(logPath);

      expect(prompts).toEqual([
        expect.objectContaining({
          source: 'claude-code',
          sessionId: 'session-1',
          userInput: 'Retry the failing sync.',
          completedAt: '2026-04-14T15:20:42.367Z'
        })
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('LogParser lightweight today/running discovery', () => {
  it('returns only today entries plus recently running sessions for workspace loading', () => {
    const parser = new LogParser();

    const existsSyncSpy = vi.spyOn(fs, 'existsSync');
    const readdirSyncSpy = vi.spyOn(fs, 'readdirSync');
    const statSyncSpy = vi.spyOn(fs, 'statSync');

    const claudeRoot = path.join(homedir(), '.claude', 'projects');
    const codexRoot = path.join(homedir(), '.codex', 'sessions');
    const todayDir = path.join(codexRoot, '2026', '04', '08');
    const oldDir = path.join(codexRoot, '2026', '03', '01');
    const runningDir = path.join(codexRoot, '2026', '04', '07');
    const nowMs = Date.parse('2026-04-08T12:00:00.000Z');
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    const directories = new Set([claudeRoot, path.join(claudeRoot, 'project-a'), codexRoot, path.join(codexRoot, '2026'), path.join(codexRoot, '2026', '04'), path.join(codexRoot, '2026', '03'), todayDir, oldDir, runningDir]);
    const stats = new Map<string, { isDirectory: boolean; mtimeMs: number }>([
      [path.join(claudeRoot, 'project-a'), { isDirectory: true, mtimeMs: Date.parse('2026-04-08T09:00:00.000Z') }],
      [path.join(claudeRoot, 'project-a', 'today.jsonl'), { isDirectory: false, mtimeMs: Date.parse('2026-04-08T09:30:00.000Z') }],
      [path.join(claudeRoot, 'project-a', 'old.jsonl'), { isDirectory: false, mtimeMs: Date.parse('2026-03-01T09:30:00.000Z') }],
      [path.join(codexRoot, '2026'), { isDirectory: true, mtimeMs: nowMs }],
      [path.join(codexRoot, '2026', '04'), { isDirectory: true, mtimeMs: nowMs }],
      [path.join(codexRoot, '2026', '03'), { isDirectory: true, mtimeMs: nowMs }],
      [todayDir, { isDirectory: true, mtimeMs: Date.parse('2026-04-08T11:00:00.000Z') }],
      [path.join(todayDir, 'today-codex.jsonl'), { isDirectory: false, mtimeMs: Date.parse('2026-04-08T11:30:00.000Z') }],
      [oldDir, { isDirectory: true, mtimeMs: Date.parse('2026-03-01T11:00:00.000Z') }],
      [path.join(oldDir, 'old-codex.jsonl'), { isDirectory: false, mtimeMs: Date.parse('2026-03-01T11:30:00.000Z') }],
      [runningDir, { isDirectory: true, mtimeMs: Date.parse('2026-04-08T11:40:00.000Z') }],
      [path.join(runningDir, 'running-codex.jsonl'), { isDirectory: false, mtimeMs: Date.parse('2026-04-08T11:50:00.000Z') }]
    ]);

    existsSyncSpy.mockImplementation((targetPath: any) => {
      const normalized = String(targetPath);
      return directories.has(normalized) || stats.has(normalized);
    });
    readdirSyncSpy.mockImplementation((targetPath: any) => {
      const normalized = String(targetPath);
      if (normalized === claudeRoot) return ['project-a'] as any;
      if (normalized === path.join(claudeRoot, 'project-a')) return ['today.jsonl', 'old.jsonl'] as any;
      if (normalized === codexRoot) return ['2026'] as any;
      if (normalized === path.join(codexRoot, '2026')) return ['04', '03'] as any;
      if (normalized === path.join(codexRoot, '2026', '04')) return ['08', '07'] as any;
      if (normalized === path.join(codexRoot, '2026', '03')) return ['01'] as any;
      if (normalized === todayDir) return ['today-codex.jsonl'] as any;
      if (normalized === oldDir) return ['old-codex.jsonl'] as any;
      if (normalized === runningDir) return ['running-codex.jsonl'] as any;
      return [] as any;
    });
    statSyncSpy.mockImplementation((targetPath: any) => {
      const normalized = String(targetPath);
      const stat = stats.get(normalized);
      if (!stat) {
        throw new Error(`Missing stat for ${normalized}`);
      }
      return {
        isDirectory: () => stat.isDirectory,
        mtimeMs: stat.mtimeMs
      } as any;
    });

    try {
      const entries = parser.discoverTodayOrRunningEntries('2026-04-08', new Set(['codex:running-codex']));

      expect(entries.map((entry) => entry.path)).toEqual([
        path.join(runningDir, 'running-codex.jsonl'),
        path.join(todayDir, 'today-codex.jsonl'),
        path.join(claudeRoot, 'project-a', 'today.jsonl')
      ]);
    } finally {
      Date.now = originalDateNow;
      existsSyncSpy.mockRestore();
      readdirSyncSpy.mockRestore();
      statSyncSpy.mockRestore();
    }
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

  it('marks a codex turn as completed when turn_aborted is present', () => {
    const sessionId = 'rollout-2026-04-14T16-00-52-019d8b01-ed0f-7da2-9fd9-103925ad25fc';
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-14T12:15:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn-1'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-14T12:15:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\ninterrupted prompt'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-14T12:17:00.427Z',
        type: 'event_msg',
        payload: {
          type: 'turn_aborted',
          turn_id: 'turn-1',
          reason: 'interrupted',
          completed_at: 1776169020
        }
      })
    ];

    expect(extractCodexPromptRecords(lines, sessionId, '2026-04-14')).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-1`,
        completedAt: '2026-04-14T12:17:00.427Z'
      })
    ]);
  });

  it('does not emit a duplicate codex prompt when both user_message and item.completed describe the same turn', () => {
    const sessionId = 'rollout-2026-04-15T10-00-00-019d8b01-ed0f-7da2-9fd9-103925ad25fc';
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-15T10:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn-1'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-15T10:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\nfirst prompt'
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-15T10:00:20.000Z',
        type: 'item.completed',
        item: {
          type: 'message',
          role: 'user',
          turn_id: 'turn-1',
          content: [
            {
              type: 'input_text',
              text: '## My request for Codex:\nfirst prompt'
            }
          ]
        }
      }),
      JSON.stringify({
        timestamp: '2026-04-15T10:00:30.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'turn-1'
        }
      })
    ];

    expect(extractCodexPromptRecords(lines, sessionId, '2026-04-15')).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-1`,
        userInput: 'first prompt'
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

  it('does not require confirmation for codex turns completed by turn_aborted', () => {
    const sessionId = 'rollout-2026-04-14T16-00-52-019d8b01-ed0f-7da2-9fd9-103925ad25fc';
    const persisted = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-1`,
        project: sessionId,
        userInput: 'interrupted prompt',
        createdAt: '2026-04-14T12:15:01.000Z',
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
        userInput: 'interrupted prompt',
        createdAt: '2026-04-14T12:15:01.000Z',
        completedAt: '2026-04-14T12:17:00.427Z',
        completionKind: 'aborted' as const
      }
    ];

    const result = resolvePromptStatuses(scanned, persisted, new Set());

    expect(result.justCompletedSourceRefs).toEqual([]);
    expect(result.nextState).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-1`,
        status: 'completed',
        completedAt: '2026-04-14T12:17:00.427Z',
        justCompleted: false
      })
    ]);
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

  it('updates an existing codex turn in place when the same sourceRef is re-scanned with edited content', () => {
    const sessionId = 'rollout-2026-04-15T13-00-00-019d9000-b2f9-7cb3-99bc-85aa22c13ad8';
    const persisted = [
      {
        source: 'codex' as const,
        sessionId,
        sourceRef: `${sessionId}:turn-1`,
        project: sessionId,
        userInput: 'draft prompt',
        createdAt: '2026-04-15T05:35:56.000Z',
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
        userInput: 'draft prompt with one more line',
        createdAt: '2026-04-15T05:35:59.000Z'
      }
    ];

    const result = resolvePromptStatuses(scanned, persisted, new Set());

    expect(result.inserted).toEqual([]);
    expect(result.nextState).toEqual([
      expect.objectContaining({
        sourceRef: `${sessionId}:turn-1`,
        userInput: 'draft prompt with one more line',
        createdAt: '2026-04-15T05:35:59.000Z',
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
