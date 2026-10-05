import { describe, it, expect } from "vitest";
import { ArchitectureAgent, mergeConstraints } from "../src/agents/ArchitectureAgent";
import { ComplianceAgent } from "../src/agents/ComplianceAgent";
import { ConstraintElicitationAgent } from "../src/agents/ConstraintElicitationAgent";
import { PreCheckAgent } from "../src/agents/PreCheckAgent";
import { CONSTRAINT_QUESTIONS } from "../src/prompts/constraintPrompts";
import { parseJsonObject } from "../src/util/llmJson";
import { FakeLLM, blueprint, adr, diffSummary } from "./helpers";

describe("parseJsonObject (defensive parsing, SRS 4.3)", () => {
  it("strips markdown fences", () => {
    expect(parseJsonObject("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });
  it("extracts JSON surrounded by prose", () => {
    expect(parseJsonObject("Sure! Here it is: {\"a\": {\"b\": 2}} Hope that helps.")).toEqual({ a: { b: 2 } });
  });
  it("returns null for non-JSON and for arrays", () => {
    expect(parseJsonObject("no json here")).toBeNull();
    expect(parseJsonObject("[1,2]")).toBeNull();
  });
});

describe("ArchitectureAgent", () => {
  it("T11: returns a blueprint with components, constraints and data flow", async () => {
    const llm = new FakeLLM([JSON.stringify({
      systemOverview: "Shop", dataFlow: "React -> API -> PG",
      components: [{ name: "Frontend", responsibility: "UI", technology: "React" }, { name: "Api", responsibility: "REST" }],
      constraints: ["PostgreSQL"], openQuestions: [],
    })]);
    const bp = await new ArchitectureAgent(llm.asClient()).generate("A React frontend calling a Node API backed by PostgreSQL");
    expect(bp.components.map((c) => c.name)).toEqual(["Frontend", "Api"]);
    expect(bp.components[1]).not.toHaveProperty("technology");
    expect(bp.constraints).toEqual(["PostgreSQL"]);
    expect(bp.dataFlow).toBe("React -> API -> PG");
    expect(Date.parse(bp.lastUpdated)).not.toBeNaN();
  });

  it("T14: strips fences, and throws with the raw text when there is no JSON", async () => {
    const fenced = new FakeLLM(["```json\n{\"systemOverview\":\"x\",\"components\":[],\"dataFlow\":\"\",\"constraints\":[],\"openQuestions\":[]}\n```"]);
    await expect(new ArchitectureAgent(fenced.asClient()).generate("x")).resolves.toMatchObject({ systemOverview: "x" });

    const garbage = new FakeLLM(["I cannot help with that"]);
    await expect(new ArchitectureAgent(garbage.asClient()).generate("x")).rejects.toThrow(/I cannot help with that/);
  });

  it("coerces wrong field types instead of trusting them", () => {
    const bp = ArchitectureAgent.parseResponse(JSON.stringify({ components: "oops", constraints: [1, "ok"], openQuestions: null }));
    expect(bp.components).toEqual([]);
    expect(bp.constraints).toEqual(["ok"]);
    expect(bp.openQuestions).toEqual([]);
  });

  it("regeneration never drops existing constraints (mergeConstraints)", async () => {
    const llm = new FakeLLM([JSON.stringify({ systemOverview: "s", components: [], dataFlow: "", constraints: ["Express API", "use postgresql as the primary database"], openQuestions: [] })]);
    const next = await new ArchitectureAgent(llm.asClient()).regenerateFromCodebase(blueprint(), "snapshot");
    expect(next.constraints).toEqual(["Use PostgreSQL as the primary database", "Express API"]);
    expect(mergeConstraints(["A", " a ", ""], ["B", "b"])).toEqual(["A", "B"]);
  });
});

describe("ComplianceAgent", () => {
  it("T32: parses violations with severity", () => {
    const r = ComplianceAgent.parseComplianceResponse(JSON.stringify({
      violation: true,
      violations: [{ constraintId: "ADR-0001", description: "MongoDB client added", severity: "high", affectedCodeLocation: "db.ts" }],
    }));
    expect(r.violation).toBe(true);
    expect(r.violations[0]).toEqual({ constraintId: "ADR-0001", description: "MongoDB client added", severity: "high", affectedCodeLocation: "db.ts" });
  });

  it("T35: unparseable output falls back to no violation", () => {
    expect(ComplianceAgent.parseComplianceResponse("<html>error</html>")).toEqual({ violation: false, violations: [] });
  });

  it("derives `violation` from the list, and normalises bad severities", () => {
    expect(ComplianceAgent.parseComplianceResponse(JSON.stringify({ violation: true })).violation).toBe(false);
    const r = ComplianceAgent.parseComplianceResponse(JSON.stringify({ violations: [{ description: "x", severity: "CRITICAL" }, { description: "" }] }));
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].severity).toBe("medium");
    expect(r.violation).toBe(true);
  });

  it("T37/T38 + D2: extensions are a list; known components, duplicates and extras are dropped", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `Svc${i}`, responsibility: "r", rationale: "why" }));
    const raw = JSON.stringify({ extensions: [{ name: "ApiServer", responsibility: "dup" }, { name: "svc0", responsibility: "dup" }, ...many] });
    const exts = ComplianceAgent.parseExtensionResponse(raw, ["ApiServer"]);
    expect(exts.map((e) => e.name)).toEqual(["svc0", "Svc1", "Svc2", "Svc3", "Svc4"]);
    expect(ComplianceAgent.parseExtensionResponse(JSON.stringify({ extensions: [] }))).toEqual([]);
  });

  it("accepts the legacy single-extension shape", () => {
    const exts = ComplianceAgent.parseExtensionResponse(JSON.stringify({
      extensionDetected: true, extension: { name: "EventBus", responsibility: "pub/sub", technology: "Kafka", rationale: "new" },
    }));
    expect(exts).toEqual([{ name: "EventBus", responsibility: "pub/sub", technology: "Kafka", rationale: "new" }]);
  });

  it("check() reports which ADRs were used as context", async () => {
    const llm = new FakeLLM([JSON.stringify({ violation: false, violations: [] })]);
    const diff = diffSummary({ changedFiles: ["a.ts"], modifiedFiles: ["a.ts"] });
    const result = await new ComplianceAgent(llm.asClient()).check(diff, blueprint(), [adr("0001", "PG"), adr("0002", "React")]);
    expect(result.adrsUsed).toEqual(["0001", "0002"]);
    expect(llm.calls[0].user).toContain("[ADR-0001] PG");
  });

  it("both passes see files by kind, removals, and the diff excerpt", async () => {
    const diff = diffSummary({
      changedFiles: ["src/reviews.ts", "src/orders.ts", "src/payments.ts"],
      addedFiles: ["src/reviews.ts"], modifiedFiles: ["src/orders.ts"], deletedFiles: ["src/payments.ts"],
      removedDependencies: ['"stripe": "^14.0.0"'],
      rawDiff: "diff --git a/src/orders.ts b/src/orders.ts\n+const db = mongo.connect(url);\n",
    });
    const llm = new FakeLLM([JSON.stringify({ violation: false, violations: [] }), JSON.stringify({ extensions: [] })]);
    const agent = new ComplianceAgent(llm.asClient());
    await agent.check(diff, blueprint(), []);
    await agent.detectExtensions(diff, blueprint());
    for (const call of llm.calls) {
      expect(call.user).toContain("Added files: src/reviews.ts");
      expect(call.user).toContain("Modified files: src/orders.ts");
      expect(call.user).toContain("Deleted files: src/payments.ts");
      expect(call.user).toContain('Removed dependencies: "stripe": "^14.0.0"');
      expect(call.user).toContain("DIFF EXCERPT");
      expect(call.user).toContain("mongo.connect(url)");
      expect(call.user).not.toContain("New files");
    }
  });
});

