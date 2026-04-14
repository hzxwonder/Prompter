import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ShortcutsPage } from '../../webview/src/pages/ShortcutsPage';
import { createInitialState, type PrompterSettings } from '../../src/shared/models';

afterEach(cleanup);

function createSettings(overrides: Partial<PrompterSettings['shortcuts']> = {}): PrompterSettings {
  return {
    ...createInitialState('2026-04-12T10:00:00.000Z').settings,
    shortcuts: {
      ...createInitialState('2026-04-12T10:00:00.000Z').settings.shortcuts,
      ...overrides
    }
  };
}

function Harness({ onSaveShortcuts }: { onSaveShortcuts: (shortcuts: PrompterSettings['shortcuts']) => void }) {
  const [settings, setSettings] = useState(createSettings());
  const [saveState, setSaveState] = useState<{
    status: 'idle' | 'saving' | 'success' | 'error';
    command: keyof PrompterSettings['shortcuts'] | null;
    message?: string;
  }>({
    status: 'idle',
    command: null
  });

  return (
    <ShortcutsPage
      settings={settings}
      saveState={saveState}
      onSaveShortcuts={(command, shortcuts) => {
        setSaveState({ status: 'saving', command });
        setSettings((current) => ({
          ...current,
          shortcuts
        }));
        setSaveState({ status: 'success', command });
        onSaveShortcuts(shortcuts);
      }}
    />
  );
}

describe('ShortcutsPage', () => {
  it('renders all four Prompter commands in a compact shortcuts table', () => {
    render(<Harness onSaveShortcuts={() => {}} />);

    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Prompter 快捷键' })).toBeInTheDocument();
    expect(screen.getByText('Open Prompter')).toBeInTheDocument();
    expect(screen.getByText('Import Selection')).toBeInTheDocument();
    expect(screen.getByText('Import Resource')).toBeInTheDocument();
    expect(screen.getByText('Import Terminal Selection')).toBeInTheDocument();
  });

  it('blocks open-command conflicts and auto-saves valid bindings immediately', async () => {
    const user = userEvent.setup();
    const onSaveShortcuts = vi.fn();

    render(<Harness onSaveShortcuts={onSaveShortcuts} />);

    await user.click(screen.getByRole('button', { name: '编辑 Open Prompter 快捷键' }));
    await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}');

    expect(screen.getByText('Open Prompter 不能和导入类命令使用同一个快捷键。')).toBeInTheDocument();
    expect(onSaveShortcuts).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '编辑 Import Selection 快捷键' }));
    await user.keyboard('{Control>}{Shift>}u{/Shift}{/Control}');

    expect(onSaveShortcuts).toHaveBeenCalledTimes(1);
    expect(onSaveShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({
        'prompter.importSelection': expect.objectContaining({ keybinding: 'ctrl+shift+u' })
      })
    );

    const selectionRow = screen.getByRole('row', { name: 'Import Selection' });
    expect(within(selectionRow).getByText('ctrl+shift+u')).toBeInTheDocument();
    expect(within(selectionRow).queryByText('Staged')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑 Import Resource 快捷键' }));
    await user.keyboard('{Control>}{Shift>}u{/Shift}{/Control}');

    expect(screen.queryByText('Import Explorer Resource conflicts with Open Prompter.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: 'Import Resource' })).getByText('ctrl+shift+u')).toBeInTheDocument();

    expect(onSaveShortcuts).toHaveBeenCalledTimes(2);
    expect(onSaveShortcuts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'prompter.importSelection': expect.objectContaining({ keybinding: 'ctrl+shift+u' }),
        'prompter.importResource': expect.objectContaining({ keybinding: 'ctrl+shift+u' })
      })
    );
  });

  it('automatically resets a shortcut to default', async () => {
    const user = userEvent.setup();
    const onSaveShortcuts = vi.fn();

    render(<Harness onSaveShortcuts={onSaveShortcuts} />);

    await user.click(screen.getByRole('button', { name: '编辑 Open Prompter 快捷键' }));
    await user.keyboard('{Control>}k{/Control}');

    const row = screen.getByRole('row', { name: 'Open Prompter' });
    expect(within(row).getByText('ctrl+k')).toBeInTheDocument();
    expect(onSaveShortcuts).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '恢复默认 Open Prompter 快捷键' }));

    expect(within(row).getByText('ctrl+e')).toBeInTheDocument();
    expect(onSaveShortcuts).toHaveBeenCalledTimes(2);
  });

  it('switches shortcuts copy to Chinese when Chinese is selected', () => {
    render(
      <ShortcutsPage
        settings={createSettings()}
        saveState={{ status: 'idle', command: null }}
        onSaveShortcuts={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Prompter 快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '命令' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 Open Prompter 快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复默认 Open Prompter 快捷键' })).toBeInTheDocument();
  });
});
