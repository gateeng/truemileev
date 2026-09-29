// TrueMile EV web: cloud row normalisers and the per-row rules every page shares. Pure, DOM-free.
//
// Sources: CloudTripRow.kt / CloudChargeRow.kt (restore mapping), Soc.kt, Efficiency.kt, OtherCar.kt,
// OtherCarCopy.kt, TripClassification.kt, ClassificationUi.kt, ReportCarFilter.kt, TierGate.isDcFast
// (= supabase/functions/_shared/rollup.ts isDcFastRow), TripDetailScreen.kt:738-746.

import { dist, labels } from "./units.js";
import { fixed, dateFmt } from "./format.js";

export const BUILD = "2026-09-29.2";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v) => (v === null || v === undefined ? "" : String(v));
const blankToNull = (v) => { const s = str(v).trim(); return s === "" || s === "null" ? null : s; };
const bool = (v) => v === true || v === "true" || v === 1 || v === "t";

// ── Efficiency (EFF:16-77) ─────────────────────────────────────────────────────────────────────
export const MIN_NET_KWH = 0.2;
export const MIN_MILES = 0.3;
export const netKwh = (used, regen) => Math.max(used - regen, 0);
export const isDegenerate = (miles, net) => miles < MIN_MILES || net < MIN_NET_KWH;
/** Efficiency.aggregate: Σmiles / Σnet, null when the window is degenerate. */
export function aggregateEff(sumMiles, sumUsed, sumRegen) {
  const net = netKwh(sumUsed, sumRegen);
  return isDegenerate(sumMiles, net) ? null : sumMiles / net;
}

// ── Car status (OtherCar.kt, OtherCarCopy.kt) ─────────────────────────────────────────────────
export const CAR_THIS = "", CAR_ASK = "ask", CAR_OTHER = "other";
export const DEFAULT_CAR_LABEL = "Another car";
/** OtherCar.normStatus: blank → this vehicle; a known value → itself; anything else → ask. */
export function normStatus(raw) {
  const v = str(raw).trim();
  if (v === "") return CAR_THIS;
  if (v === CAR_ASK || v === CAR_OTHER) return v;
  return CAR_ASK;
}
/** OtherCar.normLabel: trimmed, at most 60 characters, blank → "Another car". */
export function normLabel(raw) {
  const v = str(raw).trim().slice(0, 60);
  return v.trim() === "" ? DEFAULT_CAR_LABEL : v;
}

// ── Row normalisers ───────────────────────────────────────────────────────────────────────────

/** A cloud trip_log row (the section 3.2 projection) → Trip. date is the trip's END instant. */
export function normTrip(r) {
  const hwy = num(r.highway_miles), local = num(r.local_miles);
  const cid = str(r.client_trip_id);
  return {
    id: str(r.id),
    vehicleId: str(r.vehicle_id),
    clientTripId: cid,
    date: num(r.date_epoch),
    startEpoch: num(r.start_epoch),
    durationSec: num(r.duration_sec),
    hwyMi: hwy,
    localMi: local,
    miles: hwy + local,
    regenMi: num(r.regen_miles),
    usedKwh: num(r.used_kwh),
    regenKwh: num(r.regen_kwh),
    cost: num(r.cost_dollars),
    avgSpeedMph: num(r.avg_speed_mph),
    sohPct: num(r.avg_soh_pct),
    startSocPct: num(r.start_soc_pct),
    endSocPct: num(r.end_soc_pct),
    hvacPct: num(r.hvac_pct),
    outsideF: num(r.avg_outside_temp_f),
    cabinF: num(r.avg_cabin_temp_f),
    startOdo: num(r.start_odo),
    endOdo: num(r.end_odo),
    towLbs: num(r.tow_weight_lbs),
    tripClass: blankToNull(r.trip_class),
    classification: blankToNull(r.classification),
    autoAssigned: bool(r.auto_assigned),
    journeyId: blankToNull(r.journey_id),
    journeyName: blankToNull(r.journey_category),
    isReconciled: bool(r.is_reconciled) || cid.startsWith("recon:") || cid.startsWith("gapfill:"),
    carStatus: normStatus(r.car_status),
    otherCarLabel: normLabel(r.other_car_label),
    packAtFinalize: num(r.pack_kwh_at_finalize),
    gasPrice: num(r.gas_price_at_trip),
  };
}

