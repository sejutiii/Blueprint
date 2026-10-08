import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseUnifiedDiff, filterDiffBlocks, excerptDiff } from "../src/parsing/unifiedDiff";
import { DiffSummarizer, LIMITS, isReviewable } from "../src/agents/DiffSummarizer";
import { extractSignals, languageForFile } from "../src/parsing/TreeSitterExtractor";
import { tempDir, removeDir } from "./helpers";

const DIFF = `diff --git a/src/store.py b/src/store.py
index 111..222 100644
--- a/src/store.py
+++ b/src/store.py
@@ -1,3 +1,6 @@
 import os
+import redis

 class Store:
@@ -10,2 +13,4 @@ class Store:
     pass
+    def cache(self):
+        return 1
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/.blueprint/arch.json b/.blueprint/arch.json
new file mode 100644
--- /dev/null
+++ b/.blueprint/arch.json
@@ -0,0 +1 @@
+{}
`;

describe("parseUnifiedDiff", () => {
  it("maps added lines to post-change line numbers", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map((f) => f.path)).toEqual(["src/store.py", "old.txt", ".blueprint/arch.json"]);
    expect([...files[0].addedLines]).toEqual([2, 14, 15]);
    expect(files[0].addedText).toEqual(["import redis", "    def cache(self):", "        return 1"]);
    expect(files[2].isNew).toBe(true);
  });

  it("keeps deleted files (old path, removed lines) so removals can be reported", () => {
    const deleted = parseUnifiedDiff(DIFF)[1];
    expect(deleted).toMatchObject({ path: "old.txt", isDeleted: true, isNew: false, removedText: ["bye"], addedText: [] });
  });

  it("records renames, with and without content changes", () => {
    const pure = "diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n";
    const edited = "diff --git a/c.ts b/d.ts\nsimilarity index 90%\nrename from c.ts\nrename to d.ts\n" +
      "--- a/c.ts\n+++ b/d.ts\n@@ -1 +1,2 @@\n x\n+y\n";
    const files = parseUnifiedDiff(pure + edited);
    expect(files.map((f) => [f.path, f.renamedFrom, f.isNew])).toEqual([["b.ts", "a.ts", false], ["d.ts", "c.ts", false]]);
    expect(files[1].addedText).toEqual(["y"]);
  });

  it("merges a file that appears in both staged and unstaged diffs", () => {
    const twice = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n x\n+y\n" +
                  "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -5 +5,2 @@\n z\n+w\n";
    const files = parseUnifiedDiff(twice);
    expect(files).toHaveLength(1);
    expect([...files[0].addedLines]).toEqual([2, 6]);
  });

  it("filterDiffBlocks keeps only the wanted files", () => {
    const kept = filterDiffBlocks(DIFF, isReviewable);
    expect(kept).toContain("src/store.py");
    expect(kept).not.toContain(".blueprint/arch.json");
  });
});

