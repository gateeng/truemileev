// PUBLISH COPY for gateeng.com/truemileev (source: TrueMileEV web/truemileev/assets/lib/gates.js at bfb05930).
// Only the product page's Plans & pricing (assets/pricing/plans.js) reads this file, for its plan numbers;
// the Basic card states the rules of the app now on Google Play (vc26: the newest 50 drives and 10
// charges, every plan downloads all its data). The comments below about Basic's monthly quota and the
// simple report describe vc28, which the dashboard (assets/lib/gates.js) adopts with that update.

// TrueMile EV web: the app's tier gates, list windows and Basic's monthly quota. Pure, DOM-free.
// Port of data/TierGate.kt:17-78, 239-293, Reportscreen.kt:1718-1739 and ChargeScreen.kt:2185-2193,
// with the owner's Basic restructure (B1-B5, 10/11).
// Default (owner fork B): the web mirrors the app's gates. Tiles themselves are never gated.

import { addMonths, fromLocal, localZone, parts } from "./tz.js";
import { isDc, CAR_ASK } from "./rows.js";

export const BUILD = "2026-09-30.2";

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
  // The full "My data" download (every drive and charge, with routes). Owner B5 (10/11): Pro and up;
  // Basic downloads the simple report of what it sees instead (lib/csv.js simpleTripsCsv /
  // simpleChargesCsv); a complete copy on request (B6) is in the Terms only.
  myData: "pro",
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

/** TierGate.maxVehicles: how many vehicles a tier includes (1 on the entry tier, 2 on Pro, all from Max). */
export function vehicleLimit(tier) {
  const t = tierOf(tier && typeof tier === "object" ? tier.tier : tier);
  return t === "pro" ? 2 : rank[t] >= rank.max ? Infinity : 1;
}

// ── The plan choice (owner decision D2, 10/9; the app's PlanChoice.kt) ────────────────────────
// When an account holds more vehicles or trailers than its plan includes (typically when the 14-day
// Max trial ends), the APP asks which ones stay in use and stores the answer in the synced settings
// (user_settings.settings.planChoice). The page only reads it: the vehicles the app counted
// (heldCloud) but did not keep (keepCloud) are left out of every vehicle choice here, as in the app,
// and the kept trailer is the one the Tow tab shows. No stored choice, a choice made under another
// plan's limit, a promotional grant or a plan that could not be read: nothing is locked.

const idList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string")
  .map((x) => x.trim()).filter((x) => x && x !== "null"))] : []);
const limitOf = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * The loadAccount projection of settings.planChoice (aliases pcKeepCloud, pcHeldCloud, pcVehLimit,
 * pcTrailerKeep, pcTrailerLimit; a raw blob with planChoice is read the same way) ->
 * {vehicles: {keepCloud, heldCloud, limit} | null, trailers: {keep, limit} | null}.
 * The phone's own vehicle ids (planChoice.vehicles.keep) are never read: they can carry the VIN.
 */
export function planChoiceFrom(row) {
  const r = row && typeof row === "object" ? row : {};
  const pc = r.planChoice && typeof r.planChoice === "object" ? r.planChoice : null;
  const pv = pc && pc.vehicles && typeof pc.vehicles === "object" ? pc.vehicles : {};
  const pt = pc && pc.trailers && typeof pc.trailers === "object" ? pc.trailers : {};
  const vLimit = limitOf(r.pcVehLimit ?? pv.limit);
  const tLimit = limitOf(r.pcTrailerLimit ?? pt.limit);
  const keepCloud = idList(r.pcKeepCloud ?? pv.keepCloud);
  const heldCloud = idList(r.pcHeldCloud ?? pv.heldCloud);
  const keep = idList(r.pcTrailerKeep ?? pt.keep);
  return {
    vehicles: vLimit && keepCloud.length ? { keepCloud, heldCloud, limit: vLimit } : null,
    trailers: tLimit && keep.length ? { keep, limit: tLimit } : null,
  };
}

