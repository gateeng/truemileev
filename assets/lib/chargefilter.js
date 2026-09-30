// TrueMile EV web: the Charge section's filters and its charge-location pins. Pure, DOM-free.
//
// Filters (the Filter sheet and the route query): network (a set of finance.networkKey values), speed
// (fast = a DC session by rows.isDc, where a declared charger type wins; Home is never fast), kind (Home /
// public), source (confirmed / unconfirmed), a text search, and a map cluster ("at").
// Pins: the app's greedy clustering (MapScreen.kt clusterLocations): newest first, a session joins the
// first cluster within 165 ft of that cluster's first session AND network-compatible (a blank network
// is a wildcard, else the same network ignoring case, StationBook.networksCompatible), so a Tesla stall
// and an Electrify America stall in one plaza stay two pins. Coordinates stay on screen: nothing here
// feeds a CSV or a printed page.

import { stateFromQuery, queryFromState, RANGES, DEFAULT_RANGE } from "./periods.js";
import { isDc, isHome } from "./rows.js";
import { parseGps, haversineMiles } from "./stops.js";
import { dateFmt } from "./format.js";
import { parts } from "./tz.js";
import { networkKey, networkFold, networkLabel } from "./finance.js";
import { pointFeatures, PIN } from "./mapdata.js";

export const BUILD = "2026-09-30.1";

export const SPEEDS = ["fast", "slow"];
export const KINDS = ["home", "public"];
export const SOURCES = ["confirmed", "unconfirmed"];
export const VIEWS = ["grouped", "table"];
export const SPEED_LABELS = { fast: "Fast (DC)", slow: "Slow (AC and home)" };
export const KIND_LABELS = { home: "Home", public: "Public" };
export const SOURCE_LABELS = { confirmed: "Confirmed", unconfirmed: "Unconfirmed" };

export const CLUSTER_RADIUS_FEET = 165;
export const SPREAD_NEAR_M = 25;
export const SPREAD_STEP_M = 30;
export const SPREAD_TRIES = 12;

const str = (v) => (v === null || v === undefined ? "" : String(v));
const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The empty filter (every key at its default) for a period state. */
export function emptyFilter(period = { range: DEFAULT_RANGE, off: 0, from: "", to: "" }) {
  return {
    range: period.range, off: period.off || 0, from: period.from || "", to: period.to || "",
    net: new Set(), speed: "", kind: "", src: "", q: "", at: "",
    view: "grouped", sort: "date", dir: "desc",
  };
}

/**
 * The filter state from a route query. [defaultRange] (Settings → Default period) applies when the
 * query names no range; a query with dates but no range is a Custom range.
 */
export function parseChargeFilter(query = {}, defaultRange = DEFAULT_RANGE) {
  const q = query || {};
  const fallback = RANGES.includes(defaultRange) ? defaultRange : DEFAULT_RANGE;
  const range = RANGES.includes(q.range) ? q.range : (q.from || q.to ? "custom" : fallback);
  const period = stateFromQuery({ ...q, range });
  const st = emptyFilter(period);
  for (const part of str(q.net).split(",")) {
    const k = networkKey(dec(part));
    if (part.trim() !== "") st.net.add(k);
  }
  st.speed = SPEEDS.includes(q.speed) ? q.speed : "";
  st.kind = KINDS.includes(q.kind) ? q.kind : "";
  st.src = SOURCES.includes(q.src) ? q.src : "";
  st.q = str(q.q).slice(0, 120);
  st.at = ID.test(str(q.at)) ? str(q.at) : "";
  st.view = VIEWS.includes(q.view) ? q.view : "grouped";
  st.sort = /^[a-z]{1,16}$/.test(str(q.sort)) ? str(q.sort) : "date";
  st.dir = q.dir === "asc" ? "asc" : "desc";
  return st;
}

/**
 * The network set as the query's comma list, sorted; "" when empty. Inside a key only "%" and "," are
 * escaped (%25, %2C), so "electrify america" stays readable in the address bar.
 */
export const formatNets = (set) => [...(set || [])].map((k) => String(k).replace(/%/g, "%25").replace(/,/g, "%2C")).sort().join(",");

/**
 * Every query key of a state, with "" for a default (so ctx.setQuery clears it). The range is written
 * whenever it differs from [defaultRange].
 */
