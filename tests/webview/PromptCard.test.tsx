// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptCard as PromptCardModel } from '../../src/shared/models';

const postMessage = vi.fn();

const baseCard: PromptCardModel = {
  id: 'card-1',
  title: 'Completed prompt',
  content: 'This prompt already completed.',
  status: 'completed',
  runtimeState: 'finished',
  groupId: 'group-1',
  groupName: '版本管理',
  groupColor: '#0ea5e9',
  sourceType: 'codex',
  sourceRef: 'session-a:turn-1',
  createdAt: '2026-04-08T10:00:00.000Z',
  updatedAt: '2026-04-08T10:10:00.000Z',
  completedAt: '2026-04-08T10:10:00.000Z',
  dateBucket: '2026-04-08',
  fileRefs: [],
  justCompleted: true
};

describe('PromptCard', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    postMessage.mockClear();
    Object.defineProperty(window, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({ postMessage })
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it('shows awaiting-confirmation UI for just-completed cards', async () => {
    const { PromptCard } = await import('../../webview/src/components/PromptCard');

    render(
      <PromptCard
        language="zh-CN"
        card={baseCard}
        showStatusBadge
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={vi.fn()}
      />
    );

    expect(screen.getAllByText('已完成，待确认').length).toBeGreaterThan(0);
  });

  it('does not show awaiting-confirmation UI for a settled completed card', async () => {
    const { PromptCard } = await import('../../webview/src/components/PromptCard');

    render(
      <PromptCard
        language="zh-CN"
        card={{ ...baseCard, justCompleted: false }}
        showStatusBadge
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={vi.fn()}
      />
    );

    expect(screen.queryByText('已完成，待确认')).not.toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('shows a paused badge for paused active cards', async () => {
    const { PromptCard } = await import('../../webview/src/components/PromptCard');

    render(
      <PromptCard
        language="en"
        card={{
          ...baseCard,
          status: 'active',
          runtimeState: 'paused',
          justCompleted: false,
          completedAt: undefined
        }}
        showStatusBadge
        onMoveCard={vi.fn()}
        onAcknowledgeCompletion={vi.fn()}
        onRenameGroup={vi.fn()}
      />
    );

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('Completed, awaiting confirmation')).not.toBeInTheDocument();
  });
});