/** A promotional grant is never limited (PlanChoice.exemptForPromo); a plan that was not read locks nothing. */
function planExempt(tier) {
  return !!tier && typeof tier === "object" && (tier.unknown === true || String(tier.source || "") === "promo");
}

/**
 * Which of [vehicles] the plan locks: {locked: Set(id), limit, overLimit}. A vehicle is locked when the
 * app counted it and did not keep it, the stored choice was made under the CURRENT plan's limit, and
 * the account is not exempt. An upgrade (a higher limit) unlocks everything at once.
 * A vehicle removed in the app keeps its cloud row here; the app takes it out of the choice at once and
 * keeps what it still holds (PlanChoice.afterRemoval / normalize), so the vehicle in use is never the
 * one locked here, and the removed one stays out while the plan locks it.
 */
export function planLocks(tier, vehicles, choice) {
  const limit = vehicleLimit(tier);
  const none = { locked: new Set(), limit, overLimit: false };
  const c = choice && choice.vehicles;
  if (!c || limit === Infinity || planExempt(tier) || c.limit !== limit) return none;
  const ids = new Set((vehicles || []).map((v) => v.id));
  const keep = c.keepCloud.filter((id) => ids.has(id));
  if (!keep.length || keep.length > limit) return none;
  const locked = new Set(c.heldCloud.filter((id) => ids.has(id) && !keep.includes(id)));
  return { locked, limit, overLimit: locked.size > 0 };
}

/**
 * The trailers the Tow tab shows: {shown, more}. The kept ones when the app stored a choice under the
 * current plan's limit; otherwise the first [trailerLimit] of the list. Everything from Max, and for a
 * promotional grant.
 */
export function trailerKeep(tier, trailers, choice) {
  const list = Array.isArray(trailers) ? trailers : [];
  const limit = trailerLimit(tier);
  const promo = !!tier && typeof tier === "object" && String(tier.source || "") === "promo";
  if (limit === Infinity || (promo && limit > 0)) return { shown: list.slice(), more: 0 };
  const c = choice && choice.trailers;
  if (c && limit > 0 && c.limit === limit) {
    const kept = list.filter((t) => c.keep.includes(t.clientId));
    if (kept.length && kept.length <= limit) return { shown: kept, more: list.length - kept.length };
  }
  const shown = list.slice(0, limit);
  return { shown, more: list.length - shown.length };
}

export const PRO_TRIP_MONTHS = 6;
export const PRO_CHARGE_DAYS = 6 * 30;
export const PRO_PERIOD_PRINT_MONTHS = 3;

const tierStr = (tier) => tierOf(tier && typeof tier === "object" ? tier.tier : tier);

// ── Basic's monthly quota (owner decisions B1-B4, 10/11; the app's BasicQuota.kt) ─────────────
// Basic used to see a rolling window (the newest 50 drives, the newest 10 charges with at most 3 DC).
// Since the first update it sees, per vehicle and per calendar month in the viewer's own time zone,
// for the current month and the previous one only:
//  - the FIRST 30 drives of the month (every car status takes a place: a drive in another car or one
//    waiting for an answer is listed);
//  - every home / AC charge, and the FIRST 4 DC fast charges of the month (DC = rows.isDc, the app's
//    TierGate.isDcFast).
// Two exemptions, as in the app (BasicQuota.Row.alwaysShown), both answers that decide the figures and so
// never sit behind a plan: a drive still waiting for its car answer (its answer decides what this
// vehicle's totals count), and a charge still unconfirmed (confidence "low": it stays out of every
// average until it is confirmed, and its rate and cost feed every total). Each is ALWAYS shown, whatever
// its month or place, and still takes its place in the month's ranking (an unconfirmed DC charge uses one
// of the month's 4 DC places).
// Everything is still recorded, synced and COUNTED (tiles, averages, cost per mile and every total
// read all rows, B3); only the rows past the quota are left out of the lists, the maps and the detail
// pages, shown as one short summary per list (B4). An upgrade shows them at once, within the new plan's
// own window (Pro the last PRO_TRIP_MONTHS months; Max everything).
// A month is the local calendar month of the row's date (a drive's END, as the day groups use). Ties
// on the same instant go by the client id (the id the phone gave the row, the same on every device),
// then the row id, so the same rows are picked on every load and on both surfaces. A row dated after
// the current month (a phone clock ahead) counts in its own month.
// The clock is quotaNow: the browser's, floored by the server's reading, so setting the computer's
// date back cannot bring back earlier months (the app's TierGate.nowMs).

