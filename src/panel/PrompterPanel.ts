import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { getLocaleText } from '../shared/i18n';
import type { BuiltinTone, PrompterState } from '../shared/models';
import type { PrompterToastMessage, WebviewToExtensionMessage } from '../shared/messages';
import type { PromptRepository } from '../state/PromptRepository';
import { formatFilePathImport } from '../services/PromptImportService';
import { getWebviewHtml } from './getWebviewHtml';
import { log, logError, logWarn } from '../logger';

export class PrompterPanel {
  private static currentPanel: PrompterPanel | undefined;
  private static hostToneFilePaths = new Map<BuiltinTone, string>();

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
    if (PrompterPanel.currentPanel) {
      log(`[PrompterPanel] Completion tone requested: ${tone}, using host playback even though the panel is open`);
    } else {
      log(`[PrompterPanel] Completion tone requested: ${tone}, using host fallback playback`);
    }

    PrompterPanel.playHostBuiltinTone(tone);
  }

  static playCompletionToneInWebviewIfOpen(tone: BuiltinTone): boolean {
    if (!PrompterPanel.currentPanel) {
      log(`[PrompterPanel] Webview tone requested for ${tone}, but no active panel is open`);
      return false;
    }

    log(`[PrompterPanel] Completion tone requested: ${tone}, using active webview playback`);
    PrompterPanel.currentPanel.panel.webview.postMessage({
      type: 'audio:play',
      payload: { tone }
    });
    return true;
  }

  static showToast(payload: PrompterToastMessage): Thenable<boolean> | undefined {
    return PrompterPanel.currentPanel?.panel.webview.postMessage({
      type: 'toast:show',
      payload
    });
  }

  static playCustomTone(filePath: string): void {
    const cmd = process.platform === 'darwin' ? 'afplay'
      : process.platform === 'win32' ? 'powershell'
      : 'aplay';
    const args = process.platform === 'win32'
      ? ['-c', `(New-Object System.Media.SoundPlayer '${filePath}').PlaySync()`]
      : [filePath];
    log(`[PrompterPanel] Playing custom tone via ${cmd}: ${filePath}`);
    execFile(cmd, args, (error) => {
      if (error) {
        logError(`Failed to play custom tone: ${filePath}`, error);
      }
    });
  }

  private static playHostBuiltinTone(tone: BuiltinTone): void {
    const toneFilePath = PrompterPanel.ensureHostToneFile(tone);
    log(`[PrompterPanel] Host tone playback starting for ${tone} on ${process.platform} using ${toneFilePath}`);

    const runFallbackBell = () => {
      log(`[PrompterPanel] Falling back to shell bell for tone: ${tone}`);
      execFile('sh', ['-lc', 'printf "\\a"'], (error) => {
        if (error) {
          logError(`Failed to play fallback bell for tone: ${tone}`, error);
        }
      });
    };

    if (process.platform === 'darwin') {
      log(`[PrompterPanel] Using afplay for built-in tone: ${tone}`);
      execFile('afplay', [toneFilePath], (error) => {
        if (error) {
          logError(`Failed to play host tone: ${tone}`, error);
        }
      });
      return;
    }

    if (process.platform === 'win32') {
      log(`[PrompterPanel] Using PowerShell SoundPlayer for built-in tone: ${tone}`);
      execFile(
        'powershell',
        ['-c', `(New-Object System.Media.SoundPlayer '${toneFilePath.replace(/'/g, "''")}').PlaySync()`],
        (error) => {
          if (error) {
            logError(`Failed to play host tone: ${tone}`, error);
          }
        }
      );
      return;
    }

    log(`[PrompterPanel] Using Linux audio player chain for built-in tone: ${tone}`);
    execFile('aplay', [toneFilePath], (error) => {
      if (!error) {
        log(`[PrompterPanel] aplay succeeded for tone: ${tone}`);
        return;
      }
      logWarn(`[PrompterPanel] aplay failed for tone ${tone}, trying paplay next`);
      execFile('paplay', [toneFilePath], (paplayError) => {
        if (!paplayError) {
          log(`[PrompterPanel] paplay succeeded for tone: ${tone}`);
          return;
        }
        logWarn(`[PrompterPanel] paplay failed for tone ${tone}, trying shell bell fallback`);
        if (paplayError) {
          runFallbackBell();
        }
      });
    });
  }

  private static ensureHostToneFile(tone: BuiltinTone): string {
    const existing = PrompterPanel.hostToneFilePaths.get(tone);
    if (existing && existsSync(existing)) {
      log(`[PrompterPanel] Reusing cached host tone file for ${tone}: ${existing}`);
      return existing;
    }

    const tonesDir = join(tmpdir(), 'prompter-tones');
    mkdirSync(tonesDir, { recursive: true });
    const targetPath = join(tonesDir, `${tone}.wav`);
    writeFileSync(targetPath, buildToneWavBuffer(tone));
    PrompterPanel.hostToneFilePaths.set(tone, targetPath);
    log(`[PrompterPanel] Generated host tone file for ${tone}: ${targetPath}`);
    return targetPath;
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
        const state = await this.repository.getState();
        const localeText = getLocaleText(state.settings.language);
        const choice = await vscode.window.showWarningMessage(
          localeText.host.confirmations.clearCacheMessage,
          localeText.host.confirmations.clearCacheConfirm,
          localeText.host.confirmations.cancel
        );

        if (choice !== localeText.host.confirmations.clearCacheConfirm) {
          return;
        }

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

function buildToneWavBuffer(tone: BuiltinTone): Buffer {
  const sampleRate = 44100;
  const durationSeconds = tone === 'ding' ? 0.18 : 0.34;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 2);

  const tones: Record<BuiltinTone, Array<{ freq: number; gain: number; start: number; end: number }>> = {
    'soft-bell': [
      { freq: 830, gain: 0.28, start: 0, end: 0.3 },
      { freq: 1245, gain: 0.14, start: 0, end: 0.2 }
    ],
    chime: [
      { freq: 523.25, gain: 0.22, start: 0, end: 0.24 },
      { freq: 659.25, gain: 0.18, start: 0.08, end: 0.32 },
      { freq: 783.99, gain: 0.18, start: 0.16, end: 0.34 }
    ],
    ding: [
      { freq: 1200, gain: 0.35, start: 0, end: 0.15 }
    ]
  };

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    let sample = 0;

    for (const partial of tones[tone]) {
      if (t < partial.start || t > partial.end) {
        continue;
      }
      const relativeT = t - partial.start;
      const lifetime = partial.end - partial.start;
      const envelope = Math.exp((-6 * relativeT) / lifetime);
      sample += Math.sin(2 * Math.PI * partial.freq * relativeT) * partial.gain * envelope;
    }

    const clamped = Math.max(-1, Math.min(1, sample));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}
