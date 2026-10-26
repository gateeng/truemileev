// PUBLISH COPY for gateeng.com/truemileev, not the source file (source: TrueMileEV web/truemileev/assets/lib/
// at bfb05930). Until the app's first update (vc28) the product page reads Plans & pricing from assets/pricing/,
// while the dashboard on this site keeps assets/lib/ and the plan rules of the app now on Google Play (vc26).
// Three Basic lines are therefore vc26's: PLAN_WHO.basic, BASIC_LIMITS[1] (the newest 50 drives and the
// newest 10 charges, at most 3 DC) and DATA_ROW.basic (all your data), and Basic's card shows no
// simple-report note. Where the comments below speak of Basic's monthly quota or simple report, say the
// dashboard shares these rows, that the Terms carry a complete copy on request, or that the app's
// BasicQuota / SimpleReport check these lines, they describe the source and vc28. The vc28 publish
// replaces this folder with the source's lib/.

// TrueMile EV web: plan names, the trial copy and what each plan includes. Pure, DOM-free.
// Sources: TierRepository.tierLabel, TrialWindow.kt (banner copy, tierLabelWithTrial, banner state),
// PaywallScreen.kt (featureLabel, proFeatures, maxFeatures, the trial note) and BillingManager.kt (the
// Play links; the PUBLISHED package only). The lowest plan is called "Basic" (LAUNCH.entryPlan): the
// app's internal id for it is a word this page never uses. Plans are bought in Google Play inside the
// app; the US prices, the trial length and the Android Auto / watch lines come from lib/launch.js.
// Basic's side of the comparison (its monthly quota, the simple report) follows the owner's Basic
// restructure (B1-B6, 10/11). A complete copy on request is in the Terms only (owner 10/11), not on the web.

// The product page's Plans & pricing section (index.html #pricing, rendered by assets/launch-page.js)
// reads its cards from pricingPlans() below, which is built from the same comparisonRows() the
// dashboard's plan table shows, so the two can never disagree.

import {
  tierOf, rank, trailerLimit, vehicleLimit, BASIC_DRIVES_PER_MONTH, BASIC_DC_PER_MONTH, PRO_TRIP_MONTHS,
  PRO_PERIOD_PRINT_MONTHS,
} from "./gates.js";
import { LAUNCH, priceLine } from "../lib/launch.js";

export const BUILD = "2026-09-30.2";

/** The app's Google Play store listing. */
export const PLAY_LISTING = "https://play.google.com/store/apps/details?id=com.gateengineering.truemileev";
/** Google Play's own subscriptions page (manage, cancel, receipts). */
export const PLAY_SUBSCRIPTIONS = "https://play.google.com/store/account/subscriptions";
/** The terms of use (section 3 holds the subscriptions and the launch price guarantee in full). */
export const TERMS_URL = "https://gateeng.com/truemile-terms/";

const tierKey = (t) => tierOf(t && typeof t === "object" ? t.tier : t);
const LABELS = { pro: "Pro", max: "Max", business: "Business" };

/** "Max", "Pro", "Business", or "Basic" for the lowest plan. [t] = a tier string or the account's tier object. */
export function planLabel(t) {
  return LABELS[tierKey(t)] || LAUNCH.entryPlan;
}

/** The plan's US price line ("$5.99 a month or $59.99 a year") for "pro" / "max"; "" otherwise. */
export const planPrice = (t) => priceLine(tierKey(t));

/** The plan's colour class: "tier-pro" | "tier-max" | "tier-business" | "tier-entry". */
export function planTone(t) {
  const k = tierKey(t);
  return LABELS[k] ? `tier-${k}` : "tier-entry";
}

/** True while the trial is what lifts the plan (api.showsTrialCountdown): the badge counts down. */
export function countsDown(t) {
  return !!t && t.trialLive === true && (t.source ? t.source === "trial" : true);
}

/**
 * The plan with the trial countdown (TrialWindow.tierLabelWithTrial): "Max · trial, 6 days left",
 * "Max · trial, last day" (one day or less), otherwise just the plan.
 */
export function planBadge(t) {
  const label = planLabel(t);
  if (!countsDown(t)) return label;
  const n = Math.max(0, Math.trunc(Number(t.trialDaysLeft) || 0));
  return n <= 1 ? `${label} · trial, last day` : `${label} · trial, ${n} days left`;
}

