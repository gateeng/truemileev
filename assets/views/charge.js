// TrueMile EV web | #/charge/<id>: one charge session in ChargeScreen's detail order, its charging
// curve (matched to the session by TIME window, never by session id) and a small screen-only map of
// where it happened (never printed; Home only when the viewer turned Home pins on). Read-only: none of
// the app's edit, merge or confirm actions exist here.

import { esc } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import * as api from "../lib/api.js";
import { lineChart } from "../lib/svgchart.js";
import { fixed, money, hm, dateFmt } from "../lib/format.js";
import { dist, temp, labels } from "../lib/units.js";
import { allows, lockText } from "../lib/gates.js";
import { mergeNote, parseGps } from "../lib/stops.js";
import { curveWindow, dedupe, sessionSeries } from "../lib/curve.js";
import { vehicleLabel, isHome } from "../lib/rows.js";
import { pointFeatures } from "../lib/mapdata.js";
import { unconfirmedChip, backToChargesHref, homePinsOn } from "./charges.js";
import { mountMap } from "./mapview.js";

export const BUILD = "2026-09-27.3";

const UNCONFIRMED_TEXT = "Start mileage or arrival charge was left as suggested and never confirmed. It counts in totals, not in averages.";

function stat(label, value, color) {
  return `<div class="charges-stat"><b style="color:${color}">${esc(value)}</b><span>${esc(label)}</span></div>`;
}

/** The six plottable series (ChargeMetric); temperature converts to °C in metric. */
function metrics(units) {
  return [
    { key: "duration", label: "Duration", unit: "min", color: "var(--muted)", get: (s) => s.duration },
    { key: "rate", label: "Rate", unit: "kW", color: "var(--m-charging)", get: (s) => s.rateKw },
    { key: "received", label: "Received", unit: "kWh", color: "var(--green)", get: (s) => s.receivedKwh },
    { key: "soc", label: "SoC", unit: "%", color: "var(--amber)", get: (s) => s.socPct },
    { key: "battery", label: "In Battery", unit: "kWh", color: "var(--red)", get: (s) => s.inBatteryKwh },
    { key: "temp", label: "Batt Temp", unit: labels(units).temp, color: "var(--blue, #2e9be6)",
      get: (s) => s.battTempF.map((v) => (v === null ? null : temp(v, units))) },
  ];
}

/** Axis plan: the first unit on the left, a second distinct unit on the right, never a third. */
export function planAxes(selected, ms) {
  const units = [];
  const out = [];
  for (const k of selected) {
    const m = ms.find((x) => x.key === k);
    if (!m) continue;
    let i = units.indexOf(m.unit);
    if (i < 0) { if (units.length >= 2) continue; units.push(m.unit); i = units.length - 1; }
    out.push({ m, axis: i === 0 ? "left" : "right" });
  }
  return { units, series: out };
}

function curveHtml(series, st, units) {
  const ms = metrics(units);
  const xm = ms.find((m) => m.key === st.x) || ms[3];
  const plan = planAxes(st.y.filter((k) => k !== xm.key), ms);
  const selUnits = plan.units;
  let html = `<div class="charges-curve-ctl"><label class="charges-inline">X <select class="charges-x" aria-label="X axis">` +
    ms.map((m) => `<option value="${m.key}"${m.key === xm.key ? " selected" : ""}>${esc(m.label)}</option>`).join("") +
    `</select></label><span class="charges-ys" role="group" aria-label="Y series">` +
    ms.map((m) => {
      const checked = st.y.includes(m.key) && m.key !== xm.key;
      const full = !checked && (st.y.filter((k) => k !== xm.key).length >= 3 || (selUnits.length >= 2 && !selUnits.includes(m.unit)));
      const dis = m.key === xm.key || full;
      return `<label class="charges-check"><input type="checkbox" data-y="${m.key}"${checked ? " checked" : ""}${dis ? " disabled" : ""}> ` +
        `<span style="color:${m.color}">■</span> ${esc(m.label)}</label>`;
    }).join("") + `</span></div>`;
  if (!plan.series.length) return html + `<p class="note">Pick a series to plot.</p>`;
  const xv = xm.get(series);
  html += lineChart({
    width: 640, height: 280, title: "Charging curve",
    x: { label: xm.unit ? `${xm.label} (${xm.unit})` : xm.label, values: xv, kind: "number" },
    series: plan.series.map(({ m, axis }) => ({ label: m.label, values: m.get(series), color: m.color, axis, unit: m.unit })),
  });
  return html;
}

