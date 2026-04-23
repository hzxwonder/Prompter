import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log, logError } from '../logger';

export type WatchSource = 'claude-code' | 'codex' | 'roo-code';

export interface WatchRootConfig {
  path: string;
  source: WatchSource;
}

export interface WatchedFileInfo {
  path: string;
  source: WatchSource;
  lastSize: number;
  lastMtimeMs: number;
  /** Timestamp (Date.now()) of the last actual content change (size or mtime delta). */
  lastChangedAt: number;
}

interface WatchedFileEntry extends WatchedFileInfo {
  watcher: fs.FSWatcher | null;
  debounceId: ReturnType<typeof setTimeout> | null;
}

const POOL_STALE_MS = 30 * 60 * 1000;
const STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SAFETY_SCAN_INTERVAL_MS = 30 * 1000;
const FILE_DEBOUNCE_MS = 200;
const DIR_SCAN_DEBOUNCE_MS = 300;
const PERSIST_DEBOUNCE_MS = 2000;

interface PersistedPoolState {
  updatedAt: string;
  files: WatchedFileInfo[];
}

export interface FileWatchPoolEvents {
  fileChanged: [filePath: string, source: WatchSource];
  fileAdded: [filePath: string, source: WatchSource];
  fileRemoved: [filePath: string];
}

export class FileWatchPool extends EventEmitter {
  private readonly roots: WatchRootConfig[];
  private readonly pool = new Map<string, WatchedFileEntry>();
  private readonly rootWatchers: fs.FSWatcher[] = [];
  private readonly dirMtimeCache = new Map<string, number>();
  private readonly persistPath: string | null;
  /** Paths forbidden from (re-)entering the pool. Keyed by absolute file path. */
  private readonly forbiddenPaths = new Set<string>();
  /** Session IDs forbidden — any file whose basename (without .jsonl) matches is rejected. */
  private readonly forbiddenSessionIds = new Set<string>();

  private safetyScanId: ReturnType<typeof setInterval> | null = null;
  private staleSweepId: ReturnType<typeof setInterval> | null = null;
  private midnightTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private persistDebounceId: ReturnType<typeof setTimeout> | null = null;
  private rootDebounceIds = new Map<string, ReturnType<typeof setTimeout>>();

  private started = false;

  /**
   * @param roots       Watch root directories
   * @param persistPath Absolute path to the JSON file where pool state is saved (e.g. ~/prompter/watch-pool.json).
   *                    Pass `null` to disable persistence (useful for tests).
   */
  constructor(roots: WatchRootConfig[], persistPath: string | null = null) {
    super();
    this.roots = roots;
    this.persistPath = persistPath;
  }

  // ── public API ──────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;

    this.restorePool();
    this.setupRootWatchers();
    this.forceFullScan();

    this.safetyScanId = setInterval(() => this.safetyNetScan(), SAFETY_SCAN_INTERVAL_MS);
    this.staleSweepId = setInterval(() => this.sweepStaleFiles(), STALE_SWEEP_INTERVAL_MS);
    this.scheduleMidnightClear();

