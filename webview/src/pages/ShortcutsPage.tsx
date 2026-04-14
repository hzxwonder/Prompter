import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PrompterCommandId, PrompterSettings } from '../../../src/shared/models';
import { getLocaleText, getShortcutLabel } from '../i18n';

const COMMAND_ORDER: PrompterCommandId[] = [
  'prompter.open',
  'prompter.importSelection',
  'prompter.importResource',
  'prompter.importTerminalSelection'
];

const IMPORT_COMMANDS = new Set<PrompterCommandId>([
  'prompter.importSelection',
  'prompter.importResource',
  'prompter.importTerminalSelection'
]);

function normalizeShortcut(event: ReactKeyboardEvent | KeyboardEvent): string | null {
  const parts: string[] = [];
  const modifierKeys = new Set(['Meta', 'Control', 'Alt', 'Shift']);

  if ('metaKey' in event && event.metaKey) parts.push('cmd');
  if ('ctrlKey' in event && event.ctrlKey) parts.push('ctrl');
  if ('altKey' in event && event.altKey) parts.push('alt');
  if ('shiftKey' in event && event.shiftKey) parts.push('shift');

  const rawKey = event.key;
  if (!rawKey || modifierKeys.has(rawKey)) {
    return null;
  }

  const normalizedKey = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey.toLowerCase();
  return [...parts, normalizedKey].join('+');
}

function getConflictMessage(
  command: PrompterCommandId,
  keybinding: string,
  shortcuts: PrompterSettings['shortcuts'],
  language: PrompterSettings['language']
): string | undefined {
  const localeText = getLocaleText(language);
  if (!keybinding) {
    return undefined;
  }

  const openBinding = shortcuts['prompter.open']?.keybinding ?? '';
  const importBindings = COMMAND_ORDER.filter((candidate) => IMPORT_COMMANDS.has(candidate)).map(
    (candidate) => shortcuts[candidate]?.keybinding ?? ''
  );

  if (command === 'prompter.open') {
    if (importBindings.includes(keybinding)) {
      return localeText.shortcuts.conflictOpen;
    }
    return undefined;
  }

  if (IMPORT_COMMANDS.has(command) && keybinding === openBinding) {
    const label = getShortcutLabel(command, language);
    return localeText.shortcuts.conflictWithOpen(label);
  }

  return undefined;
}

function updateShortcuts(
  shortcuts: PrompterSettings['shortcuts'],
  command: PrompterCommandId,
  keybinding: string
): PrompterSettings['shortcuts'] {
  return {
    ...shortcuts,
    [command]: {
      ...shortcuts[command],
      keybinding
    }
  };
}

function ShortcutKeyCaps({ binding, language }: { binding: string; language: PrompterSettings['language'] }) {
  const localeText = getLocaleText(language);

  return (
    <span className={`shortcut-binding${binding ? '' : ' shortcut-binding--empty'}`}>
      {binding || localeText.shortcuts.unassigned}
    </span>
  );
}

