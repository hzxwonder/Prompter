import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { PromptCard as PromptCardModel, PromptStatus, PrompterSettings } from '../../../src/shared/models';
import { getLocaleText } from '../i18n';
import { PromptCard } from './PromptCard';

const CONFIRM_WINDOW_MS = 3000;

function CheckAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022z" />
    </svg>
  );
}

function BulkDeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
      <path
        fillRule="evenodd"
        d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
      />
    </svg>
  );
}

export function PromptLane({
  language = 'zh-CN',
  status,
  cards,
  awaitingConfirmationCardIds,
  onMoveCard,
  onAcknowledgeCompletion,
  onRenameGroup,
  onEditInComposer,
  onLaneBulkAction,
  onLaneBulkDelete
}: {
  language?: PrompterSettings['language'];
  status: PromptStatus;
  cards: PromptCardModel[];
  awaitingConfirmationCardIds?: Set<string>;
  onMoveCard: (cardId: string, nextStatus: PromptStatus) => void;
  onAcknowledgeCompletion: (cardId: string) => void;
  onRenameGroup: (groupId: string, nextName: string) => void;
  onEditInComposer: (card: PromptCardModel) => void;
  onLaneBulkAction?: (status: PromptStatus, cards: PromptCardModel[]) => void;
  onLaneBulkDelete?: (status: PromptStatus, cards: PromptCardModel[]) => void;
}) {
  const localeText = getLocaleText(language);
  const laneLabel = localeText.laneLabels[status];

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain');
    const previousStatus = event.dataTransfer.getData('application/prompter-card-status') as PromptStatus;
    if (cardId && previousStatus !== status) {
      onMoveCard(cardId, status);
    }
  };

  const awaitingCards = status === 'completed'
    ? cards.filter((card) => card.justCompleted || awaitingConfirmationCardIds?.has(card.id))
    : [];
  const bulkActionEligibleCards = status === 'completed' ? awaitingCards : cards;
  const bulkActionEnabled = bulkActionEligibleCards.length > 0;
  const bulkDeleteEnabled = cards.length > 0;
  const bulkActionTitle = status === 'completed'
    ? localeText.workspace.laneBulkAcknowledgeTitle
    : localeText.workspace.laneBulkCompleteTitle;

  const [actionArmed, setActionArmed] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
  }, []);

  // Disarm the other button whenever one is armed (avoid ambiguous double-armed state).
  const disarmAction = () => {
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = null;
    setActionArmed(false);
  };
  const disarmDelete = () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = null;
    setDeleteArmed(false);
  };

  const handleBulkAction = () => {
    if (!bulkActionEnabled) return;
    if (!actionArmed) {
      disarmDelete();
      setActionArmed(true);
      actionTimerRef.current = setTimeout(() => {
        actionTimerRef.current = null;
        setActionArmed(false);
      }, CONFIRM_WINDOW_MS);
      return;
    }
    disarmAction();
    onLaneBulkAction?.(status, bulkActionEligibleCards);
  };

  const handleBulkDelete = () => {
    if (!bulkDeleteEnabled) return;
    if (!deleteArmed) {
      disarmAction();
      setDeleteArmed(true);
      deleteTimerRef.current = setTimeout(() => {
        deleteTimerRef.current = null;
        setDeleteArmed(false);
      }, CONFIRM_WINDOW_MS);
      return;
    }
    disarmDelete();
    onLaneBulkDelete?.(status, cards);
  };

  const actionButtonTitle = actionArmed ? localeText.workspace.laneConfirmAgainHint : bulkActionTitle;
  const deleteButtonTitle = deleteArmed ? localeText.workspace.laneConfirmAgainHint : localeText.workspace.laneBulkDeleteTitle;

  return (
    <section
      className={`prompt-lane status-${status}`}
      aria-label={laneLabel}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="prompt-lane-header">
        <div className="prompt-lane-header-main">
          <div>
            <h2>{laneLabel}</h2>
            <p>{localeText.workspace.cardCount(cards.length)}</p>
          </div>
          <div className="prompt-lane-header-actions">
            <button
              type="button"
              className={`prompt-lane-action-btn prompt-lane-action-btn--primary${actionArmed ? ' prompt-lane-action-btn--armed' : ''}`}
              aria-label={actionButtonTitle}
              title={actionButtonTitle}
              disabled={!bulkActionEnabled}
              onClick={handleBulkAction}
              onBlur={disarmAction}
            >
              <CheckAllIcon />
            </button>
            <button
              type="button"
              className={`prompt-lane-action-btn prompt-lane-action-btn--danger${deleteArmed ? ' prompt-lane-action-btn--armed' : ''}`}
              aria-label={deleteButtonTitle}
              title={deleteButtonTitle}
              disabled={!bulkDeleteEnabled}
              onClick={handleBulkDelete}
              onBlur={disarmDelete}
            >
              <BulkDeleteIcon />
            </button>
          </div>
        </div>
      </header>
      <div className="prompt-lane-list">
        {cards.length ? (
          cards.map((card) => (
            <PromptCard
              key={card.id}
              language={language}
              card={card}
              showAwaitingConfirmation={awaitingConfirmationCardIds?.has(card.id)}
              onMoveCard={onMoveCard}
              onAcknowledgeCompletion={onAcknowledgeCompletion}
              onRenameGroup={onRenameGroup}
              onEditInComposer={onEditInComposer}
            />
          ))
        ) : (
          <div className="prompt-lane-empty">{localeText.workspace.emptyLane}</div>
        )}
      </div>
    </section>
  );
}
