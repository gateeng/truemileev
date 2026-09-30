// TrueMile EV web | #/financial: the Financial section. Top to bottom: the all-time Board money (the
// page's shared get_stats reply: Total paid, Saved, Prepaid $ and kWh, Avg $/mi, Avg mi/kWh), the
// period bar and the section's tiles, the money charts, spend by network, the month table, the
// memberships the viewer keeps in this browser, and the fuel comparison that "Saved" is measured against.
// Also exports mountBoardCard, the Board card the Charge section reuses.
//
// Memberships: the app records none, so this list lives in localStorage ("tm.memberships", never
// uploaded). Their fees show on their own line and never enter Total paid or a tile.

import { esc, store, openSheet, openDialog, qs } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import * as api from "../lib/api.js";
import { mountRangeBar } from "./rangebar.js";
import { mountTileGrid } from "./tilegrid.js";
import { mountCharts } from "./charts.js";
import { boardParams, boardModel, TAG } from "../lib/board.js";
import { fixed, money, dateFmt, MONTHS } from "../lib/format.js";
import { dist, eff, perDist, labels, isMetric } from "../lib/units.js";
import { tileWindow, halfCustomWindow, stateFromQuery, RANGES, DEFAULT_RANGE, steppable } from "../lib/periods.js";
import { inScope, ownTrips } from "../lib/rows.js";
import { allows, lockText } from "../lib/gates.js";
import { parts, fromLocal, ymd, parseYmd, endOfDay } from "../lib/tz.js";
import {
  networkFold, chargeTotals, periodSaved, homeCost, publicCost, fees, monthTable, normMemberships, membershipRows,
  demoMemberships, networkKey, MEMBERSHIP_LIMIT, MEMBERSHIP_NAME_MAX,
} from "../lib/finance.js";
import { emptyFilter, formatChargeFilter, formatNets } from "../lib/chargefilter.js";

export const BUILD = "2026-09-30.1";

export const MEMBERSHIPS_KEY = "tm.memberships";
const DAY = 86_400_000;
const LITERS_PER_GALLON = 3.785411784;
const L100_FROM_MPG = 235.214583;

const BOARD_NOTE = "As on your Board. The app reads these same figures.";
const MEMBERS_INTRO = "TrueMile doesn't record charging memberships, so there are none to show from the app. Add yours here to see their fees next to what you spent on that network. This list stays in this browser and is never uploaded.";
const STORAGE_BLOCKED = "This browser is blocking site storage, so these choices last until you close the tab.";

// ── the Board card (shared with Charge) ──────────────────────────────────────────────────────

function boardItemHtml(it) {
  const color = `var(--m-${it.token}, var(--m-cost))`;
  if (it.locked) {
    return `<div class="financial-bitem locked" title="${esc(it.lockText)}">` +
      `<span class="financial-bv">${icon("lock", { size: 18 })}</span>` +
      `<span class="financial-bk">${esc(it.label)}</span><span class="financial-block">${esc(it.lockText)}</span></div>`;
  }
  return `<div class="financial-bitem"><span class="financial-bv" style="color:${color}">${esc(it.value)}</span>` +
    `<span class="financial-bk">${esc(it.label)}</span></div>`;
}

/**
 * mountBoardCard(el, ctx, {title, pick}) → {destroy()}: one card of Board figures for the header
 * vehicle. [pick](model) chooses the items of lib/board.js boardModel. get_stats runs at most once per
 * page load (api.boardStats keeps the reply); a later vehicle waits for a click.
 */
