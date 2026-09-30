// TrueMile EV web | lib/svgchart.js | pure SVG string builders (no DOM, no library).
// Every builder returns one self-contained <svg> string: viewBox-based, width 100%, role="img" with a
// <title>, colours as CSS variables (the caller passes series colours such as "var(--m-efficiency)").
// Tooltips are plain <title> elements per point or bar (no script). Nulls in a series break its line;
// nothing is ever zero-filled. API frozen in SPEC 7.1; optional extras are marked "extension".
import { fixed, dateFmt } from "./format.js";

export const BUILD = "2026-09-30.1";

const FONT = 11;                 // px in viewBox units
const CHAR_W = FONT * 0.6;       // rough width of one glyph (system sans), for layout only
const INK = "var(--ink)";
const MUTED = "var(--muted)";
const LINE = "var(--line)";
const NS = "http://www.w3.org/2000/svg";
const MAX_HITS = 400;            // tooltip targets per series; more points are sampled

// ── small helpers ─────────────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function c1(v) { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? 0 : r; }
function defaultZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** Decimals a tick list needs so every tick prints exactly (0..4). */
function tickDecimals(ticks) {
  for (let d = 0; d <= 4; d++) {
    if (ticks.every((t) => Math.abs(Number(t.toFixed(d)) - t) < 1e-9)) return d;
  }
  return 4;
}

/** Tooltip / table number: 0 decimals from 100, 1 from 10, else 2 (or the series' own). */
function valueText(v, decimals) {
  if (!isNum(v)) return "—";
  const d = isNum(decimals) ? decimals : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return fixed(v, d);
}
function withUnit(text, unit) {
  if (!unit) return text;
  if (unit === "$") return text.startsWith("-") ? "-$" + text.slice(1) : "$" + text;
  if (unit === "%") return text + "%";
  return text + " " + unit;
}

function niceNum(x, round) {
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

/**
 * "Nice" round tick values covering [min, max]: the first tick is <= min, the last >= max, the step is
 * 1, 2 or 5 × 10^k, about `count` ticks. A flat range is widened (0 → [0, 1]). Never returns -0.
 */
export function niceTicks(min, max, count = 5) {
  if (!isNum(min) && !isNum(max)) return [0, 1];
  if (!isNum(min)) min = max;
  if (!isNum(max)) max = min;
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    if (min === 0) max = 1;
    else { const d = Math.abs(min) * 0.5; min -= d; max += d; }
  }
  const n = Math.max(2, Math.round(count) || 5);
  const range = niceNum(max - min, false);
  const step = niceNum(range / (n - 1), true);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const sd = Math.max(0, -Math.floor(Math.log10(step))) + 2;
  const out = [];
  for (let i = 0; ; i++) {
    let v = Number((lo + i * step).toFixed(sd));
    if (Object.is(v, -0)) v = 0;
    out.push(v);
    if (v >= hi - step * 1e-9 || i > 1000) break;
  }
  return out;
}

function svgOpen(W, H, title) {
  return `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}" ` +
    `preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;height:auto;font-size:${FONT}px;font-family:inherit">` +
    `<title>${esc(title)}</title>`;
}

function textEl(x, y, s, { anchor = "start", color = MUTED, size = FONT, weight = "" } = {}) {
  return `<text x="${c1(x)}" y="${c1(y)}" text-anchor="${anchor}" style="fill:${color};font-size:${size}px${weight ? ";font-weight:" + weight : ""}">${esc(s)}</text>`;
}

/** Legend row: swatch + label, wrapped onto more rows when needed. Returns {svg, height}. */
function legend(items, x0, x1, y0) {
  if (!items.length) return { svg: "", height: 0 };
  let x = x0, y = y0 + FONT, svg = "", rows = 1;
  for (const it of items) {
    const w = 18 + it.label.length * CHAR_W + 14;
    if (x > x0 && x + w > x1) { x = x0; y += FONT + 6; rows++; }
    const sw = it.kind === "line"
      ? `<line x1="${c1(x)}" y1="${c1(y - 4)}" x2="${c1(x + 12)}" y2="${c1(y - 4)}" style="stroke:${it.color};stroke-width:2.5${it.dashed ? ";stroke-dasharray:4 3" : ""}"/>`
      : `<rect x="${c1(x)}" y="${c1(y - 9)}" width="12" height="9" rx="2" style="fill:${it.color}${it.opacity ? ";fill-opacity:" + it.opacity : ""}"/>`;
    svg += sw + textEl(x + 17, y, it.label, { color: INK });
    x += w;
  }
  return { svg, height: rows * (FONT + 6) + 4 };
}

