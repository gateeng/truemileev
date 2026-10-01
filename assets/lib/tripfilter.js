// TrueMile EV web: the Map section's trip filters (period, type, car, short trips, towing,
// reconstructed, notes, distance, search) and the list's view keys. Pure, DOM-free.
//
// The query carries every key; a default value is left out of the URL. Distances in the URL are
// CANONICAL miles, so a link means the same thing in either unit; the sheet shows and reads them in
// the viewer's unit (distanceToInput / distanceFromInput). The list keeps the app's rules
// (ReportCarFilter.listFor for the car choice, the Pro type filter, "Show short trips (N)" counted
// after every other filter); the extra filters (towing, reconstructed, notes, distance) are web-only.

import { RANGES, DEFAULT_RANGE, steppable, tileWindow, halfCustomWindow } from "./periods.js";
import { parseYmd, parts } from "./tz.js";
import { dateFmt } from "./format.js";
import { listFor, typeKey, classLabel, isShort } from "./rows.js";
import { MI_TO_KM } from "./units.js";

export const BUILD = "2026-10-01.1";

const DAY = 86_400_000;

/** Every query key the Map section's trip filter owns (the section adds "tab"). */
export const TRIP_FILTER_KEYS = Object.freeze([
  "range", "off", "from", "to", "types", "car", "short", "tow", "recon", "notes", "dmin", "dmax", "q", "view", "sort", "dir",
]);
/** The table's sortable columns (views/trips.js). */
export const SORT_KEYS = Object.freeze([
  "date", "start", "dist", "elapsed", "used", "regen", "eff", "cost", "dpm", "speed", "soc", "temp", "type", "journey", "car", "vehicle",
]);
export const RECON_VALUES = Object.freeze(["", "only", "hide"]);

const pickRange = (r) => (RANGES.includes(r) ? r : DEFAULT_RANGE);

/** "a,b" → Set (blank = every type), the typefilter's rule. */
export function parseTypeSet(str) {
  return new Set(String(str ?? "").split(",").map((s) => s.trim()).filter((s) => s));
}
/** Set → "a,b" sorted, so one selection has one URL. */
export function formatTypeSet(set) {
  return [...(set || [])].sort().join(",");
}

/** A canonical-miles query value → a finite number ≥ 0, else null. */
function milesOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What the viewer typed (in their unit, "," accepted as the decimal mark) → canonical miles, or null. */
export function distanceFromInput(text, units) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!s || !/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round((units === "metric" ? v / MI_TO_KM : v) * 10000) / 10000;
}

/** Canonical miles → the sheet's field text in the viewer's unit (up to one decimal, "" for null). */
export function distanceToInput(miles, units) {
  if (miles === null || miles === undefined || !Number.isFinite(Number(miles))) return "";
  const v = units === "metric" ? Number(miles) * MI_TO_KM : Number(miles);
  return String(Math.round(v * 10) / 10);
}

/**
 * The filter state from the route query. [units] fills dminText / dmaxText (the sheet's fields);
 * [defaultRange] is the period used when the query names none (Settings → Default period), except
 * that a legacy link carrying only from / to reads as Custom.
 * -> {range, off, from, to, types:Set, car, short, tow, recon, notes, dmin, dmax, dminText, dmaxText,
 *     q, view, sort, dir}
 */
