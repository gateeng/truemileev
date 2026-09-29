// TrueMile EV web | lib/reportdesign.js | pure: the Report designer's model and the designed document.
// A design is a plain object of enum choices, booleans and short plain-text fields. parseDesign accepts
// anything (stored JSON, a hand-edited object, junk) and returns a complete, valid design; it never
// throws. User text is only ever escaped into element content: pageCss and cssVars are built from enum
// values alone, so nothing the reader types can reach a style sheet.
// Stored per browser under tm.report.design (JSON) and tm.report.logo (a PNG or JPEG data URL made in
// the browser from a local file; never uploaded).

export const BUILD = "2026-09-29.2";

// ── choices ───────────────────────────────────────────────────────────────────────────────────

export const TEMPLATES = Object.freeze([
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "compact", label: "Compact" },
]);

export const ACCENTS = Object.freeze([
  { hex: "#0E7490", label: "Teal" },
  { hex: "#15803D", label: "Green" },
  { hex: "#1D4ED8", label: "Blue" },
  { hex: "#B45309", label: "Amber" },
  { hex: "#C62828", label: "Red" },
  { hex: "#6D28D9", label: "Violet" },
  { hex: "#374151", label: "Graphite" },
  { hex: "#000000", label: "Black" },
]);

/** System font stacks only: the page loads no font file. */
export const FONTS = Object.freeze({
  sans: { label: "Sans", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  serif: { label: "Serif", stack: 'Georgia, "Times New Roman", serif' },
});

export const SIZES = Object.freeze({
  small: { label: "Small", pt: "9pt" },
  normal: { label: "Normal", pt: "10.5pt" },
  large: { label: "Large", pt: "12pt" },
});

/** Paper sizes: the @page keyword and the portrait dimensions in CSS pixels (96 per inch). */
export const PAPERS = Object.freeze({
  letter: { label: "Letter", css: "Letter", wPx: 816, hPx: 1056 },
  a4: { label: "A4", css: "A4", wPx: 210 / 25.4 * 96, hPx: 297 / 25.4 * 96 },
});

export const ORIENTATIONS = Object.freeze(["portrait", "landscape"]);

export const MARGINS = Object.freeze({
  narrow: { label: "Narrow", css: "0.4in", px: 38.4 },
  normal: { label: "Normal", css: "0.6in", px: 57.6 },
  wide: { label: "Wide", css: "0.9in", px: 86.4 },
});

export const LOGO_POSITIONS = Object.freeze(["left", "right"]);
export const LOGO_SIZES = Object.freeze({ small: 32, medium: 48, large: 64 });

/** Text field caps (in characters, counted as code points). */
export const LIMITS = Object.freeze({ title: 120, subtitle: 160, header: 160, footer: 160, footnote: 2000 });

/** The column keys the Period / Journey tables can show (lib/printmodel.js fills them). */
export const TRIP_COL_KEYS = Object.freeze(["date", "dist", "eff", "cost", "used", "regen", "hvac", "soh", "type", "car"]);
export const CHARGE_COL_KEYS = Object.freeze(["date", "network", "kwh", "cost", "rate", "arr", "dep", "eff"]);

export const SECTION_KEYS = Object.freeze(["summary", "trips", "notes", "charges", "route", "vehicleLine", "generatedLine"]);

export const DEFAULT_DESIGN = Object.freeze({
  template: "classic",
  accent: "#0E7490",
  font: "sans",
  size: "normal",
  paper: "letter",
  orientation: "portrait",
  margins: "normal",
  zebra: true,
  pageNumbers: true,
  logoPos: "left",
  logoSize: "medium",
  title: "",
  subtitle: "",
  header: "",
  footer: "",
  footnote: "",
  sections: Object.freeze({ summary: true, trips: true, notes: true, charges: true, route: true, vehicleLine: true, generatedLine: true }),
  tripCols: null,
  chargeCols: null,
});

export const STORE_DESIGN = "tm.report.design";
export const STORE_LOGO = "tm.report.logo";

const HEX = /^#[0-9a-f]{6}$/i;

// ── parsing ───────────────────────────────────────────────────────────────────────────────────

const own = (o, k) => o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

// C0 / C1 controls, DEL, and the bidi override / isolate marks that can reorder what a line shows.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

function capChars(s, n) {
  const a = Array.from(s);
  return a.length > n ? a.slice(0, n).join("") : s;
}

/** One line of plain text: tabs and line breaks become spaces, controls go, trimmed, capped. */
export function cleanLine(v, cap) {
  if (typeof v !== "string") return "";
  const s = v.replace(/[\t\r\n]+/g, " ").replace(CONTROLS, "").replace(/ {2,}/g, " ").trim();
  return capChars(s, cap).trim();
}

/** Multi-line plain text (the footnote): line breaks kept as "\n", other controls removed. */
export function cleanBlock(v, cap) {
  if (typeof v !== "string") return "";
  const s = v.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CONTROLS, "")
    .split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
  return capChars(s, cap).trim();
}

