import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { availableParallelism, homedir } from 'node:os';
import { toDateBucket, type BuiltinTone, type HistoryImportEntry } from '../shared/models';
import { getLocaleText } from '../shared/i18n';
import type { PromptRepository } from '../state/PromptRepository';
import { PrompterPanel } from '../panel/PrompterPanel';
import { LogParser, type LogPrompt, type LogSessionScanEntry, type ParsedPromptRecord } from './LogParser';
import { HistoryLogParsePool } from './HistoryLogParsePool';
import { log, logError } from '../logger';

const BUILTIN_TONES = new Set<string>(['soft-bell', 'chime', 'ding']);

const WATCH_ROOTS = [
  path.join(homedir(), '.claude', 'projects'),
  path.join(homedir(), '.codex', 'sessions')
];
const AUTO_COMPLETE_AFTER_MS = 2 * 60 * 60 * 1000;
const AWAITING_CONFIRMATION_MS = 20 * 60 * 1000;

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
}

function logSessionKey(source: LogPrompt['source'], sessionId: string): string {
  return `${source}:${sessionId}`;
}

export class LogSyncService {
  private readonly historyWorkerCount = LogSyncService.resolveHistoryWorkerCount();
  private intervalId: NodeJS.Timeout | null = null;
  private midnightTimeoutId: NodeJS.Timeout | null = null;
  private watchDebounceId: NodeJS.Timeout | null = null;
  private readonly watchers: fs.FSWatcher[] = [];
  private syncInFlight = false;
  private syncQueued = false;
  private initialImportInFlight = false;
  private historyBackfillInFlight = false;
  private pauseHistoryRequested = false;
  private foregroundBusyUntil = 0;
  private parser: LogParser;

  constructor(
    private readonly repository: PromptRepository,
    private readonly context: vscode.ExtensionContext
  ) {
    this.parser = new LogParser();
  }

  private static resolveHistoryWorkerCount(cpuParallelism = availableParallelism()): number {
    return Math.max(1, Math.min(8, Math.floor(cpuParallelism * 0.75)));
  }