export function parseTripFilter(query, units = "imperial", { defaultRange = DEFAULT_RANGE } = {}) {
  const q = query || {};
  const range = RANGES.includes(q.range) ? q.range : (q.from || q.to ? "custom" : pickRange(defaultRange));
  let off = Math.trunc(Number(q.off)) || 0;
  if (off > 0 || !steppable(range)) off = 0;
  let dmin = milesOrNull(q.dmin), dmax = milesOrNull(q.dmax);
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin];
  return {
    range, off,
    from: range === "custom" && parseYmd(q.from) ? q.from : "",
    to: range === "custom" && parseYmd(q.to) ? q.to : "",
    types: parseTypeSet(q.types),
    car: q.car === "other" || q.car === "ask" ? q.car : "all",
    short: q.short === "1",
    tow: q.tow === "1",
    recon: q.recon === "only" || q.recon === "hide" ? q.recon : "",
    notes: q.notes === "1",
    dmin, dmax,
    dminText: distanceToInput(dmin, units),
    dmaxText: distanceToInput(dmax, units),
    q: typeof q.q === "string" ? q.q : "",
    view: q.view === "table" ? "table" : "days",
    sort: SORT_KEYS.includes(q.sort) ? q.sort : "date",
    dir: q.dir === "asc" ? "asc" : "desc",
  };
}

const r4 = (v) => String(Math.round(v * 10000) / 10000);

/** The inverse: only the non-default keys, as strings (the range is left out when it is the default). */
export function formatTripFilter(st, { defaultRange = DEFAULT_RANGE } = {}) {
  const out = {};
  const range = RANGES.includes(st.range) ? st.range : pickRange(defaultRange);
  if (range !== pickRange(defaultRange)) out.range = range;
  if (st.off && steppable(range)) out.off = String(Math.min(0, Math.trunc(st.off)));
  if (out.off === "0") delete out.off;
  if (range === "custom") {
    if (st.from) out.from = st.from;
    if (st.to) out.to = st.to;
  }
  const types = formatTypeSet(st.types);
  if (types) out.types = types;
  if (st.car === "other" || st.car === "ask") out.car = st.car;
  if (st.short) out.short = "1";
  if (st.tow) out.tow = "1";
  if (st.recon === "only" || st.recon === "hide") out.recon = st.recon;
  if (st.notes) out.notes = "1";
  if (st.dmin !== null && st.dmin !== undefined && Number.isFinite(Number(st.dmin))) out.dmin = r4(Number(st.dmin));
  if (st.dmax !== null && st.dmax !== undefined && Number.isFinite(Number(st.dmax))) out.dmax = r4(Number(st.dmax));
  if (st.q && String(st.q).trim()) out.q = String(st.q);
  if (st.view === "table") out.view = "table";
  if (st.sort && st.sort !== "date" && SORT_KEYS.includes(st.sort)) out.sort = st.sort;
  if (st.dir === "asc") out.dir = "asc";
  return out;
}

/** A setQuery partial: every filter key, "" where the value is the default (so stale keys clear). */
export function filterQuery(st, opts = {}) {
  const f = formatTripFilter(st, opts);
  const out = {};
  for (const k of TRIP_FILTER_KEYS) out[k] = f[k] ?? "";
  return out;
}

/**
 * The number on the Filter button: the sheet's choices that differ from the defaults (trip types,
 * car, short trips, towing, reconstructed, notes, distance as one). The period and the search box
 * show themselves and are not counted.
 */
export function activeCount(st) {
  let n = 0;
  if (st.types && st.types.size) n++;
  if (st.car === "other" || st.car === "ask") n++;
  if (st.short) n++;
  if (st.tow) n++;
  if (st.recon === "only" || st.recon === "hide") n++;
  if (st.notes) n++;
  if ((st.dmin !== null && st.dmin !== undefined) || (st.dmax !== null && st.dmax !== undefined)) n++;
  return n;
}

/** The sheet's defaults (the period, search and view keys are kept). */
export function clearSheet(st) {
  return { ...st, types: new Set(), car: "all", short: false, tow: false, recon: "", notes: false, dmin: null, dmax: null, dminText: "", dmaxText: "" };
}

/**
 * The windows of a period state. win = what the tiles cover (tileWindow; a half-built Custom range
 * falls back to the picked bound or the last seven days, half = true); listWin = the list's window,
 * the same except All time, which lists every drive (null).
 */
