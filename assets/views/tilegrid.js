// TrueMile EV web: a section's tile grid (the app's Report tiles, extracted from the first build's
// Dashboard with the same behaviour). Charge, Map and Financial each mount one:
//   - the "vs avg" row: the comparison caption and the switch (tm.vsavg, shared by every section);
//     hidden for All time and for a half-built Custom range
//   - the tiles: the section's chosen keys (tm.tiles.<section>.<vehicle id>); a metric tile shows
//     tileAggregate / display and its vs-avg line; an extra tile shows the section's own figure with no
//     vs-avg line, and "—" plus the lock label when the plan does not reach it
//   - a click opens the picker (the section's metrics ∪ extras, each with a live preview); a key that
//     sits on another tile trades places; ← / → on the grid and a 48 px swipe step the period.

import { h, render, raw, openDialog, onSwipe, justSwiped, store, iconHtml } from "../lib/dom.js";
import { typeFilter } from "../lib/rows.js";
import {
  tileAggregate, display, labelFor, metric, swapTiles, SECTION_TILES, parseSectionTiles, sectionTilesKey,
  isMetricKey, NONE,
} from "../lib/metrics.js";
import * as cmp from "../lib/compare.js";
import { allows, lockText } from "../lib/gates.js";

export const BUILD = "2026-09-27.3";

/** The "vs avg" switch: on unless the reader turned it off (Settings or any section's switch). */
export const vsAvgOn = () => store.get("tm.vsavg", "1") !== "0";

/** A tile's label: a metric's own, else the extra's label(units), else the key. */
export function labelForTile(key, units, extras = {}) {
  if (isMetricKey(key)) return labelFor(key, units);
  const x = extras && extras[key];
  if (x && typeof x.label === "function") return String(x.label(units));
  if (x && typeof x.label === "string") return x.label;
  return key;
}

/**
 * mountTileGrid(el, ctx, {section, extras, onStep, ariaLabel}) -> {update(u), destroy()}
 *   extras: key -> {label:(units)=>string, blurb, color, value:(x)=>string, gate?:featureKey}
 *           x = {agg, trips, charges, units, tier, win}
 *   onStep(dir -1|1) -> boolean: the section's rangebar step (keys and swipe)
 *   u = {st, win, half, tileTrips, tileCharges, ownAny, scopeCharges, typesKey}
 *       st = the section's period state {range, off, from, to, types:Set}; win = the tiles' window;
 *       half = a half-built custom range; tileTrips / tileCharges = the rows the tiles add up;
 *       ownAny = the scope's own drives of any type and date (the vs-avg history); scopeCharges = the
 *       scope's charges of any date.
 */
