// TrueMile EV web: the Report tiles' "vs avg" line. Pure, DOM-free. Port of ui/report/ReportCompare.kt
// (owner 9/26, option C): a trailing window of whole periods before the selected one; each metric's
// history starts at its own first row; sums average Σ ÷ N with empty periods as 0 and unknown periods
// left out; ratios pool every row of the N periods; a running period compares at the same point.
// Everything is canonical (imperial) until display(); the unit system only enters line() and caption().

import { parts, fromLocal, startOfDay, addDays, daysBetween, daysInMonth } from "./tz.js";
import { periodWindow } from "./periods.js";
import { dist, eff, economy, speed, perDist, isMetric } from "./units.js";
import { fixed, money, tripDuration, fmtCount, MINUS } from "./format.js";
import { tileAggregate, number, additive, metric, betterFor, KEYS, NONE } from "./metrics.js";

export const BUILD = "2026-09-30.1";

export { MINUS };
export const DEADBAND_PCT = 2.0;
export const DEADBAND_POINTS = 0.5;
export const BASES = ["trip", "measured", "moving", "charge", "received"];

/** How many earlier periods the average may reach back over. */
export function lookback(range) {
  switch (range) {
    case "day": return 28;
    case "week": return 12;
    case "month": return 12;
    case "year": case "ytd": return 5;
    case "custom": return 12;
    default: return 0;
  }
}

/** Fewer counted periods than this and the tile says "avg —". */
export function minPeriods(range) {
  switch (range) {
    case "day": return 7;
    case "week": return 3;
    case "month": return 2;
    case "year": case "ytd": return 1;
    case "custom": return 2;
    default: return 0;
  }
}

/**
 * What the selected range compares against, or null (All time, a half-built Custom range).
 * [custom] = {start, end} in ms for a custom range (either missing = half-built).
 * Plan = {range, selStart, selEnd, periodEnd, partial, nowMs, windows:[{start,end}] newest first,
 *         minPeriods, spanDays}. YTD arrives as YEAR at offset 0.
 */
export function plan(range, nowMs, offset, custom, zone) {
  if (range === "all") return null;
  if (range === "custom") {
    if (!custom || custom.start == null || custom.end == null) return null;
    const s = Math.min(custom.start, custom.end);
    const e = Math.max(custom.start, custom.end);
    const days = Math.max(1, daysBetween(s, e, zone) + 1);
    const windows = [];
    for (let k = 1; k <= lookback("custom"); k++) {
      windows.push({ start: addDays(s, -k * days, zone), end: addDays(s, -(k - 1) * days, zone) - 1 });
    }
    return { range: "custom", selStart: s, selEnd: e, periodEnd: e, partial: e > nowMs, nowMs, windows,
      minPeriods: minPeriods("custom"), spanDays: days };
  }
  if (!["day", "week", "month", "year", "ytd"].includes(range)) return null;
  const effRange = range === "ytd" ? "year" : range;
  const off = range === "ytd" ? 0 : Math.min(Math.trunc(offset) || 0, 0);
  const sel = periodWindow(effRange, nowMs, off, zone);
  const windows = [];
  for (let k = 1; k <= lookback(effRange); k++) windows.push(periodWindow(effRange, nowMs, off - k, zone));
  const periodEnd = periodEndOf(effRange, sel.start, sel.end, zone);
  return { range: effRange, selStart: sel.start, selEnd: sel.end, periodEnd, partial: periodEnd > nowMs, nowMs,
    windows, minPeriods: minPeriods(effRange), spanDays: 0 };
}

function periodEndOf(range, start, selEnd, zone) {
  const p = parts(start, zone);
  if (range === "month") return fromLocal(p.y, p.mo + 1, p.d, p.h, p.mi, p.s, p.ms, zone) - 1;
  if (range === "year") return fromLocal(p.y + 1, p.mo, p.d, p.h, p.mi, p.s, p.ms, zone) - 1;
  return selEnd;
}

