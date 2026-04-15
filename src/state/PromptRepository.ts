import { randomUUID } from 'node:crypto';
import {
  createInitialHistoryImportState,
  createInitialState,
  type DailyStats,
  type FileRef,
  type HistoryImportEntry,
  type HistoryImportState,
  type ModularPrompt,
  type PromptCard,
  type PromptRuntimeState,
  type PromptSourceType,
  type PromptStatus,
  type PrompterCommandId,
  type PrompterState,
  toDateBucket
} from '../shared/models';
import {
  normalizePromptForMatching,
  sanitizeImportedPromptContent,
  shouldDiscardImportedPromptContent
} from '../shared/promptSanitization';
import { FileStore } from './FileStore';

// ─── Group colour palette ────────────────────────────────────────────────────
// 16 carefully chosen colours that look good in both dark and light themes.
const GROUP_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#0ea5e9', // sky
  '#84cc16', // lime
  '#f59e0b', // amber
  '#ef4444', // red
];

/** Deterministically pick a colour from the palette based on the group name. */
function groupColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

function buildSessionGroupId(sourceType: PromptSourceType, sourceRef?: string): string | undefined {
  return sourceRef ? `${sourceType}:${sourceRef}` : undefined;
}

interface SessionGroupEntry {
  groupName: string;
  updatedAt: string;
}

type SessionGroupMap = Record<string, SessionGroupEntry>;

function buildImportedGroupId(
  sourceType: PromptSourceType,
  sourceRef: string | undefined,
  groupName: string
): string {
  return buildImportedSessionKey(sourceType, sourceRef) ?? buildSessionGroupId(sourceType, sourceRef) ?? randomUUID();
}

function resolveImportedSessionId(sourceType: PromptSourceType, sourceRef?: string): string | undefined {
  if (!sourceRef) {
    return undefined;
  }

  if (sourceType === 'codex') {
    return sourceRef.includes(':') ? sourceRef.split(':')[0] : sourceRef;
  }

  if (sourceType === 'claude-code' || sourceType === 'roo-code') {
    return sourceRef;
  }

  return undefined;
}

function buildImportedSessionKey(sourceType: PromptSourceType, sourceRef?: string): string | undefined {
  const sessionId = resolveImportedSessionId(sourceType, sourceRef);
  return sessionId ? `${sourceType}:${sessionId}` : undefined;
}

function findExistingSessionGroup(
  cards: PromptCard[],
  sourceType: PromptSourceType,
  sourceRef?: string
): { groupId: string; groupName: string } | undefined {
  const sessionKey = buildImportedSessionKey(sourceType, sourceRef);
  if (!sessionKey) {
    return undefined;
  }

  return cards.find((card) => {
    if (card.sourceType !== sourceType) {
      return false;
    }

    return buildImportedSessionKey(card.sourceType, card.sourceRef) === sessionKey;
  });
}

function isImportedSessionCard(card: PromptCard): boolean {
  return card.sourceType === 'claude-code' || card.sourceType === 'codex' || card.sourceType === 'roo-code';
}

function getFallbackGroupName(
  sourceType: PromptSourceType,
  sourceRef?: string,
  groupName?: string | null
): string {
  const trimmedGroupName = groupName?.trim();

  // Claude Code 将项目路径中的 '/' 替换为 '-' 作为目录名（如 -Users-xxx-myproject）。
  // 这类自动生成的路径编码名以 '-' 开头，可读性差。
  // 若检测到此模式，且 sourceRef（即 session id）可用，则改用 session id 作为分组名。
  // 这同时覆盖"迁移旧卡片"的场景：load() 时会调用此函数，自动将存量卡片的分组名更新过来。
  if (sourceType === 'claude-code' && sourceRef && trimmedGroupName?.startsWith('-')) {
    return sourceRef;
  }

  if (trimmedGroupName && trimmedGroupName !== '未分类') {
    return trimmedGroupName;
  }

  if ((sourceType === 'codex' || sourceType === 'roo-code') && sourceRef) {
    return sourceRef;
  }

  return trimmedGroupName || '未分类';
}


interface SaveDraftInput {
  title: string;
  content: string;
  sourceType: PromptSourceType;
  fileRefs: FileRef[];
  groupName?: string;
}

