// TrueMile EV web: Garage insights. Pure, DOM-free.
// Ports: InsightsEngine.rangeInsightFrom (InsightsEngine.kt:513-563; vectors EfficiencyFloorTest.kt),
// InsightsEngine.optimumChargeWindow (:429-434), InsightsScreen.RangeSection / tempBandLabel (the
// figures and their labels), VehicleProfileScreen.HvbSohTrend (:1328-1375) and TireSection's miles on
// a tire (current odometer − install odometer).

import { aggregateEff, netKwh } from "./rows.js";
import { temp as tempUnits } from "./units.js";
import { fixed } from "./format.js";

export const BUILD = "2026-09-30.1";

export const DEFAULT_PACK_KWH = 131;

const DAY = 86_400_000;

// ── odometer and tires ──────────────────────────────────────────────────────────────────────

/** The highest odometer the rows carry (trip end_odo, charge end_mileage), in miles; null when none. */
export function currentOdometer(trips, charges) {
  let best = 0;
  for (const t of trips || []) if (t.endOdo > best) best = t.endOdo;
  for (const c of charges || []) if (c.endMileage > best) best = c.endMileage;
  return best > 0 ? best : null;
}

/** Miles on a tire: current odometer − install odometer (never negative); null when either is unknown. */
export function tireMiles(installOdo, currentOdo) {
  const i = Number(installOdo), c = Number(currentOdo);
  if (!(i > 0) || !(c > 0)) return null;
  return Math.max(0, c - i);
}

// ── battery health trend ────────────────────────────────────────────────────────────────────

/**
 * SoH over time from the own, complete drives (car status "") whose avg SoH is in (0, 100], by date.
 * -> {points:[{date, soh}], enough, nowPct, deltaPct, months, caption, tone}
 *    caption "97.1% now · −0.4% over 11mo" (months = round(span / 30 days), dropped when 0);
 *    tone "caution" when the change is below −0.05, else "good". With fewer than 2 points enough is
 *    false and caption is "SoH trend appears after a few OBD drives."
 */
export function sohTrend(trips) {
  const points = (trips || [])
    .filter((t) => t.carStatus === "" && t.sohPct > 0 && t.sohPct <= 100)
    .map((t) => ({ date: t.date, soh: t.sohPct }))
    .sort((a, b) => a.date - b.date);
  if (points.length < 2) {
    return { points, enough: false, nowPct: null, deltaPct: null, months: 0, caption: "SoH trend appears after a few OBD drives.", tone: "good" };
  }
  const last = points[points.length - 1].soh;
  const delta = last - points[0].soh;
  const months = Math.round((points[points.length - 1].date - points[0].date) / (30 * DAY));
  const caption = `${fixed(last, 1)}% now · ${delta >= 0 ? "+" : ""}${fixed(delta, 1)}%` + (months > 0 ? ` over ${months}mo` : "");
  return { points, enough: true, nowPct: last, deltaPct: delta, months, caption, tone: delta < -0.05 ? "caution" : "good" };
}

// ── your real range ─────────────────────────────────────────────────────────────────────────

/** InsightsEngine.TEMP_BANDS (°F; lower bound inclusive, upper exclusive). */
export const TEMP_BANDS = Object.freeze([
  Object.freeze({ key: "below32", lo: -Infinity, hi: 32 }),
  Object.freeze({ key: "32to50", lo: 32, hi: 50 }),
  Object.freeze({ key: "50to70", lo: 50, hi: 70 }),
  Object.freeze({ key: "70to85", lo: 70, hi: 85 }),
  Object.freeze({ key: "above85", lo: 85, hi: Infinity }),
]);

/** Efficiency.aggregate over trips: Σmiles / Σnet of the measured drives, 0 when degenerate. */
function effOf(list) {
  let mi = 0, used = 0, regen = 0;
  for (const t of list) {
    if (t.isReconciled) continue;
    mi += t.miles; used += t.usedKwh; regen += t.regenKwh;
  }
  return aggregateEff(mi, used, regen) ?? 0;
}

/**
 * InsightsEngine.rangeInsightFrom over the own, complete drives of one vehicle ([trips] already
 * filtered to car status ""), plus the full-charge range. null when no drive qualifies.
 * Qualifying = not reconstructed, net kWh > 0.3, distance > 1 mi.
 * -> {overall, milesPerSoc, totalTrips, socTripCount, byTemp:[{key, eff, trips}], highway:{eff, trips}|null,
 *     local:{eff, trips}|null, hvacPenaltyPct:number|null, pack, fullRangeMi, fullRangeBasis:"soc"|"pack"}
 */
