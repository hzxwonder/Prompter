import * as vscode from 'vscode';

export class PrompterSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'prompterSidebar';

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    webviewView.webview.options = {
      enableScripts: false
    };
    webviewView.webview.html = getSidebarHtml();

    const openPrompter = async () => {
      await vscode.commands.executeCommand('prompter.open');
    };

    void openPrompter();
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void openPrompter();
      }
    });
  }
}

function getSidebarHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        margin: 0;
        padding: 12px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-descriptionForeground);
        background: transparent;
      }
    </style>
  </head>
  <body>
    Opening Prompter...
  </body>
</html>`;
}
