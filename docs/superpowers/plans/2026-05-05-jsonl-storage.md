# JSONL Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SQLite `logs.db` backend with a date-bucketed JSONL file layout protected by a Hybrid file lock (proper-lockfile + in-process queue) to support safe multi-window/async writes across Linux/macOS/Windows/network filesystems.

**Architecture:** Three new state modules (`FileLock`, `JsonlCardsStore`, `MetaJsonStore`) compose into `DataDirStore`, a drop-in replacement for `DatabaseStore` exposing the same `readJson/writeJson/getSyncToken/writeSyncToken/getDataDir/close` surface. A one-shot `migrateFromSqlite` runs at extension startup before `PromptRepository` is constructed. `LogSyncService`'s external-change watcher switches from polling `logs.db*` mtimes to watching `sync-token`.

**Tech Stack:** TypeScript, Node `node:fs/promises`, `proper-lockfile` (new dep), vitest, existing PortableSqlite (kept only for migration read-side).

**Reference spec:** [docs/superpowers/specs/2026-05-05-jsonl-storage-design.md](../specs/2026-05-05-jsonl-storage-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/state/FileLock.ts` | Hybrid lock primitive — in-process per-path queue + proper-lockfile disk lock |
| `src/state/MetaJsonStore.ts` | Atomic read/write of single-file JSON blobs (settings, modular-prompts, etc.) |
| `src/state/JsonlCardsStore.ts` | Append-only NDJSON per `logs/{Y}/{M}/{D}/cards.jsonl` with id-folding reader |
| `src/state/DataDirStore.ts` | Façade that composes the three above behind the existing DatabaseStore interface |
| `src/state/migrateFromSqlite.ts` | One-shot migrator from `logs.db` to `logs/` |
| `src/state/PromptRepository.ts` | Switch construction site to `DataDirStore` |
| `src/services/LogSyncService.ts` | External watcher swap: sync-token only |
| `src/extension.ts` | Run migration before repo init |
| `src/uninstall/uninstallCleanup.ts` | Clean `logs/` directory on uninstall |
| `tests/unit/state/FileLock.test.ts` | Concurrency + cross-process tests |
| `tests/unit/state/MetaJsonStore.test.ts` | Atomic write / corruption tests |
| `tests/unit/state/JsonlCardsStore.test.ts` | Append + folding + tombstone + corruption |
| `tests/unit/state/migrateFromSqlite.test.ts` | Field-by-field diff vs fixture db |
| **Deletions** | `src/state/DatabaseStore.ts`, `src/state/PortableSqlite.ts`, `src/state/migrateToDatabase.ts`, `scripts/test-migration.mjs`, `scripts/verify-wasm-deps.mjs`, `tests/unit/state/DatabaseStore.test.ts` |

---

### Task 1: Add proper-lockfile dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install proper-lockfile**

```bash
npm install proper-lockfile@^4.1.2
npm install --save-dev @types/proper-lockfile
```

- [ ] **Step 2: Verify it's listed in package.json `dependencies`**

```bash
node -e "console.log(require('./package.json').dependencies['proper-lockfile'])"
```
Expected: `^4.1.2`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add proper-lockfile for cross-platform file locking"
```

---

### Task 2: FileLock primitive

**Files:**
- Create: `src/state/FileLock.ts`
- Test: `tests/unit/state/FileLock.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/state/FileLock.test.ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileLock } from '../../../src/state/FileLock';

describe('FileLock', () => {
  it('serializes concurrent withLock calls on the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flock-'));
    const file = join(dir, 'target.txt');
    await writeFile(file, '');
    const lock = new FileLock();
    const trace: string[] = [];

    const work = (id: string) => lock.withLock(file, async () => {
      trace.push(`${id}:start`);
      await new Promise((r) => setTimeout(r, 20));
      trace.push(`${id}:end`);
    });

    await Promise.all([work('a'), work('b'), work('c')]);

    // Each pair must be adjacent — never interleaved.
    expect(trace).toEqual([
      'a:start', 'a:end',
      'b:start', 'b:end',
      'c:start', 'c:end'
    ]);
  });

  it('allows different files to run in parallel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flock-'));
    const f1 = join(dir, 'a.txt');
    const f2 = join(dir, 'b.txt');
    await writeFile(f1, '');
    await writeFile(f2, '');
    const lock = new FileLock();
    const trace: string[] = [];

    await Promise.all([
      lock.withLock(f1, async () => {
        trace.push('a:start');
        await new Promise((r) => setTimeout(r, 30));
        trace.push('a:end');
      }),
      lock.withLock(f2, async () => {
        trace.push('b:start');
        await new Promise((r) => setTimeout(r, 30));
        trace.push('b:end');
      })
    ]);

    // Either both starts come before both ends, or interleaved — but never serialized.
    const aStart = trace.indexOf('a:start');
    const bStart = trace.indexOf('b:start');
    const aEnd = trace.indexOf('a:end');
    const bEnd = trace.indexOf('b:end');
    expect(Math.max(aStart, bStart)).toBeLessThan(Math.min(aEnd, bEnd));
  });

  it('does not let one rejected withLock block the next call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flock-'));
    const file = join(dir, 'target.txt');
    await writeFile(file, '');
    const lock = new FileLock();

    await expect(
      lock.withLock(file, async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    const result = await lock.withLock(file, async () => 42);
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/state/FileLock.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FileLock**

```ts
// src/state/FileLock.ts
import * as lockfile from 'proper-lockfile';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class FileLock {
  private inProcessQueues = new Map<string, Promise<unknown>>();

  async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.inProcessQueues.get(filePath) ?? Promise.resolve();
    const next = prev.then(() => this.runWithDiskLock(filePath, fn));
    // Swallow errors in the queue chain so one failure does not poison the next caller.
    this.inProcessQueues.set(filePath, next.catch(() => {}));
    return next as Promise<T>;
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/state/FileLock.test.ts
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/state/FileLock.ts tests/unit/state/FileLock.test.ts
git commit -m "feat(state): add FileLock hybrid lock primitive"
```

---

### Task 3: FileLock cross-process test

**Files:**
- Modify: `tests/unit/state/FileLock.test.ts`
- Create: `tests/unit/state/fixtures/append-worker.mjs`

- [ ] **Step 1: Add cross-process test and worker script**

```js
// tests/unit/state/fixtures/append-worker.mjs
import { appendFile } from 'node:fs/promises';
import lockfile from 'proper-lockfile';

const [filePath, idStr, countStr] = process.argv.slice(2);
const id = idStr;
const count = Number(countStr);

for (let i = 0; i < count; i++) {
  const release = await lockfile.lock(filePath, {
    retries: { retries: 50, factor: 1.5, minTimeout: 20, maxTimeout: 500 },
    stale: 10_000,
    realpath: false,
    lockfilePath: `${filePath}.lock`
  });
  try {
    await appendFile(filePath, `${id}:${i}\n`, 'utf8');
  } finally {
    await release();
  }
}
```

Add to FileLock.test.ts:

```ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

it('serializes appends from multiple OS processes without truncation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flock-mp-'));
  const file = join(dir, 'shared.log');
  await writeFile(file, '');
  const workerPath = join(__dirname, 'fixtures', 'append-worker.mjs');

  const procs = ['p1', 'p2', 'p3'].map((id) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath, file, id, '50']);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker ${id} exited ${code}`)));
      child.on('error', reject);
    })
  );

  await Promise.all(procs);

  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  expect(lines).toHaveLength(150);
  // Every line is well-formed (no torn writes).
  for (const line of lines) {
    expect(line).toMatch(/^p[123]:\d+$/);
  }
}, 30_000);
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run tests/unit/state/FileLock.test.ts
```
Expected: 4 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/state/FileLock.test.ts tests/unit/state/fixtures/append-worker.mjs
git commit -m "test(state): cross-process FileLock append test"
```

---

### Task 4: MetaJsonStore

**Files:**
- Create: `src/state/MetaJsonStore.ts`
- Test: `tests/unit/state/MetaJsonStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/state/MetaJsonStore.test.ts
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MetaJsonStore } from '../../../src/state/MetaJsonStore';
import { FileLock } from '../../../src/state/FileLock';