describe("excerptDiff — every changed file stays visible", () => {
  const block = (name: string, lines: number) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1,${lines} @@\n` + "+some added code line here\n".repeat(lines);

  it("returns a diff that fits unchanged", () => {
    const raw = block("a.ts", 3);
    expect(excerptDiff(raw, 10_000)).toBe(raw);
  });

  it("a huge first file can't crowd out the others; small files are kept whole", () => {
    const raw = block("huge.ts", 2000) + block("small.ts", 2) + block("medium.ts", 300);
    const out = excerptDiff(raw, 6000);
    expect(out.length).toBeLessThanOrEqual(6000 + 120);
    expect(out).toContain(block("small.ts", 2));
    for (const name of ["huge.ts", "medium.ts"]) {
      expect(out).toContain(`diff --git a/${name}`);
    }
    expect(out.match(/more lines in this file/g)).toHaveLength(2);
    // The unused share of the small file goes to the two big ones, roughly evenly.
    const sizeOf = (name: string) => out.split(/(?=^diff --git )/m).find((b) => b.includes(`a/${name}`))!.length;
    expect(Math.abs(sizeOf("huge.ts") - sizeOf("medium.ts"))).toBeLessThan(100);
  });

  it("with very many files, each is still named", () => {
    const raw = Array.from({ length: 80 }, (_, i) => block(`f${i}.ts`, 50)).join("");
    const out = excerptDiff(raw, 6000);
    expect(out.match(/^diff --git /gm)).toHaveLength(80);
  });
});

describe("isReviewable — BluePrint's own artifacts and lockfiles are not code under review", () => {
  it.each([
    [".blueprint/adr-index.json", false], ["docs/adr/0001-x.md", false], ["docs/ARCH.md", false],
    ["package-lock.json", false], ["web/yarn.lock", false],
    ["docs/guide.md", true], ["src/app.ts", true], ["package.json", true],
  ])("%s -> %s", (file, expected) => {
    expect(isReviewable(file)).toBe(expected);
  });
});

describe("DiffSummarizer.summarize", () => {
  const s = new DiffSummarizer();

  it("T21: regex fallback (no workspace root) extracts imports and signatures, deduplicated", async () => {
    const raw = "diff --git a/a.ts b/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1,4 @@\n" +
      "+import { x } from \"y\";\n+import { x } from \"y\";\n+export class Foo {}\n+export async function go() {}\n";
    const sum = await s.summarize(raw);
    expect(sum.changedFiles).toEqual(["a.ts"]);
    expect(sum.addedFiles).toEqual(["a.ts"]);
    expect(sum.newImports).toEqual(['import { x } from "y";']);
    expect(sum.newSignatures).toEqual(["export class Foo {}", "export async function go() {}"]);
  });

  it("T22: package.json dependencies, but not scripts or comma-only changes", async () => {
    const raw = "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1,4 +1,8 @@\n" +
      "-    \"express\": \"^4.0.0\"\n+    \"express\": \"^4.0.0\",\n+    \"mongoose\": \"^8.1.0\"\n+    \"build\": \"tsc\",\n+  \"version\": \"1.2.3\",\n";
    const sum = await s.summarize(raw);
    expect(sum.newDependencies).toEqual(['"mongoose": "^8.1.0"']);
  });

  it("removed dependencies are reported; a version bump is not a removal", async () => {
    const raw = "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1,4 +1,3 @@\n" +
      "-    \"stripe\": \"^14.0.0\",\n-    \"pg\": \"^8.0.0\"\n+    \"pg\": \"^8.11.0\"\n";
    const sum = await s.summarize(raw);
    expect(sum.removedDependencies).toEqual(['"stripe": "^14.0.0",']);
    expect(sum.newDependencies).toEqual(['"pg": "^8.11.0"']);
  });

  it("files are split into added, modified, renamed and deleted", async () => {
    const raw = DIFF.replace(/diff --git a\/\.blueprint[\s\S]*$/, "") +
      "diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+export class N {}\n" +
      "diff --git a/a.ts b/b.ts\nrename from a.ts\nrename to b.ts\n";
    const sum = await s.summarize(raw);
    expect(sum.addedFiles).toEqual(["new.ts"]);
    expect(sum.modifiedFiles).toEqual(["src/store.py", "b.ts"]);
    expect(sum.deletedFiles).toEqual(["old.txt"]);
    expect(sum.renamedFiles).toEqual(["a.ts → b.ts"]);
    expect(sum.changedFiles).toHaveLength(4);
    expect(sum.newSignatures).toEqual(["def cache(self):", "export class N {}"]); // nothing from the deleted file
  });

  it("a deleted manifest reports its dependencies as removed", async () => {
    const raw = "diff --git a/requirements.txt b/requirements.txt\ndeleted file mode 100644\n--- a/requirements.txt\n+++ /dev/null\n" +
      "@@ -1,2 +0,0 @@\n-flask==3.0\n-redis==5.0\n";
    const sum = await s.summarize(raw);
    expect(sum.deletedFiles).toEqual(["requirements.txt"]);
    expect(sum.removedDependencies).toEqual(["flask==3.0", "redis==5.0"]);
  });

  it("T22: requirements.txt and go.mod", () => {
    const req = DiffSummarizer.dependencyLines({ path: "requirements.txt", isNew: false, isDeleted: false, addedLines: new Set(), addedText: ["flask==3.0", "# comment", "-r base.txt"], removedText: [] });
    expect(req).toEqual(["flask==3.0"]);
    const gomod = DiffSummarizer.dependencyLines({ path: "go.mod", isNew: false, isDeleted: false, addedLines: new Set(), addedText: ["require github.com/lib/pq v1.10.9", "go 1.22"], removedText: [] });
    expect(gomod).toEqual(["require github.com/lib/pq v1.10.9"]);
  });

  it("T23: imports/signatures capped at 25, dependencies at 15", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `+import m${i} from "m${i}";\n+export function f${i}() {}\n`).join("");
    const deps  = Array.from({ length: 20 }, (_, i) => `+    "dep${i}": "^1.0.${i}",\n`).join("");
    const raw = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,80 @@\n${lines}` +
                `diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1,20 @@\n${deps}`;
    const sum = await s.summarize(raw);
    expect(sum.newImports).toHaveLength(LIMITS.imports);
    expect(sum.newSignatures).toHaveLength(LIMITS.signatures);
    expect(sum.newDependencies).toHaveLength(LIMITS.dependencies);
  });

  it("T24: large diffs are cut to the excerpt budget on line boundaries, with a note", async () => {
    const raw = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,500 @@\n" + "+lorem ipsum dolor sit amet\n".repeat(500);
    const excerpt = (await s.summarize(raw)).rawDiff;
    expect(excerpt.length).toBeLessThanOrEqual(LIMITS.rawDiff + 60);
    expect(excerpt).toMatch(/\n\+lorem ipsum dolor sit amet\n… \(\d+ more lines in this file\)\n$/);
  });

  it("BluePrint artifacts are excluded from files and raw diff", async () => {
    const sum = await s.summarize(DIFF);
    expect(sum.changedFiles).toEqual(["src/store.py", "old.txt"]);
    expect(sum.rawDiff).not.toContain(".blueprint");
  });
});

