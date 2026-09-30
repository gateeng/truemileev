// TrueMile EV web | the Map section's trip list (views/map_section.js mounts it under the Trips tab):
// the Report's day-grouped list and a sortable table. Rows = the scope's drives of every car status
// (other / ask drives are listed and marked, never counted), filtered by lib/tripfilter.js (period,
// type, car, short trips, towing, reconstructed, notes, distance, search), then cut to the tier's list
// window. Also exports the row renderers the Journey and Garage pages reuse. Rows open #/map/trip/<id>.

import { esc } from "../lib/dom.js";
import { fixed, money, tripDuration, dateFmt } from "../lib/format.js";
import { dist, speed, eff, temp, perDist, labels } from "../lib/units.js";
import { parts, startOfDay } from "../lib/tz.js";
import { customWindow, halfCustomWindow, periodWindow } from "../lib/periods.js";
import { inScope, classLabel, classColor, tripEff, isShort, carCell, vehicleLabel } from "../lib/rows.js";
import { allows, lockText, tripListWindow, listWindowNote } from "../lib/gates.js";
import { startEpochOf } from "../lib/tripdetail.js";
import { applyTripFilter, SORT_KEYS } from "../lib/tripfilter.js";
import { icon } from "../lib/icons.js";

export const BUILD = "2026-09-30.2";

/** sessionStorage key of the Map section's last hash (the detail pages' back link). */
export const TRIPS_QUERY_KEY = "tm.tripsQuery";
const DAYS_CHUNK = 60;
const TABLE_CHUNK = 200;

/** A drive's detail route. */
export const tripHref = (id) => `#/map/trip/${encodeURIComponent(id)}`;

// ── shared helpers (also used by journey.js) ──────────────────────────────────────────────────

export function distText(mi, units, n = 1) {
  return `${fixed(dist(mi, units), n)} ${labels(units).dist}`;
}

export function vehicleNames(ctx) {
  const all = (ctx.scope && ctx.scope.all) || (ctx.account && ctx.account.vehicles) || [];
  const m = new Map();
  for (const v of all) m.set(v.id, vehicleLabel(v, all, ctx.tz));
  return m;
}

/** The local day key and label of a drive's END ("Sat, Sep 26"; ", yyyy" outside the current year). */
export function dayLabel(ms, nowMs, zone) {
  const y = parts(ms, zone).y;
  return dateFmt(ms, "EEE, MMM d", zone) + (y !== parts(nowMs, zone).y ? `, ${y}` : "");
}

export function pill(text, cls = "", style = "") {
  return `<span class="pill ${cls}"${style ? ` style="${esc(style)}"` : ""}>${esc(text)}</span>`;
}

/** Pills in the app's order: note, FROM ODOMETER, OTHER CAR / WHICH CAR?, the trip type. */
export function tripPills(t, hasNote) {
  let s = "";
  if (hasNote) s += pill("🗒 note", "grey");
  if (t.isReconciled) s += pill("FROM ODOMETER", "grey");
  if (t.carStatus === "other") s += pill("OTHER CAR", "grey");
  else if (t.carStatus === "ask") s += pill("WHICH CAR?", "trips-pill-amber");
  if (t.classification) {
    const c = classColor(t.classification);
    const lbl = classLabel(t.classification).toUpperCase() + (t.autoAssigned ? " ·auto" : "");
    s += pill(lbl, "trips-pill-type" + (t.autoAssigned ? " trips-pill-auto" : ""),
      `color:${c};background:color-mix(in srgb, ${c} 16%, transparent)`);
  }
  return s;
}

export function hasNotes(ctx, t) {
  const m = ctx.account && ctx.account.notesByTrip;
  if (!m || !t.clientTripId) return false;
  const l = m.get(t.clientTripId);
  return !!(l && l.length);
}

