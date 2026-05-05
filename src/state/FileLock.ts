import * as lockfile from 'proper-lockfile';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class FileLock {
  private readonly inProcessQueues = new Map<string, Promise<unknown>>();

  async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.inProcessQueues.get(filePath) ?? Promise.resolve();
    const next = previous.then(() => this.runWithDiskLock(filePath, fn));
    this.inProcessQueues.set(filePath, next.catch(() => undefined));
    return next;
  }

  private async runWithDiskLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(dirname(filePath), { recursive: true });
    const release = await lockfile.lock(filePath, {
      retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 1000 },
      stale: 10_000,
      realpath: false,
      lockfilePath: `${filePath}.lock`
    });

    try {
      return await fn();
    } finally {
      await release();
    }
  }
}
