// TrueMile EV web: the Report tiles. Pure, DOM-free.
// Port of ui/report/ReportTileAggregate.kt (tileAggregate) and data/ReportMetrics.kt (the sixteen
// metrics, their labels, blurbs, values, canonical numbers, sums and "vs avg" properties), plus the
// screen's own strings for the two economy tiles (Reportscreen.kt:1186-1187, 1549).

import { dist, eff, economy, labels, isMetric, MPGE_FACTOR } from "./units.js";
import { fixed, money, tripDuration } from "./format.js";
import { aggregateEff } from "./rows.js";

export const BUILD = "2026-09-27.3";

/** A metric with no data to stand on: an em-dash, never a zero that reads as a measurement. */
export const NONE = "—";
export const TILE_COUNT = 9;

const C = (token) => `var(--m-${token})`;

/**
 * The sixteen metrics in the app's order (RM:57-73). key is what gets persisted: never rename one.
 * label(units) · blurb · color (CSS variable, RS:1577-1585) · kind add|ratio · delta pct|count|
 * duration|points · better higher|lower|neither|econ (econ: higher in MPGe, lower in Le/100km) ·
 * basis trip|measured|moving|charge|received (where the metric's history starts).
 */
export const METRICS = [
  { key: "trips", label: () => "Trips", blurb: "How many drives in range", token: "distance", kind: "add", delta: "count", better: "neither", basis: "trip" },
  { key: "distance", label: () => "Distance", blurb: "Distance driven in range", token: "distance", kind: "add", delta: "pct", better: "neither", basis: "trip" },
  { key: "trip_cost", label: () => "Trip Cost", blurb: "What those drives cost", token: "cost", kind: "add", delta: "pct", better: "lower", basis: "trip" },
  { key: "charges", label: () => "Charges", blurb: "How many charge sessions", token: "distance", kind: "add", delta: "count", better: "neither", basis: "charge" },
  { key: "charged", label: () => "Charged", blurb: "Energy the stations delivered", token: "charging", kind: "add", delta: "pct", better: "neither", basis: "charge" },
  { key: "charge_cost", label: () => "Charge Cost", blurb: "What charging cost", token: "cost", kind: "add", delta: "pct", better: "lower", basis: "charge" },
  { key: "used", label: () => "Used", blurb: "Energy the drives consumed", token: "power", kind: "add", delta: "pct", better: "neither", basis: "trip" },
  { key: "efficiency", label: (u) => labels(u).eff, blurb: "Distance per unit of energy, net of regen", token: "efficiency", kind: "ratio", delta: "pct", better: "higher", basis: "measured" },
  { key: "economy", label: (u) => labels(u).econ, blurb: "Gas-equivalent economy", token: "efficiency", kind: "ratio", delta: "pct", better: "econ", basis: "measured" },
  { key: "elapsed", label: () => "Elapsed", blurb: "Wall-clock time driving, including stops", token: "distance", kind: "add", delta: "duration", better: "neither", basis: "measured" },
  { key: "moving", label: () => "Moving", blurb: "Driving time with stopped time removed", token: "distance", kind: "add", delta: "duration", better: "neither", basis: "moving" },
  { key: "avg_speed", label: () => "Avg Speed", blurb: "Distance ÷ elapsed driving time", token: "distance", kind: "ratio", delta: "pct", better: "neither", basis: "measured" },
  { key: "received", label: () => "Received", blurb: "Energy the battery actually took", token: "charging", kind: "add", delta: "pct", better: "neither", basis: "received" },
  { key: "charge_efficiency", label: () => "Charge Eff", blurb: "Received ÷ delivered — the charging loss", token: "charging", kind: "ratio", delta: "points", better: "higher", basis: "received" },
  { key: "avg_per_kwh", label: () => "Avg $/kWh", blurb: "What a kilowatt-hour averaged", token: "cost", kind: "ratio", delta: "pct", better: "lower", basis: "charge" },
  { key: "avg_per_mi", label: (u) => `Avg $/${labels(u).dist}`, blurb: "What a mile of driving averaged", token: "cost", kind: "ratio", delta: "pct", better: "lower", basis: "trip" },
].map((m) => Object.freeze({ ...m, color: C(m.token) }));

