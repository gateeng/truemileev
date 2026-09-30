// TrueMile EV web: the embeddable chart block. mountCharts(el, ctx, {ids, title}) draws one card with
// the charts named in [ids] (Financial: money + cost, Map: efficiency + distance + energy, Garage:
// temp + drain), built from the same rows and formulas as the tiles. Every bucket is a tile period
// (series.buckets = periodWindow(bucket, now, −k)), so each point equals the tile for that period and
// offset. Hand-built SVG (lib/svgchart.js); "Show numbers" lists the values. Its state rides in the
// section's query: chart, bucket, n and ctypes (its own trip-type choice, kept apart from the Map
// section's types). Gate: charts (Pro); the two money charts also need costAnalytics.
import { esc } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { allows, lockText } from "../lib/gates.js";
import { inScope, typeKey, typeOptions, vehicleLabel } from "../lib/rows.js";
import { tileAggregate } from "../lib/metrics.js";
import { dist, eff, perDist, temp, labels } from "../lib/units.js";
import { fixed, money } from "../lib/format.js";
import { lineChart, barChart, scatter } from "../lib/svgchart.js";
import {
  buckets, bucketAggs, tempBins, drainPoints, cumulative, clampN, BUCKETS, BUCKET_LABELS, DEFAULT_N, MAX_N,
} from "../lib/series.js";
import { mountTypeFilter } from "./typefilter.js";

export const BUILD = "2026-09-30.2";

export const CHARTS = [
  { id: "efficiency", label: "Efficiency" },
  { id: "cost", label: "Cost per distance", gate: "costAnalytics" },
  { id: "energy", label: "Energy" },
  { id: "money", label: "Money", gate: "costAnalytics" },
  { id: "distance", label: "Distance" },
  { id: "temp", label: "Efficiency by outside temperature" },
  { id: "drain", label: "Parked drain vs temperature" },
];
const PATTERN = { day: "MMM d", week: "MMM d", month: "MMM yyyy", year: "yyyy" };
const UNIT_WORD = { day: "days", week: "weeks", month: "months", year: "years" };

function readState(q, ids) {
  const chart = ids.includes(q.chart) ? q.chart : ids[0];
  const bucket = BUCKETS.includes(q.bucket) ? q.bucket : "month";
  const n = q.n ? clampN(bucket, q.n) : DEFAULT_N[bucket];
  const types = new Set(String(q.ctypes || "").split(",").map((s) => s.trim()).filter(Boolean));
  return { chart, bucket, n, types, numbers: false };
}

/**
 * mountCharts(el, ctx, {ids, title}) → {destroy()}. [ids] = the CHARTS ids to offer (the first is the
 * default); [title] = the card title. The scope is the header vehicle (ctx.scope).
 */
