import * as vscode from "vscode";
import { LLMClient } from "../llm/LLMClient";
import { FileStore } from "../storage/FileStore";
import { AdrStore } from "../storage/AdrStore";
import { AuditLog } from "../storage/AuditLog";
import { AccessControl } from "../access/AccessControl";
import { ArchitectureAgent } from "../agents/ArchitectureAgent";
import { ConstraintElicitationAgent } from "../agents/ConstraintElicitationAgent";
import { ComplianceAgent } from "../agents/ComplianceAgent";
import { DiffSummarizer } from "../agents/DiffSummarizer";
import { RetrievalAgent } from "../agents/RetrievalAgent";
import { PreCheckAgent } from "../agents/PreCheckAgent";
import { PreCheckResult } from "../prompts/preCheckPrompts";
import { ConstraintDraft } from "../prompts/constraintPrompts";
import { DecisionService, ProposeResult } from "../services/DecisionService";
import {
  ADR, ArchBlueprint, ComplianceResult, DiffSummary, ExtensionDetail, OrchestratorEvent, ViolationDetail,
} from "../types";

/** A failure with a message meant to be shown to the developer verbatim. */
export class BlueprintError extends Error {}

export type OrchestratorState = "idle" | "checking" | "ok" | "violation";

// Pass 1 only, Pass 2 only, or both in parallel.
export type ReviewMode = "full" | "violations" | "extensions";

export type ReviewOutcome =
  | { kind: "noDiff" }
  | { kind: "result"; result: ComplianceResult; diffSummary: DiffSummary };

export interface OrchestratorHooks {
  onState(state: OrchestratorState): void;
  /** ADRs / ARCH.md changed — sidebar views and counts should refresh. */
  onDataChanged(): void;
}

const TOP_K = 5;

/**
 * Routes developer events to agent pipelines and owns workflow state. Kept thin: it assembles
 * context and sequences agents; all judgment lives in the agents, all UI in extension.ts.
 *
 *   PROJECT_INIT              → Architecture Agent (no retrieval — no history yet)
 *   PROMPT_SUBMITTED          → Retrieval Agent → Pre-Check Agent
 *   CODE_GENERATED / MANUAL…  → Diff Summarizer → { Retrieval Agent → Compliance Pass 1  ‖  Pass 2 }
 */
