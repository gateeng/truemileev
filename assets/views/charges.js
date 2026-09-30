// TrueMile EV web | #/charge: the Charge section. Top to bottom: the period bar with the Filter button
// (network, fast / slow, Home / public, confirmed / unconfirmed, month), the section's tiles with vs avg,
// the all-time charging strip (the page's shared get_stats reply), the map of where you charged, the
// session list (Home rolled into one row, the rest grouped into charging STOPS, or one sortable table),
// and the learned DC curve. Filters narrow the list and the map; the tiles follow the period, as the
// app's Report does. Also exports the session row the Journey page reuses and the learned-curve block
// Garage reuses.

import { esc, store, openSheet } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import * as api from "../lib/api.js";
import { mountRangeBar } from "./rangebar.js";
import { mountTileGrid } from "./tilegrid.js";
import { mountMap } from "./mapview.js";
import { mountBoardCard } from "./financial.js";
import { bandChart } from "../lib/svgchart.js";
import { fixed, money, hm, dateFmt, MONTHS } from "../lib/format.js";
import { dist, labels } from "../lib/units.js";
import { tileWindow, halfCustomWindow, RANGES, steppable } from "../lib/periods.js";
import { inScope, isDc, isHome, vehicleLabel, ownTrips } from "../lib/rows.js";
import { allows, lockText, chargeListWindow, listWindowNote, tierOf } from "../lib/gates.js";
import { groupCharges } from "../lib/stops.js";
import { learnDcCurve, bandOf, BAND_LABELS } from "../lib/curve.js";
import { boundsOf } from "../lib/mapdata.js";
import {
  parseChargeFilter, chargeQuery, activeCount, applyChargeFilter, networkOptions, clusterCharges, spreadPins,
  clusterFeatures, chargeMonths, SPEED_LABELS, KIND_LABELS, SOURCE_LABELS,
} from "../lib/chargefilter.js";
import { dcSessions, homeShare, avgSessionKwh, fees, networkKey } from "../lib/finance.js";

export const BUILD = "2026-09-30.2";

/** sessionStorage: the list's last hash, so a session's back link returns to the same filters. */
export const CHARGE_QUERY_KEY = "tm.chargeQuery";
/** localStorage: "1" shows Home pins on the charge maps (default off: no tiles around home unasked). */
export const CHARGE_MAP_HOME_KEY = "tm.chargemap.home";

const STOP_CHUNK = 40;
const TABLE_CHUNK = 200;
const DAY = 86_400_000;

/** Learned curves, one per vehicle for this page load (at most 16 window fetches each). */
const curveCache = new Map();

export const chargeKind = (c) => (isHome(c) ? "Home" : isDc(c) ? "DC" : "AC");

export function unconfirmedChip() {
  return `<span class="pill charges-unconf" title="Start mileage or arrival charge was never confirmed">UNCONFIRMED</span>`;
}

/** Home pins on the maps? (Settings and the map card's switch share the key.) */
export const homePinsOn = () => store.get(CHARGE_MAP_HOME_KEY, "0") === "1";

/** One session row (ChargeReportRow): MM/dd · network (≤12, "—") ✎ UNCONFIRMED · kWh · $. */
export function sessionRowHtml(c, ctx, { indent = false, vehicleName = "" } = {}) {
  const net = c.network.slice(0, 12).trim() ? c.network.slice(0, 12) : "—";
  return `<a class="charges-row${indent ? " charges-indent" : ""}" href="#/charge/${encodeURIComponent(c.id)}">` +
    `<span class="charges-date">${esc(dateFmt(c.date, "MM/dd", ctx.tz))}</span>` +
    `<span class="charges-net">${esc(net)}${c.edited > 0 ? ` <span class="charges-edit" title="Edited">✎</span>` : ""}` +
    (c.lowConfidence ? ` ${unconfirmedChip()}` : "") +
    (vehicleName ? `<span class="charges-veh">${esc(vehicleName)}</span>` : "") + `</span>` +
    `<span class="charges-kwh">${esc(fixed(c.totalKwh, 1))} kWh</span>` +
    `<span class="charges-cost">${esc(money(c.total))}</span></a>`;
}

/** The "‹ Charge" target of a session page: the list's last hash, else #/charge. */
export function backToChargesHref() {
  try {
    const h = sessionStorage.getItem(CHARGE_QUERY_KEY);
    if (h && (h === "#/charge" || h.startsWith("#/charge?"))) return h;
  } catch (_) { /* storage blocked */ }
  return "#/charge";
}

function rememberListHash() {
  try {
    const h = location.hash || "";
    if (h === "#/charge" || h.startsWith("#/charge?")) sessionStorage.setItem(CHARGE_QUERY_KEY, h);
  } catch (_) { /* storage blocked */ }
}

