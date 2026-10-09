// Renders the real webview pages in media/ to PNG for Section 6, driven by sample messages (the
// same messages the extension sends), in a VS Code Light+ theme. One running example throughout:
// "Campus Eats", the cafeteria-ordering app of the test5 project.
// Usage: REPORT_TOOLS=<node_modules with puppeteer-core> node screens.mjs [name ...]
import { readFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const puppeteer = createRequire(join(process.env.REPORT_TOOLS ?? ".", "noop.js"))("puppeteer-core");
const here = dirname(fileURLToPath(import.meta.url));
const mediaDir = join(here, "..", "..", "media");
const mockDir = join(here, "screens-src");
const outDir = join(here, "figures");
mkdirSync(outDir, { recursive: true });
// Chrome or Edge; BROWSER overrides (Edge sometimes refuses headless launches while it updates).
const EDGE = process.env.BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

// VS Code "Light Modern" theme values for every --vscode-* variable the panels use.
const THEME = `:root {
  --vscode-font-family: "Segoe UI", system-ui, sans-serif; --vscode-font-size: 13px;
  --vscode-editor-font-family: Consolas, "Courier New", monospace;
  --vscode-foreground: #3b3b3b; --vscode-descriptionForeground: #717171; --vscode-disabledForeground: rgba(97,97,97,.5);
  --vscode-editor-background: #ffffff; --vscode-sideBar-background: #f8f8f8; --vscode-panel-border: #e5e5e5;
  --vscode-button-background: #005fb8; --vscode-button-foreground: #ffffff; --vscode-button-hoverBackground: #0258a8;
  --vscode-button-border: rgba(0,0,0,.1); --vscode-button-secondaryBackground: #e5e5e5;
  --vscode-button-secondaryForeground: #3b3b3b; --vscode-button-secondaryHoverBackground: #cccccc;
  --vscode-input-background: #ffffff; --vscode-input-border: #cecece; --vscode-input-foreground: #3b3b3b;
  --vscode-focusBorder: #005fb8; --vscode-list-hoverBackground: #f2f2f2;
  --vscode-badge-background: #cccccc; --vscode-badge-foreground: #3b3b3b;
  --vscode-textLink-foreground: #005fb8; --vscode-textLink-activeForeground: #005fb8;
  --vscode-errorForeground: #c72e0f; --vscode-inputValidation-errorBackground: #fbe9e7; --vscode-inputValidation-errorBorder: #be1100;
  --vscode-inputValidation-warningBackground: #fdf6e3; --vscode-inputValidation-warningBorder: #b89500;
  --vscode-editorInfo-foreground: #1a85ff; --vscode-editorInfo-background: #eaf3fc; --vscode-editorInfo-border: #b3d4f5;
  --vscode-editorWarning-foreground: #bf8803; --vscode-testing-iconPassed: #388a34;
  --vscode-textBlockQuote-background: #f8f8f8; --vscode-textBlockQuote-border: #e5e5e5;
  --vscode-textCodeBlock-background: #f2f2f2; --vscode-editorGutter-modifiedBackground: #2090d3;
}
html, body { overflow: hidden !important; }
* { animation-play-state: paused !important; caret-color: transparent; }`;

// ── Sample data ────────────────────────────────────────────────────────────────
const ME = "lead@campuseats.dev";
const ROLES = { identity: ME, role: "architect", configured: true, architects: [ME], developers: ["dev1@campuseats.dev", "dev2@campuseats.dev"] };
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const adr = (id, title, status, decision, extra = {}) => ({
  id, title, status, decision, context: "Recorded while setting up BluePrint for Campus Eats.",
  consequences: "Reviews check new code against this decision.", timestamp: ago(60 * 24 * (10 - Number(id))), proposedBy: ME, ...extra,
});
const ADRS = [
  adr("0001", "Use PostgreSQL as the primary datastore", "accepted", "All persistent data is stored in PostgreSQL; Redis may be used only as a cache."),
  adr("0002", "Authenticate students with university Google accounts", "accepted", "Sign-in uses Google OAuth restricted to the university domain."),
  adr("0003", "Process payments through Stripe", "accepted", "Card payments go through Stripe only; no card data is stored by Campus Eats."),
  adr("0004", "Serve the API from a Node.js and Express backend", "accepted", "The backend API is a Node.js service built with Express."),
  adr("0005", "Extension: Add Notifications component", "proposed", "Developer confirmed new component.", { proposedBy: "dev1@campuseats.dev" }),
];

const DIFF = {
  changedFiles: ["src/notifications.ts", "src/App.tsx", "src/db/orders.ts", "hello.py"],
  addedFiles: ["src/notifications.ts", "src/App.tsx", "hello.py"], modifiedFiles: ["src/db/orders.ts"], deletedFiles: [], renamedFiles: [],
  newImports: ['import { MongoClient } from "mongodb";', 'import React, { useEffect, useState } from "react";'],
  newSignatures: ["export async function showNotification(title: string, options?: NotificationOptions)", "export function App()", "export async function saveOrder(order: Order)"],
  newDependencies: ["mongodb", "react"], removedDependencies: [], rawDiff: "",
};
const RESULT = {
  violation: true, adrsUsed: ["0001", "0004"],
  violations: [{ constraintId: "ADR-0001", severity: "high", affectedCodeLocation: "src/db/orders.ts, saveOrder()",
    description: "Orders are now written to MongoDB, but ADR-0001 makes PostgreSQL the only persistent datastore (Redis is allowed only as a cache)." }],
  plannedImplemented: [{ component: "Frontend", files: ["src/App.tsx"], rationale: "A React UI for browsing the menu and placing orders: the planned Frontend's main responsibility." }],
  extensions: [{ name: "Notifications", responsibility: "Asks for permission and shows browser notifications when an order is ready.", technology: "Web Notifications API",
    rationale: "A standalone notification module; no component in ARCH.md owns notifications as its own responsibility.", files: ["src/notifications.ts"] }],
  notReported: [{ file: "hello.py", reason: "A hello-world script with no domain concept; not part of any component." }],
};

const ARCH_SECTIONS = [
  { html: "<h1>Architecture: Campus Eats</h1><blockquote><p>Last updated: 08/10/2026, 16:05</p></blockquote>" },
  { html: "<h2>System Overview</h2><p>Campus Eats lets students browse the cafeteria menu, order and pay online, and get notified when their order is ready. Staff manage the menu and order status from a dashboard.</p>" },
  { html: `<h2>Components</h2><table><thead><tr><th>Component</th><th>Responsibility</th><th>Technology</th><th>Status</th></tr></thead><tbody>
      <tr><td>Frontend</td><td>Student and staff web interface</td><td>React, TypeScript</td><td>Implemented — <code>src/App.tsx</code></td></tr>
      <tr><td>Backend API</td><td>REST endpoints for menu, orders and payments</td><td>Node.js, Express</td><td>Planned</td></tr>
      <tr><td>Database</td><td>Users, menus, orders and payments</td><td>PostgreSQL</td><td>Planned</td></tr>
      <tr><td>Payment Service</td><td>Processes card payments</td><td>Stripe</td><td>Planned</td></tr>
      <tr><td>Notifications</td><td>Browser notifications when an order is ready</td><td>Web Notifications API</td><td>Implemented — <code>src/notifications.ts</code></td></tr>
      </tbody></table>`, highlight: { timestamp: ago(4), reason: "ADR-0005: Extension: Add Notifications component", changes: 2 } },
  { html: "<h2>Data Flow</h2><p>The React frontend calls the Express API, which reads and writes PostgreSQL and calls Stripe for payments.</p>" },
  { html: `<h2>Constraints</h2><ul><li>All persistent data is stored in PostgreSQL; Redis may be used only as a cache.</li>
      <li>Sign-in uses Google OAuth restricted to the university domain.</li><li>Card payments go through Stripe only.</li></ul>`,
    highlight: { timestamp: ago(60 * 26), reason: "ADR-0001: Use PostgreSQL as the primary datastore", changes: 1 } },
  { html: "<h2>Open Questions</h2><ul><li>Should staff and students use separate front-end applications?</li></ul>" },
];

const AUDIT = [
  { id: "E00012", timestamp: ago(3), eventType: "component_implemented", summary: 'Planned component "Frontend" is now implemented (src/App.tsx)', actor: ME, changedFiles: ["src/App.tsx"] },
  { id: "E00011", timestamp: ago(4), eventType: "adr_approved", summary: "ADR-0005 approved", actor: ME, adrId: "0005" },
  { id: "E00010", timestamp: ago(9), eventType: "adr_proposed", summary: "ADR-0005 proposed: Extension: Add Notifications component", actor: "dev1@campuseats.dev", adrId: "0005" },
  { id: "E00009", timestamp: ago(10), eventType: "extension_detected", summary: "New component(s) detected: Notifications", actor: "dev1@campuseats.dev", changedFiles: ["src/notifications.ts"] },
  { id: "E00008", timestamp: ago(10), eventType: "compliance_check", summary: "1 violation(s) detected", actor: "dev1@campuseats.dev", changedFiles: DIFF.changedFiles, complianceResult: { violation: true, violations: [], extensions: [], adrsUsed: [] } },
  { id: "E00007", timestamp: ago(55), eventType: "pre_check", summary: "Pre-check: 1 concern", actor: "dev2@campuseats.dev" },
  { id: "E00006", timestamp: ago(60 * 26), eventType: "arch_updated", summary: "ARCH.md updated by ADR-0001", actor: ME, adrId: "0001" },
  { id: "E00001", timestamp: ago(60 * 27), eventType: "roles_updated", summary: "Roles updated: 1 Architect(s) (lead@campuseats.dev), 2 Developer(s)", actor: ME },
];

// ── Scenarios ──────────────────────────────────────────────────────────────────
// file: page in media/ (or screens-src/ for mock-ups); width: panel width in CSS px;
// messages: posted in order; act: optional extra steps (typing, clicks) before the shot.
const scenarios = [
  { name: "6-hub-uninitialized", file: "blueprintHub.html", width: 460, messages: [{ command: "state", initialized: false }] },
  { name: "6-hub", file: "blueprintHub.html", width: 460,
    messages: [{ command: "state", initialized: true, pending: 1, role: "architect", identity: ME, rolesConfigured: true }] },
  { name: "6-wizard-provider", file: "setupWizard.html", width: 460,
    messages: [{ command: "init", mode: "setup", keyPages: { groq: { url: "https://console.groq.com/keys", free: true } }, hasProvider: false, hasDefault: false, roles: null }],
    act: async (p) => { await p.select("#provider-select", "groq").catch(() => {}); await p.type("#api-key-input", "gsk_3xampleKey0000000000000"); } },
  { name: "6-wizard-roles", file: "setupWizard.html", width: 460,
    messages: [{ command: "init", mode: "setup", keyPages: {}, hasProvider: true, provider: "groq", hasDefault: false,
      roles: { identity: ME, role: "architect", configured: false, architects: [], developers: [] } }],
    act: async (p) => { await p.click('input[name="roles-mode"][value="team"]'); await p.type("#roles-developers", "dev1@campuseats.dev\ndev2@campuseats.dev"); } },
  { name: "6-wizard-followup", file: "setupWizard.html", width: 460,
    messages: [{ command: "showQuestion", question: "Is PostgreSQL the only datastore, or are caches or search engines allowed too?",
      placeholder: "e.g. Redis as a cache only", index: 0, total: 5, isFollowUp: true,
      parent: { question: "What technology choices are already locked in for this project?", answer: "React frontend, Node.js and Express backend, PostgreSQL for all data." } }],
    act: async (p) => { await p.type("#cq-answer", "Redis is allowed, but only as a cache. No other databases."); } },
  { name: "6-wizard-draft", file: "setupWizard.html", width: 460,
    messages: [{ command: "showQuestion", question: "x", placeholder: "", index: 0, total: 5, isFollowUp: false },
      { command: "showDraft", basis: "both", draft: { title: "Use PostgreSQL as the primary datastore",
        context: "Campus Eats stores users, menus, orders and payment records. One relational store keeps the data consistent and simple to operate.",
        decision: "All persistent data is stored in PostgreSQL; Redis may be used only as a cache. No other databases.",
        consequences: "New features must model their data in PostgreSQL. Reviews flag any other datastore as a violation." } }] },
  { name: "6-compliance-results", file: "compliancePanel.html", width: 600, splitAt: "#extensions-section", messages: [{ command: "result", result: RESULT, diffSummary: DIFF }] },
  { name: "6-compliance-clean", file: "compliancePanel.html", width: 600,
    messages: [{ command: "result", result: { violation: false, violations: [], extensions: [], plannedImplemented: [], adrsUsed: ["0001"],
      notReported: [{ file: "src/MenuFilter.tsx", reason: "Adds a UI filter to the already implemented Frontend." }] },
      diffSummary: { ...DIFF, changedFiles: ["src/MenuFilter.tsx"], addedFiles: ["src/MenuFilter.tsx"], modifiedFiles: [], newImports: [], newDependencies: [],
        newSignatures: ["export function MenuFilter({ tags, onChange }: Props)"] } }],
    act: async (p) => { await p.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; })); } },
  { name: "6-compliance-nodiff", file: "compliancePanel.html", width: 600,
    messages: [{ command: "noDiff", reason: { kind: "ignored", repoRoot: "D:\\projects\\monorepo" } }] },
  { name: "6-compliance-checking", file: "compliancePanel.html", width: 600, messages: [{ command: "checking" }], height: 300 },
  { name: "6-precheck-result", file: "preCheckPanel.html", width: 600,
    act0: async (p) => { await p.type("textarea", "Add a MongoDB collection to store each student's favourite dishes."); },
    messages: [{ command: "result",
      result: { hasConflicts: true, revisedPrompt: "Add a favourite_dishes table in PostgreSQL (user_id, dish_id, created_at) and an Express endpoint to read and update a student's favourites.",
        conflicts: [{ constraintId: "ADR-0001", severity: "high", description: "The prompt asks for a MongoDB collection, but ADR-0001 makes PostgreSQL the only persistent datastore.",
          suggestion: "Store favourites in a PostgreSQL table instead." }] },
      adrs: [{ adr: ADRS[0], score: 0.41, relevant: true, cited: true }, { adr: ADRS[3], score: 0.17, relevant: true, cited: false },
             { adr: ADRS[2], score: 0.05, relevant: false, cited: false }] }] },
  { name: "6-decision-draft", file: "decisionPanel.html", width: 600,
    messages: [{ command: "init", roles: ROLES }],
    act: async (p) => {
      await p.type("#description", "Checkout must now offer both Stripe and bKash.");
      await p.evaluate(() => window.postMessage({ command: "draft",
        result: { tentative: false, supersedes: "0003", supersedesReason: "ADR-0003 allows Stripe only; this decision adds bKash as a second provider.",
          draft: { title: "Accept payments through Stripe and bKash",
            context: "Many students pay with bKash. Offering it next to cards increases online orders.",
            decision: "Checkout offers two payment providers: Stripe for cards and bKash for mobile wallets.",
            consequences: "The Payment Service integrates both providers. ADR-0003 (Stripe only) is replaced." } },
        candidates: [{ id: "0003", title: "Process payments through Stripe", decision: "Card payments go through Stripe only." },
                     { id: "0004", title: "Serve the API from a Node.js and Express backend", decision: "The backend API is a Node.js service built with Express." }] }, "*"));
    } },
  { name: "6-arch-viewer", file: "archViewer.html", width: 680,
    messages: [{ command: "render", sections: ARCH_SECTIONS, historyCount: 6, isArchitect: true, recentLimit: 5 }] },
  { name: "6-audit-trail", file: "auditTrail.html", width: 680, messages: [{ command: "load", adrs: ADRS, entries: AUDIT }],
    act: async (p) => { const tab = await p.$('[data-tab="activity"]'); if (tab) { await tab.click(); } } },
  { name: "6-roles", file: "rolesPanel.html", width: 520, messages: [{ command: "render", roles: ROLES }] },
  // Native VS Code UI, reconstructed in HTML (replace with real screenshots when available).
  { name: "6-sidebar", file: "sidebar.html", dir: mockDir, width: 420, messages: [] },
  { name: "6-statusbar", file: "statusbar.html", dir: mockDir, width: 640, messages: [] },
];

