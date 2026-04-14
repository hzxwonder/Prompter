import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../webview/src/pages/SettingsPage';
import { createInitialState, type PrompterSettings } from '../../src/shared/models';

const createSettings = (): PrompterSettings => ({
  ...createInitialState('2026-04-08T10:00:00.000Z').settings,
  dataDir: '~/prompter/cache',
  language: 'zh-CN',
  theme: 'system',
  defaultImportMode: 'absolute',
  notifyOnFinish: false,
  notifyOnPause: true,
  completionTone: 'off',
  customTonePath: '',
  logSources: {
    'claude-code': { enabled: true, path: '~/Library/Logs/Claude' },
    codex: { enabled: false, path: '~/Library/Logs/Codex' },
    'roo-code': { enabled: false, path: '~/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/tasks' }
  }
});

const createEnglishSettings = (): PrompterSettings => ({
  ...createSettings(),
  language: 'en'
});

afterEach(cleanup);

describe('SettingsPage', () => {
  it('renders categorized settings controls for general preferences and log sources', () => {
    render(<SettingsPage settings={createSettings()} onSettingsChange={() => {}} onDataDirSwitch={() => {}} onClearCache={() => {}} />);

    expect(screen.getByRole('heading', { name: '通用' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '通知' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '存储与日志' })).toBeInTheDocument();

    expect(screen.getByLabelText('语言')).toHaveValue('zh-CN');
    expect(screen.queryByLabelText('主题')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('默认导入方式')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Prompt 完成时通知' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Prompt 暂停时通知' })).toBeChecked();
    expect(screen.getByLabelText('完成提示音')).toHaveValue('off');
    expect(screen.getByLabelText('数据目录')).toHaveValue('~/prompter/cache');
    expect(screen.queryByRole('button', { name: '应用数据目录' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '启用 claude-code 日志' })).toBeChecked();
    expect(screen.getByLabelText('claude-code 日志路径')).toHaveValue('~/Library/Logs/Claude');
    expect(screen.getByRole('checkbox', { name: '启用 codex 日志' })).not.toBeChecked();
    expect(screen.getByLabelText('codex 日志路径')).toHaveValue('~/Library/Logs/Codex');
    expect(screen.queryByRole('checkbox', { name: '启用 roo-code 日志' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清空缓存' })).not.toBeInTheDocument();
  });

  it('switches settings copy to English when English is selected', () => {
    render(
      <SettingsPage
        settings={createEnglishSettings()}
        onSettingsChange={() => {}}
        onDataDirSwitch={() => {}}
        onClearCache={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Storage & logs' })).toBeInTheDocument();
    expect(screen.getByText('Choose the interface language.')).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toHaveValue('en');
    expect(screen.queryByLabelText('Theme')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Default import mode')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Notify when a prompt pauses' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Enable claude-code logs' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Clear cache' })).not.toBeInTheDocument();
  });

  it('reveals staged data-directory apply controls and only switches after apply', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const onDataDirSwitch = vi.fn();

    render(
      <SettingsPage
        settings={createSettings()}
        onSettingsChange={onSettingsChange}
        onDataDirSwitch={onDataDirSwitch}
        onClearCache={() => {}}
      />
    );

    await user.clear(screen.getByLabelText('数据目录'));
    await user.type(screen.getByLabelText('数据目录'), '/tmp/prompter-next');

    expect(onSettingsChange).not.toHaveBeenCalledWith(expect.objectContaining({ dataDir: '/tmp/prompter-next' }));
    expect(screen.getByRole('radio', { name: '迁移现有数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用数据目录' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '迁移现有数据' }));
    await user.click(screen.getByRole('button', { name: '应用数据目录' }));

    expect(onDataDirSwitch).toHaveBeenCalledWith({ targetDir: '/tmp/prompter-next', migrate: true });
  });

  it('emits settings updates for changed fields and log source values', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [settings, setSettings] = useState(createSettings());

      return (
        <SettingsPage
          settings={settings}
          onSettingsChange={(nextSettings) => {
            setSettings((current) => ({
              ...current,
              ...nextSettings,
              logSources: nextSettings.logSources ?? current.logSources
            }));
          }}
          onDataDirSwitch={() => {}}
          onClearCache={() => {}}
        />
      );
    }

    render(<Harness />);

    await user.selectOptions(screen.getByLabelText('语言'), 'en');
    await user.click(screen.getByRole('checkbox', { name: 'Notify when a prompt finishes' }));
    await user.click(screen.getByRole('checkbox', { name: 'Notify when a prompt pauses' }));
    await user.selectOptions(screen.getByLabelText('Completion tone'), 'soft-bell');
    await user.clear(screen.getByLabelText('Data directory'));
    await user.type(screen.getByLabelText('Data directory'), '/tmp/prompter');
    await user.click(screen.getByRole('checkbox', { name: 'Enable codex logs' }));
    await user.clear(screen.getByLabelText('codex log path'));
    await user.type(screen.getByLabelText('codex log path'), '/tmp/codex.log');

    expect(screen.getByLabelText('Language')).toHaveValue('en');
    expect(screen.queryByLabelText('Theme')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Default import mode')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Notify when a prompt finishes' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Notify when a prompt pauses' })).not.toBeChecked();
    expect(screen.getByLabelText('Completion tone')).toHaveValue('soft-bell');
    expect(screen.getByLabelText('Data directory')).toHaveValue('/tmp/prompter');
    expect(screen.getByRole('checkbox', { name: 'Enable codex logs' })).toBeChecked();
    expect(screen.getByLabelText('codex log path')).toHaveValue('/tmp/codex.log');
  });

  it('reveals the custom tone path field only when custom tone is selected', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [settings, setSettings] = useState(createSettings());

      return (
        <SettingsPage
          settings={settings}
          onSettingsChange={(nextSettings) => {
            setSettings((current) => ({
              ...current,
              ...nextSettings,
              logSources: nextSettings.logSources ?? current.logSources
            }));
          }}
          onDataDirSwitch={() => {}}
          onClearCache={() => {}}
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByLabelText('自定义提示音路径')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('完成提示音'), 'custom');

    expect(screen.getByLabelText('完成提示音')).toHaveValue('custom');
    expect(screen.getByLabelText('自定义提示音路径')).toBeInTheDocument();
  });

  it('renders safely when a log source entry is missing', () => {
    const settings = createSettings();
    const partialSettings = {
      ...settings,
      logSources: {
        'claude-code': settings.logSources['claude-code'],
        'roo-code': settings.logSources['roo-code']
      }
    } as PrompterSettings;

    render(
      <SettingsPage
        settings={partialSettings}
        onSettingsChange={() => {}}
        onDataDirSwitch={() => {}}
        onClearCache={() => {}}
      />
    );

    expect(screen.getByRole('checkbox', { name: '启用 codex 日志' })).not.toBeChecked();
    expect(screen.getByLabelText('codex 日志路径')).toHaveValue('');
    expect(screen.queryByRole('checkbox', { name: '启用 roo-code 日志' })).not.toBeInTheDocument();
  });
});
