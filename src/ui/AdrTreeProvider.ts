import * as vscode from "vscode";
import { ADR, AdrStatus } from "../types";

class AdrItem extends vscode.TreeItem {
  constructor(readonly adr: ADR) {
    super(adr.title, vscode.TreeItemCollapsibleState.None);
    this.description = `#${adr.id}`;
    this.tooltip = adr.context;
    this.contextValue = "adr";
    this.iconPath = new vscode.ThemeIcon(AdrItem.iconForStatus(adr.status));
  }

  private static iconForStatus(status: AdrStatus): string {
    switch (status) {
      case "accepted":    return "check";
      case "proposed":    return "circle-outline";
      case "deprecated":  return "circle-slash";
      case "superseded":  return "arrow-right";
    }
  }
}

/**
 * Sidebar tree view provider for the ADR Browser.
 * Groups ADRs by status. Refreshed whenever the ADR store changes.
 */
export class AdrTreeProvider implements vscode.TreeDataProvider<AdrItem | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private adrs: ADR[] = [];

  refresh(adrs: ADR[]): void {
    this.adrs = adrs;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AdrItem | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AdrItem | vscode.TreeItem): (AdrItem | vscode.TreeItem)[] {
    if (element) return [];

    if (this.adrs.length === 0) {
      const empty = new vscode.TreeItem("No ADRs yet — run BluePrint: Initialize Project");
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }

    const groups = new Map<AdrStatus, ADR[]>();
    for (const adr of this.adrs) {
      const bucket = groups.get(adr.status) ?? [];
      bucket.push(adr);
      groups.set(adr.status, bucket);
    }

    const items: (AdrItem | vscode.TreeItem)[] = [];
    for (const [status, group] of groups) {
      const header = new vscode.TreeItem(
        `${status.charAt(0).toUpperCase() + status.slice(1)} (${group.length})`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      items.push(header, ...group.map((a) => new AdrItem(a)));
    }
    return items;
  }
}
