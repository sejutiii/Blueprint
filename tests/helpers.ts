import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ADR, ArchBlueprint, DiffSummary } from "../src/types";
import { LLMClient } from "../src/llm/LLMClient";

/** A DiffSummary with every field present; override what the test cares about. */
export function diffSummary(overrides: Partial<DiffSummary> = {}): DiffSummary {
  return {
    changedFiles: [], addedFiles: [], modifiedFiles: [], deletedFiles: [], renamedFiles: [],
    newImports: [], newSignatures: [], newDependencies: [], removedDependencies: [], rawDiff: "",
    ...overrides,
  };
}

export function tempDir(prefix = "blueprint-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function adr(id: string, title: string, decision = "", extra: Partial<ADR> = {}): ADR {
  return {
    id, title, decision,
    status: "accepted",
    context: "",
    consequences: "",
    timestamp: new Date(2026, 0, Number(id) || 1).toISOString(),
    ...extra,
  };
}

export function blueprint(extra: Partial<ArchBlueprint> = {}): ArchBlueprint {
  return {
    systemOverview: "A test system.",
    components: [{ name: "ApiServer", responsibility: "Serves the REST API", technology: "Express" }],
    dataFlow: "Client -> ApiServer -> PostgreSQL",
    constraints: ["Use PostgreSQL as the primary database"],
    openQuestions: [],
    lastUpdated: new Date(2026, 0, 1).toISOString(),
    ...extra,
  };
}

/** An LLMClient whose replies are scripted; records every call. */
export class FakeLLM {
  calls: { system: string; user: string }[] = [];
  constructor(private readonly replies: string[] | ((user: string) => string)) {}

  async complete(system: string, user: string): Promise<string> {
    this.calls.push({ system, user });
    if (typeof this.replies === "function") { return this.replies(user); }
    const next = this.replies.shift();
    if (next === undefined) { throw new Error("FakeLLM: no scripted reply left"); }
    return next;
  }

  asClient(): LLMClient {
    return this as unknown as LLMClient;
  }
}