/** Where the plan comes from, in words. The lookup failing says so instead of guessing. */
export function sourceLine(t) {
  if (!t || t.unknown) return "We could not check your plan just now.";
  switch (String(t.source || "").toLowerCase()) {
    case "paid": return "Paid through Google Play";
    case "promo": return "Promotional access";
    case "trial": return "Trial";
    case "entry": return `${LAUNCH.entryPlan} plan`;
    default: return rank[tierKey(t)] === 0 ? `${LAUNCH.entryPlan} plan` : "";
  }
}

/**
 * The trial's state (TrialWindow.banner, read from my_effective_tier):
 *  "running" / "last_day"  the trial lifts the plan now (last day = one day or less left)
 *  "blocked"               the window was closed because the vehicle already had its trial
 *  "ended"                 the window ran out and no plan at or above it replaced it
 *  "none"                  no trial to talk about (never had one, or a plan / grant superseded it)
 * [t.trialClosed] is the page's own mapping of the server's reason ("abuse" | "closed" | ""), never
 * the server's key.
 */
export function trialState(t, nowMs = Date.now()) {
  if (!t || t.unknown) return "none";
  if (t.trialLive === true) {
    if (!countsDown(t)) return "none";
    return (Math.trunc(Number(t.trialDaysLeft) || 0)) <= 1 ? "last_day" : "running";
  }
  const ends = Number(t.trialEndsMs) || 0;
  if (ends <= 0) return "none";
  const trialRank = rank[tierOf(t.trialTier || "max")];
  const src = String(t.source || "").toLowerCase();
  if ((src === "paid" || src === "promo") && rank[tierKey(t)] >= trialRank) return "none";
  if (t.trialClosed === "abuse") return "blocked";
  if (t.trialClosed) return "none";
  return nowMs >= ends ? "ended" : "none";
}

/** The trial card (TrialWindow.bannerTitle / bannerBody + the Plans note), or null when there is none. */
export function trialCard(t, nowMs = Date.now()) {
  const state = trialState(t, nowMs);
  if (state === "none") return null;
  const label = planLabel(t && t.trialTier ? t.trialTier : "max").toUpperCase();
  const n = Math.max(0, Math.trunc(Number(t.trialDaysLeft) || 0));
  const note = `Starting a plan ends the trial right away — choose ${label} to keep everything that is open now.`;
  switch (state) {
    case "running": return { state, title: `${n} days left of ${label}`, body: `Every ${label} feature is open until then.`, note };
    case "last_day": return { state, title: `Last day of ${label}`, body: `Every ${label} feature is open until it ends today.`, note };
    case "ended": return { state, title: `Your ${label} trial has ended`,
      body: "Your drives and charges are all still recorded and kept. Plans decide how much you see.", note: "" };
    default: return { state, title: "This vehicle has already had its trial",
      body: "It was used with another account. Your drives and charges are still recorded.", note: "" };
  }
}

/** PlanCatalog.proFeatures / maxFeatures (the Plans screen), in the gate table's order. Only SOLD features:
 *  charge diagnostics has a gate but no screen, so neither the app nor this page lists it. The Android Auto
 *  and watch lines are the launch wording from lib/launch.js (the app is asked to use the same words). */
export const PLAN_FEATURES = Object.freeze({
  pro: Object.freeze([
    "Open any drive's detail",
    "Tag drives as commute, business or personal",
    "Tap a charger on the map for your history there",
    "Insights: personalized range and route energy",
    "Trip planner: charging stops and arrival battery",
    "Money saved compared with gas",
    "Climate energy use",
    "Full cost breakdowns per drive and per charge",
    "Home charging logged automatically",
    "Towing mode with trailer profiles",
    "Home-screen widgets",
    "Import charges and drives from CSV, or add a drive by hand",
    "Formatted CSV export",
    "PDF report for a date range",
    "Restore your history on a new phone",
    "Track up to 2 vehicles",
    "See the last 6 months of drives and charges",
    "3-month window on PDF reports",
  ]),
  max: Object.freeze([
    "Everything in Pro, and:",
    // Wind comes from the US weather service only, fetched when a drive is opened within about 7 days
    // (app data/NwsWind.kt): never on Canadian drives. The efficiency trace is the speed model scaled to
    // the drive's measured average, shown as "Efficiency (est.)" (pricing review 10/12 and 10/22).
    "Speed, elevation and estimated efficiency graphs per drive (wind on recent US drives)",
    "Your learned DC charging curve",
    "Monthly driving recap",
    "Battery Benchmark",
    "Battery health over time",
    "Journeys: group a road trip and export it",
    LAUNCH.androidAuto,
    LAUNCH.watch,
    "Verifiable business-mileage PDF",
    "Unlimited vehicles and trailers",
    "Your whole history, with no date window",
    "PDF reports over any range",
  ]),
});

