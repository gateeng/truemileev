// TrueMile EV web: what the screen maps draw, as plain GeoJSON. Pure, DOM-free.
//
// The basemap is OpenFreeMap (the same two styles the app uses, ui/map/MapTheme.kt); only
// views/mapview.js ever talks to MapLibre. Everything here is data: the style URLs, the app's route and
// pin colours (MapScreen.kt, MapTheme.kt), the speed / efficiency bucket runs of addSpeedRouteLayer
// (MapScreen.kt:3929), journey legs, pins and bounds. Coordinates are GeoJSON order [lng, lat] and plain
// JS numbers, never locale strings. Nothing built here is ever printed or exported.

import { speedToMiPerKwh } from "./route.js";

export const BUILD = "2026-10-01.1";

/** The app's day and night styles. Always the style URL, never a dated tile URL (it changes weekly). */
export const STYLE_URL = Object.freeze({
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
});

/** The basemap for a resolved theme ("dark" → dark, anything else → liberty). */
export function styleUrl(theme) {
  return theme === "dark" ? STYLE_URL.dark : STYLE_URL.light;
}

/** Every request the basemap makes starts here (style, TileJSON, tiles, sprites, glyphs). */
export const TILE_PREFIX = "https://tiles.openfreemap.org/";

/** Where a request to a host the basemap may not reach is sent instead: an empty reply, never the network. */
export const BLOCKED_URL = "data:,";

const warned = new Set();
const pageOrigin = () => { try { return globalThis.location && globalThis.location.origin ? String(globalThis.location.origin) : ""; } catch (_) { return ""; } };

/**
 * True for a same-origin, relative, data: or blob: URL (none of them leaves the page's own host). A
 * relative URL is resolved the way the browser would ("//x", "/\x" and tab tricks become other hosts),
 * against [origin]. With no page origin (only outside a browser) the tile host stands in, so a relative
 * URL still has to stay on one host.
 */
function isLocal(u, origin) {
  if (/^(data|blob):/i.test(u)) return true;
  const base = origin && origin !== "null" ? origin : new URL(TILE_PREFIX).origin;
  try { return new URL(u, base + "/").origin === base; } catch (_) { return false; }
}

/**
 * MapLibre's transformRequest, and the ALLOW-LIST for every basemap request (style, TileJSON, tiles,
 * sprites, glyphs): the tile host (sent without a Referer), or this page's own origin / data: / blob:.
 * Anything else is rewritten to BLOCKED_URL and logged once per host. This is the enforcement, not the
 * page CSP: MapLibre builds each tile request here on the main thread but fetches it in its worker, and
 * a same-origin worker does not inherit a <meta> CSP — so a TileJSON pointing elsewhere would otherwise
 * send the viewed map area to that host. [origin] defaults to the page's.
 */
export function tileRequest(url, origin = pageOrigin()) {
  const u = String(url ?? "");
  if (u.startsWith(TILE_PREFIX)) return { url: u, referrerPolicy: "no-referrer" };
  if (isLocal(u, origin)) return { url: u };
  let host = "";
  try { host = new URL(u).host; } catch (_) { host = u.slice(0, 60); }
  if (!warned.has(host)) {
    warned.add(host);
    try { console.warn(`map: a request to ${host || "an unknown host"} was blocked (only ${TILE_PREFIX} is allowed)`); } catch (_) { /* no console */ }
  }
  return { url: BLOCKED_URL };
}

const HEX6 = /^#[0-9a-f]{6}$/i;
export const DEFAULT_BLANK_BG = "#0B111E";

/** A tile-less style (demo "&notiles"): one background layer. [bg] must be #rrggbb, else the dark page colour. */
export function blankStyle(bg) {
  const color = typeof bg === "string" && HEX6.test(bg.trim()) ? bg.trim() : DEFAULT_BLANK_BG;
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": color } }] };
}

// ── the app's colours (MapScreen.kt / MapTheme.kt) ──────────────────────────────────────────────

