import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { availableParallelism, homedir } from 'node:os';
import { toDateBucket, toLocalDateBucket, type BuiltinTone, type HistoryImportEntry } from '../shared/models';
import { getLocaleText } from '../shared/i18n';
import { normalizePromptForMatching } from '../shared/promptSanitization';
import type { PromptRepository } from '../state/PromptRepository';
import { PrompterPanel } from '../panel/PrompterPanel';
import { LogParser, type LogPrompt, type LogSessionScanEntry, type ParsedPromptRecord } from './LogParser';
import { HistoryLogParsePool } from './HistoryLogParsePool';
import { FileWatchPool } from './FileWatchPool';
import { log, logError } from '../logger';

const BUILTIN_TONES = new Set<string>(['soft-bell', 'chime', 'ding']);

const WATCH_ROOTS = [
  { path: path.join(homedir(), '.claude', 'projects'), source: 'claude-code' as const },
  { path: path.join(homedir(), '.codex', 'sessions'), source: 'codex' as const }
];
const AUTO_COMPLETE_AFTER_MS = 2 * 60 * 60 * 1000;
const AWAITING_CONFIRMATION_MS = 20 * 60 * 1000;
const PAUSE_INITIAL_DELAY_MS = 10 * 1000;
const PAUSE_UNCHANGED_ACTIVITY_MS = 45 * 1000;

const HISTORY_BACKFILL_WORKER_COUNT = 3;
const HISTORY_LOOKBACK_DAYS = 30;
const HISTORY_PROGRESS_FLUSH_INTERVAL_MS = 400;
const HISTORY_PROGRESS_FLUSH_SOURCE_INTERVAL = 8;

interface ImportPromptOptions {
  foregroundOnly?: boolean;
  todayBucket?: string;
  skipRefresh?: boolean;
  skipNotify?: boolean;
}

interface ParserSyncResult {
  inserted: LogPrompt[];
  justCompletedSourceRefs: string[];
  silentlyCompletedSourceRefs: string[];
  pauseTriggerSourceRefs: string[];
}

interface WatchPoolSnapshotEntry {
  path: string;
  source: 'claude-code' | 'codex' | 'roo-code';
  lastSize: number;
  lastMtimeMs: number;
  lastChangedAt: number;
}

interface PauseMonitor {
  source: 'claude-code' | 'codex';
  sessionId: string;
  sourceRef: string;
  waitUntilMs: number;
  lastActivityChangeAtMs: number;
  lastObservedSize: number;
  lastObservedMtimeMs: number;
  isPaused: boolean;
  hasNotifiedPause: boolean;
}

function getTodayBucket(now = new Date()): string {
  return toLocalDateBucket(now);
}

function getHistoryLookbackStartBucket(now = new Date()): string {
  const lookbackStart = new Date(now);
  lookbackStart.setDate(lookbackStart.getDate() - HISTORY_LOOKBACK_DAYS);
  return toLocalDateBucket(lookbackStart);
}

function shouldIncludeHistoryBackfillEntry(entry: LogSessionScanEntry, _todayBucket: string, lookbackStartBucket: string): boolean {
  const lastModifiedBucket = toLocalDateBucket(entry.lastModifiedMs);
  return entry.dateBucket >= lookbackStartBucket || lastModifiedBucket >= lookbackStartBucket;
}

function shouldIncludeHistoryPrompt(prompt: ParsedPromptRecord, todayBucket: string, lookbackStartBucket: string): boolean {
  const promptBucket = toDateBucket(prompt.createdAt);
  return promptBucket >= lookbackStartBucket && promptBucket < todayBucket;
}

function shouldIncludeTodayPrompt(prompt: ParsedPromptRecord, todayBucket: string): boolean {
  return toDateBucket(prompt.createdAt) === todayBucket;
}

export class LogSyncService {
  private readonly historyWorkerCount = LogSyncService.resolveHistoryWorkerCount();
  private intervalId: NodeJS.Timeout | null = null;
  private midnightTimeoutId: NodeJS.Timeout | null = null;
  private watchDebounceId: NodeJS.Timeout | null = null;
  private fileWatchPool: FileWatchPool | null = null;
  private syncInFlight = false;
  private syncQueued = false;
  private initialImportInFlight = false;
  private historyBackfillInFlight = false;
  private pauseHistoryRequested = false;
  private foregroundBusyUntil = 0;
  private pauseMonitors = new Map<string, PauseMonitor>();
  private parser: LogParser;

  constructor(
    private readonly repository: PromptRepository,
    private readonly context: vscode.ExtensionContext
  ) {
    this.parser = new LogParser();
  }

  private static resolveHistoryWorkerCount(_cpuParallelism = availableParallelism()): number {
    return HISTORY_BACKFILL_WORKER_COUNT;
  }

  start(): void {
    if (this.intervalId || this.midnightTimeoutId) {
      return;
    }

    this.setupFileWatchPool();
    void this.startInitialImportIfNeeded();

    this.intervalId = setInterval(() => {
      void this.requestSync();
    }, 10000);

    this.scheduleMidnightSync();
    log('[LogSyncService] 已启动');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.midnightTimeoutId) {
      clearTimeout(this.midnightTimeoutId);
      this.midnightTimeoutId = null;
    }

    if (this.watchDebounceId) {
      clearTimeout(this.watchDebounceId);
      this.watchDebounceId = null;
    }

    if (this.fileWatchPool) {
      this.fileWatchPool.stop();
      this.fileWatchPool = null;
    }

