import type { DragEvent } from 'react';
import type { PromptCard as PromptCardModel, PromptStatus, PrompterSettings } from '../../../src/shared/models';
import { getLocaleText } from '../i18n';
import { PromptCard } from './PromptCard';

export function PromptLane({
  language = 'zh-CN',
  status,
  cards,
  awaitingConfirmationCardIds,
  onMoveCard,
  onAcknowledgeCompletion,
  onRenameGroup,
  onEditInComposer
}: {
  language?: PrompterSettings['language'];
  status: PromptStatus;
  cards: PromptCardModel[];
  awaitingConfirmationCardIds?: Set<string>;
  onMoveCard: (cardId: string, nextStatus: PromptStatus) => void;
  onAcknowledgeCompletion: (cardId: string) => void;
  onRenameGroup: (groupId: string, nextName: string) => void;
  onEditInComposer: (card: PromptCardModel) => void;
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

  return (
    <section
      className={`prompt-lane status-${status}`}
      aria-label={laneLabel}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="prompt-lane-header">
        <div>
          <h2>{laneLabel}</h2>
          <p>{localeText.workspace.cardCount(cards.length)}</p>
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
