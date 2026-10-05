import { describe, it, expect } from "vitest";
import { RetrievalAgent, RELEVANCE_THRESHOLD } from "../src/agents/RetrievalAgent";
import { EmbeddingService } from "../src/embeddings/EmbeddingService";
import { AdrStore } from "../src/storage/AdrStore";
import { buildPromptWithContext } from "../src/prompts/preCheckPrompts";
import { ADR } from "../src/types";
import { adr, blueprint, diffSummary } from "./helpers";

/** Deterministic embeddings: a one-hot vector per "topic" keyword, so cosine = shared topic. */
class FakeEmbeddings {
  calls = 0;
  constructor(private readonly available = true) {}
  async embed(text: string): Promise<number[] | null> {
    this.calls++;
    if (!this.available) { return null; }
    const topics = ["database", "frontend", "payment", "review", "deploy"];
    const t = text.toLowerCase();
    const v = topics.map((k) => (t.includes(k) ? 1 : 0));
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }
  asService(): EmbeddingService { return this as unknown as EmbeddingService; }
}

/** Records storeEmbedding calls instead of writing files. */
class FakeStore {
  stored: string[] = [];
  async storeEmbedding(id: string): Promise<void> { this.stored.push(id); }
  asStore(): AdrStore { return this as unknown as AdrStore; }
}

// A function, not a shared array: retrieval caches embeddings on the ADR objects it is given.
const freshAdrs = (): ADR[] => [
  adr("0001", "Use PostgreSQL", "database: all data in PostgreSQL"),
  adr("0002", "React frontend", "frontend built with React"),
  adr("0003", "Stripe payments", "payment through Stripe"),
  adr("0004", "Two approvals", "review by two people"),
  adr("0005", "AWS ECS", "deploy to ECS"),
  adr("0006", "Logging", "structured JSON logs"),
  adr("0007", "Monorepo", "single repository"),
];

describe("RetrievalAgent", () => {
  it("T26: with <= topK accepted ADRs, returns them unranked and computes nothing", async () => {
    const emb = new FakeEmbeddings();
    const result = await new RetrievalAgent(emb.asService()).retrieve("database", freshAdrs().slice(0, 3), blueprint(), 5);
    expect(result.map((a) => a.id)).toEqual(["0001", "0002", "0003"]);
    expect(emb.calls).toBe(0);
  });

  it("T27: returns exactly topK, most relevant first", async () => {
    const result = await new RetrievalAgent(new FakeEmbeddings().asService())
      .retrieve("add a payment provider", freshAdrs(), null, 5);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe("0003");
  });

  it("T28: a shared component name boosts an ADR by 0.15", async () => {
    const bp = blueprint({ components: [{ name: "Gateway", responsibility: "edge" }] });
    const adrs = [adr("0001", "Gateway rate limits", "limits"), adr("0002", "Other rate limits", "limits")];
    const { results } = await new RetrievalAgent(new FakeEmbeddings(false).asService())
      .retrieveScored("Gateway rate limits", adrs, bp, 5);
    expect(results[0].adr.id).toBe("0001");
    const lexicalOnly = await new RetrievalAgent(new FakeEmbeddings(false).asService())
      .retrieveScored("Gateway rate limits", adrs, blueprint({ components: [] }), 5);
    const boosted = results.find((r) => r.adr.id === "0001")!.score;
    const plain   = lexicalOnly.results.find((r) => r.adr.id === "0001")!.score;
    expect(boosted - plain).toBeCloseTo(0.15, 5);
  });

  it("T29: cached embeddings are reused; only missing ones are computed and stored", async () => {
    const emb = new FakeEmbeddings();
    const store = new FakeStore();
    const adrs = freshAdrs().map((a, i) => (i < 4 ? { ...a, embedding: [1, 0, 0, 0, 0] } : { ...a }));
    await new RetrievalAgent(emb.asService()).retrieve("database", adrs, null, 5, store.asStore());
    expect(store.stored).toEqual(["0005", "0006", "0007"]);
    expect(emb.calls).toBe(1 + 3); // the query + the three uncached ADRs

    store.stored = [];
    await new RetrievalAgent(emb.asService()).retrieve("database", adrs, null, 5, store.asStore());
    expect(store.stored).toEqual([]); // now everything is cached on the ADR objects
  });

  it("T30: when the embedding model is unavailable, falls back to lexical scoring", async () => {
    const { results, semantic } = await new RetrievalAgent(new FakeEmbeddings(false).asService())
      .retrieveScored("PostgreSQL database", freshAdrs(), null, 5);
    expect(semantic).toBe(false);
    expect(results[0].adr.id).toBe("0001");
  });

  it("T31: query built from the diff summary", () => {
    expect(RetrievalAgent.queryFromDiff(diffSummary({
      changedFiles: ["a.ts"], newSignatures: ["class A"], newImports: ["import x"],
      newDependencies: ['"pg": "^8"'], removedDependencies: ['"mysql": "^2"'], rawDiff: "ignored",
    }))).toBe('a.ts class A import x "pg": "^8" "mysql": "^2"');
  });

  it("only accepted ADRs are used as context", async () => {
    const adrs = [
      adr("0001", "A", "x"), adr("0002", "B", "x", { status: "proposed" }),
      adr("0003", "C", "x", { status: "rejected" }), adr("0004", "D", "x", { status: "superseded" }),
    ];
    const result = await new RetrievalAgent(new FakeEmbeddings().asService()).retrieve("x", adrs, null, 5);
    expect(result.map((a) => a.id)).toEqual(["0001"]);
  });

  it("retrieveScored marks relevance against the threshold for the scoring mode", async () => {
    const { results, semantic } = await new RetrievalAgent(new FakeEmbeddings().asService())
      .retrieveScored("payment checkout", freshAdrs(), null, 7);
    expect(semantic).toBe(true);
    for (const r of results) { expect(r.relevant).toBe(r.score >= RELEVANCE_THRESHOLD.blended); }
    expect(results.filter((r) => r.relevant).map((r) => r.adr.id)).toEqual(["0003"]);
  });
});

describe("buildPromptWithContext (pre-check attach, SRS 3.3.1 step 5)", () => {
  it("appends the chosen ADRs and the ARCH.md constraints", () => {
    const text = buildPromptWithContext("  Add a cache  ", [adr("0003", "Use Redis", "Redis\n  for caching")], ["React", "PostgreSQL"]);
    expect(text.startsWith("Add a cache\n\n---\n")).toBe(true);
    expect(text).toContain("- ADR-0003 Use Redis: Redis for caching");
    expect(text).toContain("Architecture constraints (docs/ARCH.md):\n- React\n- PostgreSQL");
  });

  it("caps constraints at 10 and says how many more there are", () => {
    const constraints = Array.from({ length: 13 }, (_, i) => `C${i}`);
    const text = buildPromptWithContext("p", [], constraints);
    expect(text).toContain("- C9\n- (+3 more in docs/ARCH.md)");
    expect(text).not.toContain("- C10");
  });

  it("returns the bare prompt when there is nothing to attach", () => {
    expect(buildPromptWithContext(" p ", [], [])).toBe("p");
  });
});
