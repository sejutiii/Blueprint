import * as vscode from "vscode";

export type PanelType = "setup" | "postGeneration" | "archViewer" | "auditTrail";

/**
 * Reusable factory for all BluePrint webview panels.
 * Each panel type is a singleton — reopening an existing panel reveals it.
 */
export class BlueprintPanel {
  private static panels = new Map<PanelType, BlueprintPanel>();

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly type: PanelType,
    private readonly extensionUri: vscode.Uri
  ) {
    const titles: Record<PanelType, string> = {
      setup: "BluePrint: Setup Wizard",
      postGeneration: "BluePrint: Compliance Review",
      archViewer: "BluePrint: Architecture (ARCH.md)",
      auditTrail: "BluePrint: Decision Audit Trail",
    };

    this.panel = vscode.window.createWebviewPanel(
      `blueprint.${type}`,
      titles[type],
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    this.panel.webview.html = this.getLoadingHtml(titles[type]);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );
  }

  static show(type: PanelType, extensionUri: vscode.Uri): BlueprintPanel {
    const existing = BlueprintPanel.panels.get(type);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }
    const instance = new BlueprintPanel(type, extensionUri);
    BlueprintPanel.panels.set(type, instance);
    return instance;
  }

  postMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  private handleMessage(message: { command: string; [key: string]: unknown }): void {
    // Individual panel message handlers will be wired in later components
    console.log(`[BlueprintPanel:${this.type}] received message:`, message.command);
  }

  private getLoadingHtml(title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .placeholder {
      text-align: center;
      opacity: 0.6;
    }
    h2 { font-weight: 400; }
  </style>
</head>
<body>
  <div class="placeholder">
    <h2>${title}</h2>
    <p>Loading…</p>
  </div>
</body>
</html>`;
  }

  private dispose(): void {
    BlueprintPanel.panels.delete(this.type);
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
