// Generates event-crc.html: an event-driven CRC diagram (classes as boxes, arrows labelled
// with the event or call that triggers each collaboration). Run: node docs/diagrams/event-crc.mjs
// Open event-crc.html#check to list any text that overlaps a box, a line or other text.
import { writeFileSync } from "node:fs";

const W = 2170, H = 1150, TOP = 80;
const LH = 22; // label line height

// ── Classes: [x, y, w, label, kind] (h = H_BOX). kind: "evt" = event source outside the extension.
const H_BOX = 64;
const nodes = {
  developer:  [30,   20,  245, "Developer", "evt"],
  panel:      [620,  20,  260, "BlueprintPanel"],
  statusBar:  [1000, 20,  240, "StatusBarManager"],
  adrTree:    [1320, 20,  240, "AdrTreeProvider"],
  auditTree:  [1640, 20,  320, "AuditTrailTreeProvider"],

  workspace:  [30,   210, 245, "VS Code Workspace", "evt"],
  extension:  [620,  210, 260, "Extension"],
  auditLog:   [1150, 210, 190, "AuditLog"],

  access:     [1150, 345, 190, "AccessControl"],
  orch:       [620,  400, 260, "Orchestrator"],
  decisions:  [1640, 400, 220, "DecisionService"],
  adrStore:   [1980, 400, 170, "AdrStore"],
  fileStore:  [1150, 480, 190, "FileStore"],

  snapshot:   [20,   730, 230, "CodebaseSnapshot"],
  diff:       [280,  730, 210, "DiffSummarizer"],
  compliance: [540,  730, 220, "ComplianceAgent"],
  precheck:   [790,  730, 200, "PreCheckAgent"],
  arch:       [1020, 730, 245, "ArchitectureAgent"],
  elicit:     [1295, 730, 355, "ConstraintElicitationAgent"],
  retrieval:  [1720, 730, 210, "RetrievalAgent"],

  treeSitter: [80,   910, 270, "TreeSitterExtractor"],
  llm:        [900,  910, 200, "LLMClient"],
  session:    [1350, 910, 250, "ElicitationSession"],
  embedding:  [1710, 910, 230, "EmbeddingService"],
};

