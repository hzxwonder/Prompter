# JSONL 存储改造设计

**日期**：2026-05-05
**目标**：将当前 SQLite 后端（`logs.db`）替换为基于日期分桶的 JSONL/NDJSON 文件存储，并通过 Hybrid 文件锁解决多进程/异步写入冲突。

---

## 1. 背景与动机

当前 `DatabaseStore` 使用 better-sqlite3 / sql.js（PortableSqliteDatabase）维护单一 `logs.db`，存放 cards、session_groups、forbidden_prompts、history_import_*、kv_store(settings, modular-prompts, sync-token) 等表。SQLite 在多窗口共享数据目录时存在以下痛点：

- WAL 文件（`logs.db-wal`、`logs.db-shm`）在网络盘（NFS/SSHFS）上不可靠，已有 fallback 但仍不稳。
- 跨窗口变更检测必须 polling 三个 db 文件 mtime，逻辑复杂。
- 二进制 sql.js wasm 包体大、构建依赖多（`scripts/verify-wasm-deps.mjs`）。
- 数据可读性差，调试需要外部 SQLite CLI。

JSONL 方案：纯文本、按日期分桶、append-only、跨平台依赖最小、人眼可读。

---

## 2. 目录结构

```
~/.prompter/
├─ logs/
│  ├─ 2026/
│  │   └─ 05/
│  │      └─ 03/
│  │         └─ cards.jsonl          # append-only，按 id 取最新版
│  ├─ settings.json                  # 全量覆写
│  ├─ modular-prompts.json           # 全量覆写
│  ├─ session-groups.json            # 全量覆写
│  ├─ today_forbidden.json           # 全量覆写
│  ├─ history-import.json            # 全量覆写
│  ├─ sync-token                     # 单行 token，bump 用
│  └─ .migrated                      # 迁移哨兵
└─ logs.db                           # 旧 SQLite（保留为冷备份）
```

### 2.1 卡片归属规则

每张卡片永远写入 `dateBucket = createdAt 所在天` 对应的 cards.jsonl，**即使后续状态变化跨天，也不在文件之间挪行**。

理由：避免"两文件原子事务"问题。状态字段已包含在 JSON 行内，按 id+updatedAt 折叠即可得到最新视图。

### 2.2 cards.jsonl 行格式

每行是一个完整的 PromptCard 快照（包含全部字段：id, title, content, status, runtimeState, ..., updatedAt, dateBucket, ...）。

**删除** = 写一行 tombstone：

```json
{"id":"abc","_tombstone":true,"updatedAt":"2026-05-03T10:00:00Z"}
```

读取时遇到 `_tombstone:true` 跳过该 id。

---

## 3. 并发与文件锁

### 3.1 锁策略：Hybrid（proper-lockfile + 进程内队列）

跨进程 + 跨平台 + 网络盘可靠的并发模型：

- **底层**：`proper-lockfile` 用 `mkdir(.lock/)` 作为原子原语，Linux/Mac/Windows/NFS/SSHFS 均可靠。stale 检测 10s。
- **进程内**：`Map<filePath, Promise>` 串行队列。同一进程对同一文件的多次 async 写不重复抢磁盘锁。
- **粒度**：按文件路径。不同日期 cards.jsonl 互不干扰，history-backfill workers 写不同日期可真正并发。

### 3.2 FileLock 接口

新建 `src/state/FileLock.ts`：

```ts
class FileLock {
  private inProcessQueues = new Map<string, Promise<unknown>>();

  async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.inProcessQueues.get(filePath) ?? Promise.resolve();
    const next = prev.then(() => this.runWithDiskLock(filePath, fn));
    this.inProcessQueues.set(filePath, next.catch(() => {}));
    return next;
  }

  private async runWithDiskLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const release = await lockfile.lock(filePath, {
      retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 1000 },
      stale: 10_000,
      realpath: false,
      lockfilePath: `${filePath}.lock`
    });
    try { return await fn(); } finally { await release(); }
  }
}
```

