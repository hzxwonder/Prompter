import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { log, logWarn } from '../logger';
import type { PromptCard } from '../shared/models';
import { FileLock } from './FileLock';
import { JsonlCardsStore } from './JsonlCardsStore';
import { MetaJsonStore } from './MetaJsonStore';

const META_FILES = new Set([
  'settings.json',
  'modular-prompts.json',
  'session-groups.json',
  'today_forbidden.json',
  'history-import.json'
]);

const GENERATED_FILES = new Set([
  'today_cards.json',
  'daily-stats.json'
]);

export class DataDirStore {
  private readonly lock = new FileLock();
  private readonly cards: JsonlCardsStore;
  private readonly meta: MetaJsonStore;
  private readonly syncTokenPath: string;

  constructor(private readonly rootDir: string) {
    this.cards = new JsonlCardsStore(rootDir, this.lock);
    this.meta = new MetaJsonStore(rootDir, this.lock);
    this.syncTokenPath = join(rootDir, 'logs', 'sync-token');
    log(`[DataDirStore] Initialized at ${rootDir}`);
  }

  getDataDir(): string {
    return this.rootDir;
  }

  async readJson<T>(fileName: string, fallback: T): Promise<T> {
    if (fileName === 'cards.json') {
      return await this.cards.readAll() as T;
    }
    if (GENERATED_FILES.has(fileName)) {
      return fallback;
    }
    if (META_FILES.has(fileName)) {
      return await this.meta.read(fileName, fallback);
    }
    logWarn(`[DataDirStore] Unknown file ${fileName}; returning fallback`);
    return fallback;
  }

  async writeJson<T>(fileName: string, value: T): Promise<void> {
    if (fileName === 'cards.json') {
      await this.cards.writeAll(value as PromptCard[]);
      return;
    }
    if (GENERATED_FILES.has(fileName)) {
      return;
    }
    if (META_FILES.has(fileName)) {
      await this.meta.write(fileName, value);
      return;
    }
    logWarn(`[DataDirStore] Unknown file ${fileName}; skipping write`);
  }

  async getSyncToken(): Promise<string | undefined> {
    try {
      const text = await readFile(this.syncTokenPath, 'utf8');
      return text.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async writeSyncToken(token: string): Promise<void> {
    await this.lock.withLock(this.syncTokenPath, async () => {
      await mkdir(dirname(this.syncTokenPath), { recursive: true });
      await writeFile(this.syncTokenPath, token, 'utf8');
    });
  }

  close(): void {
    log('[DataDirStore] Closed');
  }
}
