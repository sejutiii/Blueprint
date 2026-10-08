import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { roleFor, parseRolesManifest, parseEmailList, buildRolesManifest, rolesConfigured } from "../src/access/roles";
import { Orchestrator } from "../src/orchestrator/Orchestrator";
import { AccessControl, Actor } from "../src/access/AccessControl";
import { AdrStore } from "../src/storage/AdrStore";
import { FileStore } from "../src/storage/FileStore";
import { AuditLog } from "../src/storage/AuditLog";
import { DecisionService } from "../src/services/DecisionService";
import { RetrievalAgent } from "../src/agents/RetrievalAgent";
import { EmbeddingService } from "../src/embeddings/EmbeddingService";
import { adrFilename } from "../src/prompts/adrPrompts";
import { ElicitationSession } from "../src/agents/ElicitationSession";
import { CONSTRAINT_QUESTIONS } from "../src/prompts/constraintPrompts";
import { Uri, __setWorkspaceRoot } from "./mocks/vscode";
import { blueprint, tempDir, removeDir } from "./helpers";

describe("roles (SRS 3.2.5 role lookup)", () => {
  const manifest = parseRolesManifest(JSON.stringify({ architects: ["Arch@X.io"], developers: ["dev@x.io"] }));

  it("no manifest, or a manifest without Architects, makes everyone an Architect", () => {
    expect(roleFor("anyone@x.io", null)).toBe("architect");
    expect(roleFor("anyone@x.io", parseRolesManifest('{"architects": []}'))).toBe("architect");
  });

  it("looks up the git email case-insensitively", () => {
    expect(roleFor("arch@x.io", manifest)).toBe("architect");
    expect(roleFor("dev@x.io", manifest)).toBe("developer");
    expect(roleFor("stranger@x.io", manifest)).toBe("developer");
  });

  it("an unknown identity cannot be an Architect once a manifest exists", () => {
    expect(roleFor(null, manifest)).toBe("developer");
  });

  it("malformed manifests are treated as missing", () => {
    expect(parseRolesManifest("{not json")).toBeNull();
    expect(parseRolesManifest(null)).toBeNull();
    expect(parseRolesManifest('{"architects": [1, "a@b.c"]}')).toEqual({ architects: ["a@b.c"], developers: [] });
  });
});

describe("roles setup (wizard step and Team & Roles panel)", () => {
  it("parses one-per-line or comma-separated email lists", () => {
    expect(parseEmailList(" a@x.io\n\nb@x.io, c@x.io ;d@x.io ")).toEqual(["a@x.io", "b@x.io", "c@x.io", "d@x.io"]);
    expect(parseEmailList("   ")).toEqual([]);
  });

  it("the person saving is always an Architect; emails are normalized and de-duplicated", () => {
    const built = buildRolesManifest("Me@X.io", ["lead@x.io", "LEAD@x.io", "me@x.io"], ["dev@x.io", "Lead@x.io", "dev@x.io"]);
    expect(built).toEqual({ manifest: { architects: ["me@x.io", "lead@x.io"], developers: ["dev@x.io"] } });
  });

  it("'Just me' makes the saver the only Architect", () => {
    expect(buildRolesManifest("me@x.io", [], [])).toEqual({ manifest: { architects: ["me@x.io"], developers: [] } });
  });

  it("rejects invalid emails and a missing git identity", () => {
    expect(buildRolesManifest("me@x.io", ["not-an-email"], ["also bad"])).toEqual({ error: "Not a valid email: not-an-email, also bad" });
    expect("error" in buildRolesManifest(null, [], [])).toBe(true);
  });

  it("roles count as configured only once an Architect is named", () => {
    expect(rolesConfigured(null)).toBe(false);
    expect(rolesConfigured({ architects: [], developers: ["d@x.io"] })).toBe(false);
    expect(rolesConfigured({ architects: ["a@x.io"] })).toBe(true);
  });
});

