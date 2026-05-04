import { useState } from 'react';
import type { PromptCard, DailyStats, PrompterSettings, HistoryImportState } from '../../../src/shared/models';
import { Heatmap } from '../components/Heatmap';
import { getLocaleText, isUncategorizedGroupName } from '../i18n';
import { postMessage } from '../api/vscode';

function JumpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11 1.5v1h2.793l-3.647 3.646.708.708L14.5 3.207V6h1V1.5H11zM4.854 8.146l.708.708L2.207 12.5H5v1H1.5v-3.5h1v2.293l3.354-3.147z" />
    </svg>
  );
}

type JumpableSourceType = 'claude-code' | 'codex' | 'roo-code';

function canJumpToSource(sourceType: PromptCard['sourceType']): sourceType is JumpableSourceType {
  return sourceType === 'claude-code' || sourceType === 'codex' || sourceType === 'roo-code';
}

function getDisplayGroupName(card: PromptCard, language: PrompterSettings['language']): string {
  if ((card.sourceType === 'codex' || card.sourceType === 'roo-code') && isUncategorizedGroupName(card.groupName) && card.sourceRef) {
    return card.sourceRef;
  }
  return card.groupName || (language === 'en' ? 'Uncategorized' : '未分类');
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatStatus(status: PromptCard['status'], language: PrompterSettings['language']): string {
  return getLocaleText(language).laneLabels[status];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Group cards by stable groupId so session renames stay isolated.
 */
function groupCards(cards: PromptCard[], language: PrompterSettings['language']): { id: string; name: string; cards: PromptCard[] }[] {
  const map = new Map<string, { id: string; name: string; cards: PromptCard[] }>();

  for (const card of cards) {
    const key = card.groupId || card.sourceRef || card.id;
    const bucket = map.get(key) ?? { id: key, name: getDisplayGroupName(card, language), cards: [] };
    bucket.cards.push(card);
    map.set(key, bucket);
  }

  return [...map.values()]
    .map((group) => ({
      ...group,
      cards: [...group.cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    .sort((a, b) => {
      const aLatest = a.cards[0]?.createdAt ?? '';
      const bLatest = b.cards[0]?.createdAt ?? '';
      return bLatest.localeCompare(aLatest);
    });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Status icon (right-top corner) */
function StatusIcon({
  status,
  language
}: {
  status: PromptCard['status'];
  language: PrompterSettings['language'];
}) {
  const localeText = getLocaleText(language);

  if (status === 'completed') {
    return <span className="hcard-status-icon hcard-status-icon--completed" title={localeText.laneLabels.completed}>✓</span>;
  }
  if (status === 'active') {
    return <span className="hcard-status-icon hcard-status-icon--active" title={localeText.laneLabels.active}>●</span>;
  }
  return <span className="hcard-status-icon hcard-status-icon--unused" title={localeText.laneLabels.unused}>○</span>;
}

/** Copy icon SVG */
function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6z"/>
      <path d="M2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z"/>
    </svg>
  );
}

const PREVIEW_LENGTH = 100;

function HistoryCardItem({
  card,
  language
}: {
  card: PromptCard;
  language: PrompterSettings['language'];
}) {
  const localeText = getLocaleText(language);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const needsExpand = card.content.length > PREVIEW_LENGTH;
  const displayContent = expanded || !needsExpand
    ? card.content
    : card.content.slice(0, PREVIEW_LENGTH) + '…';

  const handleCopy = () => {
    navigator.clipboard.writeText(card.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <article className="history-card">
      {/* Top bar: left = source + time + copy; right = status icon */}
      <div className="hcard-topbar">
        <div className="hcard-meta">
          <span className="hcard-source">{card.sourceType}</span>
          <span className="hcard-time">{formatTime(card.updatedAt)}</span>
          <button
            type="button"
            className={`hcard-copy-btn${copied ? ' hcard-copy-btn--copied' : ''}`}
            onClick={handleCopy}
            aria-label={copied ? localeText.card.copied : localeText.history.copyContent}
            title={copied ? localeText.card.copied : localeText.history.copyContent}
          >
            {copied ? '✓' : <CopyIcon />}
          </button>
          {canJumpToSource(card.sourceType) && card.sourceRef && (
            <button
              type="button"
              className="prompt-card-jump-btn"
              style={{ opacity: 1 }}
              aria-label={localeText.card.jumpToSource(localeText.sourceLabels[card.sourceType] ?? card.sourceType)}
              title={localeText.card.jumpToSource(localeText.sourceLabels[card.sourceType] ?? card.sourceType)}
              onClick={() => {
                postMessage({
                  type: 'card:jumpToSource',
                  payload: {
                    cardId: card.id,
                    sourceType: card.sourceType,
                    sourceRef: card.sourceRef ?? ''
                  }
                });
              }}
            >
              <JumpIcon />
            </button>
          )}
        </div>
        <StatusIcon status={card.status} language={language} />
      </div>

      {/* Content — click anywhere to expand/collapse */}
      <p
        className={`hcard-content${needsExpand ? ' hcard-content--clickable' : ''}`}
        onClick={() => needsExpand && setExpanded((v) => !v)}
        title={needsExpand ? (expanded ? localeText.history.clickToCollapse : localeText.history.clickToExpand) : undefined}
      >
        {displayContent}
      </p>

      {/* File refs */}
      {card.fileRefs.length > 0 && (
        <ul className="history-card-filerefs">
          {card.fileRefs.map((ref, i) => (
            <li key={i} title={ref.path}>
              {ref.path.split('/').pop()}
              {ref.startLine != null && (
                <span className="history-card-linerange">
                  :{ref.startLine}
                  {ref.endLine != null && ref.endLine !== ref.startLine ? `–${ref.endLine}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function AccordionGroup({
  language,
  name,
  cards,
  defaultOpen = true
}: {
  language: PrompterSettings['language'];
  name: string;
  cards: PromptCard[];
  defaultOpen?: boolean;
}) {
  const localeText = getLocaleText(language);
  const [open, setOpen] = useState(defaultOpen);

  const unused    = cards.filter((c) => c.status === 'unused').length;
  const active    = cards.filter((c) => c.status === 'active').length;
  const completed = cards.filter((c) => c.status === 'completed').length;

  return (
    <div className={`history-accordion ${open ? 'history-accordion--open' : ''}`}>
      <button
        type="button"
        className="history-accordion-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="history-accordion-arrow">{open ? '▾' : '▸'}</span>
        <span className="history-accordion-name">{name}</span>
        <span className="history-accordion-meta">
          {localeText.history.itemsCount(cards.length)}
          {unused > 0    && <span className="acc-pill acc-pill--unused">{localeText.history.statusCount(localeText.laneLabels.unused, unused)}</span>}
          {active > 0    && <span className="acc-pill acc-pill--active">{localeText.history.statusCount(localeText.laneLabels.active, active)}</span>}
          {completed > 0 && <span className="acc-pill acc-pill--completed">{localeText.history.statusCount(localeText.laneLabels.completed, completed)}</span>}
        </span>
      </button>

      {open && (
        <div className="history-accordion-body">
          {cards.map((card) => (
            <HistoryCardItem key={card.id} card={card} language={language} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function HistoryPage({
  language = 'zh-CN',
  historyImport,
  dailyStats,
  cards,
  selectedDate,
  onSelectDate,
  onStartHistoryImport,
  onPauseHistoryImport
}: {
  language?: PrompterSettings['language'];
  historyImport?: HistoryImportState;
  dailyStats: DailyStats[];
  cards: PromptCard[];
  selectedDate?: string;
  onSelectDate: (date: string) => void;
  onStartHistoryImport?: () => void;
  onPauseHistoryImport?: () => void;
}) {
  const localeText = getLocaleText(language);
  const useSourceProgress = historyImport?.scope === 'history-backfill';
  const totalForProgress = useSourceProgress
    ? (historyImport?.totalSources ?? 0)
    : (historyImport?.totalPrompts ?? historyImport?.totalSources ?? 0);
  const valueNow = useSourceProgress
    ? historyImport?.processedSources
    : historyImport?.totalPrompts
      ? historyImport.processedPrompts
      : historyImport?.totalSources
        ? historyImport.processedSources
        : undefined;
  // null = show all; a status value = filter to that status only
  const [statusFilter, setStatusFilter] = useState<PromptCard['status'] | null>(null);

  // Reset filter when date changes
  const handleSelectDate = (date: string) => {
    setStatusFilter(null);
    onSelectDate(date);
  };

  const selectedCards = selectedDate
    ? cards.filter((card) => card.dateBucket === selectedDate)
    : [];

  // Apply status filter before grouping
  const filteredCards = statusFilter
    ? selectedCards.filter((c) => c.status === statusFilter)
    : selectedCards;

  const groups = groupCards(filteredCards, language);

  // Stats summary for the selected day (always based on ALL cards, not filtered)
  const dayStats = dailyStats.find((s) => s.date === selectedDate);

  const toggleFilter = (status: PromptCard['status']) => {
    setStatusFilter((prev) => (prev === status ? null : status));
  };
  const isHistoryBackfill = historyImport?.scope === 'history-backfill';
  const isHistoryImportRunning = historyImport?.status === 'running';
  const isHistoryImportComplete = historyImport?.status === 'complete';
  const hasPendingHistory = (historyImport?.pendingEntries.length ?? 0) > 0;
  const shouldShowHistoryImportControl = Boolean(historyImport && isHistoryBackfill && (hasPendingHistory || isHistoryImportRunning || isHistoryImportComplete));

  return (
    <div className="history-page">
      {shouldShowHistoryImportControl && historyImport && (
        <section className="history-import-progress" aria-label={localeText.history.importProgressLabel}>
          <div className="history-import-progress__header">
            <div>
              <h2>{localeText.history.importInProgressTitle}</h2>
              <p className="workspace-subtitle">
                {historyImport.foregroundReady ? localeText.history.importReadySummary : localeText.history.importBackfillSummary}
              </p>
            </div>
            <button
              type="button"
              className={[
                'history-import-progress__button',
                isHistoryImportRunning ? 'history-import-progress__button--pause' : '',
                isHistoryImportComplete ? 'history-import-progress__button--complete' : ''
              ].filter(Boolean).join(' ')}
              disabled={isHistoryImportComplete}
              title={isHistoryImportComplete ? localeText.history.importCompletedTooltip : undefined}
              onClick={() => {
                if (isHistoryImportRunning) {
                  onPauseHistoryImport?.();
                  return;
                }
                onStartHistoryImport?.();
              }}
            >
              {isHistoryImportRunning ? localeText.history.importPause : localeText.history.importStart}
            </button>
          </div>
          <span className="history-import-progress__meta">
            {localeText.history.importProcessedSources(historyImport.processedSources, historyImport.totalSources)}
          </span>
          <div
            className="history-import-progress__bar"
            role="progressbar"
            aria-label={localeText.history.importProgressLabel}
            aria-valuemin={0}
            aria-valuemax={totalForProgress || 100}
            aria-valuenow={valueNow}
          >
            <div
              className="history-import-progress__fill"
              style={{
                width: `${Math.max(
                  totalForProgress > 0 && valueNow != null ? (valueNow / totalForProgress) * 100 : 8,
                  8
                )}%`
              }}
            />
          </div>
          <p className="history-import-progress__summary">
            {localeText.history.importProcessedPrompts(
              historyImport.processedPrompts,
              useSourceProgress ? undefined : historyImport.totalPrompts
            )}
          </p>
        </section>
      )}
      {historyImport && !isHistoryBackfill && historyImport.status !== 'idle' && historyImport.status !== 'complete' && (
        <section className="history-import-progress" aria-label={localeText.history.importProgressLabel}>
          <div className="history-import-progress__header">
            <div>
              <h2>{localeText.history.importInProgressTitle}</h2>
              {historyImport.foregroundReady && (
                <p className="workspace-subtitle">{localeText.history.importForegroundReady}</p>
              )}
            </div>
            <span className="history-import-progress__meta">
              {localeText.history.importProcessedSources(historyImport.processedSources, historyImport.totalSources)}
            </span>
          </div>
          <div
            className="history-import-progress__bar"
            role="progressbar"
            aria-label={localeText.history.importProgressLabel}
            aria-valuemin={0}
            aria-valuemax={totalForProgress || 100}
            aria-valuenow={valueNow}
          >
            <div
              className="history-import-progress__fill"
              style={{
                width: `${Math.max(
                  totalForProgress > 0 && valueNow != null ? (valueNow / totalForProgress) * 100 : 8,
                  8
                )}%`
              }}
            />
          </div>
          <p className="history-import-progress__summary">
            {localeText.history.importProcessedPrompts(historyImport.processedPrompts, historyImport.totalPrompts)}
          </p>
        </section>
      )}
      {!dailyStats.length ? (
        <div className="history-empty-state">{localeText.history.empty}</div>
      ) : (
        <>
          <Heatmap
            language={language}
            stats={dailyStats}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />

          {/* Day detail panel — only shown after a date is clicked */}
          {selectedDate && (
            <section className="history-day-panel" aria-label={localeText.history.selectedDayDetails}>
              <div className="panel-header">
                <div>
                  <h2>{selectedDate}</h2>
                  <p className="workspace-subtitle">
                    {statusFilter
                      ? localeText.history.filterSubtitle(formatStatus(statusFilter, language))
                      : localeText.history.readOnlySubtitle}
                  </p>
                </div>

                {/* Clickable filter badges */}
                {dayStats && (
                  <div className="history-day-summary">
                    <button
                      type="button"
                      className={`acc-pill acc-pill--unused acc-pill--filter${statusFilter === 'unused' ? ' acc-pill--selected' : ''}`}
                      onClick={() => toggleFilter('unused')}
                    >
                      {localeText.history.statusCount(localeText.laneLabels.unused, dayStats.unusedCount)}
                    </button>
                    <button
                      type="button"
                      className={`acc-pill acc-pill--active acc-pill--filter${statusFilter === 'active' ? ' acc-pill--selected' : ''}`}
                      onClick={() => toggleFilter('active')}
                    >
                      {localeText.history.statusCount(localeText.laneLabels.active, dayStats.usedCount - dayStats.completedCount)}
                    </button>
                    <button
                      type="button"
                      className={`acc-pill acc-pill--completed acc-pill--filter${statusFilter === 'completed' ? ' acc-pill--selected' : ''}`}
                      onClick={() => toggleFilter('completed')}
                    >
                      {localeText.history.statusCount(localeText.laneLabels.completed, dayStats.completedCount)}
                    </button>
                  </div>
                )}
              </div>

              {!filteredCards.length ? (
                <div className="history-empty-state">
                  {statusFilter
                    ? localeText.history.noPromptsForStatus(formatStatus(statusFilter, language))
                    : localeText.history.noPromptsForDay}
                </div>
              ) : (
                <div className="history-accordion-list">
                  {groups.map((group, i) => (
                    <AccordionGroup
                      key={group.id}
                      language={language}
                      name={group.name}
                      cards={group.cards}
                      defaultOpen={i === 0}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
