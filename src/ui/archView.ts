// View model for the ARCH.md viewer: splits the document into "## " sections and works out
// which ones were touched by recent changes (SRS 3.1 "recently touched sections highlighted").
// Pure — no VS Code imports.
import type { ArchHistoryEntry } from "../storage/FileStore";

export const RECENT_CHANGES = 5; // highlight sections touched by the last N recorded changes
export const WHOLE_DOCUMENT = "Full document";

export interface ArchSection {
  heading: string | null; // null for the part before the first "## " heading (title, last-updated line)
  markdown: string;       // includes its own "## " line
}

export interface SectionHighlight {
  timestamp: string;
  reason: string;
  changes: number;        // how many of the recent changes touched this section
}

export function splitSections(markdown: string): ArchSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ArchSection[] = [];
  let current: ArchSection = { heading: null, markdown: "" };
  const body: string[] = [];

  const flush = () => {
    current.markdown = body.join("\n").trim();
    if (current.heading !== null || current.markdown) { sections.push(current); }
    body.length = 0;
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) {
      flush();
      current = { heading: m[1], markdown: "" };
    }
    body.push(line);
  }
  flush();
  return sections;
}

/**
 * Most recent change per section, over the last `limit` history entries. A whole-document
 * change (regeneration, revert, re-init) marks every section.
 */
export function recentHighlights(
  history: ArchHistoryEntry[],
  headings: string[],
  limit = RECENT_CHANGES
): Map<string, SectionHighlight> {
  const result = new Map<string, SectionHighlight>();
  const recent = [...history]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  for (const entry of recent) { // newest first, so the first hit per section is its latest change
    const touched = entry.sections.includes(WHOLE_DOCUMENT)
      ? headings
      : headings.filter((h) => entry.sections.some((s) => s.toLowerCase() === h.toLowerCase()));
    for (const heading of touched) {
      const key = heading.toLowerCase();
      const existing = result.get(key);
      if (existing) {
        existing.changes += 1;
      } else {
        result.set(key, { timestamp: entry.timestamp, reason: entry.reason, changes: 1 });
      }
    }
  }
  return result;
}