function vehicleNames(ctx) {
  const all = (ctx.scope && ctx.scope.all) || (ctx.account && ctx.account.vehicles) || [];
  const m = new Map();
  for (const v of all) m.set(v.id, vehicleLabel(v, all, ctx.tz));
  return m;
}

/** The Charge grid's extra tiles (tilegrid extras; x = {agg, trips, charges, units, tier, win}). */
export const CHARGE_EXTRAS = Object.freeze({
  dc_sessions: { label: () => "Fast sessions", blurb: "DC fast-charging sessions", color: "var(--m-charging)",
    value: (x) => String(dcSessions(x.charges)) },
  home_share: { label: () => "Home share", blurb: "Share of the energy charged at home", color: "var(--c-board, var(--m-regen))",
    value: (x) => { const v = homeShare(x.charges); return v === null ? "—" : `${fixed(v, 0)}%`; } },
  avg_session_kwh: { label: () => "Avg session", blurb: "Energy per session (confirmed sessions)", color: "var(--m-charging)",
    value: (x) => { const v = avgSessionKwh(x.charges); return v === null ? "—" : `${fixed(v, 1)} kWh`; } },
  fees: { label: () => "Fees", blurb: "Session fees", color: "var(--m-cost)", value: (x) => money(fees(x.charges)) },
});

function columns(ctx, names) {
  const u = ctx.units, L = labels(u), z = ctx.tz;
  const known = (c) => c.startMileage > 0 && c.endMileage > 0;
  const cols = [
    { key: "date", h: "Date", v: (c) => c.date, c: (c) => dateFmt(c.date, "MM/dd/yy HH:mm", z), left: true },
    { key: "network", h: "Network", v: (c) => c.network || null, c: (c) => c.network || "—", left: true },
    { key: "type", h: "Type", v: (c) => chargeKind(c), c: (c) => chargeKind(c), left: true },
    { key: "delivered", h: "Delivered kWh", v: (c) => c.totalKwh, c: (c) => fixed(c.totalKwh, 2) },
    { key: "received", h: "Received kWh", v: (c) => (c.receivedKwh > 0 ? c.receivedKwh : null), c: (c) => (c.receivedKwh > 0 ? fixed(c.receivedKwh, 2) : "—") },
    { key: "cost", h: "Cost", v: (c) => c.total, c: (c) => money(c.total) },
    { key: "rate", h: "Rate $/kWh", v: (c) => c.ratePerKwh, c: (c) => money(c.ratePerKwh, 3) },
    { key: "duration", h: "Duration", v: (c) => c.timeMin, c: (c) => hm(c.timeMin) },
    { key: "soc", h: "SoC", v: (c) => c.depPct - c.arrPct, c: (c) => `${Math.trunc(c.arrPct)}% → ${Math.trunc(c.depPct)}%` },
    { key: "driven", h: `Driven since (${L.dist})`, v: (c) => (known(c) ? c.endMileage - c.startMileage : null),
      c: (c) => (known(c) ? fixed(dist(c.endMileage - c.startMileage, u), 1) : "—") },
  ];
  if (ctx.scope.id === "all") cols.push({ key: "vehicle", h: "Vehicle", v: (c) => names.get(c.vehicleId) || "", c: (c) => names.get(c.vehicleId) || "", left: true });
  cols.push({ key: "marks", h: "", nosort: true, v: () => null, html: true,
    c: (c) => (c.edited > 0 ? `<span title="Edited">✎</span> ` : "") + (c.lowConfidence ? unconfirmedChip() : ""), left: true });
  return cols;
}

function sortRows(list, col, dir) {
  const w = list.map((c) => ({ c, v: col.v(c) }));
  w.sort((x, y) => {
    const xn = x.v === null || x.v === undefined, yn = y.v === null || y.v === undefined;
    if (xn || yn) return xn && yn ? y.c.date - x.c.date : xn ? 1 : -1;
    const d = typeof x.v === "number" && typeof y.v === "number" ? x.v - y.v : String(x.v).localeCompare(String(y.v), "en-US");
    return (dir === "asc" ? d : -d) || (y.c.date - x.c.date);
  });
  return w.map((e) => e.c);
}

// ── the learned DC curve (also Garage → Insights) ────────────────────────────────────────────

function curveFor(vid, charges) {
  let p = curveCache.get(vid);
  if (!p) {
    const mine = charges.filter((c) => c.vehicleId === vid);
    p = learnDcCurve(mine, (from, to) => api.chargeCurve(vid, from, to));
    curveCache.set(vid, p);
    p.catch(() => curveCache.delete(vid));
  }
  return p;
}

/** The learned curve of a vehicle (null when there is not enough DC data): shared with Garage's insights. */
export function learnedCurve(vehicleId, charges) {
  return curveFor(vehicleId, charges);
}