`FileLock` 由 `DataDirStore` 单例持有，全局共享。

### 3.3 读不加锁

cards.jsonl 行级写入（一次 `appendFile` 一整行 + `\n`），读端最差只读到旧版本，下一轮折叠会修正。读不进队列以避免 backfill 期间 UI 阻塞。

---

## 4. 写入流程

### 4.1 cards：append-only

```ts
async upsertCard(card: PromptCard): Promise<void> {
  const filePath = pathForBucket(card.dateBucket);
  await this.lock.withLock(filePath, async () => {
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(card) + '\n', 'utf8');
    this.cache.invalidateBucket(card.dateBucket);
  });
}
```

**为什么仍要锁**：POSIX `O_APPEND` 对超过 PIPE_BUF 的 write 不保证原子，Windows 完全不保证。

### 4.2 cards：读取折叠 + 缓存

```ts
class CardsReader {
  private bucketCache = new Map<string, PromptCard[]>();
  private bucketMtime = new Map<string, number>();

  async readBucket(bucket: string): Promise<PromptCard[]> {
    const filePath = pathForBucket(bucket);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return [];
    if (this.bucketMtime.get(bucket) === stat.mtimeMs) return this.bucketCache.get(bucket)!;
    const text = await fs.readFile(filePath, 'utf8');
    const latestById = new Map<string, PromptCard>();
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const row = JSON.parse(line);
        const prev = latestById.get(row.id);
        if (!prev || row.updatedAt > prev.updatedAt) latestById.set(row.id, row);
      } catch { /* 半截行：跳过，下次写后会被重写清理 */ }
    }
    const cards = [...latestById.values()].filter(c => !(c as any)._tombstone);
    this.bucketCache.set(bucket, cards);
    this.bucketMtime.set(bucket, stat.mtimeMs);
    return cards;
  }

  async readAll(): Promise<PromptCard[]> {
    const buckets = await listBucketDirs();
    const out: PromptCard[] = [];
    for (const b of buckets) out.push(...await this.readBucket(b));
    return out;
  }
}
```

### 4.3 全量覆写文件：write-temp + rename

```ts
async writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await this.lock.withLock(filePath, async () => {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, filePath);
  });
}
```

`history-import.json` 高频写入沿用既有 throttle（每 8 个 entry 或 400ms 一次，见 LogSyncService.ts:281-303）。

### 4.4 sync-token

任何写完成后 bump `logs/sync-token`（写 `{ts: now, owner: pid}`）。其他窗口监听其 mtime 触发 `repository.reload()`。

---

## 5. 错误恢复

| 场景 | 行为 |
|---|---|
| 进程崩溃留下 `.lock/` 目录 | proper-lockfile stale 检测 10s 内 owner 未续约即作废 |
| `.tmp` 临时文件残留 | 启动时清理 `logs/**/*.tmp` 中 mtime > 1h 的 |
| cards.jsonl 末尾半行（断电）| 读取时 try/catch 跳过坏行；定期或下次完整重写时清理 |
| 时钟回拨导致 updatedAt 倒退 | 写入时 `updatedAt = max(now, lastSeen+1ms)` 保单调 |

---

## 6. 迁移路径（一次性）

新建 `src/state/migrateFromSqlite.ts`，启动时检测：

```ts
if (existsSync(rootDir + '/logs.db') && !existsSync(rootDir + '/logs/.migrated')) {
  await migrateFromSqlite(rootDir);
}
```

**步骤**（全程 FileLock 保护，先写 `logs.migrating/` 再 rename）：