describe("Orchestrator — Architect-only actions", () => {
  let dir: string;
  let identity: string | null;
  const orchestrator = new Orchestrator({} as never, { onState: () => {}, onDataChanged: () => {} });
  const rolesFile = () => path.join(dir, ".blueprint", "roles.json");
  const writeRoles = (m: object) => {
    fs.mkdirSync(path.join(dir, ".blueprint"), { recursive: true });
    fs.writeFileSync(rolesFile(), JSON.stringify(m));
  };

  beforeEach(() => {
    dir = tempDir();
    __setWorkspaceRoot(dir);
    vi.spyOn(AccessControl.prototype, "resolveIdentity").mockImplementation(async () => identity);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __setWorkspaceRoot(null);
    removeDir(dir);
  });

  it("without roles.json anyone can create it, and becomes an Architect", async () => {
    identity = "me@x.io";
    expect(await orchestrator.roles()).toMatchObject({ role: "architect", configured: false });
    const saved = await orchestrator.saveRoles(["lead@x.io"], ["dev@x.io"]);
    expect(saved).toMatchObject({ role: "architect", configured: true, architects: ["me@x.io", "lead@x.io"], developers: ["dev@x.io"] });
    expect(JSON.parse(fs.readFileSync(rolesFile(), "utf8")).architects).toEqual(["me@x.io", "lead@x.io"]);
    expect((await new AuditLog(Uri.file(dir) as never).getAll()).map((e) => e.eventType)).toEqual(["roles_updated"]);
  });

  it("a Developer cannot change roles, initialize, approve, or revert ARCH.md", async () => {
    writeRoles({ architects: ["lead@x.io"], developers: ["me@x.io"] });
    identity = "me@x.io";
    await expect(orchestrator.saveRoles([], [])).rejects.toThrow(/Only an Architect can change roles.*Architects: lead@x\.io/);
    // Refused before any LLM call or file write.
    await expect(orchestrator.generateArchitecture("a shop")).rejects.toThrow(/Only an Architect can initialize/);
    await expect(orchestrator.requireApprover()).rejects.toThrow(/Only an Architect can approve/);
    await expect(orchestrator.requireReverter()).rejects.toThrow(/Only an Architect can revert ARCH\.md/);
    await expect(orchestrator.revertArch("H0001", "x")).rejects.toThrow(/Only an Architect can revert ARCH\.md/);
    expect(fs.existsSync(path.join(dir, "docs", "ARCH.md"))).toBe(false);
  });

  it("an Architect listed in roles.json passes the checks", async () => {
    writeRoles({ architects: ["lead@x.io"] });
    identity = "Lead@X.io";
    await expect(orchestrator.requireApprover()).resolves.toBeUndefined();
    await expect(orchestrator.saveRoles(["second@x.io"], [])).resolves.toMatchObject({ architects: ["lead@x.io", "second@x.io"] });
  });

  it("an Architect's revert restores ARCH.md and is audited with who did it", async () => {
    writeRoles({ architects: ["lead@x.io"] });
    identity = "lead@x.io";
    const store = new FileStore(Uri.file(dir) as never);
    await store.writeArchBlueprint(blueprint({ systemOverview: "Original." }), "Shop");
    await store.writeArchBlueprint(blueprint({ systemOverview: "Rewritten." }), "Shop", "ARCH.md re-initialized");
    const [h] = await store.getHistory();
    await orchestrator.revertArch(h.id, h.reason);
    expect(fs.readFileSync(path.join(dir, "docs", "ARCH.md"), "utf8")).toContain("Original.");
    const entries = await new AuditLog(Uri.file(dir) as never).getAll();
    expect(entries.at(-1)).toMatchObject({ eventType: "arch_reverted", actor: "lead@x.io" });
  });

  it("'Edit roles.json directly' without a git identity names no Architects instead of a placeholder", async () => {
    identity = null;
    await new AccessControl(Uri.file(dir) as never).ensureManifest();
    expect(JSON.parse(fs.readFileSync(rolesFile(), "utf8"))).toEqual({ architects: [], developers: [] });
    expect((await orchestrator.roles()).role).toBe("architect");
  });
});