/** Drives Basic sees per vehicle and calendar month. */
export const BASIC_DRIVES_PER_MONTH = 30;
/** DC fast charges Basic sees per vehicle and calendar month (home and AC charges are not capped). */
export const BASIC_DC_PER_MONTH = 4;
/** The months Basic sees: the current one and the one before it. */
export const BASIC_MONTHS = 2;

/**
 * The clock Basic's quota and Pro's windows are read at: the browser's clock [nowMs] (Date.now() when
 * missing), floored by the server's own clock as read with the plan on this page load
 * (my_effective_tier.now_epoch_ms → [tier].serverNowMs) — the app's TierGate.nowMs. A computer whose
 * date is set back can no longer make an earlier month read as "this month"; a clock set forward only
 * shows less. With no server reading (a plan that could not be read, an older server) it is the
 * browser's clock, as before. The reading is not advanced while the page stays open: a page left open
 * across a month's end keeps at most what it showed when it loaded, until it is reloaded.
 */
export function quotaNow(tier, nowMs) {
  const device = Number.isFinite(nowMs) ? nowMs : Date.now();
  const server = tier && typeof tier === "object" ? Number(tier.serverNowMs) : 0;
  return server > device ? server : device;
}

/** The local calendar month of [ms] as one number (year × 12 + month − 1): months compare and subtract. */
export function monthIndex(ms, zone) {
  const p = parts(ms, zone);
  return p.y * 12 + (p.mo - 1);
}

/** The first instant Basic shows: the start of last month in [zone] (BasicQuota.visibleFrom). */
export function basicVisibleFrom(nowMs, zone) {
  const m = monthIndex(nowMs, zone) - (BASIC_MONTHS - 1);
  return fromLocal(Math.floor(m / 12), (m % 12) + 1, 1, 0, 0, 0, 0, zone);
}

