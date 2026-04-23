import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { toDateBucket, type PromptCard, type PromptStatus, type PrompterSettings } from '../../../src/shared/models';
import { postMessage } from '../api/vscode';
import { Composer } from '../components/Composer';
import { getLocaleText } from '../i18n';
import { PromptCard as PromptCardItem } from '../components/PromptCard';
import { PromptLane } from '../components/PromptLane';
import { getPromptActivityState } from '../lib/promptActivity';
import type { WorkspaceDraft } from '../store/prompterReducer';

type DroppedFile = File & { path?: string };

const laneOrder: PromptStatus[] = ['unused', 'active', 'completed'];
const uriDropTypes = ['Files', 'text/uri-list', 'text/plain'] as const;
const WORKSPACE_ACTIVITY_POLL_MS = 30_000;
type WorkspaceLayout = 'lanes' | 'list';

function sortCardsByCreatedAt(cards: PromptCard[]): PromptCard[] {
  return [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortCardsByPriorityAndTime(cards: PromptCard[], awaitingConfirmationCardIds: Set<string>): PromptCard[] {
  const getPriority = (card: PromptCard): number => {
    if (card.justCompleted || awaitingConfirmationCardIds.has(card.id)) {
      return 0;
    }

    if (card.status === 'active' && card.runtimeState === 'paused') {
      return 1;
    }

    switch (card.status) {
      case 'unused':
        return 2;
      case 'active':
        return 3;
      case 'completed':
        return 4;
      default:
        return 5;
    }
  };

  const getTime = (card: PromptCard): string => card.updatedAt || card.completedAt || card.createdAt;

  return [...cards].sort((a, b) => {
    const priorityDelta = getPriority(a) - getPriority(b);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return getTime(b).localeCompare(getTime(a));
  });
}

function shouldOverwriteUnusedDraft(draft: WorkspaceDraft): boolean {
  return draft.editingCardId !== undefined && draft.editingCardStatus === 'unused';
}

function buildDraftPayload(draft: WorkspaceDraft) {
  return {
    title: draft.title.trim(),
    content: draft.content,
    fileRefs: draft.fileRefs
  };
}

function getTodayDateBucket(): string {
  return toDateBucket(new Date().toISOString());
}

function looksLikeDroppedPath(value: string): boolean {
  return /^(file:\/\/|\/|[A-Za-z]:[\\/])/.test(value);
}

function normalizeDroppedPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (trimmed.startsWith('file://')) {
    try {
      const decodedPath = decodeURIComponent(new URL(trimmed).pathname);
      return decodedPath.replace(/^\/([A-Za-z]:[\\/])/, '$1');
    } catch {
      return null;
    }
  }
  return looksLikeDroppedPath(trimmed) ? trimmed : null;
}

function collectDroppedPaths(event: DragEvent<HTMLTextAreaElement>): string[] {
  const paths = new Set<string>();

  for (const file of Array.from(event.dataTransfer.files)) {
    const path = (file as DroppedFile).path?.trim();
    if (path) {
      paths.add(path);
    }
  }

  for (const type of ['text/uri-list', 'text/plain'] as const) {
    const raw = event.dataTransfer.getData(type);
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const normalized = normalizeDroppedPath(line);
      if (normalized) {
        paths.add(normalized);
      }
    }
  }

  return [...paths];
}

function hasDroppedPaths(event: DragEvent<HTMLTextAreaElement>): boolean {
  return uriDropTypes.some((type) => event.dataTransfer.types.includes(type));
}

