import { ADR } from "../types";

export function renderAdrMd(adr: ADR): string {
  const status = adr.status.charAt(0).toUpperCase() + adr.status.slice(1);
  const date   = new Date(adr.timestamp).toISOString().split("T")[0];

  return `# ADR-${adr.id}: ${adr.title}

**Status:** ${status}
**Date:** ${date}

## Context

${adr.context}

## Decision

${adr.decision}

## Consequences

${adr.consequences}
`;
}

export function adrFilename(adr: ADR): string {
  const slug = adr.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
  return `${adr.id}-${slug}.md`;
}