// ── Collaborations: orthogonal polyline (last point gets the arrowhead) + label.
// Label lines: {EVENT} renders as an event name; plain text is the action.
// at: [x, y, anchor] of the first line's baseline (of the last line when `above`).
const edges = [
  // Event sources → UI
  { pts: [[275, 52], [620, 52]], label: ["fills webview forms"], at: [447, 42, "middle"] },
  { pts: [[275, 70], [540, 70], [540, 226], [620, 226]], label: ["runs commands,", "sidebar actions"], at: [530, 140, "end"] },
  { pts: [[275, 256], [620, 256]], label: ["{file created} → offer review", "{ARCH.md, ADRs, roles.json}", "{changed} → refresh views"], at: [285, 296, "start"] },

  // Panel ↔ Extension
  { pts: [[680, 84], [680, 210]], label: ["posts form", "messages"], at: [672, 140, "end"] },
  { pts: [[820, 210], [820, 84]], label: ["opens panels,", "posts results"], at: [828, 120, "start"] },

  // Extension → views (bus)
  { pts: [[880, 226], [960, 226], [960, 160], [1120, 160], [1120, 84]], label: ["sets state, role,", "pending count"], at: [1128, 112, "start"] },
  { pts: [[1120, 160], [1440, 160], [1440, 84]], label: ["refresh(ADRs)"], at: [1448, 122, "start"], noStart: true },
  { pts: [[1440, 160], [1800, 160], [1800, 84]], label: ["refresh(ADRs)"], at: [1808, 122, "start"], noStart: true },
  { pts: null, label: ["{onState / onDataChanged} → refresh views"], at: [1380, 186, "middle"] },

  // AuditLog → Extension
  { pts: [[1150, 256], [880, 256]], label: ["{onAppend}: entry added →", "refresh audit trail"], at: [1015, 284, "middle"] },

  // Extension ↔ Orchestrator
  { pts: [[650, 274], [650, 400]], label: [], at: [0, 0] },
  { pts: [[850, 400], [850, 274]], label: ["hooks:", "{onState}", "{onDataChanged}"], at: [842, 312, "end"] },

  // Orchestrator → shared stores
  { pts: [[880, 412], [920, 412], [920, 330], [1200, 330], [1200, 274]], label: ["logs reviews, pre-checks,", "role changes"], at: [928, 354, "start"] },
  { pts: [[880, 432], [1000, 432], [1000, 392], [1150, 392]], label: ["checks", "Architect role"], at: [1008, 416, "start"] },
  { pts: [[880, 452], [1020, 452], [1020, 512], [1150, 512]], label: ["on init /", "regenerate:", "writes ARCH.md"], at: [1012, 480, "end"] },

  // DecisionService → shared stores
  { pts: [[1700, 400], [1700, 300], [1300, 300], [1300, 274]], label: ["records ADR events"], at: [1500, 290, "middle"] },
  { pts: [[1640, 412], [1500, 412], [1500, 392], [1340, 392]], label: ["resolves role:", "accept or queue"], at: [1492, 416, "end"] },
  { pts: [[1640, 452], [1480, 452], [1480, 512], [1340, 512]], label: ["on acceptance:", "patches ARCH.md"], at: [1350, 546, "start"] },
  { pts: [[1860, 432], [1980, 432]], label: ["creates /", "updates ADRs"], at: [1920, 400, "middle"], above: true },

  // Orchestrator → DecisionService
  { pts: [[840, 464], [840, 600], [1680, 600], [1680, 464]], label: ["propose / approve / reject ADR"], at: [1180, 590, "middle"] },
  { pts: null, label: ["{violation resolved} · {extension confirmed} · {decision saved} · {approve / reject}"], at: [1180, 626, "middle"] },

  // Orchestrator → agents (bus)
  { pts: [[700, 464], [700, 660], [40, 660], [40, 730]], label: ["{regenerate}:", "snapshot codebase"], at: [48, 686, "start"] },
  { pts: [[300, 660], [300, 730]], label: ["{review}:", "summarize diff"], at: [308, 686, "start"], noStart: true },
  { pts: [[560, 660], [560, 730]], label: ["{review}: run", "Pass 1 ‖ Pass 2"], at: [568, 686, "start"], noStart: true },
  { pts: [[700, 660], [810, 660], [810, 730]], label: ["{PROMPT_SUBMITTED}:", "check prompt"], at: [818, 686, "start"], noStart: true },
  { pts: [[1040, 660], [1040, 730]], label: ["{PROJECT_INIT / regenerate}:", "draft blueprint"], at: [1048, 686, "start"], noStart: true },
  { pts: [[1315, 660], [1315, 730]], label: ["{wizard answer} /", "{Add Decision}: draft ADR"], at: [1323, 686, "start"], noStart: true },
  { pts: [[810, 660], [1740, 660], [1740, 730]], label: ["rank relevant ADRs"], at: [1732, 708, "end"], noStart: true },

  // DecisionService → RetrievalAgent; RetrievalAgent → stores
  { pts: [[1840, 464], [1840, 730]], label: ["on acceptance:", "cache embedding"], at: [1848, 548, "start"] },
  { pts: [[1930, 762], [2080, 762], [2080, 464]], label: ["reads ADRs,", "stores embeddings"], at: [2072, 632, "end"] },
  { pts: [[1825, 794], [1825, 910]], label: ["embeds text", "(MiniLM, local)"], at: [1833, 848, "start"] },

  // Agents → helpers
  { pts: [[175, 794], [175, 910]], label: ["top-level", "declarations"], at: [167, 848, "end"] },
  { pts: [[320, 794], [320, 910]], label: ["new imports &", "declarations"], at: [328, 848, "start"] },
  { pts: [[1000, 820], [1000, 910]], label: ["sends prompts to the chat model", "(Gemini, Groq, OpenRouter, Anthropic, OpenAI)"], at: [1010, 852, "start"] },
  { pts: [[1475, 794], [1475, 910]], label: ["tracks wizard", "topics & follow-ups"], at: [1483, 852, "start"] },
];

