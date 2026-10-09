import * as vscode from "vscode";
import { ADR, AuditEntry, AuditEventType } from "../types";

// Same labels as the full audit trail panel (media/auditTrail.html), with codicons.
const EVENTS: Record<AuditEventType, { label: string; icon: string }> = {
  adr_created:        { label: "ADR recorded",      icon: "add" },
  adr_proposed:       { label: "ADR proposed",      icon: "clock" },
  adr_approved:       { label: "ADR approved",      icon: "check" },
  adr_rejected:       { label: "ADR rejected",      icon: "close" },
  adr_superseded:     { label: "ADR superseded",    icon: "arrow-right" },
  compliance_check:   { label: "Compliance review", icon: "eye" },
  extension_detected: { label: "New component",     icon: "symbol-structure" },
  pre_check:          { label: "Pre-check",         icon: "shield" },
  arch_updated:       { label: "ARCH.md updated",   icon: "edit" },
  arch_reverted:      { label: "ARCH.md reverted",  icon: "discard" },
  component_implemented: { label: "Component implemented", icon: "pass" },
  roles_updated:      { label: "Roles updated",     icon: "organization" },
};

/** How many recent entries the sidebar shows; the full history is in the Audit Trail panel. */
export const SIDEBAR_AUDIT_LIMIT = 20;

export function auditIcon(entry: AuditEntry): string {
  if (entry.eventType === "compliance_check" && entry.complianceResult?.violation) { return "warning"; }
  return EVENTS[entry.eventType]?.icon ?? "history";
}

class AuditItem extends vscode.TreeItem {
  constructor(readonly entry: AuditEntry, adr: ADR | undefined) {
    super(entry.summary, vscode.TreeItemCollapsibleState.None);
    const event = EVENTS[entry.eventType];
    const when  = new Date(entry.timestamp);
    this.description = when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    this.tooltip = new vscode.MarkdownString(
      `**${event?.label ?? entry.eventType}** · ${when.toLocaleString()}\n\n${entry.summary}` +
      (entry.actor ? `\n\nBy ${entry.actor}` : "") +
      (entry.changedFiles?.length ? `\n\nFiles: ${entry.changedFiles.slice(0, 5).join(", ")}${entry.changedFiles.length > 5 ? ", …" : ""}` : "")
    );
    this.contextValue = "auditEntry";
    this.iconPath = new vscode.ThemeIcon(auditIcon(entry));
    // Entries about a decision open it; everything else opens the full trail.
    this.command = adr
      ? { command: "blueprint.openAdr", title: "Open ADR", arguments: [adr] }
      : { command: "blueprint.viewAuditTrail", title: "Open Audit Trail" };
  }
}

/** Sidebar view of the most recent audit-log entries (reviews, pre-checks, decisions, ARCH.md changes). */
export class AuditTrailTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private entries: AuditEntry[] = [];
  private adrs = new Map<string, ADR>();

  refresh(entries: AuditEntry[], adrs: ADR[]): void {
    this.entries = [...entries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    this.adrs = new Map(adrs.map((a) => [a.id, a]));
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) { return []; }

    if (this.entries.length === 0) {
      const empty = new vscode.TreeItem("Nothing recorded yet — reviews and decisions appear here");
      empty.iconPath = new vscode.ThemeIcon("history");
      return [empty];
    }

    const items: vscode.TreeItem[] = this.entries
      .slice(0, SIDEBAR_AUDIT_LIMIT)
      .map((e) => new AuditItem(e, e.adrId ? this.adrs.get(e.adrId) : undefined));
    if (this.entries.length > SIDEBAR_AUDIT_LIMIT) {
      const more = new vscode.TreeItem(`Show all ${this.entries.length} entries…`);
      more.iconPath = new vscode.ThemeIcon("history");
      more.command = { command: "blueprint.viewAuditTrail", title: "Open Audit Trail" };
      items.push(more);
    }
    return items;
  }
}