/** Soc.toFraction: a value above 1 is a legacy percent. */
export const socFraction = (v) => (v > 1 ? v / 100 : v);
/** Soc.toPercent: the display percent from either encoding. */
export const socPercent = (v) => (v >= 0 && v <= 1 ? v * 100 : v);

/** A cloud charge_session row → Charge. */
export function normCharge(r) {
  const arrRaw = num(r.arrival_soc_pct), depRaw = num(r.departure_soc_pct);
  const network = str(r.network);
  const timeMin = num(r.time_minutes);
  const declared = str(r.charger_type).trim().toUpperCase();
  return {
    id: str(r.id),
    vehicleId: str(r.vehicle_id),
    date: num(r.date_epoch),
    timeMin,
    startMileage: num(r.start_mileage),
    endMileage: num(r.end_mileage),
    actualMiles: num(r.actual_miles),
    arr: socFraction(arrRaw),
    dep: socFraction(depRaw),
    arrPct: socPercent(arrRaw),
    depPct: socPercent(depRaw),
    totalKwh: num(r.total_kwh),
    receivedKwh: num(r.received_kwh),
    total: num(r.total_dollars),
    fee: num(r.charger_fee),
    ratePerKwh: num(r.rate_per_kwh),
    ratePerHour: num(r.rate_per_hour),
    overridden: bool(r.total_overridden),
    costPerKwh: num(r.cost_per_kwh),
    network,
    style: str(r.style),
    gps: str(r.gps_location).trim(),
    tempF: num(r.temp_f),
    acPct: num(r.ac_pct),
    gasPrice: num(r.gas_price_at_charge),
    isMerged: bool(r.is_merged),
    isSplit: bool(r.split_session),
    splitGroup: blankToNull(r.split_session_group_id),
    isSeed: bool(r.is_seed_data) || (network === "Pre-install" && timeMin === 0),
    edited: num(r.edited_epoch),
    lowConfidence: str(r.confidence).trim().toLowerCase() === "low",
    notes: str(r.notes),
    chargerType: declared === "AC" || declared === "DC" ? declared : "",
    chargerKw: num(r.charger_power_kw),
  };
}

/** A cloud phantom_losses row (cost already aliased from the internal column) → Parked. */
export function normParked(r) {
  const amb = r.ambient_temp_f;
  return {
    id: str(r.id),
    vehicleId: str(r.vehicle_id),
    type: str(r.entry_type).trim().toUpperCase(),
    epoch: num(r.event_epoch),
    kwh: num(r.kwh),
    cost: num(r.cost),
    parkHours: num(r.park_hours),
    ambientF: amb === null || amb === undefined || amb === "" || !Number.isFinite(Number(amb)) ? null : Number(amb),
    tempMissing: bool(r.temp_data_missing),
    hvacMode: str(r.hvac_mode),
    // A generated column, NULL when park_hours is 0 (0027): an unknown rate stays null, never 0.
    kwhPerHour: r.kwh_per_hour === null || r.kwh_per_hour === undefined || r.kwh_per_hour === "" ||
      !Number.isFinite(Number(r.kwh_per_hour)) ? null : Number(r.kwh_per_hour),
  };
}

/** A cloud vehicles row → Vehicle (counts filled in by the loader). pack = GS:113-119. */
export function normVehicle(r) {
  return {
    id: str(r.id),
    year: num(r.year),
    make: str(r.make).trim(),
    model: str(r.model).trim(),
    trim: str(r.trim).trim(),
    packKwh: num(r.pack_size_kwh) || num(r.battery_kwh) || 131,
    /** The pack as stored (pack_size_kwh, else battery_kwh); 0 when the cloud has neither. */
    packKwhStored: num(r.pack_size_kwh) || num(r.battery_kwh),
    isActive: bool(r.is_active),
    createdAt: r.created_at ? Date.parse(r.created_at) || 0 : 0,
    tripCount: 0,
    chargeCount: 0,
  };
}