describe("D13 — planned components that appear in code, and extensions", () => {
  let dir: string;
  let identity: string | null;
  const orchestrator = new Orchestrator({} as never, { onState: () => {}, onDataChanged: () => {} });
  const file = (...p: string[]) => fs.readFileSync(path.join(dir, ...p), "utf8");
  const writeRoles = (m: object) => {
    fs.mkdirSync(path.join(dir, ".blueprint"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".blueprint", "roles.json"), JSON.stringify(m));
  };

  beforeEach(async () => {
    dir = tempDir();
    __setWorkspaceRoot(dir);
    identity = "lead@x.io";
    vi.spyOn(AccessControl.prototype, "resolveIdentity").mockImplementation(async () => identity);
    vi.spyOn(EmbeddingService.prototype, "embed").mockResolvedValue(null);
    await new FileStore(Uri.file(dir) as never).writeArchBlueprint(blueprint({ components: [
      { name: "Frontend", responsibility: "UI", status: "planned" },
    ] }), "Shop");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __setWorkspaceRoot(null);
    removeDir(dir);
  });

  it("marking a planned component implemented updates ARCH.md and arch.json, with no ADR", async () => {
    // Open to Developers too: it records a fact about the code, not a decision.
    writeRoles({ architects: ["lead@x.io"], developers: ["dev@x.io"] });
    identity = "dev@x.io";
    await orchestrator.markComponentImplemented({ component: "Frontend", files: ["app.tsx"], rationale: "a React UI" });

    expect(file("docs", "ARCH.md")).toContain("| Frontend | UI | — | Implemented — `app.tsx` |");
    expect(JSON.parse(file(".blueprint", "arch.json")).components[0]).toMatchObject({ status: "implemented", files: ["app.tsx"] });
    expect(await new AdrStore(Uri.file(dir) as never).getAll()).toEqual([]);
    const [h] = await new FileStore(Uri.file(dir) as never).getHistory();
    expect(h.reason).toBe("Component implemented: Frontend"); // revertible
    const entries = await new AuditLog(Uri.file(dir) as never).getAll();
    expect(entries.at(-1)).toMatchObject({ eventType: "component_implemented", actor: "dev@x.io", changedFiles: ["app.tsx"] });
  });

  it("an extension is recorded as implemented, with only its own files", async () => {
    const { adr } = await orchestrator.confirmExtension(
      { name: "Notifications", responsibility: "Browser notifications", rationale: "new", files: ["notifications.ts"] },
      "", ["notifications.ts", "unrelated.py"]
    );
    expect(adr.archEffect).toMatchObject({ kind: "add-component", component: { status: "implemented", files: ["notifications.ts"] } });
    expect(file("docs", "ARCH.md")).toContain("| Notifications | Browser notifications | — | Implemented — `notifications.ts` |");
  });
});

