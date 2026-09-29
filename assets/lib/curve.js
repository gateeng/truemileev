// TrueMile EV web: a charge session's curve series and the learned DC curve. Pure, DOM-free.
//
// sessionSeries ports parseChargeCurve (ChargeScreen.kt:3168-3199): Duration = minutes from the first
// point, Rate = power_kw, Received = trapezoidal ∫power dt, SoC, In Battery = soc/100 × pack, Batt Temp.
// learnDcCurve ports InsightsEngine.learnDcCurve (InsightsEngine.kt:111-226): the newest 16 non-Home
// sessions, each session's ±(time + 30 min) window, peak < 25 kW = not DC, per-point floors, epoch
// de-duplication across overlapping windows, 5 % SoC buckets, median/min/max, peak, holds-80 %, half power
// and the three pack-temperature bands. Curve rows are matched by TIME, never by session_id.

export const BUILD = "2026-09-29.2";

export const HALF_HOUR_MS = 30 * 60_000;
export const MAX_SESSIONS = 12;
export const DC_PEAK_KW = 25;

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/** One curve row as returned by api.chargeCurve (snake_case) or already camel-cased. */
export function normPoint(p) {
  return {
    epochMs: num(p.epochMs ?? p.epoch_ms),
    socPct: num(p.socPct ?? p.soc_pct),
    powerKw: num(p.powerKw ?? p.power_kw),
    battTempF: num(p.battTempF ?? p.batt_temp_f),
  };
}

/** The session's search window (CS:4636-4648): date ± (time_minutes × 60 000 + 30 min). */
export function curveWindow(charge) {
  const span = Math.trunc((Number(charge.timeMin) || 0) * 60_000) + HALF_HOUR_MS;
  const d = Number(charge.date) || 0;
  return { from: d - span, to: d + span };
}

/**
 * Sort by epoch and drop points within [minGapMs] of the previous KEPT point: two installs record the
 * same charge, and adjacent split legs' windows overlap. Points without an epoch are dropped.
 */
export function dedupe(points, minGapMs = 3000) {
  const pts = points.map(normPoint).filter((p) => Number.isFinite(p.epochMs));
  pts.sort((a, b) => a.epochMs - b.epochMs);
  const out = [];
  let last = -Infinity;
  for (const p of pts) {
    if (out.length && p.epochMs - last < minGapMs) continue;
    out.push(p);
    last = p.epochMs;
  }
  return out;
}

/**
 * The detail sheet's six series, one entry per point (sorted by epoch). A missing power reads 0 like
 * optDouble(…, 0.0); a missing SoC or temperature becomes null so the line breaks instead of dropping to 0.
 */
export function sessionSeries(points, packKwh) {
  const pts = points.map(normPoint).filter((p) => Number.isFinite(p.epochMs))
    .sort((a, b) => a.epochMs - b.epochMs);
  const out = { duration: [], rateKw: [], receivedKwh: [], socPct: [], inBatteryKwh: [], battTempF: [] };
  if (!pts.length) return out;
  const start = pts[0].epochMs;
  const pw = (p) => (Number.isFinite(p.powerKw) ? p.powerKw : 0);
  let received = 0, prevEpoch = start, prevPower = pw(pts[0]);
  for (const p of pts) {
    const power = pw(p);
    const dtHours = Math.max(0, p.epochMs - prevEpoch) / 3_600_000;
    received += (power + prevPower) / 2 * dtHours;
    prevEpoch = p.epochMs; prevPower = power;
    const soc = Number.isFinite(p.socPct) ? p.socPct : null;
    out.duration.push((p.epochMs - start) / 60_000);
    out.rateKw.push(power);
    out.receivedKwh.push(received);
    out.socPct.push(soc);
    out.inBatteryKwh.push(soc == null ? null : (soc / 100) * packKwh);
    out.battTempF.push(Number.isFinite(p.battTempF) ? p.battTempF : null);
  }
  return out;
}

/** InsightsEngine.tempBandIndex: 0 = <60 °F, 1 = 60–85 °F, 2 = >85 °F; null for NaN, 0 or < −40. */
export function tempBandIndex(tempF) {
  const t = Number(tempF);
  if (tempF === null || tempF === undefined || Number.isNaN(t)) return null;
  if (t === 0 || t < -40) return null;
  if (t < 60) return 0;
  if (t <= 85) return 1;
  return 2;
}

export const BAND_LABELS = ["Cold", "Mild", "Hot"];

