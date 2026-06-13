import { ArchBlueprint } from "../types";

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

export function renderArchMd(blueprint: ArchBlueprint, systemName = "System"): string {
  const componentRows = blueprint.components
    .map((c) => `| ${c.name} | ${c.responsibility} | ${c.technology ?? "—"} |`)
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

| Component | Responsibility | Technology |
|---|---|---|
${componentRows}

## Data Flow

${blueprint.dataFlow}

## Constraints

${constraints}

## Open Questions

${openQuestions}
`;
}