function curveBodyHtml(ins, band) {
  const buckets = bandOf(ins, band === "all" ? "all" : Number(band)) || ins.buckets;
  const tabs = ["all", 0, 1, 2].filter((b) => b === "all" || bandOf(ins, b));
  const n = ins.sessionsUsed;
  let html = `<p class="note">Median delivered power by battery %, pooled from your last ${n} DC ${n === 1 ? "session" : "sessions"}.</p>`;
  if (tabs.length > 1) {
    html += `<div class="seg charges-bands" role="group" aria-label="Pack temperature">` +
      tabs.map((b) => {
        const on = String(b) === String(band);
        return `<button type="button" data-band="${b}" class="${on ? "on" : ""}" aria-pressed="${on}">${b === "all" ? "All" : BAND_LABELS[b]}</button>`;
      }).join("") + `</div>`;
  }
  const peak = Math.max(...buckets.map((b) => b.medianKw));
  const peakIdx = buckets.findIndex((b) => b.medianKw === peak);
  let holds = null;
  for (let i = peakIdx; i < buckets.length; i++) { if (buckets[i].medianKw >= peak * 0.8) holds = buckets[i].socPct; else break; }
  const halfB = buckets.slice(peakIdx + 1).find((b) => b.medianKw <= peak * 0.5);
  html += `<div class="charges-curve-stats">` +
    `<span><b>Peak ${esc(fixed(peak, 0))} kW</b></span>` +
    (holds !== null ? `<span>Holds 80% of peak to ${holds}%</span>` : "") +
    (halfB ? `<span>Half power at ${halfB.socPct}%</span>` : "") + `</div>`;
  html += bandChart({
    width: 640, height: 260, title: "Your charging curve — DC",
    x: { label: "Battery %", values: buckets.map((b) => b.socPct), decimals: 0 },
    median: buckets.map((b) => b.medianKw), lo: buckets.map((b) => b.minKw), hi: buckets.map((b) => b.maxKw),
    color: "var(--m-charging)", unit: "kW",
  });
  if (band !== "all") html += `<p class="note charges-small">${BAND_LABELS[band]} pack: ${["below 60 °F", "60 to 85 °F", "above 85 °F"][band]}.</p>`;
  return html;
}

/**
 * mountLearnedCurve(el, ctx) → {destroy()}: the learned DC curve of the header vehicle (Max), drawn
 * into [el] (the caller supplies the card and its title). Pack-temperature bands when there are some.
 */
export function mountLearnedCurve(el, ctx) {
  if (!allows(ctx.tier, "chargeCurve")) {
    el.innerHTML = `<p class="note lock">${icon("lock", { size: 16 })} ${esc(lockText("chargeCurve"))}</p>`;
    return { destroy() { el.innerHTML = ""; } };
  }
  if (!ctx.scope || ctx.scope.id === "all") {
    el.innerHTML = `<p class="note">Pick one vehicle to see its charging curve.</p>`;
    return { destroy() { el.innerHTML = ""; } };
  }
  let alive = true, band = "all", ins = null;
  el.innerHTML = `<p class="note">Learning your curve from your recent DC sessions…</p>`;
  const draw = () => {
    if (!ins) {
      el.innerHTML = `<p class="note">Not enough DC charging-curve data yet. The curve builds from the curves your DC sessions record.</p>`;
      return;
    }
    el.innerHTML = curveBodyHtml(ins, band);
  };
  curveFor(ctx.scope.id, ctx.account.charges).then((r) => { if (alive) { ins = r; draw(); } })
    .catch((err) => { if (alive) el.innerHTML = `<p class="msg err">${esc(String((err && err.message) || err))}</p>`; });
  const onClick = (ev) => {
    const b = ev.target.closest("[data-band]");
    if (!b || !ins) return;
    band = b.dataset.band === "all" ? "all" : Number(b.dataset.band);
    draw();
  };
  el.addEventListener("click", onClick);
  return { destroy() { alive = false; el.removeEventListener("click", onClick); el.innerHTML = ""; } };
}

// ── helpers of the section ────────────────────────────────────────────────────────────────────

/** The window the tiles and the list cover; a half-built custom range falls back as the Report does. */
function windowFor(st, now, zone) {
  const w = tileWindow(st.range, now, st.off, st.from, st.to, zone);
  if (w) return { win: w, half: false };
  return { win: halfCustomWindow(st.from, st.to, zone, now) || { start: now - 7 * DAY, end: now }, half: true };
}

/** "Tesla, EVgo · Fast · Public" for the Filter button; "All sessions" when nothing is on. */
function filterSummary(st, opts) {
  const parts = [];
  if (st.net.size) {
    const names = [...st.net].map((k) => (opts.find((o) => o.key === k) || {}).label || (k === "" ? "Unnamed" : k));
    parts.push(names.length > 2 ? `${names.length} networks` : names.join(", "));
  }
  if (st.speed) parts.push(st.speed === "fast" ? "Fast" : "Slow");
  if (st.kind) parts.push(KIND_LABELS[st.kind]);
  if (st.src) parts.push(SOURCE_LABELS[st.src]);
  if (st.at) parts.push("One location");
  return parts.length ? parts.join(" · ") : "All sessions";
}

