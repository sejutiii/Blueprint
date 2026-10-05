import * as vscode from "vscode";

export type PanelType = "setup" | "postGeneration" | "archViewer" | "auditTrail" | "preCheck" | "hub";

export class BlueprintPanel {
  private static panels = new Map<PanelType, BlueprintPanel>();

  readonly nonce: string;
  readonly cspSource: string;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private messageHandler?: (msg: Record<string, unknown>) => void;

  private constructor(
    private readonly type: PanelType,
    private readonly extensionUri: vscode.Uri
  ) {
    this.nonce = BlueprintPanel.generateNonce();

    const titles: Record<PanelType, string> = {
      setup:         "BluePrint: Setup",
      postGeneration:"BluePrint: Compliance Review",
      archViewer:    "BluePrint: Architecture",
      auditTrail:    "BluePrint: Audit Trail",
      preCheck:      "BluePrint: Pre-Check",
      hub:           "BluePrint",
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

    this.cspSource = this.panel.webview.cspSource;
    this.panel.webview.html = this.getLoadingHtml(titles[type]);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => this.messageHandler?.(msg),
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

  /** The open panel of this type, if any (used to push live updates). */
  static get(type: PanelType): BlueprintPanel | undefined {
    return BlueprintPanel.panels.get(type);
  }

  setMessageHandler(handler: (msg: Record<string, unknown>) => void): void {
    this.messageHandler = handler;
  }

  async loadMedia(filename: string, vars: Record<string, string> = {}): Promise<void> {
    const fileUri = vscode.Uri.joinPath(this.extensionUri, "media", filename);
    const raw = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf-8");
    let html = raw;
    for (const [key, value] of Object.entries(vars)) {
      html = html.split(`{{${key}}}`).join(value);
    }
    this.panel.webview.html = html;
  }

  postMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  private getLoadingHtml(title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; align-items: center; justify-content: center;
      height: 100vh; margin: 0;
    }
    p { opacity: 0.5; }
  </style>
</head>
<body><p>${title}</p></body>
</html>`;
  }

  private static generateNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 32 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }

  private dispose(): void {
    BlueprintPanel.panels.delete(this.type);
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