export function mount(el, ctx) {
  const id = decodeURIComponent((ctx.path && ctx.path[1]) || "");
  const acc = ctx.account;
  const c = acc.charges.find((x) => x.id === id);
  const back = backToChargesHref();
  if (!c) {
    el.innerHTML = `<section class="charges-view"><p class="charges-back"><a href="${esc(back)}">${icon("chevron_left", { size: 18 })} Charge</a></p>` +
      `<p class="msg info">This charge session is not in your account any more. It may have been merged with another session on the phone.</p></section>`;
    return {};
  }
  const u = ctx.units, L = labels(u), zone = ctx.tz;
  const vehicle = acc.vehicles.find((v) => v.id === c.vehicleId) || null;
  const pack = vehicle && vehicle.packKwh > 0 ? vehicle.packKwh : 131;
  const allV = (ctx.scope && ctx.scope.all) || acc.vehicles || [];
  const names = new Map(allV.map((v) => [v.id, vehicleLabel(v, allV, zone)]));
  const cG = "var(--m-charging)", cC = "var(--m-cost)", cD = "var(--m-distance)";
  const odo = (mi) => `${fixed(dist(mi, u), 1)} ${L.dist}`;

  const rows = [];
  rows.push([stat("DELIVERED", `${fixed(c.totalKwh, 2)} kWh`, cG), stat("COST", money(c.total), cC), stat("DURATION", hm(c.timeMin), cD)]);
  if (c.receivedKwh > 0) {
    const r = [stat("RECEIVED", `${fixed(c.receivedKwh, 2)} kWh`, cG), stat("DIFFERENCE", `${fixed(c.totalKwh - c.receivedKwh, 2)} kWh`, cC)];
    if (c.totalKwh > 0) r.push(stat("EFFICIENCY", `${fixed(c.receivedKwh / c.totalKwh * 100, 1)}%`, cD));
    rows.push(r);
  } else rows.push([stat("RECEIVED", "--", "var(--muted)")]);
  rows.push([stat("RATE", `${money(c.ratePerKwh, 3)}/kWh`, cC), stat("ARRIVAL SoC", `${Math.trunc(c.arrPct)}%`, cG),
    stat("DEPARTURE SoC", `${Math.trunc(c.depPct)}%`, cG)]);
  rows.push([stat("ODO START", odo(c.startMileage), cD), stat("ODO END", odo(c.endMileage), cD),
    stat("DRIVEN SINCE", odo(c.endMileage - c.startMileage), cD)]);
  // The fee row exists only with a session fee; the hourly rate rides inside it (CS:4503-4509).
  if (c.fee > 0) {
    const fees = [stat("SESSION FEE", money(c.fee), cC)];
    if (c.ratePerHour > 0) fees.push(stat("HOURLY RATE", `${money(c.ratePerHour)}/hr`, cC));
    rows.push(fees);
  }
  rows.push([stat("GAS $/GAL", c.gasPrice > 0 ? money(c.gasPrice) : "—", cC)]);
  const visible = acc.charges.filter((o) => o.vehicleId === c.vehicleId);
  const merge = mergeNote(c, visible);
  const chargerLbl = c.chargerType === "DC" ? "DC fast" : c.chargerType === "AC" ? "AC" : "Charger";
  const charger = c.chargerType || c.chargerKw > 0
    ? stat("CHARGER", chargerLbl + (c.chargerKw > 0 ? ` · ${fixed(c.chargerKw, 0)} kW` : ""), cG) : "";
  const curveOk = allows(ctx.tier, "chargeCurve");
  const g = parseGps(c.gps);
  const hasSpot = !!g && !(g.lat === 0 && g.lng === 0) && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180;
  const showSpot = hasSpot && (!isHome(c) || homePinsOn());

  el.innerHTML = `<section class="charges-view charges-detail">` +
    `<p class="charges-back"><a href="${esc(back)}">${icon("chevron_left", { size: 18 })} Charge</a></p>` +
    `<header class="charges-detail-head"><h2>${esc(dateFmt(c.date, "MM/dd/yy  HH:mm", zone))}</h2>` +
    (c.network.trim() ? `<div class="charges-sub">${esc(c.network)}</div>` : "") +
    (ctx.scope.id === "all" ? `<div class="note">${esc(names.get(c.vehicleId) || "")}</div>` : "") +
    (c.edited > 0 ? `<div class="note">✎ Edited ${esc(dateFmt(c.edited, "MM/dd/yy HH:mm", zone))}</div>` : "") +
    (c.lowConfidence ? `<div>${unconfirmedChip()}</div>` : "") + `</header>` +
    `<div class="card charges-card">` +
    rows.map((r) => `<div class="charges-statrow">${r.join("")}</div>`).join("") +
    (merge ? `<p class="note charges-merge">${esc(merge)}</p>` : "") +
    (charger ? `<div class="charges-statrow">${charger}</div>` : "") +
    (c.notes.trim() ? `<div class="charges-notes"><span class="charges-k">NOTES</span><p>${esc(c.notes)}</p></div>` : "") +
    (c.lowConfidence ? `<p class="note">${esc(UNCONFIRMED_TEXT)}</p>` : "") +
    (hasSpot ? "" : `<p class="note charges-small">No location recorded</p>`) +
    `<p class="note charges-small">${icon("edit", { size: 14 })} Edit this session in the app.</p>` +
    `</div>` +
    `<div class="card charges-card"><div class="card-head"><h3 class="card-title">Charging curve</h3></div><div class="charges-session-curve">` +
    (curveOk ? `<p class="note">Loading charging curve…</p>` : `<p class="note lock">${icon("lock", { size: 16 })} ${esc(lockText("chargeCurve"))}</p>`) +
    `</div></div>` +
    (hasSpot ? `<div class="card charges-card charges-where"><div class="card-head"><h3 class="card-title">Location</h3></div>` +
      (showSpot ? `<div class="charges-spot"></div>`
        : `<p class="note">Home is hidden on maps. Turn on "Show home on the map" on the Charge page or in Settings to see it.</p>`) +
      `</div>` : "") +
    `</section>`;

  let alive = true;
  let spot = null;
  if (showSpot) {
    const box = el.querySelector(".charges-spot");
    const p = { lat: g.lat, lng: g.lng };
    mountMap(box, { kind: "pin", height: 220, interactive: false, ariaLabel: "Where this session happened", noTiles: ctx.noTiles })
      .then((hd) => {
        if (!hd) return;
        if (!alive) { hd.destroy(); return; }
        spot = hd;
        // About zoom 14: ±0.012° of longitude and ±0.008° of latitude around the pin.
        hd.setData({
          points: pointFeatures([{ lat: p.lat, lng: p.lng, id: c.id, n: 1, home: isHome(c) }]),
          fit: [[p.lng - 0.012, p.lat - 0.008], [p.lng + 0.012, p.lat + 0.008]],
        });
      })
      .catch(() => { if (alive) box.innerHTML = `<p class="note">The map can't be shown in this browser.</p>`; });
  }
  const stopSpot = () => { alive = false; try { spot && spot.destroy(); } catch (_) { /* already gone */ } };
  if (!curveOk) return { unmount: stopSpot };
  const box = el.querySelector(".charges-session-curve");
  const st = { x: "soc", y: ["rate"] };
  let series = null;
  const draw = () => { box.innerHTML = curveHtml(series, st, u); };
  const w = curveWindow(c);
  api.chargeCurve(c.vehicleId, w.from, w.to).then((pts) => {
    if (!alive) return;
    const clean = dedupe(pts || []);
    if (clean.length < 2) { box.innerHTML = `<p class="note">No charging-curve data for this session</p>`; return; }
    series = sessionSeries(clean, pack);
    draw();
  }).catch((err) => {
    if (alive) box.innerHTML = `<p class="msg err">${esc(String((err && err.message) || err))}</p>`;
  });
  const onChange = (ev) => {
    if (!series) return;
    if (ev.target.classList.contains("charges-x")) {
      st.x = ev.target.value;
      st.y = st.y.filter((k) => k !== st.x);
      draw();
    } else if (ev.target.dataset && ev.target.dataset.y) {
      const k = ev.target.dataset.y;
      st.y = ev.target.checked ? [...st.y.filter((x) => x !== k), k] : st.y.filter((x) => x !== k);
      draw();
    }
  };
  box.addEventListener("change", onChange);
  return { unmount() { stopSpot(); box.removeEventListener("change", onChange); } };
}
