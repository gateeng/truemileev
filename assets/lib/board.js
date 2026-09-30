// TrueMile EV web: the Board strip (get_stats) as a display model. Pure, DOM-free.
// Params: SupabaseClient.kt:1336-1370. Labels and conversions: BoardScreen.kt:96-110, 590-850,
// BoardScope.tagFor ("ALL TIME"). This file is the ONLY reader of the reply's two prepaid keys; they
// are shown as "Prepaid" ($ and kWh), as the app shows them.

import { fromLocal, parts } from "./tz.js";
import { eff, speed, economy, perDist, labels } from "./units.js";
import { fixed } from "./format.js";
import { allows, lockText } from "./gates.js";

export const BUILD = "2026-09-30.1";

export const TAG = "ALL TIME";
export const DEFAULT_MPG = 25;
export const DEFAULT_GAS = 3.20;

/**
 * The query the app sends: month_start = local midnight on the 1st of this month (so the month is
 * the viewer's, not UTC's), mpg (the comparison mpg; default 25), gas ($/gal; default 3.20) and cap
 * (towing capacity lbs; 0 when unknown).
 */
export function boardParams(nowMs, zone, fuel, towCap) {
  const p = parts(nowMs, zone);
  const mpg = Number(fuel && fuel.mpg) > 0 ? Number(fuel.mpg) : DEFAULT_MPG;
  const gas = Number(fuel && fuel.gasPrice) > 0 ? Number(fuel.gasPrice) : DEFAULT_GAS;
  const cap = Number(towCap) > 0 ? Math.trunc(Number(towCap)) : 0;
  return { month_start: fromLocal(p.y, p.mo, 1, 0, 0, 0, 0, zone), mpg, gas, cap };
}

/** A reply value as a number (the reply carries pre-formatted strings), or null when unreadable. */
const n = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
/** The app's String → Double → "%.Nf" round trip; an unreadable value is shown as it came. */
const conv = (v, f, d) => { const x = n(v); return x === null ? String(v ?? "") : fixed(f(x), d); };

/**
 * The Board strip's display model. Every item is {key, label, value, token} (token = the metric
 * colour: cost, efficiency, distance, charging, regen); a locked one also carries locked + lockText.
 * [tier] gates "Saved" (EV_VS_ICE, Pro) exactly as the Board does.
 */
export function boardModel(reply, units, tier) {
  const L = labels(units);
  const fin = (reply && reply.financial) || {};
  const perf = (reply && reply.performance) || {};
  const chg = (reply && reply.chargeStats) || {};

  const hero = [
    { key: "avg_per_dist", label: `Avg ${L.perDist}`, value: "$" + conv(fin.avgDollarPerMile ?? "0.000", (x) => perDist(x, units), 3), token: "cost" },
    { key: "avg_eff", label: `Avg ${L.eff}`, value: conv(perf.avgMiPerKwh ?? "0.00", (x) => eff(x, units), 2), token: "efficiency" },
  ];

  const savedLocked = tier !== undefined && !allows(tier, "saved");
  const financial = [
    { key: "prepaid_dollars", label: "Prepaid", value: "$" + String(fin.bankValueDollars ?? "0.00"), token: "cost" },
    { key: "total_paid", label: "Total paid", value: "$" + String(fin.totalCostDollars ?? "0.00"), token: "cost" },
    savedLocked
      ? { key: "saved", label: "Saved", value: "🔒", token: "regen", locked: true, lockText: lockText("saved") }
      : { key: "saved", label: "Saved", value: "$" + String(fin.savingsDollars ?? "0.00"), token: "regen" },
    { key: "prepaid_kwh", label: "Prepaid", value: String(fin.bankKwh ?? "0.00") + " kWh", token: "charging" },
  ];

  const used = n(perf.totalUsedKwh) ?? 0;
  const regen = n(perf.totalRegenKwh) ?? 0;
  const regenPct = used > 0 ? fixed(regen / used * 100, 1) : "0.0";
  const spd = n(perf.avgSpeedMph);
  const mpge = n(perf.mpge);
  const performance = [
    { key: "eff", label: "Efficiency", value: `${conv(perf.avgMiPerKwh ?? "0.00", (x) => eff(x, units), 2)} ${L.eff}`, token: "efficiency" },
    { key: "speed", label: "Avg speed", value: `${spd === null ? "0" : fixed(speed(spd, units), 0)} ${L.speed}`, token: "distance" },
    { key: "economy", label: "Economy", value: `${mpge === null ? "0.0" : fixed(economy(mpge, units), 1)} ${L.econ}`, token: "efficiency" },
    { key: "regen", label: "Regen", value: `${regenPct}% regen`, token: "regen" },
  ];

  const dcMin = n(chg.avgDcTimeMin) ?? 0;
  const charging = [
    { key: "sessions", label: "sessions", value: String(Math.trunc(n(chg.sessionCount) ?? 0)), token: "distance" },
    { key: "charged", label: "charged", value: `${String(chg.sumTotalKwh ?? "0")} kWh`, token: "charging" },
    { key: "avg_dc", label: "avg DC", value: dcMin > 0 ? `${fixed(dcMin, 0)} min` : "—", token: "charging" },
    { key: "per_kwh", label: "/kWh", value: "$" + String(chg.avgRatePerKwh ?? "0.000"), token: "cost" },
  ];

  return { tag: TAG, hero, financial, performance, charging };
}