export function mountBoardCard(el, ctx, { title = "Board", pick = (m) => m.financial } = {}) {
  let alive = true;
  const head = `<div class="card-head"><h3 class="card-title">${esc(title)}</h3><span class="card-tag">${esc(TAG)}</span></div>`;
  const wrap = (inner) => { el.innerHTML = `<div class="card financial-board">${head}${inner}</div>`; };
  const single = ctx.scope && ctx.scope.id && ctx.scope.id !== "all";
  function load(explicit) {
    wrap(`<div class="financial-bgrid" aria-busy="true">${[0, 1, 2, 3].map(() => `<div class="financial-bitem skel"><span class="skel-bar w60"></span><span class="skel-bar w40"></span></div>`).join("")}</div>`);
    const params = boardParams(ctx.now(), ctx.tz, ctx.account.fuel, ctx.account.towCap);
    api.boardStats(ctx.scope.id, params, { explicit }).then((reply) => {
      if (!alive) return;
      const m = boardModel(reply, ctx.units, ctx.tier);
      wrap(`<div class="financial-bgrid">${pick(m).map(boardItemHtml).join("")}</div><p class="note">${esc(BOARD_NOTE)}</p>`);
    }).catch((err) => {
      if (alive) wrap(`<div class="msg err">The Board figures did not load: ${esc((err && err.message) || String(err))}</div>`);
    });
  }
  if (!single) {
    wrap(`<p class="note">Board figures are per vehicle. Pick one vehicle to see them.</p>`);
  } else if (api.boardStatsState(ctx.scope.id) === "click") {
    wrap(`<button type="button" class="btn financial-bload">Show Board figures for this vehicle</button><p class="note">${esc(BOARD_NOTE)}</p>`);
    const onClick = (e) => { if (e.target.closest(".financial-bload")) { el.removeEventListener("click", onClick); load(true); } };
    el.addEventListener("click", onClick);
  } else {
    load(false);
  }
  return { destroy() { alive = false; el.innerHTML = ""; } };
}

// ── the section's extra tiles ─────────────────────────────────────────────────────────────────

