import { exec } from "child_process";
import { promisify } from "util";
import { DiffSummary } from "../types";

const execAsync = promisify(exec);

export class DiffSummarizer {
  async getDiff(workspaceRoot: string): Promise<string> {
    try {
      // Collect both staged and unstaged changes
      const [staged, unstaged] = await Promise.all([
        execAsync("git diff --cached", { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }),
        execAsync("git diff",          { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 }),
      ]);
      return staged.stdout + unstaged.stdout;
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
