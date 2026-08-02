import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { DiffSummary } from "../types";

const execAsync = promisify(exec);

// Cap how much untracked-file content we synthesize into the diff, so a
// workspace with a lot of new-but-unstaged files can't blow up the prompt.
const MAX_UNTRACKED_FILES    = 30;
const MAX_UNTRACKED_FILE_LEN = 20_000;

export class DiffSummarizer {
  async getDiff(workspaceRoot: string): Promise<string> {
    try {
      // Collect staged, unstaged, AND untracked changes. `git diff` and
      // `git diff --cached` are both blind to untracked files (git status `??`),
      // so a brand-new file that hasn't been `git add`ed yet — the most common
      // shape for a genuinely new component — would otherwise be invisible here.
      const [staged, unstaged, untracked] = await Promise.all([
        execAsync("git diff --cached", { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }),
        execAsync("git diff",          { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }),
        execAsync("git ls-files --others --exclude-standard", { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }),
      ]);

      const untrackedFiles = untracked.stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
        .slice(0, MAX_UNTRACKED_FILES);

      const untrackedDiffs = await Promise.all(
        untrackedFiles.map((file) => this.buildUntrackedDiff(workspaceRoot, file))
      );

      return staged.stdout + unstaged.stdout + untrackedDiffs.filter(Boolean).join("");
    } catch {
      return "";
    }
  }

  // Synthesizes a unified-diff-shaped block for an untracked file so the rest
  // of the pipeline (which parses "+++ b/" headers and "+"-prefixed lines)
  // treats it the same as any other addition.
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

  summarize(rawDiff: string): DiffSummary {
    const lines       = rawDiff.split("\n");
    const addedLines  = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));

    const newFiles: string[]        = [];
    const newImports: string[]      = [];
    const newSignatures: string[]   = [];
    const newDependencies: string[] = [];

    // New files from diff headers
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        const file = line.slice(6).trim();
        if (!file.includes("package-lock") && !file.includes("yarn.lock")) {
          newFiles.push(file);
        }
      }
    }

    const inPackageJson = rawDiff.includes('"dependencies"') || rawDiff.includes('"devDependencies"');

    for (const line of addedLines) {
      const content = line.slice(1).trim();
      if (!content) { continue; }

      // Import statements
      if (/^(import\s|from\s|require\()/.test(content)) {
        newImports.push(content.slice(0, 120));
        continue;
      }

      // Function / class / interface / type signatures
      if (
        /^(export\s+)?(default\s+)?(async\s+)?function[\s*]/.test(content) ||
        /^(export\s+)?(abstract\s+)?class\s+\w+/.test(content)             ||
        /^(export\s+)?interface\s+\w+/.test(content)                        ||
        /^(export\s+)?type\s+\w+\s*(=|<)/.test(content)                    ||
        /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(content)       ||
        /^(export\s+)?const\s+\w+\s*:\s*\w+\s*=/.test(content)
      ) {
        newSignatures.push(content.slice(0, 120));
        continue;
      }

      // Dependency additions in package.json
      if (inPackageJson && /^\s*"[^"]+"\s*:\s*"[^"]+"/.test(content)) {
        newDependencies.push(content.trim());
      }
    }

    return {
      newFiles:        [...new Set(newFiles)],
      newImports:      [...new Set(newImports)].slice(0, 25),
      newSignatures:   [...new Set(newSignatures)].slice(0, 25),
      newDependencies: [...new Set(newDependencies)].slice(0, 15),
      rawDiff:         rawDiff.slice(0, 8000),
    };
  }
}
