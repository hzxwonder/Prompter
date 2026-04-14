import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { log, logError } from '../logger';
import { sanitizeImportedPromptContent, shouldDiscardImportedPromptContent } from '../shared/promptSanitization';

export interface LogPrompt {
  source: 'claude-code' | 'codex' | 'roo-code';
  sessionId: string;
  sourceRef: string;
  project: string | null;
  userInput: string;
  createdAt: string;
  status: 'running' | 'completed';
  justCompleted: boolean;
  completedAt?: string;
  completionKind?: 'completed' | 'aborted';
}

interface StoredPromptRecord {
  source: 'claude-code' | 'codex' | 'roo-code';
  sessionId: string;
  sourceRef: string;
  project: string | null;
  userInput: string;
  createdAt: string;
  status: 'running' | 'completed';
  justCompleted: boolean;
  completedAt?: string;
  completionKind?: 'completed' | 'aborted';
}

interface ParsedPromptRecord {
  source: LogPrompt['source'];
  sessionId: string;
  sourceRef: string;
  project: string | null;
  userInput: string;
  createdAt: string;
  completedAt?: string;
  completionKind?: 'completed' | 'aborted';
}

interface LogParserState {
  prompts: StoredPromptRecord[];
}

interface ClaudeTextContentItem {
  type?: string;
  text?: string;
}

interface ClaudeUserEvent {
  type?: string;
  userType?: string;
  isMeta?: boolean;
  sourceToolUseID?: string;
  message?: {
    role?: string;
    content?: ClaudeTextContentItem[];
  };
  timestamp?: string;
}

const CLAUDE_PROJECTS_DIR = path.join(homedir(), '.claude', 'projects');
const CODEX_SESSIONS_DIR = path.join(homedir(), '.codex', 'sessions');
const ROO_TASKS_DIR = path.join(
  homedir(),
  'Library',
  'Application Support',
  'Cursor',
  'User',
  'globalStorage',
  'rooveterinaryinc.roo-cline',
  'tasks'
);
const STATE_PATH = path.join(homedir(), 'prompter', 'logs-state.json');

function sanitizePrompt(text: string): string {
  return sanitizeImportedPromptContent(text);
}

export function isClaudeExternalUserPromptEvent(event: unknown): event is ClaudeUserEvent {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const candidate = event as ClaudeUserEvent;
  if (candidate.type !== 'user' || candidate.userType !== 'external') {
    return false;
  }

  // Skill bodies and similar tool-injected payloads are logged as synthetic
  // user events, but always carry meta/tool provenance.
  if (candidate.isMeta || candidate.sourceToolUseID) {
    return false;
  }

  return candidate.message?.role === 'user' && Array.isArray(candidate.message?.content);
}

export function extractClaudeUserText(event: unknown): string {
  if (!isClaudeExternalUserPromptEvent(event)) {
    return '';
  }

  const texts: string[] = [];
  for (const item of event.message?.content ?? []) {
    if (item?.type === 'text' && item.text) {
      texts.push(item.text);
    }
  }

  return sanitizePrompt(texts.join('\n'));
}

export { shouldDiscardImportedPromptContent } from '../shared/promptSanitization';

function sessionKey(source: LogPrompt['source'], sessionId: string): string {
  return `${source}:${sessionId}`;
}

function promptKey(source: LogPrompt['source'], sourceRef: string): string {
  return `${source}:${sourceRef}`;
}

function timestampsRoughlyMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftNormalized = left ? new Date(left).getTime() : NaN;
  const rightNormalized = right ? new Date(right).getTime() : NaN;
  if (Number.isNaN(leftNormalized) || Number.isNaN(rightNormalized)) {
    return normalizeLegacyTimestamp(left) === normalizeLegacyTimestamp(right);
  }
  return Math.abs(leftNormalized - rightNormalized) <= 2000;
}

function normalizeLegacyTimestamp(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const raw = String(ts).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    const date = new Date(raw.length >= 13 ? numeric : numeric * 1000);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString();
  }
  let normalized = raw.replace(/Z$/, '');
  if (normalized.includes('.')) {
    const parts = normalized.split('.');
    const ms = parts[1].slice(0, 3);
    normalized = `${parts[0]}.${ms}`;
  }
  return normalized;
}

