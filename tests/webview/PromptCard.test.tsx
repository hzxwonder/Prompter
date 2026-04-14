import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptCard as PromptCardModel } from '../../src/shared/models';
import { PromptCard } from '../../webview/src/components/PromptCard';

const baseCard: PromptCardModel = {
  id: 'card-1',
  title: 'Review auth flow',
  content: 'Inspect token refresh handling across tabs.',
  status: 'completed',
  runtimeState: 'finished',
  groupId: 'auth',
  groupName: 'auth',
  groupColor: '#7C3AED',
  sourceType: 'manual',
  createdAt: '2026-04-08T10:00:00.000Z',
  updatedAt: '2026-04-08T10:30:00.000Z',
  completedAt: '2026-04-08T10:30:00.000Z',
  dateBucket: '2026-04-08',
  fileRefs: [],
  justCompleted: true
};

afterEach(() => {
  cleanup();
});

describe('PromptCard', () => {
  it('acknowledges a just-completed card when the badge is clicked', async () => {
    const user = userEvent.setup();
    const onMoveCard = vi.fn();
    const onAcknowledgeCompletion = vi.fn();
    const onRenameGroup = vi.fn();

    render(
      <PromptCard
        card={baseCard}
        onMoveCard={onMoveCard}
        onAcknowledgeCompletion={onAcknowledgeCompletion}
        onRenameGroup={onRenameGroup}
        showAwaitingConfirmation
      />
    );

    await user.click(screen.getByRole('button', { name: '已完成，待确认，点击移入已完成' }));

    expect(onAcknowledgeCompletion).toHaveBeenCalledWith('card-1');
    expect(onAcknowledgeCompletion).toHaveBeenCalledTimes(1);
    expect(onMoveCard).not.toHaveBeenCalled();
  });

  it('shows codex fallback group name from session id for legacy unclassified cards', () => {
    render(
      <PromptCard
        card={{
          ...baseCard,
          justCompleted: false,
          groupName: '未分类',
          groupId: 'codex:session-42',
          sourceType: 'codex',
          sourceRef: 'session-42'
        }}
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Rename group' })).toHaveTextContent('session-42');
  });

  it('renames the whole group from the inline editor', async () => {
    const user = userEvent.setup();
    const onRenameGroup = vi.fn();

    render(
      <PromptCard
        card={{ ...baseCard, justCompleted: false, status: 'active', runtimeState: 'running' }}
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={onRenameGroup}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Rename group' }));
    const input = screen.getByRole('textbox', { name: 'Group name' });
    await user.clear(input);
    await user.type(input, 'authentication');
    await user.keyboard('{Enter}');

    expect(onRenameGroup).toHaveBeenCalledWith('auth', 'authentication');
  });

  it('does not enter composer edit when the expand button is toggled quickly', async () => {
    const user = userEvent.setup();
    const onEditInComposer = vi.fn();

    render(
      <PromptCard
        card={{
          ...baseCard,
          justCompleted: false,
          status: 'active',
          runtimeState: 'running',
          content:
            'Line 1 with detailed implementation notes that exceed the preview threshold.\nLine 2 keeps the text long enough to require expansion.\nLine 3 adds more content for the collapsed preview.\nLine 4 is still not the end of the prompt card content.\nLine 5 should only be fully visible after expanding.'
        }}
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={vi.fn()}
        onEditInComposer={onEditInComposer}
      />
    );

    const expandButton = screen.getByRole('button', { name: '展开完整 prompt' });
    await user.dblClick(expandButton);

    expect(onEditInComposer).not.toHaveBeenCalled();
  });

  it('switches the expand icon to an upward chevron after expanding', async () => {
    const user = userEvent.setup();

    render(
      <PromptCard
        card={{
          ...baseCard,
          justCompleted: false,
          status: 'active',
          runtimeState: 'running',
          content:
            'Line 1 with detailed implementation notes that exceed the preview threshold.\nLine 2 keeps the text long enough to require expansion.\nLine 3 adds more content for the collapsed preview.\nLine 4 is still not the end of the prompt card content.\nLine 5 should only be fully visible after expanding.'
        }}
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={vi.fn()}
      />
    );

    const expandButton = screen.getByRole('button', { name: '展开完整 prompt' });
    const collapsedPath = expandButton.querySelector('path')?.getAttribute('d');

    await user.click(expandButton);

    const collapseButton = screen.getByRole('button', { name: '收起完整 prompt' });
    const expandedPath = collapseButton.querySelector('path')?.getAttribute('d');

    expect(collapsedPath).toBe('M3.22 5.47a.75.75 0 0 1 1.06 0L8 9.19l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.53a.75.75 0 0 1 0-1.06z');
    expect(expandedPath).toBe('M3.22 10.53a.75.75 0 0 0 1.06 0L8 6.81l3.72 3.72a.75.75 0 1 0 1.06-1.06L8.53 5.22a.75.75 0 0 0-1.06 0L3.22 9.47a.75.75 0 0 0 0 1.06z');
  });

  it('acknowledges an awaiting-confirmation active card when the badge is clicked', async () => {
    const user = userEvent.setup();
    const onAcknowledgeCompletion = vi.fn();

    render(
      <PromptCard
        card={{ ...baseCard, justCompleted: false, status: 'active', runtimeState: 'running' }}
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={onAcknowledgeCompletion}
        onRenameGroup={vi.fn()}
        showAwaitingConfirmation
      />
    );

    await user.click(screen.getByRole('button', { name: '已完成，待确认，点击移入已完成' }));

    expect(onAcknowledgeCompletion).toHaveBeenCalledWith('card-1');
  });
});