function labelWidth(labels) {
  return labels.reduce((m, s) => Math.max(m, String(s).length), 0) * CHAR_W;
}

function yAxis(ticks, scale, x, side, plot, decimals) {
  let svg = "";
  for (const t of ticks) {
    const y = scale(t);
    if (side === "left") {
      svg += `<line x1="${c1(plot.x0)}" y1="${c1(y)}" x2="${c1(plot.x1)}" y2="${c1(y)}" style="stroke:${LINE};stroke-width:1"/>`;
      svg += textEl(x - 6, y + FONT * 0.35, fixed(t, decimals), { anchor: "end" });
    } else {
      svg += textEl(x + 6, y + FONT * 0.35, fixed(t, decimals), { anchor: "start" });
    }
  }
  return svg;
}

function linearScale(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

function emptyNote(W, H, plot) {
  const cy = plot ? (plot.y0 + plot.y1) / 2 : H / 2;
  return textEl(W / 2, cy, "No data to plot", { anchor: "middle" });
}

function unitCaption(list) {
  const u = [...new Set(list.map((s) => s.unit).filter(Boolean))];
  return u.join(" · ");
}

// ── lineChart ─────────────────────────────────────────────────────────────────────────────────
/**
 * lineChart({width, height, title?, x:{label, values[], kind:"number"|"time", zone?, pattern?, decimals?},
 *            series:[{label, values[], color, axis:"left"|"right", unit, dashed?, decimals?}], yZero?})
 * Series on the same axis share one scale; at most the two axes. A null value (or a null x) breaks the
 * line; an isolated point is drawn as a dot. (title, x.pattern, decimals are extensions.)
 */
export function lineChart(o) {
  const W = o.width || 640, H = o.height || 260;
  const xv = (o.x && o.x.values) || [];
  const series = (o.series || []).map((s) => ({ ...s, values: s.values || [] }));
  const title = o.title || series.map((s) => s.label).join(", ") || "Chart";
  const leftS = series.filter((s) => s.axis !== "right");
  const rightS = series.filter((s) => s.axis === "right");
  const xs = xv.filter(isNum);
  const kind = (o.x && o.x.kind) || "number";
  const zone = (o.x && o.x.zone) || defaultZone();

  const ext = (list) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of list) s.values.forEach((v, i) => {
      if (isNum(v) && isNum(xv[i])) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    });
    if (lo === Infinity) return null;
    if (o.yZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    return [lo, hi];
  };
  const le = ext(leftS), re = ext(rightS);
  const lt = le ? niceTicks(le[0], le[1], 5) : leftS.length ? [0, 1] : null;
  const rt = re ? niceTicks(re[0], re[1], 5) : rightS.length ? [0, 1] : null;
  const ld = lt ? tickDecimals(lt) : 0, rd = rt ? tickDecimals(rt) : 0;

  const leg = legend(series.map((s) => ({ label: s.label, color: s.color, kind: "line", dashed: s.dashed })), 8, W - 8, 4);
  const top = 4 + leg.height + FONT + 8;
  const padL = lt ? Math.max(28, labelWidth(lt.map((t) => fixed(t, ld))) + 12) : 12;
  const padR = rt ? Math.max(28, labelWidth(rt.map((t) => fixed(t, rd))) + 12) : 14;
  const plot = { x0: padL, x1: W - padR, y0: top, y1: H - 34 };

  let svg = svgOpen(W, H, title) + leg.svg;
  if (!xs.length || (!le && !re)) {
    return svg + `<line x1="${c1(plot.x0)}" y1="${c1(plot.y1)}" x2="${c1(plot.x1)}" y2="${c1(plot.y1)}" style="stroke:${LINE}"/>` +
      emptyNote(W, H, plot) + "</svg>";
  }

  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  if (xmin === xmax) { xmin -= kind === "time" ? 43_200_000 : 0.5; xmax += kind === "time" ? 43_200_000 : 0.5; }
  const sx = linearScale(xmin, xmax, plot.x0, plot.x1);
  const syL = lt ? linearScale(lt[0], lt[lt.length - 1], plot.y1, plot.y0) : null;
  const syR = rt ? linearScale(rt[0], rt[rt.length - 1], plot.y1, plot.y0) : null;

  // axes + grid
  if (lt) svg += yAxis(lt, syL, plot.x0, "left", plot, ld);
  if (rt) {
    if (!lt) for (const t of rt) svg += `<line x1="${c1(plot.x0)}" y1="${c1(syR(t))}" x2="${c1(plot.x1)}" y2="${c1(syR(t))}" style="stroke:${LINE};stroke-width:1"/>`;
    svg += yAxis(rt, syR, plot.x1, "right", plot, rd);
  }
  if (leftS.length) svg += textEl(plot.x0 - 6, top - 6, unitCaption(leftS), { anchor: "start" });
  if (rightS.length) svg += textEl(plot.x1 + 6, top - 6, unitCaption(rightS), { anchor: "end" });

  // x ticks
  const maxTicks = Math.max(2, Math.floor((plot.x1 - plot.x0) / 72));
  let xTicks, xLabel;
  if (kind === "time") {
    const uniq = [...new Set(xs)].sort((a, b) => a - b);
    const step = Math.max(1, Math.ceil(uniq.length / maxTicks));
    xTicks = uniq.filter((_, i) => i % step === 0);
    const span = xmax - xmin;
    const pattern = o.x.pattern || (span > 3 * 365 * 864e5 ? "yyyy" : span > 75 * 864e5 ? "MMM yyyy" : span > 2 * 864e5 ? "MMM d" : "h:mm a");
    xLabel = (t) => dateFmt(t, pattern, zone);
  } else {
    xTicks = niceTicks(xmin, xmax, maxTicks).filter((t) => t >= xmin - 1e-9 && t <= xmax + 1e-9);
    const xd = isNum(o.x.decimals) ? o.x.decimals : tickDecimals(xTicks);
    xLabel = (t) => fixed(t, xd);
  }
  svg += `<line x1="${c1(plot.x0)}" y1="${c1(plot.y1)}" x2="${c1(plot.x1)}" y2="${c1(plot.y1)}" style="stroke:${MUTED};stroke-width:1"/>`;
  for (const t of xTicks) {
    const x = sx(t);
    svg += `<line x1="${c1(x)}" y1="${c1(plot.y1)}" x2="${c1(x)}" y2="${c1(plot.y1 + 4)}" style="stroke:${MUTED}"/>`;
    svg += textEl(x, plot.y1 + FONT + 5, xLabel(t), { anchor: "middle" });
  }
  if (o.x.label) svg += textEl((plot.x0 + plot.x1) / 2, H - 4, o.x.label, { anchor: "middle" });

  // lines
  for (const s of series) {
    const sy = s.axis === "right" ? syR : syL;
    let d = "", pen = false, run = 0;
    const dots = [];
    const pts = [];
    s.values.forEach((v, i) => {
      if (!isNum(v) || !isNum(xv[i])) {
        if (pen && run === 1) dots.push(pts[pts.length - 1]);
        pen = false; run = 0; return;
      }
      const p = [sx(xv[i]), sy(v), xv[i], v];
      d += (pen ? "L" : "M") + c1(p[0]) + " " + c1(p[1]);
      pen = true; run++;
      pts.push(p);
    });
    if (pen && run === 1) dots.push(pts[pts.length - 1]);
    const dash = s.dashed ? ";stroke-dasharray:6 4" : "";
    if (d) svg += `<path d="${d}" style="fill:none;stroke:${s.color};stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round${dash}"/>`;
    const showDots = pts.length <= 60;
    for (const p of showDots ? pts : dots) {
      svg += `<circle cx="${c1(p[0])}" cy="${c1(p[1])}" r="2.6" style="fill:${s.color}"/>`;
    }
    const every = Math.max(1, Math.ceil(pts.length / MAX_HITS));
    for (let i = 0; i < pts.length; i += every) {
      const p = pts[i];
      const tip = `${o.x.label ? o.x.label + " " : ""}${kind === "time" ? xLabel(p[2]) : valueText(p[2], o.x.decimals)} · ${s.label}: ${withUnit(valueText(p[3], s.decimals), s.unit)}`;
      svg += `<circle cx="${c1(p[0])}" cy="${c1(p[1])}" r="7" style="fill:transparent;stroke:none"><title>${esc(tip)}</title></circle>`;
    }
  }
  return svg + "</svg>";
}