/** Map ▸ Trips, one trip: blue → cyan on dark tiles, deep → bright blue on light ones. */
export const SINGLE_TRIP_RAMP = Object.freeze({ dark: ["#0A4FA8", "#00E5FF"], light: ["#1E40AF", "#3B82F6"] });
/** MapRouteRamp.efficiency (trip detail): dim → neon green; dark themes lift only the dim end. */
export const EFF_RAMP = Object.freeze({ light: ["#1B7A3D", "#39FF14"], dark: ["#2FBF6B", "#39FF14"] });
/** MapRouteRamp.speed (trip detail): dim → electric cyan. */
export const SPEED_RAMP = Object.freeze({ light: ["#0A4FA8", "#00E5FF"], dark: ["#4E9BE8", "#00E5FF"] });
/** ALL_DAY_ROUTE_PALETTE: one speed ramp per trip, cycling (blue, green, orange, purple, amber, pink). */
export const ALL_DAY_ROUTE_PALETTE = Object.freeze([
  ["#0A4FA8", "#00E5FF"],
  ["#166534", "#4ADE80"],
  ["#9A3412", "#FB923C"],
  ["#6B21A8", "#D8B4FE"],
  ["#A16207", "#FDE047"],
  ["#BE185D", "#F9A8D4"],
]);
/** Journey overview: one flat colour per leg, cycling. */
export const JOURNEY_LEG_COLORS = Object.freeze([
  "#00E5FF", "#00E676", "#FF6D00", "#FFD600", "#E040FB", "#FF5252", "#7C4DFF", "#1DE9B6",
]);
/** The user's own charge-location pin: dark disc, cyan ring; home gets the Board-green ring. */
export const PIN = Object.freeze({ disc: "#1A2336", ring: "#00E5FF", home: "#00E676" });
/** Line widths (casing / line) the app uses per map. */
export const WIDTHS = Object.freeze({
  trip: Object.freeze({ casing: 9, line: 6 }),
  period: Object.freeze({ casing: 7, line: 5 }),
  journey: Object.freeze({ casing: 10, line: 7 }),
});
export const ROUTE_BUCKETS = 16;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const hx = (n) => n.toString(16).toUpperCase().padStart(2, "0");

/** Linear blend of two "#rrggbb" colours at t (clamped to 0..1) → "#RRGGBB". A bad input counts as black. */
export function lerpHex(a, b, t) {
  const p = (s) => {
    const v = typeof s === "string" && HEX6.test(s) ? s : "#000000";
    return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const x = p(a), y = p(b), k = clamp01(Number(t) || 0);
  return "#" + x.map((c, i) => hx(Math.min(255, Math.max(0, Math.round(c + (y[i] - c) * k))))).join("");
}

const theme2 = (theme) => (theme === "dark" ? "dark" : "light");
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** A coordinate as a number; null, undefined, "" and junk are NaN (never a silent 0). */
const coord1 = (v) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? NaN : Number(v));
const okLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** The ramp a trip-detail route uses: SPEED_RAMP or EFF_RAMP for the theme. */
export function rampFor(by, theme) {
  return (by === "eff" ? EFF_RAMP : SPEED_RAMP)[theme2(theme)];
}

/**
 * routeFeatures(points, {by, values, theme, buckets, ramp, props}) → FeatureCollection.
 * [points] = route.parsePolyline (+ decimate) output. The value per point is [values][i] when given,
 * else the speed (by "speed") or the speed model's mi/kWh (by "eff"). Values are quantised into
 * [buckets] steps between this route's own min and max, the app's way
 * (trunc((v − lo) / span · (buckets − 1))); each run of equal buckets is one LineString that also
 * carries the next run's first point, so the coloured pieces join with no gap. A segment touching an
 * interpolated point is interp; interp changes split runs too, so dashed stretches are their own
 * features. Properties {stroke, interp, ...props}. Empty for fewer than two points.
 * The collection also carries a foreign member legend = {min, max, from, to} (MapLibre ignores it).
 */
export function routeFeatures(points, { by = "speed", values = null, theme = "dark", buckets = ROUTE_BUCKETS, ramp = null, props = {} } = {}) {
  const pts = (points || []).filter((p) => p && okLatLng(coord1(p.lat), coord1(p.lng)));
  const [from, to] = Array.isArray(ramp) && ramp.length === 2 ? ramp : rampFor(by, theme);
  const fc = { type: "FeatureCollection", features: [] };
  if (pts.length < 2) { fc.legend = { min: null, max: null, from, to }; return fc; }
  const n = Math.max(2, Math.trunc(Number(buckets)) || ROUTE_BUCKETS);
  const vals = pts.map((p, i) => {
    const given = values && Number.isFinite(coord1(values[i])) ? Number(values[i]) : null;
    if (given !== null) return given;
    const mph = Number(p.mph) || 0;
    return by === "eff" ? speedToMiPerKwh(mph) : mph;
  });
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(hi - lo, 1e-6);
  const bucketOf = (i) => Math.min(n - 1, Math.max(0, Math.trunc(((vals[i] - lo) / span) * (n - 1))));
  const segInterp = (i) => !!(pts[i].interp || pts[i + 1].interp);
  const coord = (p) => [r6(coord1(p.lng)), r6(coord1(p.lat))];
  let i = 0;
  while (i < pts.length - 1) {
    const b = bucketOf(i), d = segInterp(i);
    let j = i + 1;
    while (j < pts.length - 1 && bucketOf(j) === b && segInterp(j) === d) j++;
    // Segments i..j-1 share (bucket, interp); the LineString runs to point j, the next run's first point.
    const coords = [];
    for (let k = i; k <= j; k++) coords.push(coord(pts[k]));
    fc.features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { ...props, stroke: lerpHex(from, to, b / (n - 1)), interp: d },
    });
    i = j;
  }
  fc.legend = { min: lo, max: hi, from, to };
  return fc;
}

