import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryPage } from '../../webview/src/pages/HistoryPage';
import type { PrompterState } from '../../src/shared/models';
import { createInitialState } from '../../src/shared/models';

function createHistoryState(): PrompterState {
  return {
    ...createInitialState('2026-04-08T10:00:00.000Z'),
    activeView: 'history',
    selectedDate: '2026-04-08',
    dailyStats: [
      {
        date: '2026-04-08',
        usedCount: 1,
        unusedCount: 1,
        completedCount: 1,
        totalCount: 2
      }
    ],
    cards: [
      {
        id: 'history-1',
        title: 'Draft API prompt',
        content: 'Map the API surface before refactoring.',
        status: 'unused',
        runtimeState: 'unknown',
        groupId: 'session-a',
        groupName: 'api',
        groupColor: '#7C3AED',
        sourceType: 'manual',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      },
      {
        id: 'history-2',
        title: 'Draft API prompt 2',
        content: 'Summarize the release notes.',
        status: 'completed',
        runtimeState: 'finished',
        groupId: 'session-b',
        groupName: '未分类',
        groupColor: '#10B981',
        sourceType: 'codex',
        sourceRef: 'codex-session-b',
        createdAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T10:30:00.000Z',
        completedAt: '2026-04-08T10:30:00.000Z',
        dateBucket: '2026-04-08',
        fileRefs: [],
        justCompleted: false
      }
    ]
  };
}

afterEach(cleanup);

describe('HistoryPage', () => {
  it('renders selected date cards grouped by stable group id and falls back to session id for codex history labels', async () => {
    const user = userEvent.setup();
    const state = createHistoryState();

    render(
      <HistoryPage
        historyImport={state.historyImport}
        dailyStats={state.dailyStats}
        cards={state.cards}
        selectedDate={state.selectedDate}
        onSelectDate={() => {}}
      />
    );

    expect(screen.getByRole('region', { name: '选中日期详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api 1 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /codex-session-b 1 条/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /codex-session-b 1 条/ }));
    expect(screen.getByText('Summarize the release notes.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows an empty state when no activity exists', () => {
    render(<HistoryPage dailyStats={[]} cards={[]} selectedDate={undefined} onSelectDate={() => {}} language="en" />);

    expect(screen.getByText('No prompt activity yet.')).toBeInTheDocument();
  });

  it('switches history copy to English when English is selected', async () => {
    const user = userEvent.setup();
    const state = createHistoryState();

    render(
      <HistoryPage
        historyImport={state.historyImport}
        dailyStats={state.dailyStats}
        cards={state.cards}
        selectedDate={state.selectedDate}
        onSelectDate={() => {}}
        language="en"
      />
    );

    expect(screen.getByRole('region', { name: 'Selected day details' })).toBeInTheDocument();
    expect(screen.getByText('Read-only prompt cards captured on the selected day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api 1 items/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /codex-session-b 1 items/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unused 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed 1' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Copy content' })).toBeInTheDocument();
  });

  it('shows backfill progress by source count and omits an inherited prompt total', () => {
    const state = createHistoryState();
    state.historyImport = {
      scope: 'history-backfill',
      status: 'running',
      processedPrompts: 40,
      totalPrompts: 100,
      processedSources: 2,
      totalSources: 5,
      foregroundReady: true,
      warningAcknowledged: false,
      pendingEntries: [],
      completedEntries: []
    };

    render(
      <HistoryPage
        historyImport={state.historyImport}
        dailyStats={state.dailyStats}
        cards={state.cards}
        selectedDate={state.selectedDate}
        onSelectDate={() => {}}
      />
    );

    expect(screen.getByRole('progressbar', { name: '历史导入进度' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('历史导入中')).toBeInTheDocument();
    expect(screen.getByText('已处理 40 条 prompt')).toBeInTheDocument();
  });

  it('shows a start button when historical backfill is pending', async () => {
    const user = userEvent.setup();
    const state = createHistoryState();
    const onStartHistoryImport = vi.fn();
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'idle',
      foregroundReady: true,
      warningAcknowledged: false,
      pendingEntries: [
        {
          id: 'codex:/tmp/old.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        }
      ],
      completedEntries: []
    };

    render(
      <HistoryPage
        historyImport={state.historyImport}
        dailyStats={state.dailyStats}
        cards={state.cards}
        selectedDate={state.selectedDate}
        onSelectDate={() => {}}
        onStartHistoryImport={onStartHistoryImport}
        onPauseHistoryImport={() => {}}
      />
    );

    expect(screen.getByText('今日 prompt 已自动加载到工作台。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '开始' }));
    expect(onStartHistoryImport).toHaveBeenCalledTimes(1);
  });

  it('shows a pause button while historical backfill is running', async () => {
    const user = userEvent.setup();
    const state = createHistoryState();
    const onPauseHistoryImport = vi.fn();
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'running',
      foregroundReady: true,
      warningAcknowledged: true,
      pendingEntries: [
        {
          id: 'codex:/tmp/old.jsonl',
          sourceType: 'codex',
          filePath: '/tmp/old.jsonl',
          dateBucket: '2026-04-07',
          lastModifiedMs: Date.parse('2026-04-07T10:00:00.000Z')
        }
      ],
      completedEntries: []
    };

    render(
      <HistoryPage
        historyImport={state.historyImport}
        dailyStats={state.dailyStats}
        cards={state.cards}
        selectedDate={state.selectedDate}
        onSelectDate={() => {}}
        onStartHistoryImport={() => {}}
        onPauseHistoryImport={onPauseHistoryImport}
      />
    );

    await user.click(screen.getByRole('button', { name: '暂停' }));
    expect(onPauseHistoryImport).toHaveBeenCalledTimes(1);
  });

  it('disables the history import button after all history is processed', () => {
    const state = createHistoryState();
    state.historyImport = {
      ...state.historyImport,
      scope: 'history-backfill',
      status: 'complete',
      foregroundReady: true,
      warningAcknowledged: true,
      pendingEntries: [],
      completedEntries: ['codex:/tmp/old.jsonl']
    };

    render(
      <HistoryPage
        historyImport={state.historyImport}
        dailyStats={state.dailyStats}
        cards={state.cards}
        selectedDate={state.selectedDate}
        onSelectDate={() => {}}
        onStartHistoryImport={() => {}}
        onPauseHistoryImport={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: '开始' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '开始' })).toHaveAttribute('title', '历史数据已经完全处理完毕');
  });
});