interface UpdateCardInput {
  title?: string;
  content: string;
  fileRefs: FileRef[];
}

interface UpdateSettingsInput extends Partial<PrompterState['settings']> {}

type PersistedShortcutSettings = Partial<Record<PrompterCommandId, Partial<PrompterState['settings']['shortcuts'][PrompterCommandId]>>>;
type LegacyHistoryImportPhase = 'idle' | 'scanning-today' | 'scanning-history' | 'complete';
type PersistedHistoryImportState = Partial<HistoryImportState> & { phase?: LegacyHistoryImportPhase };

function normalizeSettings(
  settings: Partial<PrompterState['settings']> | undefined,
  fallback: PrompterState['settings']
): { settings: PrompterState['settings']; shortcutsMigrated: boolean } {
  const normalizeShortcuts = (
    nextShortcuts: PersistedShortcutSettings | undefined,
    fallbackShortcuts: PrompterState['settings']['shortcuts']
  ): { shortcuts: PrompterState['settings']['shortcuts']; migrated: boolean } => {
    const normalized = {} as PrompterState['settings']['shortcuts'];
    let migrated = !nextShortcuts;
    const shouldResetToCurrentDefaults = Object.entries(fallbackShortcuts).some(([command, fallbackShortcut]) => {
      const persistedShortcut = nextShortcuts?.[command as PrompterCommandId];
      return persistedShortcut?.defaultKeybinding?.trim() !== fallbackShortcut.defaultKeybinding;
    });

    for (const [command, fallbackShortcut] of Object.entries(fallbackShortcuts) as [
      PrompterCommandId,
      PrompterState['settings']['shortcuts'][PrompterCommandId]
    ][]) {
      const shortcutId = command as PrompterCommandId;
      const nextShortcut = nextShortcuts?.[command];
      if (shouldResetToCurrentDefaults) {
        normalized[shortcutId] = { ...fallbackShortcut };
        migrated = true;
        continue;
      }
      const hasRequiredMetadata =
        !!nextShortcut &&
        !!nextShortcut.command?.trim() &&
        !!nextShortcut.label?.trim() &&
        !!nextShortcut.description?.trim() &&
        !!nextShortcut.defaultKeybinding?.trim() &&
        !!nextShortcut.keybinding?.trim();

      normalized[shortcutId] = {
        ...fallbackShortcut,
        ...(nextShortcut ?? {}),
        command: shortcutId,
        label: nextShortcut?.label?.trim() || fallbackShortcut.label,
        description: nextShortcut?.description?.trim() || fallbackShortcut.description,
        keybinding: nextShortcut?.keybinding?.trim() || fallbackShortcut.keybinding,
        defaultKeybinding: nextShortcut?.defaultKeybinding?.trim() || fallbackShortcut.defaultKeybinding
      };

      if (!hasRequiredMetadata) {
        migrated = true;
      }
    }

    return { shortcuts: normalized, migrated };
  };

  const shortcuts = normalizeShortcuts(settings?.shortcuts as PersistedShortcutSettings | undefined, fallback.shortcuts);

    return {
      settings: {
      ...fallback,
      ...settings,
        logSources: {
          ...fallback.logSources,
          ...settings?.logSources,
          'claude-code': {
            ...fallback.logSources['claude-code'],
            ...settings?.logSources?.['claude-code']
          },
          codex: {
            ...fallback.logSources.codex,
            ...settings?.logSources?.codex
          },
          'roo-code': {
            ...fallback.logSources['roo-code'],
            ...settings?.logSources?.['roo-code']
          }
        },
      shortcuts: shortcuts.shortcuts
      },
    shortcutsMigrated: shortcuts.migrated
  };
}

function isHistoryImportEntry(value: unknown): value is HistoryImportEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    (entry.sourceType === 'claude-code' || entry.sourceType === 'codex' || entry.sourceType === 'roo-code') &&
    typeof entry.filePath === 'string' &&
    typeof entry.dateBucket === 'string' &&
    (typeof entry.lastModifiedMs === 'number' || typeof entry.lastModifiedMs === 'undefined')
  );
}

