import { useEffect, useRef } from 'react';
import type { PrompterToastMessage } from '../../../src/shared/messages';

const TOAST_AUTO_DISMISS_MS = 10000;

interface ToastViewportProps {
  toasts: PrompterToastMessage[];
  onDismiss: (id: string) => void;
  onAction: (toast: PrompterToastMessage) => void;
}

interface ToastItemProps {
  toast: PrompterToastMessage;
  onDismiss: (id: string) => void;
  onAction: (toast: PrompterToastMessage) => void;
}

function ToastItem({ toast, onDismiss, onAction }: ToastItemProps) {
  const timeoutIdRef = useRef<number | null>(null);

  const clearDismissTimer = () => {
    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  };

  const scheduleDismiss = () => {
    clearDismissTimer();
    timeoutIdRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, TOAST_AUTO_DISMISS_MS);
  };

  useEffect(() => {
    scheduleDismiss();
    return clearDismissTimer;
  }, [toast.id]);

  return (
    <div
      className={`toast toast--${toast.kind}`}
      data-toast-id={toast.id}
      onMouseEnter={clearDismissTimer}
      onMouseLeave={scheduleDismiss}
      role="status"
    >
      <div className="toast__body">
        <p className="toast__message">{toast.message}</p>
        <div className="toast__actions">
          {toast.actionLabel ? (
            <button className="toast__button" type="button" onClick={() => onAction(toast)}>
              {toast.actionLabel}
            </button>
          ) : null}
          <button className="toast__button toast__button--ghost" type="button" onClick={() => onDismiss(toast.id)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastViewport({ toasts, onDismiss, onAction }: ToastViewportProps) {
  return (
    <div className="toast-viewport" aria-label="Prompter notifications" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} onAction={onAction} />
      ))}
    </div>
  );
}
