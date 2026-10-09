import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildCodebaseSnapshot, listProjectFiles } from "../src/parsing/CodebaseSnapshot";
import { tempDir, removeDir } from "./helpers";

// "Regenerate ARCH.md from codebase" input (R4). The temp project is not a git repo, which
// also exercises the directory-walk fallback.
describe("CodebaseSnapshot", () => {
  let dir: string;
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };

  beforeAll(() => {
    dir = tempDir();
    write("package.json", JSON.stringify({
      name: "shop", description: "A shop", dependencies: { express: "^4", pg: "^8" },
      contributes: { commands: Array.from({ length: 200 }, (_, i) => ({ command: `c${i}` })) },
    }));
    write("README.md", "# Shop\nSells things.");
    write("src/server.ts", 'import express from "express";\nimport { db } from "./db";\nexport class Server {\n  start() {}\n}\n');
    write("src/db.ts", 'import { Pool } from "pg";\nexport const db = new Pool();\n');
    write("src/server.test.ts", "export function testOnly() {}\n");
    write("node_modules/express/index.js", "module.exports = 1;");
    write(".blueprint/arch.json", "{}");
    write("docs/adr/0001-x.md", "# ADR");
  });
  afterAll(() => removeDir(dir));

  it("lists project files, skipping dependencies and BluePrint's own artifacts", async () => {
    expect(await listProjectFiles(dir)).toEqual(["README.md", "package.json", "src/db.ts", "src/server.test.ts", "src/server.ts"]);
  });

  it("includes the essentials, top-level declarations and external imports only, with the file tree last", async () => {
    const snap = await buildCodebaseSnapshot(dir);
    expect(snap).toContain('"express": "^4"');
    expect(snap).not.toContain("contributes"); // package.json reduced to architectural fields
    expect(snap).toContain("README:\n# Shop");
    expect(snap).toContain("src/server.ts:\n  declares: export class Server\n  imports: import express from \"express\";");
    expect(snap).not.toContain('from "./db"');      // local imports are not architecture
    expect(snap).not.toContain("start()");          // class members skipped
    expect(snap).not.toContain("testOnly");         // test files are not parsed
    expect(snap.lastIndexOf("FILE TREE")).toBeGreaterThan(snap.indexOf("SOURCE STRUCTURE"));
  });
});
