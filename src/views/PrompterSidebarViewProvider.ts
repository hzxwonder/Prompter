import * as vscode from 'vscode';

export class PrompterSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'prompterSidebar';

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    webviewView.webview.options = {
      enableScripts: false,
      enableCommandUris: true
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
        padding: 14px 12px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-descriptionForeground);
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        box-sizing: border-box;
      }

      .launch {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 40px;
        border-radius: 10px;
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        text-decoration: none;
        font-weight: 600;
      }

      .launch:hover {
        background: var(--vscode-button-hoverBackground);
      }
    </style>
  </head>
  <body>
    <a class="launch" href="command:prompter.open">Open Prompter</a>
  </body>
</html>`;
}
