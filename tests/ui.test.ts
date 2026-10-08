import { describe, it, expect } from "vitest";
import { StatusBarManager } from "../src/ui/StatusBarManager";
import { AuditTrailTreeProvider, SIDEBAR_AUDIT_LIMIT } from "../src/ui/AuditTrailTreeProvider";
import { AuditEntry } from "../src/types";
import { FakeStatusBarItem, ThemeIcon } from "./mocks/vscode";
import { adr } from "./helpers";

const itemOf = (bar: StatusBarManager) => (bar as unknown as { item: FakeStatusBarItem }).item;

describe("StatusBarManager", () => {
  it("a violation opens the last review instead of starting a new one (U5)", () => {
    const bar = new StatusBarManager();
    bar.setViolationFound();
    expect(itemOf(bar).command).toBe("blueprint.showLastReview");
    expect(itemOf(bar).text).toContain("Violation");
  });

  it("handling every violation returns to idle (U17)", () => {
    const bar = new StatusBarManager();
    bar.setViolationFound();
    bar.clearViolation();
    expect(itemOf(bar).text).not.toContain("Violation");
    expect(itemOf(bar).command).toBe("blueprint.openHub");
    expect(itemOf(bar).backgroundColor).toBeUndefined();
  });

  it("clearing a violation never interrupts a later state", () => {
    const bar = new StatusBarManager();
    bar.setViolationFound();
    bar.setChecking(); // a new review started before the last violation was handled
    bar.clearViolation();
    expect(itemOf(bar).text).toContain("Checking");
  });
});

describe("Sidebar Audit Trail (U8)", () => {
  const entry = (n: number, extra: Partial<AuditEntry> = {}): AuditEntry => ({
    id: `E${n}`, timestamp: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    eventType: "pre_check", summary: `entry ${n}`, ...extra,
  });
  const children = (p: AuditTrailTreeProvider) => p.getChildren() as unknown as {
    label: string; command?: { command: string; arguments?: unknown[] }; iconPath?: ThemeIcon;
  }[];

  it("shows audit-log entries newest first, not the ADR list", () => {
    const p = new AuditTrailTreeProvider();
    p.refresh([entry(1), entry(3), entry(2)], [adr("0001", "Use Postgres")]);
    expect(children(p).map((i) => i.label)).toEqual(["entry 3", "entry 2", "entry 1"]);
  });

  it("caps the list and links to the full trail", () => {
    const p = new AuditTrailTreeProvider();
    p.refresh(Array.from({ length: SIDEBAR_AUDIT_LIMIT + 5 }, (_, i) => entry(i)), []);
    const items = children(p);
    expect(items).toHaveLength(SIDEBAR_AUDIT_LIMIT + 1);
    expect(items.at(-1)!.label).toBe(`Show all ${SIDEBAR_AUDIT_LIMIT + 5} entries…`);
    expect(items.at(-1)!.command!.command).toBe("blueprint.viewAuditTrail");
  });

  it("decision entries open their ADR; a review with violations gets a warning icon", () => {
    const p = new AuditTrailTreeProvider();
    const postgres = adr("0001", "Use Postgres");
    p.refresh([
      entry(2, { eventType: "adr_approved", adrId: "0001" }),
      entry(1, { eventType: "compliance_check", complianceResult: { violation: true, violations: [], extensions: [], adrsUsed: [] } }),
    ], [postgres]);
    const [approved, review] = children(p);
    expect(approved.command).toMatchObject({ command: "blueprint.openAdr", arguments: [postgres] });
    expect(review.command!.command).toBe("blueprint.viewAuditTrail");
    expect(review.iconPath!.id).toBe("warning");
  });
});