/**
 * A running period's cut for an earlier window: its start plus as many calendar days as the selected
 * period has run, at now's wall-clock time, capped at the window's end. Days, weeks, months, custom.
 */
export function samePointEnd(winStart, winEnd, selectedStart, nowMs, zone) {
  const daysIn = Math.max(0, daysBetween(selectedStart, nowMs, zone));
  const w = parts(winStart, zone), n = parts(nowMs, zone);
  const cut = fromLocal(w.y, w.mo, w.d + daysIn, n.h, n.mi, n.s, n.ms, zone);
  return Math.min(cut, winEnd);
}

/** The same for a year: the earlier year cut on now's calendar DATE (Feb 29 → Feb 28), capped. */
export function sameDateEnd(winStart, winEnd, nowMs, zone) {
  const w = parts(winStart, zone), n = parts(nowMs, zone);
  const d = Math.min(n.d, daysInMonth(w.y, n.mo));
  const cut = fromLocal(w.y, n.mo, d, n.h, n.mi, n.s, n.ms, zone);
  return Math.min(cut, winEnd);
}

/**
 * The local midnight of the first row of each basis, or null. [ownTripsAnyType] = the scope's own
 * drives of ANY type (a type filter narrows the sums, not when the record began); [charges] = the
 * scope's visible charges. moving is null on the web (no moving_sec column), so its tile reads "avg —".
 */
export function anchors(ownTripsAnyType, charges, zone) {
  const first = (rows, pick) => {
    let m = Infinity;
    for (const r of rows) if (pick(r) && r.date > 0 && r.date < m) m = r.date;
    return m === Infinity ? null : startOfDay(m, zone);
  };
  return {
    trip: first(ownTripsAnyType, () => true),
    measured: first(ownTripsAnyType, (t) => !t.isReconciled),
    moving: first(ownTripsAnyType, (t) => !t.isReconciled && (t.movingSec || 0) > 0),
    charge: first(charges, () => true),
    received: first(charges, (c) => c.receivedKwh > 0),
  };
}

/** How many of [p]'s windows count: the newest ones that start on or after [anchor]. */
export function counted(p, anchor) {
  if (anchor === null || anchor === undefined) return 0;
  let n = 0;
  for (const w of p.windows) { if (w.start >= anchor) n++; else break; }
  return n;
}

const tripKind = (key) => { const b = metric(key)?.basis; return b === "trip" || b === "measured" || b === "moving"; };
const hasRows = (key, a) => (tripKind(key) ? a.tripCount > 0 : a.chargeCount > 0);

/** The period HAS rows of the metric's kind yet its figure is unknown: a sum leaves it out. */
export function unmeasured(key, a) {
  return metric(key)?.kind === "add" && hasRows(key, a) && number(key, a) === null;
}

