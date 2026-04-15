import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../../src/shared/models';
import { PromptRepository } from '../../../src/state/PromptRepository';

describe('PromptRepository', () => {
  it('stores a draft as an unused card and rebuilds daily stats', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const card = await repo.saveDraft({
      title: 'Explain src/api.ts',
      content: 'Review src/api.ts for race conditions',
      groupName: 'api.ts',
      sourceType: 'manual',
      fileRefs: [{ path: 'src/api.ts', startLine: 1, endLine: 20 }]
    });

    expect(card.status).toBe('unused');
    const snapshot = await repo.getState();
    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.dailyStats).toEqual([
      {
        date: '2026-04-08',
        usedCount: 0,
        unusedCount: 1,
        completedCount: 0,
        totalCount: 1
      }
    ]);
  });

  it('loads persisted settings from the target data directory when switching repositories', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'prompter-source-'));
    const targetDir = await mkdtemp(join(tmpdir(), 'prompter-target-'));
    const sourceRepo = await PromptRepository.create(sourceDir, () => '2026-04-08T10:00:00.000Z');

    await sourceRepo.saveDraft({
      title: 'Explain src/api.ts',
      content: 'Review src/api.ts for race conditions',
      groupName: 'api.ts',
      sourceType: 'manual',
      fileRefs: [{ path: 'src/api.ts', startLine: 1, endLine: 20 }]
    });

    await writeFile(
      join(targetDir, 'settings.json'),
      JSON.stringify({
        ...createInitialState('2026-04-08T10:00:00.000Z').settings,
        dataDir: targetDir,
        notifyOnFinish: false
      }),
      'utf8'
    );

    const switchedRepo = await PromptRepository.create(targetDir, () => '2026-04-08T10:00:00.000Z');
    const snapshot = await switchedRepo.getState();

    expect(snapshot.cards).toEqual([]);
    expect(snapshot.settings.dataDir).toBe(targetDir);
    expect(snapshot.settings.notifyOnFinish).toBe(false);
  });

  it('rebuilds daily stats from cards when reloading persisted state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const now = () => '2026-04-08T10:00:00.000Z';
    const repo = await PromptRepository.create(dir, now);

    await repo.saveDraft({
      title: 'Explain src/api.ts',
      content: 'Review src/api.ts for race conditions',
      groupName: 'api.ts',
      sourceType: 'manual',
      fileRefs: [{ path: 'src/api.ts', startLine: 1, endLine: 20 }]
    });

    await writeFile(
      join(dir, 'daily-stats.json'),
      JSON.stringify([
        {
          date: '1999-01-01',
          usedCount: 99,
          unusedCount: 0,
          completedCount: 99,
          totalCount: 99
        }
      ]),
      'utf8'
    );

    const reloadedRepo = await PromptRepository.create(dir, now);
    const snapshot = await reloadedRepo.getState();

    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.cards[0]?.title).toBe('Explain src/api.ts');
    expect(snapshot.dailyStats).toEqual([
      {
        date: '2026-04-08',
        usedCount: 0,
        unusedCount: 1,
        completedCount: 0,
        totalCount: 1
      }
    ]);
  });

  it('uses session id as the fallback group name for codex and roo imports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const codexCard = await repo.saveImportedCard({
      title: 'Explain the failing test',
      content: 'Inspect flaky snapshots',
      groupName: '未分类',
      sourceType: 'codex',
      sourceRef: 'codex-session-1',
      status: 'active',
      runtimeState: 'running'
    });

    const rooCard = await repo.saveImportedCard({
      title: 'Summarize task context',
      content: 'Collect task notes',
      groupName: '',
      sourceType: 'roo-code',
      sourceRef: 'roo-task-7',
      status: 'active',
      runtimeState: 'running'
    });

    expect(codexCard.groupName).toBe('codex-session-1');
    expect(rooCard.groupName).toBe('roo-task-7');
  });

  it('reuses a legacy codex card when the same prompt is re-imported with a turn-level sourceRef', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    await writeFile(
      join(dir, 'cards.json'),
      JSON.stringify([
        {
          id: 'legacy-card',
          title: 'Legacy prompt',
          content: 'Inspect flaky snapshots',
          status: 'active',
          runtimeState: 'running',
          groupId: 'codex:codex-session-1',
          groupName: 'codex-session-1',
          groupColor: '#111111',
          sourceType: 'codex',
          sourceRef: 'codex-session-1',
          createdAt: '2026-04-08T09:59:00.002Z',
          updatedAt: '2026-04-08T10:00:00.000Z',
          dateBucket: '2026-04-08',
          fileRefs: [],
          justCompleted: false
        }
      ]),
      'utf8'
    );

    const reloaded = await PromptRepository.create(dir, () => '2026-04-08T10:05:00.000Z');
    const card = await reloaded.saveImportedCard({
      title: 'Legacy prompt',
      content: 'Inspect flaky snapshots',
      groupName: 'codex-session-1',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-1',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T09:59:00.000Z'
    });

    const snapshot = await reloaded.getState();
    expect(snapshot.cards).toHaveLength(1);
    expect(card).toMatchObject({
      id: 'legacy-card',
      sourceRef: 'codex-session-1:turn-1',
      groupName: 'codex-session-1'
    });
  });

  it('promotes a matching unused manual card into the imported codex card instead of duplicating it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const draft = await repo.saveDraft({
      title: 'Activation failure',
      content: 'Investigate duplicate command registration.  \n\n',
      groupName: 'debug',
      sourceType: 'manual',
      fileRefs: []
    });

    const imported = await repo.saveImportedCard({
      title: 'Activation failure',
      content: 'Investigate duplicate command registration.',
      groupName: 'codex-session-1',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-1',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T10:00:00.000Z'
    });

    const snapshot = await repo.getState();

    expect(snapshot.cards).toHaveLength(1);
    expect(imported.id).toBe(draft.id);
    expect(snapshot.cards[0]).toMatchObject({
      id: draft.id,
      status: 'active',
      runtimeState: 'running',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-1',
      content: 'Investigate duplicate command registration.'
    });
  });

  it('reuses a renamed session group name for new prompts imported from the same codex session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const existing = await repo.saveImportedCard({
      title: 'Prompt one',
      content: 'Inspect flaky snapshots',
      groupName: 'codex-session-1',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-1',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T10:00:00.000Z'
    });

    await repo.renameGroup(existing.groupId, 'Release Debugging');

    const next = await repo.saveImportedCard({
      title: 'Prompt two',
      content: 'Inspect release packaging',
      groupName: 'codex-session-1',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-2',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T10:05:00.000Z'
    });

    expect(next.groupName).toBe('Release Debugging');
    expect(next.groupId).toBe('codex:codex-session-1');
  });

  it('renames all cards from the same imported session together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const first = await repo.saveImportedCard({
      title: 'Prompt one',
      content: 'Inspect flaky snapshots',
      groupName: 'codex-session-1',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-1',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T10:00:00.000Z'
    });

    const second = await repo.saveImportedCard({
      title: 'Prompt two',
      content: 'Inspect release packaging',
      groupName: 'codex-session-1',
      sourceType: 'codex',
      sourceRef: 'codex-session-1:turn-2',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T10:05:00.000Z'
    });

    await repo.renameGroup(first.groupId, 'Release Debugging');

    const snapshot = await repo.getState();
    const sameSessionCards = snapshot.cards.filter((card) => card.sourceType === 'codex');

    expect(sameSessionCards).toHaveLength(2);
    expect(sameSessionCards.map((card) => card.groupName)).toEqual(['Release Debugging', 'Release Debugging']);
    expect(new Set(sameSessionCards.map((card) => card.groupId))).toEqual(new Set(['codex:codex-session-1']));
  });

  it('stores imported history prompts in a single batch persist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const persistSpy = vi.spyOn(repo, 'persist');

    const cards = await repo.saveImportedCards([
      {
        title: 'Prompt one',
        content: 'Inspect flaky snapshots',
        groupName: 'codex-session-1',
        sourceType: 'codex',
        sourceRef: 'codex-session-1:turn-1',
        status: 'completed',
        runtimeState: 'finished',
        createdAt: '2026-04-08T09:00:00.000Z'
      },
      {
        title: 'Prompt two',
        content: 'Inspect release packaging',
        groupName: 'codex-session-1',
        sourceType: 'codex',
        sourceRef: 'codex-session-1:turn-2',
        status: 'completed',
        runtimeState: 'finished',
        createdAt: '2026-04-08T09:05:00.000Z'
      }
    ]);

    expect(cards).toHaveLength(2);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    const snapshot = await repo.getState();
    expect(snapshot.cards).toHaveLength(2);
  });

  it('persists resumable history import checkpoints across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const now = () => '2026-04-08T10:00:00.000Z';
    const repo = await PromptRepository.create(dir, now);

    await repo.setHistoryImport({
      scope: 'history-backfill',
      status: 'paused',
      processedPrompts: 12,
      totalPrompts: 48,
      processedSources: 1,
      totalSources: 3,
      foregroundReady: true,
      warningAcknowledged: true,
      pendingEntries: [
        {
          id: 'entry-1',
          sourceType: 'codex',
          filePath: '/tmp/codex/session.jsonl',
          dateBucket: '2026-04-07'
        }
      ],
      completedEntries: ['entry-0'],
      lastError: 'paused by user'
    });

    const reloadedRepo = await PromptRepository.create(dir, now);
    const snapshot = await reloadedRepo.getState();

    expect(snapshot.historyImport.status).toBe('paused');
    expect(snapshot.historyImport.pendingEntries).toEqual([
      {
        id: 'entry-1',
        sourceType: 'codex',
        filePath: '/tmp/codex/session.jsonl',
        dateBucket: '2026-04-07'
      }
    ]);
    expect(snapshot.historyImport.completedEntries).toEqual(['entry-0']);
    expect(snapshot.historyImport.warningAcknowledged).toBe(true);
  });

  it('persists settings updates and clears cached files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    await repo.saveDraft({
      title: 'Explain src/api.ts',
      content: 'Review src/api.ts for race conditions',
      groupName: 'api.ts',
      sourceType: 'manual',
      fileRefs: [{ path: 'src/api.ts', startLine: 1, endLine: 20 }]
    });

    await repo.saveModularPrompt({
      name: 'root-cause',
      content: 'List the symptoms and identify the trigger.',
      category: 'analysis'
    });

    await repo.updateSettings({
      notifyOnFinish: false,
      dataDir: '/tmp/prompter-custom',
      logSources: {
        'claude-code': { enabled: true, path: '/logs/claude' },
        codex: { enabled: false, path: '/logs/codex' },
        'roo-code': { enabled: true, path: '/logs/roo' }
      }
    });

    let snapshot = await repo.getState();
    expect(snapshot.settings.notifyOnFinish).toBe(false);
    expect(snapshot.settings.dataDir).toBe('/tmp/prompter-custom');
    expect(snapshot.settings.logSources.codex.enabled).toBe(false);

    await repo.clearCache();

    snapshot = await repo.getState();
    expect(snapshot.cards).toEqual([]);
    expect(snapshot.modularPrompts).toEqual([]);
    expect(snapshot.dailyStats).toEqual([]);
    expect(snapshot.settings.notifyOnFinish).toBe(false);
    expect(snapshot.settings.dataDir).toBe('/tmp/prompter-custom');

    const files = await readdir(dir);
    expect(files.sort()).toEqual([
      'cards.json',
      'daily-stats.json',
      'history-import.json',
      'modular-prompts.json',
      'session-groups.json',
      'settings.json'
    ]);
  });

  it('persists normalized shortcut settings back to disk when they are missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const now = () => '2026-04-08T10:00:00.000Z';
    const baseSettings: Record<string, unknown> = {
      ...createInitialState('2026-04-08T10:00:00.000Z').settings
    };
    delete baseSettings.shortcuts;

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        ...baseSettings,
        notifyOnFinish: false
      }),
      'utf8'
    );

    const repo = await PromptRepository.create(dir, now);
    const snapshot = await repo.getState();
    const persistedSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as {
      shortcuts: Record<string, { command: string; keybinding: string; defaultKeybinding: string }>;
    };

    expect(snapshot.settings.notifyOnFinish).toBe(false);
    expect(snapshot.settings.shortcuts['prompter.open']).toMatchObject({
      command: 'prompter.open',
      keybinding: 'ctrl+e',
      defaultKeybinding: 'ctrl+e'
    });
    expect(snapshot.settings.shortcuts['prompter.importSelection']).toMatchObject({
      command: 'prompter.importSelection',
      keybinding: 'ctrl+shift+f',
      defaultKeybinding: 'ctrl+shift+f'
    });
    expect(snapshot.settings.logSources.codex).toEqual({
      enabled: true,
      path: '~/.codex/sessions'
    });
    expect(Object.keys(persistedSettings.shortcuts)).toEqual([
      'prompter.open',
      'prompter.importSelection',
      'prompter.importResource',
      'prompter.importTerminalSelection'
    ]);
    expect(persistedSettings.shortcuts['prompter.open']).toMatchObject({
      command: 'prompter.open',
      keybinding: 'ctrl+e',
      defaultKeybinding: 'ctrl+e'
    });
  });

  it('resets legacy shortcut defaults to the new platform defaults on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const now = () => '2026-04-08T10:00:00.000Z';
    const filePath = join(dir, 'settings.json');

    await writeFile(
      filePath,
      JSON.stringify({
        ...createInitialState('2026-04-08T10:00:00.000Z').settings,
        shortcuts: {
          'prompter.open': {
            command: 'prompter.open',
            label: 'Open Prompter',
            description: 'Open the Prompter panel',
            keybinding: 'cmd+shift+enter',
            defaultKeybinding: 'cmd+shift+enter'
          },
          'prompter.importSelection': {
            command: 'prompter.importSelection',
            label: 'Import Selection',
            description: 'Import the current selection into a prompt',
            keybinding: 'cmd+alt+i',
            defaultKeybinding: 'cmd+alt+i'
          },
          'prompter.importResource': {
            command: 'prompter.importResource',
            label: 'Import Resource',
            description: 'Add the selected resource to a prompt',
            keybinding: 'cmd+alt+i',
            defaultKeybinding: 'cmd+alt+i'
          },
          'prompter.importTerminalSelection': {
            command: 'prompter.importTerminalSelection',
            label: 'Import Terminal Selection',
            description: 'Import the current terminal selection into a prompt',
            keybinding: 'cmd+alt+i',
            defaultKeybinding: 'cmd+alt+i'
          }
        }
      }),
      'utf8'
    );

    const repo = await PromptRepository.create(dir, now);
    const snapshot = await repo.getState();

    expect(snapshot.settings.shortcuts['prompter.open']).toMatchObject({
      keybinding: 'ctrl+e',
      defaultKeybinding: 'ctrl+e'
    });
    expect(snapshot.settings.shortcuts['prompter.importSelection']).toMatchObject({
      keybinding: 'ctrl+shift+f',
      defaultKeybinding: 'ctrl+shift+f'
    });
  });

  it('keeps a custom shortcut keybinding without rewriting the file on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const now = () => '2026-04-08T10:00:00.000Z';
    const filePath = join(dir, 'settings.json');

    await writeFile(
      filePath,
      JSON.stringify({
        ...createInitialState('2026-04-08T10:00:00.000Z').settings,
        shortcuts: {
          'prompter.open': {
            command: 'prompter.open',
            label: 'Open Prompter',
            description: 'Open the Prompter panel',
            keybinding: 'cmd+shift+o',
            defaultKeybinding: 'ctrl+e'
          },
          'prompter.importSelection': {
            command: 'prompter.importSelection',
            label: 'Import Selection',
            description: 'Import the current selection into a prompt',
            keybinding: 'ctrl+shift+f',
            defaultKeybinding: 'ctrl+shift+f'
          },
          'prompter.importResource': {
            command: 'prompter.importResource',
            label: 'Import Resource',
            description: 'Add the selected resource to a prompt',
            keybinding: 'ctrl+shift+f',
            defaultKeybinding: 'ctrl+shift+f'
          },
          'prompter.importTerminalSelection': {
            command: 'prompter.importTerminalSelection',
            label: 'Import Terminal Selection',
            description: 'Import the current terminal selection into a prompt',
            keybinding: 'ctrl+shift+f',
            defaultKeybinding: 'ctrl+shift+f'
          }
        }
      }),
      'utf8'
    );

    const before = await stat(filePath);
    const repo = await PromptRepository.create(dir, now);
    const snapshot = await repo.getState();
    const after = await stat(filePath);

    expect(snapshot.settings.shortcuts['prompter.open']).toMatchObject({
      command: 'prompter.open',
      keybinding: 'cmd+shift+o',
      defaultKeybinding: 'ctrl+e'
    });
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('surfaces malformed persisted json instead of silently falling back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    await writeFile(join(dir, 'cards.json'), '{not valid json', 'utf8');

    await expect(PromptRepository.create(dir)).rejects.toThrow();
  });
});
