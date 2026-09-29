// TrueMile EV web: the app's tier gates and list windows. Pure, DOM-free.
// Port of data/TierGate.kt:17-78, 239-293, Reportscreen.kt:1718-1739 and ChargeScreen.kt:2185-2193.
// Default (owner fork B): the web mirrors the app's gates. Tiles themselves are never gated.

import { addMonths, localZone } from "./tz.js";
import { isDc } from "./rows.js";

export const BUILD = "2026-09-29.2";

/** Tier.from: "pro" / "max" / "business", anything else (null, legacy "freemium") the entry tier. */
export const rank = { free: 0, pro: 1, max: 2, business: 3 };
export function tierOf(s) {
  const v = String(s ?? "").trim().toLowerCase();
  return v === "pro" || v === "max" || v === "business" ? v : "free";
}

/** The minimum tier of each web feature (TierGate.Feature). */
export const FEATURES = Object.freeze({
  tripDetail: "pro",
  tripGraphs: "max",
  tripTypes: "pro",
  chargeCurve: "max",
  costAnalytics: "pro",
  hvac: "pro",
  saved: "pro",
  journeys: "max",
  csv: "pro",
  periodPrint: "pro",
  periodPrintAnyRange: "max",
  businessPrint: "max",
  charts: "pro",
  myData: "free",
  insights: "pro",          // Garage → Insights "Your real range" (Feature.INSIGHTS)
  towing: "pro",            // Garage → Tow (Feature.TOW: Pro 1 trailer shown, Max all)
  homeCharger: "pro",       // Garage → Charger, the home charger card (Feature.HOME_CHARGER)
  chargeMapDetail: "pro",   // a charge-map pin's own history (Feature.CHARGE_MAP_DETAIL)
  batteryHealth: "max",     // battery health over time (Feature.DEGRADATION)
});

/** [tier] is the tier string or the account's tier object ({tier}). An unknown feature is allowed. */
export function allows(tier, feature) {
  const t = tierOf(tier && typeof tier === "object" ? tier.tier : tier);
  const min = FEATURES[feature];
  if (!min) return true;
  return rank[t] >= rank[min];
}

/** The locked-feature copy. Never "free". */
export function lockText(feature) {
  return FEATURES[feature] === "max" ? "Available with Max" : "Available with Pro";
}

/** TierGate.maxTrailers: how many saved trailers a tier sees (0 below Pro, 1 for Pro, all from Max). */
export function trailerLimit(tier) {
  const t = tierOf(tier && typeof tier === "object" ? tier.tier : tier);
  return t === "pro" ? 1 : rank[t] >= rank.max ? Infinity : 0;
}

export const FREE_TRIP_LIST_LIMIT = 50;
export const FREE_CHARGE_LIST_LIMIT = 10;
export const FREE_CHARGE_DC_CAP = 3;
export const PRO_TRIP_MONTHS = 6;
export const PRO_CHARGE_DAYS = 6 * 30;
export const PRO_PERIOD_PRINT_MONTHS = 3;

const tierStr = (tier) => tierOf(tier && typeof tier === "object" ? tier.tier : tier);

/**
 * The trips a tier SEES (capture-everything: every drive is kept; the tier only limits the list).
 *  entry tier: drives dated on or after the 50th newest of [opts.basis] (the scope's drives of every
 *              car, as TripLogDao.dateAtRecencyOffsetAllCars reads them; defaults to [trips]);
 *              fewer than 50 → no cut
 *  Pro:        drives dated on or after now minus 6 calendar months (TierGate.proWindowStart)
 *  Max and up: everything
 * Returns the kept rows in their input order.
 */
export function tripListWindow(tier, trips, opts = {}) {
  const t = tierStr(tier);
  if (t === "free") {
    const basis = opts.basis || trips;
    if (basis.length < FREE_TRIP_LIST_LIMIT) return trips.slice();
    const dates = basis.map((r) => r.date).sort((a, b) => b - a);
    const cutoff = dates[FREE_TRIP_LIST_LIMIT - 1];
    return trips.filter((r) => r.date >= cutoff);
  }
  if (t === "pro") {
    const cut = addMonths(opts.nowMs ?? Date.now(), -PRO_TRIP_MONTHS, opts.zone || localZone());
    return trips.filter((r) => r.date >= cut);
  }
  return trips.slice();
}

/**
 * The charges a tier SEES:
 *  entry tier: the newest 10, of which at most 3 DC (a DC past the cap gives its slot to an older one)
 *  Pro:        the last 6 × 30 days
 *  Max and up: everything
 * Returns the kept rows newest first.
 */
export function chargeListWindow(tier, charges, opts = {}) {
  const t = tierStr(tier);
  const newest = [...charges].sort((a, b) => b.date - a.date || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (t === "free") {
    const out = [];
    let dc = 0;
    for (const c of newest) {
      if (out.length >= FREE_CHARGE_LIST_LIMIT) break;
      if (isDc(c)) { if (dc >= FREE_CHARGE_DC_CAP) continue; dc++; }
      out.push(c);
    }
    return out;
  }
  if (t === "pro") {
    const cut = (opts.nowMs ?? Date.now()) - PRO_CHARGE_DAYS * 86_400_000;
    return newest.filter((c) => c.date >= cut);
  }
  return newest;
}

/** The note a page shows when a list window cut rows (null when nothing was cut). */
export function listWindowNote(tier, kind = "trips") {
  const t = tierStr(tier);
  if (kind === "charges") {
    return t === "free" ? "Showing your newest 10 charges" : t === "pro" ? "Showing your last 6 months of charges" : null;
  }
  return t === "free" ? "Showing your newest 50 drives" : t === "pro" ? "Showing your last 6 months of drives" : null;
}

/**
 * Period print (PERIOD_PDF, Reportscreen.kt:2032-2056): Max and up any range; Pro only while the
 * window reaches into the last 3 calendar months (a period that ENDS before the cut has nothing to
 * print), the start then clamped by periodPrintWindow; the entry tier never.
 */
export function periodPrintAllowed(tier, win, nowMs, zone) {
  const t = tierStr(tier);
  if (!win) return false;
  if (rank[t] >= rank.max) return true;
  if (t !== "pro") return false;
  return win.end >= addMonths(nowMs, -PRO_PERIOD_PRINT_MONTHS, zone);
}

/** The window a period print covers: Pro's start clamped to the 3-month cut; null when not allowed. */
export function periodPrintWindow(tier, win, nowMs, zone) {
  if (!periodPrintAllowed(tier, win, nowMs, zone)) return null;
  if (tierStr(tier) !== "pro") return { start: win.start, end: win.end };
  const cut = addMonths(nowMs, -PRO_PERIOD_PRINT_MONTHS, zone);
  return { start: Math.max(win.start, cut), end: win.end, clamped: win.start < cut };
}
