// TrueMile EV web: the charge list's Home roll-up and charging-STOP grouping. Pure, DOM-free.
//
// Port of ui/charge/ChargeStopGrouping.kt (groupIntoStops, socSpansOverlap, haversineMiles) and the
// list assembly in ChargeScreen.kt (Home sessions roll into one row; the rest group into stops).
// Two sessions belong to one stop when the newer starts <= 20 min after the older ends (older end =
// date + time_minutes) AND both carry parseable GPS within 0.5 mi. Grouping is display-only.

export const BUILD = "2026-09-30.2";

export const MAX_STOP_GAP_MS = 20 * 60_000;
export const MAX_STOP_RADIUS_MILES = 0.5;
const R_MILES = 3958.7613;

/** Haversine in statute miles (ChargeStopGrouping.haversineMiles). */
export function haversineMiles(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(h));
}

const NUM = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
function numOrNull(s) {
  if (s == null) return null;
  const t = String(s);
  return NUM.test(t) ? Number(t) : null;
}

/** "lat,lng" -> {lat, lng}; null when either part does not parse (toChargeLeg: null never groups). */
export function parseGps(s) {
  const p = String(s ?? "").split(",");
  const lat = numOrNull(p[0]), lng = numOrNull(p[1]);
  return lat == null || lng == null ? null : { lat, lng };
}

/** ChargeStopGrouping.socAsPercent: a 0..1 fraction becomes a percent, a percent stays. */
export function socAsPercent(v) {
  const n = Number(v) || 0;
  return n >= 0 && n <= 1 ? n * 100 : n;
}

/** The grouping slice of a normalised charge (rows.normCharge): ChargeScreen.toChargeLeg. */
export function toLeg(c) {
  const g = parseGps(c.gps);
  const date = Number(c.date) || 0;
  return {
    id: c.id,
    startEpochMs: date,
    endEpochMs: date + Math.trunc((Number(c.timeMin) || 0) * 60_000),
    lat: g ? g.lat : null,
    lng: g ? g.lng : null,
    // arrPct / depPct are already the display percent (Soc.kt:28, the same rule as socAsPercent).
    arrivalSocPct: c.arrPct != null ? Number(c.arrPct) || 0 : socAsPercent(c.arr),
    departureSocPct: c.depPct != null ? Number(c.depPct) || 0 : socAsPercent(c.dep),
  };
}

function sameStop(newer, older) {
  // A negative gap (overlapping clocks: resumed or edited rows) is still the same stop.
  if (newer.startEpochMs - older.endEpochMs > MAX_STOP_GAP_MS) return false;
  if (newer.lat == null || newer.lng == null || older.lat == null || older.lng == null) return false;
  return haversineMiles(newer.lat, newer.lng, older.lat, older.lng) <= MAX_STOP_RADIUS_MILES;
}

/**
 * Partitions a NEWEST-FIRST leg list into stops (each a newest-first sublist of consecutive legs).
 * A leg joins the stop above it when [sameStop] holds for the adjacent pair.
 */
export function groupIntoStops(legsNewestFirst) {
  const stops = [];
  let cur = [];
  for (const leg of legsNewestFirst) {
    if (cur.length === 0) { cur.push(leg); continue; }
    const newer = cur[cur.length - 1];
    if (sameStop(newer, leg)) cur.push(leg);
    else { stops.push(cur); cur = [leg]; }
  }
  if (cur.length) stops.push(cur);
  return stops;
}

/** True when two SoC spans (percent) overlap by >= 1 point: the FRAGMENT signature. */
export function socSpansOverlap(a, b) {
  const lo = Math.max(a.arrivalSocPct, b.arrivalSocPct);
  const hi = Math.min(a.departureSocPct, b.departureSocPct);
  return hi - lo >= 1.0;
}

/** Home test used by the roll-up (the same rule as rows.isHome). */
export const isHomeNetwork = (c) => /^home$/i.test(String(c.network ?? "").trim());

function byDateDescIdDesc(a, b) {
  return (b.date - a.date) || (String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0);
}

const sumKwh = (list) => list.reduce((s, c) => s + (Number(c.totalKwh) || 0), 0);
const sumCost = (list) => list.reduce((s, c) => s + (Number(c.total) || 0), 0);

/**
 * The Charges list model (CS:2172-2300). [charges] = the rows to list, any order.
 * -> { total, home: {sessions (newest first), count, kwh, cost} | null,
 *      stops: [{id (newest leg id), sessions (newest first), count, kwh, cost, dateMs (earliest leg)}] }
 */
export function groupCharges(charges, isHome = isHomeNetwork) {
  const sorted = [...charges].sort(byDateDescIdDesc);
  const home = sorted.filter((c) => isHome(c));
  const other = sorted.filter((c) => !isHome(c));
  const legStops = groupIntoStops(other.map(toLeg));
  const stops = [];
  let cursor = 0;
  for (const legs of legStops) {
    // groupIntoStops partitions consecutively, so a stop maps back onto a contiguous slice.
    const sessions = other.slice(cursor, cursor + legs.length);
    cursor += legs.length;
    stops.push({
      id: sessions[0].id,
      sessions,
      count: sessions.length,
      kwh: sumKwh(sessions),
      cost: sumCost(sessions),
      dateMs: sessions[sessions.length - 1].date,
    });
  }
  return {
    total: sorted.length,
    home: home.length ? { sessions: home, count: home.length, kwh: sumKwh(home), cost: sumCost(home) } : null,
    stops,
  };
}

const hasGroup = (g) => g !== null && g !== undefined && String(g).trim() !== "" && String(g) !== "null";

/**
 * The detail sheet's merge line (CS:4513-4553). [visible] = the same vehicle's visible charges.
 * Split rows whose same-group sibling OVERLAPS in SoC read as fragments; chained siblings read as a
 * multi-charger stop; a merged row says so. Null when none applies.
 */
export function mergeNote(c, visible) {
  if (c.isSplit && hasGroup(c.splitGroup) && !c.isMerged) {
    const sibs = visible.filter((o) => o.id !== c.id && !o.isMerged && o.vehicleId === c.vehicleId &&
      hasGroup(o.splitGroup) && String(o.splitGroup) === String(c.splitGroup));
    const me = toLeg(c);
    if (sibs.some((o) => socSpansOverlap(toLeg(o), me))) return "This looks like pieces of one interrupted charge.";
    if (sibs.length) return "Part of a multi-charger stop.";
  }
  if (c.isMerged) return "Merged from interrupted sessions at this location.";
  return null;
}
