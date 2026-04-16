// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/shared/models';

vi.mock('../../webview/src/api/vscode', () => ({
  postMessage: vi.fn()
}));

describe('ToastViewport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders incoming toasts and auto-dismisses them after ten seconds', async () => {
    vi.useFakeTimers();
    const { App } = await import('../../webview/src/App');
    const initialState = createInitialState('2026-04-16T09:00:00.000Z');

    const { rerender } = render(<App initialState={initialState} />);

    rerender(
      <App
        initialState={initialState}
        lastMessage={{
          type: 'toast:show',
          payload: { id: 'toast-1', kind: 'success', message: 'Prompt completed' }
        }}
      />
    );

    expect(screen.getByText('Prompt completed')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.queryByText('Prompt completed')).not.toBeInTheDocument();
  });

  it('pauses auto-dismiss while the toast is hovered', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { ToastViewport } = await import('../../webview/src/components/ToastViewport');

    render(
      <ToastViewport
        toasts={[{ id: 'toast-1', kind: 'info', message: 'Sync complete' }]}
        onDismiss={onDismiss}
        onAction={vi.fn()}
      />
    );

    const toast = screen.getByText('Sync complete').closest('[data-toast-id="toast-1"]');
    expect(toast).not.toBeNull();

    fireEvent.mouseEnter(toast!);

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(toast!);

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });
});
