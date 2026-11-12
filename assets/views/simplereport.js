// TrueMile EV web | Basic's data downloads (owner B5-B6, 10/11), shared by Account › My data and
// Report › Print and export. Basic no longer downloads everything: it downloads a SIMPLE REPORT of
// exactly what it sees (gates.tripListWindow / chargeListWindow: this month's and last month's quota),
// as two small CSV files (lib/csv.js simpleTripsCsv / simpleChargesCsv). Pro and Max keep My data and
// the Report CSV. Anyone, on any plan, can ask support for a complete copy: the Terms say so, the dashboard does not
// repeat it (owner 10/11).
// Files are made in this browser; the only requests are the drives' recorded routes (api.tripRoutes,
// read-only), for each drive's start and end.

import * as api from "../lib/api.js";
import { esc, saveBlob } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { tripListWindow, chargeListWindow, lockText, quotaNow, basicVisibleFrom } from "../lib/gates.js";
import { simpleTripsCsv, simpleChargesCsv, CSV_BOM } from "../lib/csv.js";

export const BUILD = "2026-11-12.2";

/**
 * The simple report's rows for one vehicle: the drives and the charges [tier] sees of it, from the start
 * of last month on (SimpleReport.basicTrips / basicCharges: a drive waiting for its car answer is listed
 * whatever its month, but the report covers the two months only). [nowMs] is the browser's clock; the
 * quota reads it floored by the server's (gates.quotaNow), and so does the cut here.
 */
export function simpleRows(account, vehicleId, tier, nowMs, zone) {
  const now = quotaNow(tier, nowMs);
  const from = basicVisibleFrom(now, zone);
  const mine = (r) => r.vehicleId === vehicleId;
  const shown = (r) => r.date >= from;
  return {
    trips: tripListWindow(tier, (account.trips || []).filter(mine), { nowMs: now, zone }).filter(shown),
    charges: chargeListWindow(tier, (account.charges || []).filter(mine), { nowMs: now, zone }).filter(shown),
  };
}

/**
 * mountSimpleReport(el, ctx, {vehicles, names}) → {destroy()}: the explanation, a Drives and a Charges
 * button per vehicle ([names] = Map<id, label>, used when there is more than one), the message line,
 * and what the full download needs.
 */
export function mountSimpleReport(el, ctx, { vehicles = [], names = new Map() } = {}) {
  const many = vehicles.length > 1;
  const btn = (v, kind) => `<button type="button" class="btn" data-simple="${kind}" data-vid="${esc(v.id)}">` +
    `${icon(kind === "trips" ? "route" : "ev_station", { size: 18 })}` +
    `<span>${esc((many ? `${names.get(v.id) || ""}: ` : "") + (kind === "trips" ? "Drives (CSV)" : "Charges (CSV)"))}</span></button>`;
  el.innerHTML =
    `<p>Download a simple report of what your plan shows: this month's and last month's drives and charges, as two CSV files.</p>` +
    `<p class="note">Drives: the day, where each drive started and ended, the distance and the battery % at the start and the end. ` +
    `Charges: the day, the location, the network, the rate, the energy delivered and the cost. Made in this browser; nothing is sent anywhere.</p>` +
    (vehicles.length
      ? `<div class="account-btns simple-btns">${vehicles.map((v) => btn(v, "trips") + btn(v, "charges")).join("")}</div>`
      : `<p class="note">No vehicle yet: vehicles are added in the app.</p>`) +
    `<div class="simple-msg" aria-live="polite"></div>` +
    `<p class="note lock">${icon("lock", { size: 16 })}<span>All your data in one file: ${esc(lockText("myData"))}</span></p>`;
  const msg = el.querySelector(".simple-msg");
  let alive = true;

  async function download(kind, vid, b) {
    const zone = ctx.tz;
    const now = quotaNow(ctx.tier, ctx.now());              // the clock the quota and the file name read
    const { trips, charges } = simpleRows(ctx.account, vid, ctx.tier, now, zone);
    b.disabled = true;
    try {
      let out;
      if (kind === "trips") {
        const routes = new Map();
        const ids = trips.map((t) => t.id);
        for (let i = 0; i < ids.length; i += 10) {
          if (!alive) return;
          msg.innerHTML = `<p class="note">Fetching routes ${i} / ${ids.length}…</p>`;
          const got = await api.tripRoutes(ids.slice(i, i + 10));
          for (const [id, poly] of got) routes.set(id, poly);
        }
        if (!alive) return;
        out = simpleTripsCsv({ trips, routes, units: ctx.units, zone, todayMs: now });
      } else {
        out = simpleChargesCsv({ charges, zone, todayMs: now });
      }
      if (!out) {
        msg.innerHTML = `<p class="msg info">No ${kind === "trips" ? "drives" : "charges"} this month or last month yet.</p>`;
        return;
      }
      saveBlob(new Blob([CSV_BOM, out.text], { type: "text/csv;charset=utf-8" }), out.name);
      const n = kind === "trips" ? trips.length : charges.length;
      const what = kind === "trips" ? (n === 1 ? "drive" : "drives") : (n === 1 ? "charge" : "charges");
      msg.innerHTML = `<p class="note">Saved ${esc(out.name)} (${n} ${what})</p>`;
    } catch (e) {
      if (alive) msg.innerHTML = `<p class="msg err">Could not build the file: ${esc(e && e.message ? e.message : e)}</p>`;
    } finally {
      b.disabled = false;
    }
  }

  const onClick = (e) => {
    const b = e.target.closest("button[data-simple]");
    if (!b || b.disabled || !el.contains(b)) return;
    download(b.dataset.simple === "charges" ? "charges" : "trips", b.dataset.vid, b);
  };
  el.addEventListener("click", onClick);
  return {
    destroy() {
      alive = false;
      el.removeEventListener("click", onClick);
    },
  };
}