describe('MetaJsonStore', () => {
  it('returns fallback when file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meta-'));
    const store = new MetaJsonStore(dir, new FileLock());
    const value = await store.read<{ a: number }>('settings.json', { a: 1 });
    expect(value).toEqual({ a: 1 });
  });

  it('returns fallback and warns when file is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meta-'));
    await writeFile(join(dir, 'settings.json'), '{not valid');
    const store = new MetaJsonStore(dir, new FileLock());
    const value = await store.read<{ a: number }>('settings.json', { a: 99 });
    expect(value).toEqual({ a: 99 });
  });

  it('writes atomically — never leaves partial files visible', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meta-'));
    const store = new MetaJsonStore(dir, new FileLock());
    await store.write('settings.json', { hello: 'world' });

    const back = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'));
    expect(back).toEqual({ hello: 'world' });

    const entries = await readdir(dir);
    expect(entries.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('serializes concurrent writes to the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meta-'));
    const store = new MetaJsonStore(dir, new FileLock());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.write('s.json', { i }))
    );
    const back = JSON.parse(await readFile(join(dir, 's.json'), 'utf8'));
    expect(back.i).toBeGreaterThanOrEqual(0);
    expect(back.i).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run tests/unit/state/MetaJsonStore.test.ts
```
Expected: module-not-found failure.

- [ ] **Step 3: Implement MetaJsonStore**

```ts
// src/state/MetaJsonStore.ts
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logWarn } from '../logger';
import type { FileLock } from './FileLock';