    this.parser.close();
    log('[LogSyncService] 已停止');
  }

  markUserActivity(durationMs = 2000): void {
    this.foregroundBusyUntil = Math.max(this.foregroundBusyUntil, Date.now() + durationMs);
  }

  async runHistoryBackfill(): Promise<void> {
    if (this.historyBackfillInFlight) {
      return;
    }

    const state = await this.repository.getState();
    if (state.historyImport.pendingEntries.length === 0) {
      await this.repository.setHistoryImport({
        scope: 'history-backfill',
        status: 'complete',
        foregroundReady: true
      });
      await PrompterPanel.syncHistoryImport(this.repository);
      return;
    }

    const todayBucket = getTodayBucket();
    const lookbackStartBucket = getHistoryLookbackStartBucket();
    const entryMap = new Map<string, LogSessionScanEntry>(
      this.parser
        .discoverScanEntries()
        .filter((entry) => shouldIncludeHistoryBackfillEntry(entry, todayBucket, lookbackStartBucket))
        .map((entry) => [`${entry.source}:${entry.path}`, entry] as const)
    );
    const runningSessions = this.parser.getRunningSessionsSnapshot();
    const pendingEntries = [...state.historyImport.pendingEntries].filter((entry) => {
      const lastModifiedBucket = toLocalDateBucket(entry.lastModifiedMs);
      return entry.dateBucket >= lookbackStartBucket || lastModifiedBucket >= lookbackStartBucket;
    });
    const pendingEntryMap = new Map(pendingEntries.map((entry) => [entry.id, entry] as const));
    const completedEntries = [...state.historyImport.completedEntries];
    const completedEntrySet = new Set(completedEntries);
    const completedEntryMtims = { ...(state.historyImport.completedEntryMtims ?? {}) };
    let processedPrompts = state.historyImport.processedPrompts;
    let nextIndex = 0;
    let mutationQueue = Promise.resolve();
    let progressDirty = false;
    let processedSinceFlush = 0;
    let lastProgressFlushAt = 0;
    const historyParsePool = this.createHistoryParsePool(Math.min(this.historyWorkerCount, pendingEntries.length));

    const flushProgress = async (force = false) => {
      if (!force && !progressDirty) {
        return;
      }

      const now = Date.now();
      if (!force) {
        const elapsedSinceLastFlush = now - lastProgressFlushAt;
        if (
          processedSinceFlush < HISTORY_PROGRESS_FLUSH_SOURCE_INTERVAL &&
          elapsedSinceLastFlush < HISTORY_PROGRESS_FLUSH_INTERVAL_MS
        ) {
          return;
        }
      }

      await this.repository.setHistoryImport({
        scope: 'history-backfill',
        status: 'running',
        foregroundReady: true,
        processedPrompts,
        totalPrompts: undefined,
        processedSources: completedEntries.length,
        totalSources: completedEntries.length + pendingEntryMap.size,
        pendingEntries: [...pendingEntryMap.values()],
        completedEntries,
        completedEntryMtims
      });
      await PrompterPanel.syncHistoryImport(this.repository);
      progressDirty = false;
      processedSinceFlush = 0;
      lastProgressFlushAt = now;
    };

    const scheduleMutation = async (fn: () => Promise<void>) => {
      mutationQueue = mutationQueue.then(fn);
      await mutationQueue;
    };

    const claimNext = (): HistoryImportEntry | undefined => {
      if (this.pauseHistoryRequested || nextIndex >= pendingEntries.length) {
        return undefined;
      }

      const nextEntry = pendingEntries[nextIndex];
      nextIndex += 1;
      return nextEntry;
    };

    const markCompleted = (entryId: string, lastModifiedMs?: number) => {
      pendingEntryMap.delete(entryId);
      if (!completedEntrySet.has(entryId)) {
        completedEntries.push(entryId);
        completedEntrySet.add(entryId);
      }
      if (typeof lastModifiedMs === 'number') {
        completedEntryMtims[entryId] = lastModifiedMs;
      }
      progressDirty = true;
      processedSinceFlush += 1;
    };

    this.pauseHistoryRequested = false;
    this.historyBackfillInFlight = true;
    await this.repository.setHistoryImport({
      scope: 'history-backfill',
      status: 'running',
      foregroundReady: true,
      lastError: undefined
    });
    await PrompterPanel.syncHistoryImport(this.repository);
    lastProgressFlushAt = Date.now();

    try {
      const workers = Array.from({ length: Math.min(this.historyWorkerCount, pendingEntries.length) }, async () => {
        while (!this.pauseHistoryRequested) {
          const checkpoint = claimNext();
          if (!checkpoint) {
            return;
          }

          const entry = entryMap.get(checkpoint.id);
          if (!entry) {
            await scheduleMutation(async () => {
              markCompleted(checkpoint.id);
              await flushProgress();
            });
            continue;
          }

          try {
            const promptCount = await this.importEntry(entry, runningSessions, {
              foregroundOnly: true,
              todayBucket,
              skipRefresh: true,
              skipNotify: true
            }, async (scanEntry) => {
              const prompts = historyParsePool
                ? await historyParsePool.scanEntry(scanEntry)
                : this.parser.scanEntry(scanEntry);
              return prompts.filter((prompt) => shouldIncludeHistoryPrompt(prompt, todayBucket, lookbackStartBucket));
            });

            await scheduleMutation(async () => {
              processedPrompts += promptCount;
              markCompleted(checkpoint.id, entry.lastModifiedMs);
              await flushProgress();
            });
          } catch (error) {
            this.pauseHistoryRequested = true;
            await scheduleMutation(async () => {
              await flushProgress(true);
              await this.repository.setHistoryImport({
                scope: 'history-backfill',
                status: 'paused',
                foregroundReady: true,
                totalPrompts: undefined,
                lastError: error instanceof Error ? error.message : String(error),
                pendingEntries: [...pendingEntryMap.values()],
                completedEntries,
                completedEntryMtims
              });
              await PrompterPanel.syncHistoryImport(this.repository);
            });
          }
        }
      });

      await Promise.all(workers);
      await mutationQueue;
      await flushProgress(true);
    } finally {
      await historyParsePool?.dispose();
      this.historyBackfillInFlight = false;
      const latestState = await this.repository.getState();
      await this.repository.setHistoryImport({
        scope: 'history-backfill',
        status: latestState.historyImport.pendingEntries.length === 0 ? 'complete' : (this.pauseHistoryRequested ? 'paused' : latestState.historyImport.status),
        foregroundReady: true,
        totalPrompts: undefined,
        completedEntryMtims
      });
      await PrompterPanel.syncHistoryImport(this.repository);
      await PrompterPanel.refresh(this.repository);
    }
  }

  async pauseHistoryBackfill(): Promise<void> {
    this.pauseHistoryRequested = true;
    const state = await this.repository.getState();
    await this.repository.setHistoryImport({
      scope: 'history-backfill',
      status: state.historyImport.pendingEntries.length === 0 ? 'complete' : 'paused',
      foregroundReady: true
    });
    await PrompterPanel.syncHistoryImport(this.repository);
  }

  private async startInitialImportIfNeeded(): Promise<void> {
    const state = await this.repository.getState();
    const hasImportedCards = state.cards.some(
      (card) => card.sourceType === 'claude-code' || card.sourceType === 'codex' || card.sourceType === 'roo-code'
    );
    const hasPersistedPrompts = this.parser.hasPersistedPrompts();

    if (!hasImportedCards && hasPersistedPrompts) {
      this.parser.resetPersistedState();
      this.initialImportInFlight = true;

      try {
        await this.bootstrapTodayImport();
        await this.prepareHistoryBackfill();
      } catch (error) {
        logError('[LogSyncService] 清缓存后的首次导入失败，回退到普通同步', error);
        await this.prepareHistoryBackfill();
        await this.requestSync();
      } finally {
        this.initialImportInFlight = false;
        if (this.syncQueued) {
          this.syncQueued = false;
          await this.requestSync();
        }
      }
      return;
    }

    if (hasImportedCards || hasPersistedPrompts) {
      await this.prepareHistoryBackfill();
      await this.requestSync();
      return;
    }

    this.initialImportInFlight = true;

    try {
      await this.bootstrapTodayImport();
      await this.prepareHistoryBackfill();
    } catch (error) {
      logError('[LogSyncService] 首次历史导入失败，回退到普通同步', error);
      await this.prepareHistoryBackfill();
      await this.requestSync();
    } finally {
      this.initialImportInFlight = false;
      if (this.syncQueued) {
        this.syncQueued = false;
        await this.requestSync();
      }
    }
  }

  private scheduleMidnightSync(): void {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

    this.midnightTimeoutId = setTimeout(() => {
      // Pool handles its own midnight clear internally; rotate workspace cache first,
      // then trigger a sync + python scan for the new day.
      void this.repository.rotateTodayCards()
        .then(() => this.requestSync())
        .then(() => this.runPythonScan())
        .finally(() => {
          this.scheduleMidnightSync();
        });
    }, delay);

    log(`[LogSyncService] 已安排午夜同步，将于 ${nextMidnight.toISOString()} 执行`);
  }

  private setupFileWatchPool(): void {
    const poolPersistPath = path.join(homedir(), 'prompter', 'watch-pool.json');
    this.fileWatchPool = new FileWatchPool(WATCH_ROOTS, poolPersistPath);

    this.fileWatchPool.on('fileChanged', (filePath: string, _source: string) => {
      log(`[LogSyncService] pool: file changed — ${path.basename(filePath)}`);
      this.scheduleWatchSync();
    });

    this.fileWatchPool.on('fileAdded', (filePath: string, _source: string) => {
      log(`[LogSyncService] pool: file added — ${path.basename(filePath)}`);
      this.scheduleWatchSync();
    });

    this.fileWatchPool.start();
  }

  private scheduleWatchSync(): void {
    if (this.watchDebounceId) {
      clearTimeout(this.watchDebounceId);
    }

    this.watchDebounceId = setTimeout(() => {
      this.watchDebounceId = null;
      void this.requestSync();
    }, 300);
  }

  private async requestSync(): Promise<void> {
    if (this.initialImportInFlight) {
      this.syncQueued = true;
      return;
    }

    if (this.syncInFlight) {
      this.syncQueued = true;
      return;
    }

    this.syncInFlight = true;
    try {
      await this.sync();
    } finally {
      this.syncInFlight = false;
      if (this.syncQueued) {
        this.syncQueued = false;
        await this.requestSync();
      }
    }
  }

  private buildHistoryImportEntry(entry: LogSessionScanEntry): HistoryImportEntry {
    return {
      id: `${entry.source}:${entry.path}`,
      sourceType: entry.source,
      filePath: entry.path,
      dateBucket: entry.dateBucket,
      lastModifiedMs: entry.lastModifiedMs
    };
  }

  private async bootstrapTodayImport(): Promise<void> {
    const todayBucket = getTodayBucket();
    const runningSessions = this.parser.getRunningSessionsSnapshot();
    const entries = this.collectForegroundEntries(todayBucket, runningSessions);
    let processedPrompts = 0;
    let processedSources = 0;

    await this.publishHistoryImportProgress({
      scope: 'today-bootstrap',
      status: 'running',
      processedPrompts,
      processedSources,
      totalSources: entries.length,
      foregroundReady: false,
      warningAcknowledged: false,
      pendingEntries: [],
      completedEntries: [],
      completedEntryMtims: {}
    });

    for (const entry of entries) {
      await this.waitForForegroundIdle();
      processedPrompts += await this.importEntry(entry, runningSessions, {
        foregroundOnly: true,
        todayBucket,
        skipRefresh: true,
        skipNotify: true
      }, async (scanEntry) => this.parser.scanEntry(scanEntry).filter((prompt) => shouldIncludeTodayPrompt(prompt, todayBucket)));
      processedSources += 1;
      await this.publishHistoryImportProgress({
        scope: 'today-bootstrap',
        status: 'running',
        processedPrompts,
        processedSources,
        totalSources: entries.length,
        foregroundReady: false,
        warningAcknowledged: false,
        pendingEntries: [],
        completedEntries: [],
        completedEntryMtims: {}
      });
    }

    await this.publishHistoryImportProgress({
      scope: 'today-bootstrap',
      status: 'idle',
      processedPrompts,
      totalPrompts: processedPrompts,
      processedSources,
      totalSources: entries.length,
      foregroundReady: true,
      warningAcknowledged: false,
      pendingEntries: [],
      completedEntries: [],
      completedEntryMtims: {}
    });
    await PrompterPanel.refresh(this.repository);
  }

  private async prepareHistoryBackfill(): Promise<void> {
    const state = await this.repository.getState();
    const todayBucket = getTodayBucket();
    const lookbackStartBucket = getHistoryLookbackStartBucket();
    const entries = this.parser
      .discoverScanEntries()
      .filter((entry) => shouldIncludeHistoryBackfillEntry(entry, todayBucket, lookbackStartBucket));
    const currentEntriesById = new Map<string, LogSessionScanEntry>(
      entries.map((entry) => [`${entry.source}:${entry.path}`, entry] as const)
    );
    const pendingEntriesById = new Map(
      (state.historyImport.pendingEntries ?? [])
        .filter((entry) => entry.dateBucket >= lookbackStartBucket)
        .map((entry) => [entry.id, entry] as const)
    );
    const completedEntries = [...(state.historyImport.completedEntries ?? [])].filter((entryId) => {
      const entry = currentEntriesById.get(entryId);
      if (!entry) {
        return false;
      }
      const completedMtime = state.historyImport.completedEntryMtims?.[entryId];
      return typeof completedMtime === 'number' && completedMtime >= entry.lastModifiedMs;
    });
    const completedEntrySet = new Set(completedEntries);
    const completedEntryMtims = Object.fromEntries(
      completedEntries
        .map((entryId) => {
          const completedMtime = state.historyImport.completedEntryMtims?.[entryId];
          return typeof completedMtime === 'number' ? [entryId, completedMtime] : undefined;
        })
        .filter((entry): entry is [string, number] => Boolean(entry))
    );
    const pendingEntries = entries
      .map((entry) => {
        const pendingEntry = pendingEntriesById.get(`${entry.source}:${entry.path}`);
        if (!pendingEntry) {
          return this.buildHistoryImportEntry(entry);
        }
        return {
          ...pendingEntry,
          dateBucket: entry.dateBucket,
          filePath: entry.path,
          lastModifiedMs: entry.lastModifiedMs
        } satisfies HistoryImportEntry;
      })
      .filter((entry) => !completedEntrySet.has(entry.id));

    await this.publishHistoryImportProgress({
      scope: 'history-backfill',
      status: pendingEntries.length === 0 ? 'complete' : (state.historyImport.status === 'paused' ? 'paused' : 'idle'),
      processedPrompts: state.historyImport.processedPrompts,
      totalPrompts: undefined,
      processedSources: completedEntries.length,
      totalSources: completedEntries.length + pendingEntries.length,
      foregroundReady: true,
      warningAcknowledged: state.historyImport.warningAcknowledged,
      pendingEntries,
      completedEntries,
      completedEntryMtims,
      lastError: undefined
    });
  }

  private async publishHistoryImportProgress(progress: Awaited<ReturnType<PromptRepository['getState']>>['historyImport']): Promise<void> {
    await this.repository.setHistoryImport(progress);
    await PrompterPanel.syncHistoryImport(this.repository);
  }

  private async importEntry(
    entry: LogSessionScanEntry,
    runningSessions: Set<string>,
    options: ImportPromptOptions,
    scanEntryOverride?: (entry: LogSessionScanEntry) => Promise<ParsedPromptRecord[]>
  ): Promise<number> {
    const prompts = scanEntryOverride
      ? await scanEntryOverride(entry)
      : this.parser.scanEntry(entry);
    const { inserted } = this.parser.applySessionScan(prompts, runningSessions);
    const cardsToSave = inserted.map((prompt) => this.buildImportedCardInput(prompt, options));
    if (cardsToSave.length > 0) {
      await this.repository.saveImportedCards(cardsToSave);
    }

    const insertedInChronologicalOrder = [...inserted].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const prompt of insertedInChronologicalOrder) {
      const state = await this.repository.getState();
      await this.completePreviousSameSessionPrompts(state, prompt);

      if (prompt.status === 'completed' && prompt.completedAt && prompt.sourceRef) {
        await this.repository.markCardCompletedFromLog(prompt.sourceRef, prompt.completedAt, { justCompleted: true });
      }
    }

    return prompts.length;
  }

  private createHistoryParsePool(size: number): HistoryLogParsePool | undefined {
    if (size <= 1) {
      return undefined;
    }

    const workerScriptPath = path.join(this.context.extensionPath, 'dist', 'logParserWorker.js');
    if (!fs.existsSync(workerScriptPath)) {
      return undefined;
    }

    return new HistoryLogParsePool({
      size,
      workerScriptPath
    });
  }

  private pauseForUi(delayMs = 0): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async waitForForegroundIdle(): Promise<void> {
    while (Date.now() < this.foregroundBusyUntil) {
      await this.pauseForUi(Math.min(50, this.foregroundBusyUntil - Date.now()));
    }
  }

  private buildImportedCardInput(prompt: LogPrompt, options: ImportPromptOptions) {
    const promptBucket = toDateBucket(prompt.createdAt);
    const shouldDemoteBackgroundActivePrompt =
      options.foregroundOnly &&
      options.todayBucket !== undefined &&
      promptBucket !== options.todayBucket &&
      prompt.status === 'running';
    const nextStatus = shouldDemoteBackgroundActivePrompt
      ? 'completed'
      : (prompt.status === 'running' ? 'active' : 'completed');
    const nextRuntimeState = shouldDemoteBackgroundActivePrompt
      ? 'finished'
      : (prompt.status === 'running' ? 'running' : 'finished');

    return {
      title: prompt.userInput.slice(0, 50) + (prompt.userInput.length > 50 ? '...' : ''),
      content: prompt.userInput,
      groupName: prompt.source === 'claude-code' ? prompt.sessionId : (prompt.project || prompt.sessionId),
      sourceType: prompt.source,
      sourceRef: prompt.sourceRef,
      status: nextStatus,
      runtimeState: nextRuntimeState,
      createdAt: prompt.createdAt
    } satisfies Parameters<PromptRepository['saveImportedCard']>[0];
  }

  /**
   * Req 9: 午夜时运行 Python 脚本，将当天 prompt 写入 logs.db SQLite 数据库。
   * 脚本查找顺序：扩展目录 → ~/prompter/log_parser.py
   */
  private runPythonScan(): Promise<void> {
    const candidates = [
      path.join(this.context.extensionPath, 'log_parser.py'),
      path.join(homedir(), 'prompter', 'log_parser.py')
    ];
    const scriptPath = candidates.find((p) => fs.existsSync(p));
    if (!scriptPath) {
      log('[LogSyncService] log_parser.py 未找到，跳过 SQLite 更新');
      return Promise.resolve();
    }
    log(`[LogSyncService] 运行 Python 扫描: ${scriptPath}`);
    return new Promise((resolve) => {
      exec(`python3 "${scriptPath}" scan`, { timeout: 120000 }, (error, stdout) => {
        if (error) {
          logError('[LogSyncService] Python 扫描失败', error);
        } else {
          log(`[LogSyncService] Python 扫描完成: ${stdout.slice(0, 100)}`);
        }
        resolve();
      });
    });
  }

  private async sync(): Promise<void> {
    try {
      const state = await this.repository.getState();
      const restrictForegroundHandling = this.shouldRestrictIncrementalSync(state);
      const {
        inserted: newPrompts,
        justCompletedSourceRefs,
        silentlyCompletedSourceRefs,
        pauseTriggerSourceRefs
      } = this.syncForegroundSessionsOnly();
      const restrictedTodayBucket = getTodayBucket();

      for (const prompt of newPrompts) {
        await this.handleNewPrompt(
          prompt,
          restrictForegroundHandling
            ? {
                foregroundOnly: true,
                todayBucket: restrictedTodayBucket,
                skipNotify: true
              }
            : {}
        );
      }

      await this.registerPauseTriggers(pauseTriggerSourceRefs);

      // Handle prompts that just transitioned from running → completed
      for (const sourceRef of justCompletedSourceRefs) {
        const latestState = await this.repository.getState();
        const card = latestState.cards.find(
          (c) => c.sourceRef === sourceRef && c.status === 'active'
        );
        if (card) {
          await this.handlePromptCompleted(sourceRef);
        }
      }

      for (const sourceRef of silentlyCompletedSourceRefs) {
        const latestState = await this.repository.getState();
        const card = latestState.cards.find(
          (c) => c.sourceRef === sourceRef && c.status === 'active'
        );
        if (card) {
          const matchingLogPrompt = this.parser.getAllPrompts().find((prompt) => prompt.sourceRef === sourceRef);
          if (matchingLogPrompt?.silentCompletion) {
            await this.handlePromptCompleted(sourceRef, { justCompleted: false });
          } else {
            await this.repository.markCardCompletedFromLog(sourceRef, new Date().toISOString(), { justCompleted: false });
            this.clearPauseMonitorForSourceRef(sourceRef);
            await PrompterPanel.refresh(this.repository);
          }
        }
      }

      // Reconcile: catch any active cards whose log prompt already has completedAt
      // but whose card was never transitioned (e.g. transition was missed in a prior sync cycle)
      await this.reconcileStaleActiveCards();
      await this.reconcileMissingParsedPromptCards();
      await this.reconcilePausedPromptStates();

      // Update lastActiveAt for active cards based on session file modification time
      await this.updateActiveCardTimestamps();

      const autoCompletedIds = await this.repository.autoCompleteExpiredActiveCards(AUTO_COMPLETE_AFTER_MS);
      if (autoCompletedIds.length > 0) {
        await PrompterPanel.refresh(this.repository);

        const latestState = await this.repository.getState();

        this.playToneFromSettings(latestState.settings.completionTone, latestState.settings.customTonePath);

        if (latestState.settings.notifyOnFinish) {
          const localeText = getLocaleText(latestState.settings.language);
          for (const id of autoCompletedIds) {
            const card = latestState.cards.find((c) => c.id === id);
            if (card) {
              const message = localeText.host.notifications.promptAutoCompleted(card.title.slice(0, 30));
              await this.showLocalNotificationIfRemote(message, localeText.host.viewAction);
              await this.showRoutineToast({
                id: `prompt-auto-completed:${card.id}`,
                kind: 'success',
                message,
                actionLabel: localeText.host.viewAction
              });
            }
          }
        }
      }
    } catch (error) {
      logError('[LogSyncService] 同步失败', error);
    }
  }

  private shouldRestrictIncrementalSync(
    state: Awaited<ReturnType<PromptRepository['getState']>>
  ): boolean {
    return state.historyImport.scope === 'history-backfill' && state.historyImport.pendingEntries.length > 0;
  }

  private syncForegroundSessionsOnly(): ParserSyncResult {
    const todayBucket = getTodayBucket();
    const runningSessions = this.parser.getRunningSessionsSnapshot();
    const inserted: LogPrompt[] = [];
    const justCompletedSourceRefs = new Set<string>();
    const silentlyCompletedSourceRefs = new Set<string>();
    const pauseTriggerSourceRefs = new Set<string>();

    const eligibleEntries = this.collectForegroundEntries(todayBucket, runningSessions);

    for (const entry of eligibleEntries) {
      const prompts = this.parser.scanEntry(entry).filter((prompt) => shouldIncludeTodayPrompt(prompt, todayBucket));
      const result = this.parser.applySessionScan(prompts, runningSessions);
      inserted.push(...result.inserted);
      for (const sourceRef of result.justCompletedSourceRefs) {
        justCompletedSourceRefs.add(sourceRef);
      }
      for (const sourceRef of result.silentlyCompletedSourceRefs) {
        silentlyCompletedSourceRefs.add(sourceRef);
      }
      for (const sourceRef of result.pauseTriggerSourceRefs ?? []) {
        pauseTriggerSourceRefs.add(sourceRef);
      }
    }

    return {
      inserted,
      justCompletedSourceRefs: [...justCompletedSourceRefs],
      silentlyCompletedSourceRefs: [...silentlyCompletedSourceRefs],
      pauseTriggerSourceRefs: [...pauseTriggerSourceRefs]
    };
  }

  private collectForegroundEntries(todayBucket: string, runningSessions: Set<string>): LogSessionScanEntry[] {
    const entries = this.parser.discoverTodayOrRunningEntries(todayBucket, runningSessions);
    const merged = new Map<string, LogSessionScanEntry>(
      entries.map((entry) => [`${entry.source}:${entry.path}`, entry] as const)
    );

    for (const entry of this.buildChangedFileEntriesFromWatchPool()) {
      const entryKey = `${entry.source}:${entry.path}`;
      if (merged.has(entryKey)) {
        continue;
      }

      merged.set(entryKey, entry);
      log(`[LogSyncService] forcing changed file into today sync — ${path.basename(entry.path)}`);
    }

    return [...merged.values()].sort((left, right) => right.lastModifiedMs - left.lastModifiedMs);
  }

  private buildChangedFileEntriesFromWatchPool(): LogSessionScanEntry[] {
    if (!this.fileWatchPool) {
      return [];
    }

    const snapshot = this.fileWatchPool.getPoolSnapshot() as WatchPoolSnapshotEntry[];
    return snapshot
      .filter((entry) => entry.path.endsWith('.jsonl'))
      .map((entry) => ({
        source: entry.source,
        sessionId: path.basename(entry.path, '.jsonl'),
        path: entry.path,
        dateBucket: toLocalDateBucket(entry.lastMtimeMs || entry.lastChangedAt || Date.now()),
        lastModifiedMs: entry.lastMtimeMs || entry.lastChangedAt || Date.now()
      }));
  }

  private async reconcileStaleActiveCards(): Promise<void> {
    const state = await this.repository.getState();
    const logPrompts = this.parser.getAllPrompts();

    let reconciled = false;
    for (const card of state.cards) {
      if (!card.sourceRef) continue;
      if (card.sourceType === 'manual' || card.sourceType === 'cursor') continue;

      const matchingLogPrompt = logPrompts.find(
        (lp) => lp.sourceRef === card.sourceRef && lp.userInput === card.content && lp.completedAt
      );
      if (!matchingLogPrompt) continue;

      // Case 1: card is still active but the log shows it's completed
      if (card.status === 'active') {
        log(`[LogSyncService] Reconciling stale active card: ${card.id}`);
        await this.repository.markCardCompletedFromLog(card.id, matchingLogPrompt.completedAt!, {
          justCompleted: !matchingLogPrompt.silentCompletion
        });
        this.clearPauseMonitorForSourceRef(card.sourceRef ?? card.id);
        reconciled = true;
        continue;
      }

      // Case 2: card is completed but completedAt was never set (imported before
      // the justCompleted fix, or sync raced). Backfill completedAt and clear
      // justCompleted so it no longer shows as "待确认".
      if (card.status === 'completed' && !card.completedAt) {
        log(`[LogSyncService] Backfilling completedAt for card: ${card.id}`);
        await this.repository.markCardCompletedFromLog(card.id, matchingLogPrompt.completedAt!, { justCompleted: false });
        reconciled = true;
      }
    }

    if (reconciled) {
      await PrompterPanel.refresh(this.repository);

      const updatedState = await this.repository.getState();
      this.playToneFromSettings(updatedState.settings.completionTone, updatedState.settings.customTonePath);

      if (updatedState.settings.notifyOnFinish) {
        const localeText = getLocaleText(updatedState.settings.language);
        await this.showLocalNotificationIfRemote(
          localeText.host.notifications.promptCompletedGeneric,
          localeText.host.viewAction
        );
        await this.showRoutineToast({
          id: `prompt-completed-generic:${Date.now()}`,
          kind: 'success',
          message: localeText.host.notifications.promptCompletedGeneric,
          actionLabel: localeText.host.viewAction
        });
      }
    }
  }

  private async reconcileMissingParsedPromptCards(): Promise<void> {
    const state = await this.repository.getState();
    const parsedPrompts = this.parser.getAllPrompts().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    let changed = false;

    for (const prompt of parsedPrompts) {
      if (this.hasMatchingImportedCard(state, prompt)) {
        continue;
      }

      const card = await this.repository.saveImportedCard(this.buildImportedCardInput(prompt, {}));
      if (prompt.status === 'completed' && prompt.completedAt) {
        await this.repository.markCardCompletedFromLog(card.sourceRef ?? card.id, prompt.completedAt, { justCompleted: false });
      }
      changed = true;
      state.cards.push(card);
    }

    if (changed) {
      await PrompterPanel.refresh(this.repository);
    }
  }

  private hasMatchingImportedCard(
    state: Awaited<ReturnType<PromptRepository['getState']>>,
    prompt: LogPrompt
  ): boolean {
    const normalizedPrompt = normalizePromptForMatching(prompt.userInput);
    const promptCreatedAtMs = Date.parse(prompt.createdAt);

    return state.cards.some((card) => {
      if (card.sourceType !== prompt.source) {
        return false;
      }

      if (resolveSessionId(card.sourceType, card.sourceRef) !== prompt.sessionId) {
        return false;
      }

      if (normalizePromptForMatching(card.content) !== normalizedPrompt) {
        return false;
      }

      const cardCreatedAtMs = Date.parse(card.createdAt);
      if (Number.isNaN(promptCreatedAtMs) || Number.isNaN(cardCreatedAtMs)) {
        return card.createdAt === prompt.createdAt;
      }

      return Math.abs(cardCreatedAtMs - promptCreatedAtMs) <= 2000;
    });
  }

  private playToneFromSettings(tone: string, customPath: string): void {
    if (this.isRemoteExtensionHost()) {
      if (tone !== 'off' && tone !== 'custom' && BUILTIN_TONES.has(tone)) {
        const playedInWebview = PrompterPanel.playCompletionToneInWebviewIfOpen(tone as BuiltinTone);
        if (playedInWebview) {
          log(`[LogSyncService] Remote host -> local webview audio: ${vscode.env.remoteName}`);
          return;
        }
      }
      log(`[LogSyncService] Remote host -> local notification fallback: ${vscode.env.remoteName}`);
      log(`[LogSyncService] Skipping host audio playback in remote extension host: ${vscode.env.remoteName}`);
      return;
    }
    if (tone === 'off') return;
    if (tone === 'custom') {
      if (customPath) {
        PrompterPanel.playCustomTone(customPath);
      }
      return;
    }
    if (BUILTIN_TONES.has(tone)) {
      PrompterPanel.playCompletionTone(tone as BuiltinTone);
    }
  }

  private async showRoutineToast(options: {
    id: string;
    kind: 'info' | 'success';
    message: string;
    actionLabel?: string;
  }): Promise<void> {
    await PrompterPanel.showToast({
      id: options.id,
      kind: options.kind,
      message: options.message,
      actionLabel: options.actionLabel,
      actionCommand: options.actionLabel ? 'prompter.open' : undefined
    });
  }

  private isRemoteExtensionHost(): boolean {
    return Boolean(vscode.env.remoteName);
  }

  private async showLocalNotificationIfRemote(message: string, actionLabel?: string): Promise<void> {
    if (!this.isRemoteExtensionHost()) {
      return;
    }

    void (async () => {
      const selection = actionLabel
        ? await vscode.window.showInformationMessage(message, actionLabel)
        : await vscode.window.showInformationMessage(message);

      if (selection === actionLabel && actionLabel) {
        await vscode.commands.executeCommand('prompter.open');
      }
    })().catch((error) => {
      logError('[LogSyncService] 本地通知失败', error);
    });
  }

  private async updateActiveCardTimestamps(): Promise<void> {
    const currentState = await this.repository.getState();
    const latestActiveCardBySession = new Map<string, typeof currentState.cards[number]>();

    for (const card of currentState.cards) {
      if (card.status !== 'active' || card.runtimeState !== 'running') continue;
      if (!card.sourceRef || card.sourceType === 'manual' || card.sourceType === 'cursor') continue;

      const sessionId = resolveSessionId(card.sourceType, card.sourceRef);
      if (!sessionId) continue;

      const sessionKey = `${card.sourceType}:${sessionId}`;
      const existing = latestActiveCardBySession.get(sessionKey);
      if (!existing || (existing.createdAt ?? '') < (card.createdAt ?? '')) {
        latestActiveCardBySession.set(sessionKey, card);
      }
    }

    let changed = false;

    for (const card of latestActiveCardBySession.values()) {
      const sessionId = resolveSessionId(card.sourceType, card.sourceRef);
      if (!sessionId) continue;
      const lastModMs = this.parser.getSessionLastModifiedMs(
        card.sourceType as 'claude-code' | 'codex' | 'roo-code',
        sessionId
      );
      if (lastModMs === undefined) continue;

      const lastModIso = new Date(lastModMs).toISOString();
      if (!card.lastActiveAt || lastModIso > card.lastActiveAt) {
        const sourceRef = card.sourceRef;
        if (!sourceRef) {
          continue;
        }
        await this.repository.updateCardLastActiveAt(sourceRef, lastModIso);
        changed = true;
      }
    }

    if (changed) {
      await PrompterPanel.refresh(this.repository);
    }
  }

  private async handleNewPrompt(prompt: LogPrompt, options: ImportPromptOptions = {}): Promise<void> {
    log(`[LogSyncService] 发现新 prompt: ${prompt.sessionId}`);

    const state = await this.repository.getState();
    if (!options.foregroundOnly || prompt.status === 'running') {
      await this.completePreviousSameSessionPrompts(state, prompt);
    }

    const card = await this.repository.saveImportedCard(this.buildImportedCardInput(prompt, options));

    // When a prompt is imported as already-completed (both turns finished between
    // sync cycles), mark it as justCompleted so it shows as "待确认" in the UI.
    // The next prompt in the same session will auto-acknowledge it via
    // completePreviousSameSessionPrompts.
    if (!options.skipNotify && prompt.status === 'completed' && prompt.completedAt && card.sourceRef) {
      await this.repository.markCardCompletedFromLog(card.sourceRef, prompt.completedAt, {
        justCompleted: !prompt.silentCompletion
      });
    }

    if (!options.skipRefresh) {
      await PrompterPanel.refresh(this.repository);
    }

    if (!options.skipNotify && prompt.status === 'running') {
      const localeText = getLocaleText(state.settings.language);
      await this.showRoutineToast({
        id: `prompt-running:${card.id}`,
        kind: 'info',
        message: localeText.host.notifications.newRunningPrompt(card.title.slice(0, 30)),
        actionLabel: localeText.host.viewAction
      });
    }
  }

  private async handlePromptCompleted(sourceRef: string, options?: { justCompleted?: boolean }): Promise<void> {
    log(`[LogSyncService] prompt 完成: ${sourceRef}`);

    const state = await this.repository.getState();
    const card = state.cards.find((c) => c.sourceRef === sourceRef);

    if (!card) {
      return;
    }

    // 标记为已完成
    await this.repository.markCardCompletedFromLog(sourceRef, new Date().toISOString(), {
      justCompleted: options?.justCompleted ?? true
    });
    this.clearPauseMonitorForSourceRef(sourceRef);

    // 刷新 webview
    await PrompterPanel.refresh(this.repository);

    const updatedState = await this.repository.getState();

    // 播放完成铃声
    this.playToneFromSettings(updatedState.settings.completionTone, updatedState.settings.customTonePath);

    // 发送通知
    if (updatedState.settings.notifyOnFinish) {
      const localeText = getLocaleText(updatedState.settings.language);
      const message = localeText.host.notifications.promptCompleted(card.title.slice(0, 30));
      await this.showLocalNotificationIfRemote(message, localeText.host.viewAction);
      await this.showRoutineToast({
        id: `prompt-completed:${card.id}`,
        kind: 'success',
        message,
        actionLabel: localeText.host.viewAction
      });
    }
  }

  private async completePreviousSameSessionPrompts(
    state: Awaited<ReturnType<PromptRepository['getState']>>,
    prompt: LogPrompt
  ): Promise<void> {
    const completedAt = normalizeCompletionTimestamp(prompt.createdAt);
    const promptCreatedAtMs = Date.parse(completedAt);

    for (const card of state.cards) {
      if (card.sourceType !== prompt.source) {
        continue;
      }

      if (resolveSessionId(card.sourceType, card.sourceRef) !== prompt.sessionId) {
        continue;
      }

      // Acknowledge completed cards that are still in "awaiting confirmation" state
      if (card.status === 'completed' && card.justCompleted) {
        await this.repository.acknowledgeCompletion(card.id);
        continue;
      }

      // Complete active/running cards that are older than the new prompt
      if (card.status !== 'active' || card.runtimeState === 'finished') {
        continue;
      }

      const cardCreatedAtMs = Date.parse(card.createdAt);
      if (!Number.isNaN(promptCreatedAtMs) && !Number.isNaN(cardCreatedAtMs) && cardCreatedAtMs >= promptCreatedAtMs) {
        continue;
      }

      await this.repository.markCardCompletedFromLog(card.id, completedAt, { justCompleted: false });
      this.clearPauseMonitorForSourceRef(card.sourceRef ?? card.id);
    }
  }

  private async registerPauseTriggers(sourceRefs: string[]): Promise<void> {
    if (sourceRefs.length === 0) {
      return;
    }

    const state = await this.repository.getState();
    if (!this.isExperimentalPromptPauseEnabled(state)) {
      this.pauseMonitors.clear();
      return;
    }

    const nowMs = Date.now();

    for (const sourceRef of sourceRefs) {
      const card = state.cards.find((entry) => entry.sourceRef === sourceRef && entry.status === 'active');
      if (!card) {
        continue;
      }

      const sessionId = resolveSessionId(card.sourceType, card.sourceRef);
      if (!sessionId || (card.sourceType !== 'claude-code' && card.sourceType !== 'codex')) {
        continue;
      }

      const snapshotEntry = this.getWatchSnapshotEntry(card.sourceType, sessionId);
      if (!snapshotEntry) {
        continue;
      }

      const monitorKey = `${card.sourceType}:${sessionId}`;
      this.pauseMonitors.set(monitorKey, {
        source: card.sourceType,
        sessionId,
        sourceRef: card.sourceRef!,
        waitUntilMs: nowMs + PAUSE_INITIAL_DELAY_MS,
        lastActivityChangeAtMs: nowMs + PAUSE_INITIAL_DELAY_MS,
        lastObservedSize: snapshotEntry.lastSize,
        lastObservedMtimeMs: snapshotEntry.lastMtimeMs,
        isPaused: card.runtimeState === 'paused',
        hasNotifiedPause: false
      });
    }
  }

  private getWatchSnapshotEntry(
    source: 'claude-code' | 'codex',
    sessionId: string
  ): WatchPoolSnapshotEntry | undefined {
    if (!this.fileWatchPool) {
      return undefined;
    }

    const snapshot = this.fileWatchPool.getPoolSnapshot() as WatchPoolSnapshotEntry[];
    return snapshot.find(
      (entry) => entry.source === source && path.basename(entry.path, '.jsonl') === sessionId
    );
  }

  private async reconcilePausedPromptStates(): Promise<void> {
    const state = await this.repository.getState();
    const nowMs = Date.now();

    if (!this.isExperimentalPromptPauseEnabled(state)) {
      await this.restorePausedCardsWhenPromptPauseDisabled(state, nowMs);
      return;
    }

    if (!this.fileWatchPool || this.pauseMonitors.size === 0) {
      return;
    }

    let changed = false;

    for (const [monitorKey, monitor] of this.pauseMonitors) {
      const latestCard = this.findLatestActiveImportedCardForSession(state, monitor.source, monitor.sessionId);
      if (!latestCard?.sourceRef) {
        this.pauseMonitors.delete(monitorKey);
        continue;
      }

      if (latestCard.sourceRef !== monitor.sourceRef) {
        this.pauseMonitors.delete(monitorKey);
        continue;
      }

      const snapshotEntry = this.getWatchSnapshotEntry(monitor.source, monitor.sessionId);
      if (!snapshotEntry) {
        continue;
      }

      const sizeChanged = snapshotEntry.lastSize !== monitor.lastObservedSize;
      const mtimeChanged = snapshotEntry.lastMtimeMs !== monitor.lastObservedMtimeMs;

      if (sizeChanged || mtimeChanged) {
        monitor.lastObservedSize = snapshotEntry.lastSize;
        monitor.lastObservedMtimeMs = snapshotEntry.lastMtimeMs;
        monitor.lastActivityChangeAtMs = nowMs;

        if (monitor.isPaused) {
          await this.repository.updateCardRuntimeState(monitor.sourceRef, 'running', new Date(nowMs).toISOString());
          monitor.isPaused = false;
          monitor.hasNotifiedPause = false;
          changed = true;
        }
        continue;
      }

      if (monitor.isPaused || nowMs < monitor.waitUntilMs) {
        continue;
      }

      if (nowMs - monitor.lastActivityChangeAtMs < PAUSE_UNCHANGED_ACTIVITY_MS) {
        continue;
      }

      await this.repository.updateCardRuntimeState(monitor.sourceRef, 'paused', new Date(nowMs).toISOString());
      monitor.isPaused = true;
      changed = true;

      if (!monitor.hasNotifiedPause) {
        await this.notifyPromptPaused(latestCard, new Date(nowMs).toISOString());
        monitor.hasNotifiedPause = true;
      }
    }

    if (changed) {
      await PrompterPanel.refresh(this.repository);
    }
  }

  private findLatestActiveImportedCardForSession(
    state: Awaited<ReturnType<PromptRepository['getState']>>,
    source: 'claude-code' | 'codex',
    sessionId: string
  ) {
    let latestCard: Awaited<ReturnType<PromptRepository['getState']>>['cards'][number] | undefined;

    for (const card of state.cards) {
      if (card.status !== 'active') {
        continue;
      }
      if (card.sourceType !== source) {
        continue;
      }
      if (resolveSessionId(card.sourceType, card.sourceRef) !== sessionId) {
        continue;
      }
      if (!latestCard || latestCard.createdAt < card.createdAt) {
        latestCard = card;
      }
    }

    return latestCard;
  }

  private async notifyPromptPaused(
    card: Awaited<ReturnType<PromptRepository['getState']>>['cards'][number],
    nowIso: string
  ): Promise<void> {
    const state = await this.repository.getState();
    this.playToneFromSettings(state.settings.completionTone, state.settings.customTonePath);

    if (!state.settings.notifyOnPause) {
      return;
    }

    const localeText = getLocaleText(state.settings.language);
    const message = localeText.host.notifications.promptPaused(card.title.slice(0, 30));
    await this.showLocalNotificationIfRemote(message, localeText.host.viewAction);
    await this.showRoutineToast({
      id: `prompt-paused:${card.id}:${nowIso}`,
      kind: 'info',
      message,
      actionLabel: localeText.host.viewAction
    });
  }

  private clearPauseMonitorForSourceRef(sourceRef: string): void {
    for (const [monitorKey, monitor] of this.pauseMonitors) {
      if (monitor.sourceRef === sourceRef) {
        this.pauseMonitors.delete(monitorKey);
      }
    }
  }

  private isExperimentalPromptPauseEnabled(
    state: Awaited<ReturnType<PromptRepository['getState']>>
  ): boolean {
    return state.settings.enableExperimentalPromptPause === true;
  }

  private async restorePausedCardsWhenPromptPauseDisabled(
    state: Awaited<ReturnType<PromptRepository['getState']>>,
    nowMs: number
  ): Promise<void> {
    let changed = false;

    for (const card of state.cards) {
      if (card.status !== 'active' || card.runtimeState !== 'paused' || !card.sourceRef) {
        continue;
      }
      if (card.sourceType !== 'claude-code' && card.sourceType !== 'codex') {
        continue;
      }

      await this.repository.updateCardRuntimeState(card.sourceRef, 'running', new Date(nowMs).toISOString());
      changed = true;
    }

    this.pauseMonitors.clear();

    if (changed) {
      await PrompterPanel.refresh(this.repository);
    }
  }
}

function resolveSessionId(
  sourceType: 'claude-code' | 'codex' | 'roo-code' | 'manual' | 'cursor',
  sourceRef?: string
): string | undefined {
  if (!sourceRef) {
    return undefined;
  }

  if (sourceType === 'codex' || sourceType === 'claude-code') {
    return sourceRef.includes(':') ? sourceRef.split(':')[0] : sourceRef;
  }

  return sourceRef;
}

function normalizeCompletionTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
