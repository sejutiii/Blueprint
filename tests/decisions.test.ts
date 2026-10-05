import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { roleFor, parseRolesManifest } from "../src/access/roles";
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
import { Uri } from "./mocks/vscode";
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
  it("inserts at most one follow-up per topic, never nested, dropped on skip", () => {
    const s = new ElicitationSession(CONSTRAINT_QUESTIONS);
    expect(s.getCurrent()).toMatchObject({ id: "technology", topicIndex: 0, topicTotal: 5, isFollowUp: false });

    s.recordAnswer("PostgreSQL", { question: "Only datastore?", placeholder: "" });
    expect(s.advance()).toMatchObject({ isFollowUp: true, topicIndex: 0, parent: { answer: "PostgreSQL" } });

    s.recordAnswer("Redis too", { question: "nested?", placeholder: "" });
    expect(s.advance()).toMatchObject({ id: "scalability", isFollowUp: false });

    s.recordAnswer("10k users", { question: "p95?", placeholder: "" });
    expect(s.skip()).toMatchObject({ id: "conventions" });

    expect(s.advance()?.id).toBe("integrations");
    expect(s.advance()?.id).toBe("nonfunctional");
    expect(s.advance()).toBeNull();
  });
});
