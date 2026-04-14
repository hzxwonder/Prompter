import * as vscode from 'vscode';
import { cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PrompterPanel } from './panel/PrompterPanel';
import { getLocaleText } from './shared/i18n';
import type { PrompterState } from './shared/models';
import { formatFilePathImport, formatSelectionImport } from './services/PromptImportService';
import { KeybindingService } from './services/KeybindingService';
import { PromptRepository } from './state/PromptRepository';
import { LogSyncService } from './services/LogSyncService';
import { log, logError, showOutputChannel } from './logger';
import { PrompterSidebarViewProvider } from './views/PrompterSidebarViewProvider';

const DATA_DIR_KEY = 'prompter.dataDir';
const REPOSITORY_FILE_NAMES = ['cards.json', 'modular-prompts.json', 'daily-stats.json', 'settings.json', 'session-groups.json'] as const;

let logSyncService: LogSyncService | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('Extension activating...');
  log(`VSCode version: ${vscode.version}`);
  log(`Extension path: ${context.extensionPath}`);

  try {
    const dataDir = resolveDataDir(context);
    log(`Data directory: ${dataDir}`);

    let repository = await PromptRepository.create(dataDir);
    log('Repository created successfully');
    const keybindingService = new KeybindingService(resolveUserKeybindingsPath(getVscodeAppName()));

    // 启动日志同步服务
    log('Starting log sync service...');
    logSyncService = new LogSyncService(repository, context);
    logSyncService.start();
    log('Log sync service started');

    const switchDataDir = async (request: { targetDir: string; migrate: boolean }) => {
      const currentDataDir = (await repository.getState()).settings.dataDir;
      if (request.migrate) {
        await migrateRepositoryFiles(currentDataDir, request.targetDir);
      }

      const nextRepository = await PromptRepository.create(request.targetDir);
      await nextRepository.updateSettings({ dataDir: request.targetDir });
      await context.globalState.update(DATA_DIR_KEY, request.targetDir);
      repository = nextRepository;
      return nextRepository.getState();
    };

    const applyShortcuts = async (shortcuts: PrompterState['settings']['shortcuts']) => {
      log('Applying Prompter shortcuts to user keybindings...');
      await keybindingService.applyShortcuts(shortcuts);
      log('Prompter shortcuts applied successfully');
    };

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(PrompterSidebarViewProvider.viewType, new PrompterSidebarViewProvider()),
      vscode.commands.registerCommand('prompter.open', async () => {
        log('Command: prompter.open triggered');
        try {
          await PrompterPanel.createOrShow(context.extensionUri, repository, { switchDataDir, applyShortcuts });
          log('Command: prompter.open completed');
        } catch (error) {
          logError('Command prompter.open failed', error);
          showOutputChannel();
          const state = await repository.getState();
          vscode.window.showErrorMessage(getLocaleText(state.settings.language).host.errors.openPanelFailed);
        }
      }),
      vscode.commands.registerCommand('prompter.importSelection', async () => {
        log('Command: prompter.importSelection triggered');
        try {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.selection.isEmpty) {
            return;
          }

          const selection = editor.document.getText(editor.selection);
          if (!selection) {
            return;
          }

          const state = await repository.getState();
          await insertIntoComposer(context, repository, switchDataDir, applyShortcuts, {
            text: formatSelectionImport({
              filePath: editor.document.uri.fsPath,
              workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
              pathMode: state.settings.defaultImportMode,
              startLine: editor.selection.start.line + 1,
              endLine: editor.selection.end.line + 1,
              selection
            }),
            fileRefs: [
              {
                path: editor.document.uri.fsPath,
                startLine: editor.selection.start.line + 1,
                endLine: editor.selection.end.line + 1
              }
            ]
          });
          log('Command: prompter.importSelection completed');
        } catch (error) {
          logError('Command prompter.importSelection failed', error);
          showOutputChannel();
          const state = await repository.getState();
          vscode.window.showErrorMessage(getLocaleText(state.settings.language).host.errors.importSelectionFailed);
        }
      }),
      vscode.commands.registerCommand('prompter.importResource', async (resource?: vscode.Uri) => {
        const targetResource =
          resource?.scheme === 'file'
            ? resource
            : vscode.window.activeTextEditor?.document.uri?.scheme === 'file'
              ? vscode.window.activeTextEditor.document.uri
              : undefined;

        if (!targetResource) {
          return;
        }
        const state = await repository.getState();
        await insertIntoComposer(context, repository, switchDataDir, applyShortcuts, {
          text: formatFilePathImport(
            targetResource.fsPath,
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            state.settings.defaultImportMode
          ),
          fileRefs: [{ path: targetResource.fsPath }]
        });
      }),
      vscode.commands.registerCommand('prompter.importTerminalSelection', async () => {
        await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
        const text = (await vscode.env.clipboard.readText()).trim();
        if (!text) {
          return;
        }
        await insertIntoComposer(context, repository, switchDataDir, applyShortcuts, { text, fileRefs: [] });
      }),
      vscode.commands.registerCommand('prompter.openShortcuts', async () => {
        await PrompterPanel.createOrShow(context.extensionUri, repository, { switchDataDir, applyShortcuts });
        await PrompterPanel.showView(repository, 'shortcuts');
      })
    );

    log('Commands registered successfully');
    log('Extension activated successfully ✓');
  } catch (error) {
    logError('Failed to activate extension', error);
    showOutputChannel();
    vscode.window.showErrorMessage(
      getLocaleText('zh-CN').host.errors.activateFailed
    );
    throw error;
  }
}

async function insertIntoComposer(
  context: vscode.ExtensionContext,
  repository: PromptRepository,
  switchDataDir: (request: { targetDir: string; migrate: boolean }) => Promise<PrompterState>,
  applyShortcuts: (shortcuts: PrompterState['settings']['shortcuts']) => Promise<void>,
  input: {
    text: string;
    fileRefs: { path: string; startLine?: number; endLine?: number }[];
  }
): Promise<void> {
  await PrompterPanel.createOrShow(context.extensionUri, repository, { switchDataDir, applyShortcuts });
  PrompterPanel.postMessage({
    type: 'composer:insertText',
    payload: {
      text: input.text,
      fileRefs: input.fileRefs
    }
  });
}

async function migrateRepositoryFiles(sourceDir: string, targetDir: string): Promise<void> {
  await Promise.all(
    REPOSITORY_FILE_NAMES.map(async (fileName) => {
      try {
        await cp(join(sourceDir, fileName), join(targetDir, fileName));
      } catch (error: unknown) {
        if (isMissingFileError(error)) {
          return;
        }

        throw error;
      }
    })
  );
}

function resolveDataDir(context: vscode.ExtensionContext): string {
  return context.globalState.get<string>(DATA_DIR_KEY) ?? getDefaultDataDir();
}

function getVscodeAppName(): string {
  try {
    return vscode.env.appName;
  } catch {
    return 'Code';
  }
}

function resolveUserKeybindingsPath(appName: string): string {
  const appFolderName = appName.includes('Cursor')
    ? 'Cursor'
    : appName.includes('Insiders')
      ? 'Code - Insiders'
      : appName.includes('VSCodium')
        ? 'VSCodium'
        : 'Code';

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appFolderName, 'User', 'keybindings.json');
  }

  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), appFolderName, 'User', 'keybindings.json');
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), appFolderName, 'User', 'keybindings.json');
}

function getDefaultDataDir(): string {
  return `${homedir()}/prompter`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function deactivate(): void {
  if (logSyncService) {
    log('Stopping log sync service...');
    logSyncService.stop();
    logSyncService = null;
  }
  log('Extension deactivated');
}
