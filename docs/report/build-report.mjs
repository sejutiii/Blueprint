// Builds the report sections (5 Component-level design, 6 Interface design, 7 Testing) as a .docx
// that opens in Google Docs. Figures come from figures/ (see render.mjs).
// Usage: REPORT_TOOLS=<node_modules with docx> node build-report.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { section5 } from "./content/section5.mjs";

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

// ── Building blocks (used by the content modules) ────────────────────────────

/** Inline markup: **bold**, *italic*, `code`. */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) { out.push(new TextRun({ text: text.slice(last, m.index), ...base })); }
    const t = m[0];
    if (t.startsWith("**")) { out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base })); }
    else if (t.startsWith("`")) { out.push(new TextRun({ text: t.slice(1, -1), font: "Consolas", size: (base.size ?? 22) - 2, ...base, ...{ font: "Consolas" } })); }
    else { out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base })); }
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
  pageBreak: () => new Paragraph({ children: [new PageBreak()] }),

  figure(file, caption) {
    const png = readFileSync(join(here, "figures", file));
    // PNG size from the IHDR chunk, to keep the aspect ratio.
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
        children: [new ImageRun({ type: "png", data: png, transformation: { width: IMG_W_PX, height: Math.round(IMG_W_PX * h / w) },
          altText: { title: caption, description: caption, name: file } })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
        children: runs(caption, { italics: true, size: 20 }) }),
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
          ...rows.map((r) => new TableRow({ cantSplit: false, children: r.map((c, i) => cell(c, i, false)) })),
        ],
      }),
      new Paragraph({ spacing: { after: 160 }, children: [] }),
    ];
  },
};

// ── Document ──────────────────────────────────────────────────────────────────

const body = [...section5(B)];

const doc = new Document({
  creator: "BluePrint project",
  title: "BluePrint report: sections 5-7",
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