/** The last three lines of each list are the plan's limits (vehicles, history, PDF window). */
const LIMITS = 3;

/**
 * Basic's side of the three limits, in the same order. PUBLISH COPY: the History cell is vc26's rule
 * (TierGate FREE_TRIP_LIST_LIMIT 50, FREE_CHARGE_LIST_LIMIT 10, FREE_CHARGE_DC_CAP 3) until vc28.
 */
export const BASIC_LIMITS = Object.freeze([
  "1 vehicle",
  "Your newest 50 drives and your newest 10 charges, at most 3 of them DC",
  false,
]);

/** The data download row. PUBLISH COPY: every plan downloads all its data, as in vc26, until vc28. */
export const DATA_ROW = Object.freeze({
  label: "Download your data",
  basic: "All your data (CSV)",
  pro: "All your data (CSV)",
  max: "All your data (CSV)",
});


/**
 * The Basic | Pro | Max comparison: every feature of Pro or Max once (Basic has none of them), then the
 * three limits side by side, then the data download.
 * -> [{label, basic, pro, max}] where each plan's cell is true (included), false (not included) or text.
 * Pro's vehicle cell also names its one trailer (TierGate.maxTrailers, gates.trailerLimit): Basic has no
 * towing, and Max's cell already says "vehicles and trailers".
 */
export function comparisonRows() {
  const pro = PLAN_FEATURES.pro, max = PLAN_FEATURES.max;
  const proFeat = pro.slice(0, pro.length - LIMITS);
  const maxFeat = max.slice(1, max.length - LIMITS);
  const rows = [
    ...proFeat.map((label) => ({ label, basic: false, pro: true, max: true })),
    ...maxFeat.map((label) => ({ label, basic: false, pro: false, max: true })),
  ];
  const names = ["Vehicles", "History", "PDF reports"];
  const proLim = pro.slice(pro.length - LIMITS), maxLim = max.slice(max.length - LIMITS);
  const trailers = trailerLimit("pro");
  const proCell = (i) => (i === 0 ? `${proLim[0]} and ${trailers} trailer${trailers === 1 ? "" : "s"}` : proLim[i]);
  names.forEach((label, i) => rows.push({ label, basic: BASIC_LIMITS[i], pro: proCell(i), max: maxLim[i] }));
  rows.push({ ...DATA_ROW });
  return rows;
}

// ── Plans & pricing (the product page's section id="pricing") ────────────────────────────────────
// Each card is the comparison table above, read one plan at a time: the feature rows the plan includes
// (Basic: what every plan has, EVERY_PLAN), then the same four limits the table shows, side by side on
// every card. What only a buyer needs is added here: who each plan is for, both currencies' prices and
// the notes under the cards. Every line is checked against docs/TIER_FEATURE_MATRIX_4tier.csv and the
// app's TierGate / BasicQuota / SimpleReport by web/tests/pricing_test.js.

/** Canada's Google Play prices (owner, set in the Play Console 9/29). */
const CANADA = Object.freeze({
  pro: Object.freeze({ monthly: "CA$8.49", yearly: "CA$84.99" }),
  max: Object.freeze({ monthly: "CA$15.99", yearly: "CA$139.99" }),
});

/**
 * The Google Play prices of the two subscriptions: {pro, max} -> {usd: {monthly, yearly}, cad: {...}}.
 * The US prices are lib/launch.js's (the dashboard's planPrice reads the same), written "US$5.99" here
 * because the page shows them next to Canada's.
 */
export const PLAN_PRICES = Object.freeze(Object.fromEntries(["pro", "max"].map((k) => [k, Object.freeze({
  usd: Object.freeze({ monthly: `US${LAUNCH.prices[k].monthly}`, yearly: `US${LAUNCH.prices[k].yearly}` }),
  cad: CANADA[k],
})])));

