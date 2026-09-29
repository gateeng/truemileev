// TrueMile EV web: the Financial section's money figures. Pure, DOM-free.
//
// - Spend by network: one entry per network the owner typed in the app (trimmed, case-insensitive,
//   whitespace collapsed); "Home" is its own entry.
// - periodSaved: a literal port of get_stats' "Saved" (supabase/functions/get_stats/index.ts:446-485),
//   so any window of rows gives what the Board would give for the same rows. Charge-odometer basis
//   first (Σ actual_miles ÷ mpg × the gas price frozen on each charge), the trip basis only when no
//   charge carries mileage, then the tow surcharge added AFTER the clamp (the device's order).
// - monthTable: the Board's monthly recap for every month (local zone).
// - Memberships: the app records none, so the list is per browser (views/financial.js keeps it in
//   localStorage). Their fees are shown on their own line and never enter Total paid or a tile.
// - The Charge section's extra tiles (fast sessions, home share, average session, fees).

import { isHomeNetwork } from "./stops.js";
import { isDc, aggregateEff } from "./rows.js";
import { parts, fromLocal, addMonths } from "./tz.js";

export const BUILD = "2026-09-29.2";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DAY = 86_400_000;

// ── networks ──────────────────────────────────────────────────────────────────────────────────

/** The network's key: trimmed, lower-cased, whitespace collapsed; blank → ""; the Home family → "home". */
export function networkKey(network) {
  const s = String(network ?? "").trim().replace(/\s+/g, " ");
  if (s === "") return "";
  if (isHomeNetwork({ network: s })) return "home";
  return s.toLowerCase();
}

/** The label of a key: "Home", "Unnamed" for blank, else the most frequent original spelling (trimmed). */
export function networkLabel(charges, key) {
  if (key === "home") return "Home";
  if (key === "") return "Unnamed";
  const counts = new Map();
  for (const c of charges || []) {
    if (networkKey(c.network) !== key) continue;
    const s = String(c.network ?? "").trim().replace(/\s+/g, " ");
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [s, n] of counts) {
    // The most frequent spelling; a tie goes to the one that sorts first, so the label is stable.
    if (n > bestN || (n === bestN && best !== null && s < best)) { best = s; bestN = n; }
  }
  return best ?? key;
}

function accumulate(list) {
  const e = { sessions: 0, kwh: 0, cost: 0, fees: 0, dc: 0, pkKwh: 0, pkCost: 0 };
  for (const c of list) {
    const home = networkKey(c.network) === "home";
    e.sessions++;
    e.kwh += num(c.totalKwh);
    e.cost += num(c.total);
    e.fees += num(c.fee);
    if (num(c.totalKwh) > 0) { e.pkKwh += num(c.totalKwh); e.pkCost += num(c.total); }
    if (!home && isDc(c)) e.dc++;
  }
  return {
    sessions: e.sessions, kwh: e.kwh, cost: e.cost, fees: e.fees,
    perKwh: e.pkKwh > 0 ? e.pkCost / e.pkKwh : null,
    fastShare: e.sessions > 0 ? e.dc / e.sessions : 0,
  };
}

/**
 * Spend by network: [{key, label, sessions, kwh, cost, fees, perKwh, fastShare}] over [charges] (every
 * row counts toward the sums). perKwh = Σ$ ÷ ΣkWh over rows with kWh > 0 (null when none);
 * fastShare = DC sessions ÷ sessions (Home is never DC). Home first, then by cost (highest first),
 * then by label.
 */
