// Generates event-crc.html: an event-driven CRC diagram (classes as boxes, arrows labelled
// with the event or call that triggers each collaboration). Run: node docs/diagrams/event-crc.mjs
import { writeFileSync } from "node:fs";

const W = 2070, H = 1150, TOP = 70;

// ── Classes: [x, y, w, label, kind] (h = 56). kind: "evt" = event source outside the extension.
const H_BOX = 56;
const nodes = {
  developer:  [30,   40,  240, "Developer", "evt"],
  panel:      [600,  40,  240, "BlueprintPanel"],
  statusBar:  [1000, 40,  220, "StatusBarManager"],
  adrTree:    [1300, 40,  230, "AdrTreeProvider"],
  auditTree:  [1610, 40,  250, "AuditTrailTreeProvider"],

  workspace:  [30,   220, 240, "VS Code Workspace", "evt"],
  extension:  [600,  220, 240, "Extension"],
  auditLog:   [1100, 220, 200, "AuditLog"],

  access:     [1100, 350, 200, "AccessControl"],
  orch:       [600,  410, 240, "Orchestrator"],
  decisions:  [1500, 410, 230, "DecisionService"],
  adrStore:   [1840, 410, 200, "AdrStore"],
  fileStore:  [1100, 480, 200, "FileStore"],

  snapshot:   [30,   680, 210, "CodebaseSnapshot"],
  diff:       [270,  680, 200, "DiffSummarizer"],
  compliance: [530,  680, 200, "ComplianceAgent"],
  precheck:   [770,  680, 200, "PreCheckAgent"],
  arch:       [1010, 680, 200, "ArchitectureAgent"],
  elicit:     [1250, 680, 250, "ConstraintElicitationAgent"],
  retrieval:  [1600, 680, 200, "RetrievalAgent"],

  treeSitter: [120,  880, 260, "TreeSitterExtractor"],
  llm:        [910,  880, 220, "LLMClient"],
  session:    [1265, 880, 220, "ElicitationSession"],
  embedding:  [1600, 880, 200, "EmbeddingService"],
};