// ── Runner ─────────────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const [dirKey, ...rest] = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
    const dir = dirKey === "mock" ? mockDir : mediaDir;
    let body = readFileSync(join(dir, rest.join("/")), "utf8");
    body = body.replace(/\{\{nonce\}\}/g, "screenshot").replace(/\{\{cspSource\}\}/g, "'self'");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const wanted = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
try {
  for (const s of scenarios.filter((x) => !wanted.length || wanted.includes(x.name))) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.width, height: 900, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument(() => {
      window.acquireVsCodeApi = () => ({ postMessage() {}, getState() { return undefined; }, setState() {} });
    });
    page.on("pageerror", (e) => console.log(`  [${s.name}] error: ${e.message}`));
    await page.goto(base + (s.dir === mockDir ? "mock/" : "media/") + s.file, { waitUntil: "load" });
    await page.addStyleTag({ content: THEME });
    if (s.act0) { await s.act0(page); }
    for (const m of s.messages) {
      await page.evaluate((msg) => window.postMessage(msg, "*"), m);
      await new Promise((r) => setTimeout(r, 120));
    }
    if (s.act) { await s.act(page); }
    await page.evaluate(() => document.activeElement?.blur());
    await new Promise((r) => setTimeout(r, 250));
    // Crop to the lowest visible element: some panels stretch to the window height.
    const height = s.height ?? await page.evaluate(() => {
      let bottom = 0;
      for (const el of document.body.querySelectorAll("*")) {
        // Leaves only (text, inputs, icons): wrappers may be stretched to the window height.
        if (el.children.length && !/^(INPUT|TEXTAREA|BUTTON|SELECT|IMG|SVG)$/i.test(el.tagName)) { continue; }
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.height && r.width && st.visibility !== "hidden" && st.display !== "none") { bottom = Math.max(bottom, r.bottom); }
      }
      return Math.ceil(Math.min(bottom + 40, document.body.scrollHeight + 20));
    });
    await page.setViewport({ width: s.width, height, deviceScaleFactor: 2 });
    if (s.splitAt) {
      // Two parts, cut just above the given element, so each part fits a page at a readable size.
      const cut = await page.$eval(s.splitAt, (el) => Math.floor(el.getBoundingClientRect().top - 8));
      for (const [i, [y, h]] of [[0, cut], [cut, height - cut]].entries()) {
        await page.screenshot({ path: join(outDir, `${s.name}-${i + 1}.png`), clip: { x: 0, y, width: s.width, height: h } });
      }
      console.log(`${s.name} -> figures/${s.name}-1.png, -2.png (cut at ${cut} of ${height})`);
    } else {
      await page.screenshot({ path: join(outDir, `${s.name}.png`), clip: { x: 0, y: 0, width: s.width, height } });
      console.log(`${s.name} -> figures/${s.name}.png (${s.width}x${height})`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
