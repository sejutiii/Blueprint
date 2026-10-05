import { ADR, ArchBlueprint, DiffSummary } from "../types";

export const MAX_EXTENSIONS = 5;

export const EXTENSION_DETECTION_SYSTEM_PROMPT = `You are an architectural extension detector. Examine code changes against an existing architecture blueprint to determine whether the code introduces genuinely new structural elements (components, services, layers, or subsystems) that do not exist in the current architecture.

Respond with ONLY valid JSON. No markdown, no code fences.

If no new structural element is detected:
{ "extensions": [] }

If one or more new structural elements are detected, list each one separately:
{
  "extensions": [
    {
      "name": "ComponentName",
      "responsibility": "What this new element does (1-2 sentences)",
      "technology": "Technology used, if discernible from the diff",
      "rationale": "Why you believe this is a new structural element absent from ARCH.md (1-2 sentences)"
    }
  ]
}

Rules:
- Report an extension if the code introduces a new file, class, or module that has a distinct responsibility not covered by any existing component in ARCH.md.
- Report each distinct new element as its own entry. Do not merge unrelated elements into one; do not split one element across several entries.
- Report at most ${MAX_EXTENSIONS} extensions, most significant first.
- Do NOT report: adding methods or routes to an existing component, refactoring within an existing component's responsibility, or utility/helper files with no architectural significance.
- Do NOT report: things already covered by an existing component's responsibility in ARCH.md.
- Omit the "technology" field if it cannot be clearly inferred.
- Lean toward reporting an extension if a new file introduces a self-contained, named concept that clearly sits outside the existing component list.`;

export function buildExtensionDetectionPrompt(
  diffSummary: DiffSummary,
  blueprint: ArchBlueprint
): string {
  const components = blueprint.components.length
    ? blueprint.components
        .map((c) => `- ${c.name}: ${c.responsibility}${c.technology ? ` (${c.technology})` : ""}`)
        .join("\n")
    : "No components defined.";

  const changes = [
    diffSummary.newFiles.length
      ? `New files: ${diffSummary.newFiles.join(", ")}`
      : "",
    diffSummary.newDependencies.length
      ? `New dependencies: ${diffSummary.newDependencies.join(", ")}`
      : "",
    diffSummary.newImports.length
      ? `New imports:\n${diffSummary.newImports.map((i) => `  ${i}`).join("\n")}`
      : "",
    diffSummary.newSignatures.length
      ? `New signatures:\n${diffSummary.newSignatures.map((s) => `  ${s}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const rawSnippet = diffSummary.rawDiff
    ? `\nRAW DIFF (first 3000 chars):\n${diffSummary.rawDiff.slice(0, 3000)}`
    : "";

  return `EXISTING ARCHITECTURE COMPONENTS:
${components}

CODE CHANGES (STRUCTURAL SUMMARY):
${changes || "No structural changes detected."}
${rawSnippet}

Does this code introduce new structural elements not present in the architecture above? List each one.`;
}

export const COMPLIANCE_SYSTEM_PROMPT = `You are an architectural compliance reviewer. Your job is to check whether code changes violate existing architectural decisions or constraints.

Respond with ONLY valid JSON. No markdown, no code fences.

If no violations are found:
{ "violation": false, "violations": [] }

If violations are found:
{
  "violation": true,
  "violations": [
    {
      "constraintId": "ADR-0001 or ARCH-constraint",
      "description": "What was violated and why it matters (2-3 sentences)",
      "severity": "high|medium|low",
      "affectedCodeLocation": "filename and function/class name"
    }
  ]
}

Severity guide:
- high: directly contradicts a locked decision (e.g. using wrong database, wrong framework)
- medium: introduces a pattern inconsistent with stated architecture
- low: minor deviation from conventions or non-functional requirements

Only report real violations — things that genuinely contradict a stated decision or constraint. Do not flag things not covered by any ADR or constraint.`;

export function buildCompliancePrompt(
  diffSummary: DiffSummary,
  blueprint: ArchBlueprint,
  adrs: ADR[]
): string {
  const constraints = blueprint.constraints.length
    ? blueprint.constraints.map((c) => `- ${c}`).join("\n")
    : "None defined.";

  const adrSection = adrs.length
    ? adrs
        .map((a) => `[ADR-${a.id}] ${a.title} (${a.status})\nDecision: ${a.decision}`)
        .join("\n\n")
    : "No ADRs recorded yet.";

  const changes = [
    diffSummary.newFiles.length
      ? `New files: ${diffSummary.newFiles.join(", ")}`
      : "",
    diffSummary.newDependencies.length
      ? `New dependencies: ${diffSummary.newDependencies.join(", ")}`
      : "",
    diffSummary.newImports.length
      ? `New imports:\n${diffSummary.newImports.map((i) => `  ${i}`).join("\n")}`
      : "",
    diffSummary.newSignatures.length
      ? `New signatures:\n${diffSummary.newSignatures.map((s) => `  ${s}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return `ARCHITECTURAL CONSTRAINTS:
${constraints}

ARCHITECTURAL DECISIONS (ADRs):
${adrSection}

CODE CHANGES (STRUCTURAL SUMMARY):
${changes || "No structural changes detected."}

Check whether any of these code changes violate the constraints or ADRs above.`;
}
