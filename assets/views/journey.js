// TrueMile EV web | #/map/journey/<id>[?v=<vehicle id>] — one journey (Max): summary tiles, the journey
// map (every drive's route in its own leg colour plus the journey's non-home charge pins, on the app's
// OpenFreeMap styles), its drives by day, and the charges dated inside it. Without WebGL the routes fall
// back to one plain SVG. The page never says whether the journey is still going: that lives on the phone.

import { esc } from "../lib/dom.js";
import * as api from "../lib/api.js";
import { fixed, money, tripDuration, dateFmt } from "../lib/format.js";
import { eff, labels } from "../lib/units.js";
import { inScope, isHome } from "../lib/rows.js";
import { allows, lockText } from "../lib/gates.js";
import { groupJourneys, rangeLabel, metaLabel, journeyCharges, findJourney } from "../lib/journeys.js";
import { parsePolyline, decimate, svgRoute } from "../lib/route.js";
import { parseGps } from "../lib/stops.js";
import { legFeatures, pointFeatures, boundsOf, coordsOf, JOURNEY_LEG_COLORS } from "../lib/mapdata.js";
import { icon } from "../lib/icons.js";
import { distText, vehicleNames, groupByDay, dayGroupsHtml, backToJourneysHref } from "./trips.js";
import { sessionRowHtml } from "./charges.js";
import { mountMap } from "./mapview.js";

export const BUILD = "2026-09-29.2";