export class MetaJsonStore {
  constructor(private readonly rootDir: string, private readonly lock: FileLock) {}

  private resolve(fileName: string): string {
    return join(this.rootDir, fileName);
  }

  async read<T>(fileName: string, fallback: T): Promise<T> {
    const filePath = this.resolve(fileName);
    try {
      const text = await readFile(filePath, 'utf8');
      return JSON.parse(text) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logWarn(`[MetaJsonStore] Failed to read ${fileName}: ${error}`);
      }
      return fallback;
    }
  }

  async write<T>(fileName: string, value: T): Promise<void> {
    const filePath = this.resolve(fileName);
    await this.lock.withLock(filePath, async () => {
      const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
        await rename(tmp, filePath);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
    });
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/unit/state/MetaJsonStore.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/state/MetaJsonStore.ts tests/unit/state/MetaJsonStore.test.ts
git commit -m "feat(state): add MetaJsonStore with atomic write-temp+rename"
```

---

### Task 5: JsonlCardsStore — append + bucket reader

**Files:**
- Create: `src/state/JsonlCardsStore.ts`
- Test: `tests/unit/state/JsonlCardsStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/state/JsonlCardsStore.test.ts
import { appendFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PromptCard } from '../../../src/shared/models';
import { JsonlCardsStore } from '../../../src/state/JsonlCardsStore';
import { FileLock } from '../../../src/state/FileLock';

function makeCard(overrides: Partial<PromptCard> = {}): PromptCard {
  return {
    id: 'card-1',
    title: 't',
    content: 'c',
    status: 'unused',
    runtimeState: 'unknown',
    sourceType: 'manual',
    createdAt: '2026-05-03T10:00:00.000Z',
    updatedAt: '2026-05-03T10:00:00.000Z',
    dateBucket: '2026-05-03',
    fileRefs: [],
    justCompleted: false,
    ...overrides
  } as PromptCard;
}

describe('JsonlCardsStore', () => {
  it('appends a card to logs/Y/M/D/cards.jsonl and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jcs-'));
    const store = new JsonlCardsStore(dir, new FileLock());
    const card = makeCard();
    await store.upsert(card);

    const text = await readFile(join(dir, 'logs', '2026', '05', '03', 'cards.jsonl'), 'utf8');
    expect(text.trim().split('\n')).toHaveLength(1);

    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('card-1');
  });

  it('folds multiple versions of the same id keeping max updatedAt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jcs-'));
    const store = new JsonlCardsStore(dir, new FileLock());
    await store.upsert(makeCard({ updatedAt: '2026-05-03T10:00:00.000Z', title: 'old' }));
    await store.upsert(makeCard({ updatedAt: '2026-05-03T11:00:00.000Z', title: 'new' }));

    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('new');
  });

  it('honors tombstones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jcs-'));
    const store = new JsonlCardsStore(dir, new FileLock());
    await store.upsert(makeCard({ updatedAt: '2026-05-03T10:00:00.000Z' }));
    await store.tombstone('card-1', '2026-05-03', '2026-05-03T11:00:00.000Z');

    const all = await store.readAll();
    expect(all).toHaveLength(0);
  });

  it('skips corrupt half-lines without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jcs-'));
    const store = new JsonlCardsStore(dir, new FileLock());
    await store.upsert(makeCard());
    // Append a torn write.
    await appendFile(
      join(dir, 'logs', '2026', '05', '03', 'cards.jsonl'),
      '{"id":"card-2","title":"halfBROKEN'
    );
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('card-1');
  });

  it('writeAll replaces the bucket file with the given cards (used for bulk delete sync)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jcs-'));
    const store = new JsonlCardsStore(dir, new FileLock());
    await store.upsert(makeCard({ id: 'a' }));
    await store.upsert(makeCard({ id: 'b' }));

    await store.writeAll([makeCard({ id: 'b', updatedAt: '2026-05-03T12:00:00.000Z' })]);

    const all = await store.readAll();
    expect(all.map((c) => c.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run tests/unit/state/JsonlCardsStore.test.ts
```
Expected: module-not-found failure.

- [ ] **Step 3: Implement JsonlCardsStore**

```ts
// src/state/JsonlCardsStore.ts
import { appendFile, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PromptCard } from '../shared/models';
import { logWarn } from '../logger';
import type { FileLock } from './FileLock';

interface TombstoneRow {
  id: string;
  _tombstone: true;
  updatedAt: string;
  dateBucket: string;
}

type Row = PromptCard | TombstoneRow;

export class JsonlCardsStore {
  private bucketCache = new Map<string, PromptCard[]>();
  private bucketMtime = new Map<string, number>();

  constructor(private readonly rootDir: string, private readonly lock: FileLock) {}

  pathForBucket(dateBucket: string): string {
    const [year, month, day] = dateBucket.split('-');
    return join(this.rootDir, 'logs', year, month, day, 'cards.jsonl');
  }

  private invalidate(dateBucket: string): void {
    this.bucketCache.delete(dateBucket);
    this.bucketMtime.delete(dateBucket);
  }

  async upsert(card: PromptCard): Promise<void> {
    const filePath = this.pathForBucket(card.dateBucket);
    await this.lock.withLock(filePath, async () => {
      await appendFile(filePath, JSON.stringify(card) + '\n', 'utf8');
    });
    this.invalidate(card.dateBucket);
  }

  async tombstone(id: string, dateBucket: string, updatedAt: string): Promise<void> {
    const filePath = this.pathForBucket(dateBucket);
    const row: TombstoneRow = { id, _tombstone: true, updatedAt, dateBucket };
    await this.lock.withLock(filePath, async () => {
      await appendFile(filePath, JSON.stringify(row) + '\n', 'utf8');
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
    const text = await readFile(filePath, 'utf8');
    const latest = new Map<string, Row>();
    for (const line of text.split('\n')) {
      if (!line) continue;
      let row: Row;
      try { row = JSON.parse(line) as Row; } catch {
        logWarn(`[JsonlCardsStore] Skipping corrupt line in ${filePath}`);
        continue;
      }
      if (!row || typeof row !== 'object' || !('id' in row)) continue;
      const prev = latest.get(row.id);
      if (!prev || row.updatedAt > prev.updatedAt) latest.set(row.id, row);
    }
    const cards = [...latest.values()].filter(
      (r): r is PromptCard => !('_tombstone' in r && r._tombstone === true)
    );
    this.bucketCache.set(dateBucket, cards);
    this.bucketMtime.set(dateBucket, mtimeMs);
    return cards;
  }

  async readAll(): Promise<PromptCard[]> {
    const buckets = await this.listBuckets();
    const out: PromptCard[] = [];
    for (const b of buckets) {
      out.push(...(await this.readBucket(b)));
    }
    return out;
  }

  /** Replace a single bucket file in one shot. Used for migration and bulk rewrites. */
  async writeAll(cards: PromptCard[]): Promise<void> {
    // Group by bucket; rewrite each bucket file.
    const byBucket = new Map<string, PromptCard[]>();
    for (const card of cards) {
      const list = byBucket.get(card.dateBucket) ?? [];
      list.push(card);
      byBucket.set(card.dateBucket, list);
    }
    // Also rewrite buckets that previously existed but are now empty.
    const existingBuckets = await this.listBuckets();
    for (const b of existingBuckets) {
      if (!byBucket.has(b)) byBucket.set(b, []);
    }
    for (const [bucket, list] of byBucket) {
      const filePath = this.pathForBucket(bucket);
      await this.lock.withLock(filePath, async () => {
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        const body = list.map((c) => JSON.stringify(c)).join('\n') + (list.length ? '\n' : '');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(tmp, body, 'utf8');
        await rename(tmp, filePath);
      });
      this.invalidate(bucket);
    }
  }

  private async listBuckets(): Promise<string[]> {
    const root = join(this.rootDir, 'logs');
    const out: string[] = [];
    let years: string[];
    try { years = await readdir(root); } catch { return []; }
    for (const y of years) {
      if (!/^\d{4}$/.test(y)) continue;
      let months: string[];
      try { months = await readdir(join(root, y)); } catch { continue; }
      for (const m of months) {
        if (!/^\d{2}$/.test(m)) continue;
        let days: string[];
        try { days = await readdir(join(root, y, m)); } catch { continue; }
        for (const d of days) {
          if (!/^\d{2}$/.test(d)) continue;
          out.push(`${y}-${m}-${d}`);
        }
      }
    }
    // Newest first to match SQLite ORDER BY updated_at DESC behavior.
    return out.sort((a, b) => b.localeCompare(a));
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/unit/state/JsonlCardsStore.test.ts
```
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/state/JsonlCardsStore.ts tests/unit/state/JsonlCardsStore.test.ts
git commit -m "feat(state): add JsonlCardsStore (append-only NDJSON per day)"
```

---

### Task 6: DataDirStore façade

**Files:**
- Create: `src/state/DataDirStore.ts`
- Test: `tests/unit/state/DataDirStore.test.ts`

The façade exposes the exact public surface PromptRepository uses today. Look at `src/state/PromptRepository.ts` for the call sites — currently `store.readJson(fileName, fallback)`, `store.writeJson(fileName, value)`, `store.getDataDir()`, `store.getSyncToken()`, `store.writeSyncToken(token)`, `store.close()`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/state/DataDirStore.test.ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PromptCard } from '../../../src/shared/models';
import { DataDirStore } from '../../../src/state/DataDirStore';

function makeCard(id: string, dateBucket = '2026-05-03'): PromptCard {
  return {
    id,
    title: id,
    content: id,
    status: 'unused',
    runtimeState: 'unknown',
    sourceType: 'manual',
    createdAt: `${dateBucket}T10:00:00.000Z`,
    updatedAt: `${dateBucket}T10:00:00.000Z`,
    dateBucket,
    fileRefs: [],
    justCompleted: false
  } as PromptCard;
}

describe('DataDirStore', () => {
  it('round-trips cards through readJson/writeJson("cards.json", ...)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dds-'));
    const store = new DataDirStore(dir);
    await store.writeJson('cards.json', [makeCard('a'), makeCard('b')]);
    const back = await store.readJson<PromptCard[]>('cards.json', []);
    expect(back.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('round-trips settings via meta json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dds-'));
    const store = new DataDirStore(dir);
    await store.writeJson('settings.json', { language: 'en' });
    expect(await store.readJson('settings.json', {})).toEqual({ language: 'en' });
  });

  it('persists sync-token and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dds-'));
    const store = new DataDirStore(dir);
    await store.writeSyncToken('tok-123');
    expect(await store.getSyncToken()).toBe('tok-123');
  });

  it('returns fallback for unknown file names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dds-'));
    const store = new DataDirStore(dir);
    expect(await store.readJson('what.json', { ok: true })).toEqual({ ok: true });
  });

  it('removes deleted cards on next write (tombstones in bucket file)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dds-'));
    const store = new DataDirStore(dir);
    await store.writeJson('cards.json', [makeCard('a'), makeCard('b')]);
    await store.writeJson('cards.json', [makeCard('a')]);
    const back = await store.readJson<PromptCard[]>('cards.json', []);
    expect(back.map((c) => c.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run tests/unit/state/DataDirStore.test.ts
```
Expected: module-not-found failure.

- [ ] **Step 3: Implement DataDirStore**

Note: `writeJson('cards.json', cards)` is called by `PromptRepository` with the **complete** in-memory card list. To preserve delete-by-omission semantics, the façade compares against current state and writes tombstones for omitted ids — or uses `JsonlCardsStore.writeAll` for simplicity.

```ts
// src/state/DataDirStore.ts
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import type { PromptCard } from '../shared/models';
import { log, logWarn } from '../logger';
import { FileLock } from './FileLock';
import { MetaJsonStore } from './MetaJsonStore';
import { JsonlCardsStore } from './JsonlCardsStore';

const META_FILES = new Set([
  'settings.json',
  'modular-prompts.json',
  'session-groups.json',
  'today_forbidden.json',
  'history-import.json'
]);

export class DataDirStore {
  private readonly lock = new FileLock();
  private readonly meta: MetaJsonStore;
  private readonly cards: JsonlCardsStore;
  private readonly syncTokenPath: string;

  constructor(private readonly rootDir: string) {
    this.meta = new MetaJsonStore(rootDir, this.lock);
    this.cards = new JsonlCardsStore(rootDir, this.lock);
    this.syncTokenPath = join(rootDir, 'sync-token');
    log(`[DataDirStore] Initialized at ${rootDir}`);
  }

  getDataDir(): string {
    return this.rootDir;
  }

  async readJson<T>(fileName: string, fallback: T): Promise<T> {
    if (fileName === 'cards.json') {
      return (await this.cards.readAll()) as T;
    }
    if (fileName === 'today_cards.json' || fileName === 'daily-stats.json') {
      // Generated on-demand by PromptRepository; mirror DatabaseStore behavior.
      return fallback;
    }
    if (META_FILES.has(fileName)) {
      return this.meta.read<T>(fileName, fallback);
    }
    logWarn(`[DataDirStore] Unknown file: ${fileName}, returning fallback`);
    return fallback;
  }

  async writeJson<T>(fileName: string, value: T): Promise<void> {
    if (fileName === 'cards.json') {
      await this.cards.writeAll(value as unknown as PromptCard[]);
      return;
    }
    if (fileName === 'today_cards.json' || fileName === 'daily-stats.json') {
      return; // generated on demand
    }
    if (META_FILES.has(fileName)) {
      await this.meta.write(fileName, value);
      return;
    }
    logWarn(`[DataDirStore] Unknown file: ${fileName}, skipping write`);
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
      await writeFile(this.syncTokenPath, token, 'utf8');
    });
  }

  close(): void {
    log('[DataDirStore] Closed');
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/unit/state/DataDirStore.test.ts
```
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/state/DataDirStore.ts tests/unit/state/DataDirStore.test.ts
git commit -m "feat(state): add DataDirStore facade replacing DatabaseStore surface"
```

---

### Task 7: migrateFromSqlite

**Files:**
- Create: `src/state/migrateFromSqlite.ts`
- Test: `tests/unit/state/migrateFromSqlite.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/state/migrateFromSqlite.test.ts
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseStore } from '../../../src/state/DatabaseStore';
import { migrateFromSqlite } from '../../../src/state/migrateFromSqlite';
import { DataDirStore } from '../../../src/state/DataDirStore';

describe('migrateFromSqlite', () => {
  it('moves cards into per-day jsonl and meta into json files, idempotent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));

    // Seed a logs.db using the legacy DatabaseStore.
    const legacy = new DatabaseStore(dir);
    await legacy.writeJson('cards.json', [
      {
        id: 'c1', title: 't', content: 'c', status: 'unused', runtimeState: 'unknown',
        sourceType: 'manual', createdAt: '2026-05-03T10:00:00.000Z',
        updatedAt: '2026-05-03T10:00:00.000Z', dateBucket: '2026-05-03',
        fileRefs: [], justCompleted: false
      },
      {
        id: 'c2', title: 't2', content: 'c2', status: 'completed', runtimeState: 'finished',
        sourceType: 'manual', createdAt: '2026-05-04T10:00:00.000Z',
        updatedAt: '2026-05-04T10:00:00.000Z', dateBucket: '2026-05-04',
        fileRefs: [], justCompleted: false
      }
    ] as any);
    await legacy.writeJson('settings.json', { language: 'en' });
    await legacy.writeSyncToken('legacy-token');
    legacy.close();

    expect(await migrateFromSqlite(dir)).toBe(true); // performed
    expect(existsSync(join(dir, 'logs', '.migrated'))).toBe(true);
    expect(existsSync(join(dir, 'logs.db'))).toBe(true); // not deleted

    const next = new DataDirStore(dir);
    const cards = await next.readJson<any[]>('cards.json', []);
    expect(cards.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(await next.readJson('settings.json', {})).toEqual({ language: 'en' });
    expect(await next.getSyncToken()).toBe('legacy-token');

    // Idempotent — second run is a no-op.
    expect(await migrateFromSqlite(dir)).toBe(false);
  });

  it('returns false when no logs.db is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-empty-'));
    expect(await migrateFromSqlite(dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run tests/unit/state/migrateFromSqlite.test.ts
```
Expected: module-not-found failure.

- [ ] **Step 3: Implement migrateFromSqlite**

```ts
// src/state/migrateFromSqlite.ts
import { existsSync } from 'node:fs';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseStore } from './DatabaseStore';
import { DataDirStore } from './DataDirStore';
import { log, logError } from '../logger';

const SENTINEL = (root: string) => join(root, 'logs', '.migrated');

const META_FILES = [
  'settings.json',
  'modular-prompts.json',
  'session-groups.json',
  'today_forbidden.json',
  'history-import.json'
] as const;

/**
 * One-shot migration from logs.db to the new DataDirStore layout.
 * Returns true if migration ran, false if skipped (no db, or already migrated).
 */
export async function migrateFromSqlite(rootDir: string): Promise<boolean> {
  const dbPath = join(rootDir, 'logs.db');
  if (!existsSync(dbPath)) return false;
  if (existsSync(SENTINEL(rootDir))) return false;

  log(`[migrateFromSqlite] Starting migration in ${rootDir}`);
  const legacy = new DatabaseStore(rootDir);
  const next = new DataDirStore(rootDir);

  try {
    const cards = await legacy.readJson<any[]>('cards.json', []);
    await next.writeJson('cards.json', cards);

    for (const fileName of META_FILES) {
      const value = await legacy.readJson<unknown>(fileName, null);
      if (value !== null && value !== undefined) {
        await next.writeJson(fileName, value);
      }
    }

    const token = await legacy.getSyncToken();
    if (token) {
      await next.writeSyncToken(token);
    }

    const dbStat = await stat(dbPath);
    await mkdir(join(rootDir, 'logs'), { recursive: true });
    await writeFile(
      SENTINEL(rootDir),
      JSON.stringify({
        migratedAt: new Date().toISOString(),
        sourceDbBytes: dbStat.size,
        cardCount: cards.length
      }, null, 2),
      'utf8'
    );
    log(`[migrateFromSqlite] Migrated ${cards.length} cards`);
    return true;
  } catch (error) {
    logError('[migrateFromSqlite] Failed', error);
    throw error;
  } finally {
    legacy.close();
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/unit/state/migrateFromSqlite.test.ts
```
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/state/migrateFromSqlite.ts tests/unit/state/migrateFromSqlite.test.ts
git commit -m "feat(state): add one-shot SQLite -> JSONL migrator"
```

---

### Task 8: Wire DataDirStore into PromptRepository

**Files:**
- Modify: `src/state/PromptRepository.ts`
- Modify: `src/extension.ts`
- Modify: `tests/unit/state/PromptRepository.test.ts`

- [ ] **Step 1: Update StorageBackend type**

In `src/state/PromptRepository.ts`, locate line 26-28:

```ts
import type { DatabaseStore } from './DatabaseStore';

export type StorageBackend = FileStore | DatabaseStore;
```

Replace with:

```ts
import type { DataDirStore } from './DataDirStore';

export type StorageBackend = FileStore | DataDirStore;
```

Update the `PromptRepository.create` factory (around line 549):

```ts
// Find:
const repo = new PromptRepository(new FileStore(dataDir), now);
// Replace with:
const { DataDirStore } = await import('./DataDirStore');
const repo = new PromptRepository(new DataDirStore(dataDir), now);
```

- [ ] **Step 2: Update extension.ts call sites**

Locate every `new DatabaseStore(...)` in `src/extension.ts` (lines 78, 89, 113, 157):

```ts
// Replace each
const dbStore = new DatabaseStore(dataDir);
// With
const { migrateFromSqlite } = await import('./state/migrateFromSqlite');
await migrateFromSqlite(dataDir);
const dbStore = new DataDirStore(dataDir);
```

And update the import at top of `src/extension.ts`:

```ts
// Replace
import { DatabaseStore } from './state/DatabaseStore';
// With
import { DataDirStore } from './state/DataDirStore';
```

(Remove the inline `await import('./state/migrateFromSqlite')` once you confirm the static import works for tree-shaking; for now dynamic is fine.)

- [ ] **Step 3: Update PromptRepository test that explicitly references DatabaseStore**

In `tests/unit/state/PromptRepository.test.ts`, every occurrence of `new DatabaseStore(...)` becomes `new DataDirStore(...)` and the import switches likewise:

```ts
// Replace
import { DatabaseStore } from '../../../src/state/DatabaseStore';
// With
import { DataDirStore } from '../../../src/state/DataDirStore';
```

```bash
sed -i 's/DatabaseStore/DataDirStore/g' tests/unit/state/PromptRepository.test.ts
```

Verify the test text references no longer mention SQLite:

```bash
grep -n SQLite tests/unit/state/PromptRepository.test.ts
```

If any remain in test descriptions, hand-edit them to say "DataDirStore-backed" instead.

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit
```

Expected: all tests pass. The legacy `DatabaseStore.test.ts` will still pass because we have not deleted `DatabaseStore.ts` yet — that happens in Task 11.

- [ ] **Step 5: Commit**

```bash
git add src/state/PromptRepository.ts src/extension.ts tests/unit/state/PromptRepository.test.ts
git commit -m "refactor(state): switch PromptRepository to DataDirStore"
```

---

### Task 9: LogSyncService — switch external watcher to sync-token

**Files:**
- Modify: `src/services/LogSyncService.ts`

The current `setupExternalDbWatcher` (lines 621-654) seeds stats for `logs.db / logs.db-wal / logs.db-shm`. With JSONL there is no shared SQLite file — only `sync-token` matters. Most of the polling logic already keys off the sync token; we just remove the db-mtime fallback.

- [ ] **Step 1: Remove logs.db file-stats tracking**

In `src/services/LogSyncService.ts`, remove the `observedDbFileStats` field declaration (line 108) and every reference to `'logs.db'`, `'logs.db-wal'`, `'logs.db-shm'`. The sync-token poll (`scheduleExternalDbCheck` → `checkExternalDbChange`) keeps working. Specifically:

  - Delete the field at line 108.
  - In `setupExternalDbWatcher` (line 621), drop the seed loop.
  - In `checkExternalDbChange` (line 674), drop the `dbFilesChanged` accumulator and `changeSummary` parts that come from db files. Trigger reload purely off `tokenChanged`.
  - Delete `seedObservedDbFileStats` (line 754).

End shape of `checkExternalDbChange`:

```ts
private async checkExternalDbChange(): Promise<void> {
  if (this.externalDbCheckInFlight || !this.externalDbDataDir) return;

  let currentSyncToken: string | undefined;
  try {
    currentSyncToken = await this.repository.getSyncToken();
  } catch {
    currentSyncToken = undefined;
  }

  if (currentSyncToken === undefined || currentSyncToken === this.observedSyncToken) {
    return;
  }

  this.observedSyncToken = currentSyncToken;
  if (this.repository.isOwnSyncToken?.(currentSyncToken)) {
    return;
  }

  log(`[LogSyncService] sync-token changed — reloading`);
  this.externalDbCheckInFlight = true;
  try {
    await this.repository.reload();
    await PrompterPanel.refresh(this.repository);
    await this.seedObservedSyncToken();
    log('[LogSyncService] Repository reload complete');
  } catch (error) {
    logError('[LogSyncService] Failed to reload repository after token change', error);
  } finally {
    this.externalDbCheckInFlight = false;
  }
}
```

- [ ] **Step 2: Run lint and tests**

```bash
npm run lint
npm run test:unit
```

Expected: 0 errors, all unit tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/services/LogSyncService.ts
git commit -m "refactor(sync): drop logs.db mtime tracking, watch sync-token only"
```

---

### Task 10: Uninstall cleanup

**Files:**
- Modify: `src/uninstall/uninstallCleanup.ts`

- [ ] **Step 1: Inspect existing cleanup logic**

```bash
cat src/uninstall/uninstallCleanup.ts
```

- [ ] **Step 2: Add `logs/` removal**

Wherever the existing logic removes data files, add `logs/` to the list:

```ts
// In the array of paths to remove, alongside logs.db etc.
'logs',          // new JSONL data directory
'sync-token',
```

If the cleanup uses `rm -rf` style helpers, ensure recursive deletion is used for `logs/`.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/uninstall/uninstallCleanup.ts
git commit -m "chore(uninstall): remove logs/ JSONL directory on uninstall"
```

---

### Task 11: Delete legacy SQLite code

Do this only after Tasks 1-10 are green. Migration runs on startup so `DatabaseStore` must remain importable until the migrator no longer needs it. The migrator imports `DatabaseStore` directly, so we keep `DatabaseStore.ts` and `PortableSqlite.ts` BUT remove all other call sites.

Wait — re-evaluate: keeping the file means keeping the sql.js dependency, defeating one of the goals. Decision: **keep DatabaseStore.ts + PortableSqlite.ts + sql.js dep for one release** so the migrator works, and schedule a follow-up release that drops them after we're confident no users still have raw `logs.db`. This task only deletes the things that have **no consumers**.

**Files:**
- Delete: `src/state/migrateToDatabase.ts`
- Delete: `tests/unit/state/DatabaseStore.test.ts` (covered by migration test now; legacy interface is migration-only)
- Modify: `package.json` to remove unused build scripts if any reference the deleted files

- [ ] **Step 1: Verify migrateToDatabase is unreferenced**

```bash
grep -rn "migrateToDatabase" src/ tests/
```
Expected: only the file itself.

- [ ] **Step 2: Delete files**

```bash
git rm src/state/migrateToDatabase.ts tests/unit/state/DatabaseStore.test.ts
```

- [ ] **Step 3: Verify build + tests**

```bash
npm run build
npm run test:unit
```
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(state): remove obsolete JSON->SQLite migrator and DatabaseStore unit tests"
```

---

### Task 12: Smoke test — end-to-end migration in a fresh VS Code window

**Files:** none (manual verification)

- [ ] **Step 1: Build and package**

```bash
npm run build
```

- [ ] **Step 2: With a real seeded `~/.prompter/logs.db`**, launch VS Code's Extension Development Host (F5) and:

  - Confirm `~/.prompter/logs/.migrated` appears.
  - Confirm `~/.prompter/logs/{Y}/{M}/{D}/cards.jsonl` files exist with one line per card.
  - Confirm settings, modular prompts, session groups, history-import progress all survived.
  - Open a second VS Code window pointed at the same data dir, edit a card in window A, confirm window B refreshes within ~3s.
  - Trigger history backfill, kill VS Code mid-run, restart, confirm progress resumes.

- [ ] **Step 3: Cross-platform spot check**

If available:
  - Run on macOS, Linux, and Windows; trigger a write in each, confirm no `EPERM` / `EBUSY` exceptions in the extension log.
  - Run on an SSH-Remote workspace, confirm sync-token poll works.

- [ ] **Step 4: Commit any tweaks discovered during smoke test**

If issues are found, fix and commit individually before declaring done.

---

## Rollout Notes

- `DatabaseStore.ts`, `PortableSqlite.ts`, `sql.js` dependency, `scripts/verify-wasm-deps.mjs` are **kept for one release** so the migrator keeps working for users upgrading from the SQLite era. A follow-up plan should drop them.
- The migrator is idempotent and never deletes `logs.db` itself; users can roll back by deleting `logs/.migrated` and `logs/`.
- The new layout is fully human-readable; recommend documenting it in the README in a separate doc PR.
