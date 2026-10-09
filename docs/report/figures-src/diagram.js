// Tiny hand-placed diagram helper for the report figures: boxes are HTML (so text wraps and is
// measured by the browser), connectors are orthogonal SVG paths drawn after layout.
//
//   const d = new Diagram();
//   d.box("adr", { x: 430, y: 20, w: 360, title: "ADR", attrs: ["id : string", ...] });
//   d.edge({ from: ["adr", "bottom"], to: ["effect", "top"], kind: "comp", label: "applied on approval" });
//   d.render();   // sets window.figReady
//
// Sides are top / bottom / left / right; an optional third value (0..1) picks the point along the
// side (default 0.5). `via` lists extra corner points; otherwise the route is chosen from the sides.
// kinds: "assoc" (solid, open arrow), "dep" (dashed, open arrow), "comp" (solid, filled diamond at
// the source), "line" (solid, no ends), "dash" (dashed, no ends), "flow" (solid, filled arrow),
// "trans" (state transition).

const NS = "http://www.w3.org/2000/svg";

export class Diagram {
  constructor(root = document.getElementById("fig")) {
    this.root = root;
    this.root.style.position = "relative";
    this.boxes = new Map();
    this.edges = [];
  }

  /** opts: x, y, w, h?, title, stereo?, attrs?, cls?, html? (raw inner HTML instead of attrs). */
  box(id, opts) {
    const el = document.createElement("div");
    el.className = `box ${opts.cls ?? "class"}`;
    Object.assign(el.style, { left: `${opts.x}px`, top: `${opts.y}px`, width: `${opts.w}px` });
    if (opts.h) { el.style.height = `${opts.h}px`; }
    const head = opts.title !== undefined
      ? `<div class="head">${opts.stereo ? `<div class="stereo">«${opts.stereo}»</div>` : ""}<div class="title">${opts.title}</div></div>`
      : "";
    const body = opts.html ?? (opts.attrs?.length ? `<div class="attrs">${opts.attrs.map((a) => `<div>${a}</div>`).join("")}</div>` : "");
    el.innerHTML = head + body;
    this.root.appendChild(el);
    this.boxes.set(id, el);
    return el;
  }

  /** Free text (e.g. a lane title) at a position. */
  text(html, opts) {
    const el = document.createElement("div");
    el.className = `free ${opts.cls ?? ""}`;
    Object.assign(el.style, { left: `${opts.x}px`, top: `${opts.y}px`, width: opts.w ? `${opts.w}px` : "auto" });
    el.innerHTML = html;
    this.root.appendChild(el);
    return el;
  }

  edge(e) { this.edges.push(e); }

  rect(id) {
    const el = this.boxes.get(id);
    if (!el) { throw new Error(`no box ${id}`); }
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }

  anchor([id, side, t = 0.5]) {
    const r = this.rect(id);
    switch (side) {
      case "top":    return { x: r.x + r.w * t, y: r.y, side };
      case "bottom": return { x: r.x + r.w * t, y: r.y + r.h, side };
      case "left":   return { x: r.x, y: r.y + r.h * t, side };
      case "right":  return { x: r.x + r.w, y: r.y + r.h * t, side };
    }
    throw new Error(`bad side ${side}`);
  }

  route(a, b, via) {
    const pts = [a];
    if (via) {
      for (const p of via) { pts.push({ x: p[0] ?? pts[pts.length - 1].x, y: p[1] ?? pts[pts.length - 1].y }); }
      // Finish with a right angle into the target side.
      const last = pts[pts.length - 1];
      if (b.side === "left" || b.side === "right") { if (last.y !== b.y) { pts.push({ x: last.x, y: b.y }); } }
      else if (last.x !== b.x) { pts.push({ x: b.x, y: last.y }); }
    }
    else {
      const vert = (s) => s === "top" || s === "bottom";
      // Nearly aligned ends: straighten the line instead of drawing a tiny jog.
      if (vert(a.side) && vert(b.side) && Math.abs(a.x - b.x) < 12) { b = { ...b, x: a.x }; }
      if (!vert(a.side) && !vert(b.side) && Math.abs(a.y - b.y) < 12) { b = { ...b, y: a.y }; }
      if (vert(a.side) && vert(b.side)) {
        if (a.x !== b.x) { const my = (a.y + b.y) / 2; pts.push({ x: a.x, y: my }, { x: b.x, y: my }); }
      } else if (!vert(a.side) && !vert(b.side)) {
        if (a.y !== b.y) { const mx = (a.x + b.x) / 2; pts.push({ x: mx, y: a.y }, { x: mx, y: b.y }); }
      } else if (vert(a.side)) { pts.push({ x: a.x, y: b.y }); }
      else { pts.push({ x: b.x, y: a.y }); }
    }
    pts.push(b);
    return pts;
  }

