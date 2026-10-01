// TrueMile EV web | the Map section's Journeys tab (views/map_section.js mounts it): the scope's
// journeys, newest first. A journey's name is the name the phone wrote onto its drives
// (journey_category), else "Journey <id>". Journeys never cross vehicles. Cards open
// #/map/journey/<id>?v=<vehicle id>. Its own query keys: jq (name search) and year.

import { esc } from "../lib/dom.js";
import { fixed, money } from "../lib/format.js";
import { eff, labels } from "../lib/units.js";
import { inScope } from "../lib/rows.js";
import { allows, lockText } from "../lib/gates.js";
import { groupJourneys, rangeLabel, metaLabel, journeyYears, inYear } from "../lib/journeys.js";
import { icon } from "../lib/icons.js";
import { distText, vehicleNames } from "./trips.js";

export const BUILD = "2026-10-01.1";

/** A journey's detail route (the vehicle rides along: the same id can exist on two vehicles). */
export function journeyHref(j) {
  return `#/map/journey/${encodeURIComponent(j.id)}?v=${encodeURIComponent(j.vehicleId)}`;
}

export function journeyCardHtml(j, ctx, { costOk, vehicleName = "" }) {
  const u = ctx.units, L = labels(u);
  const cell = (v, k, c) => `<div class="trips-cell"><b style="color:${c}">${esc(v)}</b><span>${esc(k)}</span></div>`;
  return `<a class="panel card trips-jcard" href="${journeyHref(j)}">` +
    `<div class="trips-jname">${esc(j.name)}</div>` +
    `<div class="trips-jrange">${esc(rangeLabel(j, ctx.now(), ctx.tz))}` +
    (vehicleName ? ` · <span class="trips-veh">${esc(vehicleName)}</span>` : "") + `</div>` +
    `<div class="note">${esc(metaLabel(j, ctx.tz))}</div>` +
    `<div class="trips-cells">` +
    cell(distText(j.miles, u), "DIST", "var(--m-distance)") +
    cell(`${fixed(j.usedKwh, 1)} kWh`, "ENERGY", "var(--m-power)") +
    cell(costOk ? money(j.cost) : "🔒", "COST", "var(--m-cost)") +
    cell(j.miPerKwh > 0 ? fixed(eff(j.miPerKwh, u), 2) : "—", L.eff.toUpperCase(), "var(--m-efficiency)") +
    `</div></a>`;
}

/** mountJourneyList(el, ctx) → {destroy(), unmount()}. Max (journeys); below it the lock card. */
export function mountJourneyList(el, ctx) {
  if (!allows(ctx.tier, "journeys")) {
    el.innerHTML = `<div class="panel card trips-view"><p class="lock trips-lock">${icon("lock", { size: 18 })} Journeys: ${esc(lockText("journeys"))}</p>` +
      `<p class="note">A journey groups the drives of one trip away, with its route, charges and a printable report.</p></div>`;
    const none = () => {};
    return { destroy: none, unmount: none };
  }
  const zone = ctx.tz;
  const costOk = allows(ctx.tier, "costAnalytics");
  const names = vehicleNames(ctx);
  const showVeh = ctx.scope.id === "all";
  const all = groupJourneys(ctx.account.trips.filter((t) => inScope(t, ctx.scope)));
  const years = journeyYears(all, zone);
  const q = ctx.query || {};
  const st = { q: typeof q.jq === "string" ? q.jq : "", year: Number(q.year || 0) || 0 };
  if (st.year && !years.includes(st.year)) st.year = 0;

  el.innerHTML = `<div class="trips-view">` +
    `<div class="trips-filters">` +
    `<label class="trips-searchbox">${icon("search", { size: 18 })}` +
    `<input class="trips-search trips-jsearch" type="search" placeholder="Search journey names" aria-label="Search journeys" value="${esc(st.q)}"></label>` +
    `<select class="trips-year" aria-label="Year"><option value="">All years</option>` +
    years.map((y) => `<option value="${y}"${y === st.year ? " selected" : ""}>${y}</option>`).join("") + `</select>` +
    `</div><div class="trips-jlist" aria-live="polite"></div></div>`;
  const listEl = el.querySelector(".trips-jlist");

  function render() {
    const needle = st.q.trim().toLowerCase();
    const rows = all.filter((j) => (!needle || j.name.toLowerCase().includes(needle)) && (!st.year || inYear(j, st.year, zone)));
    if (!all.length) {
      listEl.innerHTML = `<p class="empty">No journeys yet. A journey groups the drives of one trip away; you start one in the app.</p>`;
      return;
    }
    listEl.innerHTML = rows.length
      ? `<p class="trips-head">Journeys (${rows.length})</p><div class="trips-jgrid">` +
        rows.map((j) => journeyCardHtml(j, ctx, { costOk, vehicleName: showVeh ? names.get(j.vehicleId) || "" : "" })).join("") + `</div>`
      : `<p class="empty">No journeys match.</p>`;
  }

  let timer = 0;
  const commit = () => ctx.setQuery({ jq: st.q, year: st.year ? String(st.year) : "" });
  const onInput = (ev) => {
    if (!ev.target.classList.contains("trips-jsearch")) return;
    clearTimeout(timer);
    timer = setTimeout(() => { st.q = ev.target.value; commit(); render(); }, 200);
  };
  const onChange = (ev) => {
    if (!ev.target.classList.contains("trips-year")) return;
    st.year = Number(ev.target.value) || 0;
    commit(); render();
  };
  el.addEventListener("input", onInput);
  el.addEventListener("change", onChange);
  render();
  const destroy = () => {
    clearTimeout(timer);
    el.removeEventListener("input", onInput);
    el.removeEventListener("change", onChange);
  };
  return { destroy, unmount: destroy };
}
