// TrueMile EV web | lib/series.js | pure: bucketed time series for the Charts page.
// Every bucket IS a Dashboard period: buckets(b, n) = periodWindow(b, now, −k) for k = n−1..0, and each
// bucket's aggregate is tileAggregate over the same rows the tiles would sum, so a chart point equals
// the Dashboard tile for that period and offset by construction (SPEC 7.2).
import { periodWindow, rangeValueLabel } from "./periods.js";
import { tileAggregate } from "./metrics.js";
import { temp } from "./units.js";
import { dateFmt } from "./format.js";

export const BUILD = "2026-09-27.3";

export const BUCKETS = ["day", "week", "month", "year"];
export const BUCKET_LABELS = { day: "Day", week: "Week", month: "Month", year: "Year" };
export const DEFAULT_N = { day: 30, week: 26, month: 24, year: 5 };
export const MAX_N = { day: 90, week: 104, month: 60, year: 10 };

const SHORT = { day: "MMM d", week: "MMM d", month: "MMM yyyy", year: "yyyy" };

/** Clamp a requested bucket count to 1..MAX_N (default when missing or not a number). */
export function clampN(bucket, n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_N[bucket] || 30;
  return Math.min(v, MAX_N[bucket] || 90);
}

/**
 * The n buckets, oldest first: {start, end, label (short axis label), long (the Dashboard's range
 * label for that period), offset}.
 */
export function buckets(bucket, n, nowMs, zone) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const off = -k;
    const win = periodWindow(bucket, nowMs, off, zone);
    out.push({
      start: win.start,
      end: win.end,
      offset: off,
      label: dateFmt(win.start, SHORT[bucket] || "MMM d", zone),
      long: rangeValueLabel(bucket, win, nowMs, zone),
    });
  }
  return out;
}

/**
 * One tileAggregate per bucket. `trips` must already be the tile trips of the scope (own drives, type
 * filter applied); `charges` the scope's visible charges. Membership is inclusive on both ends like
 * the tiles (RC:509-514).
 */
export function bucketAggs(bs, trips, charges) {
  // Filter in the rows' own order (no re-sort) so every float sum adds in the Dashboard's order.
  const t = trips || [], c = charges || [];
  return bs.map((b) => tileAggregate(
    t.filter((r) => r.date >= b.start && r.date <= b.end),
    c.filter((r) => r.date >= b.start && r.date <= b.end),
  ));
}

/**
 * Efficiency by outside temperature: measured (not reconstructed), non-degenerate drives with a
 * logged outside temperature (≠ 0 and > −80 °F), binned by 10 °F (5 °C in metric) in the viewer's unit,
 * pooled Σmiles / Σnet per bin; bins with fewer than 3 drives are dropped.
 * -> [{lo, hi, label, count, miles, netKwh, miPerKwh (canonical)}], coldest first.
 */
export function tempBins(trips, units) {
  const width = units === "metric" ? 5 : 10;
  const unit = units === "metric" ? "°C" : "°F";
  const bins = new Map();
  for (const t of trips || []) {
    if (t.isReconciled) continue;
    const f = Number(t.outsideF);
    if (!Number.isFinite(f) || f === 0 || f <= -80) continue;
    const miles = (t.hwyMi || 0) + (t.localMi || 0);
    const net = Math.max((t.usedKwh || 0) - (t.regenKwh || 0), 0);
    if (miles < 0.3 || net < 0.2) continue;             // EFF degenerate floor
    const v = temp(f, units);
    const lo = Math.floor(v / width) * width;
    const b = bins.get(lo) || { lo, hi: lo + width, count: 0, miles: 0, used: 0, regen: 0 };
    b.count++; b.miles += miles; b.used += t.usedKwh || 0; b.regen += t.regenKwh || 0;
    bins.set(lo, b);
  }
  return [...bins.values()]
    .filter((b) => b.count >= 3)
    .sort((a, b) => a.lo - b.lo)
    .map((b) => {
      const netKwh = Math.max(b.used - b.regen, 0);
      const ok = !(b.miles < 0.3 || netKwh < 0.2);
      return {
        lo: b.lo, hi: b.hi, count: b.count, miles: b.miles, netKwh,
        label: `${b.lo} to ${b.hi} ${unit}`,
        miPerKwh: ok ? b.miles / netKwh : null,
      };
    })
    .filter((b) => b.miPerKwh != null);
}

/**
 * Parked drain points: PHANTOM_LOSS rows with a real ambient temperature (not flagged missing).
 * -> [{epoch, ambientF, kwhPerHour, kwh, parkHours}] (canonical °F).
 */
export function drainPoints(parked) {
  const out = [];
  for (const p of parked || []) {
    if (p.type !== "PHANTOM_LOSS") continue;
    if (p.ambientF == null || !Number.isFinite(Number(p.ambientF)) || p.tempMissing) continue;
    // An unknown rate (null: no parked hours to divide by) is not a zero-drain measurement.
    if (p.kwhPerHour === null || p.kwhPerHour === undefined || !(Number(p.parkHours) > 0)) continue;
    const kph = Number(p.kwhPerHour);
    if (!Number.isFinite(kph)) continue;
    out.push({ epoch: p.epoch, ambientF: Number(p.ambientF), kwhPerHour: kph, kwh: p.kwh || 0, parkHours: p.parkHours || 0 });
  }
  return out;
}

/** Running total; a null or non-number adds nothing (the total carries). */
export function cumulative(values) {
  let s = 0;
  return (values || []).map((v) => { if (typeof v === "number" && Number.isFinite(v)) s += v; return s; });
}

/** Pooled efficiency over several aggregates (Σ measured miles / Σ net, EFF floors) or null. */
export function pooledEff(trips) {
  let miles = 0, used = 0, regen = 0;
  for (const t of trips || []) {
    if (t.isReconciled) continue;
    miles += (t.hwyMi || 0) + (t.localMi || 0); used += t.usedKwh || 0; regen += t.regenKwh || 0;
  }
  const net = Math.max(used - regen, 0);
  return miles < 0.3 || net < 0.2 ? null : miles / net;
}