describe("Add Decision — replacing an existing decision", () => {
  let dir: string;
  let identity: string | null;
  const orchestrator = new Orchestrator({} as never, { onState: () => {}, onDataChanged: () => {} });
  const archMd = () => fs.readFileSync(path.join(dir, "docs", "ARCH.md"), "utf8");
  const store  = () => new AdrStore(Uri.file(dir) as never);
  const draft  = (title: string) => ({ title, context: "c", decision: `Decision: ${title}`, consequences: "q" });

  beforeEach(async () => {
    dir = tempDir();
    __setWorkspaceRoot(dir);
    identity = "lead@x.io";
    vi.spyOn(AccessControl.prototype, "resolveIdentity").mockImplementation(async () => identity);
    // Retrieval falls back to lexical scoring; no model download in tests.
    vi.spyOn(EmbeddingService.prototype, "embed").mockResolvedValue(null);
    await new FileStore(Uri.file(dir) as never).writeArchBlueprint(blueprint(), "Shop");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __setWorkspaceRoot(null);
    removeDir(dir);
  });

  it("a new decision is added as a constraint", async () => {
    const { adr, autoApproved } = await orchestrator.saveDecision(draft("Store uploads in Amazon S3"));
    expect(autoApproved).toBe(true);
    expect(adr.archEffect).toEqual({ kind: "add-constraint", constraint: "Store uploads in Amazon S3" });
    expect(archMd()).toContain("- Store uploads in Amazon S3");
  });

  it("an Architect's replacement retires the old ADR and swaps its ARCH.md line", async () => {
    const old = (await orchestrator.saveDecision(draft("Stripe is the only payment provider"))).adr;
    const { adr } = await orchestrator.saveDecision(draft("Payments go through Stripe or PayPal"), old.id);

    expect(adr).toMatchObject({ status: "accepted", supersedes: old.id });
    expect(await store().getById(old.id)).toMatchObject({ status: "superseded", supersededBy: adr.id });
    expect(archMd()).toContain("- Payments go through Stripe or PayPal");
    expect(archMd()).not.toContain("Stripe is the only payment provider");
    const md = fs.readdirSync(path.join(dir, "docs", "adr")).map((f) => fs.readFileSync(path.join(dir, "docs", "adr", f), "utf8")).join("\n");
    expect(md).toContain(`**Superseded by:** ADR-${adr.id}`);
    expect(md).toContain(`**Supersedes:** ADR-${old.id}`);
    expect((await new AuditLog(Uri.file(dir) as never).getAll()).map((e) => e.eventType)).toContain("adr_superseded");
  });

  it("a Developer's replacement changes nothing until an Architect approves it", async () => {
    const old = (await orchestrator.saveDecision(draft("Stripe is the only payment provider"))).adr;
    fs.writeFileSync(path.join(dir, ".blueprint", "roles.json"), JSON.stringify({ architects: ["lead@x.io"], developers: ["dev@x.io"] }));

    identity = "dev@x.io";
    const { adr, autoApproved } = await orchestrator.saveDecision(draft("Payments go through Stripe or PayPal"), old.id);
    expect(autoApproved).toBe(false);
    expect((await store().getById(old.id))?.status).toBe("accepted");
    expect(archMd()).toContain("Stripe is the only payment provider");

    identity = "lead@x.io";
    await orchestrator.approve(adr.id);
    expect((await store().getById(old.id))?.status).toBe("superseded");
    expect(archMd()).toContain("- Payments go through Stripe or PayPal");
    expect(archMd()).not.toContain("Stripe is the only payment provider");
  });

  it("only an accepted ADR can be replaced", async () => {
    await expect(orchestrator.saveDecision(draft("x"), "0042")).rejects.toThrow(/ADR-0042 not found/);
    const old = (await orchestrator.saveDecision(draft("Old rule"))).adr;
    await orchestrator.saveDecision(draft("Newer rule"), old.id);
    await expect(orchestrator.saveDecision(draft("Newest rule"), old.id)).rejects.toThrow(/superseded, not accepted/);
  });

  it("superseded ADRs are no longer used as review context", async () => {
    const old = (await orchestrator.saveDecision(draft("Stripe is the only payment provider"))).adr;
    await orchestrator.saveDecision(draft("Payments go through Stripe or PayPal"), old.id);
    const used = await new RetrievalAgent().retrieve("payments", await store().getAll(), blueprint());
    expect(used.map((a) => a.id)).not.toContain(old.id);
  });
});

describe("ADR files (T41–T43)", () => {
  let dir: string;
  let store: AdrStore;
  beforeEach(() => { dir = tempDir(); store = new AdrStore(Uri.file(dir) as never); });
  afterEach(() => removeDir(dir));
  const draft = (title: string) => ({ title, status: "accepted" as const, context: "c", decision: "d", consequences: "q" });

  it("T41: sequential zero-padded IDs, even when created concurrently", async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => store.create(draft(`ADR ${i}`))));
    expect(created.map((a) => a.id).sort()).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]);
    const index = JSON.parse(fs.readFileSync(path.join(dir, ".blueprint", "adr-index.json"), "utf8"));
    expect(index.nextId).toBe(9);
    expect(index.adrs).toHaveLength(8);
  });

  it("T42: filename slug is lowercase, stripped, hyphenated and capped at 50 chars", () => {
    expect(adrFilename({ id: "0007", title: "Use PostgreSQL (v16) — for ALL persistent data, incl. sessions & caches!!" }))
      .toBe("0007-use-postgresql-v16-for-all-persistent-data-incl-se.md"); // slug = exactly 50 chars
  });

  it("T43: update rewrites index and markdown; a title change renames the file", async () => {
    const a = await store.create(draft("First title"));
    await store.update(a.id, { status: "deprecated", title: "Second title" });
    const files = fs.readdirSync(path.join(dir, "docs", "adr"));
    expect(files).toEqual(["0001-second-title.md"]);
    expect(fs.readFileSync(path.join(dir, "docs", "adr", files[0]), "utf8")).toContain("**Status:** Deprecated");
    expect((await store.getById(a.id))?.status).toBe("deprecated");
  });

  it("embeddings are cached in the index only", async () => {
    const a = await store.create(draft("Emb"));
    await store.storeEmbedding(a.id, [0.1, 0.2]);
    expect((await store.getById(a.id))?.embedding).toEqual([0.1, 0.2]);
    expect(fs.readFileSync(path.join(dir, "docs", "adr", adrFilename(a)), "utf8")).not.toContain("0.1");
  });
});