export const KEYS = METRICS.map((m) => m.key);
const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export const metric = (key) => BY_KEY.get(key) || null;

/** RM:81-85: the nine the grid has always shown, in their long-standing positions. */
export const DEFAULT_TILES = ["trips", "distance", "trip_cost", "charges", "charged", "charge_cost", "used", "efficiency", "economy"];

/** ReportMetrics.better with the unit resolved: economy flips in Le/100km. */
export function betterFor(key, units) {
  const b = BY_KEY.get(key)?.better;
  return b === "econ" ? (isMetric(units) ? "lower" : "higher") : b;
}

export function emptyAgg() {
  return {
    tripCount: 0, chargeCount: 0, totalMiles: 0, totalKwhUsed: 0, totalCost: 0, totalChgKwh: 0,
    totalChgCost: 0, avgMiKwh: 0, avgMpge: 0, measuredMiles: 0, elapsedSec: 0, movingSec: 0,
    movingTripCount: 0, receivedKwh: 0, receivedBasisKwh: 0,
  };
}

/**
 * tileAggregate (RTA:18-73). [trips] arrive filtered the way the tiles filter (own drives, type
 * filter, window); [charges] are never type- or car-filtered. Totals keep every row; mi/kWh, MPGe and
 * every time figure use only the measured (not reconstructed) drives. Always pooled Σ/Σ.
 * movingSec is not in the cloud (no moving_sec column), so on the web it stays 0 and the Moving tile
 * reads "—"; the code reads t.movingSec anyway so the day the column lands nothing else changes.
 */
export function tileAggregate(trips, charges) {
  const a = emptyAgg();
  let mUsed = 0, mRegen = 0;
  for (const t of trips) {
    a.tripCount++;
    a.totalMiles += t.miles;
    a.totalKwhUsed += t.usedKwh;
    a.totalCost += t.cost;
    if (t.isReconciled) continue;
    a.measuredMiles += t.miles;
    mUsed += t.usedKwh;
    mRegen += t.regenKwh;
    a.elapsedSec += t.durationSec;
    const mv = t.movingSec || 0;
    if (mv > 0) { a.movingSec += mv; a.movingTripCount++; }
  }
  a.avgMiKwh = aggregateEff(a.measuredMiles, mUsed, mRegen) ?? 0;
  a.avgMpge = a.avgMiKwh * MPGE_FACTOR;
  for (const c of charges) {
    a.chargeCount++;
    a.totalChgKwh += c.totalKwh;
    a.totalChgCost += c.total;
    if (c.receivedKwh > 0) { a.receivedKwh += c.receivedKwh; a.receivedBasisKwh += c.totalKwh; }
  }
  return a;
}

/**
 * ReportMetrics.number (RM:321-340): the tile's figure as a canonical number (mi, kWh, $, seconds,
 * mph, mi/kWh, MPGe, percent, $/kWh, $/mi), null exactly when the tile prints "—", except efficiency
 * and economy, null at ≤ 0 (their tiles print 0).
 */