/** Date asc, then id asc (date_epoch has ties; id is the stable tiebreak). */
export function byDateThenId(a, b) {
  return a.date - b.date || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ── Vehicle label ─────────────────────────────────────────────────────────────────────────────

function baseLabel(v) {
  const s = [v.year > 0 ? String(v.year) : "", v.make, v.model].filter((x) => x).join(" ");
  return s || "Vehicle";
}

/**
 * "yyyy Make Model" (the nickname is phone-only); when another vehicle of [all] shares that name,
 * " · added MMM yyyy" (or the full date when even the month is shared). [zone] defaults to UTC.
 */
export function vehicleLabel(v, all = [], zone = "UTC") {
  const base = baseLabel(v);
  const twins = all.filter((o) => o.id !== v.id && baseLabel(o) === base);
  if (!twins.length || !v.createdAt) return base;
  const month = dateFmt(v.createdAt, "MMM yyyy", zone);
  const monthShared = twins.some((o) => o.createdAt && dateFmt(o.createdAt, "MMM yyyy", zone) === month);
  return `${base} · added ${monthShared ? dateFmt(v.createdAt, "MMM d, yyyy", zone) : month}`;
}

// ── Trip types (TripClassification.kt, ClassificationUi.kt) ──────────────────────────────────
export const UNCLASSIFIED = "unclassified";
export const BUILT_IN_TYPES = [
  { id: "business", label: "Business" },
  { id: "leisure", label: "Leisure" },
  { id: "commute", label: "Commute" },
  { id: "personal", label: "Personal" },
];

/** TripClassification.labelFor; null / "unclassified" read "Unclassified" here. */
export function classLabel(id) {
  if (id === null || id === undefined || id === UNCLASSIFIED) return "Unclassified";
  if (id.startsWith("custom:")) return id.slice(7);
  const b = BUILT_IN_TYPES.find((t) => t.id === id);
  if (b) return b.label;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** classificationColor (ClassificationUi.kt:49-55); unclassified gets a neutral slate. */
export function classColor(id) {
  switch (id) {
    case "business": return "#22C55E";
    case "personal": return "#3B82F6";
    case "commute": return "#F59E0B";
    case "leisure": return "#A855F7";
    case null: case undefined: case UNCLASSIFIED: return "#94A3B8";
    default: return "#14B8A6";
  }
}

export const typeKey = (trip) => trip.classification ?? UNCLASSIFIED;

/** The type filter's items: the four built-ins, every other id seen in [trips] by label, then Unclassified. */
export function typeOptions(trips) {
  const seen = new Map();
  for (const t of trips) {
    const id = t.classification;
    if (id && !BUILT_IN_TYPES.some((b) => b.id === id) && !seen.has(id)) seen.set(id, classLabel(id));
  }
  const extra = [...seen.entries()].map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "en-US") || (a.id < b.id ? -1 : 1));
  return [...BUILT_IN_TYPES.map((t) => ({ ...t })), ...extra, { id: UNCLASSIFIED, label: "Unclassified" }];
}

/** The type filter itself: an empty set passes every trip. */
export function typeFilter(trips, selected) {
  if (!selected || selected.size === 0) return trips;
  return trips.filter((t) => selected.has(typeKey(t)));
}

// ── Per-trip figures ──────────────────────────────────────────────────────────────────────────
export const tripNet = (t) => netKwh(t.usedKwh, t.regenKwh);
/** Efficiency.miPerKwh: null for a reconstructed or degenerate drive. */
export function tripEff(t) {
  if (t.isReconciled) return null;
  const net = tripNet(t);
  return isDegenerate(t.miles, net) ? null : t.miles / net;
}
/** RS:1708-1713: negligible distance AND negligible energy. */
export const isShort = (t) => t.miles < MIN_MILES && t.usedKwh < 0.5;