/**
 * Several trips on one map (the period routes): trip k is drawn by speed with
 * ALL_DAY_ROUTE_PALETTE[k % 6]. [routes] = [{tripId, points}] → one FeatureCollection whose features
 * carry {tripId, stroke, interp}.
 */
export function periodRouteFeatures(routes, { buckets = ROUTE_BUCKETS } = {}) {
  const out = { type: "FeatureCollection", features: [] };
  (routes || []).forEach((r, k) => {
    const fc = routeFeatures(r && r.points, {
      by: "speed", buckets, ramp: ALL_DAY_ROUTE_PALETTE[k % ALL_DAY_ROUTE_PALETTE.length], props: { tripId: String(r && r.tripId || "") },
    });
    out.features.push(...fc.features);
  });
  return out;
}

/**
 * legFeatures(pointLists, colors) → one LineString per leg in a flat colour: leg i gets
 * colors[i % colors.length] (JOURNEY_LEG_COLORS by default). An item is a point array or
 * {tripId, points}. Legs with fewer than two points are skipped (their colour slot is kept, so leg
 * colours follow the journey's order). Properties {stroke, tripId, interp:false}.
 */
export function legFeatures(pointLists, colors = JOURNEY_LEG_COLORS) {
  const pal = Array.isArray(colors) && colors.length ? colors : JOURNEY_LEG_COLORS;
  const out = { type: "FeatureCollection", features: [] };
  (pointLists || []).forEach((item, i) => {
    const pts = (Array.isArray(item) ? item : (item && item.points) || [])
      .filter((p) => p && okLatLng(coord1(p.lat), coord1(p.lng)));
    if (pts.length < 2) return;
    out.features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: pts.map((p) => [r6(coord1(p.lng)), r6(coord1(p.lat))]) },
      properties: { stroke: pal[i % pal.length], tripId: Array.isArray(item) ? "" : String(item.tripId ?? ""), interp: false },
    });
  });
  return out;
}

/**
 * pointFeatures(items) → Point FeatureCollection. items = [{lat, lng, ...props}]; the coordinates go
 * out as [lng, lat] rounded to 6 decimals and every other key becomes a property. Items without a
 * valid position are skipped.
 */
export function pointFeatures(items) {
  const out = { type: "FeatureCollection", features: [] };
  for (const it of items || []) {
    if (!it) continue;
    const lat = coord1(it.lat), lng = coord1(it.lng);
    if (!okLatLng(lat, lng)) continue;
    const { lat: _a, lng: _b, ...props } = it;
    out.features.push({ type: "Feature", geometry: { type: "Point", coordinates: [r6(lng), r6(lat)] }, properties: props });
  }
  return out;
}

/** Every [lng, lat] of the given FeatureCollections (Point, LineString, MultiLineString). */
export function coordsOf(...collections) {
  const out = [];
  for (const fc of collections) {
    for (const f of (fc && fc.features) || []) {
      const g = f && f.geometry;
      if (!g) continue;
      if (g.type === "Point") out.push(g.coordinates);
      else if (g.type === "LineString") out.push(...g.coordinates);
      else if (g.type === "MultiLineString") for (const l of g.coordinates) out.push(...l);
    }
  }
  return out;
}

export const SINGLE_POINT_PAD = 0.005;

/**
 * boundsOf(coords) → [[minLng, minLat], [maxLng, maxLat]] or null. A coordinate is [lng, lat] or
 * {lat, lng}; invalid ones are skipped. A single location is padded ±0.005° so a fit has an area.
 */
export function boundsOf(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords || []) {
    if (!c) continue;
    const lng = coord1(Array.isArray(c) ? c[0] : c.lng);
    const lat = coord1(Array.isArray(c) ? c[1] : c.lat);
    if (!okLatLng(lat, lng)) continue;
    if (lng < w) w = lng; if (lng > e) e = lng;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  if (!Number.isFinite(w)) return null;
  if (w === e && s === n) {
    const p = SINGLE_POINT_PAD;
    return [[r6(w - p), r6(s - p)], [r6(e + p), r6(n + p)]];
  }
  return [[w, s], [e, n]];
}

/** The start and end markers of a drawn route: [{lngLat, kind:"start"|"end"}] (none below two points). */
export function endMarkers(points) {
  const pts = (points || []).filter((p) => p && okLatLng(coord1(p.lat), coord1(p.lng)));
  if (pts.length < 2) return [];
  const a = pts[0], b = pts[pts.length - 1];
  return [
    { lngLat: [r6(Number(a.lng)), r6(Number(a.lat))], kind: "start" },
    { lngLat: [r6(Number(b.lng)), r6(Number(b.lat))], kind: "end" },
  ];
}