export function chargeQuery(st, defaultRange = DEFAULT_RANGE) {
  const p = queryFromState(st);
  return {
    range: st.range === defaultRange ? "" : st.range,
    off: p.off || "", from: p.from || "", to: p.to || "",
    net: formatNets(st.net),
    speed: st.speed || "", kind: st.kind || "", src: st.src || "",
    q: st.q || "", at: st.at || "",
    view: st.view === "grouped" ? "" : st.view,
    sort: st.sort === "date" ? "" : st.sort,
    dir: st.dir === "desc" ? "" : st.dir,
  };
}

/** Only the non-default keys (for links such as "#/charge?net=…"). */
export function formatChargeFilter(st, defaultRange = DEFAULT_RANGE) {
  const all = chargeQuery(st, defaultRange);
  const out = {};
  for (const k of Object.keys(all)) if (all[k] !== "") out[k] = all[k];
  return out;
}

/** How many filters of the Filter sheet are on (networks count once; the period and search do not). */
export function activeCount(st) {
  return (st.net && st.net.size ? 1 : 0) + (st.speed ? 1 : 0) + (st.kind ? 1 : 0) + (st.src ? 1 : 0) + (st.at ? 1 : 0);
}

/** "fast" for a DC session (a declared type wins; otherwise the power rule), else "slow". Home is never fast. */
export const speedOf = (c) => (!isHome(c) && isDc(c) ? "fast" : "slow");

/** The text a search matches: network, notes and the date as the list and the table print it. */
function haystack(c, zone) {
  const z = zone || "UTC";
  return `${c.network}\n${c.notes}\n${dateFmt(c.date, "MM/dd", z)} ${dateFmt(c.date, "MM/dd/yy", z)} ${dateFmt(c.date, "MMM d yyyy", z)}`.toLowerCase();
}

/**
 * The rows the list shows. [win] = {start, end} or null (no date test). opts.zone = the display zone
 * (for the date text search); opts.atIds = the session ids of the map cluster st.at (when absent they
 * are found by clustering the rows the other filters keep, Home included).
 */
export function applyChargeFilter(charges, st, win, opts = {}) {
  let rows = (charges || []).filter((c) => {
    if (win && (c.date < win.start || c.date > win.end)) return false;
    if (st.net && st.net.size && !st.net.has(networkKey(c.network))) return false;
    if (st.speed && speedOf(c) !== st.speed) return false;
    if (st.kind === "home" && !isHome(c)) return false;
    if (st.kind === "public" && isHome(c)) return false;
    if (st.src === "unconfirmed" && !c.lowConfidence) return false;
    if (st.src === "confirmed" && c.lowConfidence) return false;
    return true;
  });
  const needle = str(st.q).trim().toLowerCase();
  if (needle) rows = rows.filter((c) => haystack(c, opts.zone).includes(needle));
  if (st.at) {
    let ids = opts.atIds;
    if (!ids) {
      const hit = clusterCharges(rows, { includeHome: true }).clusters.find((k) => k.id === st.at);
      ids = new Set(hit ? hit.sessions.map((c) => c.id) : []);
    }
    rows = rows.filter((c) => ids.has(c.id));
  }
  return rows;
}

/** The Filter sheet's network choices: [{key, label, count}] (Home first, then by cost). */
export function networkOptions(charges) {
  return networkFold(charges).map((e) => ({ key: e.key, label: e.label, count: e.sessions }));
}

/**
 * The months that have a charge, newest first: [{y, mo, off}] where off is the Month range's offset
 * from [nowMs]'s month (0 = this month). For the sheet's "Month" choice.
 */
export function chargeMonths(charges, nowMs, zone) {
  const p0 = parts(nowMs, zone);
  const seen = new Map();
  for (const c of charges || []) {
    const p = parts(c.date, zone);
    const off = (p.y * 12 + p.mo) - (p0.y * 12 + p0.mo);
    if (off > 0) continue;
    const key = `${p.y}-${p.mo}`;
    if (!seen.has(key)) seen.set(key, { y: p.y, mo: p.mo, off, count: 0 });
    seen.get(key).count++;
  }
  return [...seen.values()].sort((a, b) => b.off - a.off);
}

