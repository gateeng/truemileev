// TrueMile EV web | #/map/trip/<id> — one drive, in TripDetailScreen's order: header and same-day paging,
// TRIP STATS, odometer, driven before connection, parked use before this trip, type / journey / car /
// notes, the recorded route and the speed / elevation charts. With Max (tripGraphs, as in the app) the
// route is a map (views/mapview.js) coloured by speed or by the speed model's efficiency; below Max, when
// the map cannot run, and on paper it is the plain SVG (lib/route.js svgRoute).

import { esc } from "../lib/dom.js";
import * as api from "../lib/api.js";
import { lineChart } from "../lib/svgchart.js";
import { fixed, grouped, money, tripDuration, dateFmt } from "../lib/format.js";
import { dist, speed, eff, temp, perDist, economy, weight, elevationFromFt, labels, MPGE_FACTOR } from "../lib/units.js";
import { startOfDay, endOfDay } from "../lib/tz.js";
import { classLabel, tripEff, carCell } from "../lib/rows.js";
import { allows, lockText } from "../lib/gates.js";
import {
  startEpochOf, packFor, startSocPct, odometer, hvacKwh, parkedWindow, dayNeighbors, dollarsPerMile,
} from "../lib/tripdetail.js";
import { displayName } from "../lib/journeys.js";
import {
  parsePolyline, decimate, svgRoute, elevationGainFt, speedSeries, elevationSeries, modelEffSeries,
} from "../lib/route.js";
import { distText, backToTripsHref, tripPills, hasNotes, vehicleNames, tripHref } from "./trips.js";
import { mountMap } from "./mapview.js";
import { routeFeatures, endMarkers, boundsOf, coordsOf } from "../lib/mapdata.js";

export const BUILD = "2026-09-30.1";

const LOCK = "🔒";

function stat(label, value, color, id = "") {
  return `<div class="trips-stat"${id ? ` id="${id}"` : ""}><span class="trips-stat-k">${esc(label)}</span>` +
    `<b class="trips-stat-v" style="color:${color}">${esc(value)}</b></div>`;
}

function signed(v) {
  const s = fixed(v, 0);
  return v >= 0 && !s.startsWith("-") ? "+" + s : s;
}

