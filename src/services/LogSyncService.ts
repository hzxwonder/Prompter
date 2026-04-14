import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { BuiltinTone } from '../shared/models';
import { getLocaleText } from '../shared/i18n';
import type { PromptRepository } from '../state/PromptRepository';
import { PrompterPanel } from '../panel/PrompterPanel';
import { LogParser, type LogPrompt } from './LogParser';
import { log, logError } from '../logger';

const BUILTIN_TONES = new Set<string>(['soft-bell', 'chime', 'ding']);

const WATCH_ROOTS = [
  path.join(homedir(), '.claude', 'projects'),
  path.join(homedir(), '.codex', 'sessions'),
  path.join(
    homedir(),
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'globalStorage',
    'rooveterinaryinc.roo-cline',
    'tasks'
  )
];
const AUTO_COMPLETE_AFTER_MS = 2 * 60 * 60 * 1000;
const AWAITING_CONFIRMATION_MS = 20 * 60 * 1000;

export class LogSyncService {
  private intervalId: NodeJS.Timeout | null = null;
  private midnightTimeoutId: NodeJS.Timeout | null = null;
  private watchDebounceId: NodeJS.Timeout | null = null;
  private readonly watchers: fs.FSWatcher[] = [];
  private syncInFlight = false;
  private syncQueued = false;
  private parser: LogParser;

  constructor(
    private readonly repository: PromptRepository,
    private readonly context: vscode.ExtensionContext
  ) {
    this.parser = new LogParser();
  }

  start(): void {
    if (this.intervalId || this.midnightTimeoutId) {
      return;
    }

    this.setupWatchers();
    void this.requestSync();

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
      const { inserted: newPrompts, justCompletedSourceRefs } = this.parser.sync();

      for (const prompt of newPrompts) {
        await this.handleNewPrompt(prompt);
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
    let changed = false;

    for (const card of currentState.cards) {
      if (card.status !== 'active' || card.runtimeState !== 'running') continue;
      if (!card.sourceRef || card.sourceType === 'manual' || card.sourceType === 'cursor') continue;

      const sessionId = card.sourceType === 'codex'
        ? (card.sourceRef.includes(':') ? card.sourceRef.split(':')[0] : card.sourceRef)
        : card.sourceRef;

      const lastModMs = this.parser.getSessionLastModifiedMs(
        card.sourceType as 'claude-code' | 'codex' | 'roo-code',
        sessionId
      );
      if (lastModMs === undefined) continue;

      const lastModIso = new Date(lastModMs).toISOString();
      if (!card.lastActiveAt || lastModIso > card.lastActiveAt) {
        await this.repository.updateCardLastActiveAt(card.sourceRef, lastModIso);
        changed = true;
      }
    }

    if (changed) {
      await PrompterPanel.refresh(this.repository);
    }
  }

  private async handleNewPrompt(prompt: LogPrompt): Promise<void> {
    log(`[LogSyncService] 发现新 prompt: ${prompt.sessionId}`);

    const state = await this.repository.getState();
    await this.completeAwaitingSameSessionPrompts(state, prompt);

    // 创建卡片（传递原始日志时间戳，保证泳道排序准确）
    const card = await this.repository.saveImportedCard({
      title: prompt.userInput.slice(0, 50) + (prompt.userInput.length > 50 ? '...' : ''),
      content: prompt.userInput,
      // claude-code 的 project 字段是 URL 编码的路径（如 -Users-xxx-myproject），可读性差；
      // 统一使用 sessionId 作为分组名，每个对话 session 独立成组。
      // codex / roo-code 保留原来的 project || sessionId 逻辑。
      groupName: prompt.source === 'claude-code'
        ? prompt.sessionId
        : (prompt.project || prompt.sessionId),
      sourceType: prompt.source,
      sourceRef: prompt.sourceRef,
      status: prompt.status === 'running' ? 'active' : 'completed',
      runtimeState: prompt.status === 'running' ? 'running' : 'finished',
      createdAt: prompt.createdAt
    });

    // 刷新 webview
    await PrompterPanel.refresh(this.repository);

    // 发送通知
    if (prompt.status === 'running') {
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

  private async completeAwaitingSameSessionPrompts(
    state: Awaited<ReturnType<PromptRepository['getState']>>,
    prompt: LogPrompt
  ): Promise<void> {
    const completedAt = normalizeCompletionTimestamp(prompt.createdAt);

    for (const card of state.cards) {
      if (card.status !== 'active' || card.runtimeState !== 'running') {
        continue;
      }

      if (card.sourceType !== prompt.source) {
        continue;
      }

      if (resolveSessionId(card.sourceType, card.sourceRef) !== prompt.sessionId) {
        continue;
      }

      if (!isAwaitingConfirmation(card, completedAt)) {
        continue;
      }

      await this.repository.markCardCompletedFromLog(card.id, completedAt);
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

function isAwaitingConfirmation(
  card: Awaited<ReturnType<PromptRepository['getState']>>['cards'][number],
  completedAt: string
): boolean {
  const baselineMs = Date.parse(card.lastActiveAt ?? card.createdAt);
  const completedAtMs = Date.parse(completedAt);

  if (Number.isNaN(baselineMs) || Number.isNaN(completedAtMs)) {
    return false;
  }

  return completedAtMs - baselineMs >= AWAITING_CONFIRMATION_MS;
}
