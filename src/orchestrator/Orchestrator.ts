import * as vscode from "vscode";
import { LLMClient } from "../llm/LLMClient";
import { FileStore } from "../storage/FileStore";
import { AdrStore } from "../storage/AdrStore";
import { AuditLog } from "../storage/AuditLog";
import { AccessControl } from "../access/AccessControl";
import { Role, buildRolesManifest, rolesConfigured } from "../access/roles";
import { ArchitectureAgent } from "../agents/ArchitectureAgent";
import { ConstraintElicitationAgent, DecisionDraftResult } from "../agents/ConstraintElicitationAgent";
import { ComplianceAgent } from "../agents/ComplianceAgent";
import { DiffSummarizer } from "../agents/DiffSummarizer";
import { RetrievalAgent } from "../agents/RetrievalAgent";
import { PreCheckAgent } from "../agents/PreCheckAgent";
import { PreCheckResult, buildPromptWithContext } from "../prompts/preCheckPrompts";
import { ConstraintDraft } from "../prompts/constraintPrompts";
import { DecisionService, ProposeResult } from "../services/DecisionService";
import { buildCodebaseSnapshot } from "../parsing/CodebaseSnapshot";
import { renderArchMd } from "../prompts/archPrompts";
import {
  ADR, ArchBlueprint, ArchEffect, ComplianceResult, DiffSummary, ExtensionDetail, OrchestratorEvent, ViolationDetail,
} from "../types";

/** A failure with a message meant to be shown to the developer verbatim. */
export class BlueprintError extends Error {}

export type OrchestratorState = "idle" | "checking" | "ok" | "violation";

// Pass 1 only, Pass 2 only, or both in parallel.
export type ReviewMode = "full" | "violations" | "extensions";

export type ReviewOutcome =
  | { kind: "noDiff" }
  | { kind: "result"; result: ComplianceResult; diffSummary: DiffSummary };

export interface PreCheckAdr {
  adr: Omit<ADR, "embedding">;
  score: number;
  relevant: boolean; // cleared the relevance threshold
  cited: boolean;    // referenced by one of the conflicts
}

export interface DecisionDraftOutcome {
  result: DecisionDraftResult;
  /** Accepted ADRs the new one could replace, most related first. */
  candidates: Pick<ADR, "id" | "title" | "decision">[];
}

export interface PreCheckOutcome {
  result: PreCheckResult;
  adrs: PreCheckAdr[];
}

