import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { addComponentRow, addConstraint, replaceConstraint, setComponentStatus, setLastUpdated } from "../src/storage/archPatch";
import { splitSections, recentHighlights, WHOLE_DOCUMENT } from "../src/ui/archView";
import { FileStore, ArchHistoryEntry } from "../src/storage/FileStore";
import { renderArchMd } from "../src/prompts/archPrompts";
import { Uri } from "./mocks/vscode";
import { blueprint, tempDir, removeDir } from "./helpers";

const DOC = renderArchMd(blueprint(), "Shop");
// An ARCH.md written before components had a status.
const OLD_TABLE_DOC = DOC
  .replace("| Component | Responsibility | Technology | Status |\n|---|---|---|---|", "| Component | Responsibility | Technology |\n|---|---|---|")
  .replace("| ApiServer | Serves the REST API | Express | Planned |", "| ApiServer | Serves the REST API | Express |");

describe("archPatch — targeted edits that preserve manual changes (SRS 2.2)", () => {
  it("adds a component row and leaves everything else byte-for-byte", () => {
    const manual = DOC.replace("## Data Flow", "## Data Flow\n\nHand-written note the agent must keep.");
    const r = addComponentRow(manual, { name: "Cache", responsibility: "Caches reads", technology: "Redis" });
    expect(r.touched).toEqual(["Components"]);
    expect(r.markdown).toContain("| Cache | Caches reads | Redis | Planned |");
    expect(r.markdown).toContain("Hand-written note the agent must keep.");
    expect(r.markdown.replace("| Cache | Caches reads | Redis | Planned |\n", "")).toBe(manual);
  });

  it("an implemented component's Status cell names its files (first three)", () => {
    const r = addComponentRow(DOC, {
      name: "Mailer", responsibility: "Sends email", status: "implemented", files: ["a.ts", "b.ts", "c.ts", "d.ts"],
    });
    expect(r.markdown).toContain("| Mailer | Sends email | — | Implemented — `a.ts`, `b.ts`, `c.ts`, +1 more |");
  });

  it("an older table without a Status column gets one, every existing row marked Planned", () => {
    const old = OLD_TABLE_DOC;
    const r = addComponentRow(old, { name: "Mailer", responsibility: "Sends email", status: "implemented", files: ["mail.ts"] });
    expect(r.markdown).toContain("| Component | Responsibility | Technology | Status |\n|---|---|---|---|");
    expect(r.markdown).toContain("| ApiServer | Serves the REST API | Express | Planned |");
    expect(r.markdown).toContain("| Mailer | Sends email | — | Implemented — `mail.ts` |");
    // Nothing outside the table changed.
    expect(r.markdown.replace(/## Components[\s\S]*?(?=## Data Flow)/, "")).toBe(old.replace(/## Components[\s\S]*?(?=## Data Flow)/, ""));
  });

  it("setComponentStatus marks a planned component implemented, upgrading an older table", () => {
    const r = setComponentStatus(OLD_TABLE_DOC, { name: "apiserver", responsibility: "x", status: "implemented", files: ["server.ts"] });
    expect(r.touched).toEqual(["Components"]);
    expect(r.markdown).toContain("| ApiServer | Serves the REST API | Express | Implemented — `server.ts` |");
    // Already in that state: a no-op.
    expect(setComponentStatus(r.markdown, { name: "ApiServer", responsibility: "x", status: "implemented", files: ["server.ts"] }).touched).toEqual([]);
    // A component whose row was removed by hand gets one.
    expect(setComponentStatus(DOC, { name: "Mailer", responsibility: "Sends email", status: "implemented" }).markdown)
      .toContain("| Mailer | Sends email | — | Implemented |");
  });

  it("is a no-op for a component that is already listed (case-insensitive)", () => {
    const r = addComponentRow(DOC, { name: "apiserver", responsibility: "dup" });
    expect(r).toEqual({ markdown: DOC, touched: [] });
  });

  it("matches a manually widened table and escapes pipes", () => {
    const wide = DOC.replace("| Component | Responsibility | Technology | Status |\n|---|---|---|---|", "| Component | Responsibility | Technology | Status | Owner |\n|---|---|---|---|---|")
                    .replace("| ApiServer | Serves the REST API | Express | Planned |", "| ApiServer | Serves the REST API | Express | Planned | Team A |");
    const r = addComponentRow(wide, { name: "Queue", responsibility: "a | b" });
    expect(r.markdown).toContain("| Queue | a \\| b | — | Planned | — |");
  });

  it("creates the Components section when it was deleted", () => {
    const noComponents = DOC.replace(/## Components[\s\S]*?(?=## Data Flow)/, "");
    const r = addComponentRow(noComponents, { name: "Cache", responsibility: "r" });
    expect(r.markdown).toMatch(/## Components\n\n\| Component \| Responsibility \| Technology \| Status \|\n\|---\|---\|---\|---\|\n\| Cache \| r \| — \| Planned \|/);
  });

  it("adds constraints, replacing the placeholder, without duplicates", () => {
    const empty = renderArchMd(blueprint({ constraints: [] }));
    const once = addConstraint(empty, "Use Redis for caching");
    expect(once.markdown).toContain("## Constraints\n\n- Use Redis for caching");
    expect(once.markdown).not.toContain("_None identified yet._");
    expect(addConstraint(once.markdown, "use redis for caching").touched).toEqual([]);
    const twice = addConstraint(once.markdown, "Two PR approvals");
    expect(twice.markdown).toContain("- Use Redis for caching\n- Two PR approvals");
  });

  it("preserves CRLF line endings", () => {
    const crlf = DOC.replace(/\n/g, "\r\n");
    const r = addConstraint(crlf, "X");
    expect(r.markdown).toContain("- X\r\n");
    expect(r.markdown.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("replaceConstraint swaps one bullet in place and leaves the rest byte-for-byte", () => {
    const base = addConstraint(DOC, "Stripe is the only payment provider").markdown;
    const r = replaceConstraint(base, "stripe is the only payment provider", "Payments go through Stripe or PayPal");
    expect(r.touched).toEqual(["Constraints"]);
    expect(r.markdown).toContain("- Payments go through Stripe or PayPal");
    expect(r.markdown).not.toContain("Stripe is the only payment provider");
    expect(r.markdown.replace("Payments go through Stripe or PayPal", "Stripe is the only payment provider")).toBe(base);
  });

  it("replaceConstraint appends when the old line is gone, and drops it when the new one is already listed", () => {
    const appended = replaceConstraint(DOC, "A line someone deleted by hand", "Use S3 for uploads");
    expect(appended.markdown).toContain("- Use S3 for uploads");
    expect(appended.markdown).toContain("- Use PostgreSQL as the primary database");

    const both = addConstraint(addConstraint(DOC, "Old rule").markdown, "New rule").markdown;
    const r = replaceConstraint(both, "Old rule", "New rule");
    expect(r.markdown).not.toContain("- Old rule");
    expect(r.markdown.match(/- New rule/g)).toHaveLength(1);
  });

  it("setLastUpdated only rewrites the timestamp line", () => {
    const out = setLastUpdated(DOC, "2026-10-05T10:00:00Z");
    expect(out.split("\n").filter((l, i) => l !== DOC.split("\n")[i])).toHaveLength(1);
  });
});

describe("archView — sections and recent-change highlights (SRS 3.1, D6)", () => {
  const sections = splitSections(DOC);
  const headings = sections.flatMap((s) => (s.heading ? [s.heading] : []));
  const at = (h: number) => new Date(Date.UTC(2026, 9, 5, h)).toISOString();
  const entry = (h: number, sectionsTouched: string[], reason = `change ${h}`): ArchHistoryEntry =>
    ({ id: String(h), timestamp: at(h), reason, sections: sectionsTouched });

  it("splits on ## headings, keeping the preamble separate", () => {
    expect(sections[0].heading).toBeNull();
    expect(sections[0].markdown).toMatch(/^# Architecture: Shop/);
    expect(headings).toEqual(["System Overview", "Components", "Data Flow", "Constraints", "Open Questions"]);
    expect(sections.map((s) => s.markdown).join("\n\n")).toContain("| ApiServer |");
  });

  it("labels each section with its most recent change and counts earlier ones", () => {
    const hl = recentHighlights([entry(1, ["Components"]), entry(3, ["Components"], "ADR-0009"), entry(2, ["Constraints"])], headings);
    expect(hl.get("components")).toEqual({ timestamp: at(3), reason: "ADR-0009", changes: 2 });
    expect(hl.get("constraints")?.changes).toBe(1);
    expect(hl.has("data flow")).toBe(false);
  });

  it("only the last 5 changes count", () => {
    const history = [entry(1, ["Data Flow"]), ...[2, 3, 4, 5, 6].map((h) => entry(h, ["Components"]))];
    const hl = recentHighlights(history, headings);
    expect(hl.has("data flow")).toBe(false);
    expect(hl.get("components")?.changes).toBe(5);
  });

  it("a whole-document change marks every section", () => {
    expect(recentHighlights([entry(1, [WHOLE_DOCUMENT])], headings).size).toBe(headings.length);
  });
});

describe("FileStore — patching, history and revert (SRS 2.1 version history)", () => {
  let dir: string;
  let store: FileStore;
  beforeEach(async () => {
    dir = tempDir();
    store = new FileStore(Uri.file(dir) as never);
    await store.writeArchBlueprint(blueprint(), "Shop");
  });
  afterEach(() => removeDir(dir));

  const read = (...p: string[]) => fs.readFileSync(path.join(dir, ...p), "utf8");

  it("T13: init writes arch.json (2-space JSON) and ARCH.md, with no history yet", async () => {
    expect(read(".blueprint", "arch.json")).toBe(JSON.stringify(blueprint(), null, 2));
    expect(read("docs", "ARCH.md")).toMatch(/# Architecture: Shop[\s\S]*## Components[\s\S]*## Data Flow[\s\S]*## Constraints[\s\S]*## Open Questions/);
    expect(await store.getHistory()).toEqual([]);
  });

  it("applyArchEffect patches ARCH.md + arch.json, keeps manual edits, and snapshots first", async () => {
    fs.appendFileSync(path.join(dir, "docs", "ARCH.md"), "\n## Team Notes\n\nKeep me.\n");
    const touched = await store.applyArchEffect({ kind: "add-component", component: { name: "Cache", responsibility: "r" } }, "ADR-0002: Add Cache");

    expect(touched).toEqual(["Components"]);
    expect(read("docs", "ARCH.md")).toContain("| Cache | r | — |");
    expect(read("docs", "ARCH.md")).toContain("Keep me.");
    expect((await store.readArchBlueprint())?.components.map((c) => c.name)).toEqual(["ApiServer", "Cache"]);

    const [h] = await store.getHistory();
    expect(h).toMatchObject({ reason: "ADR-0002: Add Cache", sections: ["Components"] });
    expect(read(".blueprint", "history", `${h.id}.md`)).not.toContain("| Cache |");
  });

  it("replace-constraint updates ARCH.md and arch.json in place", async () => {
    await store.applyArchEffect({ kind: "add-constraint", constraint: "Redis for sessions" }, "ADR-0002");
    const touched = await store.applyArchEffect(
      { kind: "replace-constraint", constraint: "Use MySQL as the primary database", replaces: "Use PostgreSQL as the primary database" },
      "ADR-0003: Move to MySQL"
    );
    expect(touched).toEqual(["Constraints"]);
    expect(read("docs", "ARCH.md")).toContain("- Use MySQL as the primary database");
    expect(read("docs", "ARCH.md")).not.toContain("PostgreSQL as the primary");
    expect((await store.readArchBlueprint())?.constraints).toEqual(["Use MySQL as the primary database", "Redis for sessions"]);
  });

  it("a duplicate effect changes nothing and records no history", async () => {
    expect(await store.applyArchEffect({ kind: "add-constraint", constraint: "use postgresql as the primary database" }, "dup")).toEqual([]);
    expect(await store.getHistory()).toEqual([]);
  });

  it("revert restores both files and is itself reversible", async () => {
    await store.applyArchEffect({ kind: "add-constraint", constraint: "Redis for cache" }, "ADR-0003");
    const [h] = await store.getHistory();
    await store.revertTo(h.id);

    expect(read("docs", "ARCH.md")).not.toContain("Redis for cache");
    expect((await store.readArchBlueprint())?.constraints).toEqual(["Use PostgreSQL as the primary database"]);
    const history = await store.getHistory();
    expect(history).toHaveLength(2);
    expect(read(".blueprint", "history", `${history[1].id}.md`)).toContain("Redis for cache");
  });

  it("T15: re-initialising snapshots the previous ARCH.md instead of losing it", async () => {
    await store.writeArchBlueprint(blueprint({ systemOverview: "Rewritten." }), "Shop", "ARCH.md re-initialized");
    const [h] = await store.getHistory();
    expect(h.sections).toEqual(["Full document"]);
    expect(read(".blueprint", "history", `${h.id}.md`)).toContain("A test system.");
  });
});
