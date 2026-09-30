// TrueMile EV web: zone-aware local calendar math. Pure, DOM-free.
//
// The app does every period, day group and "same point" cut with java.util.Calendar in the phone's
// zone. The browser has no Calendar, and Deno's own zone cannot be changed on Windows, so every
// function here takes the IANA zone explicitly and reads the zone's offset through Intl. Semantics
// follow the lenient Calendar the app uses: add(DAY_OF_YEAR) and add(MONTH) keep the wall-clock time,
// add(MONTH) clamps the day to the target month, and a local time that does not exist (the spring
// DST gap) moves forward by the gap.

export const BUILD = "2026-09-30.2";

export const DAY_MS = 86_400_000;
const Q = 900_000;                       // offsets only change on quarter hours in the modern tz database

const fmtCache = new Map();
const offCache = new Map();

function fmtFor(zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

function rawOffset(ms, zone) {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = {};
  for (const part of fmtFor(zone).formatToParts(new Date(whole))) p[part.type] = part.value;
  let y = Number(p.year);
  if (p.era === "BC") y = 1 - y;
  const asUtc = Date.UTC(y, Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - whole;
}

/** The zone's UTC offset (ms, east positive) at instant [ms]. */
export function offsetAt(ms, zone) {
  let c = offCache.get(zone);
  if (!c) { c = new Map(); offCache.set(zone, c); }
  const key = Math.floor(ms / Q);
  let o = c.get(key);
  if (o === undefined) {
    // Evaluate at the quarter-hour start: a transition happens exactly there, never inside.
    o = rawOffset(key * Q, zone);
    if (c.size > 50_000) c.clear();
    c.set(key, o);
  }
  return o;
}

/** Local calendar fields of instant [ms] in [zone]. mo is 1-12, dow 0 = Sunday. */
export function parts(ms, zone) {
  const d = new Date(ms + offsetAt(ms, zone));
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(),
    dow: d.getUTCDay(),
  };
}

/**
 * The instant of local wall time y-mo-d h:mi:s.msec in [zone]. Out-of-range fields roll over the way
 * a lenient Calendar does (day 0 = the last day of the previous month, day 32 = the next month).
 * Across a DST gap the time moves forward by the gap; an ambiguous (repeated) hour takes the first.
 */
export function fromLocal(y, mo, d, h = 0, mi = 0, s = 0, msec = 0, zone) {
  if (typeof zone !== "string") throw new Error("tz.fromLocal: zone is required");
  const wall = Date.UTC(y, mo - 1, d, h, mi, s, msec);
  const before = offsetAt(wall - 14 * 3_600_000, zone);
  const after  = offsetAt(wall + 14 * 3_600_000, zone);
  const ok = [];
  for (const off of before === after ? [before] : [before, after]) {
    const t = wall - off;
    if (offsetAt(t, zone) === off) ok.push(t);
  }
  if (ok.length) return Math.min(...ok);
  // Nonexistent local time (the gap): read it with the offset in force before the change, which
  // lands the same distance past the gap - 02:30 on a spring-forward night becomes 03:30.
  return wall - before;
}

export function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Local midnight of [ms]'s day. */
export function startOfDay(ms, zone) {
  const p = parts(ms, zone);
  return fromLocal(p.y, p.mo, p.d, 0, 0, 0, 0, zone);
}

/** The last millisecond of [ms]'s day (= next local midnight - 1). */
export function endOfDay(ms, zone) {
  const p = parts(ms, zone);
  return fromLocal(p.y, p.mo, p.d + 1, 0, 0, 0, 0, zone) - 1;
}

/** [n] calendar days later (negative = earlier), keeping the wall-clock time. */
export function addDays(ms, n, zone) {
  const p = parts(ms, zone);
  return fromLocal(p.y, p.mo, p.d + n, p.h, p.mi, p.s, p.ms, zone);
}

/** [n] calendar months later, keeping the wall-clock time; the day clamps to the target month. */
export function addMonths(ms, n, zone) {
  const p = parts(ms, zone);
  const idx = p.y * 12 + (p.mo - 1) + n;
  const y = Math.floor(idx / 12), mo = idx - y * 12 + 1;
  const d = Math.min(p.d, daysInMonth(y, mo));
  return fromLocal(y, mo, d, p.h, p.mi, p.s, p.ms, zone);
}

/**
 * Whole calendar days from [aMs]'s local date to [bMs]'s local date (0 = same day, negative when b is
 * earlier). A window's inclusive day count is daysBetween(start, end) + 1. DST-proof: it compares
 * dates, never elapsed hours.
 */
export function daysBetween(aMs, bMs, zone) {
  const a = parts(aMs, zone), b = parts(bMs, zone);
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / DAY_MS);
}

/** "yyyy-mm-dd" of [ms]'s local date. */
export function ymd(ms, zone) {
  const p = parts(ms, zone);
  return `${String(p.y).padStart(4, "0")}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Parses "yyyy-mm-dd" to {y, mo, d}; null when malformed or not a real date. */
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, mo, d };
}

/** The browser's own zone (UI code only; pure functions always take the zone as a parameter). */
export function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (_) { return "UTC"; }
}
