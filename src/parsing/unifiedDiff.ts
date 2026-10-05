// Pure parser for `git diff` unified output. No I/O, so it is unit-testable.

export interface FileDiff {
  path: string;           // workspace-relative path: post-change, or the old path for a deleted file
  isNew: boolean;
  isDeleted: boolean;
  renamedFrom?: string;   // set when git reported a rename (with or without content changes)
  addedLines: Set<number>; // 1-based line numbers in the post-change file
  addedText: string[];     // the added lines, without the leading "+"
  removedText: string[];   // the removed lines, without the leading "-"
}

export function parseUnifiedDiff(raw: string): FileDiff[] {
  const files = new Map<string, FileDiff>();
  let current: FileDiff | null = null;
  let newLine = 0;

  // Per-block header state, reset at each "diff --git".
  let pendingNew = false;
  let pendingDeleted = false;
  let oldPath: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let sawTarget = false;

  const fileFor = (path: string): FileDiff => {
    // The same file can appear twice (staged + unstaged); merge the two.
    const file = files.get(path) ?? {
      path, isNew: false, isDeleted: false, addedLines: new Set<number>(), addedText: [], removedText: [],
    };
    files.set(path, file);
    return file;
  };

  // A pure rename has no ---/+++ lines; record it from the rename header instead.
  const closeBlock = () => {
    if (!sawTarget && renameFrom && renameTo) {
      fileFor(renameTo).renamedFrom = renameFrom;
    }
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      closeBlock();
      current = null;
      pendingNew = pendingDeleted = sawTarget = false;
      oldPath = renameFrom = renameTo = null;
      continue;
    }
    if (line.startsWith("new file mode"))     { pendingNew = true; continue; }
    if (line.startsWith("deleted file mode")) { pendingDeleted = true; continue; }
    if (line.startsWith("rename from "))      { renameFrom = line.slice(12).trim(); continue; }
    if (line.startsWith("rename to "))        { renameTo = line.slice(10).trim(); continue; }
    if (line.startsWith("--- ")) {
      const source = line.slice(4).trim();
      oldPath = source === "/dev/null" ? null : source.replace(/^a\//, "");
      continue;
    }

    if (line.startsWith("+++ ")) {
      sawTarget = true;
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        // Deleted file: keep it (under its old path) so removals can be reported.
        current = oldPath ? fileFor(oldPath) : null;
        if (current) { current.isDeleted = true; }
        continue;
      }
      current = fileFor(target.replace(/^b\//, ""));
      current.isNew = current.isNew || pendingNew;
      current.isDeleted = pendingDeleted;
      if (renameFrom) { current.renamedFrom = renameFrom; }
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (!current) { continue; }

    if (line.startsWith("+")) {
      current.addedLines.add(newLine);
      current.addedText.push(line.slice(1));
      newLine++;
    } else if (line.startsWith("-")) {
      current.removedText.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      newLine++;
    }
    // "-" lines and "\ No newline at end of file" don't advance the post-change line counter.
  }
  closeBlock();

  return [...files.values()];
}

/** Keep only the per-file blocks of a unified diff whose post-change path passes `keep`. */
export function filterDiffBlocks(raw: string, keep: (path: string) => boolean): string {
  const blocks = raw.split(/(?=^diff --git )/m);
  return blocks
    .filter((block) => {
      if (!block.startsWith("diff --git ")) { return block.trim() === ""; }
      const plus = block.match(/^\+\+\+ (?:b\/)?(.+)$/m);
      const path = plus && plus[1].trim() !== "/dev/null"
        ? plus[1].trim()
        : (block.match(/^diff --git a\/(.+?) b\//)?.[1] ?? "");
      return keep(path);
    })
    .join("");
}

/**
 * Shorten a unified diff to about `budget` characters while keeping every file visible: each
 * file block gets a fair share (unused share passes to the others), and a cut block ends with a
 * note of how many lines were left out. Cuts happen on line boundaries.
 */
export function excerptDiff(raw: string, budget: number): string {
  if (raw.length <= budget) { return raw; }
  const blocks = raw.split(/(?=^diff --git )/m).filter((b) => b.length > 0);

  // Water-filling: small blocks keep everything; the rest split what remains evenly.
  const shares = new Array<number>(blocks.length).fill(0);
  let remaining = budget;
  let open = blocks.map((_, i) => i);
  while (open.length && remaining > 0) {
    const share = Math.floor(remaining / open.length);
    const fits = open.filter((i) => blocks[i].length <= share);
    if (!fits.length) {
      open.forEach((i) => { shares[i] = share; });
      break;
    }
    fits.forEach((i) => { shares[i] = blocks[i].length; remaining -= blocks[i].length; });
    open = open.filter((i) => !fits.includes(i));
  }

  return blocks.map((block, i) => {
    if (block.length <= shares[i]) { return block; }
    const lines = block.split("\n");
    let used = 0;
    let kept = 0;
    while (kept < lines.length && used + lines[kept].length + 1 <= shares[i]) {
      used += lines[kept].length + 1;
      kept++;
    }
    kept = Math.max(kept, 1); // always keep the "diff --git" line, so the file is named
    const omitted = lines.slice(kept).filter((l) => l.length > 0).length;
    return lines.slice(0, kept).join("\n") + (omitted ? `\n… (${omitted} more line${omitted !== 1 ? "s" : ""} in this file)\n` : "\n");
  }).join("");
}