/**
 * TD:738-746: the recorded start SoC, else end SoC + net energy / pack (clamped), then the energy
 * driven before the adapter connected added back (clamped). pack = the trip's frozen pack, else the
 * vehicle's.
 */
export function socStartPctForDetail(t, packKwh, preObdKwh = 0) {
  const pack = t.packAtFinalize > 0 ? t.packAtFinalize : (packKwh > 0 ? packKwh : 131);
  const clamp = (v) => Math.min(100, Math.max(0, v));
  const obd = t.startSocPct > 0 ? t.startSocPct : clamp(t.endSocPct + (t.usedKwh - t.regenKwh) / pack * 100);
  return clamp(obd + preObdKwh / pack * 100);
}

// ── Charges ───────────────────────────────────────────────────────────────────────────────────
/** TierGate.isDcFast / rollup.isDcFastRow: a declared type wins, else the ≥20 kW inference. */
export function isDc(c) {
  if (c.chargerType === "DC") return true;
  if (c.chargerType === "AC") return false;
  const tm = c.timeMin, kwh = c.totalKwh;
  return c.network.toLowerCase() !== "home" && tm > 0 && (tm >= 10 || kwh >= 5) && kwh / (tm / 60) >= 20;
}
export const isHome = (c) => /^home$/i.test(c.network.trim());

// ── Scope and car filters (ReportCarFilter.kt) ────────────────────────────────────────────────
export const inScope = (row, scope) => !scope || scope.id === "all" || row.vehicleId === scope.id;
export const ownTrips = (trips) => trips.filter((t) => t.carStatus === CAR_THIS);

/** "all" keeps every car; "other" / "ask" keep only those drives. */
export function carFilter(trips, f) {
  if (f === "other") return trips.filter((t) => t.carStatus === CAR_OTHER);
  if (f === "ask") return trips.filter((t) => t.carStatus === CAR_ASK);
  return trips;
}

/**
 * ReportCarFilter.listFor: the listed rows. "Needs an answer" adds the scope's unanswered drives from
 * outside the range: the OLDEST 20, as TripLogDao.getAskTrips reads them (ORDER BY date ASC LIMIT 20),
 * per vehicle; the result is each drive once, newest first.
 */
