// Builds platform-specific VSIX packages.
//
// The local embedding model runs on onnxruntime-node, whose native binaries differ per
// platform (all platforms together are ~210 MB). Each package therefore carries only its own
// platform's runtime, staged into dist/node_modules where Node resolves it from
// dist/extension.js. The Marketplace serves each user the package for their platform; the
// "universal" package (no embedding runtime) covers everything else, where retrieval falls
// back to lexical (TF-IDF) scoring.
//
//   node scripts/package.js              current platform only
//   node scripts/package.js --all        every target below + universal
//   node scripts/package.js win32-x64 universal
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST_MODULES = path.join(ROOT, "dist", "node_modules");
const OUT_DIR = path.join(ROOT, "out");

// Targets onnxruntime-node ships binaries for (bin/napi-v6/<platform>/<arch>).
const TARGETS = ["win32-x64", "win32-arm64", "linux-x64", "linux-arm64", "darwin-arm64"];

const nm = (...p) => path.join(ROOT, "node_modules", ...p);
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

/** Copy just the runtime files the embedding pipeline loads, for one platform. */
function stageRuntime(target) {
  const [platform, arch] = target.split("-");
  fs.rmSync(DIST_MODULES, { recursive: true, force: true });

  // @huggingface/transformers: only the CommonJS Node build (the ONNX web runtime it also
  // needs is inlined in that file). A minimal package.json makes `require` resolve to it.
  const tf = nm("@huggingface", "transformers");
  const tfPkg = JSON.parse(fs.readFileSync(path.join(tf, "package.json"), "utf8"));
  copy(path.join(tf, "dist", "transformers.node.cjs"), path.join(DIST_MODULES, "@huggingface", "transformers", "dist", "transformers.node.cjs"));
  writeJson(path.join(DIST_MODULES, "@huggingface", "transformers", "package.json"), {
    name: tfPkg.name, version: tfPkg.version, license: tfPkg.license, main: "dist/transformers.node.cjs",
  });
  copy(path.join(tf, "LICENSE"), path.join(DIST_MODULES, "@huggingface", "transformers", "LICENSE"));

  // onnxruntime-node: JS + this platform's native binary only.
  const ort = nm("onnxruntime-node");
  const bin = path.join(ort, "bin", "napi-v6", platform, arch);
  if (!fs.existsSync(bin)) { throw new Error(`onnxruntime-node has no binary for ${target}`); }
  for (const f of ["package.json", "LICENSE", "dist"]) {
    if (fs.existsSync(path.join(ort, f))) { copy(path.join(ort, f), path.join(DIST_MODULES, "onnxruntime-node", f)); }
  }
  copy(bin, path.join(DIST_MODULES, "onnxruntime-node", "bin", "napi-v6", platform, arch));

  const common = nm("onnxruntime-common");
  for (const f of ["package.json", "LICENSE", "dist"]) {
    if (fs.existsSync(path.join(common, f))) { copy(path.join(common, f), path.join(DIST_MODULES, "onnxruntime-common", f)); }
  }

  // sharp is required at load time but only used for images; text embeddings never call it.
  // A stub avoids shipping its per-platform native image libraries.
  writeJson(path.join(DIST_MODULES, "sharp", "package.json"), { name: "sharp", version: "0.0.0-blueprint-stub", main: "index.js" });
  fs.writeFileSync(path.join(DIST_MODULES, "sharp", "index.js"),
    "module.exports = function sharp() { throw new Error('Image processing is not included in BluePrint.'); };\n");
}

function packageTarget(target) {
  if (target === "universal") {
    fs.rmSync(DIST_MODULES, { recursive: true, force: true });
  } else {
    stageRuntime(target);
  }
  const out = path.join(OUT_DIR, `blueprint-${target}.vsix`);
  const targetFlag = target === "universal" ? "" : `--target ${target}`;
  // --no-dependencies: vsce must not add the root node_modules; the runtime is already staged.
  // No LICENSE for now (D14), so vsce must not stop to ask about one.
  run(`npx vsce package ${targetFlag} --no-dependencies --skip-license --out "${out}"`);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const current = `${process.platform}-${process.arch}`;
  const targets = args.includes("--all")
    ? [...TARGETS, "universal"]
    : args.length ? args : [TARGETS.includes(current) ? current : "universal"];

  for (const t of targets) {
    if (t !== "universal" && !TARGETS.includes(t)) { throw new Error(`Unknown target "${t}". Known: ${TARGETS.join(", ")}, universal`); }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  run("node esbuild.js --production");

  const built = [];
  try {
    for (const t of targets) { built.push(packageTarget(t)); }
  } finally {
    // Don't leave a staged runtime behind: development runs resolve from the root node_modules,
    // and a staged runtime for another platform would shadow it.
    fs.rmSync(DIST_MODULES, { recursive: true, force: true });
  }

  console.log("\nBuilt:");
  for (const f of built) { console.log(`  ${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB`); }
}

main();