export function mount(el, ctx) {
  const backHref = backToJourneysHref();
  const back = `<p class="trips-back"><a href="${esc(backHref)}">‹ Journeys</a></p>`;
  if (!allows(ctx.tier, "journeys")) {
    el.innerHTML = `<section class="trips-view">${back}<p class="lock trips-lock">${icon("lock", { size: 18 })} Journeys: ${esc(lockText("journeys"))}</p></section>`;
    return {};
  }
  const path = ctx.path || [];
  const jid = decodeURIComponent((path[0] === "map" ? path[2] : path[path.length - 1]) || "");
  const vid = ctx.query && ctx.query.v ? String(ctx.query.v) : null;
  const j = findJourney(groupJourneys(ctx.account.trips.filter((t) => inScope(t, ctx.scope))), jid, vid) ||
    findJourney(groupJourneys(ctx.account.trips), jid, vid) || null;
  if (!j) {
    el.innerHTML = `<section class="trips-view">${back}<p class="msg info">No journey with this name is in your account.</p></section>`;
    return {};
  }
  const u = ctx.units, L = labels(u), zone = ctx.tz;
  const costOk = allows(ctx.tier, "costAnalytics");
  const detailOk = allows(ctx.tier, "tripDetail");
  const names = vehicleNames(ctx);
  const tile = (k, v, c) => `<div class="tile"><div class="v" style="color:${c}">${esc(v)}</div><div class="k">${esc(k)}</div></div>`;
  const charges = journeyCharges(j, ctx.account.charges).sort((a, b) => b.date - a.date);
  const printHref = `#/report?doc=journey&j=${encodeURIComponent(j.id)}&v=${encodeURIComponent(j.vehicleId)}`;

  el.innerHTML = `<section class="trips-view trips-journey">${back}` +
    `<h2 class="trips-jtitle">${esc(j.name)}</h2>` +
    `<p class="trips-sub">${esc(rangeLabel(j, ctx.now(), zone))} · ${esc(metaLabel(j, zone))}` +
    (ctx.scope.id === "all" || (ctx.scope.id !== j.vehicleId) ? ` · ${esc(names.get(j.vehicleId) || "")}` : "") + `</p>` +
    `<div class="tiles trips-jtiles">` +
    tile("Distance", distText(j.miles, u), "var(--m-distance)") +
    tile("Trips", String(j.tripCount), "var(--m-distance)") +
    tile("Driving time", tripDuration(j.durationSec), "var(--m-distance)") +
    tile("Used", `${fixed(j.usedKwh, 1)} kWh`, "var(--m-power)") +
    tile("Regen", `${fixed(j.regenKwh, 1)} kWh`, "var(--m-regen)") +
    tile(L.eff, j.miPerKwh > 0 ? fixed(eff(j.miPerKwh, u), 2) : "—", "var(--m-efficiency)") +
    tile("Cost", costOk ? money(j.cost) : "🔒", "var(--m-cost)") +
    `</div>` +
    `<p class="trips-actions"><a class="btn trips-btn" href="${esc(printHref)}">${icon("print", { size: 18 })} Print journey report</a></p>` +
    `<div class="panel card trips-card"><h3 class="trips-h3">Journey map</h3><div class="trips-route"><p class="note">Loading routes…</p></div>` +
    `<div class="trips-routenote"></div><div class="trips-print-only trips-route-print"></div></div>` +
    `<div class="panel card trips-card"><h3 class="trips-h3">Drives (${j.tripCount})</h3>` +
    dayGroupsHtml(groupByDay(j.trips, ctx.now(), zone), ctx, { link: detailOk, costOk, names, openFirst: 1000 }) + `</div>` +
    `<div class="panel card trips-card"><h3 class="trips-h3">Charges (${charges.length})</h3>` +
    (charges.length ? charges.map((c) => sessionRowHtml(c, ctx)).join("") : `<p class="note">No charges between the first and the last drive.</p>`) +
    `</div></section>`;

  let alive = true;
  let mapH = null;
  const routeEl = el.querySelector(".trips-route");
  const noteEl = el.querySelector(".trips-routenote");
  const printEl = el.querySelector(".trips-route-print");

  // The journey's non-home charges with a location (never printed, never exported).
  const pins = charges.filter((c) => !isHome(c)).map((c) => {
    const g = parseGps(c.gps);
    return g ? { lat: g.lat, lng: g.lng, id: c.id, n: 1, home: false } : null;
  }).filter((x) => x);
  const chargeById = new Map(charges.map((c) => [c.id, c]));

  (async () => {
    const ids = j.trips.map((t) => t.id);
    const polys = new Map();
    for (let i = 0; i < ids.length; i += 10) {
      if (!alive) return;
      if (ids.length > 10) routeEl.innerHTML = `<p class="note">Loading routes ${i} / ${ids.length}…</p>`;
      const m = await api.tripRoutes(ids.slice(i, i + 10));
      if (m && typeof m.forEach === "function") m.forEach((v, k) => polys.set(k, v));
    }
    if (!alive) return;
    // Every leg keeps its slot, so leg k is JOURNEY_LEG_COLORS[k % 8] whether or not the one before it
    // recorded a route.
    const legs = j.trips.map((t) => ({ tripId: t.id, points: decimate(parsePolyline(polys.get(t.id) || ""), 400) }));
    const drawn = legs.filter((l) => l.points.length >= 2);
    const missing = legs.length - drawn.length;
    noteEl.innerHTML = drawn.length
      ? `<p class="note trips-small">One colour per drive, in order.${missing ? ` ${missing} ${missing === 1 ? "drive has" : "drives have"} no recorded route.` : ""}</p>`
      : "";
    const svg = () => svgRoute(legs.map((l) => l.points), {
      width: 640, height: 440, units: u, colors: legs.map((_, k) => JOURNEY_LEG_COLORS[k % JOURNEY_LEG_COLORS.length]),
      title: `${j.name}: recorded routes`,
    });
    if (!drawn.length) {
      routeEl.innerHTML = `<p class="note">No route was recorded for these drives.</p>`;
      return;
    }
    printEl.innerHTML = svg();
    routeEl.innerHTML = "";
    const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
    const h = await mountMap(routeEl, { kind: "journey", height: phone ? 320 : 460, ariaLabel: `${j.name}: journey map`, noTiles: ctx.noTiles });
    if (!alive) { if (h) h.destroy(); return; }
    if (!h) {
      routeEl.classList.remove("mapview", "mapview-off");
      routeEl.removeAttribute("role");
      routeEl.style.height = "";
      routeEl.innerHTML = svg();
      printEl.innerHTML = "";
      return;
    }
    mapH = h;
    const lines = legFeatures(legs);
    const points = pointFeatures(pins);
    h.setData({ lines, points, fit: boundsOf(coordsOf(lines)) });
    h.onPointClick((props, lngLat) => {
      const c = chargeById.get(String(props.id));
      if (!c) return;
      const kwh = `${fixed(c.totalKwh, 1)} kWh`;
      h.popup(lngLat,
        `<div class="trips-pop"><div class="trips-pop-title">${esc(c.network.trim() || "Charge")}</div>` +
        `<div class="note">${esc(dateFmt(c.date, "EEE, MMM d · h:mm a", zone))}</div>` +
        `<div>${esc(kwh)}${costOk ? ` · ${esc(money(c.total))}` : ""}</div>` +
        `<a href="#/charge/${encodeURIComponent(c.id)}">Open charge →</a></div>`);
    });
    h.onLineClick((props, lngLat) => {
      const t = j.trips.find((x) => x.id === String(props.tripId));
      if (!t) return;
      const k = j.trips.indexOf(t);
      h.popup(lngLat,
        `<div class="trips-pop"><div class="trips-pop-title">Drive ${k + 1} of ${j.tripCount}</div>` +
        `<div class="note">${esc(dateFmt(t.date, "EEE, MMM d · h:mm a", zone))}</div>` +
        `<div>${esc(distText(t.miles, u))}${costOk ? ` · ${esc(money(t.cost))}` : ""}</div>` +
        (detailOk ? `<a href="#/map/trip/${encodeURIComponent(t.id)}">Open trip →</a>` : "") + `</div>`);
    });
  })().catch((err) => {
    if (alive) routeEl.innerHTML = `<p class="msg err">${esc(String((err && err.message) || err))}</p>`;
  });
  return {
    unmount() {
      alive = false;
      if (mapH) { mapH.destroy(); mapH = null; }
    },
  };
}