export function networkFold(charges) {
  const by = new Map();
  for (const c of charges || []) {
    const key = networkKey(c.network);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(c);
  }
  const out = [];
  for (const [key, list] of by) out.push({ key, label: networkLabel(list, key), ...accumulate(list) });
  return out.sort((a, b) => (a.key === "home" ? -1 : 0) - (b.key === "home" ? -1 : 0) ||
    b.cost - a.cost || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** The totals row over the same charges: {sessions, kwh, cost, fees, perKwh, fastShare}. */
export const chargeTotals = (charges) => accumulate(charges || []);

// ── Saved (get_stats parity) ──────────────────────────────────────────────────────────────────

const priceOf = (frozen, gasNow) => (num(frozen) > 0 ? num(frozen) : (num(gasNow) > 0 ? num(gasNow) : 0));

/**
 * get_stats' Saved over the given rows. [charges] = visible charge rows (seed rows included, as the
 * server keeps them); [trips] = own drives (car_status ""). mpg / gasNow = the comparison car and
 * today's gas price; towCap = the towing capacity in lbs (0 = unknown → no surcharge).
 * -> {saved, ice, ev, towExtra}; saved = max(0, ice − ev) + towExtra.
 */
export function periodSaved({ charges = [], trips = [], mpg = 0, gasNow = 0, towCap = 0 } = {}) {
  const m = num(mpg), cap = num(towCap);
  let ice = 0, ev = 0, towExtra = 0;
  const chargeMiles = charges.reduce((a, c) => a + num(c.actualMiles), 0);
  if (m > 0 && chargeMiles > 0) {
    ice = charges.reduce((a, c) => a + (num(c.actualMiles) / m) * priceOf(c.gasPrice, gasNow), 0);
    ev = charges.reduce((a, c) => a + num(c.total), 0);
  } else if (m > 0) {
    ice = trips.reduce((a, t) => a + (num(t.miles) / m) * priceOf(t.gasPrice, gasNow), 0);
    ev = trips.reduce((a, t) => a + num(t.cost), 0);
  }
  if (m > 0 && cap > 0) {
    for (const t of trips) {
      const w = num(t.towLbs);
      if (w <= 0) continue;
      const mpgTow = m * (1 - 0.5 * Math.min(1, w / cap));
      if (mpgTow > 0) towExtra += num(t.miles) * priceOf(t.gasPrice, gasNow) * (1 / mpgTow - 1 / m);
    }
  }
  return { saved: Math.max(0, ice - ev) + towExtra, ice, ev, towExtra };
}

/** What the same driving would have cost in gas (the ICE side of periodSaved). */
export const gasEquivalent = (o) => periodSaved(o).ice;

/** Σ $ of the Home rows. */
export const homeCost = (charges) => (charges || []).reduce((a, c) => a + (networkKey(c.network) === "home" ? num(c.total) : 0), 0);
/** Σ $ of every row that is not Home. */
export const publicCost = (charges) => (charges || []).reduce((a, c) => a + (networkKey(c.network) === "home" ? 0 : num(c.total)), 0);
/** Σ session fees. */
export const fees = (charges) => (charges || []).reduce((a, c) => a + num(c.fee), 0);

// ── the Charge section's extra tiles ──────────────────────────────────────────────────────────

/** Fast (DC) sessions, the pre-install seed row left out. Home is never fast. */
export const dcSessions = (charges) =>
  (charges || []).filter((c) => !c.isSeed && networkKey(c.network) !== "home" && isDc(c)).length;

/** Σ Home kWh ÷ Σ kWh, as a percent; null without energy. */
export function homeShare(charges) {
  let all = 0, home = 0;
  for (const c of charges || []) {
    all += num(c.totalKwh);
    if (networkKey(c.network) === "home") home += num(c.totalKwh);
  }
  return all > 0 ? home / all * 100 : null;
}

/** Σ kWh ÷ sessions over the rows the averages use (no seed row, no unconfirmed row); null when none. */
export function avgSessionKwh(charges) {
  const real = (charges || []).filter((c) => !c.isSeed && !c.lowConfidence);
  if (!real.length) return null;
  return real.reduce((a, c) => a + num(c.totalKwh), 0) / real.length;
}

// ── by month ──────────────────────────────────────────────────────────────────────────────────

/**
 * One row per local month that has a drive or a charge, newest first, at most [limit] rows.
 * [ownTrips] = own drives; [charges] = visible charges; [fuel] = {mpg, gasPrice}.
 * Row: {key "yyyy-mm", y, mo, start, end, miles, trips, used, eff (mi/kWh or null), tripCost,
 *       chargeCost, perMile (trip basis, else charge basis, else null), saved}.
 */
export function monthTable(ownTrips, charges, zone, fuel = {}, towCap = 0, limit = 12) {
  const months = new Map();
  const slot = (ms) => {
    const p = parts(ms, zone);
    const key = `${p.y}-${String(p.mo).padStart(2, "0")}`;
    let m = months.get(key);
    if (!m) { m = { key, y: p.y, mo: p.mo, trips: [], charges: [] }; months.set(key, m); }
    return m;
  };
  for (const t of ownTrips || []) slot(t.date).trips.push(t);
  for (const c of charges || []) slot(c.date).charges.push(c);
  const keys = [...months.keys()].sort().reverse().slice(0, Math.max(0, limit));
  return keys.map((key) => {
    const m = months.get(key);
    let miles = 0, used = 0, tripCost = 0, mMiles = 0, mUsed = 0, mRegen = 0;
    for (const t of m.trips) {
      miles += num(t.miles); used += num(t.usedKwh); tripCost += num(t.cost);
      if (t.isReconciled) continue;
      mMiles += num(t.miles); mUsed += num(t.usedKwh); mRegen += num(t.regenKwh);
    }
    let chargeCost = 0, chargeMiles = 0;
    for (const c of m.charges) { chargeCost += num(c.total); chargeMiles += num(c.actualMiles); }
    const perMile = tripCost > 0.001 && miles > 0.001 ? tripCost / miles
      : chargeCost > 0.001 && chargeMiles > 0.001 ? chargeCost / chargeMiles : null;
    const start = fromLocal(m.y, m.mo, 1, 0, 0, 0, 0, zone);
    const end = fromLocal(m.y, m.mo + 1, 1, 0, 0, 0, 0, zone) - 1;
    return {
      key, y: m.y, mo: m.mo, start, end,
      miles, trips: m.trips.length, used,
      eff: aggregateEff(mMiles, mUsed, mRegen),
      tripCost, chargeCost, perMile,
      saved: periodSaved({ charges: m.charges, trips: m.trips, mpg: fuel.mpg, gasNow: fuel.gasPrice, towCap }).saved,
    };
  });
}

// ── memberships (kept in this browser only) ───────────────────────────────────────────────────

export const MEMBERSHIP_LIMIT = 12;
export const MEMBERSHIP_NAME_MAX = 60;

const fee = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
const epoch = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; };

/**
 * A stored membership, validated: {id, name, network (a networkKey), monthlyFee, annualFee, startMs,
 * endMs | null}; null when the name or the start date is missing. An end before the start is dropped.
 */
export function normMembership(o) {
  if (!o || typeof o !== "object") return null;
  const name = String(o.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MEMBERSHIP_NAME_MAX).trim();
  const startMs = epoch(o.startMs);
  if (!name || startMs === null) return null;
  let endMs = epoch(o.endMs);
  if (endMs !== null && endMs < startMs) endMs = null;
  const id = String(o.id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return {
    id: id || `m${startMs.toString(36)}${name.length}`,
    name,
    network: networkKey(o.network),
    monthlyFee: fee(o.monthlyFee),
    annualFee: fee(o.annualFee),
    startMs,
    endMs,
  };
}

/** A stored list (any JSON value) → at most 12 valid memberships, in stored order. */
export function normMemberships(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const o of list) {
    const m = normMembership(o);
    if (!m) continue;
    while (ids.has(m.id)) m.id += "x";
    ids.add(m.id);
    out.push(m);
    if (out.length >= MEMBERSHIP_LIMIT) break;
  }
  return out;
}

/**
 * The fees a membership costs inside [win] ({start, end}):
 *  - monthly: one whole monthly fee for every billing date inside the window and inside the membership
 *    (billing dates = the start date, then the same day each month, clamped to short months);
 *  - annual: pro-rated by the days the membership overlaps the window ÷ 365.
 * -> {monthly, annual, total, months, days}
 */
export function membershipFees(m, win, zone = "UTC") {
  const zero = { monthly: 0, annual: 0, total: 0, months: 0, days: 0 };
  if (!m || !win) return zero;
  const from = Math.max(num(win.start), m.startMs);
  const to = Math.min(num(win.end), m.endMs ?? Infinity);
  if (!(to >= from)) return zero;
  let months = 0;
  if (m.monthlyFee > 0) {
    for (let k = 0; k < 2400; k++) {
      const bill = k === 0 ? m.startMs : addMonths(m.startMs, k, zone);
      if (bill > to) break;
      if (m.endMs !== null && bill > m.endMs) break;
      if (bill >= from) months++;
    }
  }
  const days = (to - from + 1) / DAY;
  const monthly = months * m.monthlyFee;
  const annual = m.annualFee > 0 ? m.annualFee * days / 365 : 0;
  return { monthly, annual, total: monthly + annual, months, days };
}

/**
 * Per membership inside [win]: its fees and its network's sessions / kWh / $ DURING the membership —
 * the charges inside both the window and [startMs, endMs] (open-ended when there is no end), the same
 * span its fees are counted over, so "$/kWh with fee" never divides the fees by energy bought outside it.
 * -> {rows: [{m, label, fees, sessions, kwh, cost, withFee, perKwh, perKwhWithFee}], totalFees}
 */
export function membershipRows(list, charges, win, zone = "UTC") {
  const all = charges || [];
  let totalFees = 0;
  const rows = (list || []).map((m) => {
    const f = membershipFees(m, win, zone);
    const from = Math.max(win ? num(win.start) : -Infinity, m.startMs);
    const to = Math.min(win ? num(win.end) : Infinity, m.endMs ?? Infinity);
    const during = all.filter((c) => c.date >= from && c.date <= to && networkKey(c.network) === m.network);
    const e = networkFold(during).find((x) => x.key === m.network) || null;
    const kwh = e ? e.kwh : 0, cost = e ? e.cost : 0;
    totalFees += f.total;
    return {
      m,
      label: m.network === "" ? "Unnamed" : networkLabel(charges, m.network) || m.network,
      fees: f,
      sessions: e ? e.sessions : 0,
      kwh,
      cost,
      withFee: cost + f.total,
      perKwh: e ? e.perKwh : null,
      perKwhWithFee: kwh > 0 ? (cost + f.total) / kwh : null,
    };
  });
  return { rows, totalFees };
}

/**
 * The fixture page's two demo memberships (synthetic values, memory only): both start six months
 * before [nowMs] at local midnight.
 */
export function demoMemberships(nowMs, zone = "UTC") {
  const p = parts(addMonths(nowMs, -6, zone), zone);
  const start = fromLocal(p.y, p.mo, p.d, 0, 0, 0, 0, zone);
  return normMemberships([
    { id: "demo-tesla", name: "Tesla Supercharging membership", network: "tesla", monthlyFee: 12.99, annualFee: 0, startMs: start },
    { id: "demo-ea", name: "Electrify America Pass+", network: "electrify america", monthlyFee: 7, annualFee: 0, startMs: start },
  ]);
}
