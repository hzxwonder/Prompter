import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createInitialState, toDateBucket, toLocalDateBucket } from '../../../src/shared/models';

describe('createInitialState', () => {
  it('starts on workspace with scaffold defaults', () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');

    expect(state.activeView).toBe('workspace');
    expect(state.cards).toEqual([]);
    expect(state.workspaceCards).toEqual([]);
    expect(state.modularPrompts).toEqual([]);
    expect(state.selectedDate).toBe('2026-04-08');
    expect(state.settings.dataDir).toBe('~/prompter');
    expect(state.settings.theme).toBe('system');
    expect(state.settings.defaultImportMode).toBe('absolute');
    expect(Object.keys(state.settings.logSources)).toEqual([
      'claude-code',
      'codex',
      'roo-code'
    ]);
    expect(state.settings.notifyOnFinish).toBe(true);
    expect(state.settings.notifyOnPause).toBe(true);
  });

  it('includes the default shortcut catalog in settings', () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');

    expect(Object.keys(state.settings.shortcuts)).toEqual([
      'prompter.open',
      'prompter.importSelection',
      'prompter.importResource',
      'prompter.importTerminalSelection'
    ]);
    expect(state.settings.shortcuts['prompter.open']).toMatchObject({
      command: 'prompter.open',
      keybinding: 'ctrl+e',
      defaultKeybinding: 'ctrl+e'
    });
    expect(state.settings.shortcuts['prompter.importSelection']).toMatchObject({
      command: 'prompter.importSelection',
      keybinding: 'ctrl+shift+f',
      defaultKeybinding: 'ctrl+shift+f'
    });
  });

  it('uses the same ctrl-based defaults across platforms', () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z', 'win32');

    expect(state.settings.shortcuts['prompter.open']).toMatchObject({
      keybinding: 'ctrl+e',
      defaultKeybinding: 'ctrl+e'
    });
    expect(state.settings.shortcuts['prompter.importTerminalSelection']).toMatchObject({
      keybinding: 'ctrl+shift+f',
      defaultKeybinding: 'ctrl+shift+f'
    });
  });

  it('keeps contributed import keybindings aligned with settings defaults', async () => {
    const state = createInitialState('2026-04-08T10:00:00.000Z');
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as {
      contributes: {
        keybindings: Array<{ command: string; key?: string; mac?: string; when?: string }>;
      };
    };

    const importDefaults = state.settings.shortcuts['prompter.importResource'].defaultKeybinding;
    const contributedImportBindings = packageJson.contributes.keybindings.filter((binding) =>
      [
        'prompter.importSelection',
        'prompter.importResource',
        'prompter.importTerminalSelection'
      ].includes(binding.command)
    );

    expect(contributedImportBindings).toHaveLength(3);
    expect(contributedImportBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'prompter.importResource',
          key: importDefaults,
          mac: importDefaults
        })
      ])
    );
    expect(contributedImportBindings.every((binding) => binding.key === importDefaults && binding.mac === importDefaults)).toBe(true);
  });

  it('declares the Prompter activity bar view as a webview', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as {
      contributes: {
        views: {
          prompter: Array<{ id: string; type?: string }>;
        };
      };
    };

    expect(packageJson.contributes.views.prompter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'prompterSidebar',
          type: 'webview'
        })
      ])
    );
  });

  it('uses the local calendar day instead of the UTC date when building date buckets', () => {
    const timestamp = '2026-04-15T16:10:00.000Z';
    const local = new Date(timestamp);
    const expected = [
      local.getFullYear(),
      String(local.getMonth() + 1).padStart(2, '0'),
      String(local.getDate()).padStart(2, '0')
    ].join('-');

    expect(toDateBucket(timestamp)).toBe(expected);
  });

  it('builds local date buckets directly from Date instances and epoch timestamps', () => {
    const timestamp = new Date('2026-04-16T16:10:00.000Z');
    const expected = [
      timestamp.getFullYear(),
      String(timestamp.getMonth() + 1).padStart(2, '0'),
      String(timestamp.getDate()).padStart(2, '0')
    ].join('-');

    expect(toLocalDateBucket(timestamp)).toBe(expected);
    expect(toLocalDateBucket(timestamp.getTime())).toBe(expected);
  });
});
