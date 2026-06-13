import * as vscode from "vscode";
import { ADR, AdrStatus } from "../types";

class AuditItem extends vscode.TreeItem {
  constructor(readonly adr: ADR) {
    super(adr.title, vscode.TreeItemCollapsibleState.None);
    const d = new Date(adr.timestamp);
    this.description = d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
    this.tooltip = new vscode.MarkdownString(
      `**${adr.status.toUpperCase()}** · ADR-${adr.id}\n\n${adr.decision.slice(0, 200)}`
    );
    this.contextValue = "auditItem";
    this.iconPath = new vscode.ThemeIcon(AuditItem.iconForStatus(adr.status));
    this.command = {
      command: "blueprint.openAdr",
      title: "Open ADR",
      arguments: [adr],
    };
  }

  private static iconForStatus(status: AdrStatus): string {
    switch (status) {
      case "accepted":   return "check";
      case "proposed":   return "circle-outline";
      case "deprecated": return "circle-slash";
      case "superseded": return "arrow-right";
    }
  }
}

export class AuditTrailTreeProvider
  implements vscode.TreeDataProvider<AuditItem | vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private adrs: ADR[] = [];

  refresh(adrs: ADR[]): void {
    this.adrs = [...adrs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AuditItem | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AuditItem | vscode.TreeItem): (AuditItem | vscode.TreeItem)[] {
    if (element) { return []; }

    if (this.adrs.length === 0) {
      const empty = new vscode.TreeItem("No decisions recorded yet");
      empty.iconPath = new vscode.ThemeIcon("history");
      return [empty];
    }

    return this.adrs.map((a) => new AuditItem(a));
  }
}
