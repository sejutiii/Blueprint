import * as vscode from "vscode";
import { ADR, AdrStatus } from "../types";

export function iconForStatus(status: AdrStatus): string {
  switch (status) {
    case "accepted":    return "check";
    case "proposed":    return "clock";
    case "rejected":    return "error";
    case "deprecated":  return "circle-slash";
    case "superseded":  return "arrow-right";
  }
}

const STATUS_LABELS: Record<AdrStatus, string> = {
  proposed:   "Pending approval",
  accepted:   "Accepted",
  rejected:   "Rejected",
  deprecated: "Deprecated",
  superseded: "Superseded",
};

// Pending decisions first: they are the ones that need someone to act.
const STATUS_ORDER: AdrStatus[] = ["proposed", "accepted", "rejected", "superseded", "deprecated"];

export function adrMatches(adr: ADR, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) { return true; }
  return [adr.id, adr.title, adr.context, adr.decision, adr.consequences, adr.status, adr.proposedBy ?? ""]
    .some((field) => field.toLowerCase().includes(q));
}

class AdrItem extends vscode.TreeItem {
  constructor(readonly adr: ADR) {
    super(adr.title, vscode.TreeItemCollapsibleState.None);
    const pending = adr.status === "proposed";
    this.description = pending ? `#${adr.id} · pending approval` : `#${adr.id}`;
    this.tooltip = new vscode.MarkdownString(
      `**ADR-${adr.id}** · ${STATUS_LABELS[adr.status]}\n\n${adr.context}` +
      (adr.proposedBy ? `\n\nProposed by ${adr.proposedBy}` : "") +
      (adr.reviewNote ? `\n\n**Review:** ${adr.reviewNote}` : "")
    );
    this.contextValue = pending ? "adr-pending" : "adr";
    this.iconPath = new vscode.ThemeIcon(iconForStatus(adr.status));
    this.command = { command: "blueprint.openAdr", title: "Open ADR", arguments: [adr] };
  }
}

/**
 * Sidebar tree view provider for the ADR Browser.
 * Groups ADRs by status (pending first) and supports a text filter.
 */
export class AdrTreeProvider implements vscode.TreeDataProvider<AdrItem | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private adrs: ADR[] = [];
  private filter = "";

  refresh(adrs: ADR[]): void {
    this.adrs = adrs;
    this._onDidChangeTreeData.fire(undefined);
  }

  setFilter(query: string): void {
    this.filter = query;
    this._onDidChangeTreeData.fire(undefined);
  }

  getFilter(): string { return this.filter; }

  pendingCount(): number {
    return this.adrs.filter((a) => a.status === "proposed").length;
  }

  getTreeItem(element: AdrItem | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AdrItem | vscode.TreeItem): (AdrItem | vscode.TreeItem)[] {
    if (element) { return []; }

    if (this.adrs.length === 0) {
      const empty = new vscode.TreeItem("No ADRs yet — run BluePrint: Initialize Project");
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }

    const visible = this.adrs.filter((a) => adrMatches(a, this.filter));
    if (visible.length === 0) {
      const none = new vscode.TreeItem(`No ADRs match "${this.filter}"`);
      none.iconPath = new vscode.ThemeIcon("search");
      return [none];
    }

    const items: (AdrItem | vscode.TreeItem)[] = [];
    if (this.filter) {
      const banner = new vscode.TreeItem(`Filter: "${this.filter}" (run "BluePrint: Search ADRs" to change)`);
      banner.iconPath = new vscode.ThemeIcon("filter");
      items.push(banner);
    }

    for (const status of STATUS_ORDER) {
      const group = visible.filter((a) => a.status === status);
      if (!group.length) { continue; }
      const header = new vscode.TreeItem(
        `${STATUS_LABELS[status]} (${group.length})`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      items.push(header, ...group.map((a) => new AdrItem(a)));
    }
    return items;
  }
}