export function rangeInsight(trips, packKwh) {
  const q = (trips || []).filter((t) => !t.isReconciled && netKwh(t.usedKwh, t.regenKwh) > 0.3 && t.miles > 1);
  if (!q.length) return null;
  const tempOk = (t) => t.outsideF > -80 && t.outsideF !== 0;
  const byTemp = [];
  for (const b of TEMP_BANDS) {
    const inBand = q.filter((t) => tempOk(t) && t.outsideF >= b.lo && t.outsideF < b.hi);
    if (inBand.length >= 2) byTemp.push({ key: b.key, eff: effOf(inBand), trips: inBand.length });
  }
  const share = (t) => { const tot = t.hwyMi + t.localMi; return tot > 0 ? t.hwyMi / tot : null; };
  const hw = q.filter((t) => { const s = share(t); return s !== null && s >= 0.6; });
  const lc = q.filter((t) => { const s = share(t); return s !== null && s <= 0.4; });
  const hvacHigh = q.filter((t) => t.hvacPct >= 20);
  const hvacLow = q.filter((t) => t.hvacPct >= 0 && t.hvacPct <= 5);
  let hvacPenaltyPct = null;
  if (hvacHigh.length >= 3 && hvacLow.length >= 3 && effOf(hvacLow) > 0) {
    const p = (1 - effOf(hvacHigh) / effOf(hvacLow)) * 100;
    hvacPenaltyPct = p > 0.5 ? p : null;
  }
  const socTrips = q.filter((t) => t.startSocPct > 0 && t.endSocPct > 0 && t.startSocPct - t.endSocPct >= 5);
  const drop = socTrips.reduce((s, t) => s + (t.startSocPct - t.endSocPct), 0);
  const milesPerSoc = drop > 0 ? socTrips.reduce((s, t) => s + t.miles, 0) / drop : 0;
  const overall = effOf(q);
  const pack = Number(packKwh) > 0 ? Number(packKwh) : DEFAULT_PACK_KWH;
  return {
    overall,
    milesPerSoc,
    totalTrips: q.length,
    socTripCount: socTrips.length,
    byTemp,
    highway: hw.length >= 2 ? { eff: effOf(hw), trips: hw.length } : null,
    local: lc.length >= 2 ? { eff: effOf(lc), trips: lc.length } : null,
    hvacPenaltyPct,
    pack,
    fullRangeMi: milesPerSoc > 0 ? milesPerSoc * 100 : overall * pack,
    fullRangeBasis: milesPerSoc > 0 ? "soc" : "pack",
  };
}

/**
 * InsightsEngine.optimumChargeWindow: from 15 % to the learned curve's knee (half power, else holds
 * to), clamped to 35..90; 80 without a curve. [curveInsight] = lib/curve.js poolCurve's result.
 */
export function roadTripWindow(curveInsight) {
  const from = 15;
  const knee = curveInsight ? (curveInsight.halfPowerSoc ?? curveInsight.holdsToSoc ?? null) : null;
  const to = knee === null || knee === undefined || !Number.isFinite(Number(knee))
    ? 80 : Math.min(90, Math.max(from + 20, Number(knee)));
  return { from, to };
}

/**
 * InsightsEngine.curveKwAt (no anchor scaling): kW at [soc], linear between buckets, ~4 % per 1 %-SoC
 * decay past the last learned bucket, capped at [ceilingKw], never below 8 kW. [sorted] by SoC.
 */
function curveKwAt(sorted, maxBucketSoc, soc, ceilingKw) {
  let below = sorted[0], above = sorted[sorted.length - 1];
  for (const p of sorted) if (p[0] <= soc) below = p;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i][0] >= soc) above = sorted[i];
  let kw = above[0] === below[0] ? below[1] : below[1] + (above[1] - below[1]) * ((soc - below[0]) / (above[0] - below[0]));
  if (soc > maxBucketSoc) kw *= Math.pow(0.96, soc - maxBucketSoc);
  return Math.max(8, Math.min(ceilingKw, kw));
}

/**
 * InsightsEngine.integrateChargeMinutes: minutes to go [fromSoc]→[toSoc] on a [packKwh] pack over
 * [curve] = [[socPct, kW]…] in 1 %-SoC steps. Null on a curve under 3 points or an empty window.
 */
export function integrateChargeMinutes(curve, ceilingKw, fromSoc, toSoc, packKwh) {
  if (!Array.isArray(curve) || curve.length < 3 || !(toSoc > fromSoc) || !(packKwh > 0)) return null;
  const sorted = curve.slice().sort((a, b) => a[0] - b[0]);
  const maxBucketSoc = Math.max(...sorted.map((p) => p[0]));
  let minutes = 0, s = fromSoc;
  while (s < toSoc) {
    const step = Math.min(1, toSoc - s);
    minutes += (packKwh * step / 100) / curveKwAt(sorted, maxBucketSoc, s + step / 2, ceilingKw) * 60;
    s += step;
  }
  return minutes;
}

/**
 * InsightsEngine.optimumChargeMinutes: the road-trip window's charge time on the learned curve (bucket
 * midpoints = bucket start + 2.5, the median kW), capped at 1.05 × the vehicle's learned peak. Null
 * until a curve is learned. [curveInsight] = lib/curve.js poolCurve's result.
 */
export function optimumChargeMinutes(curveInsight, packKwh, fromSoc, toSoc) {
  if (!curveInsight || !Array.isArray(curveInsight.buckets) || !(curveInsight.peakKw > 0)) return null;
  const curve = curveInsight.buckets.map((b) => [b.socPct + 2.5, b.medianKw]);
  return integrateChargeMinutes(curve, curveInsight.peakKw * 1.05, fromSoc, toSoc, packKwh);
}

/** The miles between fast-charge stops: window × pack × highway efficiency (else overall). */
export function roadTripRangeMi(r, win) {
  if (!r || !win) return 0;
  const frac = Math.min(1, Math.max(0, (win.to - win.from) / 100));
  const e = r.highway ? r.highway.eff : r.overall;
  return frac * r.pack * e;
}

/** The app's band label in the user's unit: "< 32°", "32°–50°", …, "> 85°" (whole degrees, truncated). */
export function tempBandLabel(key, units) {
  const t = (f) => `${Math.trunc(tempUnits(f, units))}°`;
  switch (key) {
    case "below32": return `< ${t(32)}`;
    case "32to50": return `${t(32)}–${t(50)}`;
    case "50to70": return `${t(50)}–${t(70)}`;
    case "70to85": return `${t(70)}–${t(85)}`;
    case "above85": return `> ${t(85)}`;
    default: return String(key);
  }
}
