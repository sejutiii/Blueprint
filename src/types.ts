// Core data models shared across all agents and UI components

export type AdrStatus = "proposed" | "accepted" | "deprecated" | "superseded";

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

export interface ComplianceResult {
  violation: boolean;
  violations: ViolationDetail[];
  extensionDetected?: boolean;
  extensionDescription?: string;
  adrsUsed: string[];   // ADR IDs used as context
}

export interface AuditEntry {
  timestamp: string;
  eventType: "compliance_check" | "extension_detected" | "adr_created" | "arch_updated";
  summary: string;
  adrId?: string;
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