export function mountCharts(el, ctx, { ids = ["efficiency"], title = "Charts" } = {}) {
  const zone = ctx.tz, units = ctx.units, L = labels(units);
  const tier = ctx.tier;
  const offered = CHARTS.filter((c) => ids.includes(c.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const offeredIds = offered.length ? offered.map((c) => c.id) : ["efficiency"];
  const st = readState(ctx.query || {}, offeredIds);
  const all = ctx.scope.all || ctx.account.vehicles;
  const head = `<div class="card-head"><h3 class="card-title">${esc(title)}</h3></div>`;

  if (!allows(tier, "charts")) {
    el.innerHTML = `<div class="card charts-card">${head}` +
      `<p class="note lock">${icon("lock", { size: 16 })} ${esc(lockText("charts"))}</p>` +
      `<p class="note">Charts by day, week, month or year.</p></div>`;
    return { destroy() { el.innerHTML = ""; } };
  }
  const typesOk = allows(tier, "tripTypes");
  if (!typesOk) st.types = new Set();

  const scopeTrips = ctx.account.trips.filter((t) => inScope(t, ctx.scope));
  const ownTrips = scopeTrips.filter((t) => t.carStatus === "");
  const scopeCharges = ctx.account.charges.filter((c) => inScope(c, ctx.scope));
  const scopeParked = (ctx.account.parked || []).filter((p) => inScope(p, ctx.scope));
  const scopeCaption = ctx.scope.id === "all"
    ? `${(ctx.scope.vehicles || []).length} vehicles combined · rates recalculated across them`
    : `${vehicleLabel((ctx.scope.vehicles || [])[0] || all.find((v) => v.id === ctx.scope.id) || {}, all, zone)} only`;

  el.innerHTML =
    `<div class="card charts-card">` + head +
    (offered.length > 1
      ? `<div class="charts-chips" role="group" aria-label="Chart">` +
        offered.map((c) => `<button type="button" class="chip" data-chart="${c.id}">${esc(c.label)}${c.gate && !allows(tier, c.gate) ? " " + icon("lock", { size: 14 }) : ""}</button>`).join("") +
        `</div>`
      : "") +
    `<div class="charts-controls">` +
    `<div class="seg charts-bucket" role="group" aria-label="Period">` +
    BUCKETS.map((b) => `<button type="button" data-bucket="${b}">${BUCKET_LABELS[b]}</button>`).join("") +
    `</div>` +
    `<label class="charts-field charts-n"><span>Periods</span><input type="number" inputmode="numeric" min="1" class="charts-n-input" aria-label="Number of periods"></label>` +
    `<div class="charts-type"></div>` +
    `</div>` +
    `<p class="note charts-scope">${esc(scopeCaption)}</p>` +
    `<div class="charts-panel">` +
    `<h4 class="charts-title"></h4><p class="note charts-sub"></p>` +
    `<div class="charts-svg" aria-live="polite"></div>` +
    `<div class="charts-foot"><button type="button" class="charts-numbers-btn" aria-expanded="false">Show numbers</button></div>` +
    `<div class="charts-table scroll hide"></div>` +
    `</div>` +
    `</div>`;

  const $ = (s) => el.querySelector(s);
  const nIn = $(".charts-n-input");
  const svgEl = $(".charts-svg");
  const tableEl = $(".charts-table");
  const numBtn = $(".charts-numbers-btn");

  function commit() {
    ctx.setQuery({
      chart: st.chart === offeredIds[0] ? "" : st.chart,
      bucket: st.bucket === "month" ? "" : st.bucket,
      n: st.n === DEFAULT_N[st.bucket] ? "" : String(st.n),
      ctypes: [...st.types].sort().join(","),
    });
  }

  function drawControls() {
    for (const b of el.querySelectorAll("[data-chart]")) {
      const on = b.dataset.chart === st.chart;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const b of el.querySelectorAll("[data-bucket]")) {
      const on = b.dataset.bucket === st.bucket;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    nIn.max = String(MAX_N[st.bucket]);
    nIn.value = String(st.n);
  }

  // Mounted once: the types do not change with the bucket, and a second instance on the same element
  // would fight the first (its stale state closes the menu on every tick).
  const typeCtl = mountTypeFilter($(".charts-type"), { options: typeOptions(scopeTrips), selected: new Set(st.types), locked: !typesOk }, (set) => {
    st.types = new Set(set || []);
    commit(); draw();
  });

  const chips = el.querySelector(".charts-chips");
  if (chips) chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chart]");
    if (!b || b.dataset.chart === st.chart) return;
    st.chart = b.dataset.chart;
    commit(); drawControls(); draw();
  });
  el.querySelector(".charts-bucket").addEventListener("click", (e) => {
    const b = e.target.closest("[data-bucket]");
    if (!b || b.dataset.bucket === st.bucket) return;
    st.bucket = b.dataset.bucket;
    st.n = DEFAULT_N[st.bucket];
    commit(); drawControls(); draw();
  });
  nIn.addEventListener("change", () => {
    st.n = clampN(st.bucket, nIn.value);
    nIn.value = String(st.n);
    commit(); draw();
  });
  numBtn.addEventListener("click", () => {
    st.numbers = !st.numbers;
    tableEl.classList.toggle("hide", !st.numbers);
    numBtn.textContent = st.numbers ? "Hide numbers" : "Show numbers";
    numBtn.setAttribute("aria-expanded", st.numbers ? "true" : "false");
  });

  function chartWidth() {
    const w = Math.floor(svgEl.clientWidth || el.clientWidth || 640);
    return Math.max(300, Math.min(1060, w));
  }

  function table(head, rows) {
    return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
      rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
      `</tbody></table>`;
  }

  function draw() {
    const now = ctx.now();
    const bs = buckets(st.bucket, st.n, now, zone);
    const tileTrips = st.types.size ? ownTrips.filter((t) => st.types.has(typeKey(t))) : ownTrips;
    const aggs = bucketAggs(bs, tileTrips, scopeCharges);
    const span = { start: bs[0].start, end: bs[bs.length - 1].end };
    const inSpan = (d) => d >= span.start && d <= span.end;
    const x = { label: "", values: bs.map((b) => b.start), kind: "time", zone, pattern: PATTERN[st.bucket] };
    const cats = bs.map((b) => b.label);
    const W = chartWidth(), H = Math.round(Math.min(360, Math.max(240, W * 0.5)));
    const spanText = `${st.n} ${st.n === 1 ? BUCKET_LABELS[st.bucket].toLowerCase() : UNIT_WORD[st.bucket]}, ${bs[0].long} to ${bs[bs.length - 1].long}`;
    const def = CHARTS.find((c) => c.id === st.chart);
    $(".charts-title").textContent = def.label;
    const sub = $(".charts-sub");
    let svg = "", head = [], rows = [], subText = "";

    if (def.gate && !allows(tier, def.gate)) {
      svgEl.innerHTML = `<p class="note lock">${icon("lock", { size: 16 })} ${esc(lockText(def.gate))}</p>`;
      sub.textContent = "";
      tableEl.innerHTML = "";
      numBtn.hidden = true;
      return;
    }
    numBtn.hidden = false;

    switch (st.chart) {
      case "efficiency": {
        const vals = aggs.map((a) => (a.avgMiKwh > 0 ? eff(a.avgMiKwh, units) : null));
        const pooledAgg = tileAggregate(tileTrips.filter((t) => inSpan(t.date)), []);
        const pooled = pooledAgg.avgMiKwh > 0 ? eff(pooledAgg.avgMiKwh, units) : null;
        const series = [{ label: L.eff, values: vals, color: "var(--m-efficiency)", axis: "left", unit: L.eff, decimals: 2 }];
        if (pooled != null) series.push({ label: `Whole span ${fixed(pooled, 2)}`, values: vals.map(() => pooled), color: "var(--muted)", axis: "left", unit: L.eff, dashed: true, decimals: 2 });
        svg = lineChart({ title: `Efficiency, ${L.eff}, per ${st.bucket}`, width: W, height: H, x, series });
        subText = `Distance per kWh, net of regen, over measured drives. ${spanText}.`;
        head = ["Period", L.eff, `Distance (${L.dist})`, "Trips"];
        rows = bs.map((b, i) => [b.long, vals[i] == null ? "—" : fixed(vals[i], 2), fixed(dist(aggs[i].totalMiles, units), 1), String(aggs[i].tripCount)]);
        if (pooled != null) rows.push(["Whole span", fixed(pooled, 2), fixed(dist(pooledAgg.totalMiles, units), 1), String(pooledAgg.tripCount)]);
        break;
      }
      case "cost": {
        const vals = aggs.map((a) => (a.totalMiles > 0 ? perDist(a.totalCost / a.totalMiles, units) : null));
        svg = lineChart({ title: `Avg ${L.perDist} per ${st.bucket}`, width: W, height: H, x,
          series: [{ label: `Avg ${L.perDist}`, values: vals, color: "var(--m-cost)", axis: "left", unit: L.perDist, decimals: 3 }] });
        subText = `What a ${L.dist === "km" ? "kilometre" : "mile"} of driving averaged. ${spanText}.`;
        head = ["Period", `Avg ${L.perDist}`, "Trip Cost", `Distance (${L.dist})`];
        rows = bs.map((b, i) => [b.long, vals[i] == null ? "—" : money(vals[i], 3), money(aggs[i].totalCost), fixed(dist(aggs[i].totalMiles, units), 1)]);
        break;
      }
      case "energy": {
        const used = aggs.map((a) => a.totalKwhUsed);
        const charged = aggs.map((a) => a.totalChgKwh);
        const received = aggs.map((a) => (a.receivedKwh > 0 ? a.receivedKwh : null));
        const series = [
          { label: "Used", values: used, color: "var(--m-power)" },
          { label: "Charged", values: charged, color: "var(--m-charging)" },
        ];
        const anyRec = received.some((v) => v != null);
        if (anyRec) series.push({ label: "Received", values: received, color: "var(--green)" });
        svg = barChart({ title: `Energy per ${st.bucket}, kWh`, width: W, height: H, categories: cats, series, unit: "kWh", decimals: 1 });
        subText = `Used = what the drives consumed. Charged = what the stations delivered.${anyRec ? " Received = what the battery measured taking in." : ""} ${spanText}.`;
        head = ["Period", "Used kWh", "Charged kWh", "Received kWh"];
        rows = bs.map((b, i) => [b.long, fixed(used[i], 1), fixed(charged[i], 1), received[i] == null ? "—" : fixed(received[i], 1)]);
        break;
      }
      case "money": {
        const tc = aggs.map((a) => a.totalCost), cc = aggs.map((a) => a.totalChgCost);
        const ct = cumulative(tc), cq = cumulative(cc);
        svg = barChart({ title: `Trip Cost and Charge Cost per ${st.bucket}`, width: W, height: H, categories: cats, unit: "$", decimals: 2,
          series: [{ label: "Trip Cost", values: tc, color: "var(--m-cost)" }, { label: "Charge Cost", values: cc, color: "var(--amber)" }],
          lines: [
            { label: "Trip Cost, running", values: ct, color: "var(--m-cost)", unit: "$", dashed: true, decimals: 2 },
            { label: "Charge Cost, running", values: cq, color: "var(--amber)", unit: "$", dashed: true, decimals: 2 },
          ] });
        subText = `Trip Cost is what the drives used; Charge Cost is what charging cost. They are separate figures and are never added together. Running totals on the right axis. ${spanText}.`;
        head = ["Period", "Trip Cost", "Charge Cost", "Trip Cost, running", "Charge Cost, running"];
        rows = bs.map((b, i) => [b.long, money(tc[i]), money(cc[i]), money(ct[i]), money(cq[i])]);
        break;
      }
      case "distance": {
        const d = aggs.map((a) => dist(a.totalMiles, units));
        const n = aggs.map((a) => a.tripCount);
        svg = barChart({ title: `Distance per ${st.bucket}, ${L.dist}`, width: W, height: H, categories: cats, unit: L.dist, decimals: 1,
          series: [{ label: "Distance", values: d, color: "var(--m-distance)" }],
          lines: [{ label: "Trips", values: n, color: "var(--cyan)", unit: "trips", decimals: 0 }] });
        subText = `Distance driven (bars) and the number of drives (line, right axis). ${spanText}.`;
        head = ["Period", `Distance (${L.dist})`, "Trips"];
        rows = bs.map((b, i) => [b.long, fixed(d[i], 1), String(n[i])]);
        break;
      }
      case "temp": {
        const bins = tempBins(tileTrips.filter((t) => inSpan(t.date)), units);
        const vals = bins.map((b) => eff(b.miPerKwh, units));
        svg = barChart({ title: `Efficiency by outside temperature, ${L.eff}`, width: W, height: H, unit: L.eff, decimals: 2,
          categories: bins.map((b) => `${b.lo}–${b.hi}${L.temp}`),
          series: [{ label: L.eff, values: vals, color: "var(--m-efficiency)",
            tips: bins.map((b, i) => `${b.label}: ${fixed(vals[i], 2)} ${L.eff} over ${b.count} drives`) }] });
        subText = `Measured drives with an outside temperature, pooled per ${units === "metric" ? "5 °C" : "10 °F"} band (bands with fewer than 3 drives are left out). ${spanText}.`;
        head = ["Outside temperature", L.eff, "Drives", `Distance (${L.dist})`];
        rows = bins.map((b, i) => [b.label, fixed(vals[i], 2), String(b.count), fixed(dist(b.miles, units), 1)]);
        break;
      }
      case "drain": {
        const pts = drainPoints(scopeParked.filter((p) => inSpan(p.epoch)));
        svg = scatter({ title: `Parked drain, kWh per hour, by outside temperature`, width: W, height: H, color: "var(--amber)",
          xLabel: `Outside ${L.temp}`, yLabel: "kWh per hour",
          points: pts.map((p) => ({ x: temp(p.ambientF, units), y: p.kwhPerHour,
            tip: `${fixed(temp(p.ambientF, units), 0)}${L.temp} · ${fixed(p.kwhPerHour, 3)} kWh per hour over ${fixed(p.parkHours, 1)} h` })) });
        subText = `Each dot is one parked stretch: the battery energy lost per hour while parked, against the outside temperature. ${spanText}.`;
        head = [`Outside ${L.temp}`, "kWh per hour", "Parked hours", "kWh"];
        rows = pts.slice().sort((a, b) => a.ambientF - b.ambientF)
          .map((p) => [fixed(temp(p.ambientF, units), 1), fixed(p.kwhPerHour, 3), fixed(p.parkHours, 1), fixed(p.kwh, 2)]);
        break;
      }
    }
    sub.textContent = subText;
    svgEl.innerHTML = svg;
    tableEl.innerHTML = rows.length ? table(head, rows) : `<p class="note">Nothing to list.</p>`;
  }

  let rt = null, lastW = 0;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => { const w = chartWidth(); if (Math.abs(w - lastW) > 24) { lastW = w; draw(); } }, 150);
  };
  window.addEventListener("resize", onResize);

  drawControls();
  draw();
  lastW = chartWidth();
  return {
    destroy() {
      window.removeEventListener("resize", onResize);
      clearTimeout(rt);
      try { typeCtl.destroy(); } catch (_) { /* already gone */ }
      el.innerHTML = "";
    },
  };
}