    log(`[FileWatchPool] started, ${this.roots.length} roots`);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const watcher of this.rootWatchers) {
      watcher.close();
    }
    this.rootWatchers.length = 0;

    for (const id of this.rootDebounceIds.values()) {
      clearTimeout(id);
    }
    this.rootDebounceIds.clear();

    // Flush any pending persist before clearing
    if (this.persistDebounceId) {
      clearTimeout(this.persistDebounceId);
      this.persistDebounceId = null;
    }
    this.persistNow();

    this.clearPool();

    if (this.safetyScanId) {
      clearInterval(this.safetyScanId);
      this.safetyScanId = null;
    }
    if (this.staleSweepId) {
      clearInterval(this.staleSweepId);
      this.staleSweepId = null;
    }
    if (this.midnightTimeoutId) {
      clearTimeout(this.midnightTimeoutId);
      this.midnightTimeoutId = null;
    }

    log('[FileWatchPool] stopped');
  }

  /**
   * Mark a session as forbidden — the matching `.jsonl` file is evicted
   * immediately and every subsequent attempt to re-add it (via root watcher
   * events, safety scans, persistence restore, etc.) is rejected. Also
   * accepts raw file paths for exact matches.
   */
  forbidSession(source: WatchSource | undefined, sessionId: string | undefined, filePath?: string): number {
    if (sessionId) this.forbiddenSessionIds.add(sessionId);
    if (filePath) this.forbiddenPaths.add(filePath);
    return this.removeFilesWhere((entry) => this.isForbidden(entry.path, entry.source));
  }

  isForbidden(filePath: string, _source?: WatchSource): boolean {
    if (this.forbiddenPaths.has(filePath)) return true;
    const base = path.basename(filePath, '.jsonl');
    if (this.forbiddenSessionIds.has(base)) return true;
    for (const sid of this.forbiddenSessionIds) {
      if (filePath.includes(sid)) return true;
    }
    return false;
  }

  /**
   * Remove any pool entries whose path matches the provided predicate.
   * Persists the updated pool after removal. Used when a session is
   * marked as forbidden (e.g. user deleted its card) so we stop watching it.
   */
  removeFilesWhere(predicate: (entry: WatchedFileInfo) => boolean): number {
    const toRemove: string[] = [];
    for (const [filePath, entry] of this.pool) {
      if (predicate({
        path: entry.path,
        source: entry.source,
        lastSize: entry.lastSize,
        lastMtimeMs: entry.lastMtimeMs,
        lastChangedAt: entry.lastChangedAt
      })) {
        toRemove.push(filePath);
      }
    }
    for (const filePath of toRemove) {
      this.removeFromPool(filePath);
    }
    if (toRemove.length > 0) {
      this.persistNow();
    }
    return toRemove.length;
  }

  getPoolSnapshot(): WatchedFileInfo[] {
    return [...this.pool.values()].map(({ watcher: _w, debounceId: _d, ...info }) => info);
  }

  getPoolSize(): number {
    return this.pool.size;
  }

  forceFullScan(): void {
    // Clear dir mtime cache so every directory is re-scanned
    this.dirMtimeCache.clear();
    for (const root of this.roots) {
      if (!fs.existsSync(root.path)) continue;
      this.scanDirRecursive(root.path, root.source);
    }
  }

  // ── Level 1: Root directory watchers (recursive) ─────────────

  private setupRootWatchers(): void {
    for (const root of this.roots) {
      if (!fs.existsSync(root.path)) {
        log(`[FileWatchPool] root does not exist, skipping: ${root.path}`);
        continue;
      }

      try {
        // recursive: true is essential — Codex logs live 4 levels deep
        // (sessions/2026/04/16/file.jsonl) and non-recursive watchers
        // cannot detect changes in nested directories.
        const watcher = fs.watch(root.path, { recursive: true }, (_event, filename) => {
          this.onRootEvent(root, filename ?? undefined);
        });
        this.rootWatchers.push(watcher);
        log(`[FileWatchPool] watching root: ${root.path}`);
      } catch (error) {
        logError(`[FileWatchPool] failed to watch root: ${root.path}`, error);
      }
    }
  }

  private onRootEvent(root: WatchRootConfig, filename?: string): void {
    const key = filename ? path.join(root.path, filename) : root.path;

    const existing = this.rootDebounceIds.get(key);
    if (existing) clearTimeout(existing);

    this.rootDebounceIds.set(
      key,
      setTimeout(() => {
        this.rootDebounceIds.delete(key);
        if (filename) {
          const subPath = path.join(root.path, filename);
          this.scanSubDir(subPath, root.source);
        } else {
          this.scanImmediateSubDirs(root.path, root.source);
        }
      }, DIR_SCAN_DEBOUNCE_MS)
    );
  }

  // ── Level 2: Subdirectory scan ──────────────────────────────

  private scanImmediateSubDirs(rootPath: string, source: WatchSource): void {
    try {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(rootPath, entry.name);
        this.scanSubDir(dirPath, source);
      }
    } catch (error) {
      logError(`[FileWatchPool] failed to scan subdirs of ${rootPath}`, error);
    }
  }

  private scanSubDir(dirPath: string, source: WatchSource): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dirPath);
    } catch {
      return;
    }

    if (!stat.isDirectory()) {
      // It might be a .jsonl file directly inside the root
      if (dirPath.endsWith('.jsonl') && stat.isFile()) {
        this.checkAndAddFile(dirPath, source, stat);
      }
      return;
    }

    const cachedMtime = this.dirMtimeCache.get(dirPath);
    const currentMtime = stat.mtimeMs;

    // For a directory that hasn't changed mtime, skip scanning its children
    // unless it's never been scanned (not in cache)
    if (cachedMtime !== undefined && currentMtime <= cachedMtime) {
      return;
    }

    this.dirMtimeCache.set(dirPath, currentMtime);

    // Drill into this directory
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const childPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          // Recurse for codex year/month/day hierarchy
          this.scanSubDir(childPath, source);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          this.checkAndAddFile(childPath, source);
        }
      }
    } catch (error) {
      logError(`[FileWatchPool] failed to scan dir ${dirPath}`, error);
    }
  }

  // ── Level 3: File discovery & pool management ───────────────

  private checkAndAddFile(filePath: string, source: WatchSource, existingStat?: fs.Stats): void {
    if (this.isForbidden(filePath, source)) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = existingStat ?? fs.statSync(filePath);
    } catch {
      return;
    }

    const existing = this.pool.get(filePath);
    const now = Date.now();

    if (existing) {
      // File already in pool — only update lastChangedAt when content actually changed
      if (stat.size !== existing.lastSize || stat.mtimeMs !== existing.lastMtimeMs) {
        existing.lastSize = stat.size;
        existing.lastMtimeMs = stat.mtimeMs;
        existing.lastChangedAt = now;
        this.emit('fileChanged', filePath, source);
        this.schedulePersist();
      }
      // If nothing changed, do NOT touch lastChangedAt — let it age toward eviction
      return;
    }

    // Skip files whose real mtime is already stale (older than POOL_STALE_MS)
    if (now - stat.mtimeMs > POOL_STALE_MS) {
      return;
    }

    // New file — use the file's own mtime as lastChangedAt, NOT Date.now().
    // This ensures old files are correctly aged toward eviction instead of
    // appearing "just updated" when first discovered.
    const entry: WatchedFileEntry = {
      path: filePath,
      source,
      lastSize: stat.size,
      lastMtimeMs: stat.mtimeMs,
      lastChangedAt: stat.mtimeMs,
      watcher: null,
      debounceId: null
    };

    this.installFileWatcher(entry);
    this.pool.set(filePath, entry);
    this.emit('fileAdded', filePath, source);
    this.schedulePersist();
    log(`[FileWatchPool] file added to pool: ${path.basename(filePath)} (pool size: ${this.pool.size})`);
  }

  // ── Level 4: Per-file watchers ──────────────────────────────

  private installFileWatcher(entry: WatchedFileEntry): void {
    try {
      entry.watcher = fs.watch(entry.path, (eventType) => {
        if (eventType !== 'change') return;
        this.onFileWatchEvent(entry);
      });
    } catch (error) {
      logError(`[FileWatchPool] failed to watch file: ${entry.path}`, error);
    }
  }

  private onFileWatchEvent(entry: WatchedFileEntry): void {
    // Per-file debounce to avoid rapid-fire events
    if (entry.debounceId) {
      clearTimeout(entry.debounceId);
    }

    entry.debounceId = setTimeout(() => {
      entry.debounceId = null;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(entry.path);
      } catch {
        // File deleted — remove from pool
        this.removeFromPool(entry.path);
        return;
      }

      const sizeChanged = stat.size !== entry.lastSize;
      const mtimeChanged = stat.mtimeMs !== entry.lastMtimeMs;

      if (sizeChanged || mtimeChanged) {
        entry.lastSize = stat.size;
        entry.lastMtimeMs = stat.mtimeMs;
        entry.lastChangedAt = Date.now();
        this.emit('fileChanged', entry.path, entry.source);
        this.schedulePersist();
      }
    }, FILE_DEBOUNCE_MS);
  }

  // ── Pool maintenance ────────────────────────────────────────

  private sweepStaleFiles(): void {
    const now = Date.now();
    const staleThreshold = now - POOL_STALE_MS;
    const toRemove: string[] = [];

    for (const [filePath, entry] of this.pool) {
      if (entry.lastChangedAt >= staleThreshold) continue;

      // Double-check by stat'ing the file — maybe it's been updated but we missed the event
      try {
        const stat = fs.statSync(filePath);
        if (stat.size !== entry.lastSize || stat.mtimeMs !== entry.lastMtimeMs) {
          // Actually changed — refresh
          entry.lastSize = stat.size;
          entry.lastMtimeMs = stat.mtimeMs;
          entry.lastChangedAt = now;
          this.emit('fileChanged', filePath, entry.source);
          continue;
        }
      } catch {
        // File gone — remove
      }

      toRemove.push(filePath);
    }

    for (const filePath of toRemove) {
      this.removeFromPool(filePath);
    }

    if (toRemove.length > 0) {
      log(`[FileWatchPool] swept ${toRemove.length} stale files (pool size: ${this.pool.size})`);
    }
  }

  private removeFromPool(filePath: string): void {
    const entry = this.pool.get(filePath);
    if (!entry) return;

    if (entry.watcher) {
      entry.watcher.close();
      entry.watcher = null;
    }
    if (entry.debounceId) {
      clearTimeout(entry.debounceId);
      entry.debounceId = null;
    }

    this.pool.delete(filePath);
    this.emit('fileRemoved', filePath);
    this.schedulePersist();
  }

  private clearPool(): void {
    for (const [, entry] of this.pool) {
      if (entry.watcher) entry.watcher.close();
      if (entry.debounceId) clearTimeout(entry.debounceId);
    }
    this.pool.clear();
    this.dirMtimeCache.clear();
    this.persistNow();
    log('[FileWatchPool] pool cleared');
  }

  // ── Safety net scan ─────────────────────────────────────────

  private safetyNetScan(): void {
    // Clear dir mtime cache so we can detect changes in deeply nested
    // directories whose parent mtimes did not change (e.g. a new file in
    // sessions/2026/04/16/ does not update sessions/ mtime).
    this.dirMtimeCache.clear();
    for (const root of this.roots) {
      if (!fs.existsSync(root.path)) continue;
      this.scanDirRecursive(root.path, root.source);
    }
  }

  private scanDirRecursive(dirPath: string, source: WatchSource): void {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const childPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          // Only recurse if directory mtime changed
          let stat: fs.Stats;
          try {
            stat = fs.statSync(childPath);
          } catch {
            continue;
          }
          const cachedMtime = this.dirMtimeCache.get(childPath);
          if (cachedMtime !== undefined && stat.mtimeMs <= cachedMtime) {
            continue;
          }
          this.dirMtimeCache.set(childPath, stat.mtimeMs);
          this.scanDirRecursive(childPath, source);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          this.checkAndAddFile(childPath, source);
        }
      }
    } catch {
      // silently ignore inaccessible directories
    }
  }

  // ── Persistence ─────────────────────────────────────────────

  private restorePool(): void {
    if (!this.persistPath) return;

    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const state = JSON.parse(raw) as PersistedPoolState;
      if (!Array.isArray(state.files)) return;

      const now = Date.now();
      const staleThreshold = now - POOL_STALE_MS;
      let restored = 0;

      for (const info of state.files) {
        // Skip entries that were already stale when persisted
        if (info.lastChangedAt < staleThreshold) continue;
        if (this.isForbidden(info.path, info.source)) continue;
        // Verify file still exists and hasn't been replaced
        try {
          const stat = fs.statSync(info.path);
          const entry: WatchedFileEntry = {
            path: info.path,
            source: info.source,
            lastSize: stat.size,
            lastMtimeMs: stat.mtimeMs,
            // If file changed since last persist, use its new mtime; otherwise keep the old timestamp
            lastChangedAt: (stat.size !== info.lastSize || stat.mtimeMs !== info.lastMtimeMs) ? stat.mtimeMs : info.lastChangedAt,
            watcher: null,
            debounceId: null
          };
          this.installFileWatcher(entry);
          this.pool.set(info.path, entry);
          restored += 1;
        } catch {
          // File no longer exists — skip
        }
      }

      if (restored > 0) {
        log(`[FileWatchPool] restored ${restored} files from ${path.basename(this.persistPath)}`);
      }
    } catch (error) {
      logError('[FileWatchPool] failed to restore pool state', error);
    }
  }

  private schedulePersist(): void {
    if (!this.persistPath) return;

    if (this.persistDebounceId) {
      clearTimeout(this.persistDebounceId);
    }

    this.persistDebounceId = setTimeout(() => {
      this.persistDebounceId = null;
      this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persistNow(): void {
    if (!this.persistPath) return;

    try {
      const state: PersistedPoolState = {
        updatedAt: new Date().toISOString(),
        files: this.getPoolSnapshot()
      };
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      logError('[FileWatchPool] failed to persist pool state', error);
    }
  }

  // ── Midnight clear ──────────────────────────────────────────

  private scheduleMidnightClear(): void {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

    this.midnightTimeoutId = setTimeout(() => {
      log('[FileWatchPool] midnight clear triggered');
      this.clearPool();
      this.forceFullScan();
      this.scheduleMidnightClear();
    }, delay);

    log(`[FileWatchPool] midnight clear scheduled at ${nextMidnight.toISOString()}`);
  }
}
