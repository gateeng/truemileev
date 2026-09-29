// TrueMile EV web | lib/csv.js | pure: the Report CSV and the My-data CSV, byte for byte the app's
// (Reportscreen.kt exportReport RS:2868-2995, exportMyData RS:2759-2859), plus the derived per-session
// columns (TripRepository.kt:1650-1697). Numbers are formatted like Java's String.format("%.nf") in
// Locale.US: the shortest decimal form of the double rounded HALF-UP, a negative sign kept on a value
// that rounds to zero. Line endings "\n", UTF-8 without a BOM (the caller makes the Blob).
import { dist, speed, eff, temp, labels } from "./units.js";
import { dateFmt } from "./format.js";
import { tripEff, isDc, carCell, classLabel } from "./rows.js";

export const BUILD = "2026-09-29.2";

// ── Java-compatible "%.nf" ────────────────────────────────────────────────────────────────────
function incDigits(s) {
  const a = s.split("");
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === "9") { a[i] = "0"; i--; } else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); return a.join(""); }
  }
  return "1" + a.join("");
}

/** String.format(Locale.US, "%.{n}f", v) as the JVM prints it (shortest digits, HALF_UP). */
export function jfix(v, n) {
  v = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  const neg = v < 0 || Object.is(v, -0);
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(Math.abs(v).toString());
  let D = m[1] + (m[2] || "");
  let point = m[1].length + (m[3] ? Number(m[3]) : 0);
  const lz = D.match(/^0*/)[0].length;
  if (lz === D.length) { D = ""; point = 0; } else { D = D.slice(lz); point -= lz; }
  // value = 0.D × 10^point; keep `point + n` digits, round half-up on the next one
  const keep = point + n;
  let digits;
  if (!D || keep < 0) digits = "0";
  else {
    let head = D.slice(0, keep).padEnd(keep, "0");
    const next = keep < D.length ? D[keep] : "0";
    if (next >= "5") head = incDigits(head || "0");
    digits = head || "0";
  }
  digits = digits.replace(/^0+(?=\d)/, "");
  let out = digits;
  if (n > 0) {
    digits = digits.padStart(n + 1, "0");
    out = digits.slice(0, digits.length - n) + "." + digits.slice(digits.length - n);
  }
  return (neg ? "-" : "") + out;
}

/**
 * RS:2741-2749: a leading = + - @ or TAB gets a "'" (formula-injection guard); the value is quoted
 * (inner quotes doubled) when it holds a comma, quote, CR or LF.
 */
