import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseUnifiedDiff, filterDiffBlocks } from "../src/parsing/unifiedDiff";
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
  it("maps added lines to post-change line numbers and skips deleted files", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map((f) => f.path)).toEqual(["src/store.py", ".blueprint/arch.json"]);
    expect([...files[0].addedLines]).toEqual([2, 14, 15]);
    expect(files[0].addedText).toEqual(["import redis", "    def cache(self):", "        return 1"]);
    expect(files[1].isNew).toBe(true);
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
    expect(sum.newFiles).toEqual(["a.ts"]);
    expect(sum.newImports).toEqual(['import { x } from "y";']);
    expect(sum.newSignatures).toEqual(["export class Foo {}", "export async function go() {}"]);
  });

  it("T22: package.json dependencies, but not scripts or comma-only changes", async () => {
    const raw = "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1,4 +1,8 @@\n" +
      "-    \"express\": \"^4.0.0\"\n+    \"express\": \"^4.0.0\",\n+    \"mongoose\": \"^8.1.0\"\n+    \"build\": \"tsc\",\n+  \"version\": \"1.2.3\",\n";
    const sum = await s.summarize(raw);
    expect(sum.newDependencies).toEqual(['"mongoose": "^8.1.0"']);
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

  it("T24: raw diff truncated to 8000 characters", async () => {
    const raw = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,500 @@\n" + "+lorem ipsum dolor sit amet\n".repeat(500);
    expect((await s.summarize(raw)).rawDiff).toHaveLength(LIMITS.rawDiff);
  });

  it("BluePrint artifacts are excluded from files and raw diff", async () => {
    const sum = await s.summarize(DIFF);
    expect(sum.newFiles).toEqual(["src/store.py"]);
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
    git("add -A");
    git("commit -qm init");
    // Modify a tracked file (new method in existing class), add an untracked file, and a BluePrint artifact.
    fs.writeFileSync(path.join(repo, "store.py"), "import os\nimport redis\n\nclass Store:\n    def get(self, k):\n        return k\n\n    def cache(self, k):\n        return redis.get(k)\n");
    fs.writeFileSync(path.join(repo, "bus.ts"), "import { Kafka } from \"kafkajs\";\nexport class EventBus {\n  publish(e: string) {}\n}\n");
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
    expect(sum.newFiles.sort()).toEqual(["bus.ts", "store.py"]);
    expect(sum.newImports).toEqual(expect.arrayContaining(["import redis", 'import { Kafka } from "kafkajs";']));
    expect(sum.newImports).not.toContain("import os");
    expect(sum.newSignatures).toEqual(expect.arrayContaining(["def cache(self, k)", "export class EventBus", "publish(e: string)"]));
    expect(sum.newSignatures).not.toContain("class Store");
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