1. 打开旧 `logs.db`（PortableSqlite 复用一次）。
2. 读 `cards` 全表，按 `date_bucket` 分组，逐桶写 `logs/{Y}/{M}/{D}/cards.jsonl`。
3. `kv_store` 的 settings、modular-prompts、sync-token 各自落成独立 JSON。
4. `session_groups` → `session-groups.json`。
5. `forbidden_prompts` → `today_forbidden.json`（仅最新 dateBucket 的，对齐 DatabaseStore.ts:419）。
6. `history_import_state + pending + completed` 三表 → 合并为 `history-import.json`。
7. 写 `logs/.migrated`（迁移时间戳、源 db 大小、卡片计数）。
8. **不删 `logs.db`**。提供 `prompter.dropLegacyDb` 命令让用户后续手动清。

---

## 7. 代码改动清单

| 文件 | 改动 |
|---|---|
| `src/state/DatabaseStore.ts` | 删除 |
| `src/state/PortableSqlite.ts` | 删除 |
| `src/state/migrateToDatabase.ts` | 删除 |
| `scripts/test-migration.mjs` | 删除 |
| `scripts/verify-wasm-deps.mjs` | 删除 |
| `package.json` | 移除 better-sqlite3、sql.js；新增 proper-lockfile |
| **新增** `src/state/FileLock.ts` | §3.2 |
| **新增** `src/state/JsonlCardsStore.ts` | §4.1-4.2 |
| **新增** `src/state/MetaJsonStore.ts` | §4.3 |
| **新增** `src/state/DataDirStore.ts` | 替代 DatabaseStore，保持相同对外接口 |
| **新增** `src/state/migrateFromSqlite.ts` | §6 |
| `src/state/PromptRepository.ts` | `new DatabaseStore(rootDir)` → `new DataDirStore(rootDir)` |
| `src/services/LogSyncService.ts` | setupExternalDbWatcher 改监 sync-token；删除 logs.db* mtime 跟踪 |
| `src/extension.ts` | 启动顺序：先 migrate，再实例化 repository |
| `src/uninstall/uninstallCleanup.ts` | 清理 `logs/` 整个目录 |
| 测试 | 见 §8 |

### 7.1 接口兼容

`DataDirStore` 对外保持 `DatabaseStore` 全部签名（readJson/writeJson/getSyncToken/writeSyncToken/getDataDir/close），按 fileName 分派到 cards / meta 后端。`PromptRepository` 仅一行修改。

---

## 8. 测试策略

### 8.1 必须覆盖的并发场景

| 测试 | 场景 |
|---|---|
| `FileLock.concurrent.test.ts` | 同进程并发 100 次 `withLock(同一文件)`，断言严格串行 |
| `FileLock.crossProcess.test.ts` | spawn 5 个 child_process 同时 append 同一 cards.jsonl，行数 == 5×N，无截断 |
| `JsonlCardsStore.tombstone.test.ts` | 写 → tombstone → 重写同 id，readBucket 返回最终版本 |
| `JsonlCardsStore.corruption.test.ts` | 手工追加半截 JSON，读取不抛错 |
| `migrateFromSqlite.test.ts` | fixture logs.db 迁移后字段逐一 diff；二次启动不重复迁移 |
| `DataDirStore.atomicWrite.test.ts` | 写 settings 中途 kill 模拟崩溃，断言 settings.json 永远完整或为旧值 |

### 8.2 既有测试调整

- `tests/unit/state/PromptRepository.test.ts`：移除 SQLite mock，改用 tmp 目录 + 真 FileLock。
- `tests/unit/services/LogSyncService.test.ts`：mock 对象从 DatabaseStore 改成 DataDirStore。

### 8.3 手测

- 双 VSCode 窗口同时跑 history-backfill，UI 互看
- 强杀进程，重启后 history-import 进度恢复
- Linux / macOS / Windows / SSH-Remote 各跑一遍 backfill

---

## 9. 范围外（明确不做）

- 不引入索引文件（如 `index.json`）。需要按 id 查找时全扫 + 折叠（数据量在万级以下成本可接受）。
- 不做跨天卡片归属迁移。
- 不做 cards.jsonl 自动压缩 / GC。tombstone 累积到一定程度再考虑。
- 不删 `logs.db` 备份文件，由用户手动清理。