export function extractCodexPromptRecords(
  lines: string[],
  sessionId: string,
  dateStr: string,
  ignoredTurnIds: Set<string> = new Set()
): ParsedPromptRecord[] {
  const prompts: ParsedPromptRecord[] = [];
  const turnStartById = new Map<string, string>();
  const taskCompletedAtByTurnId = new Map<string, string>();
  const completionKindByTurnId = new Map<string, 'completed' | 'aborted'>();
  const acceptedTurnIds = new Set<string>();
  let activeTurnId: string | null = null;

  const extractUserText = (text: string): string => {
    const marker = '## My request for Codex:';
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      return text.substring(idx + marker.length).trim().replace(/^:?\s*/, '');
    }

    const marker2 = '## My request for Codex';
    const idx2 = text.indexOf(marker2);
    if (idx2 !== -1) {
      return text.substring(idx2 + marker2.length).trim().replace(/^:?\s*/, '');
    }

    return text.trim();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);
      const eventType = event.type;
      const payload = event.payload || {};

      if (eventType === 'event_msg' && payload.type === 'task_started' && payload.turn_id) {
        const turnId = String(payload.turn_id);
        if (ignoredTurnIds.has(turnId)) {
          activeTurnId = null;
          continue;
        }

        activeTurnId = turnId;
        acceptedTurnIds.add(turnId);
        turnStartById.set(turnId, event.timestamp || dateStr);
        continue;
      }

      if (eventType === 'event_msg' && payload.type === 'task_complete' && payload.turn_id) {
        const turnId = String(payload.turn_id);
        if (ignoredTurnIds.has(turnId)) {
          continue;
        }
        if (!acceptedTurnIds.has(turnId)) {
          continue;
        }
        taskCompletedAtByTurnId.set(turnId, event.timestamp || dateStr);
        completionKindByTurnId.set(turnId, 'completed');
        continue;
      }

      if (eventType === 'event_msg' && payload.type === 'turn_aborted' && payload.turn_id) {
        const turnId = String(payload.turn_id);
        if (ignoredTurnIds.has(turnId)) {
          continue;
        }
        if (!acceptedTurnIds.has(turnId)) {
          continue;
        }
        taskCompletedAtByTurnId.set(turnId, event.timestamp || dateStr);
        completionKindByTurnId.set(turnId, 'aborted');
        continue;
      }

      if (eventType === 'event_msg' && payload.type === 'user_message') {
        const msg = payload.message || '';
        const userInput = sanitizePrompt(extractUserText(msg));
        if (userInput && activeTurnId && !ignoredTurnIds.has(activeTurnId)) {
          prompts.push({
            source: 'codex',
            sessionId,
            sourceRef: `${sessionId}:${activeTurnId}`,
            project: sessionId,
            userInput,
            createdAt: turnStartById.get(activeTurnId) || event.timestamp || dateStr,
            completedAt: taskCompletedAtByTurnId.get(activeTurnId),
            completionKind: completionKindByTurnId.get(activeTurnId)
          });
        }
        continue;
      }

      if (eventType === 'item.completed') {
        const item = event.item || {};
        if (item.type === 'message' && item.role === 'user') {
          const content = item.content || [];
          if (Array.isArray(content)) {
            const texts: string[] = [];
            for (const c of content) {
              if (c?.type === 'input_text' && c.text) {
                texts.push(c.text);
              }
            }
            const rawText = texts.join('\n');
            const userInput = sanitizePrompt(extractUserText(rawText));
            if (userInput) {
              const explicitTurnId =
                typeof item.turn_id === 'string'
                  ? item.turn_id
                  : typeof item.id === 'string'
                    ? item.id
                    : activeTurnId;
              const sourceTurnId = explicitTurnId || `message-${prompts.length + 1}`;
              if (ignoredTurnIds.has(sourceTurnId)) {
                continue;
              }
              if (explicitTurnId && !acceptedTurnIds.has(explicitTurnId)) {
                continue;
              }
              prompts.push({
                source: 'codex',
                sessionId,
                sourceRef: `${sessionId}:${sourceTurnId}`,
                project: sessionId,
                userInput,
                createdAt: event.timestamp || turnStartById.get(sourceTurnId) || dateStr,
                completedAt: taskCompletedAtByTurnId.get(sourceTurnId),
                completionKind: completionKindByTurnId.get(sourceTurnId)
              });
            }
          }
        }
      }
    } catch {
      // ignore line parse error
    }
  }

  return prompts.map((prompt) => ({
    ...prompt,
    completedAt: taskCompletedAtByTurnId.get(prompt.sourceRef.slice(sessionId.length + 1)) ?? prompt.completedAt,
    completionKind: completionKindByTurnId.get(prompt.sourceRef.slice(sessionId.length + 1)) ?? prompt.completionKind
  }));
}

