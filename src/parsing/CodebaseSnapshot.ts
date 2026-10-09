// Compact, size-bounded description of a codebase for "Regenerate ARCH.md from codebase":
// file tree, dependency manifests, README, and Tree-sitter declaration headers.
// No VS Code imports, so it can run (and be tested) outside the extension host.
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { extractSignals, languageForFile } from "./TreeSitterExtractor";

const execAsync = promisify(exec);

export const SNAPSHOT_LIMITS = {
  treeFiles: 250,       // paths listed in the file tree
  manifestChars: 1500,  // per manifest
  readmeChars: 3000,
  sourceFiles: 40,      // files parsed for declaration headers
  signaturesPerFile: 12,
  totalChars: 14_000,   // hard cap on the whole snapshot
} as const;

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.blueprint|dist|out|build|target|vendor|coverage|\.venv|venv|__pycache__|\.next|\.vscode-test)(\/|$)/;
const SKIP_FILES = /(^|\/)(docs\/adr\/|docs\/ARCH\.md$)|\.(lock|min\.js|map|png|jpe?g|gif|svg|ico|woff2?|ttf|pdf|zip)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "composer.json", "Gemfile", "docker-compose.yml", "docker-compose.yaml", "Dockerfile"];

export async function listProjectFiles(root: string): Promise<string[]> {
  let files: string[];
  try {
    const { stdout } = await execAsync("git ls-files --cached --others --exclude-standard", {
      cwd: root, maxBuffer: 8 * 1024 * 1024,
    });
    files = stdout.split("\n").map((f) => f.trim()).filter(Boolean);
  } catch {
    files = await walk(root, "", 4000);
  }
  return files.map((f) => f.replace(/\\/g, "/")).filter((f) => !SKIP_DIRS.test(f) && !SKIP_FILES.test(f)).sort();
}

async function walk(root: string, rel: string, budget: number): Promise<string[]> {
  const out: string[] = [];
  const queue = [rel];
  while (queue.length && out.length < budget) {
    const dir = queue.shift()!;
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.test(`${p}/`)) { queue.push(p); }
      } else {
        out.push(p);
      }
    }
  }
  return out;
}

async function readCapped(file: string, cap: number): Promise<string | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.length > cap ? `${text.slice(0, cap)}\n… (truncated)` : text;
  } catch {
    return null;
  }
}

// package.json carries lots of tooling metadata; only these fields say anything about architecture.
async function packageJsonEssentials(file: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    const keep = ["name", "description", "main", "type", "workspaces", "dependencies", "devDependencies", "scripts"];
    const slim = Object.fromEntries(keep.filter((k) => k in pkg).map((k) => [k, pkg[k]]));
    const text = JSON.stringify(slim, null, 1);
    return text.length > SNAPSHOT_LIMITS.manifestChars ? `${text.slice(0, SNAPSHOT_LIMITS.manifestChars)}\n… (truncated)` : text;
  } catch {
    return readCapped(file, SNAPSHOT_LIMITS.manifestChars);
  }
}

/** Shallow files first, then larger ones: entry points and core modules tend to be both. */
async function pickSourceFiles(root: string, files: string[]): Promise<string[]> {
  const candidates = files.filter((f) => languageForFile(f) && !/(^|\/)(test|tests|__tests__|spec)\//.test(f) && !/\.(test|spec)\.\w+$/.test(f));
  const sized = await Promise.all(candidates.map(async (f) => {
    try { return { f, size: (await fs.stat(path.join(root, f))).size }; } catch { return { f, size: 0 }; }
  }));
  return sized
    .filter((x) => x.size > 0 && x.size < 400_000)
    .sort((a, b) => a.f.split("/").length - b.f.split("/").length || b.size - a.size)
    .slice(0, SNAPSHOT_LIMITS.sourceFiles)
    .map((x) => x.f)
    .sort();
}

export async function buildCodebaseSnapshot(root: string): Promise<string> {
  const files = await listProjectFiles(root);
  const parts: string[] = [];

  for (const name of MANIFESTS) {
    const match = files.find((f) => f === name) ?? files.find((f) => f.endsWith(`/${name}`) && f.split("/").length <= 2);
    if (!match) { continue; }
    const text = name === "package.json"
      ? await packageJsonEssentials(path.join(root, match))
      : await readCapped(path.join(root, match), SNAPSHOT_LIMITS.manifestChars);
    if (text) { parts.push(`MANIFEST ${match}:\n${text}`); }
  }

  const readme = files.find((f) => /^readme(\.md|\.txt)?$/i.test(f));
  if (readme) {
    const text = await readCapped(path.join(root, readme), SNAPSHOT_LIMITS.readmeChars);
    if (text) { parts.push(`README:\n${text}`); }
  }

  const sigLines: string[] = [];
  for (const file of await pickSourceFiles(root, files)) {
    const source = await readCapped(path.join(root, file), 400_000);
    if (!source) { continue; }
    const signals = await extractSignals(file, source, null, { topLevelOnly: true });
    if (!signals || (!signals.signatures.length && !signals.imports.length)) { continue; }
    const external = signals.imports.filter((i) => !/from\s+["']\.|require\(["']\.|^import\s+\./.test(i)).slice(0, 5);
    sigLines.push(
      `${file}:` +
      (signals.signatures.length ? `\n  declares: ${signals.signatures.slice(0, SNAPSHOT_LIMITS.signaturesPerFile).join(" | ")}` : "") +
      (external.length ? `\n  imports: ${external.join(" | ")}` : "")
    );
  }
  if (sigLines.length) { parts.push(`SOURCE STRUCTURE (Tree-sitter):\n${sigLines.join("\n")}`); }

  // Tree goes last: if the snapshot hits the size cap, it's the tail of the tree that is cut.
  const shown = files.slice(0, SNAPSHOT_LIMITS.treeFiles);
  parts.push(`FILE TREE (${files.length} files${files.length > shown.length ? `, first ${shown.length} shown` : ""}):\n${shown.join("\n")}`);

  const snapshot = parts.join("\n\n");
  return snapshot.length > SNAPSHOT_LIMITS.totalChars
    ? `${snapshot.slice(0, SNAPSHOT_LIMITS.totalChars)}\n… (snapshot truncated)`
    : snapshot;
}
