import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';

interface UninstallState {
  dataDir: string;
}

interface UninstallCleanupOptions {
  statePath?: string;
  homeDir?: string;
}

export function getDefaultDataDir(homeDir = homedir()): string {
  return join(homeDir, 'prompter');
}

export function getUninstallStatePath(homeDir = homedir()): string {
  return join(homeDir, '.prompter-uninstall-state.json');
}

export async function syncUninstallDataDir(
  dataDir: string,
  options: UninstallCleanupOptions = {}
): Promise<void> {
  const statePath = options.statePath ?? getUninstallStatePath(options.homeDir);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ dataDir }, null, 2), 'utf8');
}

export async function readTrackedDataDir(options: UninstallCleanupOptions = {}): Promise<string | undefined> {
  const statePath = options.statePath ?? getUninstallStatePath(options.homeDir);

  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UninstallState>;
    return typeof parsed.dataDir === 'string' && parsed.dataDir.trim().length > 0
      ? parsed.dataDir
      : undefined;
  } catch {
    return undefined;
  }
}

export function isSafeDataDirForRemoval(targetPath: string, homeDir = homedir()): boolean {
  if (!targetPath || !isAbsolute(targetPath)) {
    return false;
  }

  const normalizedTarget = normalize(resolve(targetPath));
  const normalizedHome = normalize(resolve(homeDir));

  if (
    normalizedTarget === '/' ||
    normalizedTarget === normalizedHome ||
    normalizedTarget === dirname(normalizedHome)
  ) {
    return false;
  }

  return normalizedTarget.length > normalizedHome.length + 3;
}

export async function runUninstallCleanup(options: UninstallCleanupOptions = {}): Promise<{
  removedDataDir?: string;
  skipped: boolean;
}> {
  const homeDir = options.homeDir ?? homedir();
  const statePath = options.statePath ?? getUninstallStatePath(homeDir);
  const trackedDataDir = await readTrackedDataDir({ statePath, homeDir });
  const dataDir = trackedDataDir ?? getDefaultDataDir(homeDir);

  if (!isSafeDataDirForRemoval(dataDir, homeDir)) {
    return { skipped: true };
  }

  await rm(dataDir, { recursive: true, force: true });
  await unlink(statePath).catch(() => undefined);

  return {
    removedDataDir: dataDir,
    skipped: false
  };
}