function TrashZone({
  language,
  onDrop
}: {
  language: PrompterSettings['language'];
  onDrop: (cardId: string) => void;
}) {
  const localeText = getLocaleText(language);
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      className={`trash-zone${isOver ? ' trash-zone--over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const cardId = e.dataTransfer.getData('text/plain');
        if (cardId) onDrop(cardId);
      }}
    >
      <svg
        className="trash-zone-icon"
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
        <path
          fillRule="evenodd"
          d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
        />
      </svg>
      <span className="trash-zone-label">
        {isOver ? localeText.workspace.trashZoneOver : localeText.workspace.trashZoneIdle}
      </span>
    </div>
  );
}

export function WorkspacePage({
  language = 'zh-CN',
  cards,
  draft,
  onDraftChange,
  onMoveCard,
  onDeleteCard,
  onAcknowledgeCompletion,
  onRenameGroup,
  onManualSubmit,
  onUndoImport,
  lastSavedCardId: _lastSavedCardId
}: {
  language?: PrompterSettings['language'];
  cards: PromptCard[];
  draft: WorkspaceDraft;
  onDraftChange: (nextDraft: Partial<WorkspaceDraft>) => void;
  onMoveCard: (cardId: string, nextStatus: PromptStatus) => void;
  onDeleteCard: (cardId: string) => void;
  onAcknowledgeCompletion: (cardId: string) => void;
  onRenameGroup: (previousName: string, nextName: string) => void;
  onManualSubmit: () => void;
  onUndoImport?: () => void;
  lastSavedCardId?: string;
}) {
  const [isDroppingFiles, setIsDroppingFiles] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [layout, setLayout] = useState<WorkspaceLayout>('lanes');
  const localeText = getLocaleText(language);
  const composerSectionRef = useRef<HTMLElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const todayBucket = getTodayDateBucket();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, WORKSPACE_ACTIVITY_POLL_MS);

    return () => window.clearInterval(timer);
  }, []);

  const visibleCards = useMemo(
    () => cards.filter((card) => card.dateBucket === todayBucket || card.status === 'active'),
    [cards, todayBucket]
  );
  const awaitingConfirmationCardIds = useMemo(
    () =>
      new Set(
        visibleCards
          .filter((card) => getPromptActivityState({ card, nowMs }) === 'awaiting-confirmation')
          .map((card) => card.id)
      ),
    [visibleCards, nowMs]
  );
  const allAwaitingConfirmationCardIds = useMemo(
    () =>
      new Set(
        cards
          .filter((card) => getPromptActivityState({ card, nowMs }) === 'awaiting-confirmation')
          .map((card) => card.id)
      ),
    [cards, nowMs]
  );
  const sortedListCards = useMemo(
    () => sortCardsByPriorityAndTime(cards, allAwaitingConfirmationCardIds),
    [cards, allAwaitingConfirmationCardIds]
  );
  const handleSubmit = () => {
    if (!draft.content.trim()) return;
    onManualSubmit();
    if (shouldOverwriteUnusedDraft(draft)) {
      postMessage({
        type: 'card:update',
        payload: {
          cardId: draft.editingCardId!,
          ...buildDraftPayload(draft)
        }
      });
      onDraftChange({ title: '', content: '', fileRefs: [], editingCardId: undefined, editingCardStatus: undefined, cursorIndex: undefined });
      return;
    }

    postMessage({
      type: 'draft:autosave',
      payload: buildDraftPayload(draft)
    });
  };

  const handleEditInComposer = (card: PromptCard) => {
    onDraftChange({
      title: card.title,
      content: card.content,
      fileRefs: card.fileRefs,
      editingCardId: card.id,
      editingCardStatus: card.status,
      cursorIndex: card.content.length
    });

    composerSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    queueMicrotask(() => {
      composerTextareaRef.current?.focus();
    });
  };

  const handleNewDraft = () => {
    if (draft.content.trim()) {
      if (shouldOverwriteUnusedDraft(draft)) {
        postMessage({
          type: 'card:update',
          payload: {
            cardId: draft.editingCardId!,
            ...buildDraftPayload(draft)
          }
        });
      } else {
        postMessage({
          type: 'draft:autosave',
          payload: buildDraftPayload(draft)
        });
      }
    }
    onDraftChange({ title: '', content: '', fileRefs: [], editingCardId: undefined, editingCardStatus: undefined, cursorIndex: undefined });
  };

  const handleFileDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
    if (!hasDroppedPaths(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDroppingFiles(true);
  };

  const handleFileDragLeave = (event: DragEvent<HTMLTextAreaElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDroppingFiles(false);
  };

  const handleFileDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    if (hasDroppedPaths(event)) {
      event.preventDefault();
      event.stopPropagation();
    }

    const filePaths = collectDroppedPaths(event);
    setIsDroppingFiles(false);
    if (!filePaths.length) return;

    postMessage({
      type: 'composer:importFiles',
      payload: {
        filePaths,
        insertAt: event.currentTarget.selectionStart ?? draft.cursorIndex
      }
    });
  };

  return (
    <div className="workspace-page">
      <Composer
        language={language}
        draft={draft}
        onChange={onDraftChange}
        onFileDragOver={handleFileDragOver}
        onFileDragLeave={handleFileDragLeave}
        onFileDrop={handleFileDrop}
        onSubmit={handleSubmit}
        onNewDraft={handleNewDraft}
        onUndoImport={onUndoImport}
        canUndoImport={(draft.importUndoStack?.length ?? 0) > 0}
        isDroppingFiles={isDroppingFiles}
        sectionRef={composerSectionRef}
        textareaRef={composerTextareaRef}
      />
      <div className="workspace-topbar">
        <div>
          <h2>{localeText.workspace.promptStatusHeading}</h2>
          <p className="workspace-subtitle">
            {layout === 'lanes' ? localeText.workspace.promptStatusLanesSubtitle : localeText.workspace.promptStatusListSubtitle}
          </p>
        </div>
        <div className="workspace-topbar-right">
          <div className="workspace-view-toggle" role="tablist" aria-label={localeText.workspace.promptStatusViewAriaLabel}>
            <button
              type="button"
              className={`workspace-view-toggle-btn${layout === 'lanes' ? ' workspace-view-toggle-btn--active' : ''}`}
              aria-pressed={layout === 'lanes'}
              onClick={() => setLayout('lanes')}
            >
              {localeText.workspace.boardView}
            </button>
            <button
              type="button"
              className={`workspace-view-toggle-btn${layout === 'list' ? ' workspace-view-toggle-btn--active' : ''}`}
              aria-pressed={layout === 'list'}
              onClick={() => setLayout('list')}
            >
              {localeText.workspace.listView}
            </button>
          </div>
        </div>
      </div>
      {layout === 'lanes' ? (
        <>
          <div className="workspace-lanes">
            {laneOrder.map((status) => {
              const laneCards = sortCardsByCreatedAt(visibleCards.filter((card) => card.status === status));

              return (
              <PromptLane
                key={status}
                language={language}
                status={status}
                cards={laneCards}
                awaitingConfirmationCardIds={awaitingConfirmationCardIds}
                onMoveCard={onMoveCard}
                onAcknowledgeCompletion={onAcknowledgeCompletion}
                onRenameGroup={onRenameGroup}
                onEditInComposer={handleEditInComposer}
                onLaneBulkAction={(laneStatus, targetCards) => {
                  if (targetCards.length === 0) return;
                  if (laneStatus === 'completed') {
                    for (const card of targetCards) {
                      onAcknowledgeCompletion(card.id);
                    }
                  } else {
                    for (const card of targetCards) {
                      onMoveCard(card.id, 'completed');
                    }
                  }
                }}
                onLaneBulkDelete={(_laneStatus, targetCards) => {
                  if (targetCards.length === 0) return;
                  for (const card of targetCards) {
                    onDeleteCard(card.id);
                  }
                }}
              />
              );
            })}
          </div>
          <TrashZone language={language} onDrop={onDeleteCard} />
        </>
      ) : (
        <section className="workspace-list" aria-label={localeText.workspace.listViewAriaLabel}>
          {sortedListCards.length ? (
            sortedListCards.map((card) => (
              <PromptCardItem
                key={card.id}
                language={language}
                card={card}
                draggable={false}
                showStatusBadge
                showCreatedAt
                showDeleteButton
                showAwaitingConfirmation={allAwaitingConfirmationCardIds.has(card.id)}
                onMoveCard={onMoveCard}
                onAcknowledgeCompletion={onAcknowledgeCompletion}
                onRenameGroup={onRenameGroup}
                onEditInComposer={handleEditInComposer}
                onDeleteCard={onDeleteCard}
              />
            ))
          ) : (
            <div className="prompt-lane-empty">{localeText.workspace.emptyLane}</div>
          )}
        </section>
      )}
    </div>
  );
}
