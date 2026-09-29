// TrueMile EV web: journeys from trip rows. Pure, DOM-free.
//
// There is no journeys table. A journey is trip_log.journey_id on the vehicle's OWN drives
// (car_status ''), summarised like AppDatabase.kt:742-760; its name is journey_category, which a rename
// writes onto every trip of the journey, so the shown name is MAX(journey_category) and, when blank,
// "Journey " + the id after "J-" (JourneyRail.kt:68-69). Labels port JourneyRailLogic and
// JourneyDayFilter.spanDays. Which journey is still open lives on the phone only; nothing here says.

import { parts, daysBetween } from "./tz.js";
import { tripDuration } from "./format.js";

export const BUILD = "2026-09-29.2";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DASH = "–";

const blank = (s) => s === null || s === undefined || String(s).trim() === "";

/** JourneyRailLogic.displayName: the name, else "Journey " + id.substringAfter("J-"). */
export function displayName(journeyId, name) {
  if (!blank(name)) return String(name);
  const id = String(journeyId ?? "");
  const i = id.indexOf("J-");
  return "Journey " + (i >= 0 ? id.slice(i + 2) : id);
}

/** Efficiency.aggregate over ALL of a journey's trips (reconstructed included, DB:1637); 0 when degenerate. */
export function aggregateMiPerKwh(miles, used, regen) {
  const net = Math.max(used - regen, 0);
  return miles < 0.3 || net < 0.2 ? 0 : miles / net;
}

/**
 * groupJourneys(trips) -> Journey[], newest first by start. Only own drives (carStatus "") with a
 * journey id count. Journeys never cross vehicles: the same id on two vehicles is two journeys.
 * Journey = {id, key, vehicleId, name, rawName, trips (date asc), start, end, tripCount, miles, usedKwh,
 *            cost, durationSec, regenKwh, miPerKwh}
 */
export function groupJourneys(trips) {
  const map = new Map();
  for (const t of trips) {
    if ((t.carStatus ?? "") !== "" || blank(t.journeyId)) continue;
    const key = `${t.vehicleId}|${t.journeyId}`;
    let g = map.get(key);
    if (!g) { g = { key, id: t.journeyId, vehicleId: t.vehicleId, trips: [] }; map.set(key, g); }
    g.trips.push(t);
  }
  const out = [];
  for (const g of map.values()) {
    g.trips.sort((a, b) => (a.date - b.date) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    let rawName = null, miles = 0, used = 0, cost = 0, dur = 0, regen = 0;
    let start = Infinity, end = -Infinity;
    for (const t of g.trips) {
      // SQL MAX over the non-null names (plain string compare); an empty name loses to any real one.
      if (!blank(t.journeyName) && (rawName === null || String(t.journeyName) > rawName)) rawName = String(t.journeyName);
      miles += Number(t.miles) || 0;
      used += Number(t.usedKwh) || 0;
      cost += Number(t.cost) || 0;
      dur += Number(t.durationSec) || 0;
      regen += Number(t.regenKwh) || 0;
      if (t.date < start) start = t.date;
      if (t.date > end) end = t.date;
    }
    out.push({
      id: g.id, key: g.key, vehicleId: g.vehicleId,
      name: displayName(g.id, rawName), rawName,
      trips: g.trips, start, end,
      tripCount: g.trips.length, miles, usedKwh: used, cost, durationSec: dur, regenKwh: regen,
      miPerKwh: aggregateMiPerKwh(miles, used, regen),
    });
  }
  // sortedForRail: newest first by start (stable for ties).
  out.sort((a, b) => b.start - a.start);
  return out;
}

function md(p) { return `${MONTHS[p.mo - 1]} ${p.d}`; }

/**
 * JourneyRailLogic.rangeLabel: "Aug 3" · "Aug 3–6" · "Aug 30 – Sep 2" · "Dec 30, 2025 – Jan 2, 2026";
 * ", yyyy" when not the current year; an open end (end <= 0) reads "since Aug 3". Swapped bounds are
 * tolerated. Accepts a Journey or {start, end}.
 */
export function rangeLabel(j, nowMs, zone) {
  const startEpoch = Number(j.start), endEpoch = Number(j.end);
  const open = !(endEpoch > 0);
  const s = parts(open ? startEpoch : Math.min(startEpoch, endEpoch), zone);
  const e = parts(open ? startEpoch : Math.max(startEpoch, endEpoch), zone);
  if (open) return "since " + md(s);
  if (s.y !== e.y) return `${md(s)}, ${s.y} ${EN_DASH} ${md(e)}, ${e.y}`;
  const yearSuffix = s.y !== parts(nowMs, zone).y ? `, ${s.y}` : "";
  if (s.mo === e.mo && s.d === e.d) return md(s) + yearSuffix;
  if (s.mo === e.mo) return `${md(s)}${EN_DASH}${e.d}` + yearSuffix;
  return `${md(s)} ${EN_DASH} ${md(e)}` + yearSuffix;
}

/** JourneyDayFilter.spanDays: local calendar days start..end inclusive; 0 when both unknown. */
export function spanDays(startEpoch, endEpoch, zone) {
  let lo = Math.min(startEpoch, endEpoch);
  const hi = Math.max(startEpoch, endEpoch);
  if (lo <= 0 && hi <= 0) return 0;
  if (lo <= 0) lo = hi;
  return daysBetween(lo, hi, zone) + 1;
}

/** JourneyRailLogic.spanLabel: "" for 0, "1 day", "N days". */
export function spanLabel(n) {
  if (n <= 0) return "";
  return n === 1 ? "1 day" : `${n} days`;
}

/** "{n} trip|trips · {tripDuration(Σduration)} · {N day|days}" (the span is omitted when unknown). */
export function metaLabel(j, zone) {
  const n = j.tripCount;
  const trips = n === 1 ? "1 trip" : `${n} trips`;
  const span = spanLabel(spanDays(j.start, j.end, zone));
  return `${trips} · ${tripDuration(j.durationSec)}` + (span ? ` · ${span}` : "");
}

/** The charges a journey report lists: same vehicle, date in [start, end] (MapScreen.kt:2751-2753). */
export function journeyCharges(j, charges) {
  return charges.filter((c) => c.vehicleId === j.vehicleId && c.date >= j.start && c.date <= j.end);
}

/**
 * The Map section's "Journeys" tile: distinct vehicle|journey pairs among [trips], own drives only
 * (carStatus "") with a non-blank journey id. The same id on two vehicles is two journeys. Handed a
 * period's drives, a journey counts in that period when ANY of its drives falls inside it (a web rule;
 * the app has no such tile).
 */
export function journeyCount(trips) {
  const keys = new Set();
  for (const t of trips || []) {
    if (!t || (t.carStatus ?? "") !== "" || blank(t.journeyId)) continue;
    keys.add(`${t.vehicleId}|${t.journeyId}`);
  }
  return keys.size;
}

/** Finds a journey by its id (and vehicle when given). */
export function findJourney(journeys, id, vehicleId = null) {
  return journeys.find((j) => j.id === id && (vehicleId === null || j.vehicleId === vehicleId)) || null;
}

/** The distinct local years a journey list touches, newest first (for the year filter). */
export function journeyYears(journeys, zone) {
  const ys = new Set();
  for (const j of journeys) { ys.add(parts(j.start, zone).y); ys.add(parts(j.end, zone).y); }
  return [...ys].sort((a, b) => b - a);
}

/** True when the journey touches local year [y]. */
export function inYear(j, y, zone) {
  return parts(j.start, zone).y <= y && parts(j.end, zone).y >= y;
}