// ── Collaborations: orthogonal polyline (last point gets the arrowhead) + label.
// Label lines: {EVENT} renders as an event name; plain text is the action.
// at: [x, y, anchor] of the first line's baseline.
const edges = [
  // Event sources → UI
  { pts: [[270, 62], [600, 62]], label: ["fills webview forms", "(setup, pre-check, review, add decision)"], at: [435, 54, "middle"], above: true },
  { pts: [[270, 84], [520, 84], [520, 236], [600, 236]], label: ["runs commands,", "sidebar actions"], at: [510, 152, "end"] },
  { pts: [[270, 262], [600, 262]], label: ["{file created} → offer a review", "{ARCH.md / ADRs / roles.json changed} → refresh"], at: [282, 282, "start"] },

  // Panel ↔ Extension
  { pts: [[660, 96], [660, 220]], label: ["posts form", "messages"], at: [650, 150, "end"] },
  { pts: [[780, 220], [780, 96]], label: ["opens panels,", "posts results"], at: [790, 128, "start"] },

  // Extension → views (bus)
  { pts: [[840, 232], [920, 232], [920, 160], [1110, 160], [1110, 96]], label: ["sets state, role,", "pending count"], at: [1120, 128, "start"] },
  { pts: [[1110, 160], [1415, 160], [1415, 96]], label: ["refresh(ADRs)"], at: [1425, 132, "start"], noStart: true },
  { pts: [[1415, 160], [1735, 160], [1735, 96]], label: ["refresh(ADRs)"], at: [1745, 132, "start"], noStart: true },
  { pts: null, label: ["{onState / onDataChanged} → refresh views"], at: [1250, 180, "middle"] },

  // AuditLog → Extension
  { pts: [[1100, 262], [840, 262]], label: ["{onAppend}: entry added →", "refresh audit trail"], at: [990, 279, "middle"] },

  // Extension ↔ Orchestrator
  { pts: [[660, 276], [660, 410]], label: [], at: [0, 0] },
  { pts: [[780, 410], [780, 276]], label: ["hooks:", "{onState}", "{onDataChanged}"], at: [790, 330, "start"] },

  // Orchestrator → shared stores
  { pts: [[840, 422], [900, 422], [900, 312], [1150, 312], [1150, 276]], label: ["logs reviews, pre-checks,", "regeneration, role changes"], at: [1025, 332, "middle"] },
  { pts: [[840, 440], [1000, 440], [1000, 378], [1100, 378]], label: ["checks", "Architect role"], at: [1007, 400, "start"] },
  { pts: [[840, 458], [1020, 458], [1020, 508], [1100, 508]], label: ["writes ARCH.md", "(init, regenerate)"], at: [1012, 486, "end"] },

  // DecisionService → shared stores
  { pts: [[1590, 410], [1590, 316], [1250, 316], [1250, 276]], label: ["records ADR proposed /", "approved / rejected / superseded"], at: [1420, 290, "middle"], above: true },
  { pts: [[1500, 430], [1400, 430], [1400, 378], [1300, 378]], label: ["resolves role:", "accept or queue"], at: [1350, 350, "middle"] },
  { pts: [[1500, 456], [1380, 456], [1380, 508], [1300, 508]], label: ["on acceptance:", "patches ARCH.md"], at: [1388, 486, "start"] },
  { pts: [[1730, 438], [1840, 438]], label: ["creates /", "updates ADRs"], at: [1785, 404, "middle"], above: true },

  // Orchestrator → DecisionService
  { pts: [[800, 466], [800, 572], [1560, 572], [1560, 466]], label: ["propose / approve / reject ADR"], at: [1180, 564, "middle"], above: true },
  { pts: null, label: ["{violation resolved} · {extension confirmed} · {decision saved} · {approve / reject}"], at: [1180, 590, "middle"] },

  // Orchestrator → agents (bus)
  { pts: [[700, 466], [700, 620], [135, 620], [135, 680]], label: ["{regenerate}:", "snapshot codebase"], at: [141, 645, "start"], trunk: true },
  { pts: [[370, 620], [370, 680]], label: ["{review}:", "summarize diff"], at: [376, 645, "start"], noStart: true },
  { pts: [[630, 620], [630, 680]], label: ["{review}: run", "Pass 1 ‖ Pass 2"], at: [636, 645, "start"], noStart: true },
  { pts: [[700, 620], [870, 620], [870, 680]], label: ["{PROMPT_SUBMITTED}:", "check prompt"], at: [876, 645, "start"], noStart: true },
  { pts: [[1110, 620], [1110, 680]], label: ["{PROJECT_INIT / regenerate}:", "draft blueprint"], at: [1116, 645, "start"], noStart: true },
  { pts: [[1375, 620], [1375, 680]], label: ["{wizard answer} /", "{Add Decision}: draft ADR"], at: [1381, 645, "start"], noStart: true },
  { pts: [[870, 620], [1614, 620], [1614, 680]], label: ["rank relevant", "ADRs"], at: [1620, 645, "start"], noStart: true },

  // DecisionService → RetrievalAgent; RetrievalAgent → stores
  { pts: [[1720, 466], [1720, 680]], label: ["on acceptance:", "cache embedding"], at: [1730, 590, "start"] },
  { pts: [[1800, 708], [1940, 708], [1940, 466]], label: ["reads ADRs,", "stores", "embeddings"], at: [1948, 580, "start"] },
  { pts: [[1700, 736], [1700, 880]], label: ["embeds text", "(MiniLM, local)"], at: [1710, 805, "start"] },

  // Agents → helpers
  { pts: [[175, 736], [175, 880]], label: ["top-level", "declarations"], at: [165, 805, "end"] },
  { pts: [[330, 736], [330, 880]], label: ["new imports &", "declarations"], at: [340, 805, "start"] },
  { pts: [[1020, 752], [1020, 880]], label: ["send prompts to the chat model", "(Gemini, Groq, OpenRouter, Anthropic, OpenAI)"], at: [1030, 800, "start"] },
  { pts: [[1375, 736], [1375, 880]], label: ["tracks wizard", "topics & follow-ups"], at: [1385, 840, "start"] },
];

// The four LLM agents share one arrow to LLMClient.
const group = { x: 515, y: 666, w: 1000, h: 86, label: "LLM agents" };

// Note beside Extension → Orchestrator listing the dispatched events.
const note = {
  x: 250, y: 326, w: 340, h: 82,
  lines: [
    "dispatches events:",
    "{PROJECT_INIT} · {PROMPT_SUBMITTED}",
    "{CODE_GENERATED} · {MANUAL_REVIEW_REQUESTED}",
    "+ decision, approval, roles, regenerate requests",
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
    `<text class="${cls}" x="${x}" y="${y + i * 15}" text-anchor="${anchor}">${richLine(l)}</text>`
  ).join("\n");
}

const pathD = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");

let svg = "";

// group frame first (behind everything)
svg += `<rect class="group" x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="12"/>`;
svg += `<text class="group-lbl" x="${group.x + 12}" y="${group.y + group.h - 6}">${group.label}</text>`;

