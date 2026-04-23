import { useEffect, useRef, useState, type Ref } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import type { PrompterSettings } from '../../../src/shared/models';
import { getLocaleText } from '../i18n';
import type { WorkspaceDraft } from '../store/prompterReducer';

function NewPageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1zM8 8a.5.5 0 0 1 .5.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1A.5.5 0 0 1 8 8z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
    </svg>
  );
}

function setRef<T>(ref: Ref<T> | undefined, value: T) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  ref.current = value;
}

export function Composer({
  language = 'zh-CN',
  draft,
  onChange,
  onFileDragOver,
  onFileDragLeave,
  onFileDrop,
  onSubmit,
  onNewDraft,
  onUndoImport,
  canUndoImport = false,
  isDroppingFiles = false,
  sectionRef,
  textareaRef: externalTextareaRef
}: {
  language?: PrompterSettings['language'];
  draft: WorkspaceDraft;
  onChange: (nextDraft: Partial<WorkspaceDraft>) => void;
  onFileDragOver?: (event: DragEvent<HTMLTextAreaElement>) => void;
  onFileDragLeave?: (event: DragEvent<HTMLTextAreaElement>) => void;
  onFileDrop?: (event: DragEvent<HTMLTextAreaElement>) => void;
  onSubmit?: () => void;
  onNewDraft?: () => void;
  onUndoImport?: () => void;
  canUndoImport?: boolean;
  isDroppingFiles?: boolean;
  sectionRef?: Ref<HTMLElement>;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const localeText = getLocaleText(language);
  const [titleOpen, setTitleOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleFieldChange =
    (field: keyof WorkspaceDraft) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (field === 'content') {
        onChange({
          content: event.target.value,
          cursorIndex: (event.target as HTMLTextAreaElement).selectionStart ?? event.target.value.length
        });
        return;
      }

      onChange({ [field]: event.target.value });
    };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      onSubmit?.();
      return;
    }

    // Ctrl+Z (or Cmd+Z on mac) undoes the last import — only when an import
    // snapshot is available; otherwise let the browser handle native undo.
    const isUndoShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
    if (isUndoShortcut && canUndoImport && onUndoImport) {
      event.preventDefault();
      onUndoImport();
    }
  };

  const handleClear = () => {
    onChange({
      title: '',
      content: '',
      fileRefs: [],
      editingCardId: undefined,
      editingCardStatus: undefined,
      cursorIndex: 0
    });
    setTitleOpen(false);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (!textareaRef.current || draft.cursorIndex === undefined) {
      return;
    }

    const textarea = textareaRef.current;
    const hasRangeSelection = (textarea.selectionStart ?? 0) !== (textarea.selectionEnd ?? 0);
    if (document.activeElement === textarea && hasRangeSelection) {
      return;
    }

    textarea.setSelectionRange(draft.cursorIndex, draft.cursorIndex);
  }, [draft.content, draft.cursorIndex]);

  return (
    <section
      ref={(node) => setRef(sectionRef, node)}
      className="composer-panel"
      aria-label={localeText.workspace.composerAriaLabel}
    >
      <div className="panel-header">
        <div className="composer-header-actions">
          <button
            type="button"
            className={`composer-title-toggle${titleOpen ? ' composer-title-toggle--open' : ''}`}
            onClick={() => setTitleOpen((v) => !v)}
            title={titleOpen ? localeText.workspace.titleToggleOpenTitle : localeText.workspace.titleToggleClosedTitle}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm0 4a1 1 0 0 1 1-1h10a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm1 3a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H3z"/>
            </svg>
            {localeText.workspace.titleToggle}
          </button>
          <button
            type="button"
            className="composer-new-btn"
            onClick={onNewDraft}
            title={localeText.workspace.newDraftTitle}
          >
            <NewPageIcon />
          </button>
          <button
            type="button"
            className="composer-clear-btn"
            onClick={handleClear}
            title={localeText.workspace.clearPromptTitle}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {titleOpen && (
        <label className="field">
          <input
            type="text"
            aria-label={localeText.workspace.titleInputAriaLabel}
            value={draft.title}
            onChange={handleFieldChange('title')}
            placeholder={localeText.workspace.titlePlaceholder}
            autoFocus
          />
        </label>
      )}

      <label className="field field-grow">
        <textarea
          ref={(node) => {
            textareaRef.current = node;
            setRef(externalTextareaRef, node);
          }}
          aria-label={localeText.workspace.promptInputAriaLabel}
          value={draft.content}
          onChange={handleFieldChange('content')}
          onKeyDown={handleKeyDown}
          onSelect={(event) => onChange({ cursorIndex: event.currentTarget.selectionStart ?? undefined })}
          onClick={(event) => onChange({ cursorIndex: event.currentTarget.selectionStart ?? undefined })}
          onKeyUp={(event) => onChange({ cursorIndex: event.currentTarget.selectionStart ?? undefined })}
          onDragOver={onFileDragOver}
          onDragLeave={onFileDragLeave}
          onDrop={onFileDrop}
          data-dropping-files={isDroppingFiles ? 'true' : 'false'}
          placeholder={localeText.workspace.promptPlaceholder}
        />
      </label>
      <div className="composer-actions">
        <span className="composer-hint">Ctrl+Enter</span>
        <button type="button" className="submit-button" onClick={onSubmit}>
          {localeText.workspace.submitButton}
        </button>
      </div>
    </section>
  );
}
