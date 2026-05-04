import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logWarn } from '../logger';

export class FileStore {
  constructor(private readonly rootDir: string) {}

  getDataDir(): string {
    return this.rootDir;
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
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
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