/** The Financial grid's extras (tilegrid; x = {agg, trips, charges, units, tier, win}). */
export function financialExtras(account) {
  const fuel = account.fuel || {};
  const saved = (x) => periodSaved({ charges: x.charges, trips: x.trips, mpg: fuel.mpg, gasNow: fuel.gasPrice, towCap: account.towCap });
  return {
    saved: { label: () => "Saved", blurb: "What gas would have cost, minus what charging cost", color: "var(--m-regen)", gate: "saved",
      value: (x) => money(saved(x).saved) },
    // Gated with Saved: next to the Charge Cost tile it would give Saved away.
    gas_equivalent: { label: () => "Gas equivalent", blurb: "What the same driving would have cost in gas", color: "var(--caution, var(--amber))",
      gate: "saved", value: (x) => money(saved(x).ice) },
    home_cost: { label: () => "Home", blurb: "What charging at home cost", color: "var(--c-board, var(--m-cost))", value: (x) => money(homeCost(x.charges)) },
    public_cost: { label: () => "Public", blurb: "What charging away from home cost", color: "var(--m-charging)", value: (x) => money(publicCost(x.charges)) },
    fees: { label: () => "Fees", blurb: "Session fees", color: "var(--m-cost)", value: (x) => money(fees(x.charges)) },
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

function windowFor(st, now, zone) {
  const w = tileWindow(st.range, now, st.off, st.from, st.to, zone);
  if (w) return { win: w, half: false };
  return { win: halfCustomWindow(st.from, st.to, zone, now) || { start: now - 7 * DAY, end: now }, half: true };
}

const pct = (x) => `${fixed(x * 100, 0)}%`;
const perKwhText = (v) => (v === null || v === undefined ? "—" : money(v, 3));

function dateInputValue(ms, zone) { return ms ? ymd(ms, zone) : ""; }
function dateFromInput(v, zone, endOfTheDay = false) {
  const p = parseYmd(v);
  if (!p) return null;
  const start = fromLocal(p.y, p.mo, p.d, 0, 0, 0, 0, zone);
  return endOfTheDay ? endOfDay(start, zone) : start;
}

// ── the page ──────────────────────────────────────────────────────────────────────────────────

export function mount(el, ctx) {
  const zone = ctx.tz, units = ctx.units, L = labels(units);
  const account = ctx.account;
  const defaultRange = RANGES.includes(ctx.defaultRange) ? ctx.defaultRange : DEFAULT_RANGE;
  const q = ctx.query || {};
  const st = stateFromQuery({ ...q, range: RANGES.includes(q.range) ? q.range : (q.from || q.to ? "custom" : defaultRange) });
  const scopeCharges = account.charges.filter((c) => inScope(c, ctx.scope));
  const scopeTrips = account.trips.filter((t) => inScope(t, ctx.scope));
  const ownAny = ownTrips(scopeTrips);
  const costOk = allows(ctx.tier, "costAnalytics");
  const savedOk = allows(ctx.tier, "saved");
  const fixtures = !!ctx.fixtures || api.mode() === "fixtures";
  const fuel = account.fuel || {};

  // Memberships: this browser's list, or the demo pair in memory.
  let members = fixtures ? demoMemberships(ctx.now(), zone) : normMemberships(store.getJson(MEMBERSHIPS_KEY, []));
  let storageNote = "";
  const saveMembers = () => {
    if (fixtures) return;
    const ok = store.setJson(MEMBERSHIPS_KEY, members);
    storageNote = ok === false ? STORAGE_BLOCKED : "";
  };

  el.innerHTML = `<section class="financial-view">` +
    `<div class="financial-alltime"></div>` +
    `<div class="financial-controls"><div class="financial-range"></div></div>` +
    `<div class="financial-tiles"></div>` +
    `<div class="financial-charts"></div>` +
    `<div class="card financial-networks"></div>` +
    `<div class="card financial-months"></div>` +
    `<div class="card financial-members"></div>` +
    `<div class="card financial-fuel"></div>` +
    `</section>`;
  const $ = (s) => el.querySelector(s);

  const board = mountBoardCard($(".financial-alltime"), ctx, {
    title: "Board",
    pick: (m) => {
      const f = (k) => m.financial.find((x) => x.key === k);
      return [f("total_paid"), f("saved"), f("prepaid_dollars"), f("prepaid_kwh"), ...m.hero].filter(Boolean);
    },
  });

  const commit = () => {
    ctx.setQuery({
      range: st.range === defaultRange ? "" : st.range,
      off: st.off && steppable(st.range) ? String(st.off) : "",
      from: st.range === "custom" ? st.from : "", to: st.range === "custom" ? st.to : "",
    });
  };
  const rangeHandle = mountRangeBar($(".financial-range"),
    { range: st.range, off: st.off, from: st.from, to: st.to, nowMs: ctx.now(), zone, allowCustom: true, steppable: true },
    (next) => {
      st.range = RANGES.includes(next.range) ? next.range : st.range;
      st.off = steppable(st.range) ? Math.min(0, Math.trunc(Number(next.off)) || 0) : 0;
      st.from = st.range === "custom" ? next.from || "" : "";
      st.to = st.range === "custom" ? next.to || "" : "";
      commit(); refresh();
    });

  let grid = null;
  try {
    grid = mountTileGrid($(".financial-tiles"), ctx, {
      section: "financial", extras: financialExtras(account), onStep: (d) => rangeHandle.step(d),
      ariaLabel: "Money tiles. Left and right arrow keys step the period.",
    });
  } catch (e) {
    $(".financial-tiles").innerHTML = `<p class="msg err">${esc(String((e && e.message) || e))}</p>`;
  }
  const charts = mountCharts($(".financial-charts"), ctx, { ids: ["money", "cost"], title: "Money" });

  function periodQuery() {
    return formatChargeFilter(emptyFilter({ range: st.range, off: st.off, from: st.from, to: st.to }), defaultRange);
  }

  // ── spend by network ──
  function drawNetworks(rows) {
    const fold = networkFold(rows);
    const tot = chargeTotals(rows);
    const base = periodQuery();
    const head = `<div class="card-head"><h3 class="card-title">Spend by network</h3></div>`;
    if (!fold.length) {
      $(".financial-networks").innerHTML = head + `<p class="empty">${icon("ev_station")}<span>No charges in this period.</span></p>`;
      return;
    }
    const row = (e) => {
      // Unnamed sessions have no network to filter by, so their row does not link.
      const href = e.key === "" ? "" : "#/charge" + qs({ ...base, net: formatNets(new Set([e.key])) });
      return `<tr class="financial-netrow"${href ? ` data-href="${esc(href)}"` : ""}>` +
        `<td class="financial-left">${href ? `<a href="${esc(href)}">${esc(e.label)}</a>` : esc(e.label)}</td>` +
        `<td>${e.sessions}</td><td>${esc(fixed(e.kwh, 1))}</td><td>${esc(money(e.cost))}</td><td>${esc(perKwhText(e.perKwh))}</td>` +
        `<td>${esc(money(e.fees))}</td><td>${esc(pct(e.fastShare))}</td></tr>`;
    };
    $(".financial-networks").innerHTML = head +
      `<div class="scroll"><table class="table financial-table"><thead><tr>` +
      `<th class="financial-left">Network</th><th>Sessions</th><th>Energy (kWh)</th><th>Cost</th><th>$/kWh</th><th>Fees</th><th>Fast share</th>` +
      `</tr></thead><tbody>${fold.map(row).join("")}</tbody><tfoot><tr class="financial-total">` +
      `<td class="financial-left">Totals</td><td>${tot.sessions}</td><td>${esc(fixed(tot.kwh, 1))}</td><td>${esc(money(tot.cost))}</td>` +
      `<td>${esc(perKwhText(tot.perKwh))}</td><td>${esc(money(tot.fees))}</td><td>${esc(pct(tot.fastShare))}</td></tr></tfoot></table></div>` +
      `<p class="note">Network names are the ones you typed in the app.</p>`;
  }

  // ── by month ──
  function drawMonths() {
    const box = $(".financial-months");
    const head = `<div class="card-head"><h3 class="card-title">By month</h3><span class="card-tag">LAST 12 MONTHS</span></div>`;
    if (!costOk) {
      box.innerHTML = head + `<p class="note lock">${icon("lock", { size: 16 })} ${esc(lockText("costAnalytics"))}</p>`;
      return;
    }
    const rows = monthTable(ownAny, scopeCharges, zone, fuel, account.towCap);
    if (!rows.length) { box.innerHTML = head + `<p class="empty">${icon("receipt_long")}<span>No drives or charges yet.</span></p>`; return; }
    const now = parts(ctx.now(), zone);
    box.innerHTML = head + `<div class="scroll"><table class="table financial-table"><thead><tr>` +
      `<th class="financial-left">Month</th><th>Distance (${esc(L.dist)})</th><th>Trips</th><th>Used kWh</th><th>${esc(L.eff)}</th>` +
      `<th>Drive cost</th><th>Charge cost</th><th>${esc(L.perDist)}</th><th>Saved</th></tr></thead><tbody>` +
      rows.map((r) => {
        const off = (r.y * 12 + r.mo) - (now.y * 12 + now.mo);
        return `<tr><td class="financial-left"><button type="button" class="financial-monthbtn" data-month="${off}" title="Show this month">${MONTHS[r.mo - 1]} ${r.y}</button></td>` +
          `<td>${esc(fixed(dist(r.miles, units), 1))}</td><td>${r.trips}</td><td>${esc(fixed(r.used, 1))}</td>` +
          `<td>${r.eff === null ? "—" : esc(fixed(eff(r.eff, units), 2))}</td>` +
          `<td>${esc(money(r.tripCost))}</td><td>${esc(money(r.chargeCost))}</td>` +
          `<td>${r.perMile === null ? "—" : esc(money(perDist(r.perMile, units), 3))}</td>` +
          `<td>${savedOk ? esc(money(r.saved)) : icon("lock", { size: 14, label: lockText("saved") })}</td></tr>`;
      }).join("") + `</tbody></table></div>` +
      `<p class="note">Drives in this vehicle only. Efficiency leaves out reconstructed drives; ${esc(L.perDist)} is drive cost ÷ distance (charge cost ÷ odometer distance when a month has no costed drives).</p>`;
  }

  // ── memberships ──
  function drawMembers(win) {
    const box = $(".financial-members");
    const { rows, totalFees } = membershipRows(members, scopeCharges, win, zone);
    let html = `<div class="card-head"><h3 class="card-title">Memberships</h3>` +
      `<button type="button" class="btn financial-madd"${members.length >= MEMBERSHIP_LIMIT ? " disabled" : ""}>${icon("card_membership", { size: 18 })} Add membership</button></div>` +
      `<p class="note">${esc(MEMBERS_INTRO)}</p>`;
    if (fixtures) html += `<p class="note financial-demo">Demo memberships with made-up fees. Changes here are not saved.</p>`;
    if (!rows.length) {
      html += `<p class="empty">${icon("card_membership")}<span>No memberships added.</span></p>`;
    } else {
      html += `<div class="financial-mlist">` + rows.map((r) => {
        const m = r.m;
        const feeText = [m.monthlyFee > 0 ? `${money(m.monthlyFee)}/month` : "", m.annualFee > 0 ? `${money(m.annualFee)}/year` : ""]
          .filter(Boolean).join(" + ") || "No fee";
        const since = `since ${dateFmt(m.startMs, "MMM d, yyyy", zone)}${m.endMs ? `, until ${dateFmt(m.endMs, "MMM d, yyyy", zone)}` : ""}`;
        return `<div class="financial-mrow">` +
          `<div class="financial-mhead"><div><b>${esc(m.name)}</b><span class="note">${esc(r.label)} · ${esc(feeText)} · ${esc(since)}</span></div>` +
          `<div class="financial-mbtns"><button type="button" class="icon-btn" data-medit="${esc(m.id)}" aria-label="Edit ${esc(m.name)}" title="Edit">${icon("edit", { size: 18 })}</button>` +
          `<button type="button" class="icon-btn" data-mdel="${esc(m.id)}" aria-label="Remove ${esc(m.name)}" title="Remove">${icon("close", { size: 18 })}</button></div></div>` +
          `<div class="financial-mfig">` +
          `<span><b>${esc(money(r.fees.total))}</b><small>Fees this period</small></span>` +
          `<span><b>${r.sessions}</b><small>Sessions</small></span>` +
          `<span><b>${esc(fixed(r.kwh, 1))} kWh</b><small>Energy</small></span>` +
          `<span><b>${esc(money(r.cost))}</b><small>Spent on ${esc(r.label)} during it</small></span>` +
          `<span><b>${esc(money(r.withFee))}</b><small>With fee</small></span>` +
          `<span><b>${esc(perKwhText(r.perKwhWithFee))}</b><small>$/kWh with fee</small></span>` +
          `</div></div>`;
      }).join("") + `</div>`;
      html += `<p class="financial-mtotal"><span>Membership fees (entered here)</span><b>${esc(money(totalFees))}</b></p>` +
        `<p class="note">Sessions, energy and spend count only that network's charges during the membership (from its start date to its end date) inside this period. Monthly fees count once a month, on the start date's day; yearly fees count by the days in the period. They are not part of Total paid or any tile.</p>`;
    }
    if (storageNote) html += `<p class="msg warn">${esc(storageNote)}</p>`;
    box.innerHTML = html;
  }

  function openMemberSheet(existing) {
    const netOpts = networkFold(scopeCharges).filter((e) => e.key !== "");
    const known = existing ? netOpts.some((o) => o.key === existing.network) : true;
    const body = document.createElement("form");
    body.className = "financial-mform";
    body.addEventListener("submit", (e) => e.preventDefault());
    const today = ymd(ctx.now(), zone);
    body.innerHTML =
      `<label class="financial-field"><span>Name</span><input name="name" required maxlength="${MEMBERSHIP_NAME_MAX}" placeholder="Electrify America Pass+" value="${esc(existing ? existing.name : "")}"></label>` +
      `<label class="financial-field"><span>Network</span><select name="network">` +
        netOpts.map((o) => `<option value="${esc(o.key)}"${existing && existing.network === o.key ? " selected" : ""}>${esc(o.label)}</option>`).join("") +
        `<option value="__other"${existing && !known ? " selected" : ""}${!netOpts.length ? " selected" : ""}>Other…</option></select></label>` +
      `<label class="financial-field financial-other"><span>Other network</span><input name="other" maxlength="60" value="${esc(existing && !known ? existing.network : "")}"></label>` +
      `<div class="financial-row2">` +
        `<label class="financial-field"><span>Monthly fee ($)</span><input name="monthly" type="number" min="0" step="0.01" inputmode="decimal" value="${existing ? existing.monthlyFee : ""}"></label>` +
        `<label class="financial-field"><span>Yearly fee ($, optional)</span><input name="annual" type="number" min="0" step="0.01" inputmode="decimal" value="${existing && existing.annualFee ? existing.annualFee : ""}"></label>` +
      `</div><div class="financial-row2">` +
        `<label class="financial-field"><span>Start date</span><input name="start" type="date" required max="${today}" value="${esc(dateInputValue(existing && existing.startMs, zone))}"></label>` +
        `<label class="financial-field"><span>End date (optional)</span><input name="end" type="date" value="${esc(dateInputValue(existing && existing.endMs, zone))}"></label>` +
      `</div><p class="msg err financial-merr" hidden></p>` +
      `<button type="button" class="btn ghost financial-mcancel">Cancel</button>`;
    const otherBox = body.querySelector(".financial-other");
    const sel = body.querySelector("select[name=network]");
    const syncOther = () => { otherBox.hidden = sel.value !== "__other"; };
    sel.addEventListener("change", syncOther);
    syncOther();
    const err = body.querySelector(".financial-merr");
    const close = openSheet({
      title: existing ? "Edit membership" : "Add membership",
      bodyEl: body,
      applyText: "Save",
      onApply: () => {
        const fd = new FormData(body);
        const name = String(fd.get("name") || "").trim();
        const network = sel.value === "__other" ? String(fd.get("other") || "").trim() : sel.value;
        const startMs = dateFromInput(String(fd.get("start") || ""), zone);
        const endRaw = String(fd.get("end") || "");
        const endMs = endRaw ? dateFromInput(endRaw, zone, true) : null;
        const monthly = Number(fd.get("monthly") || 0), annual = Number(fd.get("annual") || 0);
        const problem = !name ? "Give the membership a name."
          : startMs === null ? "Pick the start date."
          : !(monthly >= 0) || !(annual >= 0) ? "Fees can't be negative."
          : endMs !== null && endMs < startMs ? "The end date is before the start date." : "";
        if (problem) { err.textContent = problem; err.hidden = false; return false; }
        const next = { id: existing ? existing.id : `m${Date.now().toString(36)}`, name, network: networkKey(network),
          monthlyFee: monthly, annualFee: annual, startMs, endMs };
        const list = existing ? members.map((m) => (m.id === existing.id ? next : m)) : [...members, next];
        members = normMemberships(list);
        saveMembers();
        refresh();
        return true;
      },
    });
    body.querySelector(".financial-mcancel").addEventListener("click", () => close());
  }

  function confirmRemove(m) {
    const body = document.createElement("div");
    body.className = "financial-confirm";
    body.innerHTML = `<p>Remove “${esc(m.name)}” from this browser's list?</p>` +
      `<div class="financial-confirm-btns"><button type="button" class="btn ghost" data-no>Keep</button>` +
      `<button type="button" class="btn danger" data-yes>Remove</button></div>`;
    const close = openDialog({ title: "Remove membership", bodyEl: body });
    body.addEventListener("click", (e) => {
      if (e.target.closest("[data-yes]")) {
        members = members.filter((x) => x.id !== m.id);
        saveMembers();
        close();
        refresh();
      } else if (e.target.closest("[data-no]")) close();
    });
  }

  // ── fuel comparison ──
  function drawFuel(win, periodCharges, periodTrips) {
    const mpg = Number(fuel.mpg) || 0, gas = Number(fuel.gasPrice) || 0;
    const ice = periodSaved({ charges: periodCharges, trips: periodTrips, mpg, gasNow: gas, towCap: account.towCap }).ice;
    const metric = isMetric(units);
    const rows = [
      ["Comparison car", fuel.label ? String(fuel.label) : "Your comparison car"],
      [metric ? "Fuel use" : "MPG", mpg > 0 ? (metric ? `${fixed(L100_FROM_MPG / mpg, 1)} L/100 km` : `${fixed(mpg, 1)} mpg`) : "—"],
      ["Gas price now", gas > 0 ? (metric ? `${money(gas / LITERS_PER_GALLON, 3)}/L` : `${money(gas, 2)}/gal`) : "—"],
    ];
    // The gas side of "Saved": shown with Saved's plan only (next to charge cost it gives Saved away).
    if (savedOk) rows.push(["Gas for this period's driving", money(ice)]);
    const homeRate = Number(account.homeRate) || 0;
    if (homeRate > 0) rows.push(["Home rate", `${money(homeRate, 3)}/kWh (set in the app)`]);
    $(".financial-fuel").innerHTML = `<div class="card-head"><h3 class="card-title">Fuel comparison</h3></div>` +
      `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
      (savedOk ? "" : `<p class="note lock">${icon("lock", { size: 16 })} Gas for this period's driving: ${esc(lockText("saved"))}</p>`) +
      `<p class="note">"Saved" compares your charging with what this car would have paid for gas, using the gas price recorded with each charge. ` +
      `These settings come from the app: <a href="#/garage?tab=charger">Garage → Charger</a>.</p>`;
  }

  function refresh() {
    const now = ctx.now();
    const { win, half } = windowFor(st, now, zone);
    const inWin = (r) => r.date >= win.start && r.date <= win.end;
    const periodCharges = scopeCharges.filter(inWin);
    const periodTrips = ownAny.filter(inWin);
    if (grid) {
      grid.update({ st: { range: st.range, off: st.off, from: st.from, to: st.to }, win, half,
        tileTrips: periodTrips, tileCharges: periodCharges, ownAny, scopeCharges, typesKey: "" });
    }
    drawNetworks(periodCharges);
    drawMembers(win);
    drawFuel(win, periodCharges, periodTrips);
  }

  const onClick = (e) => {
    const link = e.target.closest("a");
    const tr = e.target.closest("tr[data-href]");
    if (tr && !link) { ctx.nav(tr.dataset.href); return; }
    const mb = e.target.closest("[data-month]");
    if (mb) {
      const off = Math.min(0, Math.trunc(Number(mb.dataset.month)) || 0);
      st.range = "month"; st.off = off; st.from = ""; st.to = "";
      rangeHandle.update({ range: "month", off, from: "", to: "" });
      commit(); refresh();
      try { $(".financial-controls").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { /* no scroll */ }
      return;
    }
    if (e.target.closest(".financial-madd")) { if (members.length < MEMBERSHIP_LIMIT) openMemberSheet(null); return; }
    const ed = e.target.closest("[data-medit]");
    if (ed) { const m = members.find((x) => x.id === ed.dataset.medit); if (m) openMemberSheet(m); return; }
    const del = e.target.closest("[data-mdel]");
    if (del) { const m = members.find((x) => x.id === del.dataset.mdel); if (m) confirmRemove(m); }
  };
  el.addEventListener("click", onClick);
  drawMonths();
  refresh();

  return {
    unmount() {
      el.removeEventListener("click", onClick);
      try { board.destroy(); } catch (_) { /* already gone */ }
      try { grid && grid.destroy(); } catch (_) { /* already gone */ }
      try { charts.destroy(); } catch (_) { /* already gone */ }
      try { rangeHandle.destroy(); } catch (_) { /* already gone */ }
    },
  };
}