// The four LLM agents share one arrow to LLMClient.
const group = { x: 522, y: 714, w: 1146, h: 106, label: "LLM agents" };

// Note beside Extension → Orchestrator listing the dispatched events.
const note = {
  x: 290, y: 372, w: 320, h: 186,
  lines: [
    "dispatches events:",
    "{PROJECT_INIT}",
    "{PROMPT_SUBMITTED}",
    "{CODE_GENERATED}",
    "{MANUAL_REVIEW_REQUESTED}",
    "+ decision, approval, roles,",
    "   regenerate requests",
  ],
};

// ── Rendering ─────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function richLine(text) {
  return text.split(/(\{[^}]+\})/).filter(Boolean).map((part) =>
    part.startsWith("{")
      ? `<tspan class="ev">${esc(part.slice(1, -1))}</tspan>`
      : esc(part)
  ).join("");
}

function textBlock(lines, x, y, anchor = "middle", cls = "lbl") {
  return lines.map((l, i) =>
    `<text class="${cls}" x="${x}" y="${y + i * LH}" text-anchor="${anchor}" xml:space="preserve">${richLine(l)}</text>`
  ).join("\n");
}

const pathD = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");

let svg = "";

// group frame first (behind everything)
svg += `<rect class="group" x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="12"/>`;
svg += `<text class="group-lbl" x="${group.x + 12}" y="${group.y + group.h - 8}">${group.label}</text>`;

// edges: white halo pass, then line pass, so crossings read clearly
for (const e of edges) if (e.pts) svg += `<path class="halo" d="${pathD(e.pts)}"/>`;
for (const e of edges) if (e.pts) {
  svg += `<path class="edge" d="${pathD(e.pts)}" marker-end="url(#arrow)"/>`;
  if (e.noStart) svg += `<circle cx="${e.pts[0][0]}" cy="${e.pts[0][1]}" r="4" class="dot"/>`;
}

// boxes
for (const [x, y, w, label, kind] of Object.values(nodes)) {
  svg += `<rect class="box ${kind ?? ""}" x="${x}" y="${y}" width="${w}" height="${H_BOX}" rx="10"/>`;
  svg += `<text class="name" x="${x + w / 2}" y="${y + H_BOX / 2 + 8}" text-anchor="middle">${label}</text>`;
}

// note
svg += `<path class="note" d="M${note.x},${note.y} h${note.w - 16} l16,16 v${note.h - 16} h-${note.w} z"/>`;
svg += textBlock(note.lines, note.x + 14, note.y + 30, "start", "lbl note-txt");
svg += `<path class="note-link" d="M${note.x + note.w},${note.y + 60} H650"/>`;

// labels last, with a halo, so they sit above lines
for (const e of edges) if (e.label.length) {
  const [x, y, anchor] = e.at;
  svg += textBlock(e.label, x, y - (e.above ? (e.label.length - 1) * LH : 0), anchor);
}

// legend
const ly = 1010;
svg += `<rect class="box evt" x="30" y="${ly}" width="52" height="30" rx="6"/><text class="lbl" x="94" y="${ly + 22}">event source outside the extension</text>`;
svg += `<rect class="box" x="450" y="${ly}" width="52" height="30" rx="6"/><text class="lbl" x="514" y="${ly + 22}">class (or «module» of functions)</text>`;
svg += `<text class="lbl" x="850" y="${ly + 22}"><tspan class="ev">EVENT</tspan> triggers the action after it</text>`;
svg += `<path class="edge" d="M1220,${ly + 15} H1290" marker-end="url(#arrow)"/><text class="lbl" x="1304" y="${ly + 22}">calls / notifies</text>`;
svg += `<circle cx="1500" cy="${ly + 15}" r="4" class="dot"/><path class="edge" d="M1500,${ly + 15} H1560" marker-end="url(#arrow)"/><text class="lbl" x="1574" y="${ly + 22}">branch of a shared line</text>`;

