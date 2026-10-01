// TrueMile EV web: #/settings, sectioned like the app's six-section Settings sheet:
//   Vehicle · Units & theme · Dashboard defaults · From the app (read-only) · Data · About.
// Everything set here is per browser (localStorage "tm.*", through dom.store) and never changes the
// app or the cloud. Units, theme and vehicle go through the shell (ctx.setUnits / setTheme /
// setVehicle), which re-mounts the page with the new choice.

import { h, render, raw, store, openDialog, iconHtml } from "../lib/dom.js";
import { vehicleLabel } from "../lib/rows.js";
import { money } from "../lib/format.js";
import { LABELS as RANGE_LABELS, DEFAULT_RANGE } from "../lib/periods.js";
import { currentPref } from "../lib/theme.js";
import * as api from "../lib/api.js";

export const BUILD = "2026-10-01.1";

/** The periods a section may open on (Custom needs dates, so it is not a default). */
export const DEFAULT_RANGES = ["day", "week", "month", "year", "ytd", "all"];

const row = (icon, title, sub, control, cls = "") => h`
  <div class="settings-row ${cls}">
    <span class="settings-ico">${raw(iconHtml(icon, { size: 22 }))}</span>
    <div class="settings-text"><div class="settings-title">${title}</div>${sub ? h`<div class="settings-sub">${sub}</div>` : ""}</div>
    ${control ? h`<div class="settings-ctl">${control}</div>` : ""}
  </div>`;

/** A radio row of buttons; each carries data-pick="<group>:<value>". */
const segBtns = (name, group, items, value) => h`<div class="seg settings-seg" role="radiogroup" aria-label="${name}">
  ${items.map(([v, label]) => h`<button type="button" role="radio" data-pick="${group}:${v}" aria-checked="${v === value ? "true" : "false"}">${label}</button>`)}
</div>`;

function confirmBox(title, text, okText, onOk) {
  const body = document.createElement("div");
  body.className = "settings-confirm";
  render(body, h`<p>${text}</p><div class="settings-confirm-btns"><button type="button" class="btn ghost" data-no>Cancel</button><button type="button" class="btn primary" data-yes>${okText}</button></div>`);
  const close = openDialog({ title, bodyEl: body });
  body.querySelector("[data-no]").addEventListener("click", close);
  body.querySelector("[data-yes]").addEventListener("click", () => { close(); onOk(); });
  body.querySelector("[data-yes]").focus();
}