function pickEnum(v, allowed, dflt) {
  return typeof v === "string" && allowed.includes(v) ? v : dflt;
}
function pickBool(v, dflt) { return typeof v === "boolean" ? v : dflt; }

function pickCols(v, keys) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const k of v) if (typeof k === "string" && keys.includes(k) && !out.includes(k)) out.push(k);
  return out;
}

/** A valid accent (upper-case #RRGGBB) or the default. */
export function cleanAccent(v) {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim().toUpperCase() : DEFAULT_DESIGN.accent;
}

/**
 * parseDesign(json string | object | anything) → a complete design. Every key is validated; an unknown
 * key is dropped; a bad value falls back to its default; text is cleaned and capped. Never throws.
 */
export function parseDesign(input) {
  let o = input;
  if (typeof input === "string") {
    try { o = JSON.parse(input); } catch (_) { o = null; }
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) o = {};
  const get = (k) => (own(o, k) ? o[k] : undefined);
  const secIn = get("sections");
  const sections = {};
  for (const k of SECTION_KEYS) sections[k] = pickBool(own(secIn, k) ? secIn[k] : undefined, DEFAULT_DESIGN.sections[k]);
  return {
    template: pickEnum(get("template"), TEMPLATES.map((t) => t.id), DEFAULT_DESIGN.template),
    accent: get("accent") === undefined ? DEFAULT_DESIGN.accent : cleanAccent(get("accent")),
    font: pickEnum(get("font"), Object.keys(FONTS), DEFAULT_DESIGN.font),
    size: pickEnum(get("size"), Object.keys(SIZES), DEFAULT_DESIGN.size),
    paper: pickEnum(get("paper"), Object.keys(PAPERS), DEFAULT_DESIGN.paper),
    orientation: pickEnum(get("orientation"), ORIENTATIONS, DEFAULT_DESIGN.orientation),
    margins: pickEnum(get("margins"), Object.keys(MARGINS), DEFAULT_DESIGN.margins),
    zebra: pickBool(get("zebra"), DEFAULT_DESIGN.zebra),
    pageNumbers: pickBool(get("pageNumbers"), DEFAULT_DESIGN.pageNumbers),
    logoPos: pickEnum(get("logoPos"), LOGO_POSITIONS, DEFAULT_DESIGN.logoPos),
    logoSize: pickEnum(get("logoSize"), Object.keys(LOGO_SIZES), DEFAULT_DESIGN.logoSize),
    title: cleanLine(get("title"), LIMITS.title),
    subtitle: cleanLine(get("subtitle"), LIMITS.subtitle),
    header: cleanLine(get("header"), LIMITS.header),
    footer: cleanLine(get("footer"), LIMITS.footer),
    footnote: cleanBlock(get("footnote"), LIMITS.footnote),
    sections,
    tripCols: pickCols(get("tripCols"), TRIP_COL_KEYS),
    chargeCols: pickCols(get("chargeCols"), CHARGE_COL_KEYS),
  };
}

/** The stored form: the parsed design as JSON (so a stored value always parses back to itself). */
export function serializeDesign(d) {
  return JSON.stringify(parseDesign(d));
}

/** A fresh copy of the defaults (mutable). */
export function defaultDesign() { return parseDesign({}); }

// ── logo ──────────────────────────────────────────────────────────────────────────────────────

/** The logo's stored-size ceiling: 200 KB of image bytes (the data URL is ~4/3 of that). */
export const LOGO_MAX_BYTES = 200 * 1024;
export const LOGO_BOX = Object.freeze({ w: 600, h: 200 });
export const LOGO_TOO_LARGE = "That image is too large; try a smaller one.";

/** Bytes an image data URL decodes to (base64 payload × 3/4 minus padding). */
export function dataUrlBytes(url) {
  const m = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(String(url || ""));
  if (!m) return Infinity;
  const b = m[1];
  const pad = b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0;
  return Math.floor(b.length * 3 / 4) - pad;
}

