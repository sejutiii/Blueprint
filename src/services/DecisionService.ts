import { ADR, ArchEffect } from "../types";
import { AdrStore, AdrDraft } from "../storage/AdrStore";
import { FileStore } from "../storage/FileStore";
import { AuditLog } from "../storage/AuditLog";
import { AccessControl } from "../access/AccessControl";
import { RetrievalAgent } from "../agents/RetrievalAgent";

export interface ProposeInput extends Omit<AdrDraft, "status" | "proposedBy" | "reviewedBy" | "reviewNote" | "archEffect"> {
  archEffect?: ArchEffect;
  /** Files in the diff that prompted this decision — recorded in the audit trail. */
  changedFiles?: string[];
}

export interface ProposeResult {
  adr: ADR;
  /** True when the proposer was an Architect, so the decision skipped the approval queue. */
  autoApproved: boolean;
}

/**
 * Single entry point for architecture-changing decisions (SRS 3.2.5). Every new ADR,
 * "Update Architecture" resolution and confirmed extension goes through `propose`; an
 * Architect's decision is finalized immediately, anyone else's waits in the queue
 * (ADR status "proposed") until an Architect approves or rejects it.
 * Finalizing = patch ARCH.md + cache the local embedding + write the audit trail.
 */
export class DecisionService {
  constructor(
    private readonly adrStore: AdrStore,
    private readonly fileStore: FileStore,
    private readonly access: AccessControl,
    private readonly audit: AuditLog | null,
    private readonly retrieval: RetrievalAgent = new RetrievalAgent()
  ) {}

  async propose(input: ProposeInput): Promise<ProposeResult> {
    const actor = await this.access.resolveActor();
    const { changedFiles, ...draft } = input;
    const proposedBy = actor.identity ?? undefined;

    if (draft.supersedes) {
      const old = await this.adrStore.getById(draft.supersedes);
      if (!old) { throw new Error(`ADR-${draft.supersedes} not found, so it can't be replaced.`); }
      if (old.status !== "accepted") {
        throw new Error(`ADR-${old.id} is ${old.status}, not accepted, so there is nothing to replace.`);
      }
    }

    if (actor.role === "architect") {
      const adr = await this.adrStore.create({
        ...draft,
        status:     "accepted",
        proposedBy,
        reviewedBy: proposedBy,
        reviewNote: "Auto-approved: proposer holds the Architect role.",
      });
      await this.audit?.append({
        eventType: "adr_created", summary: `ADR-${adr.id} ${adr.title}`,
        actor: proposedBy, adrId: adr.id, changedFiles,
      });
      await this.finalize(adr, proposedBy);
      return { adr, autoApproved: true };
    }

    const adr = await this.adrStore.create({ ...draft, status: "proposed", proposedBy });
    await this.audit?.append({
      eventType: "adr_proposed", summary: `ADR-${adr.id} proposed (pending Architect approval): ${adr.title}`,
      actor: proposedBy, adrId: adr.id, changedFiles,
    });
    return { adr, autoApproved: false };
  }

  async approve(id: string, note = ""): Promise<ADR> {
    const { adr, reviewer } = await this.loadPendingForReview(id);
    const updated = await this.adrStore.update(id, {
      status: "accepted", reviewedBy: reviewer, reviewNote: note.trim() || undefined,
    });
    await this.audit?.append({
      eventType: "adr_approved", summary: `ADR-${id} approved: ${adr.title}`, actor: reviewer, adrId: id,
    });
    await this.finalize(updated, reviewer);
    return updated;
  }

  async reject(id: string, note: string): Promise<ADR> {
    if (!note.trim()) { throw new Error("A rejection needs your reasoning so the proposer can act on it."); }
    const { adr, reviewer } = await this.loadPendingForReview(id);
    const updated = await this.adrStore.update(id, {
      status: "rejected", reviewedBy: reviewer, reviewNote: note.trim(),
    });
    await this.audit?.append({
      eventType: "adr_rejected", summary: `ADR-${id} rejected: ${adr.title}`, actor: reviewer, adrId: id,
    });
    return updated;
  }

  private async loadPendingForReview(id: string): Promise<{ adr: ADR; reviewer: string | undefined }> {
    const actor = await this.access.resolveActor();
    if (actor.role !== "architect") {
      throw new Error("Only an Architect can approve or reject decisions. See .blueprint/roles.json.");
    }
    const adr = await this.adrStore.getById(id);
    if (!adr) { throw new Error(`ADR-${id} not found.`); }
    if (adr.status !== "proposed") { throw new Error(`ADR-${id} is not pending approval (status: ${adr.status}).`); }
    return { adr, reviewer: actor.identity ?? undefined };
  }

  // Approval is the point at which a decision becomes real: ARCH.md is patched and the
  // ADR gets its local embedding so future retrievals can find it without any API call.
  private async finalize(adr: ADR, actor: string | undefined): Promise<void> {
    // A replaced decision stops binding the moment its successor does: retrieval, reviews and
    // pre-checks only use accepted ADRs. Skipped if it was retired meanwhile (e.g. another
    // proposal replaced it first); the ARCH.md patch then simply appends the new constraint.
    if (adr.supersedes) {
      const old = await this.adrStore.getById(adr.supersedes);
      if (old?.status === "accepted") {
        await this.adrStore.update(old.id, { status: "superseded", supersededBy: adr.id });
        await this.audit?.append({
          eventType: "adr_superseded", summary: `ADR-${old.id} superseded by ADR-${adr.id}: ${old.title}`,
          actor, adrId: old.id,
        });
      }
    }
    if (adr.archEffect) {
      const touched = await this.fileStore.applyArchEffect(adr.archEffect, `ADR-${adr.id}: ${adr.title}`);
      if (touched.length) {
        await this.audit?.append({
          eventType: "arch_updated", summary: `ARCH.md updated (${touched.join(", ")}) by ADR-${adr.id}`,
          actor, adrId: adr.id,
        });
      }
    }
    try {
      await this.retrieval.ensureEmbedding(adr, RetrievalAgent.adrToText(adr), this.adrStore);
    } catch { /* retrieval falls back to lexical-only scoring */ }
  }
}