/** InsightsEngine.bucketsFromPool: sorted kWs, median = kws[floor(n/2)], buckets under minSamples dropped. */
export function bucketsFromPool(byBucket, minSamples = 3) {
  const keys = [...byBucket.keys()].sort((a, b) => a - b);
  const out = [];
  for (const soc of keys) {
    const kws = [...byBucket.get(soc)].sort((a, b) => a - b);
    if (kws.length < minSamples) continue;
    out.push({ socPct: soc, medianKw: kws[Math.floor(kws.length / 2)], minKw: kws[0], maxKw: kws[kws.length - 1], samples: kws.length });
  }
  return out;
}

/** Candidate sessions (curveSessionCandidates): non-Home, newest first, the newest maxSessions + 4. */
export function dcCandidates(charges, maxSessions = MAX_SESSIONS) {
  return charges
    .filter((c) => String(c.network ?? "").toLowerCase() !== "home")
    .slice()
    .sort((a, b) => b.date - a.date)
    .slice(0, maxSessions + 4);
}

/**
 * The pooling core, synchronous: [windows] = one entry per candidate in candidate order, each an array
 * of that window's points, or null when its fetch failed. Returns the Insight or null.
 */
export function poolCurve(windows) {
  const byBucket = new Map();
  const byBand = [new Map(), new Map(), new Map()];
  const seen = new Set();
  let used = 0;
  const add = (m, k, v) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const raw of windows) {
    if (!raw || raw.length < 2) continue;
    const pts = raw.map(normPoint);
    let peak = 0;
    for (const p of pts) if (Number.isFinite(p.powerKw)) peak = Math.max(peak, p.powerKw);
    if (peak < DC_PEAK_KW) continue;
    used++;
    for (const p of pts) {
      const soc = p.socPct, kw = p.powerKw;
      if (!Number.isFinite(soc) || !Number.isFinite(kw)) continue;
      const floor = soc >= 85 ? 5 : 12;
      if (soc <= 0 || soc > 100 || kw < floor) continue;
      if (seen.has(p.epochMs)) continue;
      seen.add(p.epochMs);
      const bucket = Math.min(95, Math.max(0, Math.trunc(soc / 5) * 5));
      add(byBucket, bucket, kw);
      const band = tempBandIndex(p.battTempF);
      if (band !== null) add(byBand[band], bucket, kw);
    }
  }
  if (used === 0 || byBucket.size === 0) return null;
  const buckets = bucketsFromPool(byBucket);
  if (buckets.length < 3) return null;
  const bandBuckets = byBand.map((m) => bucketsFromPool(m));
  const peakKw = Math.max(...buckets.map((b) => b.medianKw));
  const peakIdx = buckets.findIndex((b) => b.medianKw === peakKw);
  let holdsToSoc = null;
  for (let i = peakIdx; i < buckets.length; i++) {
    if (buckets[i].medianKw >= peakKw * 0.8) holdsToSoc = buckets[i].socPct; else break;
  }
  const half = buckets.slice(peakIdx + 1).find((b) => b.medianKw <= peakKw * 0.5);
  return { buckets, sessionsUsed: used, peakKw, holdsToSoc, halfPowerSoc: half ? half.socPct : null, bandBuckets };
}

/**
 * learnDcCurve(charges of ONE vehicle, fetchWindow(fromMs, toMs) -> Promise<points>) -> Promise<Insight|null>.
 * Fetches run three at a time; results are pooled in candidate (newest-first) order, so the epoch
 * de-duplication keeps the same point the app keeps.
 */
export async function learnDcCurve(sessionsNewestFirst, fetchWindow, { maxSessions = MAX_SESSIONS, concurrency = 3 } = {}) {
  const cands = dcCandidates(sessionsNewestFirst, maxSessions);
  if (!cands.length) return null;
  const results = new Array(cands.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < cands.length) {
      const i = next++;
      const w = curveWindow(cands[i]);
      try { results[i] = (await fetchWindow(w.from, w.to)) || null; } catch (_) { results[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cands.length) }, worker));
  return poolCurve(results);
}

/** The buckets a band tab shows: the band's own when it has >= 3, else null (the tab is hidden). */
export function bandOf(insight, band) {
  if (!insight) return null;
  if (band === null || band === undefined || band === "all") return insight.buckets;
  const bb = insight.bandBuckets[band] || [];
  return bb.length >= 3 ? bb : null;
}