export function mount(el, ctx) {
  const acct = ctx.account;
  const zone = ctx.tz;
  const all = acct.vehicles;
  const opts = ctx.vehicles && ctx.vehicles.length ? ctx.vehicles : all;
  const name = (v) => vehicleLabel(v, all, zone);
  const writable = store.writable();
  const vsOn = store.get("tm.vsavg", "1") !== "0";
  const range = DEFAULT_RANGES.includes(store.get("tm.range", "")) ? store.get("tm.range", "") : DEFAULT_RANGE;
  const homeOnMap = store.get("tm.chargemap.home", "0") === "1";
  const fuel = acct.fuel || {};
  const canPick = opts.length > 1;

  render(el, h`
    <div class="settings">
      ${writable ? "" : h`<div class="msg warn">This browser is blocking site storage, so these choices last until you close the tab.</div>`}

      <section class="card settings-sec" aria-labelledby="set-veh">
        <div class="card-head"><h2 class="card-title" id="set-veh">Vehicle</h2></div>
        ${all.length ? h`
          ${row("directions_car", "Default vehicle", "The vehicle every section opens on (the same choice as the vehicle menu at the top).",
            canPick ? h`<select class="settings-select" data-set="vehicle" aria-label="Default vehicle">
                ${opts.map((v) => h`<option value="${v.id}" ${ctx.scope && ctx.scope.id === v.id ? h`selected` : ""}>${name(v)}</option>`)}
              </select>` : h`<span class="settings-val">${name(opts[0])}</span>`)}
          <ul class="settings-list">
            ${all.map((v) => h`<li>
              ${opts.some((o) => o.id === v.id)
                ? h`<a href="#/garage" data-garage="${v.id}">${raw(iconHtml("directions_car", { size: 18 }))}<span class="settings-vname">${name(v)}</span></a>`
                : h`<span class="settings-vstatic">${raw(iconHtml("directions_car", { size: 18 }))}<span class="settings-vname">${name(v)}</span></span>`}
              <span class="settings-vcount">${v.tripCount} ${v.tripCount === 1 ? "drive" : "drives"} · ${v.chargeCount} ${v.chargeCount === 1 ? "charge" : "charges"}</span>
            </li>`)}
          </ul>` : h`<p class="note">No vehicle yet. Vehicles are added in the app.</p>`}
      </section>

      <section class="card settings-sec" aria-labelledby="set-units">
        <div class="card-head"><h2 class="card-title" id="set-units">Units &amp; theme</h2></div>
        ${row("speed", "Units", "Distances, speeds, temperatures and pressures on this page.",
          segBtns("Units", "units", [["imperial", "Imperial (mi / °F)"], ["metric", "Metric (km / °C)"]], ctx.units))}
        ${row("brightness_6", "Theme", "The same choice as the switch next to Refresh.",
          segBtns("Theme", "theme", [["system", "Follows system"], ["light", "Always light"], ["dark", "Always dark"]], currentPref()))}
      </section>

      <section class="card settings-sec" aria-labelledby="set-dash">
        <div class="card-head"><h2 class="card-title" id="set-dash">Dashboard defaults</h2></div>
        ${row("insights", "Compare with your average (vs avg)", "Each tile's line against your usual for that period.",
          h`<input type="checkbox" class="settings-switch" data-set="vsavg" aria-label="Compare with your average" ${vsOn ? h`checked` : ""}>`)}
        ${row("calendar_month", "Default period", "Where Charge, Map and Financial open when the address names no period.",
          h`<select class="settings-select" data-set="range" aria-label="Default period">
            ${DEFAULT_RANGES.map((r) => h`<option value="${r}" ${r === range ? h`selected` : ""}>${RANGE_LABELS[r]}</option>`)}
          </select>`)}
        ${row("location_on", "Show home on the charge map", "Off: home charges stay off the map, so no map tiles around your home are requested.",
          h`<input type="checkbox" class="settings-switch" data-set="chargemap-home" aria-label="Show home on the charge map" ${homeOnMap ? h`checked` : ""}>`)}
        ${row("dashboard", "Reset tile layouts", "Every section's tiles go back to their default nine.",
          h`<button type="button" class="btn ghost sm" data-act="tiles">Reset</button>`)}
        ${row("description", "Reset report design", "The report's title, texts, template, colours and logo go back to the defaults.",
          h`<button type="button" class="btn ghost sm" data-act="report">Reset</button>`)}
        ${row("card_membership", "Remove saved memberships", "The charging memberships you entered on Financial (kept in this browser only).",
          h`<button type="button" class="btn ghost sm" data-act="memberships">Remove</button>`)}
        <div class="settings-done" aria-live="polite"></div>
      </section>

      <section class="card settings-sec" aria-labelledby="set-app">
        <div class="card-head"><h2 class="card-title" id="set-app">From the app (read-only)</h2></div>
        <dl class="kv">
          <dt>Comparison car</dt><dd>${fuel.label || "Your comparison car"}</dd>
          <dt>Comparison MPG</dt><dd>${fuel.mpg > 0 ? `${fuel.mpg} mpg` : "—"}</dd>
          <dt>Gas price</dt><dd>${fuel.gasPrice > 0 ? `${money(fuel.gasPrice, 2)}/gal` : "—"}</dd>
          <dt>Home rate</dt><dd>${acct.homeRate > 0 ? `${money(acct.homeRate, 3)}/kWh` : "Not set"}</dd>
        </dl>
        <p class="note">These come from the app. Change them there: Garage → Charger. Units and theme are per browser and do not change the app.</p>
      </section>

      <section class="card settings-sec" aria-labelledby="set-data">
        <div class="card-head"><h2 class="card-title" id="set-data">Data</h2></div>
        ${row("download", "My data (CSV)", "Every trip and charge you've logged, from Account.",
          h`<a class="btn ghost sm" href="#/account">Open Account</a>`)}
        ${row("delete_forever", "Clear this browser's dashboard settings", "Units, theme, tiles, report design, memberships and every other choice made on this page. You stay signed in.",
          h`<button type="button" class="btn ghost sm" data-act="clear">Clear</button>`)}
      </section>

      <section class="card settings-sec" aria-labelledby="set-about">
        <div class="card-head"><h2 class="card-title" id="set-about">About</h2></div>
        <dl class="kv">
          <dt>Dashboard version</dt><dd>${BUILD}</dd>
          <dt>Privacy</dt><dd><a href="https://gateeng.com/truemile-privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a></dd>
          <dt>Terms</dt><dd><a href="https://gateeng.com/truemile-terms/" target="_blank" rel="noopener noreferrer">Terms of Use</a></dd>
        </dl>
        <h3 class="settings-h">Open-source notices</h3>
        <ul class="settings-notices">
          <li>MapLibre GL JS 6.11.2 (BSD-3-Clause) — <a href="assets/vendor/maplibre-gl-6.11.2/LICENSE.txt" target="_blank" rel="noopener">license</a></li>
          <li>Material icons 0.14.15 (Apache-2.0) — <a href="assets/vendor/material-icons-0.14.15/LICENSE.txt" target="_blank" rel="noopener">license</a></li>
        </ul>
        <p class="note">Map data © OpenMapTiles © OpenStreetMap contributors, served by OpenFreeMap.</p>
        ${ctx.fixtures ? "" : h`<button type="button" class="btn ghost settings-signout">${raw(iconHtml("logout", { size: 20 }))}<span>Sign out</span></button>`}
      </section>
    </div>`);

  const $ = (s) => el.querySelector(s);
  const done = $(".settings-done");
  const said = (text) => { done.textContent = text; };

  const onClick = (e) => {
    const p = e.target.closest("button[data-pick]");
    if (p && el.contains(p)) {
      const [group, value] = p.dataset.pick.split(":");
      if (group === "units" && value !== ctx.units) ctx.setUnits(value);
      if (group === "theme" && value !== currentPref()) ctx.setTheme(value);
      return;
    }
    const g = e.target.closest("a[data-garage]");
    if (g) {
      e.preventDefault();
      const id = g.dataset.garage;
      if (ctx.scope && ctx.scope.id !== id) ctx.setVehicle(id);
      ctx.nav("#/garage");
      return;
    }
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    switch (b.dataset.act) {
      case "tiles": {
        const n = store.removePrefix("tm.tiles.");
        said(n ? "Tile layouts reset." : "The tiles were already on their defaults.");
        break;
      }
      case "report": {
        store.removePrefix("tm.report.");
        said("Report design reset.");
        break;
      }
      case "memberships":
        confirmBox("Remove saved memberships?", "The memberships you entered on Financial are removed from this browser. Nothing else changes.",
          "Remove", () => { store.remove("tm.memberships"); said("Saved memberships removed."); });
        break;
      case "clear":
        confirmBox("Clear this browser's dashboard settings?",
          "Every choice this page keeps in this browser goes back to its default. You stay signed in, and nothing in the app or your account changes.",
          "Clear", () => { store.removePrefix("tm."); location.reload(); });
        break;
    }
  };
  el.addEventListener("click", onClick);

  const onChange = (e) => {
    const s = e.target.closest("[data-set]");
    if (!s) return;
    switch (s.dataset.set) {
      case "vehicle": ctx.setVehicle(s.value); break;
      case "range": store.set("tm.range", s.value); said(`Sections open on ${RANGE_LABELS[s.value]}.`); break;
      case "vsavg": store.set("tm.vsavg", s.checked ? "1" : "0"); said(s.checked ? "vs avg on." : "vs avg off."); break;
      case "chargemap-home": store.set("tm.chargemap.home", s.checked ? "1" : "0"); said(s.checked ? "Home shows on the charge map." : "Home stays off the charge map."); break;
    }
  };
  el.addEventListener("change", onChange);

  const so = $(".settings-signout");
  if (so) {
    so.addEventListener("click", async () => {
      so.disabled = true;
      await api.auth.signOut().catch(() => {});
      location.replace(location.pathname + location.search);
    });
  }

  return {
    unmount() {
      el.removeEventListener("click", onClick);
      el.removeEventListener("change", onChange);
    },
  };
}