export function mount(el, ctx) {
  const path = ctx.path || [];
  const id = decodeURIComponent((path[0] === "map" ? path[2] : path[path.length - 1]) || "");
  const acc = ctx.account;
  const t = acc.trips.find((x) => x.id === id);
  const back = backToTripsHref();
  if (!t) {
    el.innerHTML = `<section class="trips-view"><p class="trips-back"><a href="${esc(back)}">‹ Trips</a></p>` +
      `<p class="msg info">This drive is not in your account any more. It may have been combined with another drive on the phone.</p></section>`;
    return {};
  }
  if (!allows(ctx.tier, "tripDetail")) {
    el.innerHTML = `<section class="trips-view"><p class="trips-back"><a href="${esc(back)}">‹ Trips</a></p>` +
      `<p class="note trips-lock">🔒 Trip details: ${esc(lockText("tripDetail"))}</p></section>`;
    return {};
  }
  const u = ctx.units, L = labels(u), zone = ctx.tz;
  const costOk = allows(ctx.tier, "costAnalytics");
  const hvacOk = allows(ctx.tier, "hvac");
  const graphsOk = allows(ctx.tier, "tripGraphs");
  const journeysOk = allows(ctx.tier, "journeys");
  const vehicle = acc.vehicles.find((v) => v.id === t.vehicleId) || null;
  const names = vehicleNames(ctx);
  const pack = packFor(t, vehicle);
  const pw = parkedWindow(t, acc.trips, acc.parked || []);
  const e = tripEff(t);
  const mpge = e === null ? null : e * MPGE_FACTOR;
  const sSoc = startSocPct(t, pack, pw.preObdKwh);
  const dpm = dollarsPerMile(t);
  const odo = odometer(t);

  // ── header and same-day paging ──
  const nb = dayNeighbors(t, acc.trips, startOfDay(t.date, zone), endOfDay(t.date, zone) + 1);
  let sub = "";
  if (t.carStatus === "other") sub = `<div class="trips-sub">In another car · ${esc(t.otherCarLabel)}</div>`;
  else if (t.carStatus === "ask") sub = `<div class="trips-sub trips-amber">Which car was this?</div>`;
  const counter = nb.count > 1
    ? `<div class="trips-sub">Trip ${nb.index + 1} of ${nb.count}${nb.allCars ? " (all cars)" : ""}</div>` : "";
  const arrow = (tid, txt, lbl) => tid
    ? `<a class="trips-arrow" href="${tripHref(tid)}" aria-label="${lbl}">${txt}</a>`
    : `<span class="trips-arrow trips-arrow-off" aria-hidden="true">${txt}</span>`;
  const showVeh = ctx.scope && ctx.scope.id === "all";

  // ── TRIP STATS (TD order) ──
  const cM = "var(--m-distance)", cC = "var(--m-cost)", cE = "var(--m-efficiency)", cG = "var(--m-charging)",
    cP = "var(--m-power)";
  const stats = [
    stat("Start Time", dateFmt(startEpochOf(t), "h:mm a", zone), cM),
    stat("End Time", dateFmt(t.date, "h:mm a", zone), cM),
    stat("Elapsed", t.isReconciled ? "—" : tripDuration(t.durationSec), cM),
    stat("Moving", "—", cM),
    stat("Cost", costOk ? money(t.cost) : LOCK, cC),
    stat(L.perDist, !costOk ? LOCK : dpm === null ? "—" : money(perDist(dpm, u), 2), cC),
    stat("Efficiency", e === null ? "—" : `${fixed(eff(e, u), 2)} ${L.eff}`, cE),
    stat(L.econ, mpge === null ? "—" : u === "metric" ? fixed(economy(mpge, u), 1) : String(Math.trunc(mpge)), cE),
    stat("Distance", distText(t.miles, u), cM),
    stat("SoH", t.sohPct > 0 ? `${fixed(t.sohPct, 0)}%` : "—", cP),
    stat("Highway", distText(t.hwyMi, u), cM),
    stat("Local", distText(t.localMi, u), cM),
    stat("Regen Dist", distText(t.regenMi, u), cG),
    stat("Regen kWh", fixed(t.regenKwh, 2), cG),
    stat("Start SoC", `${fixed(sSoc, 0)}%`, cG),
    stat("End SoC", `${fixed(t.endSocPct, 0)}%`, cG),
    stat("Start kWh", `${fixed(sSoc / 100 * pack, 1)} kWh`, cG),
    stat("End kWh", `${fixed(t.endSocPct / 100 * pack, 1)} kWh`, cG),
    stat("HVAC %", hvacOk ? `${fixed(t.hvacPct, 0)}%` : LOCK, cP),
    stat("HVAC kWh", hvacOk ? fixed(hvacKwh(t), 2) : LOCK, cP),
    stat("Cabin T", `${fixed(temp(t.cabinF, u), 0)}${L.temp}`, cM),
    stat("Outside T", `${fixed(temp(t.outsideF, u), 0)}${L.temp}`, cM),
    stat("Elevation", "…", cM, "trips-elev"),
    stat("Wind", "—", cM),
  ].join("");
  const summary = `${distText(t.miles, u)} · ${e === null ? "—" : `${fixed(eff(e, u), 2)} ${L.eff}`} · ${costOk ? money(t.cost) : LOCK}`;

  let odoHtml = "";
  if (odo) {
    odoHtml = `<div class="trips-odo"><div><span class="trips-stat-k">Odometer</span>` +
      `<b>${esc(`${grouped(dist(odo.startOdo, u), 1)} → ${grouped(dist(odo.endOdo, u), 1)} ${L.dist}`)}</b></div>` +
      `<b>${esc(`+${fixed(dist(odo.spanMi, u), 1)} ${L.dist}`)}</b></div>`;
    if (odo.warn) {
      odoHtml += `<p class="trips-amber trips-small">${esc(`Distance sources differ by ${fixed(dist(odo.warn.diffMi, u), 1)} ${L.dist} ` +
        `(odometer ${fixed(dist(odo.warn.odoMi, u), 1)} vs recorded ${fixed(dist(odo.warn.recordedMi, u), 1)})`)}</p>`;
    }
  }

  // ── driven before connection / parked use ──
  let preHtml = "";
  if (pw.preObdKwh > 0.005) {
    preHtml = `<div class="panel card trips-card"><h3 class="trips-h3">Driven before connection</h3><div class="trips-stats">` +
      stat("Energy", `${fixed(pw.preObdKwh, 2)} kWh`, cG) +
      (pw.preObdCost > 0.005 && costOk ? stat("Cost", money(pw.preObdCost), cC) : "") +
      `</div><p class="note">Battery use between your last recorded trip and the moment the adapter connected. Estimated.</p></div>`;
  }
  let parkedHtml = "";
  if (pw.parkedKwh > 0.005) {
    const line = (lbl, kwh, cost) => `<div class="trips-line"><span>${esc(lbl)}</span><span class="note">` +
      esc(cost > 0.005 && costOk ? `${fixed(kwh, 2)} kWh · ${money(cost)}` : `${fixed(kwh, 2)} kWh`) + `</span></div>`;
    parkedHtml = `<div class="panel card trips-card"><h3 class="trips-h3">Parked use before this trip</h3><div class="trips-stats">` +
      stat("Parked kWh", `${fixed(pw.parkedKwh, 2)} kWh`, cG) + stat("Cost", costOk ? money(pw.parkedCost) : LOCK, cC) + `</div>` +
      (pw.idleKwh > 0.005 && pw.hvacKwh > 0.005
        ? line("Idle battery drain", pw.idleKwh, pw.idleCost) + line("Preconditioning (not driven)", pw.hvacKwh, pw.hvacCost) : "") +
      `<p class="note">Battery used while parked since your last drive. It is already in your running costs and is shown here so it is not lost.</p></div>`;
  }

  // ── type, journey, car, notes ──
  const kv = [];
  kv.push(["Trip type", t.classification ? classLabel(t.classification) + (t.autoAssigned ? " · set automatically" : "") : "Unclassified", null]);
  if (t.journeyId && t.carStatus === "") {
    let best = null;
    for (const o of acc.trips) {
      if (o.vehicleId === t.vehicleId && o.journeyId === t.journeyId && o.carStatus === "" && o.journeyName &&
        (best === null || o.journeyName > best)) best = o.journeyName;
    }
    const nm = displayName(t.journeyId, best);
    kv.push(["Journey", nm, journeysOk
      ? `#/map/journey/${encodeURIComponent(t.journeyId)}?v=${encodeURIComponent(t.vehicleId)}` : null]);
  }
  if (t.carStatus !== "") kv.push(["Car", carCell(t, ""), null]);
  if (showVeh) kv.push(["Vehicle", names.get(t.vehicleId) || "", null]);
  const notes = ((acc.notesByTrip && acc.notesByTrip.get(t.clientTripId)) || []).slice()
    .sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
  const infoHtml = `<div class="panel card trips-card"><dl class="trips-kv">` +
    kv.map(([k, v, href]) => `<dt>${esc(k)}</dt><dd>${href ? `<a href="${esc(href)}">${esc(v)}</a>` : esc(v)}</dd>`).join("") +
    `</dl>` +
    (notes.length ? `<h3 class="trips-h3">Notes</h3>` + notes.map((n) => `<p class="trips-note">${esc(n.body || "")}</p>`).join("") : "") +
    `</div>`;

  el.innerHTML =
    `<section class="trips-view trips-detail">` +
    `<p class="trips-back"><a href="${esc(back)}">‹ Trips</a></p>` +
    `<header class="trips-detail-head">${arrow(nb.prevId, "◀︎", "Previous trip")}` +
    `<div class="trips-detail-title"><h2>${esc(dateFmt(t.date, "EEE, MMM d · HH:mm", zone))}</h2>${sub}${counter}` +
    `<div class="trips-pills">${tripPills(t, hasNotes(ctx, t))}</div></div>` +
    `${arrow(nb.nextId, "▶︎", "Next trip")}</header>` +
    (t.isReconciled ? `<p class="msg info">Reconstructed drive: distance and cost are real, the energy is inferred from the charges before and after.</p>` : "") +
    (t.towLbs > 0 ? `<p class="note">${esc(`Towing ${fixed(weight(t.towLbs, u), 0)} ${L.weight}`)}</p>` : "") +
    `<details class="panel card trips-card" open><summary class="trips-h3">Trip stats <span class="note trips-summary">${esc(summary)}</span></summary>` +
    `<div class="trips-stats">${stats}</div>${odoHtml}</details>` +
    preHtml + parkedHtml + infoHtml +
    `<div class="panel card trips-card"><div class="trips-routehead"><h3 class="trips-h3">Route</h3>` +
    (graphsOk ? `<div class="seg trips-colorby" role="group" aria-label="Colour by">` +
      `<span class="trips-colorby-k">Colour by</span>` +
      `<button type="button" data-by="speed" class="on" aria-pressed="true">Speed</button>` +
      `<button type="button" data-by="eff" aria-pressed="false">Efficiency</button></div>` : "") +
    `</div><div class="trips-route"><p class="note">Loading the route…</p></div>` +
    `<div class="trips-legend" hidden></div><div class="trips-routenote"></div>` +
    `<div class="trips-print-only trips-route-print"></div></div>` +
    `<div class="panel card trips-card"><h3 class="trips-h3">Charts</h3><div class="trips-charts">` +
    (graphsOk ? `<p class="note">Loading…</p>` : `<p class="note">🔒 ${esc(lockText("tripGraphs"))}</p>`) + `</div></div>` +
    `</section>`;

  let alive = true;
  let mapH = null;
  let by = "speed";
  let routePts = null;
  const routeEl = el.querySelector(".trips-route");
  const legendEl = el.querySelector(".trips-legend");
  const noteEl = el.querySelector(".trips-routenote");
  const printEl = el.querySelector(".trips-route-print");
  const chartsEl = el.querySelector(".trips-charts");
  const elevEl = el.querySelector("#trips-elev .trips-stat-v");
  const themeNow = () => {
    const a = document.documentElement.getAttribute("data-theme");
    return a === "light" || a === "dark" ? a : ctx.theme === "light" ? "light" : "dark";
  };
  const svgHtml = (pts) => svgRoute([pts], { width: 640, height: 420, units: u, title: "Recorded route" });
  const hideColorBy = () => { const seg = el.querySelector(".trips-colorby"); if (seg) seg.hidden = true; };

  /** The map's lines, markers and legend for the current colouring and theme. */
  function drawMap() {
    if (!mapH || !routePts) return;
    const values = by === "eff" ? modelEffSeries(routePts, routePts.length).y : null;
    const lines = routeFeatures(routePts, { by, values, theme: themeNow() });
    mapH.setData({ lines, markers: endMarkers(routePts), fit: boundsOf(coordsOf(lines)) });
    const lg = lines.legend || {};
    if (lg.min === null || lg.min === undefined) { legendEl.hidden = true; return; }
    const fmt = (v) => (by === "eff" ? `${fixed(eff(v, u), 1)} ${L.eff}` : `${fixed(speed(v, u), 0)} ${L.speed}`);
    legendEl.hidden = false;
    legendEl.innerHTML = `<span class="trips-legend-k">${by === "eff" ? "Efficiency (estimated from speed)" : "Speed"}</span>` +
      `<span class="trips-legend-v">${esc(fmt(lg.min))}</span>` +
      `<span class="trips-legend-bar" style="background:linear-gradient(90deg, ${esc(lg.from)}, ${esc(lg.to)})"></span>` +
      `<span class="trips-legend-v">${esc(fmt(lg.max))}</span>`;
  }

  const onByClick = (ev) => {
    const b = ev.target.closest("[data-by]");
    if (!b || !el.contains(b)) return;
    by = b.dataset.by === "eff" ? "eff" : "speed";
    for (const x of el.querySelectorAll("[data-by]")) {
      const on = x.dataset.by === by;
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", on ? "true" : "false");
    }
    drawMap();
  };
  // The page theme changed: the ramps are per theme, so redraw once the new style is in.
  const onTheme = () => { if (alive) drawMap(); };
  el.addEventListener("click", onByClick);
  document.addEventListener("tm:theme", onTheme);

  api.tripRoutes([t.id]).then(async (m) => {
    if (!alive) return;
    const poly = m && typeof m.get === "function" ? m.get(t.id) : null;
    const pts = parsePolyline(poly || "");
    const el2 = elevationGainFt(pts);
    if (elevEl) {
      elevEl.textContent = el2.startToEndFt === null ? "—"
        : `${signed(elevationFromFt(el2.startToEndFt, u))} ${L.elevation}`;
    }
    if (pts.length < 2) {
      routeEl.innerHTML = `<p class="note">No route was recorded for this drive.</p>`;
      hideColorBy();
      if (graphsOk) chartsEl.innerHTML = `<p class="note">No route data to chart.</p>`;
      return;
    }
    routePts = decimate(pts, 1500);
    if (graphsOk) chartsEl.innerHTML = chartsHtml(pts, u, L);
    if (pts.some((p) => p.interp)) noteEl.innerHTML = `<p class="note trips-small">Dashed stretches were filled in between recorded points.</p>`;
    if (!graphsOk) {
      routeEl.innerHTML = svgHtml(routePts);
      return;
    }
    // Max: the map on screen, the SVG on paper (a WebGL canvas prints blank).
    printEl.innerHTML = svgHtml(routePts);
    routeEl.innerHTML = "";
    const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
    const h = await mountMap(routeEl, { kind: "trip", height: phone ? 300 : 420, ariaLabel: "Recorded route map", noTiles: ctx.noTiles });
    if (!alive) { if (h) h.destroy(); return; }
    if (!h) {
      // No WebGL2, or the library did not load: the SVG route, as below Max.
      routeEl.classList.remove("mapview", "mapview-off");
      routeEl.removeAttribute("role");
      routeEl.style.height = "";
      routeEl.innerHTML = svgHtml(routePts);
      printEl.innerHTML = "";
      hideColorBy();
      return;
    }
    mapH = h;
    drawMap();
  }).catch((err) => {
    if (!alive) return;
    if (elevEl) elevEl.textContent = "—";
    routeEl.innerHTML = `<p class="msg err">${esc(String((err && err.message) || err))}</p>`;
    if (graphsOk) chartsEl.innerHTML = "";
  });

  return {
    unmount() {
      alive = false;
      el.removeEventListener("click", onByClick);
      document.removeEventListener("tm:theme", onTheme);
      if (mapH) { mapH.destroy(); mapH = null; }
    },
  };
}