/** Row ids in a stable order: numeric ids by value, others as text. */
function cmpId(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  if (/^\d+$/.test(x) && /^\d+$/.test(y) && x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Plain text order (UTF-16 code units, as Kotlin's String.compareTo). */
function cmpText(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The ids a quota keeps: rows grouped by vehicle and month (months before the previous one are never
 * kept), each group first-first — date, then [order](row) (the client id), then the row id
 * (BasicQuota.FIRST_FIRST) — [keep](row, counter) deciding each row in turn.
 */
function quotaIds(rows, nowMs, zone, order, keep) {
  const first = monthIndex(nowMs, zone) - (BASIC_MONTHS - 1);
  const groups = new Map();
  for (const r of rows || []) {
    const m = Number.isFinite(r.date) ? monthIndex(r.date, zone) : NaN;
    if (!Number.isFinite(m) || m < first) continue;
    const key = `${r.vehicleId ?? ""}|${m}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(r);
  }
  const out = new Set();
  for (const g of groups.values()) {
    g.sort((a, b) => (a.date - b.date) || cmpText(order(a), order(b)) || cmpId(a.id, b.id));
    const counter = { n: 0 };
    for (const r of g) if (keep(r, counter)) out.add(r.id);
  }
  return out;
}

/** True for a drive waiting for its car answer: always shown on Basic (BasicQuota.Row.alwaysShown). */
export const quotaAlwaysShown = (trip) => !!trip && trip.carStatus === CAR_ASK;

/** True for a charge still unconfirmed (confidence "low"): always shown on Basic (BasicQuota.chargeRow:
 *  ChargeConfidence.isLow). */
export const quotaChargeAlwaysShown = (charge) => !!charge && !!charge.lowConfidence;

/**
 * The ids of the drives Basic sees (B1/B2): the first 30 of each vehicle's month, plus every drive
 * waiting for its car answer (of any date; it still took its place among the 30).
 * [trips] must hold every drive of each vehicle it covers.
 */
export function basicTripIds(trips, nowMs, zone) {
  const out = quotaIds(trips, nowMs, zone, (t) => t.clientTripId, (_, c) => c.n++ < BASIC_DRIVES_PER_MONTH);
  for (const t of trips || []) if (quotaAlwaysShown(t)) out.add(t.id);
  return out;
}

/**
 * The ids of the charges Basic sees (B1/B2): every non-DC charge and the first 4 DC of each month, plus
 * every unconfirmed charge of any date (an unconfirmed DC charge still took one of its month's 4 places).
 */
export function basicChargeIds(charges, nowMs, zone) {
  const out = quotaIds(charges, nowMs, zone, (ch) => ch.clientChargeId, (ch, c) => !isDc(ch) || c.n++ < BASIC_DC_PER_MONTH);
  for (const ch of charges || []) if (quotaChargeAlwaysShown(ch)) out.add(ch.id);
  return out;
}

/** True when the tier's lists follow Basic's monthly quota (the entry tier; a trial, Pro, Max and every
 *  grant see more). */
export const quotaApplies = (tier) => tierStr(tier) === "free";

/**
 * The trips a tier SEES (capture-everything: every drive is kept; the tier only limits the list).
 *  entry tier: Basic's monthly quota (basicTripIds) over [opts.basis] (the scope's drives of every car
 *              status; defaults to [trips]), in [opts.zone] at quotaNow(tier, [opts.nowMs])
 *  Pro:        drives dated on or after that clock minus 6 calendar months (TierGate.proWindowStart)
 *  Max and up: everything
 * Returns the kept rows in their input order.
 */
export function tripListWindow(tier, trips, opts = {}) {
  const t = tierStr(tier);
  if (t === "free") {
    const ids = basicTripIds(opts.basis || trips, quotaNow(tier, opts.nowMs), opts.zone || localZone());
    return trips.filter((r) => ids.has(r.id));
  }
  if (t === "pro") {
    const cut = addMonths(quotaNow(tier, opts.nowMs), -PRO_TRIP_MONTHS, opts.zone || localZone());
    return trips.filter((r) => r.date >= cut);
  }
  return trips.slice();
}

/**
 * The charges a tier SEES:
 *  entry tier: Basic's monthly quota (basicChargeIds) over [opts.basis] (defaults to [charges]), at
 *              quotaNow(tier, [opts.nowMs])
 *  Pro:        the last 6 × 30 days of that clock
 *  Max and up: everything
 * Returns the kept rows newest first.
 */
export function chargeListWindow(tier, charges, opts = {}) {
  const t = tierStr(tier);
  const newest = [...charges].sort((a, b) => (b.date - a.date) || cmpId(b.id, a.id));
  if (t === "free") {
    const ids = basicChargeIds(opts.basis || charges, quotaNow(tier, opts.nowMs), opts.zone || localZone());
    return newest.filter((c) => ids.has(c.id));
  }
  if (t === "pro") {
    const cut = quotaNow(tier, opts.nowMs) - PRO_CHARGE_DAYS * 86_400_000;
    return newest.filter((c) => c.date >= cut);
  }
  return newest;
}

/** Pro's note when its window cut rows; null for every other plan (Basic's lists show quotaSummary). */
export function listWindowNote(tier, kind = "trips") {
  if (tierStr(tier) !== "pro") return null;
  return kind === "charges" ? "Showing your last 6 months of charges" : "Showing your last 6 months of drives";
}

/** Where a row sits for Basic: "this" (the current month, or later), "last" (the previous month), "older". */
export function quotaBucket(ms, nowMs, zone) {
  const d = monthIndex(ms, zone) - monthIndex(nowMs, zone);
  return d >= 0 ? "this" : d === -1 ? "last" : "older";
}

/**
 * B4: the one short summary a Basic list shows for its locked rows, or null when none is locked.
 * [kind] "trips" | "charges"; [locked] = the rows the list would show without the quota and does not.
 *   "18 more drives this month. Upgrade to see them."
 *   "3 more DC charges this month. 1 more DC charge last month. Upgrade to see them."
 *   "Earlier months are kept. Upgrade to see them."
 * Within the two months only DC charges are ever locked, so charges are named DC charges there.
 */
export function quotaSummary(kind, locked, nowMs, zone) {
  const n = { this: 0, last: 0, older: 0 };
  for (const r of locked || []) n[quotaBucket(r.date, nowMs, zone)]++;
  const total = n.this + n.last + n.older;
  if (!total) return null;
  const [one, many] = kind === "charges" ? ["DC charge", "DC charges"] : ["drive", "drives"];
  const lines = [];
  if (n.this) lines.push(`${n.this} more ${n.this === 1 ? one : many} this month.`);
  if (n.last) lines.push(`${n.last} more ${n.last === 1 ? one : many} last month.`);
  if (n.older) lines.push("Earlier months are kept.");
  lines.push(total === 1 && !n.older ? "Upgrade to see it." : "Upgrade to see them.");
  return lines.join(" ");
}

/**
 * The locked rows a list's summary counts (BasicQuota.lockedForList), for quotaSummary. "This month" and
 * "last month" are the WHOLE months: read from [monthRows] (every row of the scope the list could hold,
 * whatever range is on screen; for drives, cut only by the car chip) together with [listed] (the list's
 * own locked rows, so a row the basis lacks still counts once). "Earlier" is read from [listed] alone
 * (only a list stepped back past last month holds those rows). So a week's list names the same number as
 * the whole month, and paging never grows it. [shownIds] = the quota's ids (the list window). The caller
 * shows the summary only when [listed] is not empty (when the list itself leaves something out).
 */
export function quotaLockedForList(monthRows, listed, shownIds, nowMs, zone) {
  const listedIds = new Set((listed || []).map((r) => r.id));
  const seen = new Set();
  const out = [];
  for (const r of [...(monthRows || []), ...(listed || [])]) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    if (shownIds && shownIds.has(r.id)) continue;
    if (quotaBucket(r.date, nowMs, zone) !== "older" || listedIds.has(r.id)) out.push(r);
  }
  return out;
}

/**
 * The line a locked row's own page shows in its place (a Basic charge past the quota, opened from an
 * old link or a bookmark): [kind] "trips" | "charges", [ms] the row's date.
 */
export function quotaRowText(kind, ms, nowMs, zone) {
  const what = kind === "charges" ? "charge" : "drive";
  const b = quotaBucket(ms, nowMs, zone);
  if (b === "older") return `Earlier months are kept. Upgrade to see this ${what}.`;
  const when = b === "this" ? "this month" : "last month";
  return kind === "charges"
    ? `This is past the first ${BASIC_DC_PER_MONTH} DC charges of ${when}. Upgrade to see it.`
    : `This is past the first ${BASIC_DRIVES_PER_MONTH} drives of ${when}. Upgrade to see it.`;
}

/**
 * Period print (PERIOD_PDF, Reportscreen.kt:2032-2056): Max and up any range; Pro only while the
 * window reaches into the last 3 calendar months of quotaNow (a period that ENDS before the cut has
 * nothing to print), the start then clamped by periodPrintWindow; the entry tier never.
 */
export function periodPrintAllowed(tier, win, nowMs, zone) {
  const t = tierStr(tier);
  if (!win) return false;
  if (rank[t] >= rank.max) return true;
  if (t !== "pro") return false;
  return win.end >= addMonths(quotaNow(tier, nowMs), -PRO_PERIOD_PRINT_MONTHS, zone);
}

/** The window a period print covers: Pro's start clamped to the 3-month cut; null when not allowed. */
export function periodPrintWindow(tier, win, nowMs, zone) {
  if (!periodPrintAllowed(tier, win, nowMs, zone)) return null;
  if (tierStr(tier) !== "pro") return { start: win.start, end: win.end };
  const cut = addMonths(quotaNow(tier, nowMs), -PRO_PERIOD_PRINT_MONTHS, zone);
  return { start: Math.max(win.start, cut), end: win.end, clamped: win.start < cut };
}
