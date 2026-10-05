import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { DiffSummary } from "../types";
import { FileDiff, excerptDiff, filterDiffBlocks, parseUnifiedDiff } from "../parsing/unifiedDiff";
import { extractSignals } from "../parsing/TreeSitterExtractor";

const execAsync = promisify(exec);
const GIT_OPTS  = { maxBuffer: 4 * 1024 * 1024 };

// Cap how much untracked-file content we synthesize into the diff, so a
// workspace with a lot of new-but-unstaged files can't blow up the prompt.
const MAX_UNTRACKED_FILES    = 30;
const MAX_UNTRACKED_FILE_LEN = 20_000;
const MAX_PARSED_FILE_LEN    = 400_000;

// rawDiff is the excerpt both compliance passes see; every changed file stays named in it.
export const LIMITS = { imports: 25, signatures: 25, dependencies: 15, rawDiff: 6000 } as const;

const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$/;
// BluePrint's own artifacts are not code under review.
const BLUEPRINT_ARTIFACTS = /^(\.blueprint\/|docs\/adr\/|docs\/ARCH\.md$)/;

export function isReviewable(file: string): boolean {
  return !LOCKFILES.test(file) && !BLUEPRINT_ARTIFACTS.test(file);
}

export class DiffSummarizer {
  async getDiff(workspaceRoot: string): Promise<string> {
    try {
      // Staged + unstaged changes relative to HEAD in one diff, so hunk line numbers match the
      // files on disk (which Tree-sitter parses). A repo with no commits yet has no HEAD, so
      // fall back to the separate staged/unstaged diffs there.
      let tracked: string;
      try {
        tracked = (await execAsync("git diff HEAD", { cwd: workspaceRoot, ...GIT_OPTS })).stdout;
      } catch {
        const [staged, unstaged] = await Promise.all([
          execAsync("git diff --cached", { cwd: workspaceRoot, ...GIT_OPTS }),
          execAsync("git diff",          { cwd: workspaceRoot, ...GIT_OPTS }),
        ]);
        tracked = staged.stdout + unstaged.stdout;
      }

      // `git diff` is blind to untracked files (git status `??`), so a brand-new file that hasn't
      // been `git add`ed yet — the most common shape for a genuinely new component — is added here.
      const untracked = await execAsync("git ls-files --others --exclude-standard", { cwd: workspaceRoot, ...GIT_OPTS });
      const untrackedFiles = untracked.stdout
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f && isReviewable(f))
        .slice(0, MAX_UNTRACKED_FILES);

      const untrackedDiffs = await Promise.all(
        untrackedFiles.map((file) => this.buildUntrackedDiff(workspaceRoot, file))
      );

      return filterDiffBlocks(tracked, isReviewable) + untrackedDiffs.filter(Boolean).join("");
    } catch {
      return "";
    }
  }

  // Synthesizes a unified-diff-shaped block for an untracked file so the rest
  // of the pipeline treats it the same as any other addition.
  private async buildUntrackedDiff(workspaceRoot: string, file: string): Promise<string> {
    try {
      const buffer = await fs.readFile(path.join(workspaceRoot, file));
      if (buffer.includes(0)) { return ""; } // skip binary files

      const content = buffer.toString("utf8").slice(0, MAX_UNTRACKED_FILE_LEN);
      const lines   = content.split("\n");
      const body    = lines.map((l) => `+${l}`).join("\n");

      return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
    } catch {
      return "";
    }
  }

  /**
   * Reduce a raw diff to structural signals. Imports and signatures come from Tree-sitter
   * parsing of each changed file (only declarations whose header line was added count);
   * files in unsupported languages, or when no workspace root is given, use regex matching
   * over the added lines.
   */
  async summarize(rawDiff: string, workspaceRoot?: string): Promise<DiffSummary> {
    rawDiff     = filterDiffBlocks(rawDiff, isReviewable);
    const files = parseUnifiedDiff(rawDiff);

    const newImports: string[]          = [];
    const newSignatures: string[]       = [];
    const newDependencies: string[]     = [];
    const removedDependencies: string[] = [];

    for (const file of files) {
      const deps = DiffSummarizer.dependencyChanges(file);
      newDependencies.push(...deps.added);
      removedDependencies.push(...deps.removed);
      if (file.isDeleted) { continue; } // nothing added; the file itself is listed as deleted

      const signals = workspaceRoot ? await this.parseFile(workspaceRoot, file) : null;
      const { imports, signatures } = signals ?? DiffSummarizer.regexSignals(file.addedText);
      newImports.push(...imports);
      newSignatures.push(...signatures);
    }

    const paths = (keep: (f: FileDiff) => boolean) => [...new Set(files.filter(keep).map((f) => f.path))];
    return {
      changedFiles:        paths(() => true),
      addedFiles:          paths((f) => f.isNew && !f.isDeleted),
      modifiedFiles:       paths((f) => !f.isNew && !f.isDeleted),
      deletedFiles:        paths((f) => f.isDeleted),
      renamedFiles:        files.filter((f) => f.renamedFrom).map((f) => `${f.renamedFrom} → ${f.path}`),
      newImports:          [...new Set(newImports)].slice(0, LIMITS.imports),
      newSignatures:       [...new Set(newSignatures)].slice(0, LIMITS.signatures),
      newDependencies:     [...new Set(newDependencies)].slice(0, LIMITS.dependencies),
      removedDependencies: [...new Set(removedDependencies)].slice(0, LIMITS.dependencies),
      rawDiff:             excerptDiff(rawDiff, LIMITS.rawDiff),
    };
  }

  private async parseFile(workspaceRoot: string, file: FileDiff) {
    if (file.addedLines.size === 0) { return { imports: [], signatures: [] }; }
    try {
      const source = await fs.readFile(path.join(workspaceRoot, file.path), "utf8");
      if (source.length > MAX_PARSED_FILE_LEN) { return null; }
      return await extractSignals(file.path, source, file.isNew ? null : file.addedLines);
    } catch {
      return null; // file unreadable (e.g. deleted since the diff was taken) — use regex
    }
  }

  /** Fallback for languages Tree-sitter isn't configured for. */
  static regexSignals(addedText: string[]): { imports: string[]; signatures: string[] } {
    const imports: string[] = [];
    const signatures: string[] = [];

    for (const line of addedText) {
      const content = line.trim();
      if (!content) { continue; }

      if (/^(import\s|from\s+\S+\s+import\s|require\(|using\s+[\w.]+;|use\s+[\w:]+)/.test(content) ||
          /^(const|let|var)\s+\w+\s*=\s*require\(/.test(content)) {
        imports.push(content.slice(0, 120));
        continue;
      }

      if (
        /^(export\s+)?(default\s+)?(async\s+)?function[\s*]/.test(content) ||
        /^(export\s+)?(abstract\s+)?class\s+\w+/.test(content)             ||
        /^(export\s+)?interface\s+\w+/.test(content)                        ||
        /^(export\s+)?type\s+\w+\s*(=|<)/.test(content)                    ||
        /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(content)       ||
        /^(async\s+)?def\s+\w+\s*\(/.test(content)                         ||
        /^func\s+/.test(content)
      ) {
        signatures.push(content.slice(0, 120));
      }
    }
    return { imports, signatures };
  }

  /** Added and removed dependency declarations in the common manifest formats. */
  static dependencyChanges(file: FileDiff): { added: string[]; removed: string[] } {
    // A line that only gained/lost a trailing comma (because a neighbour changed) is neither.
    const norm     = (l: string) => l.trim().replace(/,$/, "");
    const before   = new Set(file.removedText.map(norm));
    const after    = new Set(file.addedText.map(norm));
    const onlyIn   = (lines: string[], other: Set<string>) =>
      lines.map((l) => l.trim()).filter((l) => l && !other.has(norm(l)));
    const isDep    = DiffSummarizer.dependencyMatcher(path.posix.basename(file.path));
    // A version bump shows up as one removed and one added line for the same package; it is
    // reported as added (the new version) only, not as a removal.
    const added    = onlyIn(file.addedText, before).filter(isDep);
    const bumped   = new Set(added.map(DiffSummarizer.packageName));
    const removed  = onlyIn(file.removedText, after).filter(isDep).filter((l) => !bumped.has(DiffSummarizer.packageName(l)));
    return { added, removed };
  }

  /** Added dependency declarations only (kept for callers that don't need removals). */
  static dependencyLines(file: FileDiff): string[] {
    return DiffSummarizer.dependencyChanges(file).added;
  }

  private static dependencyMatcher(name: string): (line: string) => boolean {
    if (name === "package.json") {
      // Version-shaped values only, so "scripts" entries and metadata fields aren't mistaken for deps.
      return (l) =>
        /^"[^"]+"\s*:\s*"(\^|~|>=?|<=?|=)?\s*(\d|\*|latest|next|workspace:|file:|link:|npm:|git|github:|https?:)/.test(l) &&
        !/^"(version|engines|node|vscode)"/.test(l);
    }
    if (/^requirements.*\.txt$/.test(name)) {
      return (l) => !l.startsWith("#") && !l.startsWith("-");
    }
    if (name === "go.mod") {
      return (l) => /^(require\s+)?[\w.-]+\.[\w./-]+\s+v\d/.test(l);
    }
    if (name === "pyproject.toml" || name === "Cargo.toml") {
      return (l) => /^[\w.-]+\s*=\s*("|\{)/.test(l) || /^"[\w.-]+[<>=~!]/.test(l);
    }
    return () => false;
  }

  // `"express": "^4"` → express; `flask==3.0` → flask; `require github.com/x/y v1` → github.com/x/y.
  private static packageName(line: string): string {
    return line.trim().replace(/^require\s+/, "").replace(/^"/, "").split(/["\s=<>~!:]/)[0].toLowerCase();
  }
}