export class Orchestrator {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly hooks: OrchestratorHooks
  ) {}

  // ── Event dispatch ────────────────────────────────────────────────────────

  async dispatch(event: OrchestratorEvent): Promise<unknown> {
    switch (event.type) {
      case "PROJECT_INIT":             return this.generateArchitecture(event.systemDescription);
      case "PROMPT_SUBMITTED":         return this.preCheck(event.prompt);
      case "CODE_GENERATED":
      case "MANUAL_REVIEW_REQUESTED":  return this.review("full");
    }
  }

  // ── Workspace / dependency access ─────────────────────────────────────────

  private workspace() {
    const fileStore = FileStore.fromWorkspace();
    const adrStore  = AdrStore.fromWorkspace();
    const access    = AccessControl.fromWorkspace();
    if (!fileStore || !adrStore || !access) {
      throw new BlueprintError("No workspace folder is open. Open a project folder first.");
    }
    const audit     = AuditLog.fromWorkspace();
    const decisions = new DecisionService(adrStore, fileStore, access, audit);
    return { fileStore, adrStore, access, audit, decisions, root: vscode.workspace.workspaceFolders![0].uri.fsPath };
  }

  private async requireLlm(): Promise<LLMClient> {
    const llm = await LLMClient.fromSecrets(this.secrets);
    if (!llm) {
      throw new BlueprintError("No LLM provider configured. Run BluePrint: Initialize Project first.");
    }
    return llm;
  }

  private async requireInitialized() {
    const ws = this.workspace();
    const blueprint = await ws.fileStore.readArchBlueprint();
    if (!blueprint) {
      throw new BlueprintError("Project not initialized. Run BluePrint: Initialize Project first.");
    }
    return { ...ws, blueprint };
  }

  async isInitialized(): Promise<boolean> {
    const fileStore = FileStore.fromWorkspace();
    return !!fileStore && (await fileStore.isInitialized());
  }

  // ── PROJECT_INIT ──────────────────────────────────────────────────────────

  async generateArchitecture(systemDescription: string, systemName?: string): Promise<ArchBlueprint> {
    const ws        = this.workspace();
    const llm       = await this.requireLlm();
    const blueprint = await new ArchitectureAgent(llm).generate(systemDescription);
    await ws.fileStore.writeArchBlueprint(blueprint, systemName, "ARCH.md re-initialized");
    this.hooks.onState("ok");
    this.hooks.onDataChanged();
    return blueprint;
  }

  async createConstraintAgent(): Promise<ConstraintElicitationAgent> {
    return new ConstraintElicitationAgent(await this.requireLlm());
  }

  /** A constraint the developer approved in the wizard becomes an ADR and, once approved, an ARCH.md constraint. */
  async saveConstraintDraft(draft: ConstraintDraft): Promise<ProposeResult> {
    const { decisions } = this.workspace();
    const result = await decisions.propose({
      title:        draft.title,
      context:      draft.context,
      decision:     draft.decision,
      consequences: draft.consequences,
      archEffect:   { kind: "add-constraint", constraint: draft.title },
    });
    this.hooks.onDataChanged();
    return result;
  }

  // ── PROMPT_SUBMITTED ──────────────────────────────────────────────────────

  async preCheck(promptText: string): Promise<{ result: PreCheckResult; retrievedAdrs: ADR[] }> {
    const { adrStore, blueprint, audit, access } = await this.requireInitialized();
    const llm = await this.requireLlm();

    const allAdrs      = await adrStore.getAll();
    const relevantAdrs = await new RetrievalAgent().retrieve(promptText, allAdrs, blueprint, TOP_K, adrStore);
    const result       = await new PreCheckAgent(llm).check(promptText, blueprint, relevantAdrs);

    await audit?.append({
      eventType: "pre_check",
      summary:   result.hasConflicts
        ? `Pre-check found ${result.conflicts.length} conflict(s) for prompt: ${promptText.slice(0, 80)}`
        : `Pre-check clean for prompt: ${promptText.slice(0, 80)}`,
      actor: (await access.resolveIdentity()) ?? undefined,
    });
    return { result, retrievedAdrs: relevantAdrs };
  }

  // ── CODE_GENERATED / MANUAL_REVIEW_REQUESTED ──────────────────────────────

  async review(mode: ReviewMode): Promise<ReviewOutcome> {
    this.hooks.onState("checking");
    try {
      const ws = await this.requireInitialized();
      const llm = await this.requireLlm();

      const summarizer = new DiffSummarizer();
      const rawDiff    = await summarizer.getDiff(ws.root);
      if (!rawDiff.trim()) {
        this.hooks.onState("idle");
        return { kind: "noDiff" };
      }
      const diffSummary = await summarizer.summarize(rawDiff, ws.root);
      const agent       = new ComplianceAgent(llm);
      const actor       = (await ws.access.resolveIdentity()) ?? undefined;

      const runPass1 = async (): Promise<Pick<ComplianceResult, "violation" | "violations" | "adrsUsed">> => {
        const allAdrs      = await ws.adrStore.getAll();
        const query        = RetrievalAgent.queryFromDiff(diffSummary);
        const relevantAdrs = await new RetrievalAgent().retrieve(query, allAdrs, ws.blueprint, TOP_K, ws.adrStore);
        return agent.check(diffSummary, ws.blueprint, relevantAdrs);
      };

      // The two passes are independent judgments, so they run in parallel; violations and
      // extensions are reported together and each is resolved (and recorded) on its own.
      const [pass1, extensions] = await Promise.all([
        mode !== "extensions" ? runPass1() : Promise.resolve({ violation: false, violations: [], adrsUsed: [] }),
        mode !== "violations" ? agent.detectExtensions(diffSummary, ws.blueprint) : Promise.resolve([]),
      ]);
      const result: ComplianceResult = { ...pass1, extensions };

      if (mode !== "extensions") {
        await ws.audit?.append({
          eventType: "compliance_check",
          summary:   pass1.violation ? `${pass1.violations.length} violation(s) detected` : "No violations detected",
          actor, changedFiles: diffSummary.newFiles, complianceResult: result,
        });
      }
      if (extensions.length) {
        await ws.audit?.append({
          eventType: "extension_detected",
          summary:   `New component(s) detected: ${extensions.map((e) => e.name).join(", ")}`,
          actor, changedFiles: diffSummary.newFiles,
        });
      }

      this.hooks.onState(pass1.violation ? "violation" : "ok");
      return { kind: "result", result, diffSummary };
    } catch (err) {
      this.hooks.onState("idle");
      throw err;
    }
  }

  // ── Resolutions (one call per violation / extension → one ADR each) ───────

  /**
   * "Update Architecture" records the developer's reasoning for this one violation as its own
   * ADR (routed through access control). "Modify Code" records no decision: the developer edits
   * the code and re-runs the review.
   */
  async resolveViolation(
    violation: ViolationDetail,
    resolution: "update-arch" | "modify-code",
    reasoning: string,
    changedFiles: string[] = []
  ): Promise<ProposeResult | null> {
    const { decisions, audit, access } = this.workspace();

    if (resolution === "modify-code") {
      await audit?.append({
        eventType: "compliance_check",
        summary:   `Developer chose to modify code to resolve: ${violation.description.slice(0, 80)}`,
        actor: (await access.resolveIdentity()) ?? undefined, changedFiles,
      });
      return null;
    }

    const location = violation.affectedCodeLocation ? `
Location: ${violation.affectedCodeLocation}` : "";
    const result = await decisions.propose({
      title:        `Compliance Decision: ${violation.description.slice(0, 60)}`,
      context:      `Compliance check detected a ${violation.severity}-severity conflict with ${violation.constraintId}:
` +
                    `${violation.description}${location}`,
      decision:     `Update Architecture: ${reasoning}`,
      consequences: `ARCH.md is updated to record this approved direction change, superseding the conflicting part of ${violation.constraintId}.`,
      archEffect:   { kind: "add-constraint", constraint: `Approved architecture change: ${reasoning}` },
      changedFiles,
    });
    this.hooks.onDataChanged();
    return result;
  }

  async confirmExtension(
    ext: ExtensionDetail,
    reasoning: string,
    changedFiles: string[] = []
  ): Promise<ProposeResult> {
    const { decisions } = this.workspace();
    const result = await decisions.propose({
      title:        `Extension: Add ${ext.name} component`,
      context:      ext.rationale,
      decision:     reasoning
        ? `Developer confirmed new component. ${reasoning}`
        : "Developer confirmed this new structural element during architectural review.",
      consequences: `ARCH.md is updated to include ${ext.name} as a new component.`,
      archEffect:   {
        kind: "add-component",
        component: {
          name: ext.name, responsibility: ext.responsibility,
          ...(ext.technology ? { technology: ext.technology } : {}),
        },
      },
      changedFiles,
    });
    this.hooks.onDataChanged();
    return result;
  }

  // ── Approval queue ────────────────────────────────────────────────────────

  async approve(id: string, note?: string): Promise<ADR> {
    const adr = await this.workspace().decisions.approve(id, note);
    this.hooks.onDataChanged();
    return adr;
  }

  async reject(id: string, note: string): Promise<ADR> {
    const adr = await this.workspace().decisions.reject(id, note);
    this.hooks.onDataChanged();
    return adr;
  }

  async currentActor() {
    return this.workspace().access.resolveActor();
  }
}