// ── barChart ──────────────────────────────────────────────────────────────────────────────────
/**
 * barChart({width, height, title?, categories[], series:[{label, values[], color, tips?[]}], stacked?, unit,
 *           lines?:[{label, values[], color, unit, dashed?, decimals?}], decimals?})
 * Grouped bars side by side (stacked when asked); `lines` (extension) are drawn on a right axis, one
 * point per category, nulls breaking the line; `tips` (extension) replaces a bar's tooltip text.
 */
export function barChart(o) {
  const W = o.width || 640, H = o.height || 260;
  const cats = o.categories || [];
  const series = (o.series || []).map((s) => ({ ...s, values: s.values || [] }));
  const lines = (o.lines || []).map((s) => ({ ...s, values: s.values || [] }));
  const title = o.title || [...series, ...lines].map((s) => s.label).join(", ") || "Chart";
  const n = cats.length;

  let lo = 0, hi = 0, any = false;
  for (let i = 0; i < n; i++) {
    if (o.stacked) {
      let pos = 0, neg = 0;
      for (const s of series) { const v = s.values[i]; if (isNum(v)) { any = true; if (v >= 0) pos += v; else neg += v; } }
      hi = Math.max(hi, pos); lo = Math.min(lo, neg);
    } else {
      for (const s of series) { const v = s.values[i]; if (isNum(v)) { any = true; hi = Math.max(hi, v); lo = Math.min(lo, v); } }
    }
  }
  let rlo = Infinity, rhi = -Infinity;
  for (const s of lines) s.values.forEach((v) => { if (isNum(v)) { rlo = Math.min(rlo, v); rhi = Math.max(rhi, v); } });
  const hasR = rlo !== Infinity;
  const lt = niceTicks(lo, hi, 5), ld = tickDecimals(lt);
  const rt = hasR ? niceTicks(Math.min(0, rlo), Math.max(0, rhi), 5) : lines.length ? [0, 1] : null;
  const rd = rt ? tickDecimals(rt) : 0;

  const legItems = [
    ...series.map((s) => ({ label: s.label, color: s.color, kind: "bar" })),
    ...lines.map((s) => ({ label: s.label, color: s.color, kind: "line", dashed: s.dashed })),
  ];
  const leg = legend(legItems, 8, W - 8, 4);
  const top = 4 + leg.height + FONT + 8;
  const padL = Math.max(28, labelWidth(lt.map((t) => fixed(t, ld))) + 12);
  const padR = rt ? Math.max(28, labelWidth(rt.map((t) => fixed(t, rd))) + 12) : 14;
  const plot = { x0: padL, x1: W - padR, y0: top, y1: H - 34 };
  let svg = svgOpen(W, H, title) + leg.svg;
  if (!n || (!any && !hasR)) {
    return svg + `<line x1="${c1(plot.x0)}" y1="${c1(plot.y1)}" x2="${c1(plot.x1)}" y2="${c1(plot.y1)}" style="stroke:${LINE}"/>` +
      emptyNote(W, H, plot) + "</svg>";
  }
  const sy = linearScale(lt[0], lt[lt.length - 1], plot.y1, plot.y0);
  const syR = rt ? linearScale(rt[0], rt[rt.length - 1], plot.y1, plot.y0) : null;
  svg += yAxis(lt, sy, plot.x0, "left", plot, ld);
  if (rt) svg += yAxis(rt, syR, plot.x1, "right", plot, rd);
  if (o.unit) svg += textEl(plot.x0 - 6, top - 6, o.unit, { anchor: "start" });
  if (lines.length) svg += textEl(plot.x1 + 6, top - 6, unitCaption(lines), { anchor: "end" });

  const band = (plot.x1 - plot.x0) / n;
  const inner = band * 0.78;
  const bw = o.stacked || !series.length ? inner : inner / series.length;
  const y0 = sy(0);
  for (let i = 0; i < n; i++) {
    const bx = plot.x0 + band * i + (band - inner) / 2;
    let pos = 0, neg = 0;
    series.forEach((s, k) => {
      const v = s.values[i];
      if (!isNum(v)) return;
      let yTop, yBot, x;
      if (o.stacked) {
        x = bx;
        if (v >= 0) { yBot = sy(pos); pos += v; yTop = sy(pos); } else { yTop = sy(neg); neg += v; yBot = sy(neg); }
      } else {
        x = bx + bw * k;
        yTop = v >= 0 ? sy(v) : y0; yBot = v >= 0 ? y0 : sy(v);
      }
      const h = Math.max(0, yBot - yTop);
      const tip = (s.tips && s.tips[i]) || `${cats[i]} · ${s.label}: ${withUnit(valueText(v, o.decimals), o.unit)}`;
      svg += `<rect x="${c1(x + 0.5)}" y="${c1(yTop)}" width="${c1(Math.max(1, bw - 1))}" height="${c1(Math.max(h, v === 0 ? 0 : 0.8))}" rx="1.5" style="fill:${s.color}"><title>${esc(tip)}</title></rect>`;
    });
  }
  svg += `<line x1="${c1(plot.x0)}" y1="${c1(y0)}" x2="${c1(plot.x1)}" y2="${c1(y0)}" style="stroke:${MUTED};stroke-width:1"/>`;

  // category labels (every k-th so they never collide)
  const widest = labelWidth(cats) + 10;
  const every = Math.max(1, Math.ceil(widest / band));
  for (let i = 0; i < n; i += every) {
    svg += textEl(plot.x0 + band * (i + 0.5), plot.y1 + FONT + 5, String(cats[i]), { anchor: "middle" });
  }

  for (const s of lines) {
    let d = "", pen = false;
    const pts = [];
    s.values.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }
      const x = plot.x0 + band * (i + 0.5), y = syR(v);
      d += (pen ? "L" : "M") + c1(x) + " " + c1(y);
      pen = true; pts.push([x, y, i, v]);
    });
    const dash = s.dashed ? ";stroke-dasharray:6 4" : "";
    if (d) svg += `<path d="${d}" style="fill:none;stroke:${s.color};stroke-width:2.2;stroke-linejoin:round${dash}"/>`;
    for (const p of pts) {
      const tip = `${cats[p[2]]} · ${s.label}: ${withUnit(valueText(p[3], s.decimals), s.unit)}`;
      svg += `<circle cx="${c1(p[0])}" cy="${c1(p[1])}" r="${pts.length <= 60 ? 2.6 : 1.4}" style="fill:${s.color}"><title>${esc(tip)}</title></circle>`;
    }
  }
  return svg + "</svg>";
}

