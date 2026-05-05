import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logWarn } from '../logger';

const STALE_TMP_AGE_MS = 60_000;

export class FileStore {
  private staleTmpSweepDone = false;

  constructor(private readonly rootDir: string) {}

  getDataDir(): string {
    return this.rootDir;
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    if (!this.staleTmpSweepDone) {
      this.staleTmpSweepDone = true;
      this.sweepStaleTmpFiles().catch(() => { /* best-effort */ });
    }
  }

  private async sweepStaleTmpFiles(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return;
    }
    const now = Date.now();
    await Promise.all(
      entries
        .filter((name) => /\.[0-9a-f-]{36}\.tmp$/i.test(name))
        .map(async (name) => {
          const fullPath = join(this.rootDir, name);
          try {
            const info = await stat(fullPath);
            if (now - info.mtimeMs > STALE_TMP_AGE_MS) {
              await unlink(fullPath);
            }
          } catch {
            // ignore
          }
        })
    );
  }

  async readJson<T>(fileName: string, fallback: T): Promise<T> {
    const filePath = join(this.rootDir, fileName);
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return fallback;
      }

      if (error instanceof SyntaxError) {
        const quarantinePath = join(this.rootDir, `${fileName}.corrupted-${Date.now()}`);
        await this.init();
        await rename(filePath, quarantinePath);
        logWarn(`[FileStore] Detected malformed JSON in ${filePath}; moved it to ${quarantinePath} and restored defaults.`);
        await this.writeJson(fileName, fallback);
        return fallback;
      }

      throw error;
    }
  }

  async writeJson<T>(fileName: string, value: T): Promise<void> {
    await this.init();
    const filePath = join(this.rootDir, fileName);
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
      await rename(tmpPath, filePath);
    } catch (error) {
      try { await unlink(tmpPath); } catch { /* ignore cleanup errors */ }
      throw error;
    }
  }

  async getSyncToken(): Promise<string | undefined> {
    try {
      const token = await readFile(join(this.rootDir, '.sync-token'), 'utf8');
      return token.trim() || undefined;
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async writeSyncToken(token: string): Promise<void> {
    await this.init();
    const filePath = join(this.rootDir, '.sync-token');
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, token, 'utf8');
      await rename(tmpPath, filePath);
    } catch (error) {
      try { await unlink(tmpPath); } catch { /* ignore cleanup errors */ }
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