/**
 * What every plan has, Basic included: the matrix rows whose rule is "every plan" (Basic's checklist).
 * The first line is the matrix's own wording and says nothing about HOW a charge gets there: on Basic a
 * charge made while the phone is not linked to the adapter (an overnight home charge) is added by hand,
 * and logging home charging by itself is a Pro line on the card next to it.
 */
export const EVERY_PLAN = Object.freeze([
  "Every drive and charge recorded and backed up",
  "Live dashboard and range estimate",
  "Totals, averages and costs on the Board and in Report, counting every drive and charge",
  "Route maps, a map of where you charged, and charging stations near you",
  "Trouble-code reader",
  "Add a charge by hand",
  "Set up your vehicle from its VIN or its door sticker",
]);

/**
 * Under Basic's History limit (owner B1-B4): nothing past the quota is lost, and an upgrade shows it at
 * once, within the new plan's own window (Pro the last PRO_TRIP_MONTHS months, gates.tripListWindow /
 * chargeListWindow; Max everything). That the rows still count in the totals is Basic's checklist line.
 */
export const BASIC_KEPT = "Drives and charges past these limits are still recorded. Upgrading shows them at once: " +
  `Pro the last ${PRO_TRIP_MONTHS} months, Max everything.`;

/** Under Basic's download (owner B5): the simple report's columns (lib/csv.js, the app's SimpleReport). */
export const SIMPLE_REPORT_DETAIL = "Drives: day, start, end, distance, and battery % at the start and end. " +
  "Charges: day, location, network, rate, delivered kWh and cost.";

/** One short line per plan: who it is for. */
export const PLAN_WHO = Object.freeze({
  basic: "For drivers who want every drive and charge logged, with the most recent on screen.",
  pro: "For drivers who want each drive's detail and cost, trip planning with charging stops, and reports.",
  max: "For drivers who want their whole history, battery health, the watch app and Android Auto.",
});

/** A limit a plan does not have (Basic's PDF reports). */
export const NOT_INCLUDED = "Not included";

/**
 * The cards' short form of a limit cell, where the table's words repeat the label printed above them
 * on a card ("PDF reports: 3-month window on PDF reports"). {label: {plan: text}}; any other cell is the
 * table's own. Built from the same gate numbers as the table (gates.js), so the two cannot drift; the
 * dashboard's table keeps its longer words, which stand alone in a row.
 */
export const CARD_LIMITS = Object.freeze({
  Vehicles: Object.freeze({
    pro: `Up to ${vehicleLimit("pro")} vehicles and ${trailerLimit("pro")} trailer${trailerLimit("pro") === 1 ? "" : "s"}`,
  }),
  History: Object.freeze({ pro: `The last ${PRO_TRIP_MONTHS} months`, max: "Everything, with no date window" }),
  "PDF reports": Object.freeze({ pro: `The last ${PRO_PERIOD_PRINT_MONTHS} months`, max: "Any range" }),
});

/** The section's notes: the trial above the cards; how to subscribe, the prices and the button below. */
export const PRICING = Object.freeze({
  title: "Plans & pricing",
  trial: `New accounts get a ${LAUNCH.trialDays}-day ${LAUNCH.trialTier} trial: every ${LAUNCH.trialTier} feature, ` +
    `no card needed. Afterwards the account moves to ${LAUNCH.entryPlan} unless you choose Pro or Max. ` +
    "One trial per account and per vehicle.",
  buy: "Subscribe in the TrueMile app, through Google Play.",
  manage: "Manage or cancel any time in Google Play.",
  prices: "US$ prices are for the United States and CA$ prices for Canada. Prices vary by country: " +
    "Google Play shows yours, and whether tax is included, before you buy.",
  cta: "Get TrueMile EV on Google Play",
  /** After the guarantee's one sentence: the word "Terms" links to TERMS_URL. */
  details: "Details in the Terms.",
});

/** A subscription's price block: the monthly US price first, then the yearly one, then Canada's. */
function priceBlock(k) {
  const p = PLAN_PRICES[k];
  return { main: p.usd.monthly, unit: "a month", lines: [`or ${p.usd.yearly} a year`, `${p.cad.monthly} a month or ${p.cad.yearly} a year`] };
}