// ── bandChart ─────────────────────────────────────────────────────────────────────────────────
/**
 * bandChart({width, height, title?, x:{label, values[], decimals?}, median[], lo[], hi[], color, unit})
 * A median line over a shaded min–max band (the learned DC curve). A null breaks both.
 */
export function bandChart(o) {
  const W = o.width || 640, H = o.height || 260;
  const xv = (o.x && o.x.values) || [];
  const med = o.median || [], lo = o.lo || [], hi = o.hi || [];
  const title = o.title || "Median with range";
  const idx = xv.map((x, i) => i).filter((i) => isNum(xv[i]) && isNum(med[i]));
  let ymin = 0, ymax = 0;
  for (const i of idx) {
    ymin = Math.min(ymin, med[i], isNum(lo[i]) ? lo[i] : med[i]);
    ymax = Math.max(ymax, med[i], isNum(hi[i]) ? hi[i] : med[i]);
  }
  const yt = niceTicks(ymin, ymax, 5), yd = tickDecimals(yt);
  const leg = legend([
    { label: "Median", color: o.color, kind: "line" },
    { label: "Lowest – highest", color: o.color, kind: "bar", opacity: 0.22 },
  ], 8, W - 8, 4);
  const top = 4 + leg.height + FONT + 8;
  const padL = Math.max(28, labelWidth(yt.map((t) => fixed(t, yd))) + 12);
  const plot = { x0: padL, x1: W - 14, y0: top, y1: H - 34 };
  let svg = svgOpen(W, H, title) + leg.svg;
  if (!idx.length) return svg + emptyNote(W, H, plot) + "</svg>";
  const xs = idx.map((i) => xv[i]);
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  if (xmin === xmax) { xmin -= 0.5; xmax += 0.5; }
  const sx = linearScale(xmin, xmax, plot.x0, plot.x1);
  const sy = linearScale(yt[0], yt[yt.length - 1], plot.y1, plot.y0);
  svg += yAxis(yt, sy, plot.x0, "left", plot, yd);
  if (o.unit) svg += textEl(plot.x0 - 6, top - 6, o.unit, { anchor: "start" });

  // contiguous runs
  const runs = [];
  let cur = [];
  xv.forEach((x, i) => {
    if (isNum(x) && isNum(med[i])) cur.push(i);
    else if (cur.length) { runs.push(cur); cur = []; }
  });
  if (cur.length) runs.push(cur);
  for (const r of runs) {
    const up = r.map((i) => `${c1(sx(xv[i]))} ${c1(sy(isNum(hi[i]) ? hi[i] : med[i]))}`);
    const dn = r.slice().reverse().map((i) => `${c1(sx(xv[i]))} ${c1(sy(isNum(lo[i]) ? lo[i] : med[i]))}`);
    if (r.length > 1) svg += `<path d="M${up.join("L")}L${dn.join("L")}Z" style="fill:${o.color};fill-opacity:.22;stroke:none"/>`;
    const d = r.map((i, k) => (k ? "L" : "M") + c1(sx(xv[i])) + " " + c1(sy(med[i]))).join("");
    svg += `<path d="${d}" style="fill:none;stroke:${o.color};stroke-width:2.4;stroke-linejoin:round"/>`;
  }
  const xTicks = niceTicks(xmin, xmax, Math.max(2, Math.floor((plot.x1 - plot.x0) / 60)))
    .filter((t) => t >= xmin - 1e-9 && t <= xmax + 1e-9);
  const xd = isNum(o.x.decimals) ? o.x.decimals : tickDecimals(xTicks);
  svg += `<line x1="${c1(plot.x0)}" y1="${c1(plot.y1)}" x2="${c1(plot.x1)}" y2="${c1(plot.y1)}" style="stroke:${MUTED}"/>`;
  for (const t of xTicks) svg += textEl(sx(t), plot.y1 + FONT + 5, fixed(t, xd), { anchor: "middle" });
  if (o.x.label) svg += textEl((plot.x0 + plot.x1) / 2, H - 4, o.x.label, { anchor: "middle" });
  for (const i of idx) {
    const tip = `${o.x.label ? o.x.label + " " : ""}${valueText(xv[i], o.x.decimals)} · median ${withUnit(valueText(med[i]), o.unit)}` +
      (isNum(lo[i]) && isNum(hi[i]) ? ` (${valueText(lo[i])}–${valueText(hi[i])})` : "");
    svg += `<circle cx="${c1(sx(xv[i]))}" cy="${c1(sy(med[i]))}" r="3" style="fill:${o.color}"><title>${esc(tip)}</title></circle>`;
  }
  return svg + "</svg>";
}

