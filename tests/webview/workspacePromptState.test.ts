import { describe, expect, it } from 'vitest';
import type { PromptCard } from '../../src/shared/models';
import { getPromptActivityState } from '../../webview/src/lib/promptActivity';

const baseCard: PromptCard = {
  id: 'card-1',
  title: 'Investigate sync lag',
  content: 'Check why active cards are not settling correctly.',
  status: 'active',
  runtimeState: 'running',
  groupId: 'session-a',
  groupName: 'session-a',
  groupColor: '#0ea5e9',
  sourceType: 'codex',
  sourceRef: 'session-a:turn-1',
  createdAt: '2026-04-08T10:00:00.000Z',
  updatedAt: '2026-04-08T10:00:00.000Z',
  dateBucket: '2026-04-08',
  fileRefs: [],
  justCompleted: false
};

describe('workspace prompt activity state', () => {
  it('marks an active prompt as awaiting confirmation after twenty minutes', () => {
    expect(
      getPromptActivityState({
        card: baseCard,
        nowMs: Date.parse('2026-04-08T10:21:00.000Z')
      })
    ).toBe('awaiting-confirmation');
  });

  it('keeps newer active prompts in the normal active state', () => {
    expect(
      getPromptActivityState({
        card: baseCard,
        nowMs: Date.parse('2026-04-08T10:10:00.000Z')
      })
    ).toBe('active');
  });

  it('does not show awaiting confirmation once a card is already completed', () => {
    expect(
      getPromptActivityState({
        card: { ...baseCard, status: 'completed', runtimeState: 'finished', completedAt: '2026-04-08T10:30:00.000Z' },
        nowMs: Date.parse('2026-04-08T12:10:00.000Z')
      })
    ).toBe('completed');
  });
});