export function resolvePromptStatuses(
  allPrompts: ParsedPromptRecord[],
  persistedPrompts: StoredPromptRecord[],
  runningSessions: Set<string>
): { inserted: LogPrompt[]; nextState: StoredPromptRecord[]; justCompletedSourceRefs: string[]; silentlyCompletedSourceRefs: string[] } {
  const buildPromptKey = (prompt: Pick<StoredPromptRecord, 'source' | 'sourceRef' | 'userInput' | 'createdAt'>): string => {
    if (prompt.source === 'roo-code') {
      return `${prompt.source}|${prompt.sourceRef}|${prompt.userInput}`;
    }
    return `${prompt.source}|${prompt.sourceRef}|${prompt.userInput}|${normalizeLegacyTimestamp(prompt.createdAt)}`;
  };

  const findMatchingScannedPrompt = (row: StoredPromptRecord): ParsedPromptRecord | undefined => {
    return allPrompts.find((prompt) => {
      if (prompt.source !== row.source || prompt.sessionId !== row.sessionId) {
        return false;
      }
      if (prompt.userInput !== row.userInput) {
        return false;
      }
      if (!timestampsRoughlyMatch(prompt.createdAt, row.createdAt)) {
        return false;
      }
      if (row.source === 'codex' && !String(row.sourceRef).includes(':')) {
        return String(prompt.sourceRef).startsWith(`${row.sessionId}:`);
      }
      return prompt.sourceRef === row.sourceRef;
    });
  };

  const mergedState = persistedPrompts.flatMap((row) => {
    const latest = findMatchingScannedPrompt(row);
    if (!latest) {
      return row.source === 'codex' ? [] : [row];
    }
    return [{
      ...row,
      sourceRef: latest.sourceRef,
      project: latest.project,
      userInput: latest.userInput,
      createdAt: latest.createdAt,
      completedAt: latest.completedAt ?? row.completedAt,
      completionKind: latest.completionKind ?? row.completionKind
    }];
  });

  const previouslyCompletedPromptKeys = new Set(
    mergedState
      .filter((row) => row.status === 'completed')
      .map((row) => promptKey(row.source, row.sourceRef))
  );
  const previouslyRunningPromptKeys = new Set(
    mergedState
      .filter((row) => row.status === 'running')
      .map((row) => promptKey(row.source, row.sourceRef))
  );
  const existing = new Set(mergedState.map((row) => buildPromptKey(row)));

  const previouslyRunningSessions = new Set(
    mergedState
      .filter((row) => row.status === 'running')
      .map((row) => sessionKey(row.source, row.sessionId))
  );
  const justCompletedSessions = [...previouslyRunningSessions].filter((key) => !runningSessions.has(key));

  const latestPromptKeyByRunningSession = new Map<string, string>();
  for (const prompt of allPrompts) {
    const sessionRunningKey = sessionKey(prompt.source, prompt.sessionId);
    const promptRunningKey = promptKey(prompt.source, prompt.sourceRef);
    const isCodexRunningCandidate = prompt.source === 'codex' && !prompt.completedAt;
    // For claude-code: only consider it running if session is active AND no completion marker found
    const isClaudeCodeRunningCandidate = prompt.source === 'claude-code' && runningSessions.has(sessionRunningKey) && !prompt.completedAt;
    const isOtherRunningCandidate = prompt.source !== 'codex' && prompt.source !== 'claude-code' && runningSessions.has(sessionRunningKey);
    if (!isCodexRunningCandidate && !isClaudeCodeRunningCandidate && !isOtherRunningCandidate) {
      continue;
    }
    const existingLatest = latestPromptKeyByRunningSession.get(sessionRunningKey);
    if (!existingLatest) {
      latestPromptKeyByRunningSession.set(sessionRunningKey, promptRunningKey);
      continue;
    }
    const existingPrompt = allPrompts.find((p) => promptKey(p.source, p.sourceRef) === existingLatest);
    if ((existingPrompt?.createdAt ?? '') <= prompt.createdAt) {
      latestPromptKeyByRunningSession.set(sessionRunningKey, promptRunningKey);
    }
  }

  const inserted: LogPrompt[] = [];
  const appendedState: StoredPromptRecord[] = [...mergedState];
  for (const prompt of allPrompts) {
    const recordKey = buildPromptKey({
      source: prompt.source,
      sourceRef: prompt.sourceRef,
      userInput: prompt.userInput,
      createdAt: prompt.createdAt
    });
    if (existing.has(recordKey)) {
      continue;
    }
    const sessionRunningKey = sessionKey(prompt.source, prompt.sessionId);
    const recordRunningKey = promptKey(prompt.source, prompt.sourceRef);
    const isRunning = latestPromptKeyByRunningSession.get(sessionRunningKey) === recordRunningKey;
    const status: LogPrompt['status'] = isRunning ? 'running' : 'completed';
    const record: StoredPromptRecord = {
      ...prompt,
      status,
      justCompleted: false
    };
    appendedState.push(record);
    inserted.push(record);
    existing.add(recordKey);
  }

  const nextState = appendedState.map((row) => {
    const sessionRunningKey = sessionKey(row.source, row.sessionId);
    const rowRunningKey = promptKey(row.source, row.sourceRef);
    // completedAt is the authoritative completion signal (e.g. stop_reason=end_turn).
    // Only fall back to session-level latest-prompt logic when no per-prompt marker exists.
    const nextStatus: StoredPromptRecord['status'] =
      row.completedAt
        ? 'completed'
        : (latestPromptKeyByRunningSession.get(sessionRunningKey) === rowRunningKey ? 'running' : 'completed');
    const justCompleted =
      row.status === 'running' &&
      nextStatus === 'completed' &&
      row.completionKind !== 'aborted' &&
      !previouslyCompletedPromptKeys.has(promptKey(row.source, row.sourceRef)) &&
      (row.source === 'codex'
        ? true
        : (justCompletedSessions.includes(sessionRunningKey) ||
           previouslyRunningPromptKeys.has(promptKey(row.source, row.sourceRef))));
    return {
      ...row,
      status: nextStatus,
      justCompleted
    };
  });

  const justCompletedSourceRefs = nextState
    .filter((row) => row.justCompleted && (row.source !== 'codex' || previouslyRunningPromptKeys.has(promptKey(row.source, row.sourceRef))))
    .map((row) => row.sourceRef);

  const silentlyCompletedSourceRefs = nextState
    .filter(
      (row) =>
        row.status === 'completed' &&
        row.completionKind === 'aborted' &&
        row.source === 'codex' &&
        previouslyRunningPromptKeys.has(promptKey(row.source, row.sourceRef))
    )
    .map((row) => row.sourceRef);

  return { inserted, nextState, justCompletedSourceRefs, silentlyCompletedSourceRefs };
}