function normalizeHistoryImport(
  historyImport: PersistedHistoryImportState | undefined,
  fallback: HistoryImportState
): { historyImport: HistoryImportState; migrated: boolean } {
  const legacyPhase = historyImport?.phase;
  const pendingEntries = Array.isArray(historyImport?.pendingEntries)
    ? historyImport.pendingEntries
        .filter(isHistoryImportEntry)
        .map((entry) => ({
          ...entry,
          lastModifiedMs: typeof entry.lastModifiedMs === 'number' ? entry.lastModifiedMs : 0
        }))
    : fallback.pendingEntries;
  const completedEntries = Array.isArray(historyImport?.completedEntries)
    ? historyImport.completedEntries.filter((entry): entry is string => typeof entry === 'string')
    : fallback.completedEntries;
  const completedEntryMtims = historyImport?.completedEntryMtims && typeof historyImport.completedEntryMtims === 'object'
    ? Object.fromEntries(
        Object.entries(historyImport.completedEntryMtims).filter((entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number'
        )
      )
    : fallback.completedEntryMtims ?? {};

  let scope = historyImport?.scope;
  if (!scope) {
    if (legacyPhase === 'scanning-today') {
      scope = 'today-bootstrap';
    } else if (legacyPhase === 'scanning-history' || legacyPhase === 'complete') {
      scope = 'history-backfill';
    } else {
      scope = fallback.scope;
    }
  }

  let status = historyImport?.status;
  if (!status) {
    if (legacyPhase === 'complete') {
      status = 'complete';
    } else if (legacyPhase === 'scanning-today' || legacyPhase === 'scanning-history') {
      status = 'running';
    } else {
      status = fallback.status;
    }
  }

  const normalized: HistoryImportState = {
    scope,
    status,
    processedPrompts: historyImport?.processedPrompts ?? fallback.processedPrompts,
    totalPrompts: historyImport?.totalPrompts,
    processedSources: historyImport?.processedSources ?? fallback.processedSources,
    totalSources: historyImport?.totalSources ?? fallback.totalSources,
    foregroundReady: historyImport?.foregroundReady ?? fallback.foregroundReady,
    warningAcknowledged: historyImport?.warningAcknowledged ?? fallback.warningAcknowledged,
    pendingEntries,
    completedEntries,
    completedEntryMtims,
    lastError: historyImport?.lastError
  };

  const migrated =
    !!historyImport &&
    (
      typeof legacyPhase !== 'undefined' ||
      !historyImport.scope ||
      !historyImport.status ||
      typeof historyImport.warningAcknowledged !== 'boolean' ||
      !Array.isArray(historyImport.pendingEntries) ||
      !Array.isArray(historyImport.completedEntries) ||
      pendingEntries.length !== (historyImport.pendingEntries?.length ?? 0) ||
      completedEntries.length !== (historyImport.completedEntries?.length ?? 0) ||
      pendingEntries.some((entry) => entry.lastModifiedMs === 0) ||
      typeof historyImport.completedEntryMtims !== 'object'
    );

  return { historyImport: normalized, migrated };
}

interface SaveImportedCardInput {
  title: string;
  content: string;
  groupName: string;
  sourceType: PromptSourceType;
  sourceRef?: string;
  status: PromptStatus;
  runtimeState: PromptRuntimeState;
  /** 原始日志时间戳；未提供时使用当前时间 */
  createdAt?: string;
}

interface SaveImportedCardOptions {
  persist?: boolean;
  rebuildStats?: boolean;
}

interface SaveModularPromptInput {
  id?: string;
  name: string;
  content: string;
  category: string;
}

/** Normalise any timestamp format to ISO-8601 string for consistent sorting. */
function normalizeTs(ts: string): string {
  const raw = ts.trim();
  if (!raw) return new Date().toISOString();
  // 纯数字（毫秒或秒时间戳）
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return new Date(raw.length >= 13 ? n : n * 1000).toISOString();
  }
  // 已经是 ISO 格式
  return raw.endsWith('Z') ? raw : `${raw}Z`;
}

function timestampsRoughlyMatch(left: string, right: string): boolean {
  const leftMs = new Date(normalizeTs(left)).getTime();
  const rightMs = new Date(normalizeTs(right)).getTime();
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return normalizeTs(left) === normalizeTs(right);
  }
  return Math.abs(leftMs - rightMs) <= 2000;
}