describe("DiffSummarizer.getDiff + Tree-sitter, against real git repos", () => {
  let repo: string;
  let notGit: string;
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repo, stdio: "pipe" });

  beforeAll(() => {
    repo = tempDir();
    notGit = tempDir();
    git("init -q");
    git("config user.email t@t.io");
    git("config user.name t");
    fs.writeFileSync(path.join(repo, "store.py"), "import os\n\nclass Store:\n    def get(self, k):\n        return k\n");
    fs.writeFileSync(path.join(repo, "legacy.ts"), "export const old = 1;\n");
    fs.writeFileSync(path.join(repo, "util.ts"), "export function helper() { return 42; }\n");
    git("add -A");
    git("commit -qm init");
    // Modify a tracked file (new method in existing class), add an untracked file, and a BluePrint artifact.
    fs.writeFileSync(path.join(repo, "store.py"), "import os\nimport redis\n\nclass Store:\n    def get(self, k):\n        return k\n\n    def cache(self, k):\n        return redis.get(k)\n");
    fs.writeFileSync(path.join(repo, "bus.ts"), "import { Kafka } from \"kafkajs\";\nexport class EventBus {\n  publish(e: string) {}\n}\n");
    fs.rmSync(path.join(repo, "legacy.ts"));
    git("mv util.ts helpers.ts");
    fs.mkdirSync(path.join(repo, ".blueprint"));
    fs.writeFileSync(path.join(repo, ".blueprint", "arch.json"), "{}");
  });
  afterAll(() => { removeDir(repo); removeDir(notGit); });

  it("T25: a folder that is not a git repo yields an empty diff without throwing", async () => {
    await expect(new DiffSummarizer().getDiff(notGit)).resolves.toBe("");
  });

  it("T21: includes untracked files, reports only declarations whose header was added", async () => {
    const s = new DiffSummarizer();
    const sum = await s.summarize(await s.getDiff(repo), repo);
    expect(sum.addedFiles).toEqual(["bus.ts"]);
    expect(sum.modifiedFiles.sort()).toEqual(["helpers.ts", "store.py"]);
    expect(sum.deletedFiles).toEqual(["legacy.ts"]);
    expect(sum.renamedFiles).toEqual(["util.ts → helpers.ts"]);
    expect(sum.newImports).toEqual(expect.arrayContaining(["import redis", 'import { Kafka } from "kafkajs";']));
    expect(sum.newImports).not.toContain("import os");
    expect(sum.newSignatures).toEqual(expect.arrayContaining(["def cache(self, k)", "export class EventBus", "publish(e: string)"]));
    expect(sum.newSignatures).not.toContain("class Store");
  });

  it("a repo with changes is never reported as 'not git' or 'ignored'", async () => {
    await expect(new DiffSummarizer().whyEmpty(repo)).resolves.toEqual({ kind: "clean" });
    await expect(new DiffSummarizer().whyEmpty(notGit)).resolves.toEqual({ kind: "not-git" });
  });
});