/** A stored logo is used only when it is a PNG or JPEG base64 data URL within the size cap. */
export function validLogo(url) {
  const s = String(url ?? "");
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  return dataUrlBytes(s) <= LOGO_MAX_BYTES ? s : null;
}

/** The canvas size that fits [w]×[h] inside the 600×200 box, keeping the aspect (never enlarged). */
export function fitLogo(w, h) {
  w = Number(w) || 0; h = Number(h) || 0;
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, LOGO_BOX.w / w, LOGO_BOX.h / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Which encoding to keep after rasterising: the PNG when it fits, else the JPEG (0.85) when that fits,
 * else null (refuse with LOGO_TOO_LARGE).
 */
export function chooseLogo(pngUrl, jpegUrl) {
  if (dataUrlBytes(pngUrl) <= LOGO_MAX_BYTES && validLogo(pngUrl)) return pngUrl;
  if (jpegUrl && dataUrlBytes(jpegUrl) <= LOGO_MAX_BYTES && validLogo(jpegUrl)) return jpegUrl;
  return null;
}

// ── print CSS (enum-derived only) ─────────────────────────────────────────────────────────────

/** The one @page rule set (plus the page counter when page numbers are on). No user text, ever. */
export function pageCss(d) {
  const x = parseDesign(d);
  let css = `@page { size: ${PAPERS[x.paper].css} ${x.orientation}; margin: ${MARGINS[x.margins].css}; }`;
  if (x.pageNumbers) css += `\n@page { @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt } }`;
  return css;
}

/** Black or white, whichever reads better on the accent (WCAG relative luminance). */
export function accentInk(hex) {
  const h = cleanAccent(hex);
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return (1.05) / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#FFFFFF" : "#000000";
}

/** The paper's custom properties (validated values only). */
export function cssVars(d) {
  const x = parseDesign(d);
  return {
    "--rpt-accent": x.accent,
    "--rpt-accent-ink": accentInk(x.accent),
    "--rpt-font": FONTS[x.font].stack,
    "--rpt-size": SIZES[x.size].pt,
  };
}

/** cssVars as a style attribute value (the caller still escapes it into the attribute). */
export function styleText(d) {
  return Object.entries(cssVars(d)).map(([k, v]) => `${k}:${v}`).join(";");
}

/** The preview paper in CSS pixels: width, height and the margin (padding) for the chosen design. */
export function paperPx(d) {
  const x = parseDesign(d);
  const p = PAPERS[x.paper];
  const land = x.orientation === "landscape";
  return { w: land ? p.hPx : p.wPx, h: land ? p.wPx : p.hPx, margin: MARGINS[x.margins].px };
}

/** The preview scale: fit the paper's width into the stage, never above 1. */
export function fitScale(stageWidth, paperWidth) {
  const s = Number(stageWidth) || 0, p = Number(paperWidth) || 0;
  if (!(s > 0) || !(p > 0)) return 1;
  return Math.min(1, s / p);
}

// ── file names ────────────────────────────────────────────────────────────────────────────────

/** A journey name as a file-name piece: letters, digits, "-" and "_" only; spaces become "_". */
export function fileSafe(s, cap = 60) {
  const t = String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_").replace(/_+/g, "_");
  return t.slice(0, cap).replace(/^[_-]+|[_-]+$/g, "");
}

/**
 * The document title while printing, which Chrome and Edge use as the PDF's file name:
 * TrueMileEV_Report_<yyyyMMdd>_<yyyyMMdd>, TrueMileEV_Journey_<name>, TrueMileEV_Mileage_<year>.
 * The file name never carries the reader's own title text (a name stays predictable to sort).
 */
export function fileTitle(kind, model, _d) {
  const m = model || {};
  if (kind === "journey") {
    const n = fileSafe(m.title);
    return `TrueMileEV_Journey_${n || "Journey"}`;
  }
  if (kind === "mileage") {
    const y = Number(m.year);
    return Number.isInteger(y) && y > 1900 ? `TrueMileEV_Mileage_${y}` : "TrueMileEV_Mileage";
  }
  const ok = (s) => /^\d{8}$/.test(String(s || ""));
  return ok(m.fromYmd) && ok(m.toYmd) ? `TrueMileEV_Report_${m.fromYmd}_${m.toYmd}` : "TrueMileEV_Report";
}

// ── columns ───────────────────────────────────────────────────────────────────────────────────

/**
 * pickColumns(colKeys, chosen) → the indexes of [colKeys] to show, in table order. [chosen] null (or not
 * an array) keeps every column; otherwise a column shows when its key is chosen. "date" always shows;
 * a chosen key the table does not have is ignored.
 */
export function pickColumns(cols, chosen) {
  const keys = Array.isArray(cols) ? cols : [];
  if (!Array.isArray(chosen)) return keys.map((_, i) => i);
  const set = new Set(chosen.filter((k) => typeof k === "string"));
  const out = [];
  keys.forEach((k, i) => { if (k === "date" || set.has(k)) out.push(i); });
  return out;
}

// ── the designed document (an HTML string; every piece of text escaped) ──────────────────────

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

const TEXT_COLS = new Set(["date", "type", "car", "network"]);

function table(keys, labels, rows, zebra) {
  const cls = (k) => (TEXT_COLS.has(k) ? "" : "print-num");
  return `<table class="print-table${zebra ? " print-zebra" : ""}"><thead><tr>` +
    labels.map((l, i) => `<th class="${cls(keys[i])}">${escHtml(l)}</th>`).join("") +
    `</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c, i) => `<td class="${cls(keys[i])}">${escHtml(c)}</td>`).join("")}</tr>`).join("") +
    `</tbody></table>`;
}

