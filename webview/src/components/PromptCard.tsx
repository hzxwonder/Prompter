import type { CSSProperties, DragEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PromptCard as PromptCardModel, PromptSourceType, PromptStatus, PrompterSettings } from '../../../src/shared/models';
import { postMessage } from '../api/vscode';
import { getLocaleText, isUncategorizedGroupName } from '../i18n';

const PREVIEW_LENGTH = 140;
const PREVIEW_LINE_COUNT = 4;
const DOUBLE_CLICK_WINDOW_MS = 140;
type JumpableSourceType = Extract<PromptSourceType, 'claude-code' | 'codex' | 'roo-code'>;

function needsExpandButton(content: string): boolean {
  return content.length > PREVIEW_LENGTH || content.split(/\r?\n/).length > PREVIEW_LINE_COUNT;
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {expanded ? (
        <path d="M3.22 10.53a.75.75 0 0 0 1.06 0L8 6.81l3.72 3.72a.75.75 0 1 0 1.06-1.06L8.53 5.22a.75.75 0 0 0-1.06 0L3.22 9.47a.75.75 0 0 0 0 1.06z" />
      ) : (
        <path d="M3.22 5.47a.75.75 0 0 1 1.06 0L8 9.19l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.53a.75.75 0 0 1 0-1.06z" />
      )}
    </svg>
  );
}

function JumpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11 1.5v1h2.793l-3.647 3.646.708.708L14.5 3.207V6h1V1.5H11zM4.854 8.146l.708.708L2.207 12.5H5v1H1.5v-3.5h1v2.293l3.354-3.147z" />
    </svg>
  );
}

function canJumpToSource(sourceType: PromptSourceType): sourceType is JumpableSourceType {
  return sourceType === 'claude-code' || sourceType === 'codex' || sourceType === 'roo-code';
}

function getDisplayGroupName(card: PromptCardModel): string {
  if ((card.sourceType === 'codex' || card.sourceType === 'roo-code') && isUncategorizedGroupName(card.groupName) && card.sourceRef) {
    return card.sourceRef;
  }
  return card.groupName;
}

function formatStatusLabel(status: PromptStatus, awaitingConfirmation: boolean, language: PrompterSettings['language']): string {
  const localeText = getLocaleText(language);

  if (awaitingConfirmation) {
    return localeText.card.awaitingConfirmation;
  }

  return localeText.laneLabels[status];
}

function formatCreatedAt(createdAt: string): string {
  return createdAt.slice(0, 16).replace('T', ' ');
}

