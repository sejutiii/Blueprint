import { ADR } from "../types";

export function renderAdrMd(adr: ADR): string {
  const status = adr.status.charAt(0).toUpperCase() + adr.status.slice(1);
  const date   = new Date(adr.timestamp).toISOString().split("T")[0];

  const meta = [
    `**Status:** ${adr.status === "proposed" ? "Proposed (pending Architect approval)" : status}`,
    `**Date:** ${date}`,
    adr.proposedBy ? `**Proposed by:** ${adr.proposedBy}` : "",
    adr.reviewedBy ? `**Reviewed by:** ${adr.reviewedBy}` : "",
  ].filter(Boolean).join("  \n");

  const review = adr.reviewNote
    ? `\n## Review Note\n\n${adr.reviewNote}\n`
    : "";

  return `# ADR-${adr.id}: ${adr.title}

${meta}

## Context

${adr.context}

## Decision

${adr.decision}

## Consequences

${adr.consequences}
${review}`;
}

export function adrFilename(adr: Pick<ADR, "id" | "title">): string {
  const slug = adr.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
  return `${adr.id}-${slug}.md`;
}
