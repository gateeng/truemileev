// TrueMile EV web: plan names, the trial copy and what each plan includes. Pure, DOM-free.
// Sources: TierRepository.tierLabel, TrialWindow.kt (banner copy, tierLabelWithTrial, banner state),
// PaywallScreen.kt (featureLabel, proFeatures, maxFeatures, the trial note) and BillingManager.kt (the
// Play links; the PUBLISHED package only). The lowest plan is called "Basic" (LAUNCH.entryPlan): the
// app's internal id for it is a word this page never uses. Plans are bought in Google Play inside the
// app; the US prices, the trial length and the Android Auto / watch lines come from lib/launch.js.

import { tierOf, rank } from "./gates.js";
import { LAUNCH, priceLine } from "./launch.js";

export const BUILD = "2026-09-30.2";

/** The app's Google Play store listing. */
export const PLAY_LISTING = "https://play.google.com/store/apps/details?id=com.gateengineering.truemileev";
/** Google Play's own subscriptions page (manage, cancel, receipts). */
export const PLAY_SUBSCRIPTIONS = "https://play.google.com/store/account/subscriptions";

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
    "Open any drive's full detail",
    "Tag drives as commute, business or personal",
    "Tap a charger on the map for your history there",
    "Insights: personalized range and route energy",
    "Money saved compared with gas",
    "Climate energy use",
    "Full cost breakdowns per drive and per charge",
    "Home charging logged automatically",
    "Towing mode with trailer profiles",
    "Home-screen widgets",
    "Import charges and drives from CSV",
    "Formatted CSV export",
    "PDF report for a date range",
    "Restore your history on a new phone",
    "Track up to 2 vehicles",
    "See the last 6 months of drives and charges",
    "3-month window on PDF reports",
  ]),
  max: Object.freeze([
    "Everything in Pro, and:",
    "Speed, wind, elevation and efficiency graphs per drive",
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
 * The Pro | Max comparison: every feature of either plan once, then the three limits side by side.
 * -> [{label, pro, max}] where pro / max are true (included), false (not included) or a limit's text.
 */
export function comparisonRows() {
  const pro = PLAN_FEATURES.pro, max = PLAN_FEATURES.max;
  const proFeat = pro.slice(0, pro.length - LIMITS);
  const maxFeat = max.slice(1, max.length - LIMITS);
  const rows = [
    ...proFeat.map((label) => ({ label, pro: true, max: true })),
    ...maxFeat.map((label) => ({ label, pro: false, max: true })),
  ];
  const names = ["Vehicles", "History", "PDF reports"];
  const proLim = pro.slice(pro.length - LIMITS), maxLim = max.slice(max.length - LIMITS);
  names.forEach((label, i) => rows.push({ label, pro: proLim[i], max: maxLim[i] }));
  return rows;
}

/** The plan column to highlight: "pro", "max" (Max and Business) or "" (Basic). */
export function currentColumn(t) {
  const k = tierKey(t);
  return k === "pro" ? "pro" : rank[k] >= rank.max ? "max" : "";
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