const upgradeLine = (tier) => (tierOf(tier && typeof tier === "object" ? tier.tier : tier) === "free"
  ? "Available with Pro" : "Available with Max");

// ── the page ──────────────────────────────────────────────────────────────────────────────────

export function mount(el, ctx) {
  const zone = ctx.tz;
  const defaultRange = ctx.defaultRange || undefined;
  const st = parseChargeFilter(ctx.query || {}, defaultRange);
  const names = vehicleNames(ctx);
  const showVeh = ctx.scope.id === "all";
  const scopeCharges = ctx.account.charges.filter((c) => inScope(c, ctx.scope));
  const scopeTrips = ctx.account.trips.filter((t) => inScope(t, ctx.scope));
  const ownAny = ownTrips(scopeTrips);
  const windowIds = new Set(chargeListWindow(ctx.tier, scopeCharges, { nowMs: ctx.now(), zone }).map((c) => c.id));
  const windowCut = windowIds.size < scopeCharges.length;
  const netOpts = networkOptions(scopeCharges);
  let stopsShown = STOP_CHUNK, tableShown = TABLE_CHUNK;
  let homeOn = homePinsOn();
  const detailOk = allows(ctx.tier, "chargeMapDetail");

  el.innerHTML = `<section class="charges-view">` +
    `<div class="charges-controls">` +
      `<div class="charges-range"></div>` +
      `<div class="charges-tools">` +
        `<button type="button" class="filterbtn charges-filterbtn" aria-haspopup="dialog">${icon("filter_list")}` +
          `<span class="fb-text"><span class="fb-k">Filter</span><span class="fb-v charges-fb-value"></span></span>` +
          `<span class="badge count" hidden></span>${icon("expand_more", { size: 18 })}</button>` +
        `<input class="charges-search" type="search" placeholder="Search network, notes or date" aria-label="Search charges" value="${esc(st.q)}">` +
        `<div class="seg charges-viewseg" role="group" aria-label="View"><button type="button" data-view="grouped">Grouped</button>` +
        `<button type="button" data-view="table">Table</button></div>` +
      `</div>` +
      `<div class="charges-chips"></div>` +
    `</div>` +
    `<div class="charges-tiles"></div>` +
    `<div class="charges-board"></div>` +
    `<div class="card charges-mapcard">` +
      `<div class="card-head"><h3 class="card-title">Where you charged</h3>` +
      `<label class="charges-switch"><input type="checkbox" class="charges-homesw"${homeOn ? " checked" : ""}> <span>Show home on the map</span></label></div>` +
      `<div class="charges-map"></div><p class="note charges-mapnote"></p>` +
    `</div>` +
    `<div class="card charges-listcard"><div class="charges-list" aria-live="polite"></div></div>` +
    `<div class="card charges-curve"><div class="card-head"><h3 class="card-title">Your charging curve · DC</h3></div>` +
      `<div class="charges-curve-body"></div></div>` +
    `</section>`;
  const $ = (s) => el.querySelector(s);
  const listEl = $(".charges-list");
  const curve = mountLearnedCurve($(".charges-curve-body"), ctx);
  const board = mountBoardCard($(".charges-board"), ctx, {
    title: "Charging", pick: (m) => m.charging,
  });

  const commit = () => { ctx.setQuery(chargeQuery(st, defaultRange)); rememberListHash(); };

  // ── controls ──
  const rangeHandle = mountRangeBar($(".charges-range"),
    { range: st.range, off: st.off, from: st.from, to: st.to, nowMs: ctx.now(), zone, allowCustom: true, steppable: true },
    (next) => {
      const range = next && RANGES.includes(next.range) ? next.range : st.range;
      st.range = range;
      st.off = steppable(range) ? Math.min(0, Math.trunc(Number(next.off)) || 0) : 0;
      st.from = range === "custom" ? next.from || "" : "";
      st.to = range === "custom" ? next.to || "" : "";
      st.at = "";                           // a map location belongs to the period it was picked in
      stopsShown = STOP_CHUNK; tableShown = TABLE_CHUNK;
      commit(); refresh();
    });

  let grid = null;
  try {
    grid = mountTileGrid($(".charges-tiles"), ctx, {
      section: "charge", extras: CHARGE_EXTRAS, onStep: (d) => rangeHandle.step(d),
      ariaLabel: "Charge tiles. Left and right arrow keys step the period.",
    });
  } catch (e) {
    $(".charges-tiles").innerHTML = `<p class="msg err">${esc(String((e && e.message) || e))}</p>`;
  }

  function syncControls() {
    for (const b of el.querySelectorAll("[data-view]")) {
      const on = b.dataset.view === st.view;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    }
    const n = activeCount(st);
    const cnt = $(".charges-filterbtn .count");
    cnt.hidden = n === 0;
    cnt.textContent = String(n);
    $(".charges-fb-value").textContent = filterSummary(st, netOpts);
    $(".charges-filterbtn").setAttribute("aria-label", `Filter: ${filterSummary(st, netOpts)}`);
    const chips = [];
    for (const k of st.net) {
      const o = netOpts.find((x) => x.key === k);
      chips.push([`net:${k}`, o ? o.label : (k === "" ? "Unnamed" : k)]);
    }
    if (st.speed) chips.push(["speed", SPEED_LABELS[st.speed]]);
    if (st.kind) chips.push(["kind", KIND_LABELS[st.kind]]);
    if (st.src) chips.push(["src", SOURCE_LABELS[st.src]]);
    if (st.at) chips.push(["at", "One map location"]);
    $(".charges-chips").innerHTML = chips.map(([k, label]) =>
      `<button type="button" class="chip on charges-chip" data-clear="${esc(k)}" aria-label="Remove filter ${esc(label)}">` +
      `${esc(label)} ${icon("close", { size: 14 })}</button>`).join("");
  }

  // ── rows ──
  function compute() {
    const now = ctx.now();
    const { win, half } = windowFor(st, now, zone);
    const inWin = (r) => r.date >= win.start && r.date <= win.end;
    const periodRows = scopeCharges.filter(inWin);
    const pre = applyChargeFilter(scopeCharges, { ...st, at: "" }, win, { zone });
    const pins = pre.filter((c) => windowIds.has(c.id));
    const shown = clusterCharges(pins, { includeHome: homeOn });
    let atIds = null;
    if (st.at) {
      const hit = shown.clusters.find((k) => k.id === st.at) ||
        clusterCharges(pins, { includeHome: true }).clusters.find((k) => k.id === st.at);
      atIds = new Set(hit ? hit.sessions.map((c) => c.id) : []);
    }
    const rows = st.at ? pre.filter((c) => atIds.has(c.id)) : pre;
    return { win, half, periodRows, rows, shown, pins, now };
  }

  function refresh() {
    const r = compute();
    if (grid) {
      const tileTrips = ownAny.filter((t) => t.date >= r.win.start && t.date <= r.win.end);
      grid.update({ st: { range: st.range, off: st.off, from: st.from, to: st.to }, win: r.win, half: r.half,
        tileTrips, tileCharges: r.periodRows, ownAny, scopeCharges, typesKey: "" });
    }
    syncControls();
    drawMap(r);
    drawList(r);
  }

  // ── the map ──
  const mapBox = $(".charges-map");
  const mapNote = $(".charges-mapnote");
  let mapP = null, mapH = null, mapDead = false, alive = true, lastMapData = null;
  const mapHeight = () => { try { return window.matchMedia("(max-width: 560px)").matches ? 280 : 360; } catch (_) { return 360; } };
  const byCluster = new Map();

  function popupHtml(k) {
    const n = k.n;
    let html = `<div class="charges-pop"><b class="charges-pop-title">${esc(k.label)}</b>` +
      `<span class="charges-pop-sub">${n} ${n === 1 ? "session" : "sessions"} · ${esc(fixed(k.kwh, 1))} kWh · ${esc(money(k.cost))}</span>`;
    if (!detailOk) {
      return html + `<p class="charges-pop-lock">${icon("lock", { size: 14 })} ${esc(lockText("chargeMapDetail"))}</p></div>`;
    }
    html += `<p class="charges-pop-h">YOUR CHARGES HERE</p><table class="charges-pop-table"><thead><tr><th>Date</th><th>kWh</th><th>Cost</th><th>$/kWh</th></tr></thead><tbody>` +
      k.sessions.slice(0, 5).map((c) => `<tr><td><a href="#/charge/${encodeURIComponent(c.id)}">${esc(dateFmt(c.date, "MM/dd/yy", zone))}</a></td>` +
        `<td>${esc(fixed(c.totalKwh, 1))}</td><td>${esc(money(c.total))}</td>` +
        `<td>${c.totalKwh > 0 ? esc(money(c.total / c.totalKwh, 3)) : "—"}</td></tr>`).join("") +
      `</tbody></table>`;
    if (n > 5) html += `<button type="button" class="charges-pop-more" data-at="${esc(k.id)}">…and ${n - 5} more</button>`;
    else html += `<button type="button" class="charges-pop-more" data-at="${esc(k.id)}">List these sessions</button>`;
    return html + `</div>`;
  }

  function mapData(r) {
    const spread = spreadPins(r.shown.clusters);
    byCluster.clear();
    for (const k of spread) byCluster.set(k.id, k);
    const away = spread.filter((k) => !k.isHome);
    const fitSet = away.length ? away : spread;
    return {
      points: clusterFeatures(spread),
      fit: boundsOf(fitSet.map((k) => [k.lng, k.lat])),
      count: spread.length,
    };
  }

  function drawMap(r) {
    const d = mapData(r);
    lastMapData = d;
    const notes = [];
    if (r.shown.noGps > 0) notes.push(`${r.shown.noGps} ${r.shown.noGps === 1 ? "session has" : "sessions have"} no location.`);
    if (!homeOn && r.pins.some((c) => isHome(c))) notes.push("Home is hidden on the map.");
    mapNote.textContent = notes.join(" ");
    if (mapDead) return;
    if (!d.count) {
      if (mapH) mapH.setData({ points: d.points, fit: null });
      else mapBox.innerHTML = `<p class="note charges-mapempty">No charge locations in this period.</p>`;
      return;
    }
    if (mapH) { mapH.setData({ points: d.points, fit: d.fit }); return; }
    if (mapP) return;                                  // loading: the latest data is applied on arrival
    mapBox.innerHTML = "";
    mapP = mountMap(mapBox, { kind: "charges", height: mapHeight(), ariaLabel: "Map of where you charged", noTiles: ctx.noTiles })
      .then((hd) => {
        if (!hd) { mapDead = true; return; }
        if (!alive) { hd.destroy(); return; }
        mapH = hd;
        hd.onPointClick((props, lngLat) => {
          const k = byCluster.get(String(props.id));
          if (k) hd.popup(lngLat, popupHtml(k));
        });
        hd.setData({ points: lastMapData.points, fit: lastMapData.fit });
      })
      .catch((e) => {
        mapDead = true;
        console.warn("map:", e && e.message);
        mapBox.innerHTML = `<p class="note">The map can't be shown in this browser.</p>`;
      });
  }

  // ── the list ──
  function drawList(r) {
    const total = r.rows.length;
    const rows = r.rows.filter((c) => windowIds.has(c.id));
    const cut = windowCut && rows.length < total;
    const filtering = activeCount(st) > 0 || st.q.trim() !== "";
    const hidden = r.periodRows.length - total;
    let html = `<div class="card-head charges-listhead"><h3 class="card-title">Charge sessions (${total})` +
      (filtering && hidden > 0 ? `<span class="charges-hidden"> · ${hidden} hidden by filters</span>` : "") + `</h3>` +
      (filtering ? `<button type="button" class="btn ghost sm charges-clear" data-clearall="1">Clear filters</button>` : "") + `</div>`;
    if (!rows.length) {
      html += `<p class="empty">${icon("ev_station")}<span>${total || !filtering ? "No charges in this period." : "No charges match these filters."}</span></p>`;
    } else if (st.view === "grouped") {
      const g = groupCharges(rows, isHome);
      let body = "";
      if (g.home) {
        body += `<details class="charges-group charges-home"><summary><span class="charges-home-label">Home&nbsp;&nbsp;·&nbsp;&nbsp;${g.home.count} ${g.home.count === 1 ? "session" : "sessions"}</span>` +
          `<span class="note">${esc(fixed(g.home.kwh, 0))} kWh · ${esc(money(g.home.cost))}</span></summary>` +
          g.home.sessions.map((c) => sessionRowHtml(c, ctx, { vehicleName: showVeh ? names.get(c.vehicleId) : "" })).join("") + `</details>`;
      }
      for (const s of g.stops.slice(0, stopsShown)) {
        if (s.count === 1) {
          body += sessionRowHtml(s.sessions[0], ctx, { vehicleName: showVeh ? names.get(s.sessions[0].vehicleId) : "" });
        } else {
          body += `<details class="charges-group"><summary class="charges-row charges-stop">` +
            `<span class="charges-date">${esc(dateFmt(s.dateMs, "MM/dd", zone))}</span>` +
            `<span class="charges-net">${s.count} sessions</span>` +
            `<span class="charges-kwh">${esc(fixed(s.kwh, 1))} kWh</span>` +
            `<span class="charges-cost">${esc(money(s.cost))}</span></summary>` +
            s.sessions.map((c) => sessionRowHtml(c, ctx, { indent: true, vehicleName: showVeh ? names.get(c.vehicleId) : "" })).join("") +
            `</details>`;
        }
      }
      html += `<div class="charges-panel">${body}</div>`;
      if (g.stops.length > stopsShown) {
        html += `<button type="button" class="btn ghost charges-more" data-more="stops">Show ${Math.min(STOP_CHUNK, g.stops.length - stopsShown)} more…</button>`;
      }
    } else {
      const cols = columns(ctx, names);
      const col = cols.find((c) => c.key === st.sort && !c.nosort) || cols[0];
      const sorted = sortRows(rows, col, st.dir);
      html += `<div class="scroll"><table class="table charges-table"><thead><tr>` +
        cols.map((c) => {
          const cls = c.left ? ` class="charges-left"` : "";
          if (c.nosort) return `<th${cls}>${esc(c.h)}</th>`;
          const active = c.key === col.key;
          return `<th${cls} aria-sort="${active ? (st.dir === "asc" ? "ascending" : "descending") : "none"}">` +
            `<button type="button" class="charges-sort" data-sort="${c.key}">${esc(c.h)}${active ? (st.dir === "asc" ? " ▲" : " ▼") : ""}</button></th>`;
        }).join("") + `</tr></thead><tbody>` +
        sorted.slice(0, tableShown).map((c) => `<tr>` + cols.map((k, i) => {
          const txt = k.html ? k.c(c) : esc(k.c(c));
          return `<td${k.left ? ` class="charges-left"` : ""}>${i === 0 ? `<a href="#/charge/${encodeURIComponent(c.id)}">${txt}</a>` : txt}</td>`;
        }).join("") + `</tr>`).join("") + `</tbody></table></div>`;
      if (sorted.length > tableShown) {
        html += `<button type="button" class="btn ghost charges-more" data-more="table">Show ${Math.min(TABLE_CHUNK, sorted.length - tableShown)} more…</button>`;
      }
    }
    if (cut || (windowCut && !rows.length && total)) {
      const n = cut ? total - rows.length : total;
      html += `<div class="charges-locked"><p class="note">${esc(listWindowNote(ctx.tier, "charges") || "")}` +
        ` · ${n} older ${n === 1 ? "session" : "sessions"} not shown.</p>` +
        `<p class="note lock">${icon("lock", { size: 16 })} ${esc(upgradeLine(ctx.tier))}</p></div>`;
    }
    listEl.innerHTML = html;
  }

  // ── the Filter sheet ──
  function openFilters() {
    const body = document.createElement("form");
    body.className = "charges-sheet";
    body.addEventListener("submit", (e) => e.preventDefault());
    const months = chargeMonths(scopeCharges, ctx.now(), zone);
    const curMonth = st.range === "month" ? st.off : null;
    const radio = (name, value, label, on) =>
      `<label class="charges-opt"><input type="radio" name="${name}" value="${value}"${on ? " checked" : ""}> <span>${esc(label)}</span></label>`;
    const periodCount = (k) => {
      const { win } = windowFor(st, ctx.now(), zone);
      return scopeCharges.filter((c) => c.date >= win.start && c.date <= win.end && networkKey(c.network) === k).length;
    };
    body.innerHTML =
      `<fieldset class="charges-fs"><legend>Month</legend>` +
        `<select name="month" aria-label="Month"><option value="">The period above</option>` +
        months.map((m) => `<option value="${m.off}"${curMonth === m.off ? " selected" : ""}>${MONTHS[m.mo - 1]} ${m.y} (${m.count})</option>`).join("") +
        `</select></fieldset>` +
      `<fieldset class="charges-fs"><legend>Network</legend>` +
        (netOpts.length ? netOpts.map((o) =>
          `<label class="charges-opt"><input type="checkbox" name="net" value="${esc(o.key)}"${st.net.has(o.key) ? " checked" : ""}> ` +
          `<span>${esc(o.label)}</span><span class="charges-optn">${periodCount(o.key)}</span></label>`).join("")
          : `<p class="note">No networks yet.</p>`) +
        `<p class="note charges-small">Network names are the ones you typed in the app. Counts are for the period above.</p></fieldset>` +
      `<fieldset class="charges-fs"><legend>Speed</legend>` +
        radio("speed", "", "All", !st.speed) + radio("speed", "fast", SPEED_LABELS.fast, st.speed === "fast") +
        radio("speed", "slow", SPEED_LABELS.slow, st.speed === "slow") + `</fieldset>` +
      `<fieldset class="charges-fs"><legend>Where</legend>` +
        radio("kind", "", "All", !st.kind) + radio("kind", "home", KIND_LABELS.home, st.kind === "home") +
        radio("kind", "public", KIND_LABELS.public, st.kind === "public") + `</fieldset>` +
      `<fieldset class="charges-fs"><legend>Confirmation</legend>` +
        radio("src", "", "All", !st.src) + radio("src", "confirmed", SOURCE_LABELS.confirmed, st.src === "confirmed") +
        radio("src", "unconfirmed", SOURCE_LABELS.unconfirmed, st.src === "unconfirmed") + `</fieldset>` +
      (st.at ? `<fieldset class="charges-fs"><legend>Map location</legend>` +
        `<label class="charges-opt"><input type="checkbox" name="at" value="${esc(st.at)}" checked> <span>Only the location picked on the map</span></label></fieldset>` : "");
    const read = () => {
      const fd = new FormData(body);
      return {
        net: new Set(fd.getAll("net").map(String)),
        speed: String(fd.get("speed") || ""), kind: String(fd.get("kind") || ""), src: String(fd.get("src") || ""),
        at: fd.get("at") ? String(fd.get("at")) : "",
        month: String(fd.get("month") ?? ""),
      };
    };
    const apply = (v) => {
      st.net = v.net; st.speed = v.speed; st.kind = v.kind; st.src = v.src; st.at = v.at;
      if (v.month !== "" && Number.isFinite(Number(v.month))) {
        const off = Math.min(0, Math.trunc(Number(v.month)));
        if (st.range !== "month" || st.off !== off) {
          st.range = "month"; st.off = off; st.from = ""; st.to = ""; st.at = "";
          rangeHandle.update({ range: "month", off, from: "", to: "" });
        }
      }
      stopsShown = STOP_CHUNK; tableShown = TABLE_CHUNK;
      commit(); refresh();
    };
    openSheet({
      title: "Filter charges",
      bodyEl: body,
      applyText: "Show sessions",
      onApply: () => { apply(read()); },
      onReset: () => {
        for (const i of body.querySelectorAll("input[type=checkbox]")) i.checked = false;
        for (const i of body.querySelectorAll("input[type=radio]")) i.checked = i.value === "";
        const sel = body.querySelector("select[name=month]");
        if (sel) sel.value = "";
      },
    });
  }

  // ── events ──
  let timer = 0;
  const onInput = (ev) => {
    if (!ev.target.classList.contains("charges-search")) return;
    clearTimeout(timer);
    timer = setTimeout(() => { st.q = ev.target.value.slice(0, 120); stopsShown = STOP_CHUNK; tableShown = TABLE_CHUNK; commit(); refresh(); }, 200);
  };
  const onChange = (ev) => {
    if (!ev.target.classList.contains("charges-homesw")) return;
    homeOn = ev.target.checked;
    store.set(CHARGE_MAP_HOME_KEY, homeOn ? "1" : "0");
    refresh();
  };
  const onClick = (ev) => {
    if (ev.target.closest(".charges-filterbtn")) { openFilters(); return; }
    const at = ev.target.closest("[data-at]");
    if (at) {
      st.at = at.dataset.at; stopsShown = STOP_CHUNK; tableShown = TABLE_CHUNK;
      commit(); refresh();
      try { $(".charges-listcard").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { /* no scroll */ }
      return;
    }
    const clr = ev.target.closest("[data-clear]");
    if (clr) {
      const k = clr.dataset.clear;
      if (k.startsWith("net:")) st.net.delete(k.slice(4));
      else if (k === "speed" || k === "kind" || k === "src" || k === "at") st[k] = "";
      stopsShown = STOP_CHUNK; tableShown = TABLE_CHUNK;
      commit(); refresh(); return;
    }
    if (ev.target.closest("[data-clearall]")) {
      st.net = new Set(); st.speed = ""; st.kind = ""; st.src = ""; st.at = ""; st.q = "";
      const s = $(".charges-search"); if (s) s.value = "";
      stopsShown = STOP_CHUNK; tableShown = TABLE_CHUNK;
      commit(); refresh(); return;
    }
    const v = ev.target.closest("[data-view]");
    if (v) { st.view = v.dataset.view === "table" ? "table" : "grouped"; commit(); refresh(); return; }
    const s = ev.target.closest("[data-sort]");
    if (s) {
      const key = s.dataset.sort;
      if (st.sort === key) st.dir = st.dir === "asc" ? "desc" : "asc";
      else {
        st.sort = key;
        const col = columns(ctx, names).find((c) => c.key === key);
        st.dir = col && col.left && key !== "date" ? "asc" : "desc";
      }
      tableShown = TABLE_CHUNK; commit(); drawList(compute()); return;
    }
    const m = ev.target.closest("[data-more]");
    if (m) { if (m.dataset.more === "stops") stopsShown += STOP_CHUNK; else tableShown += TABLE_CHUNK; drawList(compute()); }
  };
  el.addEventListener("input", onInput);
  el.addEventListener("change", onChange);
  el.addEventListener("click", onClick);
  rememberListHash();
  refresh();
  return {
    unmount() {
      alive = false;
      clearTimeout(timer);
      try { curve.destroy(); } catch (_) { /* already gone */ }
      try { board.destroy(); } catch (_) { /* already gone */ }
      try { grid && grid.destroy(); } catch (_) { /* already gone */ }
      try { rangeHandle.destroy(); } catch (_) { /* already gone */ }
      try { mapH && mapH.destroy(); } catch (_) { /* already gone */ }
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      el.removeEventListener("click", onClick);
    },
  };
}