export function esc(value) {
  const s = value == null ? "" : String(value);
  const f = s.charAt(0);
  const v = f === "=" || f === "+" || f === "-" || f === "@" || f === "\t" ? "'" + s : s;
  return /[,"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// ── derived per-session columns ───────────────────────────────────────────────────────────────
function frac(v) { const x = Number(v) || 0; return x > 1 ? x / 100 : x; }   // Soc.toFraction (Soc.kt:20)

/**
 * TripRepository.kt:1656-1697 over ONE vehicle's visible sessions in date asc, id asc order:
 * energyUsed = max(0, (prevDep − arr) × pack), the first session's prevDep = 0;
 * miPerKwh = energyUsed > 0 ? max(0, end − start) / energyUsed : 0.
 */
export function chargeDerived(chargesAscOfVehicle, packKwh) {
  const out = new Map();
  const rows = (chargesAscOfVehicle || []).slice().sort((a, b) => (a.date - b.date) || cmpId(a.id, b.id));
  let prevDep = 0;
  for (const c of rows) {
    const arr = c.arr != null ? c.arr : frac(c.arrPct);
    const dep = c.dep != null ? c.dep : frac(c.depPct);
    const energyUsed = Math.max(0, (frac(prevDep) - frac(arr)) * packKwh);
    prevDep = dep;
    const actual = Math.max(0, (c.endMileage || 0) - (c.startMileage || 0));
    out.set(c.id, { energyUsed, miPerKwh: energyUsed > 0 ? actual / energyUsed : 0 });
  }
  return out;
}
function cmpId(a, b) { return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }

/** Derived columns for every vehicle of an account: sessions grouped per vehicle, each with its pack. */
export function derivedForAccount(charges, vehicles) {
  const byV = new Map();
  for (const c of charges || []) {
    if (!byV.has(c.vehicleId)) byV.set(c.vehicleId, []);
    byV.get(c.vehicleId).push(c);
  }
  const out = new Map();
  for (const [vid, list] of byV) {
    const v = (vehicles || []).find((x) => x.id === vid);
    const pack = (v && v.packKwh) || 131;
    for (const [id, d] of chargeDerived(list, pack)) out.set(id, d);
  }
  return out;
}

// The CSV writers print `v > 1 ? v : v × 100` of the stored SoC (RS:2835, 2963). rows.normCharge's
// arrPct / depPct (Soc.kt:28: 0 <= v <= 1 ? v × 100 : v) is that same number for every non-negative v,
// computed from the raw value (never a fraction multiplied back), so it is used as is.
function csvPct(v) { v = Number(v) || 0; return v > 1 ? v : v * 100; }
function arrPctOf(c) { return c.arrPct != null ? c.arrPct : csvPct(c.arr); }
function depPctOf(c) { return c.depPct != null ? c.depPct : csvPct(c.dep); }

function newestFirst(list) {
  return (list || []).slice().sort((a, b) => b.date - a.date);   // stable: ties keep the input order
}

// ── file names ────────────────────────────────────────────────────────────────────────────────
export const CAR_SUFFIX = { all: "", other: "_other-cars", ask: "_needs-answer" };
export const CAR_HEADER = { all: null, other: "Other cars", ask: "Waiting for a car" };

/** The type slug: each label lowercased with [^a-z0-9] removed, empty ones dropped, "-" joined (RS:2891-2893). */
export function typeSlug(typeLabels) {
  return (typeLabels || [])
    .map((l) => String(l).toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((s) => s.length > 0)
    .map((s) => "-" + s).join("");
}

export function reportFileName({ fromMs, toMs, typeLabels, carFilter = "all", allVehicles = false, zone }) {
  return `TrueMileEV_Report_${dateFmt(fromMs, "yyyyMMdd", zone)}_${dateFmt(toMs, "yyyyMMdd", zone)}` +
    `${typeSlug(typeLabels)}${CAR_SUFFIX[carFilter] || ""}${allVehicles ? "_all-vehicles" : ""}.csv`;
}

// ── Report CSV ────────────────────────────────────────────────────────────────────────────────
/**
 * reportCsv({trips, charges, units, win:{start,end,allTime?}, typeLabels, carFilter, vehicleNameOf,
 *            packOf, derived, zone, allVehicles}) -> {name, text} | null (nothing to export)
 * `trips` are the listed rows already bounded to the window; `charges` the scope's visible charges in the
 * window. `derived` = Map<chargeId, {energyUsed, miPerKwh}> from the vehicle's WHOLE history
 * (derivedForAccount); when absent it is rebuilt from the given charges with packOf(vehicleId).
 */
export function reportCsv(o) {
  const trips = o.trips || [], charges = o.charges || [];
  if (!trips.length && !charges.length) return null;
  const zone = o.zone;
  const units = o.units || "imperial";
  const L = labels(units);
  const dL = L.dist, sL = L.speed, eL = L.eff, tL = L.temp;
  const carFilter = o.carFilter || "all";
  const typeLabels = o.typeLabels || [];
  const nameOf = o.vehicleNameOf || (() => "");

  let fromMs = o.win.start;
  if (o.win.allTime || !(fromMs > 0)) {
    const ds = [...trips, ...charges].map((r) => r.date).filter((d) => d > 0);
    if (ds.length) fromMs = Math.min(...ds);
  }
  const toMs = o.win.end;
  const name = reportFileName({ fromMs, toMs, typeLabels, carFilter, allVehicles: !!o.allVehicles, zone });

  let derived = o.derived;
  if (!derived) {
    derived = new Map();
    const byV = new Map();
    for (const c of charges) { if (!byV.has(c.vehicleId)) byV.set(c.vehicleId, []); byV.get(c.vehicleId).push(c); }
    for (const [vid, list] of byV) {
      for (const [id, d] of chargeDerived(list, (o.packOf && o.packOf(vid)) || 131)) derived.set(id, d);
    }
  }

  const rowFmt = (ms) => dateFmt(ms, "MM/dd/yy HH:mm", zone);
  let w = "";
  if (typeLabels.length) w += `# Filtered to trip types: ${typeLabels.join(", ")}\n`;
  if (CAR_HEADER[carFilter]) w += `# Car: ${CAR_HEADER[carFilter]}\n`;
  w += "=== TRIPS ===\n";
  w += `Date,Avg Speed (${sL}),Highway (${dL}),Local (${dL}),Total (${dL}),${eL},` +
       `Cost,Avg SoH%,Used kWh,Regen kWh,Regen (${dL}),End SoC%,HVAC%,` +
       `Avg Outside Temp (${tL}),Avg Cabin Temp (${tL}),Duration (s),Journey,Category,Car\n`;
  for (const t of newestFirst(trips)) {
    const mi = (t.hwyMi || 0) + (t.localMi || 0);
    const e = tripEff(t);
    const effCell = e == null ? "" : jfix(eff(e, units), 3);
    w += `${rowFmt(t.date)},` +
      `${jfix(speed(t.avgSpeedMph || 0, units), 1)},` +
      `${jfix(dist(t.hwyMi || 0, units), 2)},` +
      `${jfix(dist(t.localMi || 0, units), 2)},` +
      `${jfix(dist(mi, units), 2)},` +
      `${effCell},` +
      `${jfix(t.cost || 0, 2)},` +
      `${jfix(t.sohPct || 0, 1)},` +
      `${jfix(t.usedKwh || 0, 3)},` +
      `${jfix(t.regenKwh || 0, 3)},` +
      `${jfix(dist(t.regenMi || 0, units), 2)},` +
      `${jfix(t.endSocPct || 0, 1)},` +
      `${jfix(t.hvacPct || 0, 1)},` +
      `${jfix(temp(t.outsideF || 0, units), 1)},` +
      `${jfix(temp(t.cabinF || 0, units), 1)},` +
      `${durationCell(t.durationSec)},` +
      `${esc(t.journeyId || "")},` +
      `${esc(t.journeyName || "")},${esc(carCell(t, nameOf(t)))}\n`;
  }
  w += "\n=== CHARGES ===\n";
  w += `Date,Network,Start Odometer (${dL}),End Odometer (${dL}),Actual (${dL}),Arr SoC%,Dep SoC%,` +
       `Energy Used kWh,Time (min),Charger Fee,Rate/h,Rate/kWh,Total kWh,Total $,` +
       `Cost/kWh,${eL},Style,Temp (${tL}),AC%,GPS\n`;
  for (const c of newestFirst(charges)) {
    const d = derived.get(c.id) || { energyUsed: 0, miPerKwh: 0 };
    w += `${rowFmt(c.date)},` +
      `${esc(c.network || "")},` +
      `${jfix(dist(c.startMileage || 0, units), 2)},` +
      `${jfix(dist(c.endMileage || 0, units), 2)},` +
      `${jfix(dist(c.actualMiles || 0, units), 2)},` +
      `${jfix(arrPctOf(c), 1)}%,` +
      `${jfix(depPctOf(c), 1)}%,` +
      `${jfix(d.energyUsed, 3)},` +
      `${jfix(c.timeMin || 0, 1)},` +
      `${jfix(c.fee || 0, 2)},` +
      `${jfix(c.ratePerHour || 0, 3)},` +
      `${jfix(c.ratePerKwh || 0, 3)},` +
      `${jfix(c.totalKwh || 0, 3)},` +
      `${jfix(c.total || 0, 2)},` +
      `${jfix(c.costPerKwh || 0, 4)},` +
      `${jfix(eff(d.miPerKwh, units), 3)},` +
      `${esc(c.style || "")},` +
      `${jfix(temp(c.tempF || 0, units), 1)},` +
      `${jfix(c.acPct || 0, 1)},` +
      `${esc(c.gps || "")}\n`;
  }
  return { name, text: w };
}

function durationCell(sec) {
  const v = Number(sec) || 0;
  return String(Math.trunc(v));   // Kotlin Long interpolation
}

// ── My data CSV ───────────────────────────────────────────────────────────────────────────────
// TripOdometer.kt: a retired reconstruction (reconstructed AND < 0.005 mi) has no odometer of its own.
function retired(t) { return !!t.isReconciled && ((t.hwyMi || 0) + (t.localMi || 0)) < 0.005; }
function spanKnown(t) {
  if (retired(t)) return false;
  if (!(t.startOdo > 0) || !(t.endOdo > 0)) return false;
  return t.endOdo >= t.startOdo;
}
export function chainStart(t) { return !retired(t) && t.startOdo > 0 ? t.startOdo : null; }
export function chainEnd(t) { return spanKnown(t) ? t.endOdo : null; }

function vehicleName(v) {
  return [v && v.year ? String(v.year) : "", v && v.make, v && v.model].filter((s) => s && String(s).trim()).join(" ");
}

/** The declared charger type (ChargeConfidence.canonicalChargerType), else the AC/DC inference. */
export function chargeTypeCell(c) {
  const t = String(c.chargerType || "").trim().toUpperCase();
  let canon = "";
  if (t === "DC" || t === "DCFC" || t.startsWith("DC ") || t === "DC_FAST") canon = "DC";
  else if (t === "AC" || t === "L1" || t === "L2" || t.startsWith("LEVEL")) canon = "AC";
  return canon || (isDc(c) ? "DC" : "AC");
}

/**
 * myDataCsv({vehicle, trips, charges, routes, todayMs, zone, vehicleName?}) -> {name, text}
 * The full history of ONE vehicle: every car status's drives (each named in the last column) and its
 * visible sessions. Raw units (mi, °F). Route = the drive's polyline (Map<tripId, string>).
 */
export function myDataCsv(o) {
  const zone = o.zone;
  const trips = o.trips || [], charges = o.charges || [];
  const vName = o.vehicleName != null ? o.vehicleName : vehicleName(o.vehicle);
  const routes = o.routes || new Map();
  const rowFmt = (ms) => dateFmt(ms, "yyyy-MM-dd HH:mm", zone);
  const name = `TrueMileEV_MyData_${dateFmt(o.todayMs, "yyyyMMdd", zone)}.csv`;
  const derived = chargeDerived(charges, (o.vehicle && o.vehicle.packKwh) || 131);

  let w = `=== TRIPS (${trips.length}) ===\n`;
  w += "Start,End,Duration (s),Highway (mi),Local (mi),Total (mi),Avg Speed (mph)," +
       "Used kWh,Regen kWh,Regen (mi),Start SoC%,End SoC%,Start Odo (mi),End Odo (mi)," +
       "HVAC%,Outside Temp (F),Cabin Temp (F),Class,Journey,Category,Route,Source,Car\n";
  for (const t of newestFirst(trips)) {
    const start = t.startEpoch > 0 ? rowFmt(t.startEpoch) : "";
    const os = chainStart(t), oe = chainEnd(t);
    const cls = t.classification ? classLabel(t.classification) : (t.tripClass || "");
    const route = routes instanceof Map ? routes.get(t.id) : routes[t.id];
    w += `${esc(start)},${rowFmt(t.date)},${durationCell(t.durationSec)},` +
      `${jfix(t.hwyMi || 0, 2)},${jfix(t.localMi || 0, 2)},` +
      `${jfix((t.hwyMi || 0) + (t.localMi || 0), 2)},` +
      `${jfix(t.avgSpeedMph || 0, 1)},${jfix(t.usedKwh || 0, 3)},` +
      `${jfix(t.regenKwh || 0, 3)},${jfix(t.regenMi || 0, 2)},` +
      `${jfix(t.startSocPct || 0, 1)},${jfix(t.endSocPct || 0, 1)},` +
      `${os != null ? jfix(os, 1) : ""},${oe != null ? jfix(oe, 1) : ""},` +
      `${jfix(t.hvacPct || 0, 1)},${jfix(t.outsideF || 0, 1)},` +
      `${jfix(t.cabinF || 0, 1)},` +
      `${esc(cls || "")},${esc(t.journeyId || "")},` +
      `${esc(t.journeyName || "")},${esc(route || "")},` +
      `${t.isReconciled ? "odometer" : "logged"},${esc(carCell(t, vName))}\n`;
  }
  w += `\n=== CHARGES (${charges.length}) ===\n`;
  w += "Date,Network,Type,Arr SoC%,Dep SoC%,Time (min),Total kWh,Energy Used kWh," +
       "Charger Fee $,Rate $/h,Rate $/kWh,Paid $,Start Odo (mi),End Odo (mi),Temp (F),GPS," +
       "Charger kW,Notes,Edited,Source\n";
  for (const c of newestFirst(charges)) {
    const d = derived.get(c.id) || { energyUsed: 0 };
    const kw = c.chargerKw > 0 ? jfix(c.chargerKw, 1) : "";
    const edited = c.edited > 0 ? rowFmt(c.edited) : "";
    const source = c.lowConfidence ? "unconfirmed" : "confirmed";
    w += `${rowFmt(c.date)},${esc(c.network || "")},${chargeTypeCell(c)},` +
      `${jfix(arrPctOf(c), 1)},${jfix(depPctOf(c), 1)},${jfix(c.timeMin || 0, 1)},` +
      `${jfix(c.totalKwh || 0, 3)},${jfix(d.energyUsed, 3)},` +
      `${jfix(c.fee || 0, 2)},${jfix(c.ratePerHour || 0, 3)},` +
      `${jfix(c.ratePerKwh || 0, 3)},${jfix(c.total || 0, 2)},` +
      `${jfix(c.startMileage || 0, 1)},${jfix(c.endMileage || 0, 1)},` +
      `${jfix(c.tempF || 0, 1)},${esc(c.gps || "")},` +
      `${kw},${esc(c.notes || "")},${edited},${source}\n`;
  }
  return { name, text: w };
}
