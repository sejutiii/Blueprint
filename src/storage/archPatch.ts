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

export const COMPONENT_TABLE_HEADER = ["| Component | Responsibility | Technology | Status |", "|---|---|---|---|"];
const MAX_FILES_SHOWN = 3;
/** Files remembered per component in arch.json: enough to recognise its code in later reviews. */
export const MAX_COMPONENT_FILES = 10;

/** The Status cell: "Planned", or "Implemented — `a.ts`, `b.ts`" (first few files). */
export function statusCell(component: Pick<ArchComponent, "status" | "files">): string {
  if (component.status !== "implemented") { return "Planned"; }
  const files = component.files ?? [];
  if (!files.length) { return "Implemented"; }
  const shown = files.slice(0, MAX_FILES_SHOWN).map((f) => `\`${f}\``).join(", ");
  const more  = files.length > MAX_FILES_SHOWN ? `, +${files.length - MAX_FILES_SHOWN} more` : "";
  return `Implemented — ${shown}${more}`;
}

const componentValues = (c: ArchComponent): string[] =>
  [cell(c.name), cell(c.responsibility), cell(c.technology ?? "—") || "—", cell(statusCell(c))];

/**
 * The Components table's rows (absolute line indexes) and its Status column. Older ARCH.md
 * files lack that column: it is added on first use, with every existing row marked "Planned".
 */
function componentTable(lines: string[], range: SectionRange): { rows: number[]; status: number } | null {
  const rows: number[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    if (lines[i].trim().startsWith("|")) { rows.push(i); } else if (rows.length) { break; }
  }
  if (rows.length < 2) { return null; }

  const header = splitRow(lines[rows[0]]).map((h) => h.toLowerCase());
  let status = header.indexOf("status");
  if (status === -1) {
    status = header.length;
    lines[rows[0]] = rowOf([...splitRow(lines[rows[0]]), "Status"]);
    lines[rows[1]] = `|${[...splitRow(lines[rows[1]]), "---"].join("|")}|`;
    for (const r of rows.slice(2)) { lines[r] = rowOf([...splitRow(lines[r]), "Planned"]); }
  }
  return { rows, status };
}

/** Insert a component row into the Components table, creating the table/section if needed. */
export function addComponentRow(markdown: string, component: ArchComponent): PatchResult {
  const eol   = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const range = findSection(lines, SECTION_COMPONENTS);
  const values = componentValues(component);

  if (!range) {
    const block = ["", `## ${SECTION_COMPONENTS}`, "", ...COMPONENT_TABLE_HEADER, rowOf(values), ""];
    return { markdown: [...trimTrailingBlank(lines), ...block].join(eol), touched: [SECTION_COMPONENTS] };
  }

  const table = componentTable(lines, range);
  if (!table) {
    lines.splice(range.start + 1, 0, "", ...COMPONENT_TABLE_HEADER, rowOf(values));
    return { markdown: lines.join(eol), touched: [SECTION_COMPONENTS] };
  }

  const existing = table.rows.slice(2).some((r) => splitRow(lines[r])[0]?.toLowerCase() === values[0].toLowerCase());
  if (existing) { return { markdown, touched: [] }; }

  // Match the table's column layout so a manually widened table stays valid.
  const columns = splitRow(lines[table.rows[0]]).length;
  const padded  = Array.from({ length: columns }, (_, i) =>
    i === table.status ? values[3] : i < 3 ? values[i] : "—");
  lines.splice(table.rows[table.rows.length - 1] + 1, 0, rowOf(padded));
  return { markdown: lines.join(eol), touched: [SECTION_COMPONENTS] };
}

/**
 * Set a component's Status cell (e.g. a planned component is now implemented), adding the Status
 * column to an older table first. A component without a row (removed by hand) gets one.
 */
export function setComponentStatus(markdown: string, component: ArchComponent): PatchResult {
  const eol   = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const range = findSection(lines, SECTION_COMPONENTS);
  const table = range ? componentTable(lines, range) : null;
  const name  = cell(component.name).toLowerCase();
  const row   = table?.rows.slice(2).find((r) => splitRow(lines[r])[0]?.toLowerCase() === name);
  if (!table || row === undefined) { return addComponentRow(markdown, component); }

  const cells = splitRow(lines[row]);
  while (cells.length <= table.status) { cells.push("—"); }
  const next = cell(statusCell(component));
  if (cells[table.status] === next) { return { markdown, touched: [] }; }
  cells[table.status] = next;
  lines[row] = rowOf(cells);
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
