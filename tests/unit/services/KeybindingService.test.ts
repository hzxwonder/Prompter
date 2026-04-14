import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../src/shared/models';
import { KeybindingService } from '../../../src/services/KeybindingService';

describe('KeybindingService', () => {
  it('rewrites only Prompter-owned entries and keeps unrelated user keybindings untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-keybindings-'));
    const filePath = join(dir, 'keybindings.json');
    const shortcuts = createInitialState('2026-04-08T10:00:00.000Z').settings.shortcuts;

    await writeFile(
      filePath,
      `[
  // unrelated user binding
  { "command": "workbench.action.files.openFile", "key": "cmd+o" },
  {
    "command": "prompter.open",
    "key": "ctrl+shift+o",
    "mac": "ctrl+shift+o",
    "when": "editorTextFocus"
  },
  {
    "command": "my.other.command",
    "key": "ctrl+l",
    "when": "terminalFocus",
    "args": { "preserve": true },
  },
  {
    "command": "prompter.importSelection",
    "key": "ctrl+1",
    "when": "editorTextFocus"
  },
  {
    "command": "prompter.importResource",
    "key": "ctrl+2",
    "when": "explorerResourceIsFolder == true"
  },
  {
    "command": "prompter.importTerminalSelection",
    "key": "ctrl+3",
    "when": "editorTextFocus"
  },
]`,
      'utf8'
    );

    const service = new KeybindingService(filePath);
    await service.applyShortcuts(shortcuts);

    const text = await readFile(filePath, 'utf8');

    expect(text).toContain('// unrelated user binding');
    expect(text).toContain('{ "command": "workbench.action.files.openFile", "key": "cmd+o" }');
    expect(text).toContain('"command": "my.other.command"');
    expect(text).toContain('"args": { "preserve": true }');
    expect(text).toContain('"command": "prompter.open"');
    expect(text).toContain('"key": "ctrl+e"');
    expect(text).toContain('"command": "prompter.importSelection"');
    expect(text).toContain('"when": "editorTextFocus && editorHasSelection"');
    expect(text).toContain('"command": "prompter.importResource"');
    expect(text).toContain('"when": "filesExplorerFocus && !inputFocus"');
    expect(text).toContain('"command": "prompter.importTerminalSelection"');
    expect(text).toContain('"when": "terminalFocus"');
    expect(text).not.toContain('"ctrl+1"');
    expect(text).not.toContain('"ctrl+2"');
    expect(text).not.toContain('"ctrl+3"');
  });

  it('creates a new keybindings file when none exists yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompter-keybindings-'));
    const filePath = join(dir, 'keybindings.json');
    const shortcuts = createInitialState('2026-04-08T10:00:00.000Z').settings.shortcuts;

    const service = new KeybindingService(filePath);
    await service.applyShortcuts(shortcuts);

    const entries = JSON.parse(await readFile(filePath, 'utf8')) as Array<Record<string, unknown>>;

    expect(entries).toEqual([
      {
        command: 'prompter.open',
        key: 'ctrl+e',
        mac: 'ctrl+e'
      },
      {
        command: 'prompter.importSelection',
        key: 'ctrl+shift+f',
        mac: 'ctrl+shift+f',
        when: 'editorTextFocus && editorHasSelection'
      },
      {
        command: 'prompter.importResource',
        key: 'ctrl+shift+f',
        mac: 'ctrl+shift+f',
        when: 'filesExplorerFocus && !inputFocus'
      },
      {
        command: 'prompter.importTerminalSelection',
        key: 'ctrl+shift+f',
        mac: 'ctrl+shift+f',
        when: 'terminalFocus'
      }
    ]);
  });
});