export function mountTileGrid(el, ctx, { section, extras = {}, onStep, ariaLabel } = {}) {
  const cfg = SECTION_TILES[section];
  if (!cfg) throw new Error(`No tile set for "${section}"`);
  const units = ctx.units;
  const zone = ctx.tz;
  const tier = ctx.tier || (ctx.account && ctx.account.tier);
  const vid = (ctx.scope && ctx.scope.id) || "all";
  const storeKey = sectionTilesKey(section, vid);
  let tiles = parseSectionTiles(store.get(storeKey, ""), section);
  let baseCache = { key: "", map: null };
  let last = null;          // the last update's input
  let current = null;       // its aggregate + extras input, for the picker's previews

  render(el, h`
    <div class="tilegrid">
      <div class="tilegrid-vsrow" hidden>
        <span class="tilegrid-caption"></span>
        <label class="tilegrid-switch"><input type="checkbox" class="tilegrid-vs"> <span>vs avg</span></label>
      </div>
      <div class="tilegrid-grid" tabindex="0" role="group" style="--cols:${cfg.cols}"
        aria-label="${ariaLabel || "Tiles. Left and right arrow keys step the period."}"></div>
    </div>`);
  const $ = (s) => el.querySelector(s);
  const grid = $(".tilegrid-grid");
  const vsBox = $(".tilegrid-vs");
  vsBox.checked = vsAvgOn();
  const onVs = () => { store.set("tm.vsavg", vsBox.checked ? "1" : "0"); if (last) draw(); };
  vsBox.addEventListener("change", onVs);

  const step = (dir) => (typeof onStep === "function" ? !!onStep(dir) : false);
  const onKey = (e) => {
    if (e.target !== grid) return;
    if (e.key === "ArrowLeft") { if (step(-1)) e.preventDefault(); }
    else if (e.key === "ArrowRight") { if (step(1)) e.preventDefault(); }
  };
  grid.addEventListener("keydown", onKey);
  const unSwipe = onSwipe(grid, (d) => step(d === "right" ? -1 : 1));
  const onClick = (e) => {
    const b = e.target.closest("button[data-slot]");
    if (!b || justSwiped(grid)) return;
    openPicker(Number(b.dataset.slot));
  };
  grid.addEventListener("click", onClick);

  function baselinesFor(p, u, now) {
    const st = u.st || {};
    const key = [st.range, st.off, st.from, st.to, u.typesKey || "", p.selStart, p.selEnd].join("|");
    if (baseCache.key !== key) {
      const sums = typeFilter(u.ownAny || [], st.types);
      const anch = cmp.anchors(u.ownAny || [], u.scopeCharges || [], zone);
      baseCache = { key, map: cmp.baselines(p, sums, u.scopeCharges || [], anch, ctx.account.readAt, now, zone) };
    }
    return baseCache.map;
  }

  /** An extra tile's value, "—" when its section did not supply it, locked when the plan is below it. */
  function extraCell(key, x) {
    const def = extras[key];
    if (!def) return { value: NONE, color: "var(--dim)", locked: false };
    if (def.gate && !allows(tier, def.gate)) return { value: NONE, color: def.color || "var(--dim)", locked: true, lock: lockText(def.gate) };
    let v = NONE;
    try { v = typeof def.value === "function" ? String(def.value(x)) : NONE; } catch (_) { v = NONE; }
    return { value: v, color: def.color || "var(--m-distance)", locked: false };
  }

  function valueOf(key, agg, x) {
    return isMetricKey(key) ? display(key, agg, units) : extraCell(key, x).value;
  }

  function draw() {
    const u = last;
    const now = ctx.now();
    const st = u.st || {};
    const win = u.win;
    const agg = tileAggregate(u.tileTrips || [], u.tileCharges || []);
    const x = { agg, trips: u.tileTrips || [], charges: u.tileCharges || [], units, tier, win };
    current = { agg, x };

    const customMs = st.range === "custom" && !u.half && win ? { start: win.start, end: win.end } : null;
    const p = u.half ? null : cmp.plan(st.range, now, st.off, customMs, zone);
    const vsRow = $(".tilegrid-vsrow");
    vsRow.hidden = !p;
    const vsOn = !!p && vsBox.checked;
    const base = vsOn ? baselinesFor(p, u, now) : null;
    $(".tilegrid-caption").textContent = vsOn
      ? cmp.caption(p, st.range, tiles.filter(isMetricKey).map((k) => base.get(k)), zone, base.running) : "";

    render(grid, h`${tiles.map((key, i) => {
      const label = labelForTile(key, units, extras);
      if (isMetricKey(key)) {
        const m = metric(key);
        const v = display(key, agg, units);
        const ln = vsOn ? cmp.line(key, agg, base.get(key), units) : null;
        return h`<button type="button" class="tilegrid-tile" data-slot="${i}" aria-label="${label} ${v}${ln ? ", " + ln.spoken : ""}. Change this tile.">
          <span class="tilegrid-v" style="color:${m.color}">${v}</span>
          <span class="tilegrid-k">${label}</span>
          ${ln ? h`<span class="tilegrid-cmp">${ln.delta ? h`<b class="tilegrid-${ln.tone}">${ln.delta}</b> · ` : ""}${ln.avg}</span>` : ""}
        </button>`;
      }
      const c = extraCell(key, x);
      return h`<button type="button" class="tilegrid-tile${c.locked ? " locked" : ""}" data-slot="${i}"
          aria-label="${label} ${c.locked ? c.lock : c.value}. Change this tile." ${c.locked ? h`title="${c.lock}"` : ""}>
        <span class="tilegrid-v" style="color:${c.color}">${c.value}</span>
        <span class="tilegrid-k">${c.locked ? raw(iconHtml("lock", { size: 12 })) : ""}${label}</span>
        ${c.locked ? h`<span class="tilegrid-cmp">${c.lock}</span>` : ""}
      </button>`;
    })}`);
  }

  function openPicker(slot) {
    if (!current) return;
    const cur = tiles[slot];
    const body = document.createElement("div");
    body.className = "tilegrid-picker";
    const item = (key) => {
      const isCur = key === cur;
      const elsewhere = !isCur && tiles.includes(key);
      const blurb = isMetricKey(key) ? metric(key).blurb : ((extras[key] && extras[key].blurb) || "");
      return h`<button type="button" class="tilegrid-pick${isCur ? " on" : ""}" data-key="${key}">
        <span class="tilegrid-pick-main"><span class="tilegrid-pick-label">${labelForTile(key, units, extras)}</span>${isCur ? h`<span class="tilegrid-pick-mark"> · showing</span>` : elsewhere ? h`<span class="tilegrid-pick-mark"> · on another tile — will trade</span>` : ""}
          <span class="tilegrid-pick-blurb">${blurb}</span></span>
        <span class="tilegrid-pick-val">${valueOf(key, current.agg, current.x)}</span>
      </button>`;
    };
    render(body, h`${cfg.metrics.map(item)}${cfg.extras.length ? h`<div class="tilegrid-pick-group">This section</div>${cfg.extras.map(item)}` : ""}`);
    const close = openDialog({ title: "Show in this tile", bodyEl: body });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-key]");
      if (!b) return;
      tiles = swapTiles(tiles, slot, b.dataset.key);
      store.set(storeKey, tiles.join(","));
      close();
      draw();
      grid.querySelector(`button[data-slot="${slot}"]`)?.focus();
    });
    body.querySelector("button.on")?.focus();
  }

  return {
    update(u) { last = u || {}; draw(); },
    destroy() {
      unSwipe();
      grid.removeEventListener("keydown", onKey);
      grid.removeEventListener("click", onClick);
      vsBox.removeEventListener("change", onVs);
    },
  };
}