export function listFor(rangeTrips, scopeTrips, f) {
  if (f !== "ask") return carFilter(rangeTrips, f);
  const extra = [];
  const byVehicle = new Map();
  for (const t of scopeTrips) {
    if (t.carStatus !== CAR_ASK) continue;
    if (!byVehicle.has(t.vehicleId)) byVehicle.set(t.vehicleId, []);
    byVehicle.get(t.vehicleId).push(t);
  }
  for (const rows of byVehicle.values()) extra.push(...[...rows].sort(byDateThenId).slice(0, 20));
  const seen = new Set();
  const out = [];
  for (const t of [...carFilter(rangeTrips, "ask"), ...extra]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.sort((a, b) => b.date - a.date || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** SuggestionEngine.whichCarDistance: one decimal and the unit. */
export const distanceText = (mi, units) => `${fixed(dist(mi, units), 1)} ${labels(units).dist}`;

/** ReportCarFilter.counts. */
export function carCounts(trips) {
  const mine = trips.filter((t) => t.carStatus === CAR_THIS);
  const others = trips.filter((t) => t.carStatus === CAR_OTHER);
  const asks = trips.filter((t) => t.carStatus === CAR_ASK);
  const sum = (rows) => rows.reduce((s, t) => s + t.miles, 0);
  const by = new Map();
  for (const t of others) {
    const k = normLabel(t.otherCarLabel);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }
  const otherByLabel = [...by.entries()].map(([label, rows]) => ({ label, count: rows.length, miles: sum(rows) }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return {
    vehicle: mine.length, other: others.length, ask: asks.length,
    vehicleMiles: sum(mine), otherMiles: sum(others), askMiles: sum(asks),
    otherByLabel, hasCarRows: others.length + asks.length > 0,
  };
}

/** OtherCarCopy.tilesCaption. */
export const tilesCaption = (vehicleName, askCount) =>
  askCount > 0 ? `${vehicleName} only · ${askCount} not counted` : `${vehicleName} only`;

/** ReportCarFilter.otherLines: the header, then one line per car name. */
export function otherLines(counts, units) {
  if (counts.other === 0) return [];
  return [`Other cars · ${counts.other} trips · ${distanceText(counts.otherMiles, units)}`,
    ...counts.otherByLabel.map((l) => `${l.label} · ${l.count} · ${distanceText(l.miles, units)}`)];
}

/** ReportCarFilter.askLine over the listed drives; null when none waits. */
export function askLine(listed, units) {
  const asks = listed.filter((t) => t.carStatus === CAR_ASK);
  if (!asks.length) return null;
  return `Not counted yet · ${asks.length} drives · ${distanceText(asks.reduce((s, t) => s + t.miles, 0), units)}`;
}

/** ReportCarFilter.carCell: the vehicle's name, "Other car: <label>" or "Waiting for a car". */
export function carCell(t, vehicleName) {
  if (t.carStatus === CAR_OTHER) return `Other car: ${normLabel(t.otherCarLabel)}`;
  if (t.carStatus === CAR_ASK) return "Waiting for a car";
  return vehicleName;
}

// ── Garage rows (web v2): door-jamb specs, trailers, home charger, tires, trouble-code scans ────

/**
 * The door-jamb label keys the page may read (DoorJambSpecs.kt). Never the VIN, the raw OCR texts or
 * the parser's confidence map: those are not in this list and never selected or kept.
 */
export const JAMB_KEYS = Object.freeze([
  "mfgDate", "gvwrKg", "gvwrLbs", "gawrFrontKg", "gawrFrontLbs", "gawrRearKg", "gawrRearLbs",
  "tireFront", "tireRear", "tireSpare", "rimFront", "rimRear",
  "tirePressureFrontPsi", "tirePressureRearPsi", "tirePressureSparePsi",
  "tirePressureFrontKpa", "tirePressureRearKpa", "tirePressureSpareKpa",
  "seatingTotal", "seatingFront", "seatingRear", "combinedWeightKg", "combinedWeightLbs",
  "paintCode", "trimCode", "madeIn", "userConfirmed",
]);
const JAMB_TEXT = new Set(["mfgDate", "tireFront", "tireRear", "tireSpare", "rimFront", "rimRear", "paintCode", "trimCode", "madeIn"]);

/** A finite number, or null (a blank, "null", or anything unreadable). */
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "" || v === "null" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Only the JAMB_KEYS of a raw door_jamb_specs blob (the fixture path: every other key is dropped). */
export function projectJamb(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of JAMB_KEYS) if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = raw[k];
  return out;
}

/**
 * Door-jamb specs from the "jamb_<key>" aliases of a vehicles row, or from a projected object. Numbers
 * are finite Numbers or null, texts trimmed or null, userConfirmed a boolean. null when every field is
 * null (nothing scanned yet).
 */
export function normJamb(row) {
  if (!row || typeof row !== "object") return null;
  const pick = (k) => (Object.prototype.hasOwnProperty.call(row, "jamb_" + k) ? row["jamb_" + k] : row[k]);
  const out = {};
  let any = false;
  for (const k of JAMB_KEYS) {
    const v = pick(k);
    if (k === "userConfirmed") { out[k] = bool(v); continue; }
    out[k] = JAMB_TEXT.has(k) ? blankToNull(v) : numOrNull(v);
    if (out[k] !== null) any = true;
  }
  return any ? out : null;
}

/** The app's stored trailer type names (TrailerType, TowSheet.kt labels) -> a plain label. */
export function trailerTypeLabel(type) {
  switch (str(type).trim().toUpperCase().replace(/[\s-]+/g, "_")) {
    case "UTILITY": case "CARGO": return "Utility";
    case "ENCLOSED": case "ENCLOSED_CARGO": return "Enclosed cargo";
    case "FLATBED": return "Flatbed";
    case "TRAVEL": case "TRAVEL_TRAILER": return "Travel trailer";
    case "FIFTH_WHEEL": case "5TH_WHEEL": return "5th wheel";
    case "BOAT": return "Boat";
    default: return "Other";
  }
}

/** One trailer of user_settings.settings.trailers[] -> the eleven keys the page uses (others dropped). */
export function normTrailer(o) {
  const t = o && typeof o === "object" ? o : {};
  return {
    clientId: str(t.clientId).trim(),
    name: str(t.name).trim(),
    type: trailerTypeLabel(t.type),
    trailerLbs: numOrNull(t.trailerLbs),
    payloadLbs: numOrNull(t.payloadLbs),
    towHaul: bool(t.towHaul),
    w: numOrNull(t.w),
    d: numOrNull(t.d),
    h: numOrNull(t.h),
    dryLbs: numOrNull(t.dryLbs),
    loadedLbs: numOrNull(t.loadedLbs),
  };
}

/** The home charger of user_settings.settings.home (never its location). */
export function normHome(o) {
  const t = o && typeof o === "object" ? o : {};
  return { has: bool(t.has), brand: blankToNull(t.brand), model: blankToNull(t.model) };
}

/** Tire positions (GarageEntities.kt TirePosition / TrailerTirePosition), in display order. */
export const TIRE_POSITIONS = Object.freeze({
  FL: "Front left", FR: "Front right", RL: "Rear left", RR: "Rear right", SPARE: "Spare",
  T_L1: "Left · axle 1", T_R1: "Right · axle 1", T_L2: "Left · axle 2", T_R2: "Right · axle 2", T_SPARE: "Spare",
});
const TIRE_ORDER = Object.keys(TIRE_POSITIONS);
/** Sort key of a tire position (unknown positions last). */
export const tireOrder = (pos) => { const i = TIRE_ORDER.indexOf(pos); return i < 0 ? TIRE_ORDER.length : i; };

/** A tire_records row -> Tire. mounted = no removal date. */
export function normTire(r) {
  const position = str(r.position).trim().toUpperCase();
  const removed = numOrNull(r.removed_epoch);
  const repair = numOrNull(r.repair_epoch);
  return {
    id: str(r.id),
    vehicleId: blankToNull(r.vehicle_id),
    trailerId: blankToNull(r.trailer_client_id),
    position,
    positionLabel: TIRE_POSITIONS[position] || position || "Tire",
    brand: str(r.brand).trim(),
    model: str(r.model).trim(),
    size: str(r.size_spec).trim(),
    dot: blankToNull(r.manufacture_date),
    installMs: num(r.install_epoch),
    installOdo: num(r.install_odo),
    repairMs: repair !== null && repair > 0 ? repair : 0,
    repairNote: blankToNull(r.repair_note),
    removedMs: removed !== null && removed > 0 ? removed : 0,
    mounted: !(removed !== null && removed > 0),
  };
}

/** A dtc_scans row -> Scan (codes as [{code, status, description}], status lower-cased). */
export function normDtc(r) {
  let codes = r.codes;
  if (typeof codes === "string") { try { codes = JSON.parse(codes); } catch (_) { codes = []; } }
  const list = Array.isArray(codes) ? codes : [];
  return {
    id: str(r.id),
    vehicleId: blankToNull(r.vehicle_id),
    scanMs: num(r.scan_epoch),
    odo: num(r.odo_miles),
    count: Math.max(0, Math.trunc(num(r.code_count))),
    codes: list.filter((c) => c && typeof c === "object").map((c) => ({
      code: str(c.code).trim(),
      status: str(c.status).trim().toLowerCase(),
      description: str(c.description).trim(),
    })),
  };
}
