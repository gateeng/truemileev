// TrueMile EV web | lib/taxreport.js | pure: the Business mileage summary model.
// Mirrors the app's Business Mileage Report (TaxReportPdf.kt:48-160) and its split
// (TaxReportSections.kt, pinned by TaxReportSectionsTest): page-one figures are this vehicle's own
// drives, Business = the legacy trip_class mirror "Business" (not classification); drives in other cars
// and drives waiting for a car get their own sections and are in no total above them. It is a summary
// for the owner's records: no start/end cities (that needs a geocoder), no report id, no QR, no VIN.
import { dist, labels } from "./units.js";
import { dateFmt, } from "./format.js";
import { fromLocal } from "./tz.js";
import { jfix } from "./csv.js";

export const BUILD = "2026-09-29.2";

export const BANNER = "Summary for your records. The verifiable report with its QR code is issued from the app.";

function miles(t) { return t.miles != null ? t.miles : (t.hwyMi || 0) + (t.localMi || 0); }

export function isBusiness(t) { return String(t.tripClass || "").toLowerCase() === "business"; }

/** TaxReportSections.split: date asc; "" → mine, "other" → others, anything else → waiting. */
export function split(trips) {
  const mine = [], others = [], waiting = [];
  for (const t of (trips || []).slice().sort((a, b) => a.date - b.date)) {
    if (t.carStatus === "") mine.push(t);
    else if (t.carStatus === "other") others.push(t);
    else waiting.push(t);
  }
  return { mine, others, waiting };
}

/** TaxReportSections.totals. */
export function totals(s) {
  const sum = (l) => l.reduce((a, t) => a + miles(t), 0);
  const mineMiles = sum(s.mine), mineBusiness = sum(s.mine.filter(isBusiness));
  return {
    mineMiles, mineBusiness,
    otherMiles: sum(s.others), otherBusiness: sum(s.others.filter(isBusiness)),
    waitingMiles: sum(s.waiting), waitingCount: s.waiting.length,
    pctBusiness: mineMiles > 0 ? mineBusiness / mineMiles * 100 : 0,
  };
}