  start(): void {
    if (this.intervalId || this.midnightTimeoutId) {
      return;
    }

    this.setupWatchers();
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

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.length = 0;

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

    const todayBucket = new Date().toISOString().slice(0, 10);
    const entryMap = new Map<string, LogSessionScanEntry>(
      this.parser
        .discoverScanEntries()
        .filter((entry) => entry.dateBucket !== todayBucket)
        .map((entry) => [`${entry.source}:${entry.path}`, entry] as const)
    );
    const runningSessions = this.parser.getRunningSessionsSnapshot();
    const pendingEntries = [...state.historyImport.pendingEntries];
    const pendingEntryMap = new Map(pendingEntries.map((entry) => [entry.id, entry] as const));
    const completedEntries = [...state.historyImport.completedEntries];
    const completedEntrySet = new Set(completedEntries);
    const completedEntryMtims = { ...(state.historyImport.completedEntryMtims ?? {}) };
    let processedPrompts = state.historyImport.processedPrompts;
    let nextIndex = 0;
    let mutationQueue = Promise.resolve();
    const historyParsePool = this.createHistoryParsePool(Math.min(this.historyWorkerCount, pendingEntries.length));

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
              await this.repository.setHistoryImport({
                scope: 'history-backfill',
                status: 'running',
                processedSources: completedEntries.length,
                totalSources: completedEntries.length + pendingEntryMap.size,
                processedPrompts,
                totalPrompts: undefined,
                pendingEntries: [...pendingEntryMap.values()],
                completedEntries,
                completedEntryMtims
              });
              await PrompterPanel.syncHistoryImport(this.repository);
            });
            continue;
          }

          try {
            const promptCount = await this.importEntry(entry, runningSessions, {
              foregroundOnly: true,
              todayBucket,
              skipRefresh: true,
              skipNotify: true
            }, historyParsePool ? (scanEntry) => historyParsePool.scanEntry(scanEntry) : undefined);

            await scheduleMutation(async () => {
              processedPrompts += promptCount;
              markCompleted(checkpoint.id, entry.lastModifiedMs);
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
            });
          } catch (error) {
            this.pauseHistoryRequested = true;
            await scheduleMutation(async () => {
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

    if (hasImportedCards || this.parser.hasPersistedPrompts()) {
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
      void this.requestSync()
        .then(() => this.runPythonScan())
        .finally(() => {
          this.scheduleMidnightSync();
        });
    }, delay);

    log(`[LogSyncService] 已安排午夜同步，将于 ${nextMidnight.toISOString()} 执行`);
  }

  private setupWatchers(): void {
    for (const rootPath of WATCH_ROOTS) {
      if (!fs.existsSync(rootPath)) {
        continue;
      }

      try {
        const watcher = fs.watch(rootPath, { recursive: true }, () => {
          this.scheduleWatchSync();
        });
        this.watchers.push(watcher);
        log(`[LogSyncService] 已监听日志目录: ${rootPath}`);
      } catch (error) {
        logError(`[LogSyncService] 监听日志目录失败: ${rootPath}`, error);
      }
    }
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
    const todayBucket = new Date().toISOString().slice(0, 10);
    const entries = this.parser.discoverScanEntries().filter((entry) => entry.dateBucket === todayBucket);
    const runningSessions = this.parser.getRunningSessionsSnapshot();
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
      });
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
    const todayBucket = new Date().toISOString().slice(0, 10);
    const entries = this.parser.discoverScanEntries().filter((entry) => entry.dateBucket !== todayBucket);
    const currentEntriesById = new Map<string, LogSessionScanEntry>(
      entries.map((entry) => [`${entry.source}:${entry.path}`, entry] as const)
    );
    const pendingEntriesById = new Map(
      (state.historyImport.pendingEntries ?? []).map((entry) => [entry.id, entry] as const)
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
      const {
        inserted: newPrompts,
        justCompletedSourceRefs,
        silentlyCompletedSourceRefs
      } = this.shouldRestrictIncrementalSync(state)
        ? this.syncForegroundSessionsOnly()
        : this.parser.sync();
      const restrictedTodayBucket = new Date().toISOString().slice(0, 10);

      for (const prompt of newPrompts) {
        await this.handleNewPrompt(
          prompt,
          this.shouldRestrictIncrementalSync(state)
            ? {
                foregroundOnly: true,
                todayBucket: restrictedTodayBucket,
                skipNotify: true
              }
            : {}
        );
      }

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
          await this.repository.markCardCompletedFromLog(sourceRef, new Date().toISOString(), { justCompleted: false });
          await PrompterPanel.refresh(this.repository);
        }
      }

      // Reconcile: catch any active cards whose log prompt already has completedAt
      // but whose card was never transitioned (e.g. transition was missed in a prior sync cycle)
      await this.reconcileStaleActiveCards();

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
              vscode.window.showInformationMessage(
                localeText.host.notifications.promptAutoCompleted(card.title.slice(0, 30)),
                localeText.host.viewAction
              ).then((selection) => {
                if (selection === localeText.host.viewAction) {
                  vscode.commands.executeCommand('prompter.open');
                }
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
    const todayBucket = new Date().toISOString().slice(0, 10);
    const runningSessions = this.parser.getRunningSessionsSnapshot();
    const inserted: LogPrompt[] = [];
    const justCompletedSourceRefs = new Set<string>();
    const silentlyCompletedSourceRefs = new Set<string>();

    const eligibleEntries = this.parser
      .discoverScanEntries()
      .filter(
        (entry) =>
          entry.dateBucket === todayBucket ||
          runningSessions.has(logSessionKey(entry.source, entry.sessionId))
      );

    for (const entry of eligibleEntries) {
      const prompts = this.parser.scanEntry(entry).filter(
        (prompt) => toDateBucket(prompt.createdAt) === todayBucket
      );
      const result = this.parser.applySessionScan(prompts, runningSessions);
      inserted.push(...result.inserted);
      for (const sourceRef of result.justCompletedSourceRefs) {
        justCompletedSourceRefs.add(sourceRef);
      }
      for (const sourceRef of result.silentlyCompletedSourceRefs) {
        silentlyCompletedSourceRefs.add(sourceRef);
      }
    }

    return {
      inserted,
      justCompletedSourceRefs: [...justCompletedSourceRefs],
      silentlyCompletedSourceRefs: [...silentlyCompletedSourceRefs]
    };
  }

  private async reconcileStaleActiveCards(): Promise<void> {
    const state = await this.repository.getState();
    const logPrompts = this.parser.getAllPrompts();

    // Build a set of sourceRefs that the parser considers completed
    const completedSourceRefs = new Set<string>();
    for (const lp of logPrompts) {
      if (lp.completedAt) {
        completedSourceRefs.add(lp.sourceRef);
      }
    }

    let reconciled = false;
    for (const card of state.cards) {
      if (card.status !== 'active') continue;
      if (!card.sourceRef) continue;
      if (card.sourceType === 'manual' || card.sourceType === 'cursor') continue;

      // For claude-code: also match by content + sourceRef since multiple prompts share sourceRef
      const matchingLogPrompt = logPrompts.find(
        (lp) => lp.sourceRef === card.sourceRef && lp.userInput === card.content && lp.completedAt
      );

      if (matchingLogPrompt) {
        log(`[LogSyncService] Reconciling stale active card: ${card.id}`);
        await this.repository.markCardCompletedFromLog(card.id, matchingLogPrompt.completedAt!);
        reconciled = true;
      }
    }

    if (reconciled) {
      await PrompterPanel.refresh(this.repository);

      const updatedState = await this.repository.getState();
      this.playToneFromSettings(updatedState.settings.completionTone, updatedState.settings.customTonePath);

      if (updatedState.settings.notifyOnFinish) {
        const localeText = getLocaleText(updatedState.settings.language);
        vscode.window.showInformationMessage(
          localeText.host.notifications.promptCompletedGeneric,
          localeText.host.viewAction
        ).then((selection) => {
          if (selection === localeText.host.viewAction) {
            vscode.commands.executeCommand('prompter.open');
          }
        });
      }
    }
  }

  private playToneFromSettings(tone: string, customPath: string): void {
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
    if (!options.foregroundOnly) {
      await this.completePreviousSameSessionPrompts(state, prompt);
    }

    const card = await this.repository.saveImportedCard(this.buildImportedCardInput(prompt, options));

    if (!options.skipRefresh) {
      await PrompterPanel.refresh(this.repository);
    }

    if (!options.skipNotify && prompt.status === 'running') {
      const localeText = getLocaleText(state.settings.language);
      vscode.window.showInformationMessage(
        localeText.host.notifications.newRunningPrompt(card.title.slice(0, 30)),
        localeText.host.viewAction
      ).then((selection) => {
        if (selection === localeText.host.viewAction) {
          vscode.commands.executeCommand('prompter.open');
        }
      });
    }
  }

  private async handlePromptCompleted(sourceRef: string): Promise<void> {
    log(`[LogSyncService] prompt 完成: ${sourceRef}`);

    const state = await this.repository.getState();
    const card = state.cards.find((c) => c.sourceRef === sourceRef);

    if (!card) {
      return;
    }

    // 标记为已完成
    await this.repository.markCardCompletedFromLog(sourceRef, new Date().toISOString());

    // 刷新 webview
    await PrompterPanel.refresh(this.repository);

    const updatedState = await this.repository.getState();

    // 播放完成铃声
    this.playToneFromSettings(updatedState.settings.completionTone, updatedState.settings.customTonePath);

    // 发送通知
    if (updatedState.settings.notifyOnFinish) {
      const localeText = getLocaleText(updatedState.settings.language);
      vscode.window.showInformationMessage(
        localeText.host.notifications.promptCompleted(card.title.slice(0, 30)),
        localeText.host.viewAction
      ).then((selection) => {
        if (selection === localeText.host.viewAction) {
          vscode.commands.executeCommand('prompter.open');
        }
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
      if (
        card.status === 'completed' &&
        card.justCompleted &&
        card.sourceType === prompt.source &&
        resolveSessionId(card.sourceType, card.sourceRef) === prompt.sessionId
      ) {
        await this.repository.acknowledgeCompletion(card.id);
        continue;
      }

      if (card.status !== 'active' || card.runtimeState !== 'running') {
        continue;
      }

      if (card.sourceType !== prompt.source) {
        continue;
      }

      if (resolveSessionId(card.sourceType, card.sourceRef) !== prompt.sessionId) {
        continue;
      }

      const cardCreatedAtMs = Date.parse(card.createdAt);
      if (!Number.isNaN(promptCreatedAtMs) && !Number.isNaN(cardCreatedAtMs) && cardCreatedAtMs >= promptCreatedAtMs) {
        continue;
      }

      await this.repository.markCardCompletedFromLog(card.id, completedAt, { justCompleted: false });
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

  if (sourceType === 'codex') {
    return sourceRef.includes(':') ? sourceRef.split(':')[0] : sourceRef;
  }

  return sourceRef;
}

function normalizeCompletionTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