export function number(key, a) {
  switch (key) {
    case "trips": return a.tripCount;
    case "distance": return a.totalMiles;
    case "trip_cost": return a.totalCost;
    case "charges": return a.chargeCount;
    case "charged": return a.totalChgKwh;
    case "charge_cost": return a.totalChgCost;
    case "used": return a.totalKwhUsed;
    case "efficiency": return a.avgMiKwh > 0 ? a.avgMiKwh : null;
    case "economy": return a.avgMpge > 0 ? a.avgMpge : null;
    case "elapsed": return a.elapsedSec > 0 ? a.elapsedSec : null;
    case "moving": return a.movingTripCount > 0 && a.movingSec > 0 ? a.movingSec : null;
    case "avg_speed": return a.elapsedSec > 0 && a.measuredMiles > 0 ? a.measuredMiles / (a.elapsedSec / 3600) : null;
    case "received": return a.receivedKwh > 0 ? a.receivedKwh : null;
    case "charge_efficiency": return a.receivedBasisKwh > 0 && a.receivedKwh > 0 ? a.receivedKwh / a.receivedBasisKwh * 100 : null;
    case "avg_per_kwh": return a.totalChgKwh > 0 ? a.totalChgCost / a.totalChgKwh : null;
    case "avg_per_mi": return a.totalMiles > 0 ? a.totalCost / a.totalMiles : null;
    default: return null;
  }
}

/** ReportMetrics.additive (RM:298-311): the raw sum an additive metric adds up; 0 for a ratio. */
export function additive(key, a) {
  switch (key) {
    case "trips": return a.tripCount;
    case "distance": return a.totalMiles;
    case "trip_cost": return a.totalCost;
    case "charges": return a.chargeCount;
    case "charged": return a.totalChgKwh;
    case "charge_cost": return a.totalChgCost;
    case "used": return a.totalKwhUsed;
    case "elapsed": return a.elapsedSec;
    case "moving": return a.movingSec;
    case "received": return a.receivedKwh;
    default: return 0;
  }
}

/** The tile's value string (RM:180-225, plus the screen's economy strings RS:1186-1187). */
export function display(key, a, units) {
  const u = labels(units).dist;
  switch (key) {
    case "trips": return String(a.tripCount);
    case "distance": return `${fixed(dist(a.totalMiles, units), 1)} ${u}`;
    case "trip_cost": return money(a.totalCost);
    case "charges": return String(a.chargeCount);
    case "charged": return `${fixed(a.totalChgKwh, 1)} kWh`;
    case "charge_cost": return money(a.totalChgCost);
    case "used": return `${fixed(a.totalKwhUsed, 1)} kWh`;
    case "efficiency": return fixed(eff(a.avgMiKwh, units), 2);
    case "economy": return isMetric(units) ? fixed(economy(a.avgMpge, units), 1) : fixed(a.avgMpge, 0);
    case "elapsed": return a.elapsedSec > 0 ? tripDuration(a.elapsedSec) : NONE;
    case "moving": return a.movingTripCount > 0 && a.movingSec > 0 ? tripDuration(a.movingSec) : NONE;
    case "avg_speed": return a.elapsedSec > 0 && a.measuredMiles > 0
      ? `${fixed(dist(a.measuredMiles, units) / (a.elapsedSec / 3600), 0)} ${u}/h` : NONE;
    case "received": return a.receivedKwh > 0 ? `${fixed(a.receivedKwh, 1)} kWh` : NONE;
    case "charge_efficiency": return a.receivedBasisKwh > 0 && a.receivedKwh > 0
      ? `${fixed(a.receivedKwh / a.receivedBasisKwh * 100, 1)}%` : NONE;
    case "avg_per_kwh": return a.totalChgKwh > 0 ? money(a.totalChgCost / a.totalChgKwh, 3) : NONE;
    case "avg_per_mi": return a.totalMiles > 0 ? money(a.totalCost / dist(a.totalMiles, units), 3) : NONE;
    default: return NONE;
  }
}

/** The tile's label (the two economy labels follow the unit system). */
export const labelFor = (key, units) => BY_KEY.get(key)?.label(units) ?? key;

/**
 * ReportMetrics.parseSelection: exactly nine distinct keys. An unknown key or a short list falls back
 * to that POSITION's default; a duplicate the same way; if that default is taken, the first unused.
 */