  render() {
    const pad = 24;
    let maxX = 0, maxY = 0;
    for (const el of this.boxes.values()) {
      maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
      maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
    }
    for (const el of this.root.querySelectorAll(".free")) {
      maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
    }
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "edges");
    svg.innerHTML = `<defs>
      <marker id="open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M1,1 L11,6 L1,11" fill="none" stroke="#2d3748" stroke-width="1.8"/></marker>
      <marker id="filled" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0,1 L12,6 L0,11 z" fill="#2d3748"/></marker>
      <marker id="diamond" viewBox="0 0 20 12" refX="19" refY="6" markerWidth="20" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M1,6 L10,1 L19,6 L10,11 z" fill="#2d3748"/></marker>
    </defs>`;
    this.root.prepend(svg);

    for (const e of this.edges) {
      const a = this.anchor(e.from), b = this.anchor(e.to);
      const pts = this.route(a, b, e.via);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" "));
      const kind = e.kind ?? "assoc";
      path.setAttribute("class", `edge ${kind}`);
      if (kind === "assoc" || kind === "dep") { path.setAttribute("marker-end", "url(#open)"); }
      if (kind === "flow" || kind === "trans") { path.setAttribute("marker-end", "url(#filled)"); }
      if (kind === "comp") { path.setAttribute("marker-start", "url(#diamond)"); }
      if (e.both) { path.setAttribute("marker-start", "url(#filled)"); }
      svg.appendChild(path);

      if (e.label) { this.label(e.label, e.labelAt ?? midpoint(pts), e.labelCls); }
      if (e.fromMult) { this.mult(e.fromMult, pts[0], pts[1], e.fromMultSide); }
      if (e.toMult) { this.mult(e.toMult, pts[pts.length - 1], pts[pts.length - 2], e.toMultSide); }
    }

    for (const el of this.root.querySelectorAll(".lbl, .mult")) {
      maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
      maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
    }
    this.root.style.height = `${maxY + pad}px`;
    svg.setAttribute("width", String(Math.max(maxX + pad, this.root.offsetWidth)));
    svg.setAttribute("height", String(maxY + pad));
    window.figReady = true;
  }

  label(html, at, cls = "") {
    const el = document.createElement("div");
    el.className = `lbl ${cls}`;
    el.innerHTML = html;
    this.root.appendChild(el);
    el.style.left = `${at.x - el.offsetWidth / 2}px`;
    el.style.top = `${at.y - el.offsetHeight / 2}px`;
  }

  // Multiplicity next to an end point, on the side given (default: to the right / below the line).
  mult(text, end, next, side) {
    const el = document.createElement("div");
    el.className = "mult";
    el.textContent = text;
    this.root.appendChild(el);
    const vertical = end.x === next.x;
    const dir = vertical ? Math.sign(next.y - end.y) : Math.sign(next.x - end.x);
    const w = el.offsetWidth, h = el.offsetHeight;
    let x, y;
    if (vertical) {
      x = side === "left" ? end.x - w - 6 : end.x + 6;
      y = dir > 0 ? end.y + 4 : end.y - h - 4;
    } else {
      y = side === "above" ? end.y - h - 2 : end.y + 2;
      x = dir > 0 ? end.x + 6 : end.x - w - 6;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
}

// Middle of the longest segment: where a label is least likely to sit on a corner.
function midpoint(pts) {
  let best = null, len = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    if (l > len) { len = l; best = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 }; }
  }
  return best;
}