describe("ConstraintElicitationAgent", () => {
  const q = CONSTRAINT_QUESTIONS[0];

  it("T16: a concrete answer yields a draft ADR (and an optional follow-up)", async () => {
    const llm = new FakeLLM([JSON.stringify({
      hasConstraint: true,
      draft: { title: "Use React and PostgreSQL", context: "c", decision: "d", consequences: "q" },
      followUp: { question: "Is PostgreSQL the only datastore?", placeholder: "e.g. Redis for cache" },
    })]);
    const r = await new ConstraintElicitationAgent(llm.asClient()).analyzeAnswer(q, "We are using React and PostgreSQL");
    expect(r.hasConstraint).toBe(true);
    expect(r.draft?.title).toBe("Use React and PostgreSQL");
    expect(r.followUp?.question).toMatch(/only datastore/);
  });

  it("T17: a tentative answer yields no draft", async () => {
    const llm = new FakeLLM([JSON.stringify({ hasConstraint: false })]);
    expect(await new ConstraintElicitationAgent(llm.asClient()).analyzeAnswer(q, "We might use React")).toEqual({ hasConstraint: false });
  });

  it("T18: an empty answer short-circuits without an LLM call", async () => {
    const llm = new FakeLLM([]);
    expect(await new ConstraintElicitationAgent(llm.asClient()).analyzeAnswer(q, "   ")).toEqual({ hasConstraint: false });
    expect(llm.calls).toHaveLength(0);
  });

  it("a draft missing title or decision is rejected", () => {
    expect(ConstraintElicitationAgent.parseResponse(JSON.stringify({ hasConstraint: true, draft: { title: "", decision: "d" } })))
      .toEqual({ hasConstraint: false });
  });

  it("a follow-up's answer is analysed with the original exchange and follow-ups disabled", async () => {
    const llm = new FakeLLM([JSON.stringify({ hasConstraint: false })]);
    const agent = new ConstraintElicitationAgent(llm.asClient());
    const session = agent.startSession();
    session.recordAnswer("PostgreSQL", { question: "Only datastore?", placeholder: "" });
    const followUp = session.advance()!;
    await agent.analyzeAnswer(followUp, "Redis for caching");
    expect(llm.calls[0].user).toContain('Earlier answer: "PostgreSQL"');
    expect(llm.calls[0].user).toContain("Follow-ups are disabled");
  });
});

describe("PreCheckAgent", () => {
  it("T45: conflicts with suggestions and a revised prompt", () => {
    const r = PreCheckAgent.parseResponse(JSON.stringify({
      hasConflicts: true,
      conflicts: [{ constraintId: "ADR-0001", description: "MySQL conflicts with PostgreSQL", severity: "high", suggestion: "Use PostgreSQL" }],
      revisedPrompt: "Add a PostgreSQL connection",
    }));
    expect(r.hasConflicts).toBe(true);
    expect(r.conflicts[0].suggestion).toBe("Use PostgreSQL");
    expect(r.revisedPrompt).toBe("Add a PostgreSQL connection");
  });

  it("T46: no conflicts -> no revised prompt even if the model sent one", () => {
    expect(PreCheckAgent.parseResponse(JSON.stringify({ hasConflicts: false, conflicts: [], revisedPrompt: "x" })))
      .toEqual({ hasConflicts: false, conflicts: [] });
  });

  it("unparseable output falls back to no conflicts", () => {
    expect(PreCheckAgent.parseResponse("oops")).toEqual({ hasConflicts: false, conflicts: [] });
  });
});
