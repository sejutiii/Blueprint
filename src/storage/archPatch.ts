// Targeted, section-level edits to ARCH.md (SRS 2.2 "non-destructive updates").
// Pure string functions: everything outside the touched section is returned byte-for-byte,
// so manual edits elsewhere in the file survive agent-driven updates.

import { ArchComponent } from "../types";

export const SECTION_COMPONENTS  = "Components";
export const SECTION_CONSTRAINTS = "Constraints";
export const NO_CONSTRAINTS_PLACEHOLDER = "_None identified yet._";

export interface PatchResult {
  markdown: string;
  /** Section headings that actually changed; empty if the patch was a no-op (e.g. duplicate). */
  touched: string[];
}

interface SectionRange { start: number; end: number } // [start, end) in lines; start is the "## " line

function findSection(lines: string[], heading: string): SectionRange | null {
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim().toLowerCase() === wanted);
  if (start === -1) { return null; }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " ").trim();

function splitRow(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Insert a component row into the Components table, creating the table/section if needed. */
export function addComponentRow(markdown: string, component: ArchComponent): PatchResult {
  const eol   = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const range = findSection(lines, SECTION_COMPONENTS);
  const values = [cell(component.name), cell(component.responsibility), cell(component.technology ?? "—") || "—"];

  if (!range) {
    const block = ["", `## ${SECTION_COMPONENTS}`, "", "| Component | Responsibility | Technology |", "|---|---|---|", rowOf(values), ""];
    return { markdown: [...trimTrailingBlank(lines), ...block].join(eol), touched: [SECTION_COMPONENTS] };
  }

  const body      = lines.slice(range.start + 1, range.end);
  const tableRows = body.map((l, i) => ({ l, i })).filter(({ l }) => l.trim().startsWith("|"));

  if (tableRows.length === 0) {
    const insertAt = range.start + 1;
    const block    = ["", "| Component | Responsibility | Technology |", "|---|---|---|", rowOf(values)];
    lines.splice(insertAt, 0, ...block);
    return { markdown: lines.join(eol), touched: [SECTION_COMPONENTS] };
  }

  const existing = tableRows.slice(2).some(({ l }) => splitRow(l)[0]?.toLowerCase() === values[0].toLowerCase());
  if (existing) { return { markdown, touched: [] }; }

  // Match the table's current column count so a manually widened table stays valid.
  const columns = splitRow(tableRows[0].l).length;
  const padded  = Array.from({ length: columns }, (_, i) => values[i] ?? "—");
  const last    = tableRows[tableRows.length - 1].i;
  lines.splice(range.start + 1 + last + 1, 0, rowOf(padded));
  return { markdown: lines.join(eol), touched: [SECTION_COMPONENTS] };
}

const rowOf = (values: string[]): string => `| ${values.join(" | ")} |`;

/** Append a bullet to the Constraints list (replacing the "none yet" placeholder). */
export function addConstraint(markdown: string, constraint: string): PatchResult {
  const text  = constraint.replace(/\s*\r?\n\s*/g, " ").trim();
  if (!text) { return { markdown, touched: [] }; }

  const eol   = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const range = findSection(lines, SECTION_CONSTRAINTS);

  if (!range) {
    const block = ["", `## ${SECTION_CONSTRAINTS}`, "", `- ${text}`, ""];
    return { markdown: [...trimTrailingBlank(lines), ...block].join(eol), touched: [SECTION_CONSTRAINTS] };
  }

  const body = lines.slice(range.start + 1, range.end);
  if (body.some((l) => l.replace(/^\s*[-*]\s+/, "").trim().toLowerCase() === text.toLowerCase())) {
    return { markdown, touched: [] };
  }

  const placeholderAt = body.findIndex((l) => l.trim() === NO_CONSTRAINTS_PLACEHOLDER);
  if (placeholderAt !== -1) {
    lines[range.start + 1 + placeholderAt] = `- ${text}`;
    return { markdown: lines.join(eol), touched: [SECTION_CONSTRAINTS] };
  }

  let lastContent = body.length - 1;
  while (lastContent >= 0 && body[lastContent].trim() === "") { lastContent--; }
  lines.splice(range.start + 1 + lastContent + 1, 0, `- ${text}`);
  return { markdown: lines.join(eol), touched: [SECTION_CONSTRAINTS] };
}

/**
 * Swap one Constraints bullet for another (a requirement changed). If the old bullet is gone
 * (edited by hand, or never added) the new one is appended instead, so the decision still lands.
 */
export function replaceConstraint(markdown: string, oldConstraint: string, newConstraint: string): PatchResult {
  const next = newConstraint.replace(/\s*\r?\n\s*/g, " ").trim();
  const old  = oldConstraint.replace(/\s*\r?\n\s*/g, " ").trim().toLowerCase();
  if (!next) { return { markdown, touched: [] }; }

  const eol   = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const range = findSection(lines, SECTION_CONSTRAINTS);
  if (range && old) {
    for (let i = range.start + 1; i < range.end; i++) {
      const bullet = lines[i].match(/^(\s*[-*]\s+)(.*)$/);
      if (bullet && bullet[2].trim().toLowerCase() === old) {
        // If the new constraint is already listed elsewhere, just drop the old line.
        const body = lines.slice(range.start + 1, range.end);
        const duplicate = body.some((l, j) => range.start + 1 + j !== i && l.replace(/^\s*[-*]\s+/, "").trim().toLowerCase() === next.toLowerCase());
        if (duplicate) { lines.splice(i, 1); } else { lines[i] = `${bullet[1]}${next}`; }
        return { markdown: lines.join(eol), touched: [SECTION_CONSTRAINTS] };
      }
    }
  }
  return addConstraint(markdown, next);
}

/** Refresh the "> Last updated:" line if present; leaves everything else untouched. */
export function setLastUpdated(markdown: string, iso: string): string {
  return markdown.replace(/^> Last updated:.*$/m, `> Last updated: ${new Date(iso).toLocaleString()}`);
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === "") { out.pop(); }
  return out;
}
