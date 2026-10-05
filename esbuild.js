const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Load .env (gitignored) so a default LLM provider/key can be baked into *development* builds
// without ever landing in a tracked file. Production builds (`vscode:prepublish`, i.e. every
// .vsix) never read it: anything compiled into a published extension can be extracted.
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
const dotEnv = production ? {} : loadDotEnv(path.join(__dirname, ".env"));

// Last line of defence for production builds: fail if anything that looks like an API key —
// including the one in .env — ended up in the bundle.
const KEY_PATTERNS = [
  /AIza[0-9A-Za-z_-]{35}/,            // Google / Gemini
  /gsk_[0-9A-Za-z]{20,}/,             // Groq
  /sk-ant-[0-9A-Za-z_-]{20,}/,        // Anthropic
  /sk-or-[0-9A-Za-z_-]{20,}/,         // OpenRouter
  /sk-(proj-)?[0-9A-Za-z_-]{32,}/,    // OpenAI
];
function assertNoSecrets(outfile) {
  const bundle = fs.readFileSync(outfile, "utf8");
  const envKey = loadDotEnv(path.join(__dirname, ".env")).BLUEPRINT_DEFAULT_API_KEY;
  const leaked = (envKey && bundle.includes(envKey)) || KEY_PATTERNS.some((re) => re.test(bundle));
  if (leaked) {
    fs.rmSync(outfile, { force: true });
    throw new Error(`Refusing to ship ${outfile}: it contains what looks like an API key. Production builds must not embed keys.`);
  }
}

const outfile = "dist/extension.js";

// Tree-sitter runtime + the grammars TreeSitterExtractor supports (keep in sync with
// SUPPORTED_GRAMMARS there). Copied rather than shipping all ~50 MB of tree-sitter-wasms.
const GRAMMARS = ["typescript", "tsx", "javascript", "python", "java", "go", "c_sharp", "rust"];
function copyWasmAssets() {
  const dist = path.join(__dirname, "dist");
  fs.mkdirSync(path.join(dist, "grammars"), { recursive: true });
  fs.copyFileSync(require.resolve("web-tree-sitter/tree-sitter.wasm"), path.join(dist, "tree-sitter.wasm"));
  const grammarSrc = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
  for (const g of GRAMMARS) {
    fs.copyFileSync(path.join(grammarSrc, `tree-sitter-${g}.wasm`), path.join(dist, "grammars", `tree-sitter-${g}.wasm`));
  }
}

const ctx = esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  outfile,
  // @huggingface/transformers pulls in onnxruntime-node (native .node bindings) and
  // sharp (native image bindings) — these can't be bundled into a single JS file, so they stay
  // real requires: node_modules in development, dist/node_modules in a packaged extension
  // (staged per platform by scripts/package.js). web-tree-sitter is bundled; its .wasm files
  // are copied to dist/ below.
  external: ["vscode", "@huggingface/transformers", "onnxruntime-node", "onnxruntime-web", "sharp"],
  logLevel: "silent",
  define: {
    "process.env.BLUEPRINT_DEFAULT_PROVIDER": JSON.stringify(dotEnv.BLUEPRINT_DEFAULT_PROVIDER || ""),
    "process.env.BLUEPRINT_DEFAULT_API_KEY": JSON.stringify(dotEnv.BLUEPRINT_DEFAULT_API_KEY || ""),
  },
});

ctx.then(async (c) => {
  copyWasmAssets();
  if (watch) {
    await c.watch();
    console.log("[watch] build finished, watching for changes...");
  } else {
    await c.rebuild();
    await c.dispose();
    if (production) { assertNoSecrets(outfile); }
    console.log(`[build] ${production ? "production " : ""}build finished`);
  }
}).catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