export function ShortcutsPage({
  settings,
  saveState,
  onSaveShortcuts
}: {
  settings: PrompterSettings;
  saveState: {
    status: 'idle' | 'saving' | 'success' | 'error';
    command: PrompterCommandId | null;
    message?: string;
  };
  onSaveShortcuts: (command: PrompterCommandId, shortcuts: PrompterSettings['shortcuts']) => void;
}) {
  const localeText = getLocaleText(settings.language);
  const [draftShortcuts, setDraftShortcuts] = useState(settings.shortcuts);
  const [recordingCommand, setRecordingCommand] = useState<PrompterCommandId | null>(null);
  const [previewShortcut, setPreviewShortcut] = useState<{ command: PrompterCommandId; keybinding: string } | null>(
    null
  );
  const [savingCommand, setSavingCommand] = useState<PrompterCommandId | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    setDraftShortcuts(settings.shortcuts);
  }, [settings.shortcuts]);

  useEffect(() => {
    if (saveState.status === 'success' && saveState.command) {
      setFeedback({
        kind: 'success',
        message: localeText.shortcuts.saved(getShortcutLabel(saveState.command, settings.language))
      });
      setPreviewShortcut(null);
      setSavingCommand(null);
      return;
    }

    if (saveState.status === 'error') {
      setFeedback({
        kind: 'error',
        message: saveState.message ?? localeText.shortcuts.saveFailed
      });
      setPreviewShortcut(null);
      setSavingCommand(null);
    }
  }, [draftShortcuts, localeText.shortcuts, saveState, settings.language]);

  useEffect(() => {
    if (feedback?.kind !== 'success') {
      return;
    }

    const timer = window.setTimeout(() => {
      setFeedback((current) => (current?.kind === 'success' ? null : current));
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  useEffect(() => {
    if (!recordingCommand) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setRecordingCommand(null);
        return;
      }

      const nextShortcut = normalizeShortcut(event);
      if (!nextShortcut) {
        return;
      }

      event.preventDefault();

      const conflictMessage = getConflictMessage(recordingCommand, nextShortcut, draftShortcuts, settings.language);
      if (conflictMessage) {
        setFeedback({ kind: 'error', message: conflictMessage });
        setRecordingCommand(null);
        return;
      }

      setFeedback(null);
      const nextShortcuts = updateShortcuts(draftShortcuts, recordingCommand, nextShortcut);
      setPreviewShortcut({ command: recordingCommand, keybinding: nextShortcut });
      setSavingCommand(recordingCommand);
      onSaveShortcuts(recordingCommand, nextShortcuts);
      setRecordingCommand(null);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [draftShortcuts, onSaveShortcuts, recordingCommand, settings.language]);

  const resetToDefault = (command: PrompterCommandId) => {
    const defaultBinding = draftShortcuts[command]?.defaultKeybinding ?? '';
    setFeedback(null);
    setRecordingCommand(null);
    setPreviewShortcut({ command, keybinding: defaultBinding });
    setSavingCommand(command);
    onSaveShortcuts(command, updateShortcuts(draftShortcuts, command, defaultBinding));
  };

  return (
    <div className="shortcuts-page">
      <section className="shortcuts-header" aria-labelledby="shortcuts-heading">
        <h1 id="shortcuts-heading">{localeText.shortcuts.heading}</h1>
        <p className="shortcuts-header-text">{localeText.shortcuts.subtitle}</p>
      </section>

      {feedback ? (
        <div className={`shortcuts-feedback shortcuts-feedback--${feedback.kind}`} role="status">
          {feedback.message}
        </div>
      ) : null}

      <div className="shortcuts-table" role="table" aria-label={localeText.shortcuts.tableAriaLabel}>
        <div className="shortcuts-table-head" role="row">
          <span role="columnheader">{localeText.shortcuts.commandColumn}</span>
          <span role="columnheader">{localeText.shortcuts.shortcutColumn}</span>
          <span role="columnheader" aria-hidden="true"></span>
          <span role="columnheader" aria-hidden="true"></span>
        </div>
        {COMMAND_ORDER.map((command) => {
          const shortcut = draftShortcuts[command];
          const shortcutLabelText = getShortcutLabel(command, settings.language);
          const displayBinding = previewShortcut?.command === command ? previewShortcut.keybinding : shortcut.keybinding;
          const isRecording = recordingCommand === command;
          const isSaving = savingCommand === command;
          const shortcutLabel = displayBinding || '';
          const statusLabel = isRecording ? localeText.shortcuts.listening : isSaving ? localeText.shortcuts.saving : null;

          return (
            <div
              key={command}
              role="row"
              aria-label={shortcutLabelText}
              className={`shortcut-row${isRecording ? ' shortcut-row--recording' : ''}${isSaving ? ' shortcut-row--pending' : ''}`}
            >
              <div className="shortcut-row-command" role="cell">
                <span>{shortcutLabelText}</span>
              </div>
              <div className="shortcut-row-binding" role="cell">
                <ShortcutKeyCaps binding={shortcutLabel} language={settings.language} />
                {statusLabel ? <span className="shortcut-row-state">{statusLabel}</span> : null}
              </div>
              <div className="shortcut-row-action" role="cell">
                <button
                  type="button"
                  className="shortcut-row-button"
                  onClick={() => {
                    setFeedback(null);
                    setRecordingCommand(command);
                  }}
                  disabled={isSaving}
                  aria-label={
                    isSaving
                      ? localeText.shortcuts.savingAriaLabel(shortcutLabelText)
                      : localeText.shortcuts.editAriaLabel(shortcutLabelText)
                  }
                >
                  {localeText.shortcuts.edit}
                </button>
              </div>
              <div className="shortcut-row-action" role="cell">
                <button
                  type="button"
                  className="shortcut-row-button shortcut-row-button--secondary"
                  onClick={() => resetToDefault(command)}
                  disabled={isSaving}
                  aria-label={localeText.shortcuts.resetAriaLabel(shortcutLabelText)}
                >
                  {localeText.shortcuts.reset}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
