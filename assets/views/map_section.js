// TrueMile EV web | #/map — the Map section (the default landing page): the app's Report tiles for
// drives (distance, time, trips, journeys, cost, efficiency …) over a period, the drives' routes on a map,
// trend charts, and the Trips / Journeys lists. Every figure is computed in the browser from the cloud
// rows with the Report's own rules (lib/metrics.js through views/tilegrid.js).
//
// Tiles follow the period and the trip types, own drives only (other cars and unanswered drives show in
// the lines under the grid, as in the app). The Filter sheet's other choices (car, short trips, towing,
// reconstructed, notes, distance) change the LIST only. The routes map draws only on a click and only
// the newest 50 listed trips, 10 routes per request.

import * as api from "../lib/api.js";
import { esc, openSheet } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { DEFAULT_RANGE } from "../lib/periods.js";
import {
  inScope, ownTrips, typeOptions, typeFilter, listFor, carCounts, tilesCaption, otherLines, askLine, vehicleLabel, tripEff,
} from "../lib/rows.js";
import { allows, lockText, tripListWindow } from "../lib/gates.js";
import {
  parseTripFilter, filterQuery, activeCount, clearSheet, applyTripFilter, sectionWindow, formatTypeSet,
  distanceFromInput, distanceToInput,
} from "../lib/tripfilter.js";
import { journeyCount } from "../lib/journeys.js";
import { periodRouteFeatures, boundsOf, coordsOf } from "../lib/mapdata.js";
import { parsePolyline, decimate } from "../lib/route.js";
import { fixed, money, dateFmt } from "../lib/format.js";
import { eff, labels } from "../lib/units.js";
import { mountRangeBar } from "./rangebar.js";
import { mountTileGrid } from "./tilegrid.js";
import { mountCharts } from "./charts.js";
import { mountTripList, saveTripsBackLink, distText, tripHref } from "./trips.js";
import { mountJourneyList } from "./journeys.js";
import { mountMap } from "./mapview.js";

export const BUILD = "2026-09-27.3";

/** The newest listed trips the routes map draws, and how many route polylines one request asks for. */
export const ROUTES_MAX = 50;
const ROUTES_BATCH = 10;

/** The Map section's own tile: journeys with at least one own drive in the period (Max). */
export const MAP_EXTRAS = Object.freeze({
  journeys: Object.freeze({
    label: () => "Journeys",
    blurb: "Journeys with a drive in this period",
    color: "var(--m-distance)",
    value: (x) => String(journeyCount(x.trips)),
    gate: "journeys",
  }),
});

