// Pure parser for `git diff` unified output. No I/O, so it is unit-testable.

export interface FileDiff {
  path: string;           // workspace-relative, post-change path
  isNew: boolean;
  isDeleted: boolean;
  addedLines: Set<number>; // 1-based line numbers in the post-change file
  addedText: string[];     // the added lines, without the leading "+"
  removedText: string[];   // the removed lines, without the leading "-"
}

export function parseUnifiedDiff(raw: string): FileDiff[] {
  const files = new Map<string, FileDiff>();
  let current: FileDiff | null = null;
  let newLine = 0;
  let pendingNew = false;
  let pendingDeleted = false;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = null;
      pendingNew = false;
      pendingDeleted = false;
      continue;
    }
    if (line.startsWith("new file mode"))     { pendingNew = true; continue; }
    if (line.startsWith("deleted file mode")) { pendingDeleted = true; continue; }
    if (line.startsWith("--- "))              { continue; }

    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        current = null; // deleted file: nothing was added
        continue;
      }
      const path = target.replace(/^b\//, "");
      // The same file can appear twice (staged + unstaged); merge the two.
      current = files.get(path) ?? {
        path, isNew: false, isDeleted: false, addedLines: new Set(), addedText: [], removedText: [],
      };
      current.isNew = current.isNew || pendingNew;
      current.isDeleted = pendingDeleted;
      files.set(path, current);
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