export function parseTiles(str) {
  const keys = String(str ?? "").split(",").map((s) => s.trim()).filter((s) => s);
  const out = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    const k = keys[i];
    if (k && BY_KEY.has(k) && !out.includes(k)) out.push(k);
    else if (!out.includes(DEFAULT_TILES[i])) out.push(DEFAULT_TILES[i]);
    else out.push(KEYS.find((x) => !out.includes(x)));
  }
  return out;
}

export const encodeTiles = (tiles) => tiles.join(",");

/** ReportMetrics.swap: [key] lands in [slot]; if it was on another tile the two trade places. */
export function swapTiles(tiles, slot, key) {
  if (!(slot >= 0 && slot < tiles.length)) return tiles.slice();
  const out = tiles.slice();
  const existing = out.indexOf(key);
  if (existing >= 0 && existing !== slot) out[existing] = out[slot];
  out[slot] = key;
  return out;
}
/** The frozen name for swapTiles. */
export const swapTile = swapTiles;

// ── Section tile sets (web v2) ───────────────────────────────────────────────────────────────
// Each section's grid: [cols] columns, [count] tiles, drawn from [metrics] (the sixteen above, with
// their vs-avg lines) and [extras] (section figures the owning view supplies, no vs-avg line).
// Persisted per browser as "tm.tiles.<section>.<vehicle id>".

export const SECTION_TILES = Object.freeze({
  charge: Object.freeze({ cols: 3, count: 9,
    metrics: Object.freeze(["charges", "charged", "charge_cost", "avg_per_kwh", "received", "charge_efficiency"]),
    extras: Object.freeze(["dc_sessions", "home_share", "avg_session_kwh", "fees"]),
    defaults: Object.freeze(["charges", "charged", "charge_cost", "avg_per_kwh", "received", "charge_efficiency", "dc_sessions", "home_share", "avg_session_kwh"]) }),
  map: Object.freeze({ cols: 3, count: 9,
    metrics: Object.freeze(["distance", "elapsed", "trips", "trip_cost", "efficiency", "economy", "used", "avg_speed", "avg_per_mi", "moving"]),
    extras: Object.freeze(["journeys"]),
    defaults: Object.freeze(["distance", "elapsed", "trips", "journeys", "trip_cost", "efficiency", "used", "avg_speed", "avg_per_mi"]) }),
  financial: Object.freeze({ cols: 3, count: 9,
    metrics: Object.freeze(["charge_cost", "trip_cost", "avg_per_kwh", "avg_per_mi", "charged", "efficiency", "distance"]),
    extras: Object.freeze(["saved", "gas_equivalent", "home_cost", "public_cost", "fees"]),
    defaults: Object.freeze(["charge_cost", "trip_cost", "saved", "avg_per_mi", "avg_per_kwh", "gas_equivalent", "home_cost", "public_cost", "fees"]) }),
});

/** The keys a section's grid may show: its metrics, then its extras. [] for an unknown section. */
export function sectionKeys(section) {
  const cfg = SECTION_TILES[section];
  return cfg ? [...cfg.metrics, ...cfg.extras] : [];
}

/** True when [key] is one of the sixteen metrics (it has a vs-avg line); false for a section extra. */
export const isMetricKey = (key) => BY_KEY.has(key);

/** The storage key of a section's tiles for one vehicle. */
export const sectionTilesKey = (section, vehicleId) => `tm.tiles.${section}.${vehicleId || "all"}`;

/**
 * A stored "a,b,c" list for [section] -> exactly cfg.count distinct keys from metrics ∪ extras, in the
 * stored order; anything else (a short or long list, an unknown or repeated key) -> cfg.defaults (a copy).
 * An unknown section -> [].
 */
export function parseSectionTiles(str, section) {
  const cfg = SECTION_TILES[section];
  if (!cfg) return [];
  const allowed = new Set(sectionKeys(section));
  const keys = String(str ?? "").split(",").map((s) => s.trim()).filter((s) => s);
  const ok = keys.length === cfg.count && keys.every((k) => allowed.has(k)) && new Set(keys).size === keys.length;
  return ok ? keys : cfg.defaults.slice();
}
