import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { getLocaleText } from '../shared/i18n';
import type { BuiltinTone, PrompterState } from '../shared/models';
import type { WebviewToExtensionMessage } from '../shared/messages';
import type { PromptRepository } from '../state/PromptRepository';
import { formatFilePathImport } from '../services/PromptImportService';
import { getWebviewHtml } from './getWebviewHtml';
import { log, logError } from '../logger';

export class PrompterPanel {
  private static currentPanel: PrompterPanel | undefined;

  static async createOrShow(
    extensionUri: vscode.Uri,
    repository: PromptRepository,
    actions?: {
      switchDataDir: (request: { targetDir: string; migrate: boolean }) => Promise<PrompterState>;
      applyShortcuts?: (shortcuts: PrompterState['settings']['shortcuts']) => Promise<void>;
      onUserActivity?: () => void;
      startHistoryImport?: () => Promise<void>;
      pauseHistoryImport?: () => Promise<void>;
    }
  ): Promise<void> {
    if (PrompterPanel.currentPanel) {
      PrompterPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel('prompter', 'Prompter', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    const instance = new PrompterPanel(panel, extensionUri, repository, actions);
    PrompterPanel.currentPanel = instance;
    await instance.render();
  }

  static postMessage(message: { type: 'composer:insertText'; payload: { text: string; fileRefs?: { path: string; startLine?: number; endLine?: number }[] } }): Thenable<boolean> | undefined {
    return PrompterPanel.currentPanel?.panel.webview.postMessage(message);
  }

  static async showView(repository: PromptRepository, view: PrompterState['activeView']): Promise<void> {
    if (!PrompterPanel.currentPanel) {
      return;
    }

    const state = await repository.getState();
    await PrompterPanel.currentPanel.panel.webview.postMessage({
      type: 'state:replace',
      payload: {
        ...state,
        activeView: view
      }
    });
  }

  static playCompletionTone(tone: BuiltinTone): void {
    PrompterPanel.currentPanel?.panel.webview.postMessage({
      type: 'audio:play',
      payload: { tone }
    });
  }

  static playCustomTone(filePath: string): void {
    const cmd = process.platform === 'darwin' ? 'afplay'
      : process.platform === 'win32' ? 'powershell'
      : 'aplay';
    const args = process.platform === 'win32'
      ? ['-c', `(New-Object System.Media.SoundPlayer '${filePath}').PlaySync()`]
      : [filePath];
    execFile(cmd, args, (error) => {
      if (error) {
        logError(`Failed to play custom tone: ${filePath}`, error);
      }
    });
  }

  static async refresh(repository: PromptRepository): Promise<void> {
    if (PrompterPanel.currentPanel) {
      const state = await repository.getState();
      PrompterPanel.currentPanel.panel.webview.postMessage({ type: 'state:replace', payload: state });
    }
  }

  static async syncHistoryImport(repository: PromptRepository): Promise<void> {
    if (PrompterPanel.currentPanel) {
      const state = await repository.getState();
      PrompterPanel.currentPanel.panel.webview.postMessage({
        type: 'historyImport:updated',
        payload: state.historyImport
      });
    }
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly repository: PromptRepository,
    private readonly actions?: {
      switchDataDir: (request: { targetDir: string; migrate: boolean }) => Promise<PrompterState>;
      applyShortcuts?: (shortcuts: PrompterState['settings']['shortcuts']) => Promise<void>;
      onUserActivity?: () => void;
      startHistoryImport?: () => Promise<void>;
      pauseHistoryImport?: () => Promise<void>;
    }
  ) {
    this.panel.onDidDispose(() => {
      PrompterPanel.currentPanel = undefined;
    });
  }

  async render(): Promise<void> {
    this.panel.webview.html = getWebviewHtml(this.panel.webview, this.extensionUri);
    this.panel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      this.actions?.onUserActivity?.();

      if (message.type === 'ready') {
        this.panel.webview.postMessage({ type: 'hydrate', payload: await this.repository.getState() });
      }

      if (message.type === 'view:set') {
        const nextState = this.withActiveView(await this.repository.getState(), message.payload.view);
        this.panel.webview.postMessage({ type: 'state:replace', payload: nextState });
      }

      if (message.type === 'historyImport:start') {
        const state = await this.repository.getState();
        if (!state.historyImport.warningAcknowledged) {
          const localeText = getLocaleText(state.settings.language);
          const confirmLabel = state.settings.language === 'en' ? 'Start' : '开始';
          const cancelLabel = state.settings.language === 'en' ? 'Cancel' : '取消';
          const choice = await vscode.window.showWarningMessage(
            localeText.history.importWarning,
            confirmLabel,
            cancelLabel
          );

          if (choice !== confirmLabel) {
            return;
          }

          await this.repository.setHistoryImport({ warningAcknowledged: true });
        }

        await this.actions?.startHistoryImport?.();
      }

      if (message.type === 'historyImport:pause') {
        await this.actions?.pauseHistoryImport?.();
      }

      if (message.type === 'draft:autosave') {
        const card = await this.repository.saveDraft({
          title: message.payload.title,
          content: message.payload.content,
          sourceType: 'manual',
          fileRefs: message.payload.fileRefs
        });

        this.panel.webview.postMessage({
          type: 'draft:saved',
          payload: {
            card,
            state: await this.repository.getState()
          }
        });
      }

      if (message.type === 'composer:importFiles') {
        const text = message.payload.filePaths
          .map((filePath) => formatFilePathImport(filePath, undefined, 'absolute'))
          .join('\n');

        this.panel.webview.postMessage({
          type: 'composer:insertText',
          payload: {
            text,
            fileRefs: message.payload.filePaths.map((path) => ({ path })),
            insertAt: message.payload.insertAt
          }
        });
      }

      if (message.type === 'card:move') {
        await this.repository.moveCard(message.payload.cardId, message.payload.nextStatus);
        this.panel.webview.postMessage({
          type: 'cards:updated',
          payload: { state: await this.repository.getState() }
        });
      }

      if (message.type === 'card:delete') {
        await this.repository.deleteCard(message.payload.cardId);
        this.panel.webview.postMessage({
          type: 'cards:updated',
          payload: { state: await this.repository.getState() }
        });
      }

      if (message.type === 'card:acknowledgeCompletion') {
        await this.repository.acknowledgeCompletion(message.payload.cardId);
        this.panel.webview.postMessage({
          type: 'cards:updated',
          payload: { state: await this.repository.getState() }
        });
      }

      if (message.type === 'group:rename') {
        await this.repository.renameGroup(message.payload.groupId, message.payload.nextName);
        this.panel.webview.postMessage({
          type: 'cards:updated',
          payload: { state: await this.repository.getState() }
        });
      }

      if (message.type === 'card:update') {
        const card = await this.repository.updateCard(message.payload.cardId, {
          title: message.payload.title,
          content: message.payload.content,
          fileRefs: message.payload.fileRefs
        });
        const state = await this.repository.getState();
        if (card) {
          this.panel.webview.postMessage({
            type: 'card:updated',
            payload: { card, state }
          });
        } else {
          this.panel.webview.postMessage({
            type: 'cards:updated',
            payload: { state }
          });
        }
      }

      if (message.type === 'modularPrompt:save') {
        await this.repository.saveModularPrompt(message.payload);
        this.panel.webview.postMessage({
          type: 'modularPrompts:updated',
          payload: { state: await this.repository.getState() }
        });
      }

      if (message.type === 'settings:update') {
        if (message.payload.shortcuts) {
          if (!this.actions?.applyShortcuts) {
            const state = await this.repository.getState();
            this.panel.webview.postMessage({
              type: 'settings:shortcuts:update:error',
              payload: {
                message: getLocaleText(state.settings.language).host.errors.shortcutUnavailable
              }
            });
            this.panel.webview.postMessage({
              type: 'state:replace',
              payload: await this.repository.getState()
            });
          } else {
            const beforeState = await this.repository.getState();
            try {
              await this.actions.applyShortcuts(message.payload.shortcuts);
              await this.repository.updateSettings(message.payload);
              this.panel.webview.postMessage({
                type: 'state:replace',
                payload: await this.repository.getState()
              });
              this.panel.webview.postMessage({
                type: 'settings:shortcuts:update:success',
                payload: { shortcuts: message.payload.shortcuts }
              });
            } catch (error) {
              const localeText = getLocaleText(beforeState.settings.language);
              try {
                await this.actions.applyShortcuts(beforeState.settings.shortcuts);
              } catch (rollbackError) {
                this.panel.webview.postMessage({
                  type: 'settings:shortcuts:update:error',
                  payload: {
                    message: localeText.host.errors.shortcutRollbackFailed(
                      rollbackError instanceof Error ? rollbackError.message : undefined
                    )
                  }
                });
              }

              this.panel.webview.postMessage({
                type: 'settings:shortcuts:update:error',
                payload: {
                  message: localeText.host.errors.shortcutApplyFailed(error instanceof Error ? error.message : undefined)
                }
              });
              this.panel.webview.postMessage({
                type: 'state:replace',
                payload: await this.repository.getState()
              });
            }
          }
        } else {
          await this.repository.updateSettings(message.payload);
          this.panel.webview.postMessage({
            type: 'state:replace',
            payload: await this.repository.getState()
          });
        }
      }

      if (message.type === 'settings:dataDirSwitch') {
        const nextState = await this.actions?.switchDataDir(message.payload);
        if (nextState) {
          this.panel.webview.postMessage({
            type: 'state:replace',
            payload: nextState
          });
        }
      }

      if (message.type === 'card:jumpToSource') {
        const { sourceType, sourceRef } = message.payload;
        try {
          if (sourceType === 'claude-code') {
            const sessionId = sourceRef;
            log(`Jumping to Claude Code session: ${sessionId}`);
            // claude-vscode.editor.open accepts (sessionId, prompt, ViewColumn)
            // Use ViewColumn.Beside to open beside the current editor (right side)
            await vscode.commands.executeCommand(
              'claude-vscode.editor.open',
              sessionId,
              undefined,
              vscode.ViewColumn.Beside
            );
          } else if (sourceType === 'codex') {
            // sourceRef format: "rollout-TIMESTAMP-UUID:TURN_ID" or "rollout-TIMESTAMP-UUID"
            const filenamePart = sourceRef.includes(':') ? sourceRef.split(':')[0] : sourceRef;
            // Extract the UUID from the filename
            const uuidMatch = filenamePart.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            const sessionId = uuidMatch ? uuidMatch[0] : filenamePart;
            log(`Jumping to Codex session: ${sessionId} (from sourceRef: ${sourceRef})`);
            // Navigate Codex extension sidebar to the session via URI handler
            // URI format: <scheme>://openai.chatgpt/local/<conversationId>
            const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${sessionId}`);
            await vscode.env.openExternal(uri);
          } else if (sourceType === 'roo-code') {
            log(`Jumping to Roo Code task: ${sourceRef}`);
            await vscode.commands.executeCommand('cline.historyButtonClicked');
          }
        } catch (error) {
          logError(`Failed to jump to source: ${sourceType}/${sourceRef}`, error);
          const state = await this.repository.getState();
          vscode.window.showErrorMessage(getLocaleText(state.settings.language).host.errors.jumpToSourceFailed(sourceType));
        }
      }

      if (message.type === 'settings:previewCustomTone') {
        const { filePath } = message.payload;
        if (filePath) {
          PrompterPanel.playCustomTone(filePath);
        }
      }

      if (message.type === 'cache:clear') {
        await this.repository.clearCache();
        this.panel.webview.postMessage({
          type: 'state:replace',
          payload: await this.repository.getState()
        });
      }
    });
  }

  private withActiveView(state: PrompterState, activeView: PrompterState['activeView']): PrompterState {
    return {
      ...state,
      activeView
    };
  }
}
