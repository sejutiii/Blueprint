// Core data models shared across all agents and UI components

// "proposed" = pending Architect approval; "rejected" = Architect declined it.
export type AdrStatus = "proposed" | "accepted" | "rejected" | "deprecated" | "superseded";

// What approving an ADR does to ARCH.md, so approval (not proposal) triggers the patch.
export type ArchEffect =
  | { kind: "add-component"; component: ArchComponent }
  | { kind: "add-constraint"; constraint: string };

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
}

export interface ArchComponent {
  name: string;
  responsibility: string;
  technology?: string;
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
  newImports: string[];
  newSignatures: string[];
  newFiles: string[];
  newDependencies: string[];
  rawDiff: string;
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
}

export interface ComplianceResult {
  violation: boolean;
  violations: ViolationDetail[];
  extensions: ExtensionDetail[]; // Pass 2 output; runs in parallel with Pass 1
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
  | "arch_updated"
  | "arch_reverted";

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