describe("DecisionService — approval queue (SRS 3.2.5)", () => {
  let dir: string;
  let adrStore: AdrStore;
  let fileStore: FileStore;
  let audit: AuditLog;
  let actor: Actor;
  let service: DecisionService;

  // AccessControl reads git config; tests choose the acting identity directly.
  const access = { resolveActor: async () => actor, resolveIdentity: async () => actor.identity } as unknown as AccessControl;
  const noEmbeddings = new RetrievalAgent({ embed: async () => null } as unknown as EmbeddingService);

  beforeEach(async () => {
    dir = tempDir();
    const root = Uri.file(dir) as never;
    adrStore = new AdrStore(root);
    fileStore = new FileStore(root);
    audit = new AuditLog(root);
    await fileStore.writeArchBlueprint(blueprint(), "Shop");
    service = new DecisionService(adrStore, fileStore, access, audit, noEmbeddings);
  });
  afterEach(() => removeDir(dir));

  const extension = {
    title: "Extension: Add Cache component", context: "new cache", decision: "confirmed", consequences: "ARCH.md lists Cache",
    archEffect: { kind: "add-component" as const, component: { name: "Cache", responsibility: "Caches reads" } },
    changedFiles: ["src/cache.ts"],
  };
  const archMd = () => fs.readFileSync(path.join(dir, "docs", "ARCH.md"), "utf8");
  const events = async () => (await audit.getAll()).map((e) => e.eventType);

  it("an Architect's decision is accepted immediately and patches ARCH.md", async () => {
    actor = { identity: "arch@x.io", role: "architect" };
    const { adr, autoApproved } = await service.propose(extension);
    expect(autoApproved).toBe(true);
    expect(adr).toMatchObject({ status: "accepted", proposedBy: "arch@x.io", reviewedBy: "arch@x.io" });
    expect(archMd()).toContain("| Cache | Caches reads |");
    expect(await events()).toEqual(["adr_created", "arch_updated"]);
    expect((await audit.getAll())[0].changedFiles).toEqual(["src/cache.ts"]);
  });

  it("a Developer's decision waits in the queue and ARCH.md is untouched until approval", async () => {
    actor = { identity: "dev@x.io", role: "developer" };
    const { adr, autoApproved } = await service.propose(extension);
    expect(autoApproved).toBe(false);
    expect(adr.status).toBe("proposed");
    expect(archMd()).not.toContain("| Cache |");

    await expect(service.approve(adr.id)).rejects.toThrow(/Only an Architect/);

    actor = { identity: "arch@x.io", role: "architect" };
    const approved = await service.approve(adr.id, "Looks right");
    expect(approved).toMatchObject({ status: "accepted", reviewedBy: "arch@x.io", reviewNote: "Looks right" });
    expect(archMd()).toContain("| Cache | Caches reads |");
    expect(await events()).toEqual(["adr_proposed", "adr_approved", "arch_updated"]);
  });

  it("rejection needs reasoning, records it, and never touches ARCH.md", async () => {
    actor = { identity: "dev@x.io", role: "developer" };
    const { adr } = await service.propose(extension);
    actor = { identity: "arch@x.io", role: "architect" };

    await expect(service.reject(adr.id, "  ")).rejects.toThrow(/reasoning/);
    const rejected = await service.reject(adr.id, "Use the existing Redis instead");
    expect(rejected).toMatchObject({ status: "rejected", reviewNote: "Use the existing Redis instead" });
    expect(archMd()).not.toContain("| Cache |");
    await expect(service.approve(adr.id)).rejects.toThrow(/not pending/);
  });

  it("D2: each resolved item is its own ADR", async () => {
    actor = { identity: "arch@x.io", role: "architect" };
    await service.propose({ ...extension, title: "Extension: Add Cache", archEffect: { kind: "add-component", component: { name: "Cache", responsibility: "r" } } });
    await service.propose({ ...extension, title: "Extension: Add Queue", archEffect: { kind: "add-component", component: { name: "Queue", responsibility: "r" } } });
    expect((await adrStore.getAll()).map((a) => a.id)).toEqual(["0001", "0002"]);
    expect(archMd()).toMatch(/\| Cache \|[\s\S]*\| Queue \|/);
  });
});