function findReusableUnusedCardIndex(cards: PromptCard[], content: string): number {
  const normalizedContent = normalizePromptForMatching(content);

  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    if (card.status !== 'unused' || card.sourceType !== 'manual') {
      continue;
    }

    if (normalizePromptForMatching(card.content) === normalizedContent) {
      return index;
    }
  }

  return -1;
}

function isLegacyCodexSessionRef(sourceType: PromptSourceType, sourceRef?: string): boolean {
  return sourceType === 'codex' && Boolean(sourceRef) && !String(sourceRef).includes(':');
}

export class PromptRepository {
  static async create(
    dataDir: string,
    now: () => string = () => new Date().toISOString()
  ): Promise<PromptRepository> {
    const repo = new PromptRepository(new FileStore(dataDir), now);
    await repo.load();
    return repo;
  }

  private state: PrompterState;
  private sessionGroups: SessionGroupMap = {};

  private constructor(
    private readonly store: FileStore,
    private readonly now: () => string
  ) {
    this.state = createInitialState(this.now());
  }

  async load(): Promise<void> {
    const defaultSettings = createInitialState(this.now()).settings;
    const defaultHistoryImport = createInitialHistoryImportState();
    const [cards, modularPrompts, settings, sessionGroups, persistedHistoryImport] = await Promise.all([
      this.store.readJson<PromptCard[]>('cards.json', []),
      this.store.readJson('modular-prompts.json', []),
      this.store.readJson<Partial<PrompterState['settings']>>('settings.json', defaultSettings),
      this.store.readJson<SessionGroupMap>('session-groups.json', {}),
      this.store.readJson<PersistedHistoryImportState>('history-import.json', defaultHistoryImport)
    ]);

    // ── 迁移：修正 groupName / groupId，同时移除系统自动生成的消息卡片 ──
    let needsPersist = false;
    const normalizedSettings = normalizeSettings(settings, defaultSettings);
    needsPersist = normalizedSettings.shortcutsMigrated;
    const normalizedHistoryImport = normalizeHistoryImport(persistedHistoryImport, defaultHistoryImport);
    needsPersist = needsPersist || normalizedHistoryImport.migrated;

    const normalizedSessionGroups = { ...sessionGroups };
    const cardsByNewest = [...(cards as PromptCard[])].sort((left, right) =>
      (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
    );

    for (const card of cardsByNewest) {
      const sessionKey = buildImportedSessionKey(card.sourceType, card.sourceRef);
      if (!sessionKey) {
        continue;
      }
      if (!normalizedSessionGroups[sessionKey]) {
        normalizedSessionGroups[sessionKey] = {
          groupName: getFallbackGroupName(card.sourceType, card.sourceRef, card.groupName),
          updatedAt: card.updatedAt || card.createdAt
        };
        needsPersist = true;
      }
    }

    const migratedCards = (cards as PromptCard[])
      .filter((c) => {
        const sanitizedContent = c.sourceType === 'manual' ? c.content : sanitizeImportedPromptContent(c.content);

        // 移除内容完全是系统自动消息或工具注入技能正文的卡片
        if (c.sourceType !== 'manual' && shouldDiscardImportedPromptContent(c.content)) {
          needsPersist = true;
          return false;
        }
        return true;
      })
      .map((c) => {
        const sanitizedContent = c.sourceType === 'manual' ? c.content : sanitizeImportedPromptContent(c.content);
        const sessionKey = buildImportedSessionKey(c.sourceType, c.sourceRef);
        const normalizedGroupName = sessionKey
          ? (normalizedSessionGroups[sessionKey]?.groupName ?? getFallbackGroupName(c.sourceType, c.sourceRef, c.groupName))
          : getFallbackGroupName(c.sourceType, c.sourceRef, c.groupName);
        let groupId = c.groupId;
        const sessionGroupId = buildSessionGroupId(c.sourceType, c.sourceRef);
        if (sessionKey) {
          groupId = sessionKey;
        } else if (sessionGroupId && (groupId === c.groupName || groupId === c.sourceRef)) {
          groupId = sessionGroupId;
        } else if (groupId === c.groupName) {
          groupId = c.id;
        }
        // 检测本次是否有迁移变化，有则标记需持久化
        if (normalizedGroupName !== c.groupName || groupId !== c.groupId || sanitizedContent !== c.content) {
          needsPersist = true;
        }
        return {
          ...c,
          content: sanitizedContent,
          groupId,
          groupName: normalizedGroupName,
          groupColor: groupColor(normalizedGroupName)
        };
      });

    this.state = {
      ...createInitialState(this.now()),
      cards: migratedCards,
      modularPrompts,
      dailyStats: rebuildDailyStats(migratedCards),
      historyImport: normalizedHistoryImport.historyImport,
      settings: normalizedSettings.settings
    };
    this.sessionGroups = normalizedSessionGroups;

    // ── 清理未使用分区的重复卡片（按内容去重，保留最新创建的一条） ──
    const unusedContentSeen = new Set<string>();
    const deduped = this.state.cards.filter((card) => {
      if (card.status !== 'unused') return true;
      if (unusedContentSeen.has(card.content)) return false;
      unusedContentSeen.add(card.content);
      return true;
    });
    if (deduped.length < this.state.cards.length) {
      this.state.cards = deduped;
      this.state.dailyStats = rebuildDailyStats(this.state.cards);
      needsPersist = true;
    }

    // ── 若有任何迁移或清理，将结果持久化到磁盘 ──
    if (needsPersist) {
      await this.persist();
    }
  }

  async getState(): Promise<PrompterState> {
    return structuredClone(this.state);
  }

  async setHistoryImport(historyImport: Partial<PrompterState['historyImport']>): Promise<void> {
    this.state = {
      ...this.state,
      historyImport: {
        ...this.state.historyImport,
        ...historyImport,
        pendingEntries: historyImport.pendingEntries ?? this.state.historyImport.pendingEntries,
        completedEntries: historyImport.completedEntries ?? this.state.historyImport.completedEntries,
        completedEntryMtims: historyImport.completedEntryMtims ?? this.state.historyImport.completedEntryMtims
      }
    };
    await this.persistHistoryImport();
  }

  async saveDraft(input: SaveDraftInput): Promise<PromptCard> {
    const nowIso = this.now();
    const groupName = input.groupName?.trim() || '未分类';
    // Title is optional - use first 10 chars of content if empty
    const title = input.title.trim() || input.content.slice(0, 10) + (input.content.length > 10 ? '...' : '');
    const card: PromptCard = {
      id: randomUUID(),
      title,
      content: input.content,
      status: 'unused',
      runtimeState: 'unknown',
      groupId: randomUUID(),
      groupName,
      groupColor: groupColor(groupName),
      sourceType: input.sourceType,
      createdAt: nowIso,
      updatedAt: nowIso,
      dateBucket: toDateBucket(nowIso),
      fileRefs: input.fileRefs,
      justCompleted: false
    };

    this.state.cards.unshift(card);
    this.state.dailyStats = rebuildDailyStats(this.state.cards);
    await this.persist();
    return card;
  }

  async saveImportedCard(input: SaveImportedCardInput): Promise<PromptCard> {
    return this.saveImportedCardInternal(input, { persist: true });
  }

  async saveImportedCards(inputs: SaveImportedCardInput[]): Promise<PromptCard[]> {
    const savedCards: PromptCard[] = [];

    for (const input of inputs) {
      savedCards.push(await this.saveImportedCardInternal(input, { persist: false, rebuildStats: false }));
    }

    if (inputs.length > 0) {
      this.state.dailyStats = rebuildDailyStats(this.state.cards);
      await this.persist();
    }

    return savedCards;
  }

  private async saveImportedCardInternal(
    input: SaveImportedCardInput,
    options: SaveImportedCardOptions
  ): Promise<PromptCard> {
    const nowIso = this.now();
    const sanitizedContent = sanitizeImportedPromptContent(input.content);
    const normalizedContent = sanitizedContent || input.content.trim();
    // 优先使用原始日志时间戳，保证排序顺序准确
    const cardCreatedAt = input.createdAt ? normalizeTs(input.createdAt) : nowIso;
    const sessionKey = buildImportedSessionKey(input.sourceType, input.sourceRef);
    const existingSessionGroup = findExistingSessionGroup(this.state.cards, input.sourceType, input.sourceRef);
    const fallbackGroupName = getFallbackGroupName(input.sourceType, input.sourceRef, input.groupName);
    const resolvedGroupName =
      (sessionKey ? this.sessionGroups[sessionKey]?.groupName : undefined) ??
      existingSessionGroup?.groupName ??
      fallbackGroupName;
    const resolvedGroupId = sessionKey ?? existingSessionGroup?.groupId ?? buildImportedGroupId(input.sourceType, input.sourceRef, resolvedGroupName);
    if (sessionKey) {
      this.sessionGroups[sessionKey] = {
        groupName: resolvedGroupName,
        updatedAt: nowIso
      };
    }
    const legacyIndex = this.state.cards.findIndex((card) =>
      isLegacyCodexSessionRef(card.sourceType, card.sourceRef) &&
      input.sourceType === 'codex' &&
      input.sourceRef?.includes(':') &&
      card.groupName === resolvedGroupName &&
      card.content === normalizedContent &&
      timestampsRoughlyMatch(card.createdAt, cardCreatedAt)
    );

    if (legacyIndex >= 0) {
      const existingCard = this.state.cards[legacyIndex];
      const updatedCard: PromptCard = {
        ...existingCard,
        title: input.title.trim() || existingCard.title,
        content: normalizedContent,
        status: input.status,
        runtimeState: input.runtimeState,
        groupId: resolvedGroupId,
        groupName: resolvedGroupName,
        groupColor: groupColor(resolvedGroupName),
        sourceRef: input.sourceRef,
        createdAt: cardCreatedAt,
        updatedAt: nowIso,
        lastActiveAt: cardCreatedAt,
        dateBucket: toDateBucket(cardCreatedAt)
      };
      this.state.cards[legacyIndex] = updatedCard;
      if (options.rebuildStats !== false) {
        this.state.dailyStats = rebuildDailyStats(this.state.cards);
      }
      if (options.persist !== false) {
        await this.persist();
      }
      return updatedCard;
    }

    const reusableUnusedIndex = findReusableUnusedCardIndex(this.state.cards, normalizedContent);
    if (reusableUnusedIndex >= 0) {
      const existingCard = this.state.cards[reusableUnusedIndex];
      const updatedCard: PromptCard = {
        ...existingCard,
        title: input.title.trim() || existingCard.title,
        content: normalizedContent,
        status: input.status,
        runtimeState: input.runtimeState,
        groupId: resolvedGroupId,
        groupName: resolvedGroupName,
        groupColor: groupColor(resolvedGroupName),
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        createdAt: cardCreatedAt,
        updatedAt: nowIso,
        dateBucket: toDateBucket(cardCreatedAt),
        fileRefs: [],
        lastActiveAt: cardCreatedAt,
        justCompleted: false,
        completedAt: input.status === 'completed' ? nowIso : undefined
      };
      this.state.cards[reusableUnusedIndex] = updatedCard;
      if (options.rebuildStats !== false) {
        this.state.dailyStats = rebuildDailyStats(this.state.cards);
      }
      if (options.persist !== false) {
        await this.persist();
      }
      return updatedCard;
    }

    const card: PromptCard = {
      id: randomUUID(),
      title: input.title.trim() || normalizedContent.slice(0, 10) + (normalizedContent.length > 10 ? '...' : ''),
      content: normalizedContent,
      status: input.status,
      runtimeState: input.runtimeState,
      groupId: resolvedGroupId,
      groupName: resolvedGroupName,
      groupColor: groupColor(resolvedGroupName),
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      createdAt: cardCreatedAt,
      updatedAt: nowIso,
      dateBucket: toDateBucket(cardCreatedAt),
      fileRefs: [],
      lastActiveAt: cardCreatedAt,
      justCompleted: false
    };

    this.state.cards.unshift(card);
    if (options.rebuildStats !== false) {
      this.state.dailyStats = rebuildDailyStats(this.state.cards);
    }
    if (options.persist !== false) {
      await this.persist();
    }
    return card;
  }

  async saveModularPrompt(input: SaveModularPromptInput): Promise<ModularPrompt> {
    const nowIso = this.now();
    const trimmedName = input.name.trim();
    const trimmedCategory = input.category.trim() || 'general';

    if (!trimmedName) {
      throw new Error('Modular prompt name is required');
    }

    const nextPrompt: ModularPrompt = {
      id: input.id ?? randomUUID(),
      name: trimmedName,
      content: input.content,
      category: trimmedCategory,
      updatedAt: nowIso
    };

    const existingIndex = this.state.modularPrompts.findIndex(
      (prompt) => prompt.id === nextPrompt.id || prompt.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (existingIndex >= 0) {
      this.state.modularPrompts[existingIndex] = nextPrompt;
    } else {
      this.state.modularPrompts.unshift(nextPrompt);
    }

    await this.persist();
    return nextPrompt;
  }

  async updateSettings(input: UpdateSettingsInput): Promise<void> {
    const normalizedSettings = normalizeSettings(input, this.state.settings);
    this.state = {
      ...this.state,
      settings: normalizedSettings.settings
    };
    await this.persist();
  }

  async clearCache(): Promise<void> {
    this.state = {
      ...this.state,
      cards: [],
      modularPrompts: [],
      dailyStats: [],
      historyImport: createInitialHistoryImportState()
    };
    this.sessionGroups = {};
    await this.persist();
  }

  async moveCard(cardId: string, nextStatus: PromptStatus): Promise<void> {
    const updatedAt = this.now();

    this.state.cards = this.state.cards.map((card) => {
      if (card.id !== cardId) {
        return card;
      }

      return {
        ...card,
        status: nextStatus,
        runtimeState: nextStatus === 'completed' ? 'finished' : nextStatus === 'active' ? 'running' : 'unknown',
        completedAt: nextStatus === 'completed' ? updatedAt : undefined,
        updatedAt,
        justCompleted: nextStatus === 'completed' ? card.justCompleted : false
      };
    });

    this.state.dailyStats = rebuildDailyStats(this.state.cards);
    await this.persist();
  }

  async markCardCompletedFromLog(sourceRef: string, completedAt: string, options?: { justCompleted?: boolean }): Promise<void> {
    const shouldMarkJustCompleted = options?.justCompleted ?? true;
    this.state.cards = this.state.cards.map((card) =>
      card.sourceRef === sourceRef || card.id === sourceRef
        ? {
            ...card,
            status: 'completed',
            runtimeState: 'finished',
            completedAt,
            updatedAt: completedAt,
            justCompleted: shouldMarkJustCompleted
          }
        : card
    );
    this.state.dailyStats = rebuildDailyStats(this.state.cards);
    await this.persist();
  }

  async autoCompleteExpiredActiveCards(maxAgeMs: number): Promise<string[]> {
    const nowIso = this.now();
    const nowMs = Date.parse(nowIso);
    const completedIds: string[] = [];

    if (Number.isNaN(nowMs)) {
      return completedIds;
    }

    this.state.cards = this.state.cards.map((card) => {
      if (card.status !== 'active' || card.runtimeState !== 'running') {
        return card;
      }

      const baselineMs = Date.parse(card.lastActiveAt ?? card.createdAt);
      if (Number.isNaN(baselineMs) || nowMs - baselineMs < maxAgeMs) {
        return card;
      }

      completedIds.push(card.id);
      return {
        ...card,
        status: 'completed',
        runtimeState: 'finished',
        completedAt: nowIso,
        updatedAt: nowIso,
        justCompleted: false
      };
    });

    if (completedIds.length > 0) {
      this.state.dailyStats = rebuildDailyStats(this.state.cards);
      await this.persist();
    }

    return completedIds;
  }

  async updateCardLastActiveAt(sourceRef: string, lastActiveAt: string): Promise<void> {
    let changed = false;
    this.state.cards = this.state.cards.map((card) => {
      if (card.sourceRef === sourceRef && card.status === 'active') {
        changed = true;
        return { ...card, lastActiveAt };
      }
      return card;
    });
    if (changed) {
      await this.persist();
    }
  }

  async acknowledgeCompletion(cardId: string): Promise<void> {
    const updatedAt = this.now();
    this.state.cards = this.state.cards.map((card) =>
      card.id === cardId
        ? {
            ...card,
            status: 'completed',
            runtimeState: 'finished',
            updatedAt,
            justCompleted: false
          }
        : card
    );
    this.state.dailyStats = rebuildDailyStats(this.state.cards);
    await this.persist();
  }

  async renameGroup(groupId: string, nextName: string): Promise<void> {
    const trimmedNextName = nextName.trim();
    if (!trimmedNextName) {
      return;
    }

    const targetCard = this.state.cards.find((card) => card.groupId === groupId);
    const targetSessionId =
      targetCard && isImportedSessionCard(targetCard)
        ? resolveImportedSessionId(targetCard.sourceType, targetCard.sourceRef)
        : undefined;
    const targetSessionKey =
      targetCard && isImportedSessionCard(targetCard)
        ? buildImportedSessionKey(targetCard.sourceType, targetCard.sourceRef)
        : undefined;
    const nextGroupId =
      targetCard && isImportedSessionCard(targetCard)
        ? buildImportedGroupId(targetCard.sourceType, targetCard.sourceRef, trimmedNextName)
        : groupId;

    if (targetSessionKey) {
      this.sessionGroups[targetSessionKey] = {
        groupName: trimmedNextName,
        updatedAt: this.now()
      };
    }

    this.state.cards = this.state.cards.map((card) => {
      const shouldRename =
        card.groupId === groupId ||
        (
          targetCard &&
          isImportedSessionCard(targetCard) &&
          card.sourceType === targetCard.sourceType &&
          resolveImportedSessionId(card.sourceType, card.sourceRef) === targetSessionId
        );

      if (!shouldRename) {
        return card;
      }

      return {
        ...card,
        groupId: nextGroupId,
        groupName: trimmedNextName,
        groupColor: groupColor(trimmedNextName)
      };
    });
    await this.persist();
  }

  async updateCard(cardId: string, input: UpdateCardInput): Promise<PromptCard | undefined> {
    const nowIso = this.now();
    let updated: PromptCard | undefined;

    this.state.cards = this.state.cards.map((card) => {
      if (card.id !== cardId || card.status !== 'unused') return card;
      const title = input.title?.trim() || input.content.slice(0, 10) + (input.content.length > 10 ? '...' : '');
      updated = { ...card, title, content: input.content, fileRefs: input.fileRefs, updatedAt: nowIso };
      return updated;
    });

    if (updated) {
      await this.persist();
    }
    return updated;
  }

  async updateImportedCardContent(cardId: string, content: string): Promise<void> {
    const nowIso = this.now();
    const normalizedContent = sanitizeImportedPromptContent(content) || content.trim();
    this.state.cards = this.state.cards.map((card) =>
      card.id === cardId ? { ...card, content: normalizedContent, updatedAt: nowIso } : card
    );
    await this.persist();
  }

  async deleteCard(cardId: string): Promise<void> {
    this.state.cards = this.state.cards.filter((c) => c.id !== cardId);
    this.state.dailyStats = rebuildDailyStats(this.state.cards);
    await this.persist();
  }

  private async persistHistoryImport(): Promise<void> {
    await this.store.writeJson('history-import.json', this.state.historyImport);
  }

  async persist(): Promise<void> {
    await Promise.all([
      this.store.writeJson('cards.json', this.state.cards),
      this.store.writeJson('modular-prompts.json', this.state.modularPrompts),
      this.store.writeJson('daily-stats.json', this.state.dailyStats),
      this.persistHistoryImport(),
      this.store.writeJson('settings.json', this.state.settings),
      this.store.writeJson('session-groups.json', this.sessionGroups)
    ]);
  }
}

function rebuildDailyStats(cards: PromptCard[]): DailyStats[] {
  const buckets = new Map<string, DailyStats>();

  for (const card of cards) {
    const entry = buckets.get(card.dateBucket) ?? {
      date: card.dateBucket,
      usedCount: 0,
      unusedCount: 0,
      completedCount: 0,
      totalCount: 0
    };

    entry.totalCount += 1;

    if (card.status === 'unused') {
      entry.unusedCount += 1;
    }

    if (card.status === 'active' || card.status === 'completed') {
      entry.usedCount += 1;
    }

    if (card.status === 'completed') {
      entry.completedCount += 1;
    }

    buckets.set(card.dateBucket, entry);
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}
