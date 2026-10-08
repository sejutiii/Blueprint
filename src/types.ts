// Core data models shared across all agents and UI components

// "proposed" = pending Architect approval; "rejected" = Architect declined it.
export type AdrStatus = "proposed" | "accepted" | "rejected" | "deprecated" | "superseded";

// What approving an ADR does to ARCH.md, so approval (not proposal) triggers the patch.
export type ArchEffect =
  | { kind: "add-component"; component: ArchComponent }
  | { kind: "add-constraint"; constraint: string }
  // A changed requirement: swap the superseded ADR's constraint line for the new one
  // (appended instead if that line is no longer in ARCH.md).
  | { kind: "replace-constraint"; constraint: string; replaces: string }
  // A planned component now exists in the code. Recorded without an ADR: it was already decided.
  | { kind: "mark-implemented"; component: string; files: string[] };

export interface ADR {
  id: string;           // e.g. "0001"
  title: string;
  status: AdrStatus;
  context: string;
  decision: string;
  consequences: string;
  timestamp: string;    // ISO 8601
  tags?: string[];
  embedding?: number[]; // stored separately in adr-index.json
  proposedBy?: string;  // git user.email of the proposer
  reviewedBy?: string;  // Architect who approved/rejected
  reviewNote?: string;  // Architect's reasoning on rejection (or approval)
  archEffect?: ArchEffect; // applied to ARCH.md when the ADR is approved
  supersedes?: string;     // id of the ADR this one replaces (marked superseded on approval)
  supersededBy?: string;   // id of the ADR that replaced this one
}

/** Planned: described (e.g. at setup) but not in the code yet. Implemented: present in the code. */
export type ComponentStatus = "planned" | "implemented";

export interface ArchComponent {
  name: string;
  responsibility: string;
  technology?: string;
  status?: ComponentStatus; // missing (older arch.json) counts as planned
  files?: string[];         // code that implements it, workspace-relative
}

export function componentStatus(c: ArchComponent): ComponentStatus {
  return c.status === "implemented" ? "implemented" : "planned";
}

export interface ArchBlueprint {
  systemOverview: string;
  components: ArchComponent[];
  dataFlow: string;
  constraints: string[];
  openQuestions: string[];
  lastUpdated: string;  // ISO 8601
}

export interface DiffSummary {
  changedFiles: string[];    // every path in the diff (deleted files under their old path)
  addedFiles: string[];
  modifiedFiles: string[];   // includes renamed files, under their new path
  deletedFiles: string[];
  renamedFiles: string[];    // "old → new", for display
  newImports: string[];
  newSignatures: string[];
  newDependencies: string[];
  removedDependencies: string[];
  rawDiff: string;           // excerpt: every file named, long files cut (see excerptDiff)
}

export interface ViolationDetail {
  constraintId: string;
  description: string;
  severity: "low" | "medium" | "high";
  affectedCodeLocation: string;
}

export interface ExtensionDetail {
  name: string;
  responsibility: string;
  technology?: string;
  rationale: string;
  files?: string[];     // the code that introduces it
}

/** Pass 2: new code that IS a planned component, which can now be marked implemented (no ADR). */
export interface PlannedComponentMatch {
  component: string;    // the planned component's name, exactly as in arch.json
  files: string[];
  rationale: string;
}

/** Pass 2: an added file that was checked and not reported, with the reason (shown to the developer). */
export interface CheckedFile {
  file: string;
  reason: string;
}

export interface ComplianceResult {
  violation: boolean;
  violations: ViolationDetail[];
  extensions: ExtensionDetail[]; // Pass 2 output; runs in parallel with Pass 1
  plannedImplemented?: PlannedComponentMatch[];
  notReported?: CheckedFile[];
  adrsUsed: string[];   // ADR IDs used as context
}

export type AuditEventType =
  | "compliance_check"
  | "extension_detected"
  | "pre_check"
  | "adr_proposed"
  | "adr_approved"
  | "adr_rejected"
  | "adr_created"
  | "adr_superseded"
  | "arch_updated"
  | "arch_reverted"
  | "component_implemented"
  | "roles_updated";

export interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  summary: string;
  actor?: string;                 // git user.email of whoever triggered it
  adrId?: string;                 // linked ADR
  changedFiles?: string[];        // files in the diff that prompted the event
  complianceResult?: ComplianceResult;
}

// Orchestrator state machine events
export type OrchestratorEvent =
  | { type: "PROJECT_INIT"; systemDescription: string }
  | { type: "PROMPT_SUBMITTED"; prompt: string }
  | { type: "CODE_GENERATED"; diffSummary: DiffSummary }
  | { type: "MANUAL_REVIEW_REQUESTED" };

export interface BlueprintState {
  initialized: boolean;
  archBlueprint: ArchBlueprint | null;
  adrs: ADR[];
  auditTrail: AuditEntry[];
}
