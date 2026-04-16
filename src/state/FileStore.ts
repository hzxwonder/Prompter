import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logWarn } from '../logger';

export class FileStore {
  constructor(private readonly rootDir: string) {}

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
    await writeFile(join(this.rootDir, fileName), JSON.stringify(value, null, 2), 'utf8');
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