/** What the UI shows about roles: who you are, your role, and the team in roles.json. */
export interface RolesView {
  identity: string | null;
  role: Role;
  configured: boolean;   // roles.json names at least one Architect
  architects: string[];
  developers: string[];
}

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

  // Writes the whole ARCH.md, so once roles are configured only an Architect may do it (like regeneration, D6).
  async generateArchitecture(systemDescription: string, systemName?: string): Promise<ArchBlueprint> {
    await this.requireArchitect("initialize BluePrint, because it writes the whole ARCH.md");
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

  // ── Add Decision: a decision or changed requirement in the developer's words ─

  /**
   * Drafts an ADR from free text. The most related accepted ADRs are offered to the model as
   * candidates it might replace; all accepted ADRs come back (most related first) so the
   * developer can pick a different one, or none, before saving.
   */
  async draftDecision(description: string): Promise<DecisionDraftOutcome> {
    const { adrStore, blueprint } = await this.requireInitialized();
    const llm = await this.requireLlm();

    const accepted = (await adrStore.getAll()).filter((a) => a.status === "accepted");
    const { results } = await new RetrievalAgent().retrieveScored(description, accepted, blueprint, accepted.length, adrStore);
    const ranked  = results.length ? results.map((r) => r.adr) : accepted;
    const related = ranked.slice(0, TOP_K);

    const result = await new ConstraintElicitationAgent(llm).draftDecision(description, related);
    return {
      result,
      candidates: ranked.map(({ id, title, decision }) => ({ id, title, decision })),
    };
  }

  /** Saves an Add Decision draft; replacing an ADR swaps its ARCH.md constraint for the new one. */
  async saveDecision(draft: ConstraintDraft, supersedes?: string): Promise<ProposeResult> {
    const { decisions, adrStore } = this.workspace();
    let archEffect: ArchEffect = { kind: "add-constraint", constraint: draft.title };
    if (supersedes) {
      const old = await adrStore.getById(supersedes);
      const oldEffect = old?.archEffect;
      // The old ADR's constraint line: what its own effect added, or failing that its title.
      const replaces = oldEffect && oldEffect.kind !== "add-component" ? oldEffect.constraint : old?.title ?? "";
      archEffect = { kind: "replace-constraint", constraint: draft.title, replaces };
    }
    const result = await decisions.propose({
      title:        draft.title,
      context:      draft.context,
      decision:     draft.decision,
      consequences: draft.consequences,
      archEffect,
      ...(supersedes ? { supersedes } : {}),
    });
    this.hooks.onDataChanged();
    return result;
  }

  // ── PROMPT_SUBMITTED ──────────────────────────────────────────────────────

  async preCheck(promptText: string): Promise<PreCheckOutcome> {
    const { adrStore, blueprint, audit, access } = await this.requireInitialized();
    const llm = await this.requireLlm();

    const allAdrs = await adrStore.getAll();
    const { results: scored } = await new RetrievalAgent().retrieveScored(promptText, allAdrs, blueprint, TOP_K, adrStore);

    // The agent sees the full top-K (recall matters for spotting conflicts); the developer is
    // shown which of those actually cleared the relevance bar, plus any the agent cited.
    const result = await new PreCheckAgent(llm).check(promptText, blueprint, scored.map((s) => s.adr));
    const citedIds = new Set(
      result.conflicts.flatMap((c) => [...c.constraintId.matchAll(/ADR-?(\d+)/gi)].map((m) => m[1].padStart(4, "0")))
    );
    const adrs: PreCheckAdr[] = scored.map(({ adr, score, relevant }) => {
      const { embedding: _omit, ...rest } = adr;
      return { adr: rest, score, relevant, cited: citedIds.has(adr.id) };
    });

    await audit?.append({
      eventType: "pre_check",
      summary:   result.hasConflicts
        ? `Pre-check found ${result.conflicts.length} conflict(s) for prompt: ${promptText.slice(0, 80)}`
        : `Pre-check clean for prompt: ${promptText.slice(0, 80)}`,
      actor: (await access.resolveIdentity()) ?? undefined,
    });
    return { result, adrs };
  }

  /** The prompt plus the chosen ADRs and the ARCH.md constraints, ready to paste into any AI assistant. */
  async promptWithContext(promptText: string, adrIds: string[]): Promise<string> {
    const { adrStore, blueprint } = await this.requireInitialized();
    const wanted = new Set(adrIds);
    const adrs   = (await adrStore.getAll()).filter((a) => wanted.has(a.id));
    return buildPromptWithContext(promptText, adrs, blueprint.constraints);
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
          actor, changedFiles: diffSummary.changedFiles, complianceResult: result,
        });
      }
      if (extensions.length) {
        await ws.audit?.append({
          eventType: "extension_detected",
          summary:   `New component(s) detected: ${extensions.map((e) => e.name).join(", ")}`,
          actor, changedFiles: diffSummary.changedFiles,
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

  // ── Living ARCH.md: regenerate from the codebase (Architect-only) ─────────

  private async requireArchitect(action: string): Promise<string | undefined> {
    const { identity, role, manifest } = await this.workspace().access.resolveRoles();
    if (role !== "architect") {
      const who = manifest?.architects.length ? ` Architects: ${manifest.architects.join(", ")}.` : "";
      const you = identity
        ? `You are ${identity}, a Developer in .blueprint/roles.json.`
        : "BluePrint can't identify you (git user.email is unset), so you count as a Developer.";
      throw new BlueprintError(`Only an Architect can ${action}. ${you}${who}`);
    }
    return identity ?? undefined;
  }

  /** Builds a proposed ARCH.md from the codebase without writing anything. */
  async proposeRegeneration(): Promise<{ blueprint: ArchBlueprint; markdown: string }> {
    await this.requireArchitect("regenerate ARCH.md, because it rewrites the whole document");
    const { fileStore, blueprint, root } = await this.requireInitialized();
    const llm      = await this.requireLlm();
    const snapshot = await buildCodebaseSnapshot(root);
    const next     = await new ArchitectureAgent(llm).regenerateFromCodebase(blueprint, snapshot);
    const name     = (await fileStore.readSystemName()) ?? undefined;
    return { blueprint: next, markdown: renderArchMd(next, name) };
  }

  /** Writes a regenerated blueprint; the previous ARCH.md is kept in history, so it can be reverted. */
  async applyRegeneration(blueprint: ArchBlueprint): Promise<void> {
    const actor = await this.requireArchitect("regenerate ARCH.md, because it rewrites the whole document");
    const { fileStore, audit } = this.workspace();
    await fileStore.writeArchBlueprint(blueprint, undefined, "ARCH.md regenerated from codebase");
    await audit?.append({
      eventType: "arch_updated",
      summary:   `ARCH.md regenerated from codebase (${blueprint.components.length} components, ${blueprint.constraints.length} constraints)`,
      actor,
    });
    this.hooks.onDataChanged();
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

  /** Fails fast (before asking for a note) when a Developer tries to approve or reject. */
  async requireApprover(): Promise<void> {
    await this.requireArchitect("approve or reject decisions");
  }

  // ── Roles (SRS 3.2.5) ─────────────────────────────────────────────────────

  async roles(): Promise<RolesView> {
    const { identity, role, manifest } = await this.workspace().access.resolveRoles();
    return {
      identity, role,
      configured: rolesConfigured(manifest),
      architects: manifest?.architects ?? [],
      developers: manifest?.developers ?? [],
    };
  }

  /**
   * Saves roles.json from the setup wizard or the roles panel. Creating it is open to anyone (no
   * roles yet means everyone is an Architect); once Architects are named, only they may change it.
   */
  async saveRoles(otherArchitects: string[], developers: string[]): Promise<RolesView> {
    const { access, audit } = this.workspace();
    await this.requireArchitect("change roles");
    const identity = await access.resolveIdentity();
    const built = buildRolesManifest(identity, otherArchitects, developers);
    if ("error" in built) { throw new BlueprintError(built.error); }
    await access.writeManifest(built.manifest);
    await audit?.append({
      eventType: "roles_updated",
      summary:   `Roles updated: ${built.manifest.architects.length} Architect(s) (${built.manifest.architects.join(", ")}), ` +
                 `${built.manifest.developers?.length ?? 0} Developer(s)`,
      actor:     identity ?? undefined,
    });
    this.hooks.onDataChanged();
    return this.roles();
  }
}