// Layout check (open with #check): reports text that overlaps a box, a line or other text.
const checker = `
if (location.hash === "#check") {
  const pad = 1;
  const rectOf = (el) => { const b = el.getBBox(); return { x: b.x + pad, y: b.y + pad, w: b.width - 2 * pad, h: b.height - 2 * pad }; };
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const texts = [...document.querySelectorAll("g text")].map((el) => ({ el, r: rectOf(el), s: el.textContent }));
  const boxes = [...document.querySelectorAll("g rect.box")].map((el) => ({ r: rectOf(el) }));
  const segs = [];
  document.querySelectorAll("g path.edge, g path.note-link").forEach((p) => {
    const pts = [...p.getAttribute("d").matchAll(/(-?[\\d.]+),(-?[\\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      segs.push({ x: Math.min(x1, x2) - 1, y: Math.min(y1, y2) - 1, w: Math.abs(x2 - x1) + 2, h: Math.abs(y2 - y1) + 2 });
    }
  });
  const out = [];
  texts.forEach((t, i) => {
    if (t.el.classList.contains("name")) return;
    texts.slice(i + 1).forEach((u) => { if (hit(t.r, u.r)) out.push("text/text: " + t.s + " | " + u.s); });
    boxes.forEach((b) => { if (hit(t.r, b.r)) out.push("text/box: " + t.s); });
    segs.forEach((s) => { if (hit(t.r, s)) out.push("text/line: " + t.s); });
  });
  document.querySelectorAll("g text.name").forEach((el) => {
    const r = rectOf(el), box = boxes.find((b) => hit(r, b.r));
    if (box && (r.x < box.r.x + 8 || r.x + r.w > box.r.x + box.r.w - 8)) out.push("name too wide: " + el.textContent);
  });
  const svgEl = document.querySelector("svg"), all = svgEl.getBBox();
  out.push("content extent: " + Math.round(all.x + all.width) + " x " + Math.round(all.y + all.height));
  const pre = document.createElement("pre"); pre.id = "report"; pre.textContent = out.join("\\n"); document.body.append(pre);
}`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BluePrint CRC Diagram</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; width: ${W}px; font-family: "Segoe UI", Arial, sans-serif; }
  svg { display: block; }
  .title { font-size: 42px; font-weight: 700; fill: #1f2328; }
  .box { fill: #d5e8d4; stroke: #82b366; stroke-width: 2; }
  .box.evt { fill: #fff2cc; stroke: #d6b656; stroke-dasharray: 7 5; }
  .name { font-size: 22px; font-weight: 700; fill: #1f2328; }
  .edge { fill: none; stroke: #3b3f45; stroke-width: 2; }
  .halo { fill: none; stroke: #fff; stroke-width: 8; }
  .dot { fill: #3b3f45; }
  .lbl { font-size: 18px; fill: #2d3136; paint-order: stroke; stroke: #fff; stroke-width: 5px; stroke-linejoin: round; }
  .ev { font-weight: 700; fill: #b85450; font-family: Consolas, "Cascadia Mono", monospace; font-size: 17px; }
  .group { fill: #f3f8f2; stroke: #82b366; stroke-width: 1.6; stroke-dasharray: 6 5; }
  .group-lbl { font-size: 17px; font-style: italic; fill: #5d8a47; }
  .note { fill: #fffbe6; stroke: #d6b656; stroke-width: 1.6; }
  .note-txt { stroke: none; }
  .note-link { fill: none; stroke: #d6b656; stroke-width: 1.6; stroke-dasharray: 5 4; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      <path d="M0,0 L10,5 L0,10 z" fill="#3b3f45"/>
    </marker>
  </defs>
  <text class="title" x="30" y="52">BluePrint CRC Diagram</text>
  <g transform="translate(0,${TOP})">
${svg}
  </g>
</svg>
<script>${checker}</script>
</body>
</html>
`;

writeFileSync(new URL("./event-crc.html", import.meta.url), html);
console.log("wrote event-crc.html");
