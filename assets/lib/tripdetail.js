// TrueMile EV web: the trip detail field model. Pure, DOM-free.
//
// Ports the numbers behind ui/report/TripDetailScreen.kt: the start instant fallback (TD:751-753), the
// capacity the trip was costed with (TD:738), the Start SoC fallback plus the driven-before-connection
// add-back (TD:741-746), the odometer rule (data/TripOdometer.kt) with the "distance sources differ"
// check (TD:833-868), the attribution window for parked rows (TD:359-400, DB:708-711, DB:2190-2193)
// and the same-day paging (TD:208-247).

export const BUILD = "2026-09-27.3";

export const DEFAULT_PACK_KWH = 131;
const RETIRED_MILES = 0.005;

const n0 = (v) => Number(v) || 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cmpId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

/** Start instant: start_epoch, else END − duration. */
export function startEpochOf(t) {
  return n0(t.startEpoch) > 0 ? n0(t.startEpoch) : n0(t.date) - n0(t.durationSec) * 1000;
}

/** The pack the trip was costed with: pack_kwh_at_finalize > 0, else the vehicle's pack, else 131. */
export function packFor(t, vehicle) {
  if (n0(t.packAtFinalize) > 0) return n0(t.packAtFinalize);
  const v = vehicle ? n0(vehicle.packKwh) : 0;
  return v > 0 ? v : DEFAULT_PACK_KWH;
}

/**
 * Start SoC (percent): start_soc_pct when > 0, else clamp(end + (used − regen)/pack × 100, 0, 100);
 * then the driven-before-connection energy is added back and clamped again.
 */
export function startSocPct(t, packKwh, preObdKwh = 0) {
  const obd = n0(t.startSocPct) > 0 ? n0(t.startSocPct)
    : clamp(n0(t.endSocPct) + (n0(t.usedKwh) - n0(t.regenKwh)) / packKwh * 100, 0, 100);
  return clamp(obd + n0(preObdKwh) / packKwh * 100, 0, 100);
}

/** TripOdometer.isRetiredReconstruction. */
export function isRetiredReconstruction(t) {
  return !!t.isReconciled && n0(t.miles) < RETIRED_MILES;
}

/** TripOdometer.spanMiles: null unless both readings are real, in order, and not a retired row. */
export function spanMiles(startOdo, endOdo, retired = false) {
  if (retired) return null;
  if (!(startOdo > 0) || !(endOdo > 0)) return null;      // NaN-safe
  if (endOdo < startOdo) return null;
  return endOdo - startOdo;
}

export function tripSpanMiles(t) {
  return spanMiles(Number(t.startOdo), Number(t.endOdo), isRetiredReconstruction(t));
}

/**
 * The odometer row: null when the span is unknown. warn = {diffMi, odoMi, recordedMi} when
 * |span − miles| > max(0.3, 5 % of span) and the drive recorded any distance (miles, canonical).
 */
export function odometer(t) {
  const span = tripSpanMiles(t);
  if (span === null) return null;
  const miles = n0(t.miles);
  const diff = Math.abs(span - miles);
  const warn = miles > 0 && diff > Math.max(0.3, 0.05 * span) ? { diffMi: diff, odoMi: span, recordedMi: miles } : null;
  return { startOdo: n0(t.startOdo), endOdo: n0(t.endOdo), spanMi: span, warn };
}

/** HVAC kWh = used × clamp(hvac %, 0, 100) / 100 (TD, rollup.ts:209). */
export function hvacKwh(t) {
  return n0(t.usedKwh) * clamp(n0(t.hvacPct), 0, 100) / 100;
}

/**
 * The previous drive's END: MAX(date) < this drive's start among the same vehicle's drives whose car
 * status is not "other" (prevTripEndEpoch); 0 when there is none (open low bound).
 */
export function prevTripEnd(t, trips) {
  const startMs = startEpochOf(t);
  let best = 0;
  for (const o of trips) {
    if (o.vehicleId !== t.vehicleId || o.carStatus === "other") continue;
    if (o.date < startMs && o.date > best) best = o.date;
  }
  return best;
}

/**
 * The parked rows attributed to this drive: event in (previous END, this END], same vehicle.
 * -> {prevEnd, preObdKwh, preObdCost, idleKwh, idleCost, hvacKwh, hvacCost, parkedKwh, parkedCost, rows}
 */
export function parkedWindow(t, trips, parked) {
  const prevEnd = prevTripEnd(t, trips);
  const rows = parked.filter((p) => p.vehicleId === t.vehicleId && p.epoch > prevEnd && p.epoch <= t.date);
  const sum = (type, f) => rows.filter((r) => r.type === type).reduce((s, r) => s + n0(r[f]), 0);
  const out = {
    prevEnd, rows,
    preObdKwh: sum("PRE_OBD_DRIVE", "kwh"), preObdCost: sum("PRE_OBD_DRIVE", "cost"),
    idleKwh: sum("PHANTOM_LOSS", "kwh"), idleCost: sum("PHANTOM_LOSS", "cost"),
    hvacKwh: sum("PARKED_HVAC", "kwh"), hvacCost: sum("PARKED_HVAC", "cost"),
  };
  out.parkedKwh = out.idleKwh + out.hvacKwh;
  out.parkedCost = out.idleCost + out.hvacCost;
  return out;
}

/**
 * The drive's day for ◀ ▶ paging: the same vehicle's drives of every car status whose END falls on
 * the same local day, chronological. dayStart / dayEnd are the local midnights ([start, next start)).
 * -> {list, index, count, allCars, prevId, nextId}
 */
export function dayNeighbors(t, trips, dayStart, nextDayStart) {
  const list = trips.filter((o) => o.vehicleId === t.vehicleId && o.date >= dayStart && o.date < nextDayStart)
    .sort((a, b) => (a.date - b.date) || cmpId(a, b));
  if (!list.some((o) => o.id === t.id)) list.push(t);
  const index = Math.max(0, list.findIndex((o) => o.id === t.id));
  return {
    list, index, count: list.length,
    allCars: list.some((o) => (o.carStatus ?? "") !== ""),
    prevId: index > 0 ? list[index - 1].id : null,
    nextId: index < list.length - 1 ? list[index + 1].id : null,
  };
}

/** Per-drive $/mi (canonical): cost / miles; null without distance. */
export function dollarsPerMile(t) {
  const mi = n0(t.miles);
  return mi > 0 ? n0(t.cost) / mi : null;
}

/** Detail MPGe: TRUNCATED (TD:715-717); null without a ratio. */
export function detailMpge(eff) {
  return eff === null || eff === undefined || !(eff > 0) ? null : Math.trunc(eff * 33.705);
}