function sortedWithDates(rows) {
  const s = [...rows].sort((a, b) => a.date - b.date);
  return { rows: s, dates: s.map((r) => r.date) };
}
function firstAtOrAfter(dates, t) {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (dates[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
}
function slice(s, from, to) {
  if (to < from) return [];
  const lo = firstAtOrAfter(s.dates, from), hi = firstAtOrAfter(s.dates, to + 1);
  return lo >= hi ? [] : s.rows.slice(lo, hi);
}

/**
 * Every metric's baseline for [p]: Map<key, {avg: number|null (canonical), periods}>.
 * [tripsForSums] = the scope's history filtered exactly as the tiles filter (own drives, type filter);
 * [charges] = the scope's visible charges; [anch] = anchors(); [readAt] = when the tile rows were read
 * (the cut for a running period, never past p.selEnd). The Map also carries .running, .periods
 * (counted windows per basis) and .cutNowMs.
 */
export function baselines(p, tripsForSums, charges, anch, readAt, nowMs, zone) {
  const cutNowMs = readAt ?? nowMs ?? p.nowMs;
  const periods = {};
  for (const b of BASES) periods[b] = counted(p, anch ? anch[b] : null);
  const T = sortedWithDates(tripsForSums), Cs = sortedWithDates(charges);
  const agg = (from, to) => tileAggregate(slice(T, from, to), slice(Cs, from, to));

  const cutAt = Math.min(cutNowMs, p.selEnd);
  const running = p.partial && cutAt < p.periodEnd;
  const deepest = Math.max(0, ...Object.values(periods));
  const cutAggs = p.windows.slice(0, deepest).map((w) =>
    agg(w.start, running ? cutEnd(p, w.start, w.end, cutAt, zone) : w.end));
  const pooled = new Map();
  const need = Math.max(1, p.minPeriods);

  const out = new Map();
  for (const key of KEYS) {
    const m = metric(key);
    const n = periods[m.basis];
    if (m.kind === "add") {
      const kept = cutAggs.slice(0, n).filter((a) => !unmeasured(key, a));
      const k = kept.length;
      out.set(key, { periods: k, avg: k >= need ? kept.reduce((s, a) => s + additive(key, a), 0) / k : null });
    } else if (n < need) {
      out.set(key, { periods: n, avg: null });
    } else {
      if (!pooled.has(n)) pooled.set(n, agg(p.windows[n - 1].start, p.windows[0].end));
      out.set(key, { periods: n, avg: number(key, pooled.get(n)) });
    }
  }
  out.running = running;
  out.periods = periods;
  out.cutNowMs = cutNowMs;
  return out;
}

function cutEnd(p, s, e, cutAt, zone) {
  return p.range === "year" ? sameDateEnd(s, e, cutAt, zone) : samePointEnd(s, e, p.selStart, cutAt, zone);
}

/** A canonical number in the units the tile prints ($/mi divides by the km factor, as the tile does). */
export function displayValue(key, x, units) {
  switch (key) {
    case "distance": return dist(x, units);
    case "efficiency": return eff(x, units);
    case "economy": return economy(x, units);
    case "avg_speed": return speed(x, units);
    case "avg_per_mi": return perDist(x, units);
    default: return x;
  }
}

/** ReportCompare.formatAvg: an average in the tile's own units, no unit suffix except "$" and "%". */
export function formatAvg(key, d, units) {
  switch (key) {
    case "trips": case "charges": return fmtCount(d);
    case "distance": case "charged": case "used": case "received": return d < 100 ? fixed(d, 1) : fixed(d, 0);
    case "trip_cost": case "charge_cost": return money(d, 2);
    case "avg_per_kwh": case "avg_per_mi": return money(d, 3);
    case "efficiency": return fixed(d, 2);
    case "economy": return isMetric(units) ? fixed(d, 1) : fixed(d, 0);
    case "avg_speed": return fixed(d, 0);
    case "elapsed": case "moving": return tripDuration(Math.round(d));
    case "charge_efficiency": return fixed(d, 1) + "%";
    default: return fixed(d, 2);
  }
}

function toneOf(better, signed, inDeadband) {
  if (better === "neither" || inDeadband || signed === 0) return "neutral";
  return (signed > 0) === (better === "higher") ? "better" : "worse";
}

export const PLACEHOLDER = Object.freeze({ text: `avg ${NONE}`, tone: null, delta: null, avg: `avg ${NONE}`, spoken: "No average yet" });

/**
 * The tile's third line: {text, tone ("better"|"worse"|"neutral", null when no difference is stated),
 * delta, avg, spoken}. text = "{delta} · avg {X}", "avg {X}" or "avg —". The difference is on the
 * DISPLAYED numbers, so Le/100km's direction flips with it.
 */
export function line(key, cur, base, units) {
  const avgC = base ? base.avg : null;
  if (avgC === null || avgC === undefined) return { ...PLACEHOLDER };
  const avgD = displayValue(key, avgC, units);
  const avgText = formatAvg(key, avgD, units);
  const plain = { text: `avg ${avgText}`, tone: null, delta: null, avg: `avg ${avgText}`, spoken: `Average ${avgText}` };
  const curC = number(key, cur);
  if (curC === null || !hasRows(key, cur) || Math.abs(avgD) < 1e-9) return plain;

  const curD = displayValue(key, curC, units);
  const diff = curD - avgD;
  const pct = diff / Math.abs(avgD) * 100;
  const dir = betterFor(key, units);
  const side = diff > 0 ? "above" : "below";
  const sign = diff > 0 ? "+" : MINUS;
  const same = `Same as average ${avgText}`;
  let delta, spokenCore, tone;
  switch (metric(key).delta) {
    case "pct": {
      const whole = Math.min(Math.round(Math.abs(pct)), 999);
      tone = toneOf(dir, diff, Math.abs(pct) < DEADBAND_PCT);
      if (whole === 0) { delta = "0%"; spokenCore = same; }
      else { delta = `${sign}${whole}%`; spokenCore = `${whole} percent ${side} average ${avgText}`; }
      break;
    }
    case "count": {
      const n = fmtCount(Math.abs(diff));
      tone = toneOf(dir, diff, Math.abs(pct) < DEADBAND_PCT);
      if (n === fmtCount(0)) { delta = n; spokenCore = same; }
      else { delta = `${sign}${n}`; spokenCore = `${n} ${side} average ${avgText}`; }
      break;
    }
    case "duration": {
      const minutes = Math.round(Math.abs(diff) / 60);
      tone = toneOf(dir, diff, Math.abs(pct) < DEADBAND_PCT);
      if (minutes === 0) { delta = tripDuration(0); spokenCore = same; }
      else { const n = tripDuration(minutes * 60); delta = `${sign}${n}`; spokenCore = `${n} ${side} average ${avgText}`; }
      break;
    }
    default: {
      const n = fixed(Math.abs(diff), 1);
      tone = toneOf(dir, diff, Math.abs(diff) < DEADBAND_POINTS);
      if (n === fixed(0, 1)) { delta = "0 pt"; spokenCore = same; }
      else { delta = `${sign}${n} pt`; spokenCore = `${n} points ${side} average ${avgText}`; }
    }
  }
  const verdict = tone === "better" ? ", better" : tone === "worse" ? ", worse" : "";
  return { text: `${delta} · avg ${avgText}`, tone, delta, avg: `avg ${avgText}`, spoken: spokenCore + verdict };
}

/**
 * The line above the grid naming what "avg" means, from the baselines of the nine tiles ON the grid
 * (RC:420-457). [running] defaults to the baselines' own .running (else plan.partial).
 */
export function caption(p, range, baselinesOfGrid, zone, running) {
  const bs = baselinesOfGrid || [];
  if (running === undefined) running = bs.running !== undefined ? bs.running : p.partial;
  const r = p.range;
  const unit = r === "day" ? "days" : r === "week" ? "weeks" : r === "month" ? "months"
    : (r === "year" || r === "ytd") ? "years" : `${p.spanDays}-day spans`;
  const counts = [...new Set(bs.filter((b) => b && b.avg !== null && b.avg !== undefined).map((b) => b.periods))];
  if (!counts.length) return `Not enough earlier ${unit} to compare yet`;
  const all = bs.every((b) => b && b.avg !== null && b.avg !== undefined);
  const n = counts.length === 1 && all ? counts[0] : null;
  const span = n === null ? `earlier ${unit}` : r === "custom" ? `the ${n} equal ${p.spanDays}-day spans before` : `the ${n} ${unit} before`;
  const oneYear = (r === "year" || r === "ytd") && counts.length === 1 && counts[0] === 1;
  const year = String(parts(p.windows[0].start, zone).y);
  if (!running) return oneYear ? `vs ${year}` : `vs avg of ${span}`;
  switch (r) {
    case "day": return `Today so far vs the same time on ${span}`;
    case "week": return `This week so far vs the same day in ${span}`;
    case "month": return `This month so far vs the same day in ${span}`;
    case "year": case "ytd": return oneYear ? `This year so far vs the same date in ${year}` : `This year so far vs the same date in ${span}`;
    default: return `So far vs the same day in ${span}`;
  }
}
