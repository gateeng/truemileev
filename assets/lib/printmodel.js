// TrueMile EV web | lib/printmodel.js | pure: the Period report and Journey report models.
// Layout and figures follow the app's Period PDF (Reportscreen.kt exportReportPdf RS:3024-3263) with the
// web's two documented choices (SPEC 13.10): delivered energy is labelled "Energy charged", and Trip time
// is the Elapsed tile (measured own drives). Rows in, plain objects out; views/print.js only renders.
// The Report designer (lib/reportdesign.js) may drop blocks ({sections}) and columns ({tripCols,
// chargeCols}, column keys); without those options the model is exactly the app's layout.
import { tileAggregate } from "./metrics.js";
import { dist, eff, labels } from "./units.js";
import { dateFmt } from "./format.js";
import { tripEff, typeKey, inScope, classLabel, carCell } from "./rows.js";
import { jfix } from "./csv.js";
import { pickColumns } from "./reportdesign.js";

export const BUILD = "2026-09-27.3";

const KM = 1.609344;

/**
 * The rows a Report export covers (Report CSV and Period report alike, RS:2008-2076):
 * trips = the Dashboard's listed rows (all cars under "all", only "other" / only "ask" otherwise, type
 * filter applied) bounded to [start, end]; charges = the scope's visible charges in [start, end], never
 * type- or car-filtered. Both oldest first.
 */
export function selectRows({ trips, charges, scope, win, types, car = "all" }) {
  const typeSet = types instanceof Set ? types : new Set(types || []);
  const inWin = (r) => r.date >= win.start && r.date <= win.end;
  const tr = (trips || []).filter((t) =>
    inScope(t, scope) && inWin(t) &&
    (car === "all" ? true : car === "other" ? t.carStatus === "other" : car === "ask" ? t.carStatus === "ask" : t.carStatus === "") &&
    (typeSet.size === 0 || typeSet.has(typeKey(t))));
  const ch = (charges || []).filter((c) => inScope(c, scope) && inWin(c));
  return { trips: tr, charges: ch };
}

/** "All time": the report starts on the earliest exported row (RS:2012-2014). */
export function effectiveFrom(win, trips, charges) {
  if (!win.allTime && win.start > 0) return win.start;
  const ds = [...(trips || []), ...(charges || [])].map((r) => r.date).filter((d) => d > 0);
  return ds.length ? Math.min(...ds) : win.start;
}

function typeCell(t) {
  if (t.classification) return classLabel(t.classification);
  const legacy = String(t.tripClass || "").trim();
  return legacy || "—";
}

