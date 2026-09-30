// TrueMile EV web: a drive's recorded route drawn as plain SVG. Pure, DOM-free.
//
// The polyline is "lat,lng,speed[,alt_m[,interp]]|…" (TripRenderCache.decode): a segment needs >= 3
// fields and a numeric lat + lng; speed and altitude default to 0 on absence or garbage; a 5th field
// "1" marks an interpolated point. Altitude 0 means none was logged. No map tiles, no place names:
// the route sits on a plain card with a scale bar and a north arrow.

import { dist, labels } from "./units.js";

export const BUILD = "2026-09-30.1";

export const R_MILES = 3958.7613;
export const METERS_TO_FEET = 3.28084;
const DEG_MI = (R_MILES * Math.PI) / 180;      // miles per degree of latitude

const NUM = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
const numOrNull = (s) => (s !== undefined && NUM.test(s) ? Number(s) : null);

/** Parses the cloud polyline. Bad segments are skipped; never throws. */
export function parsePolyline(s) {
  const out = [];
  if (typeof s !== "string" || !s.trim()) return out;
  for (const seg of s.split("|")) {
    const f = seg.split(",");
    if (f.length < 3) continue;
    const lat = numOrNull(f[0]);
    const lng = lat === null ? null : numOrNull(f[1]);
    if (lat === null || lng === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const mph = numOrNull(f[2]) ?? 0;
    const alt = f.length > 3 ? numOrNull(f[3]) ?? 0 : 0;
    const interp = f.length > 4 ? f[4].trim() === "1" : false;
    out.push({ lat, lng, mph, altM: alt !== 0 ? alt : null, interp });
  }
  return out;
}

/** Great-circle distance in miles (TripRenderMath.haversineMiles). */
export function haversineMi(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cumulativeMiles(points) {
  const out = new Array(points.length);
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) d += haversineMi(points[i - 1], points[i]);
    out[i] = d;
  }
  return out;
}

function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker down to at most [maxPoints], in a local equirectangular projection. Each point
 * gets the deviation at which RDP would keep it; the first, the last and every interpolation boundary
 * are always kept. Order is preserved.
 */
export function decimate(points, maxPoints = 1500) {
  const n = points.length;
  if (n <= maxPoints || n <= 2) return points.slice();
  let midLat = 0;
  for (const p of points) midLat += p.lat;
  midLat = (midLat / n) * Math.PI / 180;
  const k = Math.cos(midLat);
  const xy = points.map((p) => ({ x: p.lng * k, y: p.lat }));
  const sig = new Float64Array(n);
  sig[0] = Infinity; sig[n - 1] = Infinity;
  for (let i = 1; i < n - 1; i++) {
    if (points[i].interp !== points[i - 1].interp || points[i].interp !== points[i + 1].interp) sig[i] = Infinity;
  }
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(xy[i], xy[a], xy[b]);
      if (d > best) { best = d; bi = i; }
    }
    if (sig[bi] !== Infinity) sig[bi] = best;
    stack.push([a, bi], [bi, b]);
  }
  const forced = [];
  const ranked = [];
  for (let i = 0; i < n; i++) (sig[i] === Infinity ? forced : ranked).push(i);
  const room = Math.max(0, maxPoints - forced.length);
  ranked.sort((i, j) => sig[j] - sig[i] || i - j);
  const keep = new Uint8Array(n);
  for (const i of forced) keep[i] = 1;
  for (let r = 0; r < room && r < ranked.length; r++) keep[ranked[r]] = 1;
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Fits every route in [pointsList] into width × height with [pad] px margins (equirectangular,
 * x = lng · cos(midLat), north up). -> {toXY(p) -> {x, y}, scaleMiPerPx}.
 */
export function project(pointsList, width, height, pad = 16) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const pts of pointsList) for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
  }
  if (!Number.isFinite(minLat)) { minLat = maxLat = 0; minLng = maxLng = 0; }
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) || 1e-6;
  // A single point (or a hop of a few metres) still gets a sensible ~0.05 mi frame.
  const minSpan = 0.05 / DEG_MI;
  let spanX = (maxLng - minLng) * k, spanY = maxLat - minLat;
  const cx = ((minLng + maxLng) / 2) * k, cy = (minLat + maxLat) / 2;
  spanX = Math.max(spanX, minSpan); spanY = Math.max(spanY, minSpan);
  const availW = Math.max(1, width - 2 * pad), availH = Math.max(1, height - 2 * pad);
  const s = Math.min(availW / spanX, availH / spanY);        // px per projected degree
  const toXY = (p) => ({ x: width / 2 + (p.lng * k - cx) * s, y: height / 2 - (p.lat - cy) * s });
  return { toXY, scaleMiPerPx: DEG_MI / s };
}

const r1 = (v) => Math.round(v * 10) / 10;

/** A round scale-bar length in the display unit, about a quarter of the frame. */
export function niceScale(unitsPerPx, targetPx) {
  const target = unitsPerPx * targetPx;
  if (!(target > 0) || !Number.isFinite(target)) return 1;
  const exp = Math.floor(Math.log10(target));
  const base = Math.pow(10, exp);
  const f = target / base;
  const nf = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return Number((nf * base).toPrecision(6));
}

function pathFor(pts, toXY) {
  let d = "";
  pts.forEach((p, i) => { const q = toXY(p); d += (i ? "L" : "M") + r1(q.x) + " " + r1(q.y); });
  return d;
}

/**
 * svgRoute(routes, {width, height, units, colors?, title?}) -> SVG string. [routes] = array of point
 * arrays; [colors] (one per route) defaults to the cyan token. Interpolated stretches are dashed.
 */
