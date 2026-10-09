import { ADR, ArchBlueprint, DiffSummary, componentStatus } from "../types";

export const MAX_EXTENSIONS = 5;

const list = (label: string, items: string[]) => (items.length ? `${label}: ${items.join(", ")}` : "");
const block = (label: string, items: string[]) => (items.length ? `${label}:\n${items.map((i) => `  ${i}`).join("\n")}` : "");

/**
 * The code changes as both compliance passes see them: files by kind (added files are the
 * likely new components; deleted files and removed dependencies can break a decision too),
 * the structural signals, and an excerpt of the diff itself for what the signals miss.
 */
export function describeChanges(diff: DiffSummary): string {
  const structure = [
    list("Added files", diff.addedFiles),
    list("Modified files", diff.modifiedFiles),
    list("Renamed files", diff.renamedFiles),
    list("Deleted files", diff.deletedFiles),
    list("Added dependencies", diff.newDependencies),
    list("Removed dependencies", diff.removedDependencies),
    block("New imports", diff.newImports),
    block("New declarations", diff.newSignatures),
  ].filter(Boolean).join("\n\n");

  return `CODE CHANGES (STRUCTURAL SUMMARY):
${structure || "No structural changes detected."}` + (diff.rawDiff
    ? `

DIFF EXCERPT (unified diff; long files are cut, every changed file is named):
${diff.rawDiff}`
    : "");
}

export const EXTENSION_DETECTION_SYSTEM_PROMPT = `You are an architectural extension detector. Compare code changes with the project's architecture blueprint. Each blueprint component is either IMPLEMENTED (its code exists, files listed) or PLANNED (described, but no code for it exists yet).

Sort the new code into three groups:
1. "plannedImplemented": the new code IS a PLANNED component — it carries out that component's main responsibility (e.g. a UI application for a planned "Frontend", a payment client for a planned "Payment Service").
2. "extensions": the new code introduces an element with its own responsibility that is neither an IMPLEMENTED nor a PLANNED component.
3. "notReported": everything else — code that belongs to an IMPLEMENTED component, trivial scripts, configuration, documentation.

Respond with ONLY valid JSON. No markdown, no code fences.
{
  "plannedImplemented": [
    { "component": "Exact name of a PLANNED component", "files": ["path"], "rationale": "Why this code is that component (1 sentence)" }
  ],
  "extensions": [
    {
      "name": "ComponentName",
      "responsibility": "What this new element does (1-2 sentences)",
      "technology": "Technology used, if discernible from the diff",
      "rationale": "Why this is a new element absent from the blueprint (1-2 sentences)",
      "files": ["path"]
    }
  ],
  "notReported": [
    { "file": "path", "reason": "Why it is not a new or planned component (1 sentence)" }
  ]
}

Rules:
- Every ADDED file appears exactly once: in a plannedImplemented entry's files, in an extension's files, or in notReported. Modified files appear only if they gain a clearly separate responsibility.
- A PLANNED component counts as implemented only if the code IS that component as a whole. One capability that a broader planned component merely mentions, built as its own module, is NOT that component: report it as an extension. Example: a planned "Backend API" whose responsibility mentions sending emails is not implemented by a standalone email-sending module; that module is an extension. When unsure between plannedImplemented and an extension, choose the extension.
- Judge an element by the domain concept it introduces, not by how much code it has: a file named for a business or technical capability that is in no component (e.g. payment.py in a PDF tool) is an extension even if its body is only a placeholder or a print statement.
- Never report as an extension a file whose name carries no domain concept: hello-world, scratch, test, demo or example files, configuration, documentation, or generic helpers (utils, main, index). They go in notReported.
- Code that extends an IMPLEMENTED component (new methods, routes, helpers next to its files) is notReported, with that component named in the reason.
- Report each distinct new element as its own extension. Do not merge unrelated elements; do not split one element across several entries. At most ${MAX_EXTENSIONS} extensions, most significant first.
- Use the exact component names from the blueprint. Omit "technology" if it cannot be clearly inferred. Use empty arrays for empty groups.`;

export function buildExtensionDetectionPrompt(
  diffSummary: DiffSummary,
  blueprint: ArchBlueprint
): string {
  const components = blueprint.components.length
    ? blueprint.components
        .map((c) => {
          const status = componentStatus(c) === "implemented"
            ? `IMPLEMENTED${c.files?.length ? ` in ${c.files.join(", ")}` : ""}`
            : "PLANNED, no code yet";
          return `- ${c.name} [${status}]: ${c.responsibility}${c.technology ? ` (${c.technology})` : ""}`;
        })
        .join("\n")
    : "No components defined.";

  return `ARCHITECTURE COMPONENTS:
${components}

${describeChanges(diffSummary)}

Sort the new code into plannedImplemented, extensions and notReported.`;
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

Only report real violations — things that genuinely contradict a stated decision or constraint. Do not flag things not covered by any ADR or constraint.

Removals count too: deleting a file, dependency or component that a decision requires is a violation. Use the diff excerpt to check how the code actually behaves (e.g. which client or service it calls), not just what it imports.`;

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

  return `ARCHITECTURAL CONSTRAINTS:
${constraints}

ARCHITECTURAL DECISIONS (ADRs):
${adrSection}

${describeChanges(diffSummary)}

Check whether any of these code changes violate the constraints or ADRs above.`;
}
