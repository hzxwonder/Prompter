import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarn } from '../logger';
import type { FileLock } from './FileLock';

export class MetaJsonStore {
  constructor(
    private readonly rootDir: string,
    private readonly lock: FileLock
  ) {}

  async read<T>(fileName: string, fallback: T): Promise<T> {
    const filePath = this.resolve(fileName);
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as T;
    } catch (error) {
      if (!isMissingFileError(error)) {
        logWarn(`[MetaJsonStore] Failed to read ${fileName}: ${error}`);
      }
      return fallback;
    }
  }

  async write<T>(fileName: string, value: T): Promise<void> {
    const filePath = this.resolve(fileName);
    await this.lock.withLock(filePath, async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
        await rename(tmpPath, filePath);
      } catch (error) {
        await unlink(tmpPath).catch(() => undefined);
        throw error;
      }
    });
  }

  private resolve(fileName: string): string {
    return join(this.rootDir, fileName);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