export function svgRoute(routes, { width = 640, height = 400, units = "imperial", colors = null, title = "Recorded route" } = {}) {
  const W = width, H = height;
  const drawn = routes.filter((r) => r && r.length);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}" ` +
    `preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;height:auto">` +
    `<title>${esc(title)}</title>` +
    `<rect x="0" y="0" width="${W}" height="${H}" rx="12" style="fill:var(--card2)"/>`;
  if (!drawn.length) return svg + "</svg>";
  const { toXY, scaleMiPerPx } = project(drawn, W, H, 28);
  routes.forEach((pts, ri) => {
    if (!pts || !pts.length) return;
    const color = (colors && colors[ri]) || "var(--cyan)";
    // Runs of solid / dashed segments; a segment touching an interpolated point is dashed.
    let run = [pts[0]], dashed = null;
    const flush = () => {
      if (run.length > 1) {
        svg += `<path d="${pathFor(run, toXY)}" style="fill:none;stroke:${color};stroke-width:3;stroke-linejoin:round;stroke-linecap:round` +
          (dashed ? ";stroke-dasharray:6 6;opacity:.8" : "") + `"/>`;
      }
    };
    for (let i = 1; i < pts.length; i++) {
      const segDashed = !!(pts[i - 1].interp || pts[i].interp);
      if (dashed === null) dashed = segDashed;
      if (segDashed !== dashed) { flush(); run = [pts[i - 1]]; dashed = segDashed; }
      run.push(pts[i]);
    }
    flush();
  });
  // Start and end dots: the first route's start and the last route's end (a journey reads end to end).
  const first = drawn[0][0], lastR = drawn[drawn.length - 1], last = lastR[lastR.length - 1];
  const a = toXY(first), b = toXY(last);
  svg += `<circle cx="${r1(a.x)}" cy="${r1(a.y)}" r="7" style="fill:var(--green);stroke:var(--card);stroke-width:2"><title>Start</title></circle>`;
  svg += `<circle cx="${r1(b.x)}" cy="${r1(b.y)}" r="7" style="fill:var(--red);stroke:var(--card);stroke-width:2"><title>End</title></circle>`;
  // Scale bar (bottom left) in the viewer's unit.
  const unitsPerPx = dist(scaleMiPerPx, units);
  const len = niceScale(unitsPerPx, W / 4);
  const px = len / unitsPerPx;
  const x0 = 16, y0 = H - 18;
  const lbl = `${len >= 1 ? len : Number(len.toPrecision(2))} ${labels(units).dist}`;
  svg += `<path d="M${x0} ${y0 - 5}V${y0}H${r1(x0 + px)}V${y0 - 5}" style="fill:none;stroke:var(--ink);stroke-width:1.5"/>` +
    `<text x="${x0}" y="${y0 - 9}" style="fill:var(--muted);font-size:15px">${esc(lbl)}</text>`;
  // North arrow (top right).
  const nx = W - 22, ny = 16;
  svg += `<path d="M${nx} ${ny}l6 16l-6 -4l-6 4z" style="fill:var(--ink)"/>` +
    `<text x="${nx}" y="${ny + 30}" text-anchor="middle" style="fill:var(--muted);font-size:14px">N</text>`;
  return svg + "</svg>";
}

/**
 * Elevation from LOGGED altitude only: first and last logged points, plus climb and descent.
 * -> {startToEndFt: number|null, gainFt, lossFt}. Null when no altitude was logged.
 */
export function elevationGainFt(points) {
  const alts = points.filter((p) => p.altM !== null && p.altM !== undefined).map((p) => p.altM * METERS_TO_FEET);
  if (!alts.length) return { startToEndFt: null, gainFt: 0, lossFt: 0 };
  let gain = 0, loss = 0;
  for (let i = 1; i < alts.length; i++) {
    const d = alts[i] - alts[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  return { startToEndFt: alts[alts.length - 1] - alts[0], gainFt: gain, lossFt: loss };
}

/** TripRenderMath.speedToMiPerKwh: the speed-based model (an estimate, never a measurement). */
export function speedToMiPerKwh(mph) {
  if (mph <= 5) return 1.8;
  if (mph <= 20) return 2.6;
  if (mph <= 35) return 3.2;
  if (mph <= 50) return 3.0;
  if (mph <= 65) return 2.4;
  if (mph <= 75) return 1.9;
  return 1.5;
}

/** Even index sample (always keeps the last point) for chart series. */
function sampleIdx(n, max) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = [];
  const step = (n - 1) / (max - 1);
  for (let k = 0; k < max; k++) out.push(Math.round(k * step));
  return [...new Set(out)];
}

/** {x: cumulative miles[], y: mph[]} */
export function speedSeries(points, max = 600) {
  const cum = cumulativeMiles(points);
  const idx = sampleIdx(points.length, max);
  return { x: idx.map((i) => cum[i]), y: idx.map((i) => points[i].mph) };
}

/** {x: cumulative miles[], y: feet[] (null where no altitude was logged)} */
export function elevationSeries(points, max = 600) {
  const cum = cumulativeMiles(points);
  const idx = sampleIdx(points.length, max);
  return { x: idx.map((i) => cum[i]), y: idx.map((i) => (points[i].altM == null ? null : points[i].altM * METERS_TO_FEET)) };
}

/** {x: cumulative miles[], y: modelled mi/kWh[]} */
export function modelEffSeries(points, max = 600) {
  const cum = cumulativeMiles(points);
  const idx = sampleIdx(points.length, max);
  return { x: idx.map((i) => cum[i]), y: idx.map((i) => speedToMiPerKwh(points[i].mph)) };
}

/** Mean speed over points with speed > 0 (TripRenderCache: stopped points don't drag it down). */
export function movingAvgMph(points) {
  let s = 0, n = 0;
  for (const p of points) if (p.mph > 0) { s += p.mph; n++; }
  return n ? s / n : 0;
}