// ── charge-location pins ──────────────────────────────────────────────────────────────────────

function byNewest(a, b) {
  return (b.date - a.date) || (String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0);
}

/**
 * clusterCharges(charges, {includeHome}) → {clusters, noGps}. Rows without a parseable location (or
 * at 0,0) are skipped and counted in noGps; Home rows are left out unless includeHome.
 * Cluster = {id (its first, newest session's id), lat, lng (that session's), key, label, sessions
 * (newest first), n, kwh, cost, isHome}.
 */
export function clusterCharges(charges, { includeHome = false } = {}) {
  const radiusMi = CLUSTER_RADIUS_FEET / 5280;
  const clusters = [];
  let noGps = 0;
  for (const c of [...(charges || [])].sort(byNewest)) {
    const home = isHome(c);
    if (home && !includeHome) continue;
    const g = parseGps(c.gps);
    if (!g || (g.lat === 0 && g.lng === 0) || Math.abs(g.lat) > 90 || Math.abs(g.lng) > 180) { noGps++; continue; }
    const key = networkKey(c.network);
    const hit = clusters.find((k) => haversineMiles(g.lat, g.lng, k.lat, k.lng) < radiusMi &&
      (key === "" || k.netKey === "" || k.netKey === key));
    if (hit) {
      hit.sessions.push(c);
      if (hit.netKey === "" && key !== "") hit.netKey = key;   // the first named network speaks for it
    } else {
      clusters.push({ id: c.id, lat: g.lat, lng: g.lng, netKey: key, sessions: [c] });
    }
  }
  const out = clusters.map((k) => {
    const kwh = k.sessions.reduce((a, c) => a + (Number(c.totalKwh) || 0), 0);
    const cost = k.sessions.reduce((a, c) => a + (Number(c.total) || 0), 0);
    return {
      id: k.id, lat: k.lat, lng: k.lng, key: k.netKey,
      label: k.netKey === "" ? "Charging stop" : networkLabel(k.sessions, k.netKey),
      sessions: k.sessions, n: k.sessions.length, kwh, cost,
      isHome: k.netKey === "home",
    };
  });
  return { clusters: out, noGps };
}

const R_EARTH_M = 6_371_008.8;
const distM = (a, b) => haversineMiles(a.lat, a.lng, b.lat, b.lng) * 1609.344;

/** The point [m] metres from p at [bearingDeg] (spherical earth). */
export function offsetPoint(p, m, bearingDeg) {
  const rad = Math.PI / 180, d = m / R_EARTH_M, br = bearingDeg * rad;
  const lat1 = p.lat * rad, lng1 = p.lng * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lng: ((lng2 / rad + 540) % 360) - 180 };
}

/**
 * Display-only spreading: a pin within 25 m of an already placed pin moves 30 m from its own spot at
 * bearing k·137° (k = 1..12, the first that is clear; the 12th when none is). Returns new cluster
 * objects with the display lat/lng (the data rows are untouched). Deterministic for a given order.
 */
export function spreadPins(clusters) {
  const placed = [];
  const out = [];
  for (const k of clusters || []) {
    const home = { lat: k.lat, lng: k.lng };
    let pos = home;
    const crowded = (p) => placed.some((q) => distM(p, q) < SPREAD_NEAR_M);
    for (let i = 1; crowded(pos) && i <= SPREAD_TRIES; i++) pos = offsetPoint(home, SPREAD_STEP_M, i * 137);
    placed.push(pos);
    out.push({ ...k, lat: pos.lat, lng: pos.lng });
  }
  return out;
}

/**
 * The pins as a Point FeatureCollection (mapdata.pointFeatures): properties {id, n, label, kwh, cost,
 * home, fill, ring}; fill / ring are the app's pin colours (Home rings in Board green).
 */
export function clusterFeatures(clusters) {
  return pointFeatures((clusters || []).map((k) => ({
    lat: k.lat, lng: k.lng,
    id: k.id, n: k.n, label: k.label,
    kwh: Math.round(k.kwh * 100) / 100, cost: Math.round(k.cost * 100) / 100,
    home: !!k.isHome, fill: PIN.disc, ring: k.isHome ? PIN.home : PIN.ring,
  })));
}

