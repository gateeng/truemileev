// TrueMile EV web: #/garage?tab=vehicle|tow|charger|insights|diag. The app's Garage (Vehicle · Tow ·
// Charger · Diag) plus Insights, for the header's vehicle:
//   Vehicle      spec · battery health over time (Max) · door-jamb labels · photos & window sticker · tires
//   Tow          trailers (Pro: one shown, Max: all) · weight ratings · towing drives
//   Charger      home charger (Pro) · home sessions · fuel comparison
//   Insights     all-time performance (the shared get_stats read) · your real range (Pro) · the learned
//                DC curve (Max) · weather and parked-use charts
//   Diagnostics  trouble-code scan history
// The garage's own rows (door-jamb labels, tires, scans, home charger, trailers) come from api.garage(),
// read once on first use. The VIN, the raw OCR texts and the home's location are never read.

import * as api from "../lib/api.js";
import { h, render, raw, iconHtml, lockNote } from "../lib/dom.js";
import { allows, trailerLimit } from "../lib/gates.js";
import { dateFmt, fixed, money, grouped } from "../lib/format.js";
import { dist, labels, eff as effUnits, pressure, psiFromKpa, isMetric } from "../lib/units.js";
import { inScope, vehicleLabel, isHome, aggregateEff, isEnergyMeasured, tireOrder } from "../lib/rows.js";
import { boardParams, boardModel } from "../lib/board.js";
import { lineChart } from "../lib/svgchart.js";
import { learnDcCurve } from "../lib/curve.js";
import {
  currentOdometer, tireMiles, sohTrend, rangeInsight, roadTripWindow, roadTripRangeMi, optimumChargeMinutes, tempBandLabel,
} from "../lib/insights.js";
import * as trips from "./trips.js";
import * as chargesView from "./charges.js";
import * as charts from "./charts.js";

export const BUILD = "2026-09-30.2";

export const TABS = [
  { key: "vehicle", label: "Vehicle", icon: "directions_car" },
  { key: "tow", label: "Tow", icon: "rv_hookup" },
  { key: "charger", label: "Charger", icon: "ev_station" },
  { key: "insights", label: "Insights", icon: "insights" },
  { key: "diag", label: "Diagnostics", icon: "speed" },
];

const LB_TO_KG = 0.45359237;
const FT_TO_M = 0.3048;

const card = (title, icon, body, { cls = "", tag = "", actions = "" } = {}) => h`
  <section class="card garage-card ${cls}">
    <div class="card-head"><h2 class="card-title">${icon ? raw(iconHtml(icon, { size: 18 })) : ""}${title}</h2>
      ${tag ? h`<span class="card-tag">${tag}</span>` : ""}${actions ? h`<span class="card-actions">${actions}</span>` : ""}</div>
    ${body}
  </section>`;