export function mount(el, ctx) {
  const zone = ctx.tz;
  const units = ctx.units;
  const L = labels(units);
  const tier = ctx.tier || ctx.account.tier;
  const typesOk = allows(tier, "tripTypes");
  const detailOk = allows(tier, "tripDetail");
  const costOk = allows(tier, "costAnalytics");
  const defaultRange = ctx.defaultRange || DEFAULT_RANGE;
  const fopts = { defaultRange };

  const scopeTrips = ctx.account.trips.filter((t) => inScope(t, ctx.scope));
  const scopeCharges = ctx.account.charges.filter((c) => inScope(c, ctx.scope));
  const ownAny = ownTrips(scopeTrips);
  const options = typeOptions(scopeTrips);
  const askTotal = scopeTrips.filter((t) => t.carStatus === "ask").length;
  const hasOther = scopeTrips.some((t) => t.carStatus === "other");
  const carShown = hasOther || askTotal > 0;
  const single = ctx.scope.id !== "all";
  const vehicle = single ? (ctx.scope.all || ctx.account.vehicles || []).find((v) => v.id === ctx.scope.id) : null;
  const vName = vehicle ? vehicleLabel(vehicle, ctx.scope.all || ctx.account.vehicles || [], zone) : "";
  const windowIds = new Set(tripListWindow(tier, scopeTrips, { basis: scopeTrips, nowMs: ctx.now(), zone }).map((t) => t.id));

  const q = ctx.query || {};
  const st = parseTripFilter(q, units, fopts);
  if (!typesOk) st.types = new Set();
  if (!carShown) st.car = "all";
  let tab = q.tab === "journeys" ? "journeys" : "trips";

  // Child views write their own keys (the list's search, the charts' bucket …); every write also
  // refreshes the detail pages' back link.
  const childCtx = { ...ctx, setQuery: (p) => { ctx.setQuery(p); saveTripsBackLink(); } };

  el.innerHTML =
    `<div class="map-section">` +
    `<div class="map-controls">` +
    `<div class="map-range"></div>` +
    `<button type="button" class="filterbtn map-filterbtn" aria-haspopup="dialog">` +
    `${icon("filter_list", { size: 20 })}<span class="fb-text"><span class="fb-k">Filter</span>` +
    `<span class="fb-v map-fb-value"></span></span><span class="badge count map-fb-count" hidden></span>` +
    `${icon("expand_more", { size: 18 })}</button>` +
    `</div>` +
    `<div class="map-tiles"></div>` +
    `<p class="note map-scope"></p>` +
    `<div class="map-carlines"></div>` +
    `<section class="card collapsible map-routes">` +
    `<div class="card-head map-routes-head" role="button" tabindex="0" aria-expanded="false">` +
    `<h2 class="card-title">Routes in this period</h2>` +
    `<span class="map-routes-sum"></span><span class="card-chev">${icon("expand_more", { size: 22 })}</span></div>` +
    `<div class="card-body map-routes-body">` +
    `<p class="note map-routes-intro"></p>` +
    `<div class="map-routes-actions"><button type="button" class="btn map-routes-btn">${icon("route", { size: 18 })}<span>Show routes</span></button></div>` +
    `<div class="map-routes-map"></div>` +
    `<p class="note map-routes-note" aria-live="polite"></p>` +
    `</div></section>` +
    `<div class="map-charts"></div>` +
    `<div class="subtabs map-tabs" role="tablist" aria-label="Lists">` +
    `<button type="button" role="tab" data-tab="trips">${icon("route", { size: 18 })}<span>Trips</span></button>` +
    `<button type="button" role="tab" data-tab="journeys">${icon("map", { size: 18 })}<span>Journeys</span>` +
    (allows(tier, "journeys") ? "" : icon("lock", { size: 14, cls: "map-tab-lock" })) + `</button>` +
    `</div>` +
    `<div class="map-tabbody" role="tabpanel"></div>` +
    `</div>`;

  const $ = (s) => el.querySelector(s);
  let alive = true;
  let tabH = null;
  let chartsH = null;
  let closeSheet = null;
  let listed = { rows: [], listedCount: 0, shortCount: 0, cut: false };
  let cur = sectionWindow(st, ctx.now(), zone);

  function commit() {
    ctx.setQuery({ ...filterQuery(st, fopts), tab: tab === "journeys" ? "journeys" : "" });
    saveTripsBackLink();
  }

  // ── controls ──
  const range = mountRangeBar($(".map-range"),
    { range: st.range, off: st.off, from: st.from, to: st.to, nowMs: ctx.now(), zone },
    (next) => {
      st.range = next.range; st.off = next.off || 0; st.from = next.from || ""; st.to = next.to || "";
      commit(); draw();
    });
  const grid = mountTileGrid($(".map-tiles"), ctx, {
    section: "map", extras: MAP_EXTRAS, onStep: (d) => range.step(d),
    ariaLabel: "Map tiles. Left and right arrow keys step the period.",
  });

  function badge() {
    const n = activeCount(st);
    const c = $(".map-fb-count");
    c.hidden = n === 0;
    c.textContent = String(n);
    $(".map-fb-value").textContent = n === 0 ? "All drives" : n === 1 ? "1 filter on" : `${n} filters on`;
    $(".map-filterbtn").setAttribute("aria-label", n === 0 ? "Filter trips" : `Filter trips, ${n} on`);
  }

  // ── the period: tiles, lines, routes summary, list ──
  function draw() {
    const now = ctx.now();
    cur = sectionWindow(st, now, zone);
    const { win, half, listWin } = cur;
    const inWin = (r) => r.date >= win.start && r.date <= win.end;
    const winTrips = scopeTrips.filter(inWin);
    const typed = typeFilter(winTrips, st.types);
    grid.update({
      st: { range: st.range, off: st.off, from: st.from, to: st.to, types: st.types },
      win, half,
      tileTrips: ownTrips(typed),
      tileCharges: scopeCharges.filter(inWin),
      ownAny, scopeCharges,
      typesKey: formatTypeSet(st.types),
    });
    const counts = carCounts(typed);
    $(".map-scope").textContent = single
      ? tilesCaption(vName, counts.ask)
      : `${(ctx.scope.vehicles || []).length} vehicles combined · rates recalculated across them`;
    const carListed = typeFilter(listFor(winTrips, scopeTrips, st.car), st.types);
    const lines = st.car === "other" ? otherLines(counts, units)
      : st.car === "ask" ? [askLine(carListed, units)].filter((x) => x) : [];
    $(".map-carlines").innerHTML = lines.map((l, i) => `<p class="${i === 0 ? "map-carhead" : "note"}">${esc(l)}</p>`).join("");

    listed = applyTripFilter(scopeTrips, st, {
      win: listWin, nowMs: now, zone, notesByTrip: ctx.account.notesByTrip, typesAllowed: typesOk, windowIds,
    });
    badge();
    drawRoutesSummary();
    if (tab === "trips" && tabH && tabH.update) tabH.update({ win: listWin, filter: st });
    if (routesOn) scheduleRoutes();
  }

  // ── tabs ──
  function syncTabs() {
    for (const b of el.querySelectorAll(".map-tabs [data-tab]")) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    }
  }
  function mountTab() {
    if (tabH) { try { (tabH.destroy || tabH.unmount || (() => {}))(); } catch (_) { /* gone */ } }
    tabH = null;
    const body = $(".map-tabbody");
    body.innerHTML = "";
    const host = document.createElement("div");
    body.appendChild(host);
    if (tab === "journeys") tabH = mountJourneyList(host, childCtx);
    else {
      tabH = mountTripList(host, childCtx, {
        win: cur.listWin, filter: st,
        onChange: (partial) => {
          Object.assign(st, partial);
          commit();
          listed = applyTripFilter(scopeTrips, st, {
            win: cur.listWin, nowMs: ctx.now(), zone, notesByTrip: ctx.account.notesByTrip, typesAllowed: typesOk, windowIds,
          });
          badge();
          drawRoutesSummary();
          if (routesOn) scheduleRoutes();
        },
      });
    }
    syncTabs();
  }
  const onTabs = (ev) => {
    const b = ev.target.closest(".map-tabs [data-tab]");
    if (!b) return;
    const next = b.dataset.tab === "journeys" ? "journeys" : "trips";
    if (next === tab) return;
    tab = next;
    commit();
    mountTab();
  };
  const onTabKey = (ev) => {
    if (!ev.target.closest(".map-tabs") || (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight")) return;
    tab = tab === "trips" ? "journeys" : "trips";
    commit();
    mountTab();
    el.querySelector(`.map-tabs [data-tab="${tab}"]`)?.focus();
    ev.preventDefault();
  };
  $(".map-tabs").addEventListener("click", onTabs);
  $(".map-tabs").addEventListener("keydown", onTabKey);

  // ── the Filter sheet ──
  function sheetHtml(d, shortCount) {
    const chk = (name, on, text, disabled = false) =>
      `<label class="map-check"><input type="checkbox" name="${name}"${on ? " checked" : ""}${disabled ? " disabled" : ""}> <span>${esc(text)}</span></label>`;
    const radio = (name, value, on, text) =>
      `<label class="map-check"><input type="radio" name="${name}" value="${esc(value)}"${on ? " checked" : ""}> <span>${esc(text)}</span></label>`;
    let html = `<fieldset class="map-fs"><legend>Trip types</legend>`;
    if (!typesOk) html += `<p class="lock map-lock">${icon("lock", { size: 16 })} ${esc(lockText("tripTypes"))}</p>`;
    html += `<div class="map-fs-grid">` +
      options.map((o) => `<label class="map-check"><input type="checkbox" name="type" value="${esc(o.id)}"` +
        `${d.types.has(o.id) ? " checked" : ""}${typesOk ? "" : " disabled"}> <span>${esc(o.label)}</span></label>`).join("") +
      `</div><p class="note map-hint">None ticked shows every type. Types also change the tiles.</p></fieldset>`;
    if (carShown) {
      html += `<fieldset class="map-fs"><legend>Which drives</legend>` +
        radio("car", "all", d.car === "all", "All drives") +
        (hasOther ? radio("car", "other", d.car === "other", "Other cars") : "") +
        (askTotal > 0 ? radio("car", "ask", d.car === "ask", `Needs an answer (${askTotal})`) : "") +
        `</fieldset>`;
    }
    html += `<fieldset class="map-fs"><legend>Show</legend>` +
      chk("short", d.short, `Show short trips (${shortCount})`) +
      chk("tow", d.tow, "Towing only") +
      chk("notes", d.notes, "With notes only") +
      `</fieldset>` +
      `<fieldset class="map-fs"><legend>Reconstructed drives</legend>` +
      radio("recon", "", d.recon === "", "All") + radio("recon", "only", d.recon === "only", "Only") +
      radio("recon", "hide", d.recon === "hide", "Hide") +
      `</fieldset>` +
      `<fieldset class="map-fs"><legend>Distance (${esc(L.dist)})</legend><div class="map-dist">` +
      `<label><span>From</span><input type="text" inputmode="decimal" name="dmin" value="${esc(distanceToInput(d.dmin, units))}" placeholder="Any" autocomplete="off"></label>` +
      `<label><span>To</span><input type="text" inputmode="decimal" name="dmax" value="${esc(distanceToInput(d.dmax, units))}" placeholder="Any" autocomplete="off"></label>` +
      `</div><p class="note map-hint map-dist-msg"></p></fieldset>`;
    return html;
  }

  function openFilters() {
    const body = document.createElement("form");
    body.className = "map-sheet";
    body.setAttribute("novalidate", "");
    body.addEventListener("submit", (e) => e.preventDefault());
    const draw1 = () => { body.innerHTML = sheetHtml(st, listed.shortCount); };
    draw1();
    /** The form → a state, or null (with a message) when a distance does not read as a number. */
    const read = () => {
      const f = new FormData(body);
      const typeSet = typesOk ? new Set(f.getAll("type").map(String)) : new Set();
      const t1 = String(f.get("dmin") ?? "").trim(), t2 = String(f.get("dmax") ?? "").trim();
      const dmin = distanceFromInput(t1, units), dmax = distanceFromInput(t2, units);
      const msg = body.querySelector(".map-dist-msg");
      if ((t1 && dmin === null) || (t2 && dmax === null)) {
        msg.textContent = "Enter distances as numbers, for example 12.5.";
        return null;
      }
      msg.textContent = "";
      let lo = dmin, hi = dmax;
      if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
      return {
        types: typeSet,
        car: carShown ? (String(f.get("car") || "all")) : "all",
        short: f.get("short") !== null,
        tow: f.get("tow") !== null,
        notes: f.get("notes") !== null,
        recon: String(f.get("recon") || ""),
        dmin: lo, dmax: hi,
      };
    };
    closeSheet = openSheet({
      title: "Filter trips",
      bodyEl: body,
      applyText: "Show trips",
      onApply: () => {
        const next = read();
        if (!next) return false;
        Object.assign(st, next);
        if (!["all", "other", "ask"].includes(st.car)) st.car = "all";
        if (!["", "only", "hide"].includes(st.recon)) st.recon = "";
        commit(); draw();
        return true;
      },
      onReset: () => {
        Object.assign(st, clearSheet(st));
        commit(); draw();
        draw1();
      },
      onClose: () => { closeSheet = null; },
    });
  }
  const onFilterBtn = () => openFilters();
  $(".map-filterbtn").addEventListener("click", onFilterBtn);

  // ── routes in this period ──
  let routesOn = false;
  let routesMap = null;
  let routesMapP = null;
  let routesMapGen = 0;     // bumps on Hide, so a map still loading from before is dropped
  let routesToken = 0;
  let routesTimer = 0;
  const routesCard = $(".map-routes");
  const routesMapEl = $(".map-routes-map");
  const routesNote = $(".map-routes-note");
  const routesBtn = $(".map-routes-btn");

  function drawRoutesSummary() {
    const n = listed.rows.length;
    $(".map-routes-sum").textContent = `${n} ${n === 1 ? "trip" : "trips"}`;
    $(".map-routes-intro").textContent = n === 0
      ? "No listed trips in this period."
      : `Draws the recorded route of ${n > ROUTES_MAX ? `the newest ${ROUTES_MAX} of the ${n}` : n === 1 ? "the" : `the ${n}`} listed ${n === 1 ? "trip" : "trips"} on a map. The map area you view is loaded from OpenFreeMap.`;
    routesBtn.disabled = n === 0 && !routesOn;
    routesBtn.querySelector("span").textContent = routesOn ? "Hide routes" : "Show routes";
  }
  function scheduleRoutes() {
    clearTimeout(routesTimer);
    routesTimer = setTimeout(() => { loadRoutes(); }, 250);
  }
  function hideRoutes() {
    routesOn = false;
    routesToken++;
    routesMapGen++;
    clearTimeout(routesTimer);
    if (routesMap) { routesMap.destroy(); routesMap = null; }
    routesMapP = null;
    routesMapEl.innerHTML = "";
    routesMapEl.className = "map-routes-map";
    routesMapEl.removeAttribute("style");
    routesNote.textContent = "";
    drawRoutesSummary();
  }
  function ensureRoutesMap() {
    if (!routesMapP) {
      const gen = routesMapGen;
      const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
      routesMapP = mountMap(routesMapEl, { kind: "period", height: phone ? 300 : 420, ariaLabel: "Routes in this period", noTiles: ctx.noTiles })
        .then((h) => {
          if (!alive || !routesOn || gen !== routesMapGen) { if (h) h.destroy(); return null; }
          routesMap = h;
          if (h) h.onLineClick(onRouteClick);
          return h;
        });
    }
    return routesMapP;
  }
  function onRouteClick(props, lngLat) {
    const t = scopeTrips.find((x) => x.id === String(props.tripId));
    if (!t || !routesMap) return;
    const e = tripEff(t);
    routesMap.popup(lngLat,
      `<div class="map-pop"><div class="map-pop-title">${esc(dateFmt(t.date, "EEE, MMM d · h:mm a", zone))}</div>` +
      `<div>${esc(distText(t.miles, units))} · ${esc(e === null ? "—" : `${fixed(eff(e, units), 2)} ${L.eff}`)}` +
      `${costOk ? ` · ${esc(money(t.cost))}` : ""}</div>` +
      (detailOk ? `<a href="${tripHref(t.id)}">Open trip →</a>` : "") + `</div>`);
  }
  async function loadRoutes() {
    const token = ++routesToken;
    const rows = listed.rows.slice(0, ROUTES_MAX);
    const total = listed.rows.length;
    if (!rows.length) {
      if (routesMap) routesMap.setData({ lines: null, fit: null });
      routesNote.textContent = "No listed trips in this period.";
      return;
    }
    const ids = rows.map((t) => t.id);
    const polys = new Map();
    try {
      for (let i = 0; i < ids.length; i += ROUTES_BATCH) {
        if (token !== routesToken || !alive) return;
        if (ids.length > ROUTES_BATCH) routesNote.textContent = `Loading routes ${i} / ${ids.length}…`;
        const m = await api.tripRoutes(ids.slice(i, i + ROUTES_BATCH));
        if (m && typeof m.forEach === "function") m.forEach((v, k) => polys.set(k, v));
      }
    } catch (err) {
      if (token === routesToken && alive) routesNote.textContent = `The routes did not load: ${(err && err.message) || err}`;
      return;
    }
    if (token !== routesToken || !alive) return;
    const routes = rows.map((t) => ({ tripId: t.id, points: decimate(parsePolyline(polys.get(t.id) || ""), 400) }))
      .filter((r) => r.points.length >= 2);
    const h = await ensureRoutesMap();
    if (token !== routesToken || !alive) return;
    const missing = rows.length - routes.length;
    const parts = [];
    if (total > ROUTES_MAX) parts.push(`Showing the newest ${ROUTES_MAX} of ${total}.`);
    if (!routes.length) parts.push("None of these trips recorded a route.");
    else if (missing) parts.push(`${missing} ${missing === 1 ? "trip has" : "trips have"} no recorded route.`);
    if (h) parts.push("Each trip has its own colour, darker where it was slower. Click a route for its trip.");
    routesNote.textContent = parts.join(" ");
    if (!h) return;           // the fallback sentence is in the map box; the list still works
    const lines = periodRouteFeatures(routes);
    h.setData({ lines, fit: boundsOf(coordsOf(lines)) });
  }
  const onRoutesBtn = () => {
    if (routesOn) { hideRoutes(); return; }
    routesOn = true;
    drawRoutesSummary();
    loadRoutes();
  };
  const routesHead = $(".map-routes-head");
  const toggleRoutes = () => {
    const open = !routesCard.classList.contains("open");
    routesCard.classList.toggle("open", open);
    routesHead.setAttribute("aria-expanded", open ? "true" : "false");
    routesHead.querySelector(".card-chev").innerHTML = icon(open ? "expand_less" : "expand_more", { size: 22 });
    if (open && routesMap) routesMap.resize();
  };
  const onToggle = () => toggleRoutes();
  const onToggleKey = (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleRoutes(); }
  };
  routesBtn.addEventListener("click", onRoutesBtn);
  routesHead.addEventListener("click", onToggle);
  routesHead.addEventListener("keydown", onToggleKey);

  // ── charts ──
  try {
    chartsH = mountCharts($(".map-charts"), childCtx, { ids: ["efficiency", "distance", "energy"], title: "Trends" });
  } catch (e) {
    console.error(e);
    $(".map-charts").innerHTML = "";
  }

  draw();
  mountTab();
  saveTripsBackLink();

  return {
    unmount() {
      alive = false;
      routesToken++;
      clearTimeout(routesTimer);
      if (closeSheet) closeSheet();
      $(".map-tabs").removeEventListener("click", onTabs);
      $(".map-tabs").removeEventListener("keydown", onTabKey);
      $(".map-filterbtn").removeEventListener("click", onFilterBtn);
      routesBtn.removeEventListener("click", onRoutesBtn);
      routesHead.removeEventListener("click", onToggle);
      routesHead.removeEventListener("keydown", onToggleKey);
      if (routesMap) { routesMap.destroy(); routesMap = null; }
      for (const hd of [tabH, chartsH, grid, range]) {
        if (!hd) continue;
        try { (hd.destroy || hd.unmount).call(hd); } catch (_) { /* already gone */ }
      }
    },
  };
}