// ── scatter ───────────────────────────────────────────────────────────────────────────────────
/** scatter({width, height, title?, points:[{x, y, r?, tip?}], xLabel, yLabel, color, xDecimals?, yDecimals?}) */
export function scatter(o) {
  const W = o.width || 640, H = o.height || 260;
  const pts = (o.points || []).filter((p) => p && isNum(p.x) && isNum(p.y));
  const title = o.title || `${o.yLabel || "y"} vs ${o.xLabel || "x"}`;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const yt = pts.length ? niceTicks(Math.min(0, ...ys), Math.max(...ys), 5) : [0, 1];
  const xt = pts.length ? niceTicks(Math.min(...xs), Math.max(...xs), 6) : [0, 1];
  const yd = tickDecimals(yt), xd = tickDecimals(xt);
  const top = FONT + 14;
  const padL = Math.max(28, labelWidth(yt.map((t) => fixed(t, yd))) + 12);
  const plot = { x0: padL, x1: W - 14, y0: top, y1: H - 34 };
  let svg = svgOpen(W, H, title);
  if (o.yLabel) svg += textEl(plot.x0 - 6, top - 8, o.yLabel, { anchor: "start" });
  if (!pts.length) return svg + emptyNote(W, H, plot) + "</svg>";
  const sx = linearScale(xt[0], xt[xt.length - 1], plot.x0, plot.x1);
  const sy = linearScale(yt[0], yt[yt.length - 1], plot.y1, plot.y0);
  svg += yAxis(yt, sy, plot.x0, "left", plot, yd);
  svg += `<line x1="${c1(plot.x0)}" y1="${c1(plot.y1)}" x2="${c1(plot.x1)}" y2="${c1(plot.y1)}" style="stroke:${MUTED}"/>`;
  for (const t of xt) svg += textEl(sx(t), plot.y1 + FONT + 5, fixed(t, xd), { anchor: "middle" });
  if (o.xLabel) svg += textEl((plot.x0 + plot.x1) / 2, H - 4, o.xLabel, { anchor: "middle" });
  for (const p of pts) {
    const tip = p.tip || `${o.xLabel || "x"} ${valueText(p.x, o.xDecimals)} · ${o.yLabel || "y"} ${valueText(p.y, o.yDecimals)}`;
    svg += `<circle cx="${c1(sx(p.x))}" cy="${c1(sy(p.y))}" r="${isNum(p.r) ? p.r : 3.5}" style="fill:${o.color};fill-opacity:.7"><title>${esc(tip)}</title></circle>`;
  }
  return svg + "</svg>";
}