const kvRows = (pairs) => h`<dl class="kv">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
const empty = (icon, text) => h`<div class="empty">${raw(iconHtml(icon, { size: 32 }))}<span>${text}</span></div>`;
const skeleton = () => h`<div class="skel" aria-busy="true"><span class="skel-bar w60"></span><span class="skel-bar w80"></span><span class="skel-bar w40"></span></div>`;

/** "N lb (N kg)" in imperial, "N kg (N lb)" in metric; one side converted when only the other is known. */
export function weightPair(kg, lbs, units) {
  let k = Number.isFinite(kg) && kg > 0 ? kg : null;
  let l = Number.isFinite(lbs) && lbs > 0 ? lbs : null;
  if (k === null && l === null) return null;
  if (k === null) k = l * LB_TO_KG;
  if (l === null) l = k / LB_TO_KG;
  return isMetric(units) ? `${grouped(k, 0)} kg (${grouped(l, 0)} lb)` : `${grouped(l, 0)} lb (${grouped(k, 0)} kg)`;
}

/** A cold pressure in the user's unit: psi from the psi field (else converted from kPa), kPa likewise. */
export function pressureText(psi, kpa, units) {
  const p = Number.isFinite(psi) && psi > 0 ? psi : null;
  const k = Number.isFinite(kpa) && kpa > 0 ? kpa : null;
  if (p === null && k === null) return null;
  if (isMetric(units)) return `${fixed(k !== null ? k : pressure(p, units), 0)} kPa`;
  return `${fixed(p !== null ? p : psiFromKpa(k), 0)} psi`;
}

/** A trailer weight in the user's unit ("5,400 lbs" / "2,449 kg"). */
const trailerWeight = (lbs, units) => (lbs > 0 ? (isMetric(units) ? `${grouped(lbs * LB_TO_KG, 0)} kg` : `${grouped(lbs, 0)} lbs`) : null);

export function mount(el, ctx) {
  const acct = ctx.account;
  const units = ctx.units, zone = ctx.tz, L = labels(units);
  const tier = ctx.tier || acct.tier;
  const all = acct.vehicles;
  const vid = ctx.scope && ctx.scope.id !== "all" ? ctx.scope.id : ((ctx.vehicles && ctx.vehicles[0]) || all[0] || {}).id;
  const vehicle = all.find((v) => v.id === vid) || null;
  const vName = vehicle ? vehicleLabel(vehicle, all, zone) : "Vehicle";
  const scope = { id: vid, vehicles: vehicle ? [vehicle] : [], all };
  const vTrips = acct.trips.filter((t) => inScope(t, scope));
  const own = vTrips.filter((t) => t.carStatus === "");
  const vCharges = acct.charges.filter((c) => inScope(c, scope));
  const odo = currentOdometer(own, vCharges);
  const q = ctx.query || {};
  let tab = TABS.some((t) => t.key === q.tab) ? q.tab : "vehicle";
  let alive = true;
  let subs = [];               // sub-mounts of the current tab ({destroy()})
  let g = null;                // api.garage() once loaded

  render(el, h`
    <div class="garage">
      <div class="subtabs garage-tabs" role="tablist" aria-label="Garage" style="--c:var(--c-garage)">
        ${TABS.map((t) => h`<button type="button" role="tab" id="garage-tab-${t.key}" data-tab="${t.key}" aria-controls="garage-panel"
          aria-selected="${t.key === tab ? "true" : "false"}" tabindex="${t.key === tab ? "0" : "-1"}">${raw(iconHtml(t.icon, { size: 18 }))}<span>${t.label}</span></button>`)}
      </div>
      <div id="garage-panel" class="garage-panel" role="tabpanel" aria-labelledby="garage-tab-${tab}"></div>
    </div>`);
  const tabsEl = el.querySelector(".garage-tabs");
  const panel = el.querySelector(".garage-panel");

  const onTab = (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b || b.dataset.tab === tab) return;
    select(b.dataset.tab, false);
  };
  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.key === tab);
    if (e.key === "ArrowRight") { e.preventDefault(); select(TABS[(i + 1) % TABS.length].key, true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); select(TABS[(i + TABS.length - 1) % TABS.length].key, true); }
  };
  tabsEl.addEventListener("click", onTab);
  tabsEl.addEventListener("keydown", onTabKey);

  function select(key, focus) {
    tab = key;
    for (const b of tabsEl.querySelectorAll("button[data-tab]")) {
      const on = b.dataset.tab === key;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    panel.setAttribute("aria-labelledby", `garage-tab-${key}`);
    ctx.setQuery({ tab: key === "vehicle" ? "" : key });
    draw();
  }

  function clearSubs() {
    for (const s of subs) { try { s && typeof s.destroy === "function" && s.destroy(); } catch (_) { /* gone */ } }
    subs = [];
  }

  function draw() {
    clearSubs();
    if (!vehicle) { render(panel, empty("directions_car", "No vehicle yet. Vehicles are added in the app.")); return; }
    if (tab === "insights") { drawInsights(); return; }       // needs no garage rows
    if (!g) { render(panel, h`<div class="grid-cards">${card("Loading", "", skeleton())}${card("", "", skeleton())}</div>`); return; }
    if (tab === "vehicle") drawVehicle();
    else if (tab === "tow") drawTow();
    else if (tab === "charger") drawCharger();
    else drawDiag();
  }

  const gv = () => (g && g.vehicles instanceof Map ? g.vehicles.get(vid) || null : null);
  const jamb = () => (gv() && gv().jamb) || null;
  const pieceError = (x) => (x && !Array.isArray(x) && !(x instanceof Map) && x.error ? x.error : null);
  const failed = (what, err) => h`<div class="msg err">${what} did not load: ${err}</div>`;

  // ── Vehicle ─────────────────────────────────────────────────────────────────────────────────
  function drawVehicle() {
    const v = vehicle, x = gv();
    const title = [v.year > 0 ? String(v.year) : "", v.make, v.model, v.trim].filter(Boolean).join(" ") || vName;
    const spec = card("Vehicle", "directions_car", h`
      <div class="garage-title">${title}</div>
      ${pieceError(g.vehicles) ? failed("The vehicle details", pieceError(g.vehicles)) : ""}
      ${kvRows([
        ["Equipment group", x && x.equipmentGroup],
        ["Powertrain", x && x.powertrain],
        ["Drive type", x && x.driveType],
        ["Assembly plant", x && x.assemblyPlant],
        ["Pack size", v.packKwhStored > 0 ? `${fixed(v.packKwhStored, v.packKwhStored % 1 ? 1 : 0)} kWh` : null],
        ["Added on", v.createdAt > 0 ? dateFmt(v.createdAt, "MMM d, yyyy", zone) : null],
        ["Odometer", odo !== null ? `${grouped(dist(odo, units), 0)} ${L.dist}` : null],
      ])}`);

    // Battery health over time (Max).
    let health;
    if (!allows(tier, "batteryHealth")) {
      health = card("Battery health", "battery_charging_full", h`${lockNote("batteryHealth")}
        <p class="note">Your pack's state of health, drive by drive, over time.</p>`);
    } else {
      const s = sohTrend(own);
      const chart = s.enough ? lineChart({
        width: 640, height: 200, title: "Battery state of health",
        x: { label: "Date", values: s.points.map((p) => p.date), kind: "time", zone },
        series: [{ label: "SoH", values: s.points.map((p) => p.soh), color: "var(--m-bms)", axis: "left", unit: "%", decimals: 1 }],
      }) : "";
      health = card("Battery health", "battery_charging_full", h`
        <p class="garage-soh garage-${s.tone}">${s.enough ? h`<b>HVB SoH trend</b> · ${s.caption}` : s.caption}</p>
        ${s.enough ? h`<div class="garage-chart">${raw(chart)}</div>` : ""}
        <p class="note">Benchmark history and 12 V battery dates stay on your phone.</p>`);
    }

    // Door-jamb labels (never the VIN).
    const j = jamb();
    const jambBody = !j ? empty("description", "Scan the door-jamb labels in the app (Garage → Vehicle) to fill these in.")
      : kvRows(jambRows(j, units));
    const jambCard = card("Door-jamb labels", "description", h`${pieceError(g.vehicles) ? failed("The door-jamb labels", pieceError(g.vehicles)) : jambBody}`,
      { actions: j && j.userConfirmed ? h`<span class="chip ok">${raw(iconHtml("workspace_premium", { size: 14 }))}Confirmed in the app</span>` : "" });

    const photos = card("Photos & window sticker", "photo_camera", h`
      <div class="garage-photo">${raw(iconHtml("photo_camera", { size: 22 }))}<p>Door-jamb photos stay on your phone: the app keeps them in its own storage and never uploads them. The values read from them are shown above.</p></div>
      <div class="garage-photo">${raw(iconHtml("description", { size: 22 }))}<p>The window sticker opens from Garage → Vehicle in the app. It is fetched from Ford with your VIN, and this website never reads your VIN.</p></div>`);

    render(panel, h`<div class="grid-cards">${spec}${health}${jambCard}${photos}${tiresCard()}</div>`);
    wireCollapsibles(panel);
  }

  function tiresCard() {
    const err = pieceError(g.tires);
    if (err) return card("Tires", "tune", failed("The tires", err));
    const mine = g.tires.filter((t) => t.vehicleId === vid && !t.trailerId);
    const mounted = mine.filter((t) => t.mounted).sort((a, b) => tireOrder(a.position) - tireOrder(b.position) || b.installMs - a.installMs);
    const removed = mine.filter((t) => !t.mounted).sort((a, b) => b.removedMs - a.removedMs);
    const j = jamb();
    const rec = j ? [
      [j.tireFront, j.tireRear].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(" / "),
      [pressureText(j.tirePressureFrontPsi, j.tirePressureFrontKpa, units), pressureText(j.tirePressureRearPsi, j.tirePressureRearKpa, units)]
        .filter(Boolean).join(" / "),
    ] : ["", ""];
    return card("Tires", "tune", h`
      ${rec[0] || rec[1] ? h`<p class="garage-rec">Recommended: ${[rec[0], rec[1] ? `${rec[1]} cold` : ""].filter(Boolean).join(" · ")}</p>` : ""}
      ${mounted.length ? h`<ul class="garage-tires">${mounted.map((t) => tireItem(t))}</ul>`
        : empty("tune", "No tires recorded yet. Add them in the app: Garage → Vehicle → Tires.")}
      ${removed.length ? h`<div class="card collapsible garage-removed">
          <div class="card-head" role="button" tabindex="0" aria-expanded="false"><h3 class="card-title">Removed tires (${removed.length})</h3><span class="card-chev">${raw(iconHtml("expand_more", { size: 20 }))}</span></div>
          <div class="card-body"><ul class="garage-tires">${removed.map((t) => tireItem(t))}</ul></div>
        </div>` : ""}
      <p class="note">Tread depth is kept on your phone.</p>`);
  }

  function tireItem(t) {
    const miles = t.mounted ? tireMiles(t.installOdo, odo) : null;
    const name = [t.brand, t.model].filter(Boolean).join(" ") || "Tire";
    const bits = [
      t.size || null,
      t.dot ? `DOT ${t.dot}` : null,
      t.installMs > 0 ? `installed ${dateFmt(t.installMs, "MMM d, yyyy", zone)}` : null,
      !t.mounted && t.removedMs > 0 ? `removed ${dateFmt(t.removedMs, "MMM d, yyyy", zone)}` : null,
    ].filter(Boolean);
    return h`<li class="garage-tire">
      <div class="garage-tire-pos">${t.positionLabel}</div>
      <div class="garage-tire-main"><div class="row-title">${name}</div><div class="subtitle">${bits.join(" · ")}</div>
        ${t.repairNote ? h`<div class="garage-tire-note">${raw(iconHtml("edit", { size: 14 }))}${t.repairMs > 0 ? `${dateFmt(t.repairMs, "MMM d, yyyy", zone)}: ` : ""}${t.repairNote}</div>` : ""}</div>
      ${t.mounted ? h`<div class="garage-tire-mi"><b>${miles === null ? "—" : `${grouped(dist(miles, units), 0)}`}</b><span>${miles === null ? "" : `${L.dist} on tire`}</span></div>` : ""}
    </li>`;
  }

  // ── Tow ─────────────────────────────────────────────────────────────────────────────────────
  function drawTow() {
    if (!allows(tier, "towing")) {
      render(panel, h`<div class="grid-cards">${card("Towing", "rv_hookup", h`${lockNote("towing")}
        <p class="note">Your trailers, their tires, your truck's weight ratings and the drives you towed on.</p>`)}</div>`);
      return;
    }
    const err = pieceError(g.trailers);
    const limit = trailerLimit(tier);
    let trailersCard;
    if (err) trailersCard = card("Trailers", "rv_hookup", failed("The trailers", err));
    else {
      const list = g.trailers;
      const shown = list.slice(0, limit === Infinity ? list.length : limit);
      const more = list.length - shown.length;
      const tTires = pieceError(g.tires) ? [] : g.tires.filter((t) => t.trailerId);
      trailersCard = card("Trailers", "rv_hookup", h`
        ${!list.length ? empty("rv_hookup", "No trailers saved yet. Add them in the app: Garage → Tow.") : h`<ul class="garage-trailers">${shown.map((t) => {
          const sub = [t.type, trailerWeight(t.loadedLbs, units) ? `${trailerWeight(t.loadedLbs, units)} loaded` : null,
            trailerWeight(t.dryLbs, units) ? `${trailerWeight(t.dryLbs, units)} dry` : null].filter(Boolean).join(" · ");
          const dims = t.w > 0 && t.d > 0 && t.h > 0
            ? (isMetric(units) ? `${fixed(t.w * FT_TO_M, 1)} × ${fixed(t.d * FT_TO_M, 1)} × ${fixed(t.h * FT_TO_M, 1)} m` : `${fixed(t.w, 1)} × ${fixed(t.d, 1)} × ${fixed(t.h, 1)} ft`)
            : null;
          const mine = tTires.filter((x) => x.trailerId === t.clientId && x.mounted).sort((a, b) => tireOrder(a.position) - tireOrder(b.position));
          return h`<li class="garage-trailer">
            <div class="row-title">${t.name || t.type}</div>
            <div class="subtitle">${sub}</div>
            ${kvRows([["Tow/Haul", t.towHaul ? "Yes" : "No"], ["Size (W × D × H)", dims],
              ["Trailer weight", trailerWeight(t.trailerLbs, units)], ["Payload", trailerWeight(t.payloadLbs, units)]])}
            ${mine.length ? h`<div class="garage-sub-h">Tires</div><ul class="garage-tires">${mine.map((x) => tireItem({ ...x, mounted: false, removedMs: 0 }))}</ul>` : ""}
          </li>`;
        })}</ul>`}
        ${more > 0 ? h`<p class="note lock">${raw(iconHtml("lock", { size: 16 }))}<span>${more} more ${more === 1 ? "trailer" : "trailers"} — Available with Max</span></p>` : ""}`);
    }

    const j = jamb();
    const w = (kg, lb) => (j ? weightPair(kg, lb, units) : null);
    const ratings = card("Weight ratings", "info", h`
      <dl class="kv">
        <dt>GVWR</dt><dd>${w(j && j.gvwrKg, j && j.gvwrLbs) || "—"}</dd>
        <dt>GAWR Front</dt><dd>${w(j && j.gawrFrontKg, j && j.gawrFrontLbs) || "—"}</dd>
        <dt>GAWR Rear</dt><dd>${w(j && j.gawrRearKg, j && j.gawrRearLbs) || "—"}</dd>
        ${acct.towCap > 0 ? h`<dt>Max towing capacity</dt><dd>${isMetric(units) ? `${grouped(acct.towCap * LB_TO_KG, 0)} kg` : `${grouped(acct.towCap, 0)} lbs`}</dd>` : ""}
      </dl>
      ${!j ? h`<p class="note">Scan the door-jamb labels in the app to fill these in.</p>` : ""}`);

    const tows = own.filter((t) => t.towLbs > 0).sort((a, b) => b.date - a.date || (a.id < b.id ? 1 : -1));
    const rest = own.filter((t) => !(t.towLbs > 0));
    const effOf = (list) => { let m = 0, u = 0, r = 0; for (const t of list) { if (!isEnergyMeasured(t)) continue; m += t.miles; u += t.usedKwh; r += t.regenKwh; } return aggregateEff(m, u, r); };
    const eTow = effOf(tows), eRest = effOf(rest);
    const link = allows(tier, "tripDetail");
    const costOk = allows(tier, "costAnalytics");
    // Grouped under the Map list's day headers ("Sat, Sep 20"), so each tow carries its date.
    const towList = raw(trips.dayGroupsHtml(trips.groupByDay(tows.slice(0, 10), ctx.now(), zone), { ...ctx, scope },
      { link, costOk, names: new Map([[vid, vName]]) }));
    const towCard = card("Towing drives", "route", h`
      ${!tows.length ? empty("route", "No drives with a trailer yet. Set up a tow in the app before you drive.") : h`
        <div class="garage-stats">
          <div><b style="color:var(--m-distance)">${tows.length}</b><span>Towing drives</span></div>
          <div><b style="color:var(--m-distance)">${grouped(dist(tows.reduce((s, t) => s + t.miles, 0), units), 0)} ${L.dist}</b><span>Distance</span></div>
          <div><b style="color:var(--m-efficiency)">${eTow === null ? "—" : fixed(effUnits(eTow, units), 2)}</b><span>${L.eff} towing</span></div>
          <div><b style="color:var(--m-efficiency)">${eRest === null ? "—" : fixed(effUnits(eRest, units), 2)}</b><span>${L.eff} without a trailer</span></div>
        </div>
        <div class="garage-triplist">${towList}</div>`}
      <p class="note">Tow sessions and payload loads are kept on your phone.</p>`, { cls: "span-all" });

    render(panel, h`<div class="grid-cards">${trailersCard}${ratings}${towCard}</div>`);
  }

  // ── Charger ─────────────────────────────────────────────────────────────────────────────────
  function drawCharger() {
    let homeCard, sessionsCard;
    if (!allows(tier, "homeCharger")) {
      homeCard = card("Home charger", "ev_station", h`${lockNote("homeCharger")}<p class="note">Your home charger and what charging at home costs you.</p>`);
      sessionsCard = "";
    } else {
      const err = pieceError(g.home);
      const hm = err ? null : g.home;
      homeCard = card("Home charger", "ev_station", h`
        ${err ? failed("The home charger", err) : h`<dl class="kv">
          <dt>I charge at home</dt><dd>${hm.has ? "Yes" : "No"}</dd>
          <dt>Charger brand</dt><dd>${hm.brand || "—"}</dd>
          <dt>Charger model</dt><dd>${hm.model || "—"}</dd>
          <dt>Home rate</dt><dd>${acct.homeRate > 0 ? `${money(acct.homeRate, 3)}/kWh` : "Not set"}</dd>
        </dl>`}
        <p class="note">Change these in the app: Garage → Charger.</p>`);
      const home = vCharges.filter((c) => isHome(c) && !c.isSeed);
      const kwh = home.reduce((s, c) => s + c.totalKwh, 0);
      const cost = home.reduce((s, c) => s + c.total, 0);
      const kws = home.map((c) => c.chargerKw).filter((x) => x > 0).sort((a, b) => a - b);
      const median = kws.length ? (kws.length % 2 ? kws[(kws.length - 1) / 2] : (kws[kws.length / 2 - 1] + kws[kws.length / 2]) / 2) : null;
      sessionsCard = card("Home sessions", "electric_bolt", h`
        ${!home.length ? empty("electric_bolt", "No home charges logged for this vehicle yet.") : h`
          <div class="garage-stats">
            <div><b style="color:var(--m-distance)">${home.length}</b><span>Sessions</span></div>
            <div><b style="color:var(--m-charging)">${grouped(kwh, 0)} kWh</b><span>Charged</span></div>
            <div><b style="color:var(--m-cost)">${money(cost)}</b><span>Cost</span></div>
            <div><b style="color:var(--m-cost)">${kwh > 0 ? money(cost / kwh, 3) : "—"}</b><span>Avg $/kWh</span></div>
            <div><b style="color:var(--m-power)">${median === null ? "—" : `${fixed(median, 1)} kW`}</b><span>Typical power</span></div>
          </div>
          <p><a href="#/charge?kind=home&amp;range=all">See home charges →</a></p>`}`, { tag: "ALL TIME" });
    }
    const f = acct.fuel || {};
    const fuelCard = card("Fuel comparison", "savings", h`
      <dl class="kv">
        <dt>Comparison car</dt><dd>${f.label || "Your comparison car"}</dd>
        <dt>MPG</dt><dd>${f.mpg > 0 ? `${f.mpg} mpg` : "—"}</dd>
        <dt>Gas price now</dt><dd>${f.gasPrice > 0 ? `${money(f.gasPrice, 2)}/gal` : "—"}</dd>
      </dl>
      <p class="note">These drive "Saved" on <a href="#/financial">Financial</a>. Change them in the app: Garage → Charger.</p>`);
    const adapters = card("Adapters", "electric_bolt", h`<p class="note">Adapters are set on your phone.</p>`);
    render(panel, h`<div class="grid-cards">${homeCard}${sessionsCard}${fuelCard}${adapters}</div>`);
  }

  // ── Insights ────────────────────────────────────────────────────────────────────────────────
  function drawInsights() {
    render(panel, h`<div class="grid-cards">
      <section class="card garage-card garage-perf"></section>
      <section class="card garage-card garage-range"></section>
      <section class="card garage-card span-all">
        <div class="card-head"><h2 class="card-title">${raw(iconHtml("offline_bolt", { size: 18 }))}Your charging curve · DC</h2></div>
        <div class="garage-curve"></div>
      </section>
      <div class="span-all garage-charts"></div>
    </div>`);
    drawPerformance(panel.querySelector(".garage-perf"));
    const rangeEl = panel.querySelector(".garage-range");
    drawRange(rangeEl, null);
    const curveEl = panel.querySelector(".garage-curve");
    if (typeof chargesView.mountLearnedCurve === "function") {
      try { subs.push(chargesView.mountLearnedCurve(curveEl, { ...ctx, scope })); }
      catch (e) { render(curveEl, failed("The charging curve", e.message)); }
    } else {
      curveEl.closest(".card").remove();
    }
    const chartsEl = panel.querySelector(".garage-charts");
    if (typeof charts.mountCharts === "function") {
      try { subs.push(charts.mountCharts(chartsEl, { ...ctx, scope }, { ids: ["temp", "drain"], title: "Weather and parked use" })); }
      catch (e) { render(chartsEl, failed("The charts", e.message)); }
    } else {
      chartsEl.remove();
    }
    // The road-trip window's upper end and charge time come from the learned DC curve. As in the app
    // (InsightsScreen learns it for every plan), it is learned for anyone who sees Insights, from the
    // same cached reads; only the curve card itself is Max. Until then: 15→80 % and "—".
    if (allows(tier, "insights")) {
      const newest = vCharges.slice().sort((a, b) => b.date - a.date);
      learnDcCurve(newest, (from, to) => api.chargeCurve(vid, from, to))
        .then((ins) => { if (alive && tab === "insights" && rangeEl.isConnected) drawRange(rangeEl, ins, true); })
        .catch(() => { if (alive && tab === "insights" && rangeEl.isConnected) drawRange(rangeEl, null, true); });
    }
  }

  function drawPerformance(box) {
    const head = h`<div class="card-head"><h2 class="card-title">${raw(iconHtml("speed", { size: 18 }))}All-time performance</h2><span class="card-tag">ALL TIME</span></div>`;
    const state = api.boardStatsState(vid);
    if (state === "click") {
      render(box, h`${head}<button type="button" class="btn ghost garage-load">Show Board figures for this vehicle</button>
        <p class="note">As on your Board. The app reads these same figures.</p>`);
      box.querySelector(".garage-load").addEventListener("click", () => loadBoard(box, head, true));
      return;
    }
    loadBoard(box, head, false);
  }

  function loadBoard(box, head, explicit) {
    render(box, h`${head}${skeleton()}`);
    api.boardStats(vid, boardParams(ctx.now(), zone, acct.fuel, acct.towCap), { explicit }).then((reply) => {
      if (!alive || !box.isConnected) return;
      const m = boardModel(reply, units, tier);
      const items = [m.hero.find((x) => x.key === "avg_eff"), ...m.performance].filter(Boolean);
      render(box, h`${head}<div class="garage-board">${items.map((it) => h`<div class="garage-bitem">
          <span class="garage-bv" style="color:var(--m-${it.token})">${it.value}</span><span class="garage-bk">${it.label}</span></div>`)}</div>
        <p class="note">As on your Board. The app reads these same figures.</p>`);
    }).catch((err) => {
      if (!alive || !box.isConnected) return;
      render(box, h`${head}<div class="msg err">The Board figures did not load: ${err.message}</div>`);
    });
  }

  function drawRange(box, curveIns, curveDone = false) {
    const head = h`<div class="card-head"><h2 class="card-title">${raw(iconHtml("insights", { size: 18 }))}Your real range</h2></div>`;
    if (!allows(tier, "insights")) {
      render(box, h`${head}${lockNote("insights")}<p class="note">Your range from your own drives: by outside temperature, highway and local.</p>`);
      return;
    }
    const pack = vehicle.packKwhStored > 0 ? vehicle.packKwhStored : 131;
    const r = rangeInsight(own, pack);
    if (!r) { render(box, h`${head}${empty("insights", "Your real range appears after your first measured drive.")}`); return; }
    const win = roadTripWindow(curveIns);               // 15→80 until a curve is learned
    const tripMi = roadTripRangeMi(r, win);
    const chargeMin = optimumChargeMinutes(curveIns, r.pack, win.from, win.to);
    const maxEff = Math.max(0.01, ...r.byTemp.map((c) => c.eff));
    const distTxt = (mi) => `~${Math.trunc(dist(mi, units))} ${L.dist}`;
    render(box, h`${head}
      <p class="note">From your ${r.totalTrips} logged ${r.totalTrips === 1 ? "trip" : "trips"} — your EV, your driving, not a lab number.</p>
      <div class="garage-stats">
        <div><b style="color:var(--m-efficiency)">${fixed(effUnits(r.overall, units), 2)}</b><span>Overall ${L.eff}</span></div>
        <div><b style="color:var(--m-distance)">${distTxt(r.fullRangeMi)}</b><span>Full-charge range</span></div>
        ${r.hvacPenaltyPct !== null ? h`<div><b style="color:var(--m-climate)">−${fixed(r.hvacPenaltyPct, 0)}%</b><span>HVAC + weather</span></div>` : ""}
      </div>
      <div class="garage-sub-h">Optimum road-trip window</div>
      <div class="garage-stats">
        <div><b style="color:var(--m-distance)">${distTxt(tripMi)}</b><span>Range ${win.to}→${win.from}%</span></div>
        <div><b style="color:var(--m-charging)">${chargeMin === null ? "—" : `~${Math.trunc(chargeMin)} min`}</b><span>Charge ${win.from}→${win.to}%</span></div>
      </div>
      <p class="note">Drive ${distTxt(tripMi)} between fast-charge stops — ${chargeMin !== null
        ? `then add it back in about ${Math.trunc(chargeMin)} min (${win.from}→${win.to}%).`
        : curveDone ? "your fastest-refill time fills in after a few DC sessions." : "learning your charge time from your recent DC sessions…"}</p>
      ${r.byTemp.length ? h`<div class="garage-sub-h">By outside temperature</div>
        <ul class="garage-bands">${r.byTemp.map((c) => h`<li>
          <span class="garage-band-k">${tempBandLabel(c.key, units)}</span>
          <span class="garage-band-bar"><i style="width:${Math.max(5, Math.min(100, c.eff / maxEff * 100)).toFixed(1)}%"></i></span>
          <span class="garage-band-v">${fixed(effUnits(c.eff, units), 2)} · ${distTxt(c.eff * r.pack)}</span></li>`)}</ul>` : ""}
      ${r.highway || r.local ? h`<div class="garage-stats">
        ${r.highway ? h`<div><b style="color:var(--m-power)">${fixed(effUnits(r.highway.eff, units), 2)}</b><span>Highway ${L.eff} (${r.highway.trips})</span></div>` : ""}
        ${r.local ? h`<div><b style="color:var(--m-regen)">${fixed(effUnits(r.local.eff, units), 2)}</b><span>Local ${L.eff} (${r.local.trips})</span></div>` : ""}
      </div>` : ""}`);
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────────────────────
  function drawDiag() {
    const err = pieceError(g.dtc);
    if (err) { render(panel, h`<div class="grid-cards">${card("Scan history", "speed", failed("The scans", err))}</div>`); return; }
    const scans = g.dtc.filter((s) => s.vehicleId === vid);
    const body = !scans.length ? empty("speed", "No trouble-code scans yet. Run one from the app: Garage → Diag.")
      : h`<ul class="garage-scans">${scans.map((s) => {
        const n = s.count || s.codes.length;
        const headTxt = h`<span class="garage-scan-date">${dateFmt(s.scanMs, "MMM d, yyyy · h:mm a", zone)}</span>
          <span class="subtitle">${s.odo > 0 ? `${grouped(dist(s.odo, units), 0)} ${L.dist}` : ""}</span>
          ${n === 0 ? h`<span class="chip ok">No trouble codes</span>` : h`<span class="chip warn">${n} ${n === 1 ? "code" : "codes"}</span>`}`;
        return n === 0 || !s.codes.length ? h`<li class="garage-scan"><div class="garage-scan-head">${headTxt}</div></li>`
          : h`<li class="garage-scan"><details><summary class="garage-scan-head">${headTxt}</summary>
            <ul class="garage-codes">${s.codes.map((c) => h`<li><b>${c.code}</b>
              <span class="chip ${c.status === "confirmed" || c.status === "permanent" ? "err" : "warn"}">${c.status || "reported"}</span>
              <span class="garage-code-desc">${c.description}</span></li>`)}</ul></details></li>`;
      })}</ul>`;
    render(panel, h`<div class="grid-cards">${card("Scan history", "speed", body, { cls: "span-all" })}</div>`);
  }

  function wireCollapsibles(root) {
    for (const c of root.querySelectorAll(".card.collapsible")) {
      const head = c.querySelector(".card-head");
      const toggle = () => {
        const open = !c.classList.contains("open");
        c.classList.toggle("open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
        head.querySelector(".card-chev").innerHTML = iconHtml(open ? "expand_less" : "expand_more", { size: 20 });
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    }
  }

  draw();
  api.garage().then((res) => {
    if (!alive) return;
    g = res;
    if (tab !== "insights") draw();
  }).catch((e) => {
    if (!alive) return;
    g = { vehicles: { error: e.message }, tires: { error: e.message }, dtc: { error: e.message }, home: { error: e.message }, trailers: { error: e.message } };
    if (tab !== "insights") draw();
  });

  return {
    unmount() {
      alive = false;
      clearSubs();
      tabsEl.removeEventListener("click", onTab);
      tabsEl.removeEventListener("keydown", onTabKey);
    },
  };
}

/** The door-jamb card's rows, with the app's labels (the VIN is never among them). */
export function jambRows(j, units) {
  const pair = (a, b) => [a, b].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(" / ") || null;
  const press = [
    pressureText(j.tirePressureFrontPsi, j.tirePressureFrontKpa, units),
    pressureText(j.tirePressureRearPsi, j.tirePressureRearKpa, units),
    pressureText(j.tirePressureSparePsi, j.tirePressureSpareKpa, units),
  ];
  const seat = j.seatingTotal > 0
    ? (() => {
      const split = [j.seatingFront > 0 ? `${j.seatingFront}F` : null, j.seatingRear > 0 ? `${j.seatingRear}R` : null].filter(Boolean);
      return split.length ? `${j.seatingTotal} (${split.join("/")})` : String(j.seatingTotal);
    })() : null;
  return [
    ["Mfg date", j.mfgDate],
    ["GVWR", weightPair(j.gvwrKg, j.gvwrLbs, units)],
    ["GAWR Front", weightPair(j.gawrFrontKg, j.gawrFrontLbs, units)],
    ["GAWR Rear", weightPair(j.gawrRearKg, j.gawrRearLbs, units)],
    ["Tire F / R", pair(j.tireFront, j.tireRear)],
    ["Spare tire", j.tireSpare],
    ["Rim F / R", pair(j.rimFront, j.rimRear)],
    [`Cold pressure F / R / Sp`, press.some(Boolean) ? press.map((x) => x || "—").join(" / ") : null],
    ["Seating", seat],
    ["Max occupants+cargo", weightPair(j.combinedWeightKg, j.combinedWeightLbs, units)],
    ["Paint / Trim", [j.paintCode, j.trimCode].filter(Boolean).join(" / ") || null],
    ["Made in", j.madeIn],
  ];
}
