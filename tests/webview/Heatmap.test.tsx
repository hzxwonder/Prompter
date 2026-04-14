import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Heatmap } from '../../webview/src/components/Heatmap';
import type { DailyStats } from '../../src/shared/models';

afterEach(() => {
  cleanup();
});

describe('Heatmap', () => {
  it('maps daily totals into the requested fixed intensity thresholds', async () => {
    const user = userEvent.setup();
    const year = new Date().getFullYear();
    const stats: DailyStats[] = [
      { date: `${year}-01-01`, usedCount: 0, unusedCount: 0, completedCount: 0, totalCount: 0 },
      { date: `${year}-01-02`, usedCount: 9, unusedCount: 0, completedCount: 0, totalCount: 9 },
      { date: `${year}-01-03`, usedCount: 10, unusedCount: 0, completedCount: 0, totalCount: 10 },
      { date: `${year}-01-04`, usedCount: 29, unusedCount: 0, completedCount: 0, totalCount: 29 },
      { date: `${year}-01-05`, usedCount: 30, unusedCount: 0, completedCount: 0, totalCount: 30 },
      { date: `${year}-01-06`, usedCount: 59, unusedCount: 0, completedCount: 0, totalCount: 59 },
      { date: `${year}-01-07`, usedCount: 60, unusedCount: 0, completedCount: 0, totalCount: 60 },
      { date: `${year}-01-08`, usedCount: 100, unusedCount: 0, completedCount: 0, totalCount: 100 }
    ];

    render(<Heatmap stats={stats} onSelectDate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^Jan\b/ }));

    const grid = screen.getByText(`January ${year}`).closest('.heatmap-detail') as HTMLElement | null;
    expect(grid).not.toBeNull();
    if (!grid) {
      throw new Error('Heatmap month detail not found');
    }

    expect(within(grid).getByRole('button', { name: '1' })).toHaveAttribute('data-intensity', '0');
    expect(within(grid).getByRole('button', { name: '2' })).toHaveAttribute('data-intensity', '0');
    expect(within(grid).getByRole('button', { name: '3' })).toHaveAttribute('data-intensity', '1');
    expect(within(grid).getByRole('button', { name: '4' })).toHaveAttribute('data-intensity', '1');
    expect(within(grid).getByRole('button', { name: '5' })).toHaveAttribute('data-intensity', '2');
    expect(within(grid).getByRole('button', { name: '6' })).toHaveAttribute('data-intensity', '2');
    expect(within(grid).getByRole('button', { name: '7' })).toHaveAttribute('data-intensity', '3');
    expect(within(grid).getByRole('button', { name: '8' })).toHaveAttribute('data-intensity', '4');
  });
});
