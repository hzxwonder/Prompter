import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModularPrompt } from '../../src/shared/models';
import { ModularPromptManager } from '../../webview/src/components/ModularPromptManager';

const prompts: ModularPrompt[] = [
  {
    id: 'mod-1',
    name: 'root-cause',
    content: 'List the symptoms, identify the trigger, then propose the fix.',
    category: 'analysis',
    updatedAt: '2026-04-08T10:00:00.000Z'
  }
];

afterEach(() => {
  cleanup();
});

describe('ModularPromptManager', () => {
  it('saves a new modular prompt', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<ModularPromptManager prompts={prompts} onSave={onSave} onClose={vi.fn()} />);

    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'summary');
    await user.clear(screen.getByRole('textbox', { name: 'Category' }));
    await user.type(screen.getByRole('textbox', { name: 'Category' }), 'writing');
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Summarize the findings in three bullets.');
    await user.click(screen.getByRole('button', { name: 'Save modular prompt' }));

    expect(onSave).toHaveBeenCalledWith({
      id: undefined,
      name: 'summary',
      content: 'Summarize the findings in three bullets.',
      category: 'writing'
    });
  });
});