export class LogParser {
  private state: LogParserState;
  private sessionLastModified = new Map<string, number>();

  constructor() {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    this.state = this.loadState();
    log('LogParser initialized');
  }

  getSessionLastModifiedMs(source: LogPrompt['source'], sid: string): number | undefined {
    return this.sessionLastModified.get(sessionKey(source, sid));
  }

  private loadState(): LogParserState {
    try {
      const raw = fs.readFileSync(STATE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as LogParserState;
      const prompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];
      return {
        prompts: prompts
          .filter((row) => !shouldDiscardImportedPromptContent(row.userInput))
          .map((row) => ({
            ...row,
            sourceRef: typeof row.sourceRef === 'string' && row.sourceRef ? row.sourceRef : row.sessionId
          }))
      };
    } catch {
      return { prompts: [] };
    }
  }

  private saveState(): void {
    fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  private extractClaudePrompts(filePath: string): ParsedPromptRecord[] {
    const prompts: ParsedPromptRecord[] = [];
    const sessionId = path.basename(filePath, '.jsonl');
    const project = path.basename(path.dirname(filePath));

    try {
      const stat = fs.statSync(filePath);
      this.sessionLastModified.set(sessionKey('claude-code', sessionId), stat.mtimeMs);

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          // Detect assistant completion: stop_reason === "end_turn"
          // stop_reason lives inside event.message (not at top level)
          const stopReason = event.message?.stop_reason ?? event.stop_reason;
          if (stopReason === 'end_turn' && prompts.length > 0) {
            const lastPrompt = prompts[prompts.length - 1];
            if (!lastPrompt.completedAt) {
              lastPrompt.completedAt = event.timestamp ?? new Date().toISOString();
            }
            continue;
          }

          if (isClaudeExternalUserPromptEvent(event)) {
            const rawText = extractClaudeUserText(event);

            // Detect user interruption: [Request interrupted by user]
            const rawContent = event.message?.content;
            const firstText = Array.isArray(rawContent) ? rawContent.find((c: ClaudeTextContentItem) => c?.type === 'text')?.text ?? '' : '';
            if (firstText.trim() === '[Request interrupted by user]') {
              if (prompts.length > 0) {
                const lastPrompt = prompts[prompts.length - 1];
                if (!lastPrompt.completedAt) {
                  lastPrompt.completedAt = event.timestamp ?? new Date().toISOString();
                }
              }
              continue;
            }

            if (rawText) {
              prompts.push({
                source: 'claude-code',
                sessionId,
                sourceRef: sessionId,
                project,
                userInput: rawText,
                createdAt: event.timestamp ?? ''
              });
            }
          }
        } catch {
          // ignore line parse error
        }
      }
    } catch (error) {
      logError(`解析文件失败 ${filePath}`, error);
    }