function groupOrdered(list, keyOf) {
  const m = new Map();
  for (const t of list) { const k = keyOf(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return m;
}

/** One row per day, car label and type, in date order then label (TaxReportSections.otherDayRows). */
export function otherDayRows(others, dayKeyOf) {
  const g = groupOrdered(others.slice().sort((a, b) => a.date - b.date),
    (t) => JSON.stringify([dayKeyOf(t.date), t.otherCarLabel || "Another car", isBusiness(t)]));
  return [...g.entries()].map(([k, rows]) => {
    const [dayKey, label, business] = JSON.parse(k);
    return { dayKey, firstDate: rows[0].date, label, trips: rows.length, miles: rows.reduce((a, t) => a + miles(t), 0), business };
  }).sort((a, b) => (a.firstDate - b.firstDate) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** One row per day and type (TaxReportSections.waitingDayRows). */
export function waitingDayRows(waiting, dayKeyOf) {
  const g = groupOrdered(waiting.slice().sort((a, b) => a.date - b.date),
    (t) => JSON.stringify([dayKeyOf(t.date), isBusiness(t)]));
  return [...g.entries()].map(([k, rows]) => {
    const [dayKey, business] = JSON.parse(k);
    return { dayKey, firstDate: rows[0].date, trips: rows.length, miles: rows.reduce((a, t) => a + miles(t), 0), business };
  }).sort((a, b) => a.firstDate - b.firstDate);
}

/** The year's window: Jan 1 00:00 → now for the current year, else → Dec 31 23:59:59.999. */
export function yearWindow(year, nowMs, zone) {
  const start = fromLocal(year, 1, 1, 0, 0, 0, 0, zone);
  const nextYear = fromLocal(year + 1, 1, 1, 0, 0, 0, 0, zone);
  const end = nowMs < nextYear ? Math.min(nowMs, nextYear - 1) : nextYear - 1;
  return { start, end };
}

/** Years to offer: every year that has a drive of this vehicle, plus the current one, newest first. */
export function yearsOf(trips, nowMs, zone) {
  const ys = new Set([Number(dateFmt(nowMs, "yyyy", zone))]);
  for (const t of trips || []) if (t.date > 0) ys.add(Number(dateFmt(t.date, "yyyy", zone)));
  return [...ys].sort((a, b) => b - a);
}

/**
 * mileageModel({trips (this vehicle's drives, every car status), year, nowMs, zone, units, vehicleName})
 */
export function mileageModel({ trips, year, nowMs, zone, units = "imperial", vehicleName = "" }) {
  const L = labels(units);
  const dL = L.dist;
  const win = yearWindow(year, nowMs, zone);
  const inYear = (trips || []).filter((t) => t.date >= win.start && t.date <= win.end);
  const s = split(inYear);
  const tot = totals(s);
  const business = s.mine.filter(isBusiness);
  const dayKey = (ms) => dateFmt(ms, "yyyy-MM-dd", zone);
  const DATE = (ms) => dateFmt(ms, "MM/dd/yy", zone);
  const d1 = (mi) => jfix(dist(mi, units), 1);
  const distText = (mi) => `${d1(mi)} ${dL}`;

  // business log: per calendar day (sorted by day key), count and distance
  const byDay = groupOrdered(business, (t) => dayKey(t.date));
  const dayRows = [...byDay.keys()].sort().map((k) => {
    const rows = byDay.get(k).slice().sort((a, b) => a.date - b.date);
    return { date: DATE(rows[0].date), trips: rows.length, distance: d1(rows.reduce((a, t) => a + miles(t), 0)) };
  });
  const isCurrent = win.end >= nowMs - 1 && Number(dateFmt(nowMs, "yyyy", zone)) === year;

  const others = s.others.length ? {
    title: "Other cars",
    note: `Drives in other cars. Not included in the ${vehicleName || "vehicle"} totals above.`,
    cols: ["DATE", "CAR", "TYPE", dL.toUpperCase()],
    rows: otherDayRows(s.others, dayKey).map((r) => ({
      date: DATE(r.firstDate), car: `${r.label} (${r.trips})`, type: r.business ? "Business" : "—", distance: d1(r.miles),
    })),
    totals: [
      { label: "TOTAL — Other cars", value: distText(tot.otherMiles) },
      { label: "Of which business", value: distText(tot.otherBusiness), minor: true },
    ],
  } : null;

  const waiting = s.waiting.length ? {
    title: "Waiting for a car",
    note: "These drives are not in any total above. Choose a car for each in the app, then create the report again.",
    cols: ["DATE", "TRIPS", "TYPE", dL.toUpperCase()],
    rows: waitingDayRows(s.waiting, dayKey).map((r) => ({
      date: DATE(r.firstDate), trips: r.trips, type: r.business ? "Business" : "—", distance: d1(r.miles),
    })),
    totals: [{ label: "TOTAL — Waiting for a car", value: distText(tot.waitingMiles) }],
  } : null;

  return {
    banner: BANNER,
    heading: "Business Mileage Summary",
    subheading: "TrueMile EV · business trip log",
    year,
    period: `Jan 1 – ${dateFmt(win.end, "MMM d, yyyy", zone)}`,
    vehicle: vehicleName,
    window: win,
    kpis: [
      { label: `Business ${dL}`, value: d1(tot.mineBusiness), highlight: true },
      { label: `Total ${dL}`, value: d1(tot.mineMiles) },
      { label: "% business use", value: `${Math.trunc(tot.pctBusiness)}%` },
    ],
    waitingNote: s.waiting.length
      ? `${s.waiting.length} drives (${distText(tot.waitingMiles)}) are waiting for a car and are not counted.`
      : null,
    logTitle: "Business trip log",
    logCols: ["DATE", "TRIPS", dL.toUpperCase()],
    dayRows,
    emptyText: dayRows.length ? null : (isCurrent ? "No business-classified trips this year." : `No business-classified trips in ${year}.`),
    businessTotal: { label: "TOTAL — Business", value: `${d1(tot.mineBusiness)} ${dL}` },
    others, waiting,
    footer: "Mileage log for your records — classifications set by the driver.",
    totals: tot,
  };
}
