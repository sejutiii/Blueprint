import { ArchBlueprint } from "../types";
import { COMPONENT_TABLE_HEADER, statusCell } from "../storage/archPatch";

export const ARCH_GENERATION_SYSTEM_PROMPT = `You are a software architecture analyst. Analyze a system description and extract its architectural structure into a precise JSON format.

Respond with ONLY valid JSON. No markdown, no code fences, no explanation — raw JSON only.

The JSON must match this exact schema:
{
  "systemOverview": "2-3 sentence summary of what the system does and its primary purpose",
  "components": [
    {
      "name": "ComponentName",
      "responsibility": "What this component does",
      "technology": "Technology used (omit field if not specified)"
    }
  ],
  "dataFlow": "Description of how data moves through the system end-to-end",
  "constraints": ["Each locked-in technical decision as a short statement"],
  "openQuestions": ["Each unresolved architectural decision as a question"]
}

Rules:
- Extract only what is stated or strongly implied. Do not invent components.
- constraints: technology choices, frameworks, deployment targets already decided
- openQuestions: architectural decisions not yet addressed in the description
- Use empty arrays [] for constraints or openQuestions if none are apparent
- systemOverview must be self-contained — a reader with no other context should understand the system`;

export function buildArchGenerationPrompt(systemDescription: string): string {
  return `Analyze this system description and extract its architecture:\n\n${systemDescription}`;
}

export const ARCH_FROM_CODE_SYSTEM_PROMPT = `You are a software architecture analyst. You are given the project's CURRENT architecture blueprint and a snapshot of its codebase (dependency manifests, README, top-level declarations per source file, file tree). Produce an updated blueprint that describes the system as the code shows it now.

Respond with ONLY valid JSON. No markdown, no code fences, no explanation — raw JSON only.

The JSON must match this exact schema:
{
  "systemOverview": "2-3 sentence summary of what the system does and its primary purpose",
  "components": [
    {
      "name": "ComponentName",
      "responsibility": "What this component does",
      "technology": "Technology used (omit field if not evident)",
      "status": "implemented or planned",
      "files": ["Source files that implement it, as paths from the snapshot (empty when planned)"]
    }
  ],
  "dataFlow": "Description of how data moves through the system end-to-end",
  "constraints": ["Each locked-in technical decision visible in the code, as a short statement"],
  "openQuestions": ["Each unresolved architectural question, including mismatches between the blueprint and the code"]
}

Rules:
- The current blueprint is the baseline. Keep a component's existing name when it still matches the code, so names stay stable across regenerations.
- Add components that the code clearly contains but the blueprint lacks. A component is a module, service, layer or subsystem with its own responsibility — not a single helper file.
- Keep a blueprint component unless the snapshot shows it clearly no longer exists. If you cannot tell, keep it and add an open question.
- status: "implemented" when the snapshot contains code that carries out the component's main responsibility, listing those files (at most 5); otherwise "planned" (described but not built yet), with no files.
- Ground every statement in the snapshot. Do not invent technologies, services or flows that the snapshot does not show.
- constraints: technology choices evident from the code (frameworks, datastores, runtimes). Existing constraints are preserved separately, so list only what the code shows.
- openQuestions: keep existing questions the code does not answer; add one for each important mismatch between the blueprint and the code.
- systemOverview must be self-contained — a reader with no other context should understand the system.`;

export function buildArchFromCodePrompt(current: ArchBlueprint, snapshot: string): string {
  const { lastUpdated: _omit, ...blueprint } = current;
  return `CURRENT BLUEPRINT:\n${JSON.stringify(blueprint, null, 2)}\n\nCODEBASE SNAPSHOT:\n${snapshot}\n\nProduce the updated blueprint.`;
}

export function renderArchMd(blueprint: ArchBlueprint, systemName = "System"): string {
  const componentRows = blueprint.components
    .map((c) => `| ${c.name} | ${c.responsibility} | ${c.technology ?? "—"} | ${statusCell(c)} |`)
    .join("\n");

  const constraints = blueprint.constraints.length
    ? blueprint.constraints.map((c) => `- ${c}`).join("\n")
    : "_None identified yet._";

  const openQuestions = blueprint.openQuestions.length
    ? blueprint.openQuestions.map((q) => `- ${q}`).join("\n")
    : "_None._";

  return `# Architecture: ${systemName}

> Last updated: ${new Date(blueprint.lastUpdated).toLocaleString()}

## System Overview

${blueprint.systemOverview}

## Components

${COMPONENT_TABLE_HEADER.join("\n")}
${componentRows}

## Data Flow

${blueprint.dataFlow}

## Constraints

${constraints}

## Open Questions

${openQuestions}
`;
}
