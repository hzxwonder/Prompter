import type { PrompterSettings } from '../../../src/shared/models';
import { getLocaleText } from '../i18n';

export function DeleteConfirmOverlay({
  language = 'zh-CN',
  count,
  onConfirm,
  onConfirmAndSuppress,
  onCancel
}: {
  language?: PrompterSettings['language'];
  count: number;
  onConfirm: () => void;
  onConfirmAndSuppress: () => void;
  onCancel: () => void;
}) {
  const localeText = getLocaleText(language);

  return (
    <div className="delete-confirm-overlay" role="dialog" aria-modal="true" aria-label={localeText.card.deleteSessionConfirmTitle}>
      <div className="delete-confirm-overlay__panel">
        <h3 className="delete-confirm-overlay__title">{localeText.card.deleteSessionConfirmTitle}</h3>
        <p className="delete-confirm-overlay__body">{localeText.card.deleteSessionConfirmBody(count)}</p>
        <div className="delete-confirm-overlay__actions">
          <button
            type="button"
            className="delete-confirm-overlay__btn delete-confirm-overlay__btn--ghost"
            onClick={onCancel}
            autoFocus
          >
            {localeText.card.deleteSessionConfirmCancel}
          </button>
          <button
            type="button"
            className="delete-confirm-overlay__btn delete-confirm-overlay__btn--subtle"
            onClick={onConfirmAndSuppress}
          >
            {localeText.card.deleteSessionConfirmDontAsk}
          </button>
          <button
            type="button"
            className="delete-confirm-overlay__btn delete-confirm-overlay__btn--danger"
            onClick={onConfirm}
          >
            {localeText.card.deleteSessionConfirmOk}
          </button>
        </div>
      </div>
    </div>
  );
}
