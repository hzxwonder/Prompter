import type { PromptCard } from '../../../src/shared/models';

export type PromptActivityState = 'active' | 'paused' | 'awaiting-confirmation' | 'completed';

const AWAITING_CONFIRMATION_MS = 20 * 60 * 1000;

export function getPromptActivityState({
  card,
  nowMs
}: {
  card: PromptCard;
  nowMs: number;
}): PromptActivityState {
  if (card.status === 'active' && card.runtimeState === 'paused') {
    return 'paused';
  }

  if (card.status !== 'active' || card.runtimeState !== 'running') {
    return 'completed';
  }

  const baselineMs = Date.parse(card.lastActiveAt ?? card.createdAt);
  if (Number.isNaN(baselineMs)) {
    return 'active';
  }

  return nowMs - baselineMs >= AWAITING_CONFIRMATION_MS
    ? 'awaiting-confirmation'
    : 'active';
}
