import { describe, expect, it, vi } from 'vitest';

const executeCommand = vi.fn().mockResolvedValue(undefined);

vi.mock('vscode', () => ({
  commands: {
    executeCommand
  }
}));

describe('PrompterSidebarViewProvider', () => {
  it('opens Prompter when the sidebar view is resolved', async () => {
    const { PrompterSidebarViewProvider } = await import('../../../src/views/PrompterSidebarViewProvider');
    const provider = new PrompterSidebarViewProvider();
    const visibilityListeners: Array<() => void> = [];
    const webviewView = {
      visible: true,
      webview: {
        options: undefined,
        html: ''
      },
      onDidChangeVisibility: vi.fn((listener: () => void) => {
        visibilityListeners.push(listener);
        return { dispose() {} };
      })
    };

    await provider.resolveWebviewView(webviewView as never);

    expect(executeCommand).toHaveBeenCalledWith('prompter.open');
    expect(webviewView.webview.html).toContain('Open Prompter');
    expect(visibilityListeners).toHaveLength(1);
  });

  it('opens Prompter again when the sidebar becomes visible later', async () => {
    const { PrompterSidebarViewProvider } = await import('../../../src/views/PrompterSidebarViewProvider');
    const provider = new PrompterSidebarViewProvider();
    const visibilityListeners: Array<() => void> = [];
    const webviewView = {
      visible: false,
      webview: {
        options: undefined,
        html: ''
      },
      onDidChangeVisibility: vi.fn((listener: () => void) => {
        visibilityListeners.push(listener);
        return { dispose() {} };
      })
    };

    await provider.resolveWebviewView(webviewView as never);
    executeCommand.mockClear();

    webviewView.visible = true;
    visibilityListeners[0]?.();

    expect(executeCommand).toHaveBeenCalledWith('prompter.open');
  });
});