// edges: white halo pass, then line pass, so crossings read clearly
for (const e of edges) if (e.pts) svg += `<path class="halo" d="${pathD(e.pts)}"/>`;
for (const e of edges) if (e.pts) {
  svg += `<path class="edge" d="${pathD(e.pts)}" marker-end="url(#arrow)"/>`;
  if (e.noStart) svg += `<circle cx="${e.pts[0][0]}" cy="${e.pts[0][1]}" r="3" class="dot"/>`;
}

// boxes
for (const [x, y, w, label, kind] of Object.values(nodes)) {
  svg += `<rect class="box ${kind ?? ""}" x="${x}" y="${y}" width="${w}" height="${H_BOX}" rx="9"/>`;
  svg += `<text class="name" x="${x + w / 2}" y="${y + H_BOX / 2 + 5}" text-anchor="middle">${label}</text>`;
}

// note
svg += `<path class="note" d="M${note.x},${note.y} h${note.w - 14} l14,14 v${note.h - 14} h-${note.w} z"/>`;
svg += textBlock(note.lines, note.x + 12, note.y + 22, "start", "lbl note-txt");
svg += `<path class="note-link" d="M${note.x + note.w},${note.y + 46} H660"/>`;

// labels last, with a halo, so they sit above lines
for (const e of edges) if (e.label.length) {
  const [x, y, anchor] = e.at;
  svg += textBlock(e.label, x, y - (e.above ? (e.label.length - 1) * 15 : 0), anchor);
}

// legend
const ly = 1020;
svg += `<rect class="box evt" x="30" y="${ly}" width="44" height="24" rx="6"/><text class="lbl" x="84" y="${ly + 17}">event source outside the extension</text>`;
svg += `<rect class="box" x="360" y="${ly}" width="44" height="24" rx="6"/><text class="lbl" x="414" y="${ly + 17}">class (or «module» of functions)</text>`;
svg += `<text class="lbl" x="680" y="${ly + 17}"><tspan class="ev">EVENT</tspan> triggers the action after it</text>`;
svg += `<path class="edge" d="M970,${ly + 12} H1030" marker-end="url(#arrow)"/><text class="lbl" x="1042" y="${ly + 17}">calls / notifies</text>`;
svg += `<circle cx="1200" cy="${ly + 12}" r="3" class="dot"/><path class="edge" d="M1200,${ly + 12} H1250" marker-end="url(#arrow)"/><text class="lbl" x="1262" y="${ly + 17}">branch of a shared line</text>`;
svg += `<text class="lbl muted" x="30" y="${ly + 52}">Extension also reads AdrStore and FileStore directly to fill the sidebar and the ARCH.md viewer, and saves the API key through LLMClient in the setup wizard (not drawn).</text>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BluePrint — Event-Driven CRC Diagram</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; width: ${W}px; font-family: "Segoe UI", Arial, sans-serif; }
  svg { display: block; }
  .title { font-size: 26px; font-weight: 700; fill: #1f2328; }
  .subtitle { font-size: 14px; fill: #5b6168; }
  .box { fill: #d5e8d4; stroke: #82b366; stroke-width: 1.6; }
  .box.evt { fill: #fff2cc; stroke: #d6b656; stroke-dasharray: 6 4; }
  .name { font-size: 15px; font-weight: 600; fill: #1f2328; }
  .edge { fill: none; stroke: #3b3f45; stroke-width: 1.4; }
  .halo { fill: none; stroke: #fff; stroke-width: 6; }
  .dot { fill: #3b3f45; }
  .lbl { font-size: 12.5px; fill: #2d3136; paint-order: stroke; stroke: #fff; stroke-width: 4px; stroke-linejoin: round; }
  .lbl.muted { fill: #6a7076; }
  .ev { font-weight: 700; fill: #b85450; font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; }
  .group { fill: #f3f8f2; stroke: #82b366; stroke-width: 1.2; stroke-dasharray: 5 4; }
  .group-lbl { font-size: 12px; font-style: italic; fill: #5d8a47; }
  .note { fill: #fffbe6; stroke: #d6b656; stroke-width: 1.2; }
  .note-txt { stroke: none; }
  .note-link { fill: none; stroke: #d6b656; stroke-width: 1.2; stroke-dasharray: 4 3; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      <path d="M0,0 L10,5 L0,10 z" fill="#3b3f45"/>
    </marker>
  </defs>
  <text class="title" x="30" y="40">BluePrint — Event-Driven CRC Diagram</text>
  <text class="subtitle" x="530" y="40">Classes and the events / calls through which they collaborate</text>
  <g transform="translate(0,${TOP})">
${svg}
  </g>
</svg>
</body>
</html>
`;

writeFileSync(new URL("./event-crc.html", import.meta.url), html);
console.log("wrote event-crc.html");