describe("ElicitationSession — branching wizard (SRS 3.1, D5)", () => {
  const ask = (question: string) => ({ hasConstraint: false, followUp: { question, placeholder: "" } });
  const draft = (title: string) => ({ title, context: "c", decision: "d", consequences: "q" });

  it("inserts at most one follow-up per topic, never nested, dropped on skip", () => {
    const s = new ElicitationSession(CONSTRAINT_QUESTIONS);
    expect(s.getCurrent()).toMatchObject({ id: "technology", topicIndex: 0, topicTotal: 5, isFollowUp: false });

    s.recordAnswer("PostgreSQL", ask("Only datastore?"));
    expect(s.advance()).toMatchObject({ isFollowUp: true, topicIndex: 0, parent: { answer: "PostgreSQL" } });

    s.recordAnswer("Redis too", ask("nested?"));
    expect(s.advance()).toMatchObject({ id: "scalability", isFollowUp: false });

    s.recordAnswer("10k users", ask("p95?"));
    expect(s.skip()).toMatchObject({ id: "conventions" });

    expect(s.advance()?.id).toBe("integrations");
    expect(s.advance()?.id).toBe("nonfunctional");
    expect(s.advance()).toBeNull();
  });

  it("one ADR per topic: with a follow-up, the draft waits and covers both answers", () => {
    const s = new ElicitationSession(CONSTRAINT_QUESTIONS);
    // The topic answer has a draft, but the follow-up comes first: nothing to show yet.
    expect(s.recordAnswer("PostgreSQL", { hasConstraint: true, draft: draft("Use PostgreSQL"), followUp: { question: "Only datastore?", placeholder: "" } }))
      .toBeNull();
    expect(s.advance()?.isFollowUp).toBe(true);
    // The follow-up's draft replaces the held one; it is the topic's only draft.
    expect(s.recordAnswer("Redis for caching", { hasConstraint: true, draft: draft("PostgreSQL primary, Redis cache only") }))
      .toEqual({ draft: draft("PostgreSQL primary, Redis cache only"), basis: "both" });
    expect(s.takeHeldDraft()).toBeNull();
    expect(s.advance()?.id).toBe("scalability");
  });

  it("a follow-up that adds nothing, or is skipped, falls back to the topic answer's draft", () => {
    const s = new ElicitationSession(CONSTRAINT_QUESTIONS);
    s.recordAnswer("PostgreSQL", { hasConstraint: true, draft: draft("Use PostgreSQL"), followUp: { question: "Only datastore?", placeholder: "" } });
    s.advance();
    expect(s.recordAnswer("not sure yet", { hasConstraint: false })).toEqual({ draft: draft("Use PostgreSQL"), basis: "first" });

    s.advance(); // → scalability
    s.recordAnswer("fast", { hasConstraint: true, draft: draft("Respond quickly"), followUp: { question: "Target latency?", placeholder: "" } });
    s.advance(); // → its follow-up, which the developer skips
    expect(s.takeHeldDraft()).toEqual({ draft: draft("Respond quickly"), basis: "first" });
    expect(s.advance()?.id).toBe("conventions");
  });

  it("without a follow-up the draft shows at once; a held draft never leaks into the next topic", () => {
    const s = new ElicitationSession(CONSTRAINT_QUESTIONS);
    expect(s.recordAnswer("React", { hasConstraint: true, draft: draft("Use React") })).toEqual({ draft: draft("Use React"), basis: "answer" });
    s.advance();
    // A tentative topic answer can still get a follow-up; with nothing concrete in either, no draft at all.
    expect(s.recordAnswer("maybe 10k users", ask("What would decide it?"))).toBeNull();
    s.advance();
    expect(s.recordAnswer("don't know", { hasConstraint: false })).toBeNull();
    expect(s.advance()?.id).toBe("conventions");
    expect(s.takeHeldDraft()).toBeNull(); // only a follow-up can have a held draft
  });
});
