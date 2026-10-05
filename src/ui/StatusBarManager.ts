import * as vscode from "vscode";

/**
 * Manages the BluePrint status bar item shown at the bottom of the editor.
 * Reflects the current orchestrator state to the developer.
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private pending = 0;
  private idle = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.setIdle();
    this.item.show();
  }

  // Every state goes through here so no state inherits the previous one's command, colour or timer.
  private apply(text: string, tooltip: string, command: string, warning = false, idle = false): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    this.idle = idle;
    this.item.text = text;
    this.item.tooltip = tooltip;
    this.item.command = command;
    this.item.backgroundColor = warning ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  }

  /** Number of decisions awaiting Architect approval; shown next to the idle label. */
  setPending(count: number): void {
    this.pending = count;
  }

  setIdle(): void {
    const badge = this.pending > 0 ? ` · ${this.pending} pending` : "";
    this.apply(
      `$(circuit-board) BluePrint${badge}`,
      this.pending > 0
        ? `${this.pending} decision(s) awaiting Architect approval — click to open BluePrint`
        : "BluePrint — click to open the hub",
      "blueprint.openHub",
      false,
      true
    );
  }

  /** Redraw the idle label (e.g. after the pending count changed) without interrupting another state. */
  refreshIdle(): void {
    if (this.idle) { this.setIdle(); }
  }

  setChecking(): void {
    this.apply("$(sync~spin) BluePrint: Checking…", "Running compliance check", "blueprint.openHub");
  }

  setViolationFound(): void {
    this.apply(
      "$(warning) BluePrint: Violation",
      "Architectural violation detected — click to review",
      "blueprint.reviewChange",
      true
    );
  }

  setOk(): void {
    this.apply("$(check) BluePrint: OK", "No architectural violations detected", "blueprint.openHub");
    this.idleTimer = setTimeout(() => this.setIdle(), 5000);
  }

  setUninitialized(): void {
    this.apply(
      "$(circuit-board) BluePrint: Not initialized",
      "Click to initialize BluePrint for this project",
      "blueprint.init"
    );
  }

  dispose(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); }
    this.item.dispose();
  }
}