function durMin(totalMin) {
  const m = Math.max(0, Math.floor(totalMin));
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

/**
 * reportModel({trips, charges, fromMs, toMs, units, zone, typeLabels?, title?, subtitle?,
 *              notesByTrip?, derived?, vehicleNameOf?, sections?, tripCols?, chargeCols?})
 * -> {heading, dateLine, title, typesLine, subtitle, summary:[{label,value}], tripCols, tripRows,
 *     tripCount, hasCar, reconLines, notes:[{date, body}], chargeCols, chargeRows, chargeCount, empty,
 *     tripKeys, chargeKeys, tripColumns, chargeColumns, shown, fromYmd, toYmd}
 *  sections: {summary, trips, notes, charges} (each default true): an unselected block comes back empty
 *    (and shown[block] false); the reconstructed-drive footnote goes with the trips table.
 *  tripCols / chargeCols: the column keys to keep (null = all; "date" always stays; unknown keys ignored).
 *  tripColumns / chargeColumns: every column the table can have, [{key, label}], for a chooser.
 *  tripCount and chargeCount stay the real counts whatever is shown.
 */
export function reportModel(o) {
  const units = o.units || "imperial";
  const zone = o.zone;
  const L = labels(units);
  const trips = (o.trips || []).slice().sort((a, b) => b.date - a.date);
  const charges = (o.charges || []).slice().sort((a, b) => b.date - a.date);
  const rowFmt = (ms) => dateFmt(ms, "MM/dd/yy HH:mm", zone);
  const nameOf = o.vehicleNameOf || (() => "");
  const derived = o.derived || new Map();

  // Summary: this vehicle's own drives only; charges all.
  const own = trips.filter((t) => t.carStatus === "");
  const agg = tileAggregate(own, charges);
  const chgMin = charges.reduce((s, c) => s + (c.timeMin || 0), 0);
  const costPerMi = agg.totalMiles > 0 ? agg.totalCost / agg.totalMiles : 0;
  const summary = [
    { label: "Distance", value: `${jfix(dist(agg.totalMiles, units), 1)} ${L.dist}` },
    { label: "Trip time", value: durMin(agg.elapsedSec / 60) },
    { label: "Charge time", value: durMin(Math.round(chgMin)) },
    { label: "Energy used", value: `${jfix(agg.totalKwhUsed, 1)} kWh` },
    { label: "Energy charged", value: `${jfix(agg.totalChgKwh, 1)} kWh` },
    { label: "Trip cost", value: `$${jfix(agg.totalCost, 2)}` },
    { label: "Charge cost", value: `$${jfix(agg.totalChgCost, 2)}` },
    { label: `Avg ${L.eff}`, value: jfix(eff(agg.avgMiKwh || 0, units), 2) },
    { label: `Avg cost/${L.dist}`, value: `$${jfix(units === "metric" ? costPerMi / KM : costPerMi, 3)}` },
  ];

  const hasCar = trips.some((t) => t.carStatus !== "");
  const allTripCols = ["Date", `Dist (${L.dist})`, L.eff, "Cost", "Used kWh", "Regen kWh", "HVAC%", "SoH%", "Type"];
  const allTripKeys = ["date", "dist", "eff", "cost", "used", "regen", "hvac", "soh", "type"];
  if (hasCar) { allTripCols.push("Car"); allTripKeys.push("car"); }
  const sec = { summary: true, trips: true, notes: true, charges: true };
  const so = o.sections && typeof o.sections === "object" ? o.sections : {};
  for (const k of Object.keys(sec)) if (typeof so[k] === "boolean") sec[k] = so[k];
  const tIdx = pickColumns(allTripKeys, o.tripCols ?? null);
  const tripCols = tIdx.map((i) => allTripCols[i]);
  const tripRows = (sec.trips ? trips : []).map((t) => {
    const e = tripEff(t);
    const cells = [
      rowFmt(t.date),
      jfix(dist(t.miles != null ? t.miles : (t.hwyMi || 0) + (t.localMi || 0), units), 1),
      e == null ? "—" : jfix(eff(e, units), 2),
      `$${jfix(t.cost || 0, 2)}`,
      jfix(t.usedKwh || 0, 2),
      jfix(t.regenKwh || 0, 2),
      jfix(t.hvacPct || 0, 0),
      jfix(t.sohPct || 0, 0),
      typeCell(t),
    ];
    if (hasCar) cells.push(carCell(t, nameOf(t)));
    return { id: t.id, cells: tIdx.map((i) => cells[i]), own: t.carStatus === "", reconstructed: !!t.isReconciled };
  });
  const recon = trips.filter((t) => t.isReconciled).length;
  const reconLines = sec.trips && recon > 0 ? [
    `— ${recon} drive(s) reconstructed from the odometer between charges.`,
    `Distance and cost are recorded; energy is estimated, so no ${L.eff} is shown.`,
  ] : [];

  const notes = [];
  const nb = o.notesByTrip;
  if (nb && sec.notes) {
    for (const t of trips) {
      const list = t.clientTripId ? (nb instanceof Map ? nb.get(t.clientTripId) : nb[t.clientTripId]) : null;
      if (!list || !list.length) continue;
      for (const n of list) notes.push({ date: rowFmt(t.date), body: typeof n === "string" ? n : n.body || "" });
    }
  }

  const allChargeCols = ["Date", "Network", "kWh", "Cost", "$/kWh", "Arr%", "Dep%", L.eff];
  const allChargeKeys = ["date", "network", "kwh", "cost", "rate", "arr", "dep", "eff"];
  const cIdx = pickColumns(allChargeKeys, o.chargeCols ?? null);
  const chargeCols = cIdx.map((i) => allChargeCols[i]);
  const chargeRows = (sec.charges ? charges : []).map((c) => {
    const d = derived.get(c.id) || { miPerKwh: 0 };
    const cells = [
      rowFmt(c.date), c.network || "", jfix(c.totalKwh || 0, 1), `$${jfix(c.total || 0, 2)}`,
      `$${jfix(c.ratePerKwh || 0, 3)}`, jfix(c.arrPct || 0, 0), jfix(c.depPct || 0, 0),
      jfix(eff(d.miPerKwh || 0, units), 2),
    ];
    return { id: c.id, cells: cIdx.map((i) => cells[i]) };
  });

  const types = o.typeLabels || [];
  return {
    heading: "TrueMile EV — Report",
    dateLine: `${dateFmt(o.fromMs, "MMM d, yyyy", zone)}  –  ${dateFmt(o.toMs, "MMM d, yyyy", zone)}`,
    title: o.title || null,
    typesLine: types.length ? `Trip types: ${types.join(", ")}` : null,
    subtitle: o.subtitle || null,
    summary: sec.summary ? summary : [],
    tripCols: sec.trips ? tripCols : [], tripRows, tripCount: trips.length, hasCar, reconLines,
    notes,
    chargeCols: sec.charges ? chargeCols : [], chargeRows, chargeCount: charges.length,
    empty: trips.length === 0 && charges.length === 0,
    tripKeys: sec.trips ? tIdx.map((i) => allTripKeys[i]) : [],
    chargeKeys: sec.charges ? cIdx.map((i) => allChargeKeys[i]) : [],
    tripColumns: allTripKeys.map((key, i) => ({ key, label: allTripCols[i] })),
    chargeColumns: allChargeKeys.map((key, i) => ({ key, label: allChargeCols[i] })),
    shown: sec,
    fromYmd: dateFmt(o.fromMs, "yyyyMMdd", zone),
    toYmd: dateFmt(o.toMs, "yyyyMMdd", zone),
  };
}

/**
 * The Journey report: the same layout over the journey's trips (own drives) and the charges dated inside
 * it (journeys.journeyCharges), titled with the journey's name (MapScreen.kt:2744-2766).
 */
export function journeyModel({ journey, charges, units, zone, notesByTrip, derived, vehicleLabel, sections, tripCols, chargeCols }) {
  return reportModel({
    trips: journey.trips, charges, fromMs: journey.start, toMs: journey.end, units, zone,
    title: journey.name, subtitle: vehicleLabel || null, notesByTrip, derived, sections, tripCols, chargeCols,
  });
}