export function sectionWindow(st, nowMs, zone) {
  const range = RANGES.includes(st.range) ? st.range : DEFAULT_RANGE;
  const w = tileWindow(range, nowMs, st.off, st.from, st.to, zone);
  let win, half = false;
  if (w) win = w;
  else {
    half = true;
    win = halfCustomWindow(st.from, st.to, zone, nowMs) || { start: nowMs - 7 * DAY, end: nowMs };
  }
  return { win, half, listWin: range === "all" ? null : win };
}

function hasNote(t, notesByTrip) {
  if (!notesByTrip || typeof notesByTrip.get !== "function" || !t.clientTripId) return false;
  const l = notesByTrip.get(t.clientTripId);
  return !!(l && l.length);
}

/** The text a search matches: the day (both spellings), type, journey, other car's name and notes. */
export function searchText(t, { nowMs, zone, notesByTrip } = {}) {
  const y = parts(t.date, zone).y;
  const day = dateFmt(t.date, "EEE, MMM d", zone) + (nowMs !== undefined && y !== parts(nowMs, zone).y ? `, ${y}` : "");
  const notes = (notesByTrip && typeof notesByTrip.get === "function" && notesByTrip.get(t.clientTripId)) || [];
  return [
    day, dateFmt(t.date, "EEE, MMM d, yyyy", zone), classLabel(t.classification),
    t.journeyName || "", t.carStatus === "other" ? t.otherCarLabel || "" : "",
    ...notes.map((n) => (n && n.body) || ""),
  ].join("\n").toLowerCase();
}

/**
 * applyTripFilter(trips, st, pieces) → {rows, listedCount, shortCount, cut}
 * [trips] = the scope's drives of every car status; pieces = {win (null = every date; undefined =
 * sectionWindow(st).listWin), nowMs, zone, notesByTrip, typesAllowed (default true; below Pro the type
 * filter shows locked and is not applied), windowIds (the tier's list window as a Set of ids, or null)}.
 * Order: date window → car (listFor) → type → towing → reconstructed → notes → distance → search;
 * listedCount counts those rows (the header's "TRIPS (N)"), shortCount the short ones among them; the
 * short-trip toggle and the tier window come last. rows are newest first (date, then id, descending).
 */
export function applyTripFilter(trips, st, pieces = {}) {
  const all = trips || [];
  const nowMs = pieces.nowMs ?? Date.now();
  const zone = pieces.zone || "UTC";
  const win = pieces.win !== undefined ? pieces.win : sectionWindow(st, nowMs, zone).listWin;
  const inRange = win ? all.filter((t) => t.date >= win.start && t.date <= win.end) : all;
  let rows = listFor(inRange, all, st.car === "other" || st.car === "ask" ? st.car : "all");
  if (pieces.typesAllowed !== false && st.types && st.types.size) rows = rows.filter((t) => st.types.has(typeKey(t)));
  if (st.tow) rows = rows.filter((t) => Number(t.towLbs) > 0);
  if (st.recon === "only") rows = rows.filter((t) => !!t.isReconciled);
  else if (st.recon === "hide") rows = rows.filter((t) => !t.isReconciled);
  if (st.notes) rows = rows.filter((t) => hasNote(t, pieces.notesByTrip));
  if (st.dmin !== null && st.dmin !== undefined) rows = rows.filter((t) => t.miles >= st.dmin - 1e-9);
  if (st.dmax !== null && st.dmax !== undefined) rows = rows.filter((t) => t.miles <= st.dmax + 1e-9);
  const needle = String(st.q || "").trim().toLowerCase();
  if (needle) rows = rows.filter((t) => searchText(t, { nowMs, zone, notesByTrip: pieces.notesByTrip }).includes(needle));
  const listedCount = rows.length;
  const shortCount = rows.filter(isShort).length;
  if (!st.short) rows = rows.filter((t) => !isShort(t));
  const before = rows.length;
  if (pieces.windowIds) rows = rows.filter((t) => pieces.windowIds.has(t.id));
  rows = [...rows].sort((a, b) => (b.date - a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { rows, listedCount, shortCount, cut: !!pieces.windowIds && rows.length < before };
}