function logoHtml(logo, d) {
  const url = validLogo(logo);
  if (!url) return "";
  return `<img class="print-logo print-logo-${d.logoSize}" src="${escHtml(url)}" alt="">`;
}

/**
 * The inside of the paper: the running header / footer lines, and the document inside a frame table
 * whose empty thead / tfoot reserve their room on every printed page.
 *
 * docHtml({kind: "report"|"journey"|"mileage", model, design, logo?, vehicleLine?, generatedOn?,
 *          routeHtml?, note?}) → string
 *  - model: printmodel.reportModel / journeyModel, or taxreport.mileageModel (for "mileage")
 *  - routeHtml: trusted SVG markup from lib/route.js svgRoute (journey only), or ""
 *  - generatedOn: the date text for the "Generated by TrueMile EV on …" line
 */
export function docHtml({ kind = "report", model, design, logo = null, vehicleLine = "", generatedOn = "", routeHtml = "", pageHint = false } = {}) {
  const d = parseDesign(design);
  const m = model || {};
  const s = d.sections;
  const title = d.title || m.heading || "TrueMile EV — Report";
  const logoTag = logoHtml(logo, d);
  const head = (lines) =>
    `<header class="print-head print-logo-at-${d.logoPos}">` +
    (logoTag ? `<div class="print-logobox">${logoTag}</div>` : "") +
    `<div class="print-headtext"><h1 class="print-h1">${escHtml(title)}</h1>` +
    (d.subtitle ? `<div class="print-subtitle">${escHtml(d.subtitle)}</div>` : "") +
    lines + `</div></header>`;

  let body = "";
  if (kind === "mileage") {
    const sec = (x, rowCells) => `<section class="print-block"><h2 class="print-h2">${escHtml(x.title)}</h2><p class="print-dim">${escHtml(x.note)}</p>` +
      table(x.cols.map((_, i) => (i === x.cols.length - 1 ? "num" : "date")), x.cols, x.rows.map(rowCells), d.zebra) +
      `<dl class="print-totals">${x.totals.map((t) => `<div class="${t.minor ? "print-minor" : ""}"><dt>${escHtml(t.label)}</dt><dd>${escHtml(t.value)}</dd></div>`).join("")}</dl>` +
      `</section>`;
    const logKeys = ["date", "num", "num"];
    body = `<p class="print-banner">${escHtml(m.banner)}</p>` +
      head(
        `<div class="print-line print-dim">${escHtml(m.subheading)}</div>` +
        `<div class="print-dateline"><span>Tax year ${escHtml(m.year)} · ${escHtml(m.period)}</span></div>` +
        `<div class="print-line"><span class="print-dim">Vehicle</span> <strong>${escHtml(m.vehicle || "—")}</strong></div>`) +
      `<div class="print-kpis">` +
      (m.kpis || []).map((k) => `<div class="print-kpi${k.highlight ? " print-hi" : ""}"><div class="print-kpi-l">${escHtml(k.label)}</div><div class="print-kpi-v">${escHtml(k.value)}</div></div>`).join("") +
      `</div>` +
      (m.waitingNote ? `<p class="print-dim">${escHtml(m.waitingNote)}</p>` : "") +
      `<section class="print-block"><h2 class="print-h2">${escHtml(m.logTitle)}</h2>` +
      ((m.dayRows || []).length
        ? table(logKeys, m.logCols, m.dayRows.map((r) => [r.date, String(r.trips), r.distance]), d.zebra)
        : `<p class="print-dim">${escHtml(m.emptyText)}</p>`) +
      (m.businessTotal ? `<dl class="print-totals"><div><dt>${escHtml(m.businessTotal.label)}</dt><dd>${escHtml(m.businessTotal.value)}</dd></div></dl>` : "") +
      `</section>` +
      (m.others ? sec(m.others, (r) => [r.date, r.car, r.type, r.distance]) : "") +
      (m.waiting ? sec(m.waiting, (r) => [r.date, String(r.trips), r.type, r.distance]) : "") +
      `<p class="print-foot">${escHtml(m.footer)}</p>`;
  } else {
    const vLine = s.vehicleLine ? vehicleLine : "";
    body = head(
      `<div class="print-dateline"><span>${escHtml(m.dateLine)}</span>${m.title ? `<strong class="print-title">${escHtml(m.title)}</strong>` : ""}</div>` +
      (m.typesLine ? `<div class="print-line">${escHtml(m.typesLine)}</div>` : "") +
      (vLine ? `<div class="print-line print-dim">${escHtml(vLine)}</div>` : "") +
      (s.vehicleLine && m.subtitle && m.subtitle !== vLine ? `<div class="print-line print-dim">${escHtml(m.subtitle)}</div>` : ""));
    if (m.empty) {
      body += `<p class="print-empty">Nothing to export in this date range</p>`;
    } else {
      const shown = m.shown || { summary: true, trips: true, notes: true, charges: true };
      if (shown.summary && (m.summary || []).length) {
        body += `<section class="print-block"><h2 class="print-h2">Summary</h2><dl class="print-summary">` +
          m.summary.map((x) => `<div class="print-kv"><dt>${escHtml(x.label)}</dt><dd>${escHtml(x.value)}</dd></div>`).join("") +
          `</dl></section>`;
      }
      if (kind === "journey" && s.route && routeHtml) body += `<section class="print-block print-route"><h2 class="print-h2">Route</h2>${routeHtml}</section>`;
      if (shown.trips && m.tripCount) {
        const keys = m.tripKeys || [];
        body += `<section class="print-block"><h2 class="print-h2">Trips (${escHtml(m.tripCount)})</h2>` +
          `<div class="print-scroll">${table(keys, m.tripCols, m.tripRows.map((r) => r.cells), d.zebra)}</div>` +
          ((m.reconLines || []).length ? `<p class="print-foot">${m.reconLines.map(escHtml).join("<br>")}</p>` : "") +
          `</section>`;
      }
      if (shown.notes && (m.notes || []).length) {
        body += `<section class="print-block"><h2 class="print-h2">Notes</h2><dl class="print-notes">` +
          m.notes.map((n) => `<div class="print-note"><dt>${escHtml(n.date)}</dt><dd>${escHtml(n.body)}</dd></div>`).join("") +
          `</dl></section>`;
      }
      if (shown.charges && m.chargeCount) {
        const keys = m.chargeKeys || [];
        body += `<section class="print-block"><h2 class="print-h2">Charges (${escHtml(m.chargeCount)})</h2>` +
          `<div class="print-scroll">${table(keys, m.chargeCols, m.chargeRows.map((r) => r.cells), d.zebra)}</div></section>`;
      }
    }
  }
  if (d.footnote) body += `<div class="print-footnote">${escHtml(d.footnote)}</div>`;
  if (s.generatedLine && generatedOn) body += `<p class="print-generated">Generated by TrueMile EV on ${escHtml(generatedOn)}</p>`;

  const hasHead = !!d.header, hasFoot = !!d.footer;
  return (hasHead ? `<div class="print-runhead">${escHtml(d.header)}</div>` : "") +
    `<table class="print-frame" role="presentation">` +
    (hasHead ? `<thead><tr><td><div class="print-runspace"></div></td></tr></thead>` : "") +
    (hasFoot ? `<tfoot><tr><td><div class="print-runspace"></div></td></tr></tfoot>` : "") +
    `<tbody><tr><td><article class="print-doc">${body}</article></td></tr></tbody></table>` +
    (d.footer || (pageHint && d.pageNumbers)
      ? `<div class="print-runfoot"><span class="print-runfoot-text">${escHtml(d.footer)}</span>` +
        (pageHint && d.pageNumbers ? `<span class="print-pagehint">Page 1 of …</span>` : "") + `</div>`
      : "");
}

/** The paper's class list for a design (template, font, zebra). */
export function paperClass(d) {
  const x = parseDesign(d);
  return `print-paper print-tpl-${x.template} print-font-${x.font}`;
}
