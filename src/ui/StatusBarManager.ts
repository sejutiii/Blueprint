import * as vscode from "vscode";

/**
 * Manages the BluePrint status bar item shown at the bottom of the editor.
 * Reflects the current orchestrator state to the developer.
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    this.item.command = "blueprint.viewArch";
    this.setIdle();
    this.item.show();
  }

  setIdle(): void {
    this.item.text = "$(circuit-board) BluePrint";
    this.item.tooltip = "BluePrint — click to view architecture";
    this.item.backgroundColor = undefined;
  }

  setChecking(): void {
    this.item.text = "$(sync~spin) BluePrint: Checking…";
    this.item.tooltip = "Running compliance check";
    this.item.backgroundColor = undefined;
  }

  setViolationFound(): void {
    this.item.text = "$(warning) BluePrint: Violation";
    this.item.tooltip = "Architectural violation detected — click to review";
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    this.item.command = "blueprint.reviewChange";
  }

  setOk(): void {
    this.item.text = "$(check) BluePrint: OK";
    this.item.tooltip = "No architectural violations detected";
    this.item.backgroundColor = undefined;
    setTimeout(() => this.setIdle(), 5000);
  }

  setUninitialized(): void {
    this.item.text = "$(circuit-board) BluePrint: Not initialized";
    this.item.tooltip = "Click to initialize BluePrint for this project";
    this.item.command = "blueprint.init";
  }

  dispose(): void {
    this.item.dispose();
  }
}