    return prompts;
  }

  private extractCodexPrompts(filePath: string): ParsedPromptRecord[] {
    return this.extractCodexPromptsFromFile(filePath, new Map(), new Set());
  }

  private readCodexSessionMeta(lines: string[], sessionId: string): { ownId: string | null; forkedFromId: string | null } {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        const payload = event?.payload ?? {};
        if (event?.type !== 'session_meta' || typeof payload.id !== 'string') {
          continue;
        }
        if (!sessionId.endsWith(payload.id)) {
          continue;
        }

        return {
          ownId: payload.id,
          forkedFromId: typeof payload.forked_from_id === 'string' ? payload.forked_from_id : null
        };
      } catch {
        // ignore line parse error
      }
    }

    return { ownId: null, forkedFromId: null };
  }

  private extractTurnIdFromSourceRef(sessionId: string, sourceRef: string): string | null {
    const prefix = `${sessionId}:`;
    if (!sourceRef.startsWith(prefix)) {
      return null;
    }
    return sourceRef.slice(prefix.length) || null;
  }

  private extractCodexPromptsFromFile(
    filePath: string,
    sessionFileById: Map<string, string>,
    visitedSessionIds: Set<string>
  ): ParsedPromptRecord[] {
    const sessionId = path.basename(filePath, '.jsonl');
    if (visitedSessionIds.has(sessionId)) {
      return [];
    }
    visitedSessionIds.add(sessionId);

    const parts = filePath.split(path.sep);
    const dateStr = parts.length >= 4 ? `${parts[parts.length - 4]}-${parts[parts.length - 3]}-${parts[parts.length - 2]}` : new Date().toISOString();

    try {
      const stat = fs.statSync(filePath);
      this.sessionLastModified.set(sessionKey('codex', sessionId), stat.mtimeMs);

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const { ownId, forkedFromId } = this.readCodexSessionMeta(lines, sessionId);
      const ignoredTurnIds = new Set<string>();

      if (ownId) {
        sessionFileById.set(ownId, filePath);
      }

      if (forkedFromId) {
        const parentPath = sessionFileById.get(forkedFromId);
        if (parentPath && parentPath !== filePath) {
          const parentPrompts = this.extractCodexPromptsFromFile(parentPath, sessionFileById, visitedSessionIds);
          for (const prompt of parentPrompts) {
            const turnId = this.extractTurnIdFromSourceRef(prompt.sessionId, prompt.sourceRef);
            if (turnId) {
              ignoredTurnIds.add(turnId);
            }
          }
        }
      }

      return extractCodexPromptRecords(lines, sessionId, dateStr, ignoredTurnIds);
    } catch (error) {
      logError(`解析文件失败 ${filePath}`, error);
    }

    return [];
  }

  private extractRooPrompts(taskDir: string): ParsedPromptRecord[] {
    const prompts: ParsedPromptRecord[] = [];
    const sessionId = path.basename(taskDir);
    const uiMessagesPath = path.join(taskDir, 'ui_messages.json');
    const historyPath = path.join(taskDir, 'history_item.json');

    try {
      const taskStat = fs.statSync(taskDir);
      this.sessionLastModified.set(sessionKey('roo-code', sessionId), taskStat.mtimeMs);

      if (fs.existsSync(uiMessagesPath)) {
        const messages = JSON.parse(fs.readFileSync(uiMessagesPath, 'utf-8'));
        if (Array.isArray(messages)) {
          for (const message of messages) {
            const text = typeof message?.text === 'string' ? sanitizePrompt(message.text) : '';
            if (!text) continue;
            if (message?.type === 'say' && (message.say === 'text' || message.say === 'user_feedback')) {
              prompts.push({
                source: 'roo-code',
                sessionId,
                sourceRef: sessionId,
                project: null,
                userInput: text,
                createdAt: String(message.ts ?? '')
              });
            }
          }
        }
      }

      if (prompts.length === 0 && fs.existsSync(historyPath)) {
        const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        const text = typeof history?.task === 'string' ? sanitizePrompt(history.task) : '';
        if (text) {
          prompts.push({
            source: 'roo-code',
            sessionId,
            sourceRef: sessionId,
            project: history?.workspace ? path.basename(String(history.workspace)) : null,
            userInput: text,
            createdAt: String(history?.ts ?? '')
          });
        }
      }
    } catch (error) {
      logError(`解析 Roo 任务失败 ${taskDir}`, error);
    }

    return prompts;
  }

  private scanRooLogs(): ParsedPromptRecord[] {
    if (!fs.existsSync(ROO_TASKS_DIR)) {
      log(`Roo Code 日志目录不存在: ${ROO_TASKS_DIR}`);
      return [];
    }

    const allPrompts: ParsedPromptRecord[] = [];

    try {
      const entries = fs.readdirSync(ROO_TASKS_DIR);
      for (const entry of entries) {
        const taskDir = path.join(ROO_TASKS_DIR, entry);
        if (!fs.statSync(taskDir).isDirectory()) continue;
        allPrompts.push(...this.extractRooPrompts(taskDir));
      }
    } catch (error) {
      logError('扫描 Roo 日志失败', error);
    }

    return allPrompts;
  }

  private scanClaudeLogs(): ParsedPromptRecord[] {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      log(`Claude Code 日志目录不存在: ${CLAUDE_PROJECTS_DIR}`);
      return [];
    }

    const allPrompts: ParsedPromptRecord[] = [];

    try {
      const projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
      for (const project of projects) {
        const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
        const stat = fs.statSync(projectDir);
        if (!stat.isDirectory()) continue;

        const files = fs.readdirSync(projectDir);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = path.join(projectDir, file);
            const prompts = this.extractClaudePrompts(filePath);
            allPrompts.push(...prompts);
          }
        }
      }
    } catch (error) {
      logError('扫描 Claude 日志失败', error);
    }

    return allPrompts;
  }

  private scanCodexLogs(): ParsedPromptRecord[] {
    if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
      log(`Codex 日志目录不存在: ${CODEX_SESSIONS_DIR}`);
      return [];
    }

    const allPrompts: ParsedPromptRecord[] = [];
    const filePaths: string[] = [];
    const sessionFileById = new Map<string, string>();

    const scanDir = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.endsWith('.jsonl')) {
            filePaths.push(fullPath);
          }
        }
      } catch (error) {
        logError(`扫描目录失败 ${dir}`, error);
      }
    };

    scanDir(CODEX_SESSIONS_DIR);

    for (const filePath of filePaths) {
      try {
        const sessionId = path.basename(filePath, '.jsonl');
        const content = fs.readFileSync(filePath, 'utf-8');
        const { ownId } = this.readCodexSessionMeta(content.split('\n'), sessionId);
        if (ownId) {
          sessionFileById.set(ownId, filePath);
        }
      } catch (error) {
        logError(`建立 Codex session 索引失败 ${filePath}`, error);
      }
    }

    for (const filePath of filePaths) {
      const prompts = this.extractCodexPromptsFromFile(filePath, sessionFileById, new Set());
      allPrompts.push(...prompts);
    }

    return allPrompts;
  }

  private getRunningSessions(): Set<string> {
    const running = new Set<string>();
    const sessionEnvDir = path.join(homedir(), '.claude', 'session-env');
    // 扩展到 60 分钟：只要一小时内有过活动，就认为可能还在运行
    const sixtyMinutesAgo = Date.now() - 60 * 60 * 1000;

    if (fs.existsSync(sessionEnvDir)) {
      try {
        const files = fs.readdirSync(sessionEnvDir);
        for (const file of files) {
          const fullPath = path.join(sessionEnvDir, file);

          // 兼容当前本机结构：目录项名称本身就是 sessionId（无 .json 后缀）
          if (!file.endsWith('.json')) {
            running.add(sessionKey('claude-code', file));
            continue;
          }

          // 兼容旧结构：json 文件中存储真实 sessionId
          try {
            const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
            const sessionId =
              (content['sessionId'] as string | undefined) ??
              (content['session_id'] as string | undefined) ??
              (content['id'] as string | undefined) ??
              (content['CLAUDE_SESSION_ID'] as string | undefined) ??
              path.basename(file, '.json');
            if (sessionId) {
              running.add(sessionKey('claude-code', sessionId));
            }
          } catch {
            // 无法解析 JSON，退回使用文件名
            running.add(sessionKey('claude-code', path.basename(file, '.json')));
          }
        }
      } catch (error) {
        logError('获取 Claude 运行中 session 失败', error);
      }
    }

    const addRecentlyModifiedSessions = (rootDir: string, source: LogPrompt['source']): void => {
      if (!fs.existsSync(rootDir)) {
        return;
      }

      const scanDir = (dir: string): void => {
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            let stat: fs.Stats;
            try {
              stat = fs.statSync(fullPath);
            } catch {
              continue;
            }

            if (stat.isDirectory()) {
              if (source === 'roo-code' && stat.mtimeMs > sixtyMinutesAgo) {
                running.add(sessionKey(source, path.basename(fullPath)));
              }
              scanDir(fullPath);
              continue;
            }

            if (entry.endsWith('.jsonl') && stat.mtimeMs > sixtyMinutesAgo) {
              running.add(sessionKey(source, path.basename(entry, '.jsonl')));
            }
          }
        } catch (error) {
          logError(`扫描运行中 session 失败 ${dir}`, error);
        }
      };

      scanDir(rootDir);
    };

    try {
      addRecentlyModifiedSessions(CLAUDE_PROJECTS_DIR, 'claude-code');
      addRecentlyModifiedSessions(CODEX_SESSIONS_DIR, 'codex');
      addRecentlyModifiedSessions(ROO_TASKS_DIR, 'roo-code');
    } catch (error) {
      logError('备用 session 检测失败', error);
    }
    return running;
  }

  private normalizeTimestamp(ts: string | null): string | null {
    if (!ts) return null;

    const raw = String(ts).trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      const date = new Date(raw.length >= 13 ? numeric : numeric * 1000);
      return Number.isNaN(date.getTime()) ? raw : date.toISOString();
    }

    let normalized = raw.replace(/Z$/, '');
    if (normalized.includes('.')) {
      const parts = normalized.split('.');
      const ms = parts[1].slice(0, 3);
      normalized = `${parts[0]}.${ms}`;
    }
    return normalized;
  }

  private promptKey(prompt: Pick<StoredPromptRecord, 'source' | 'sourceRef' | 'userInput' | 'createdAt'>): string {
    if (prompt.source === 'roo-code') {
      return `${prompt.source}|${prompt.sourceRef}|${prompt.userInput}`;
    }

    return `${prompt.source}|${prompt.sourceRef}|${prompt.userInput}|${this.normalizeTimestamp(prompt.createdAt)}`;
  }

  sync(): { inserted: LogPrompt[]; justCompletedSourceRefs: string[]; silentlyCompletedSourceRefs: string[] } {
    const allPrompts = [...this.scanClaudeLogs(), ...this.scanCodexLogs(), ...this.scanRooLogs()];
    const runningSessions = this.getRunningSessions();
    const { inserted, nextState, justCompletedSourceRefs, silentlyCompletedSourceRefs } = resolvePromptStatuses(
      allPrompts,
      this.state.prompts,
      runningSessions
    );
    this.state.prompts = nextState;
    this.saveState();
    log(`保存 ${inserted.length} 条 prompt 到状态文件`);
    return {
      inserted,
      justCompletedSourceRefs,
      silentlyCompletedSourceRefs
    };
  }

  getAllPrompts(): LogPrompt[] {
    return [...this.state.prompts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  clearJustCompleted(): void {
    this.state.prompts = this.state.prompts.map((row) => ({ ...row, justCompleted: false }));
    this.saveState();
  }

  close(): void {
    this.saveState();
  }
}
