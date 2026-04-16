import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDefaultDataDir,
  isSafeDataDirForRemoval,
  readTrackedDataDir,
  runUninstallCleanup,
  syncUninstallDataDir
} from '../../src/uninstall/uninstallCleanup';

const cleanupDirs: string[] = [];

describe('uninstallCleanup', () => {
  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('persists and reads the tracked data directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prompter-uninstall-'));
    cleanupDirs.push(root);
    const statePath = join(root, 'prompter-uninstall-state.json');

    await syncUninstallDataDir('/tmp/prompter-custom', { statePath });

    expect(await readTrackedDataDir({ statePath })).toBe('/tmp/prompter-custom');
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({
      dataDir: '/tmp/prompter-custom'
    });
  });

  it('deletes the tracked custom data directory and the uninstall state file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prompter-uninstall-'));
    cleanupDirs.push(root);
    const homeDir = join(root, 'home');
    const dataDir = join(homeDir, 'custom-prompter');
    const statePath = join(root, 'prompter-uninstall-state.json');

    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'cards.json'), '[]', 'utf8');
    await syncUninstallDataDir(dataDir, { statePath });

    const result = await runUninstallCleanup({ statePath, homeDir });

    expect(result.removedDataDir).toBe(dataDir);
    expect(result.skipped).toBe(false);
    await expect(readFile(statePath, 'utf8')).rejects.toThrow();
    await expect(readFile(join(dataDir, 'cards.json'), 'utf8')).rejects.toThrow();
  });

  it('falls back to the default ~/prompter directory when no custom path is tracked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prompter-uninstall-'));
    cleanupDirs.push(root);
    const homeDir = join(root, 'home');
    const defaultDataDir = getDefaultDataDir(homeDir);
    const statePath = join(root, 'prompter-uninstall-state.json');

    await mkdir(defaultDataDir, { recursive: true });
    await writeFile(join(defaultDataDir, 'today_cards.json'), '[]', 'utf8');

    const result = await runUninstallCleanup({ statePath, homeDir });

    expect(result.removedDataDir).toBe(defaultDataDir);
    expect(result.skipped).toBe(false);
    await expect(readFile(join(defaultDataDir, 'today_cards.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses to delete unsafe paths', async () => {
    expect(isSafeDataDirForRemoval('/')).toBe(false);
    expect(isSafeDataDirForRemoval('/Users', '/Users/example')).toBe(false);
    expect(isSafeDataDirForRemoval('/Users/example', '/Users/example')).toBe(false);
    expect(isSafeDataDirForRemoval('/Users/example/prompter', '/Users/example')).toBe(true);
  });
});
