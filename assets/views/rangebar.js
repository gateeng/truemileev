// TrueMile EV web: the Range control (Report parity, RS:1320-1512, 2245-2284). Shared by every page.
// Segments Day · Week · Month · Year · Year to date · All time · Custom…, then ‹ label › for the
// ranges that step. Picking a range resets the offset to 0; the later-period arrow is disabled at the current period.
// Custom shows two date fields (max = today); a reversed pick is swapped; half-built reads "Pick dates".

import { h, render, raw, iconHtml } from "../lib/dom.js";
import { RANGES, LABELS, steppable as canStep, tileWindow, rangeValueLabel } from "../lib/periods.js";
import { ymd, parseYmd } from "../lib/tz.js";

export const BUILD = "2026-10-01.1";

/**
 * mountRangeBar(el, {range, off, from, to, nowMs, zone, allowCustom = true, steppable = true}, onChange)
 * onChange({range, off, from, to}) on every pick, step or date change. Returns {update(state), destroy()}.
 */
export function mountRangeBar(el, opts, onChange) {
  let st = { ...opts };
  const allowCustom = opts.allowCustom !== false;
  const stepping = opts.steppable !== false;
  const ranges = RANGES.filter((r) => allowCustom || r !== "custom");

  const emit = (next) => {
    st = { ...st, ...next };
    draw();
    onChange && onChange({ range: st.range, off: st.off || 0, from: st.from || "", to: st.to || "" });
  };

  function draw() {
    const now = st.nowMs ?? Date.now();
    const range = RANGES.includes(st.range) ? st.range : "week";
    const off = Math.min(0, Math.trunc(st.off) || 0);
    const win = tileWindow(range, now, off, st.from, st.to, st.zone);
    const label = rangeValueLabel(range, win, now, st.zone);
    const steps = stepping && canStep(range);
    const today = ymd(now, st.zone);
    render(el, h`
      <div class="rangebar">
        <div class="seg rangebar-seg" role="group" aria-label="Range">
          ${ranges.map((r) => h`<button type="button" class="${r === range ? "on" : ""}" data-range="${r}" aria-pressed="${r === range ? "true" : "false"}">${LABELS[r]}</button>`)}
        </div>
        <div class="rangebar-step">
          ${steps ? h`<button type="button" class="rangebar-arrow" data-step="-1" aria-label="Earlier period">${raw(iconHtml("chevron_left"))}</button>` : ""}
          <span class="rangebar-label" aria-live="polite">${label}</span>
          ${steps ? h`<button type="button" class="rangebar-arrow" data-step="1" aria-label="Later period" ${off >= 0 ? h`disabled` : ""}>${raw(iconHtml("chevron_right"))}</button>` : ""}
        </div>
        ${range === "custom" ? h`
          <div class="rangebar-custom">
            <label class="rangebar-date"><span>Start</span><input type="date" data-date="from" max="${today}" value="${st.from || ""}"></label>
            <label class="rangebar-date"><span>End</span><input type="date" data-date="to" max="${today}" value="${st.to || ""}"></label>
          </div>` : ""}
      </div>`);
  }

  const onClick = (e) => {
    const b = e.target.closest("button");
    if (!b || !el.contains(b) || b.disabled) return;
    if (b.dataset.range) {
      const r = b.dataset.range;
      if (r === st.range && r !== "custom") return;
      emit({ range: r, off: 0, from: r === "custom" ? st.from || "" : "", to: r === "custom" ? st.to || "" : "" });
    } else if (b.dataset.step) {
      const next = Math.min(0, (Math.trunc(st.off) || 0) + Number(b.dataset.step));
      if (next !== (st.off || 0)) emit({ off: next });
    }
  };
  const onDate = (e) => {
    const inp = e.target.closest("input[data-date]");
    if (!inp) return;
    const today = ymd(st.nowMs ?? Date.now(), st.zone);
    let v = parseYmd(inp.value) ? inp.value : "";
    if (v && v > today) v = today;
    let from = inp.dataset.date === "from" ? v : st.from || "";
    let to = inp.dataset.date === "to" ? v : st.to || "";
    if (from && to && from > to) [from, to] = [to, from];     // picked backwards: swap, as the app does
    emit({ range: "custom", off: 0, from, to });
  };
  el.addEventListener("click", onClick);
  el.addEventListener("change", onDate);
  draw();

  return {
    update(next) { st = { ...st, ...next }; draw(); },
    step(dir) {
      if (!(stepping && canStep(st.range))) return false;
      const next = Math.min(0, (Math.trunc(st.off) || 0) + dir);
      if (next === (st.off || 0)) return false;
      emit({ off: next });
      return true;
    },
    destroy() { el.removeEventListener("click", onClick); el.removeEventListener("change", onDate); el.innerHTML = ""; },
  };
}
