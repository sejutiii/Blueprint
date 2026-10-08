// Renders report figures (HTML pages in figures-src/) to PNG with the installed Microsoft Edge.
// Each page draws its figure inside #fig and sets window.figReady = true once drawn
// (Mermaid renders asynchronously). Usage: node render.mjs [name ...]  (default: all)
// Needs puppeteer-core; set REPORT_TOOLS to the node_modules folder it is installed in.
import { readdirSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const puppeteer = createRequire(join(process.env.REPORT_TOOLS ?? ".", "noop.js"))("puppeteer-core");

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "figures-src");
const outDir = join(here, "figures");
mkdirSync(outDir, { recursive: true });

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const wanted = process.argv.slice(2);
const pages = readdirSync(srcDir).filter((f) => f.endsWith(".html"))
  .filter((f) => !wanted.length || wanted.includes(f.replace(/\.html$/, "")));

// Browsers refuse ES-module scripts from file:// pages, so serve the folder over HTTP.
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const body = readFileSync(join(srcDir, path));
    res.writeHead(200, { "Content-Type": TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
try {
  for (const file of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1000, deviceScaleFactor: 2 });
    page.on("console", (m) => console.log(`  [${file}] ${m.text()}`));
    page.on("pageerror", (e) => console.log(`  [${file}] error: ${e.message}`));
    await page.goto(base + file, { waitUntil: "networkidle0" });
    await page.waitForFunction("window.figReady === true", { timeout: 30000 });
    const fig = await page.$("#fig");
    const out = join(outDir, file.replace(/\.html$/, ".png"));
    await fig.screenshot({ path: out, omitBackground: false });
    const box = await fig.boundingBox();
    console.log(`${file} -> figures/${file.replace(/\.html$/, ".png")}  (${Math.round(box.width)}x${Math.round(box.height)} css px)`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
