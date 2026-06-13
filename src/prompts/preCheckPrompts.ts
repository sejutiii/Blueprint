import { ADR, ArchBlueprint } from "../types";

export interface PreCheckConflict {
  constraintId: string;
  description: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export interface PreCheckResult {
  hasConflicts: boolean;
  conflicts: PreCheckConflict[];
}

export const PRE_CHECK_SYSTEM_PROMPT = `You are an architectural pre-flight checker. A developer is about to submit a prompt to an AI coding assistant. Your job is to analyze the developer's stated intent and identify whether following through on it would likely violate existing architectural constraints or decisions.

This is a PREVENTIVE check — no code has been written yet. Reason about intent, not implementation details.

Respond with ONLY valid JSON. No markdown, no code fences.

If no conflicts are found:
{ "hasConflicts": false, "conflicts": [] }

If conflicts are found:
{
  "hasConflicts": true,
  "conflicts": [
    {
      "constraintId": "ADR-0001 or ARCH-constraint",
      "description": "Why this prompt may lead to an architectural conflict (2-3 sentences)",
      "severity": "high|medium|low",
      "suggestion": "How to rephrase or adjust the approach to stay within constraints (1-2 sentences)"
    }
  ]
}

Severity guide:
- high: intent directly contradicts a locked architectural decision
- medium: approach may create patterns inconsistent with the stated architecture
- low: minor concern — might slightly deviate from conventions or non-functional requirements

Only flag real concerns grounded in the stated constraints or ADRs. If the prompt is consistent with the architecture, return hasConflicts: false.`;

export function buildPreCheckPrompt(
  promptText: string,
  blueprint: ArchBlueprint,
  adrs: ADR[]
): string {
  const constraints = blueprint.constraints.length
    ? blueprint.constraints.map((c) => `- ${c}`).join("\n")
    : "None defined.";

  const components = blueprint.components.length
    ? blueprint.components
        .map((c) => `- ${c.name}: ${c.responsibility}${c.technology ? ` (${c.technology})` : ""}`)
        .join("\n")
    : "No components defined.";

  const adrSection = adrs.length
    ? adrs
        .map((a) => `[ADR-${a.id}] ${a.title} (${a.status})\nDecision: ${a.decision}`)
        .join("\n\n")
    : "No ADRs recorded yet.";

  return `ARCHITECTURAL CONSTRAINTS:
${constraints}

EXISTING COMPONENTS:
${components}

ARCHITECTURAL DECISIONS (ADRs):
${adrSection}

DEVELOPER PROMPT INTENT TO CHECK:
${promptText}

Does this prompt conflict with any of the constraints or decisions above?`;
}