// The workspace is a folder inside a larger repo (a monorepo package, or the test/ fixtures here).
describe("DiffSummarizer.getDiff — workspace inside an outer repo", () => {
  let outer: string;
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: outer, stdio: "pipe" });
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(outer, rel)), { recursive: true });
    fs.writeFileSync(path.join(outer, rel), text);
  };

  beforeAll(() => {
    outer = tempDir();
    git("init -q");
    git("config user.email t@t.io");
    git("config user.name t");
    write("root.ts", "export const root = 1;\n");
    write("pkg/a.ts", "export const a = 1;\n");
    write(".gitignore", "ignored/\n");
    git("add -A");
    git("commit -qm init");
    write("root.ts", "export const root = 2;\nexport class OutsideTheWorkspace {}\n"); // must not be reviewed
    write("pkg/a.ts", "export const a = 1;\nexport class Billing {}\n");
    write("pkg/new.ts", "export function helper() { return 1; }\n");
    write("ignored/x.ts", "export const hidden = 1;\n");
  });
  afterAll(() => removeDir(outer));

  it("reviews only the workspace's own changes, with paths relative to it", async () => {
    const pkg = path.join(outer, "pkg");
    const s = new DiffSummarizer();
    const sum = await s.summarize(await s.getDiff(pkg), pkg);
    expect(sum.changedFiles.sort()).toEqual(["a.ts", "new.ts"]);
    // Tree-sitter found the files on disk, so the paths resolve against the workspace.
    expect(sum.newSignatures).toEqual(expect.arrayContaining(["export class Billing", "export function helper()"]));
    expect(sum.newSignatures).not.toContain("export class OutsideTheWorkspace");
  });

  it("a folder the outer repo ignores is reported as ignored, not as 'no changes'", async () => {
    const ignored = path.join(outer, "ignored");
    const s = new DiffSummarizer();
    expect(await s.getDiff(ignored)).toBe("");
    const reason = await s.whyEmpty(ignored);
    expect(reason.kind).toBe("ignored");
    expect(reason.kind === "ignored" && path.basename(reason.repoRoot)).toBe(path.basename(outer));
  });
});

describe("TreeSitterExtractor", () => {
  it("maps file extensions to grammars", () => {
    expect(languageForFile("a.tsx")).toBe("tsx");
    expect(languageForFile("b.cs")).toBe("c_sharp");
    expect(languageForFile("c.rb")).toBeNull();
  });

  it("TypeScript: exports, require(), arrow functions, type aliases", async () => {
    const src = 'const db = require("pg");\nexport type Role = "a" | "b";\nexport const handler = async (req: any) => {\n  return 1;\n};\nexport class A { m() {} }\n';
    const r = await extractSignals("x.ts", src, null);
    expect(r?.imports).toEqual(['const db = require("pg");']);
    expect(r?.signatures).toEqual(["export type Role", "export const handler = async (req: any) =>", "export class A", "m()"]);
  });

  it("topLevelOnly skips class members", async () => {
    const r = await extractSignals("x.ts", "export class A {\n  m() {}\n}\n", null, { topLevelOnly: true });
    expect(r?.signatures).toEqual(["export class A"]);
  });

  it("long import lists collapse so the module name survives", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `name${i}`).join(", ");
    const r = await extractSignals("x.ts", `import { ${names} } from "../prompts/x";\n`, null);
    expect(r?.imports[0]).toBe('import {…} from "../prompts/x";');
  });

  it("Go, Java and Rust", async () => {
    expect((await extractSignals("m.go", 'package m\nimport "fmt"\nfunc Run() {}\ntype S struct{}\n', null))?.signatures).toEqual(["func Run()", "S struct"]);
    expect((await extractSignals("A.java", "import java.util.List;\npublic class A { void b() {} }\n", null))?.imports).toEqual(["import java.util.List;"]);
    expect((await extractSignals("l.rs", "use std::io;\npub struct P;\nfn main() {}\n", null))?.signatures).toEqual(["pub struct P;", "fn main()"]);
  });

  it("unsupported language returns null so the caller falls back to regex", async () => {
    expect(await extractSignals("a.rb", "class A; end", null)).toBeNull();
  });
});
