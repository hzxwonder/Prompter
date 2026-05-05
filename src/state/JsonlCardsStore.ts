import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarn } from '../logger';
import type { PromptCard } from '../shared/models';
import type { FileLock } from './FileLock';

interface TombstoneRow {
  id: string;
  _tombstone: true;
  updatedAt: string;
  dateBucket: string;
}

type CardRow = PromptCard | TombstoneRow;

export class JsonlCardsStore {
  private readonly bucketCache = new Map<string, PromptCard[]>();
  private readonly bucketMtime = new Map<string, number>();

  constructor(
    private readonly rootDir: string,
    private readonly lock: FileLock
  ) {}

  pathForBucket(dateBucket: string): string {
    const [year, month, day] = dateBucket.split('-');
    return join(this.rootDir, 'logs', year, month, day, 'cards.jsonl');
  }

  async upsert(card: PromptCard): Promise<void> {
    const filePath = this.pathForBucket(card.dateBucket);
    await this.lock.withLock(filePath, async () => {
      await appendFile(filePath, `${JSON.stringify(card)}\n`, 'utf8');
    });
    this.invalidate(card.dateBucket);
  }

  async tombstone(id: string, dateBucket: string, updatedAt: string): Promise<void> {
    const filePath = this.pathForBucket(dateBucket);
    const row: TombstoneRow = { id, _tombstone: true, updatedAt, dateBucket };
    await this.lock.withLock(filePath, async () => {
      await appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
    });
    this.invalidate(dateBucket);
  }

  async readBucket(dateBucket: string): Promise<PromptCard[]> {
    const filePath = this.pathForBucket(dateBucket);
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(filePath)).mtimeMs;
    } catch {
      return [];
    }

    if (this.bucketMtime.get(dateBucket) === mtimeMs) {
      return this.bucketCache.get(dateBucket) ?? [];
    }

    const latestById = new Map<string, CardRow>();
    const text = await readFile(filePath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let row: CardRow;
      try {
        row = JSON.parse(line) as CardRow;
      } catch {
        logWarn(`[JsonlCardsStore] Skipping corrupt line in ${filePath}`);
        continue;
      }
      if (!isCardRow(row)) continue;
      const previous = latestById.get(row.id);
      if (!previous || row.updatedAt > previous.updatedAt) {
        latestById.set(row.id, row);
      }
    }

    const cards = [...latestById.values()]
      .filter((row): row is PromptCard => !isTombstone(row))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.bucketCache.set(dateBucket, cards);
    this.bucketMtime.set(dateBucket, mtimeMs);
    return cards;
  }

  async readAll(): Promise<PromptCard[]> {
    const cards: PromptCard[] = [];
    for (const bucket of await this.listBuckets()) {
      cards.push(...await this.readBucket(bucket));
    }
    return cards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async writeAll(cards: PromptCard[]): Promise<void> {
    const byBucket = new Map<string, PromptCard[]>();
    for (const card of cards) {
      byBucket.set(card.dateBucket, [...(byBucket.get(card.dateBucket) ?? []), card]);
    }
    for (const existingBucket of await this.listBuckets()) {
      if (!byBucket.has(existingBucket)) byBucket.set(existingBucket, []);
    }
    for (const [bucket, bucketCards] of byBucket) {
      await this.rewriteBucket(bucket, bucketCards);
    }
  }

  private async rewriteBucket(dateBucket: string, cards: PromptCard[]): Promise<void> {
    const filePath = this.pathForBucket(dateBucket);
    await this.lock.withLock(filePath, async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${randomUUID()}.tmp`;
      const body = cards.map((card) => JSON.stringify(card)).join('\n') + (cards.length ? '\n' : '');
      try {
        await writeFile(tmpPath, body, 'utf8');
        await rename(tmpPath, filePath);
      } catch (error) {
        await unlink(tmpPath).catch(() => undefined);
        throw error;
      }
    });
    this.invalidate(dateBucket);
  }

  private async listBuckets(): Promise<string[]> {
    const root = join(this.rootDir, 'logs');
    const buckets: string[] = [];
    let years: string[];
    try { years = await readdir(root); } catch { return []; }
    for (const year of years.filter((name) => /^\d{4}$/.test(name))) {
      let months: string[];
      try { months = await readdir(join(root, year)); } catch { continue; }
      for (const month of months.filter((name) => /^\d{2}$/.test(name))) {
        let days: string[];
        try { days = await readdir(join(root, year, month)); } catch { continue; }
        for (const day of days.filter((name) => /^\d{2}$/.test(name))) {
          buckets.push(`${year}-${month}-${day}`);
        }
      }
    }
    return buckets.sort((left, right) => right.localeCompare(left));
  }

  private invalidate(dateBucket: string): void {
    this.bucketCache.delete(dateBucket);
    this.bucketMtime.delete(dateBucket);
  }
}

function isCardRow(value: unknown): value is CardRow {
  return !!value && typeof value === 'object' && typeof (value as CardRow).id === 'string';
}

function isTombstone(row: CardRow): row is TombstoneRow {
  return '_tombstone' in row && row._tombstone === true;
}