export function PromptCard({
  language = 'zh-CN',
  card,
  onMoveCard,
  onAcknowledgeCompletion,
  onRenameGroup,
  onEditInComposer,
  showAwaitingConfirmation = false,
  showStatusBadge = false,
  showCreatedAt = false,
  showDeleteButton = false,
  draggable = true,
  onDeleteCard
}: {
  language?: PrompterSettings['language'];
  card: PromptCardModel;
  onMoveCard: (cardId: string, nextStatus: PromptStatus) => void;
  onAcknowledgeCompletion: (cardId: string) => void;
  onRenameGroup: (groupId: string, nextName: string) => void;
  onEditInComposer?: (card: PromptCardModel) => void;
  showAwaitingConfirmation?: boolean;
  showStatusBadge?: boolean;
  showCreatedAt?: boolean;
  showDeleteButton?: boolean;
  draggable?: boolean;
  onDeleteCard?: (cardId: string) => void;
}) {
  const localeText = getLocaleText(language);
  const [isEditingGroup, setIsEditingGroup] = useState(false);
  const displayGroupName = getDisplayGroupName(card);
  const [groupName, setGroupName] = useState(displayGroupName);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const committedName = useRef(displayGroupName);
  // Timer to distinguish single-click (copy) from double-click (edit)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref for measuring actual DOM overflow to decide whether to show expand button
  const contentRef = useRef<HTMLParagraphElement>(null);
  // Whether the content is visually clamped (determined by DOM measurement)
  const [isOverflowing, setIsOverflowing] = useState(needsExpandButton(card.content));
  const statusLabel = formatStatusLabel(card.status, card.justCompleted || showAwaitingConfirmation, language);

  useEffect(() => {
    if (!isEditingGroup) {
      setGroupName(displayGroupName);
      committedName.current = displayGroupName;
    }
  }, [displayGroupName, isEditingGroup]);

  useEffect(() => {
    setExpanded(false);
  }, [card.id, card.content]);

  // Measure actual DOM overflow to accurately decide whether the expand button
  // should be shown.  We only measure while collapsed (when the CSS line-clamp
  // is active); if the content is taller than the clamped box the button is
  // needed, regardless of character count.
  useLayoutEffect(() => {
    if (expanded) return; // clamp removed when expanded — skip measurement
    const el = contentRef.current;
    if (!el) {
      setIsOverflowing(needsExpandButton(card.content));
      return;
    }
    setIsOverflowing(needsExpandButton(card.content) || el.scrollHeight > el.clientHeight);
  }, [card.id, card.content, expanded]);

  const commitRename = () => {
    const trimmed = groupName.trim();
    const prev = committedName.current;
    setIsEditingGroup(false);
    if (trimmed && trimmed !== prev) {
      committedName.current = trimmed;
      setGroupName(trimmed);
      onRenameGroup(card.groupId, trimmed);
    } else {
      setGroupName(prev);
    }
  };

  const handleClick = () => {
    if (card.justCompleted || showAwaitingConfirmation) {
      return;
    }
    // Single-click: wait briefly to see if a double-click follows
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      // Single click confirmed — copy content
      navigator.clipboard.writeText(card.content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    }, DOUBLE_CLICK_WINDOW_MS);
  };

  const handleDoubleClick = () => {
    // Cancel the pending single-click copy
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onEditInComposer?.(card);
  };

  return (
    <article
      draggable={draggable && !isEditingGroup}
      className={`prompt-card status-${card.status}${card.justCompleted ? ' prompt-card--just-completed' : ''}${copied ? ' prompt-card--copied' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onDragStart={(event: DragEvent<HTMLElement>) => {
        if (!draggable || isEditingGroup) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/plain', card.id);
        event.dataTransfer.setData('application/prompter-card-status', card.status);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      {/* Copy feedback */}
      {copied && <span className="prompt-card-copied-badge">{localeText.card.copied}</span>}

      {(showStatusBadge || showDeleteButton) && (
        <div className="prompt-card-topbar">
          {showStatusBadge ? (
            <span className={`prompt-card-status-badge prompt-card-status-badge--${card.status}${card.justCompleted || showAwaitingConfirmation ? ' prompt-card-status-badge--awaiting' : ''}`}>
              {statusLabel}
            </span>
          ) : (
            <span />
          )}
          {showDeleteButton ? (
            <button
              type="button"
              className="prompt-card-delete-btn"
              aria-label={localeText.card.deletePrompt}
              title={localeText.card.deletePrompt}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteCard?.(card.id);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                <path
                  fillRule="evenodd"
                  d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                />
              </svg>
            </button>
          ) : null}
        </div>
      )}

      {showCreatedAt ? (
        <div className="prompt-card-meta">
          <time dateTime={card.createdAt}>
            {localeText.card.createdAt} {formatCreatedAt(card.createdAt)}
          </time>
        </div>
      ) : null}

      {/* just-completed indicator */}
      {card.justCompleted && (
        <button
          type="button"
          className="just-completed-dot"
          aria-label={localeText.card.awaitingConfirmationAction}
          onClick={(event) => {
            event.stopPropagation();
            onAcknowledgeCompletion(card.id);
          }}
        >
          {localeText.card.awaitingConfirmation}
        </button>
      )}
      {!card.justCompleted && showAwaitingConfirmation && (
        <button
          type="button"
          className="just-completed-dot"
          aria-label={localeText.card.awaitingConfirmationAction}
          onClick={(event) => {
            event.stopPropagation();
            onAcknowledgeCompletion(card.id);
          }}
        >
          {localeText.card.awaitingConfirmation}
        </button>
      )}

      {/* Content */}
      <div className="prompt-card-content-wrap">
        <p ref={contentRef} className={`prompt-card-content${expanded ? ' prompt-card-content--expanded' : ''}`}>{card.content}</p>
        {isOverflowing ? (
          <button
            type="button"
            className="prompt-card-expand-btn"
            aria-label={expanded ? localeText.card.collapsePrompt : localeText.card.expandPrompt}
            title={expanded ? localeText.card.collapsePrompt : localeText.card.expandPrompt}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
          >
            <ExpandIcon expanded={expanded} />
          </button>
        ) : null}
      </div>

      {/* Group row */}
      <div
        className="prompt-card-group"
        style={{ '--group-color': card.groupColor } as CSSProperties}
      >
        {isEditingGroup ? (
          <input
            autoFocus
            aria-label={localeText.card.groupNameInputAriaLabel}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { setGroupName(committedName.current); setIsEditingGroup(false); }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="prompt-card-group-name"
            aria-label={localeText.card.renameGroup}
            title={localeText.card.renameGroupTitle}
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingGroup(true);
            }}
          >
            {groupName}
          </button>
        )}

        {/* Jump to source button */}
        {canJumpToSource(card.sourceType) && card.sourceRef && (
          <button
            type="button"
            className="prompt-card-jump-btn"
            aria-label={localeText.card.jumpToSource(localeText.sourceLabels[card.sourceType] ?? card.sourceType)}
            title={localeText.card.jumpToSource(localeText.sourceLabels[card.sourceType] ?? card.sourceType)}
            onClick={(e) => {
              e.stopPropagation();
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
    </article>
  );
}
