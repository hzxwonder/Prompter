import type * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | null = null;
let vscodeModuleCache: typeof import('vscode') | null | undefined;

function getVscodeModule(): typeof import('vscode') | null {
  if (vscodeModuleCache !== undefined) {
    return vscodeModuleCache;
  }

  try {
    const dynamicRequire = typeof require === 'function' ? require : undefined;
    vscodeModuleCache = dynamicRequire ? dynamicRequire('vscode') as typeof import('vscode') : null;
  } catch {
    vscodeModuleCache = null;
  }

  return vscodeModuleCache;
}

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    const vscodeModule = getVscodeModule();
    if (!vscodeModule) {
      return {
        append() {},
        appendLine() {},
        show() {},
        clear() {},
        dispose() {},
        hide() {},
        replace() {},
        name: 'Prompter'
      } as vscode.OutputChannel;
    }
    outputChannel = vscodeModule.window.createOutputChannel('Prompter');
  }
  return outputChannel;
}

export function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `[${timestamp}] INFO: ${message}`;
  console.log(line);
  getOutputChannel().appendLine(line);
}

export function logWarn(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `[${timestamp}] WARN: ${message}`;
  console.warn(line);
  getOutputChannel().appendLine(line);
}

export function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  let errorDetail = '';
  if (error instanceof Error) {
    errorDetail = error.stack ?? error.message;
  } else if (error !== undefined && error !== null) {
    errorDetail = String(error);
  }
  const line = `[${timestamp}] ERROR: ${message}${errorDetail ? `\n  ${errorDetail}` : ''}`;
  console.error(line);
  getOutputChannel().appendLine(line);
}

/**
 * 在输出面板中显示 Prompter 频道并聚焦。
 * 当扩展激活失败时自动调用，方便用户查看错误。
 */
export function showOutputChannel(): void {
  getOutputChannel().show(true);
}
