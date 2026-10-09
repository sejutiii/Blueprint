// Builds the report sections (Abstract, 5 Component-level design, 6 Interface design, 7 Testing,
// 8 User manual, 9 Conclusion) as a .docx
// that opens in Google Docs. Figures come from figures/ (see render.mjs).
// Usage: REPORT_TOOLS=<node_modules with docx> node build-report.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { section5 } from "./content/section5.mjs";
import { section6 } from "./content/section6.mjs";
import { section7 } from "./content/section7.mjs";
import { section8 } from "./content/section8.mjs";
import { section9 } from "./content/section9.mjs";
import { abstract } from "./content/abstract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const docx = createRequire(join(process.env.REPORT_TOOLS ?? ".", "noop.js"))("docx");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, ImageRun, BorderStyle, LevelFormat, PageBreak,
} = docx;

// A4 with 1-inch margins: 9026 DXA of text width (1440 DXA = 1 inch).
const PAGE = { width: 11906, height: 16838, margin: 1440 };
const TEXT_W = PAGE.width - 2 * PAGE.margin;
const FONT = "Arial";
const IMG_W_PX = 600; // ~6.25 in at 96 dpi
let stepList = 1; // numbering instance of the current numbered list; `restart` starts a new one

// ── Building blocks (used by the content modules) ────────────────────────────

/** Inline markup: **bold**, *italic*, `code`. */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) { out.push(new TextRun({ text: text.slice(last, m.index), ...base })); }
    const t = m[0];
    if (t.startsWith("**")) { out.push(new TextRun({ text: t.slice(2, -2), ...base, bold: true })); }
    else if (t.startsWith("`")) { out.push(new TextRun({ text: t.slice(1, -1), font: "Consolas", size: (base.size ?? 22) - 2, ...base, ...{ font: "Consolas" } })); }
    else { out.push(new TextRun({ text: t.slice(1, -1), ...base, italics: true })); }
    last = m.index + t.length;
  }
  if (last < text.length) { out.push(new TextRun({ text: text.slice(last), ...base })); }
  return out;
}

const B = {
  h1: (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] }),
  h2: (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] }),
  h3: (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] }),
  p: (text) => new Paragraph({ spacing: { after: 140, line: 300 }, alignment: AlignmentType.JUSTIFIED, children: runs(text) }),
  bullet: (text, level = 0) => new Paragraph({ numbering: { reference: "bullets", level }, spacing: { after: 60, line: 288 }, children: runs(text) }),
  /** One item of a numbered list; `restart: true` starts a new list at 1. */
  step(text, { restart = false } = {}) {
    if (restart) { stepList++; }
    return new Paragraph({ numbering: { reference: "steps", level: 0, instance: stepList }, spacing: { after: 80, line: 288 }, children: runs(text) });
  },
  pageBreak: () => new Paragraph({ children: [new PageBreak()] }),

  /** A full-width figure; `widthIn` narrows it (screenshots of narrow panels). */
  figure(file, caption, { widthIn } = {}) {
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
        children: [image(file, caption, widthIn ? widthIn * 96 : IMG_W_PX)] }),
      captionPara(caption),
    ];
  },

  /** Images side by side, each with an "(a) label" underneath, under one caption. */
  figureRow(items, caption) {
    const colW = Math.floor(TEXT_W / items.length);
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const borders = { top: none, bottom: none, left: none, right: none };
    const imgPx = Math.floor((colW / 1440) * 96) - 14;
    return [
      new Table({
        width: { size: colW * items.length, type: WidthType.DXA }, columnWidths: items.map(() => colW),
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [new TableRow({ cantSplit: true, children: items.map((it) => new TableCell({
          borders, width: { size: colW, type: WidthType.DXA }, verticalAlign: "top",
          margins: { top: 40, bottom: 40, left: 60, right: 60 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [image(it.file, it.label, imgPx)] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: runs(it.label, { size: 19 }) }),
          ],
        })) })],
      }),
      captionPara(caption),
    ];
  },

  /** Images stacked vertically (same width), each labelled, under one caption. */
  figureStack(items, caption, { widthIn } = {}) {
    const px = widthIn ? widthIn * 96 : IMG_W_PX;
    return [
      ...items.flatMap((it) => [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100 }, keepNext: true, children: [image(it.file, it.label, px)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, keepNext: true, children: runs(it.label, { size: 19 }) }),
      ]),
      captionPara(caption),
    ];
  },

  /** rows: array of arrays of strings (a cell may hold several paragraphs: string[] or "• a\n• b"). */
  table(caption, headers, rows, widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    const scaled = widths.map((w) => Math.round(w * TEXT_W / total));
    scaled[scaled.length - 1] += TEXT_W - scaled.reduce((a, b) => a + b, 0);
    const border = { style: BorderStyle.SINGLE, size: 4, color: "8A94A6" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (content, i, header) => new TableCell({
      borders, width: { size: scaled[i], type: WidthType.DXA },
      shading: header ? { fill: "DCE6F4", type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: (Array.isArray(content) ? content : [content]).map((t) => {
        const isBullet = !header && /^• /.test(t);
        return new Paragraph({
          spacing: { after: 40 },
          ...(isBullet ? { numbering: { reference: "cellbullets", level: 0 } } : {}),
          children: runs(isBullet ? t.slice(2) : t, { size: 19, bold: header || undefined }),
        });
      }),
    });
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, keepNext: true,
        children: runs(caption, { italics: true, size: 20 }) }),
      new Table({
        width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: scaled,
        rows: [
          new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
          ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
        ],
      }),
      new Paragraph({ spacing: { after: 160 }, children: [] }),
    ];
  },
};

function image(file, alt, widthPx) {
  const png = readFileSync(join(here, "figures", file));
  // PNG size from the IHDR chunk, to keep the aspect ratio.
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  return new ImageRun({ type: "png", data: png, transformation: { width: Math.round(widthPx), height: Math.round(widthPx * h / w) },
    altText: { title: alt, description: alt, name: file } });
}

function captionPara(caption) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 240 }, children: runs(caption, { italics: true, size: 20 }) });
}

// ── Document ──────────────────────────────────────────────────────────────────

const body = [
  ...abstract(B), B.pageBreak(),
  ...section5(B), B.pageBreak(), ...section6(B), B.pageBreak(), ...section7(B), B.pageBreak(),
  ...section8(B), B.pageBreak(), ...section9(B),
];

const doc = new Document({
  creator: "BluePrint project",
  title: "BluePrint report: abstract and sections 5-9",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: "1B2433" }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 27, bold: true, font: FONT, color: "1B2433" }, paragraph: { spacing: { before: 300, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: "2C3E5A" }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] },
      { reference: "steps", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ] },
      { reference: "cellbullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 260, hanging: 200 } } } },
      ] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE.width, height: PAGE.height },
      margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin } } },
    children: body.flat(),
  }],
});

const out = join(here, "BluePrint-report-sections-5-7.docx");
writeFileSync(out, await Packer.toBuffer(doc));
console.log(`wrote ${out}`);