/** One Days-view row. [link] false renders a plain block (the entry tier cannot open details). */
export function tripRowHtml(t, ctx, { link = true, costOk = true, vehicleName = "" } = {}) {
  const u = ctx.units, L = labels(u);
  const e = tripEff(t);
  const cells = [
    [distText(t.miles, u), "DIST", "var(--m-distance)"],
    [t.isReconciled ? "—" : tripDuration(t.durationSec), "TIME", "var(--m-distance)"],
    [`${fixed(t.usedKwh, 1)} kWh`, "ENERGY", "var(--m-power)"],
    [costOk ? money(t.cost) : "🔒", "COST", "var(--m-cost)"],
    [e === null ? "—" : fixed(eff(e, u), 2), L.eff.toUpperCase(), "var(--m-efficiency)"],
  ];
  const body =
    `<div class="trips-cells">${cells.map(([v, k, c]) =>
      `<div class="trips-cell"><b style="color:${c}">${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>` +
    `<div class="trips-pills">${tripPills(t, hasNotes(ctx, t))}` +
    (vehicleName ? `<span class="trips-veh">${esc(vehicleName)}</span>` : "") + `</div>`;
  const cls = "trips-row" + (isShort(t) ? " trips-short" : "");
  return link
    ? `<a class="${cls}" href="${tripHref(t.id)}">${body}</a>`
    : `<div class="${cls}">${body}</div>`;
}

/** Day groups, newest first; [trips] any order. -> [{key, label, trips (newest first)}] */
export function groupByDay(trips, nowMs, zone) {
  const sorted = [...trips].sort((a, b) => (b.date - a.date) || (String(a.id) < String(b.id) ? 1 : -1));
  const groups = [];
  const byKey = new Map();
  for (const t of sorted) {
    const key = startOfDay(t.date, zone);
    let g = byKey.get(key);
    if (!g) { g = { key, label: dayLabel(t.date, nowMs, zone), trips: [] }; byKey.set(key, g); groups.push(g); }
    g.trips.push(t);
  }
  return groups;
}

/** RS:1819-1850: "{n} trip|trips · {dist} · {Σused} kWh · ${Σcost}". */
export function daySummaryHtml(trips, units) {
  const mi = trips.reduce((s, t) => s + t.miles, 0);
  const kwh = trips.reduce((s, t) => s + t.usedKwh, 0);
  const cost = trips.reduce((s, t) => s + t.cost, 0);
  const n = trips.length;
  return `${n} ${n === 1 ? "trip" : "trips"} · <b style="color:var(--m-distance)">${esc(distText(mi, units))}</b>` +
    ` · <b style="color:var(--m-power)">${esc(fixed(kwh, 1))} kWh</b> · <b style="color:var(--m-cost)">${esc(money(cost))}</b>`;
}

export function dayGroupsHtml(groups, ctx, { link, costOk, names, openFirst = 14 }) {
  const showVeh = ctx.scope && ctx.scope.id === "all";
  return groups.map((g, i) =>
    `<details class="trips-day"${i < openFirst ? " open" : ""}>` +
    `<summary><span class="trips-day-label">${esc(g.label)}</span>` +
    `<span class="trips-day-sum">${daySummaryHtml(g.trips, ctx.units)}</span></summary>` +
    g.trips.map((t) => tripRowHtml(t, ctx, { link, costOk, vehicleName: showVeh ? names.get(t.vehicleId) || "" : "" })).join("") +
    `</details>`).join("");
}

// ── the list ──────────────────────────────────────────────────────────────────────────────────

/**
 * The date window of a range state; null = no date filter (All time, or Custom with no date picked).
 * A half-built custom range covers what the Dashboard's does (the picked start to now, or the last
 * seven days to the picked end) while the range button reads "Pick dates".
 */
export function windowOf(st, nowMs, zone) {
  if (st.range === "all") return null;
  if (st.range === "custom") return customWindow(st.from, st.to, zone, nowMs) || halfCustomWindow(st.from, st.to, zone, nowMs);
  return periodWindow(st.range, nowMs, st.off, zone);
}

/** The table's columns: key, header, sort value, cell text, numeric. */
function columns(ctx, names, costOk) {
  const u = ctx.units, L = labels(u), z = ctx.tz;
  const all = ctx.scope.id === "all";
  const cols = [
    { key: "date", h: "Date", v: (t) => t.date, c: (t) => dateFmt(t.date, "MM/dd/yy HH:mm", z), left: true },
    { key: "start", h: "Start", v: (t) => startEpochOf(t), c: (t) => dateFmt(startEpochOf(t), "h:mm a", z), left: true },
    { key: "dist", h: `Distance (${L.dist})`, v: (t) => t.miles, c: (t) => fixed(dist(t.miles, u), 1) },
    { key: "elapsed", h: "Elapsed", v: (t) => (t.isReconciled ? null : t.durationSec), c: (t) => (t.isReconciled ? "—" : tripDuration(t.durationSec)) },
    { key: "used", h: "Used kWh", v: (t) => t.usedKwh, c: (t) => fixed(t.usedKwh, 1) },
    { key: "regen", h: "Regen kWh", v: (t) => t.regenKwh, c: (t) => fixed(t.regenKwh, 2) },
    { key: "eff", h: L.eff, v: (t) => tripEff(t), c: (t) => { const e = tripEff(t); return e === null ? "—" : fixed(eff(e, u), 2); } },
    { key: "cost", h: "Cost", locked: !costOk, v: (t) => t.cost, c: (t) => (costOk ? money(t.cost) : "🔒") },
    { key: "dpm", h: L.perDist, locked: !costOk, v: (t) => (t.miles > 0 ? t.cost / t.miles : null),
      c: (t) => (!costOk ? "🔒" : t.miles > 0 ? money(perDist(t.cost / t.miles, u), 3) : "—") },
    { key: "speed", h: `Avg speed (${L.speed})`, v: (t) => (t.isReconciled ? null : t.avgSpeedMph),
      c: (t) => (t.isReconciled ? "—" : fixed(speed(t.avgSpeedMph, u), 0)) },
    { key: "soc", h: "SoC", v: (t) => (t.startSocPct > 0 && t.endSocPct > 0 ? t.endSocPct - t.startSocPct : null),
      c: (t) => (t.startSocPct > 0 && t.endSocPct > 0 ? `${fixed(t.startSocPct, 0)}% → ${fixed(t.endSocPct, 0)}%` : "—") },
    { key: "temp", h: `Outside (${L.temp})`, v: (t) => t.outsideF, c: (t) => fixed(temp(t.outsideF, u), 0) },
    { key: "type", h: "Type", v: (t) => (t.classification ? classLabel(t.classification) : null),
      c: (t) => (t.classification ? classLabel(t.classification) : "—"), left: true },
    { key: "journey", h: "Journey", v: (t) => t.journeyName || null, c: (t) => t.journeyName || "", left: true },
    { key: "car", h: "Car", v: (t) => carText(t) || null, c: (t) => carText(t), left: true },
  ];
  function carText(t) {
    if (t.carStatus !== "") return carCell(t, "");
    return all ? names.get(t.vehicleId) || "" : "";
  }
  if (all) cols.push({ key: "vehicle", h: "Vehicle", v: (t) => names.get(t.vehicleId) || "", c: (t) => names.get(t.vehicleId) || "", left: true });
  return cols;
}

function cmp(a, b) {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en-US");
}

export function sortRows(rowsIn, col, dir) {
  const withV = rowsIn.map((t) => ({ t, v: col.v(t) }));
  withV.sort((x, y) => {
    const xn = x.v === null || x.v === undefined, yn = y.v === null || y.v === undefined;
    if (xn || yn) return xn && yn ? y.t.date - x.t.date : xn ? 1 : -1;     // missing values last
    const c = cmp(x.v, y.v);
    return (dir === "asc" ? c : -c) || (y.t.date - x.t.date);
  });
  return withV.map((w) => w.t);
}

/** True when [hash] is the Map section itself ("#/map" or "#/map?…"), not one of its detail pages. */
export function isMapListHash(hash) {
  return typeof hash === "string" && /^#\/map(\?|$)/.test(hash);
}

/** Remembers the Map section's current hash for the detail pages' back links. */
export function saveTripsBackLink(hash = location.hash) {
  try {
    if (isMapListHash(hash)) sessionStorage.setItem(TRIPS_QUERY_KEY, hash);
  } catch (_) { /* storage blocked: the back link falls back to #/map */ }
}

/** The "‹ Trips" target: the Map section's last hash (only a #/map one), else #/map. */
export function backToTripsHref() {
  try {
    const h = sessionStorage.getItem(TRIPS_QUERY_KEY);
    if (isMapListHash(h)) return h;
  } catch (_) { /* storage blocked */ }
  return "#/map";
}

/** The journey page's back link: the Map section's last hash when it was on Journeys, else the tab. */
export function backToJourneysHref() {
  const h = backToTripsHref();
  return /[?&]tab=journeys(&|$)/.test(h) ? h : "#/map?tab=journeys";
}

/**
 * mountTripList(el, ctx, {win, filter, onChange}) → {update({win, filter}), destroy(), unmount()}.
 * [filter] = lib/tripfilter.js state; [win] = the list's date window (null = every date). The list's
 * own controls (search, Days / Table, the short-trip toggle, the table's sort) change [filter] in place
 * and report the changed keys through onChange(partial); the owner writes the query. Without onChange
 * the list writes its keys with ctx.setQuery itself.
 */
export function mountTripList(el, ctx, { win = null, filter, onChange } = {}) {
  const zone = ctx.tz;
  const tier = ctx.tier;
  const detailOk = allows(tier, "tripDetail");
  const costOk = allows(tier, "costAnalytics");
  const typesOk = allows(tier, "tripTypes");
  const names = vehicleNames(ctx);
  const scopeTrips = ctx.account.trips.filter((t) => inScope(t, ctx.scope));
  // The tier's list window is anchored on the scope's whole history (the entry tier's 50 newest are the
  // globally newest, not the newest of a filtered view).
  const windowIds = new Set(tripListWindow(tier, scopeTrips, { basis: scopeTrips, nowMs: ctx.now(), zone }).map((t) => t.id));
  const windowCut = windowIds.size < scopeTrips.length;
  const st = { ...(filter || {}) };
  if (!SORT_KEYS.includes(st.sort)) st.sort = "date";
  let listWin = win;
  let daysShown = DAYS_CHUNK, tableShown = TABLE_CHUNK;

  el.innerHTML =
    `<div class="trips-view">` +
    (detailOk ? "" : `<p class="note trips-lock">${icon("lock", { size: 16 })} Trip details: ${esc(lockText("tripDetail"))}</p>`) +
    `<div class="trips-toggles">` +
    `<label class="trips-searchbox">${icon("search", { size: 18 })}` +
    `<input class="trips-search" type="search" placeholder="Search day, type, journey, car, notes" aria-label="Search trips" value="${esc(st.q || "")}"></label>` +
    `<div class="seg trips-seg" role="group" aria-label="View">` +
    `<button type="button" data-view="days">Days</button><button type="button" data-view="table">Table</button></div>` +
    `<button type="button" class="btn ghost trips-short-btn"></button></div>` +
    `<div class="trips-list" aria-live="polite"></div>` +
    `</div>`;

  const $ = (s) => el.querySelector(s);
  const listEl = $(".trips-list");

  const report = (partial) => {
    if (typeof onChange === "function") { onChange(partial); return; }
    const q = {};
    for (const [k, v] of Object.entries(partial)) {
      q[k] = k === "short" ? (v ? "1" : "") : k === "view" ? (v === "table" ? "table" : "")
        : k === "sort" ? (v === "date" ? "" : v) : k === "dir" ? (v === "asc" ? "asc" : "") : v;
    }
    ctx.setQuery(q);
  };

  function syncSegs() {
    for (const b of el.querySelectorAll("[data-view]")) {
      const on = b.dataset.view === (st.view === "table" ? "table" : "days");
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function render() {
    const { rows, listedCount, shortCount, cut } = applyTripFilter(scopeTrips, st, {
      win: listWin, nowMs: ctx.now(), zone, notesByTrip: ctx.account.notesByTrip, typesAllowed: typesOk, windowIds,
    });
    const sb = $(".trips-short-btn");
    sb.textContent = st.short ? "Hide short trips" : `Show short trips (${shortCount})`;
    sb.hidden = shortCount === 0 && !st.short;
    const note = cut || (windowCut && !rows.length) ? listWindowNote(tier, "trips") : null;
    let html = `<div class="trips-head">Trips (${listedCount})</div>`;
    if (!rows.length) {
      html += `<p class="empty trips-empty">${listedCount > 0 && shortCount === listedCount && !st.short ? "Only short trips in this period."
        : listedCount > 0 ? "These trips are older than your plan lists."
          : "No trips in this period match these filters."}</p>`;
    } else if (st.view !== "table") {
      const groups = groupByDay(rows, ctx.now(), zone);
      html += dayGroupsHtml(groups.slice(0, daysShown), ctx, { link: detailOk, costOk, names });
      if (groups.length > daysShown) {
        html += `<button type="button" class="btn trips-more" data-more="days">Show ${Math.min(DAYS_CHUNK, groups.length - daysShown)} more days</button>`;
      }
    } else {
      const cols = columns(ctx, names, costOk);
      const col = cols.find((c) => c.key === st.sort && !c.locked) || cols[0];
      const sorted = sortRows(rows, col, col.key === st.sort ? st.dir : "desc");
      const shown = sorted.slice(0, tableShown);
      html += `<div class="scroll"><table class="table trips-table"><thead><tr>` +
        cols.map((c) => {
          const active = c.key === col.key;
          const arrow = active ? (st.dir === "asc" ? " ▲" : " ▼") : "";
          const cls = c.left ? ` class="trips-left"` : "";
          return c.locked
            ? `<th${cls}>${esc(c.h)}</th>`
            : `<th${cls} aria-sort="${active ? (st.dir === "asc" ? "ascending" : "descending") : "none"}">` +
              `<button type="button" class="trips-sort" data-sort="${c.key}">${esc(c.h)}${arrow}</button></th>`;
        }).join("") + `</tr></thead><tbody>` +
        shown.map((t) => `<tr class="${isShort(t) ? "trips-short" : ""}">` + cols.map((c, i) => {
          const txt = esc(c.c(t));
          const cell = i === 0 && detailOk ? `<a href="${tripHref(t.id)}">${txt}</a>` : txt;
          return `<td${c.left ? ` class="trips-left"` : ""}>${cell}</td>`;
        }).join("") + `</tr>`).join("") +
        `</tbody></table></div>`;
      if (sorted.length > tableShown) {
        html += `<button type="button" class="btn trips-more" data-more="table">Show ${Math.min(TABLE_CHUNK, sorted.length - tableShown)} more</button>`;
      }
    }
    if (note) html += `<p class="note">${esc(note)}</p>`;
    listEl.innerHTML = html;
  }

  // ── events ──
  let searchTimer = 0;
  const onInput = (ev) => {
    if (!ev.target.classList.contains("trips-search")) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      st.q = ev.target.value;
      daysShown = DAYS_CHUNK; tableShown = TABLE_CHUNK;
      report({ q: st.q });
      render();
    }, 200);
  };
  const onClick = (ev) => {
    const v = ev.target.closest("[data-view]");
    if (v && el.contains(v)) {
      st.view = v.dataset.view === "table" ? "table" : "days";
      report({ view: st.view }); syncSegs(); render(); return;
    }
    if (ev.target.closest(".trips-short-btn")) {
      st.short = !st.short;
      report({ short: st.short }); render(); return;
    }
    const s = ev.target.closest("[data-sort]");
    if (s) {
      const k = s.dataset.sort;
      if (st.sort === k) st.dir = st.dir === "asc" ? "desc" : "asc";
      else {
        st.sort = k;
        const col = columns(ctx, names, costOk).find((c) => c.key === k);
        st.dir = col && col.left && k !== "date" && k !== "start" ? "asc" : "desc";
      }
      tableShown = TABLE_CHUNK;
      report({ sort: st.sort, dir: st.dir }); render(); return;
    }
    const m = ev.target.closest("[data-more]");
    if (m) {
      if (m.dataset.more === "days") daysShown += DAYS_CHUNK; else tableShown += TABLE_CHUNK;
      render();
    }
  };
  el.addEventListener("input", onInput);
  el.addEventListener("click", onClick);

  syncSegs();
  render();
  const destroy = () => {
    clearTimeout(searchTimer);
    el.removeEventListener("input", onInput);
    el.removeEventListener("click", onClick);
  };
  return {
    update({ win: w, filter: f } = {}) {
      if (w !== undefined) listWin = w;
      if (f) {
        Object.assign(st, f);
        if (!SORT_KEYS.includes(st.sort)) st.sort = "date";
        const box = $(".trips-search");
        if (box && document.activeElement !== box && box.value !== (st.q || "")) box.value = st.q || "";
      }
      daysShown = DAYS_CHUNK; tableShown = TABLE_CHUNK;
      syncSegs();
      render();
    },
    destroy,
    unmount: destroy,
  };
}
