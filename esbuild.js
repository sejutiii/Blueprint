const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Load .env (gitignored) so a default LLM provider/key can be baked into the
// build without ever landing in a tracked file. Absent in CI/production builds.
function loadDotEnv(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) { return vars; }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { continue; }
    const eq = trimmed.indexOf("=");
    if (eq === -1) { continue; }
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}
const dotEnv = loadDotEnv(path.join(__dirname, ".env"));

const ctx = esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  outfile: "dist/extension.js",
  // @huggingface/transformers pulls in onnxruntime-node (native .node bindings) and
  // sharp (native image bindings) — these can't be bundled into a single JS file,
  // so leave them as real node_modules requires resolved at runtime. web-tree-sitter likewise
  // loads its tree-sitter.wasm from next to its own module file.
  external: ["vscode", "@huggingface/transformers", "onnxruntime-node", "onnxruntime-web", "sharp", "web-tree-sitter"],
  logLevel: "silent",
  define: {
    "process.env.BLUEPRINT_DEFAULT_PROVIDER": JSON.stringify(dotEnv.BLUEPRINT_DEFAULT_PROVIDER || ""),
    "process.env.BLUEPRINT_DEFAULT_API_KEY": JSON.stringify(dotEnv.BLUEPRINT_DEFAULT_API_KEY || ""),
  },
});

ctx.then(async (c) => {
  if (watch) {
    await c.watch();
    console.log("[watch] build finished, watching for changes...");
  } else {
    await c.rebuild();
    await c.dispose();
    console.log("[build] build finished");
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