/**
 * The three cards of the Plans & pricing section, Basic, Pro and Max:
 * [{key, name, price: {main, unit, lines}, who, intro, features: [text], limits: [{label, text, note, off}]}].
 * features: Basic EVERY_PLAN; Pro the table's rows Pro includes; Max the rows only Max includes (after
 * "Everything in Pro, and:"). limits: the table's four limit rows, this plan's cell ([off] = not included),
 * in its short card form where CARD_LIMITS has one.
 */
export function pricingPlans() {
  const rows = comparisonRows();
  const isFeature = (r) => typeof r.basic === "boolean" && typeof r.pro === "boolean" && typeof r.max === "boolean";
  const feats = rows.filter(isFeature);
  const limitRows = rows.filter((r) => !isFeature(r));
  const cell = (r, k) => (r[k] === false ? NOT_INCLUDED : (CARD_LIMITS[r.label] && CARD_LIMITS[r.label][k]) || r[k]);
  const limits = (k, notes = {}) => limitRows.map((r) => ({
    label: r.label, text: cell(r, k), note: notes[r.label] || "", off: r[k] === false,
  }));
  return [
    { key: "basic", name: LAUNCH.entryPlan, price: { main: "$0", unit: "", lines: ["No subscription"] },
      who: PLAN_WHO.basic, intro: "", features: [...EVERY_PLAN],
      limits: limits("basic", { History: BASIC_KEPT }) },
    { key: "pro", name: planLabel("pro"), price: priceBlock("pro"),
      who: PLAN_WHO.pro, intro: `Everything in ${LAUNCH.entryPlan}, and:`,
      features: feats.filter((r) => r.pro === true).map((r) => r.label), limits: limits("pro") },
    { key: "max", name: planLabel("max"), price: priceBlock("max"),
      who: PLAN_WHO.max, intro: PLAN_FEATURES.max[0],
      features: feats.filter((r) => r.max === true && r.pro !== true).map((r) => r.label), limits: limits("max") },
  ];
}

// ── The launch price guarantee's window (lib/launch.js LAUNCH.guarantee holds the words) ─────────
/**
 * The guarantee is offered to subscriptions started on or before December 31, 2026, Chicago time:
 * the first instant it is no longer offered is 2027-01-01 00:00 in America/Chicago, which is 06:00 UTC
 * (Chicago is on standard time, UTC-6, in January). web/tests/pricing_test.js checks it with the zone.
 */
export const GUARANTEE_ENDS_MS = Date.UTC(2027, 0, 1, 6, 0, 0);

/**
 * True while the guarantee is still offered at [nowMs] (the viewer's clock, read when the page is shown):
 * the product page and the dashboard hide it from GUARANTEE_ENDS_MS on. The terms keep it for everyone
 * who subscribed in time.
 */
export const guaranteeOpen = (nowMs = Date.now()) => !(Number(nowMs) >= GUARANTEE_ENDS_MS);

/** The plan column to highlight: "pro", "max" (Max and Business), "basic", or "" when the plan was not read. */
export function currentColumn(t) {
  if (t && typeof t === "object" && t.unknown) return "";
  const k = tierKey(t);
  return k === "pro" ? "pro" : rank[k] >= rank.max ? "max" : "basic";
}

/**
 * True below Max, and while a trial lifts the plan (the app shows its trial note on the paywall, next
 * to the purchase buttons): the Upgrade card shows.
 */
export const canUpgrade = (t) => countsDown(t) || rank[tierKey(t)] < rank.max;

/** True when the plan is managed in Google Play (paid or promotional). */
export function managedInPlay(t) {
  const s = String((t && t.source) || "").toLowerCase();
  return s === "paid" || s === "promo";
}

/**
 * The delete dialog's Google Play warning: a paid or promotional plan, or a plan of Pro and up that the
 * trial does not explain (AccountScreen: "the stored (not trial) tier is ≥ Pro"). The app can ask Play
 * Billing directly; this page cannot, so a plan it could not check always gets the warning.
 */
export function needsPlayWarning(t) {
  if (!t || t.unknown) return true;
  const s = String(t.source || "").toLowerCase();
  if (s === "paid" || s === "promo") return true;
  return rank[tierKey(t)] >= rank.pro && s !== "trial";
}
