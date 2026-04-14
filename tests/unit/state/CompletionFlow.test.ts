import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PromptRepository } from '../../../src/state/PromptRepository';

describe('completion flow', () => {
  it('moves a log-completed card straight into the completed lane', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T10:00:00.000Z');

    const card = await repo.saveImportedCard({
      title: 'Run migration',
      content: 'Apply the pending schema changes',
      groupName: 'db',
      sourceType: 'claude-code',
      status: 'active',
      runtimeState: 'running'
    });

    await repo.markCardCompletedFromLog(card.id, '2026-04-08T10:30:00.000Z');

    const snapshot = await repo.getState();
    expect(snapshot.cards[0]).toMatchObject({
      id: card.id,
      status: 'completed',
      runtimeState: 'finished',
      justCompleted: true,
      completedAt: '2026-04-08T10:30:00.000Z'
    });
    expect(snapshot.dailyStats).toEqual([
      {
        date: '2026-04-08',
        usedCount: 1,
        unusedCount: 0,
        completedCount: 1,
        totalCount: 1
      }
    ]);
  });

  it('auto-completes active cards that have been running for over two hours', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-'));
    const repo = await PromptRepository.create(dir, () => '2026-04-08T12:30:00.000Z');

    const card = await repo.saveImportedCard({
      title: 'Finalize release note',
      content: 'Summarize user-facing changes',
      groupName: 'release',
      sourceType: 'cursor',
      status: 'active',
      runtimeState: 'running',
      createdAt: '2026-04-08T10:00:00.000Z'
    });

    const completedIds = await repo.autoCompleteExpiredActiveCards(2 * 60 * 60 * 1000);

    const snapshot = await repo.getState();
    expect(completedIds).toEqual([card.id]);
    expect(snapshot.cards[0]).toMatchObject({
      id: card.id,
      status: 'completed',
      runtimeState: 'finished',
      justCompleted: false,
      completedAt: '2026-04-08T12:30:00.000Z'
    });
  });
});