function chartsHtml(pts, u, L) {
  const sp = speedSeries(pts);
  const el = elevationSeries(pts);
  const ef = modelEffSeries(pts);
  const xs = sp.x.map((v) => dist(v, u));
  const series = [{ label: "Speed", values: sp.y.map((v) => speed(v, u)), color: "var(--cyan)", axis: "left", unit: L.speed }];
  if (el.y.some((v) => v !== null)) {
    series.push({ label: "Elevation", values: el.y.map((v) => (v === null ? null : elevationFromFt(v, u))),
      color: "var(--amber)", axis: "right", unit: L.elevation });
  }
  return lineChart({
    width: 640, height: 260, title: series.length > 1 ? "Speed and elevation" : "Speed",
    x: { label: `Distance (${L.dist})`, values: xs, kind: "number" }, series,
  }) +
    lineChart({
      width: 640, height: 220, title: "Efficiency (estimated from speed)",
      x: { label: `Distance (${L.dist})`, values: ef.x.map((v) => dist(v, u)), kind: "number" },
      series: [{ label: "Efficiency (estimated from speed)", values: ef.y.map((v) => eff(v, u)), color: "var(--m-efficiency)", axis: "left", unit: L.eff }],
      yZero: true,
    }) +
    `<p class="note trips-small">The efficiency line is a model of speed, not a measurement.</p>`;
}
