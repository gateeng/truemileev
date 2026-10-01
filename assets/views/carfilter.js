// TrueMile EV web: the car filter (the Report's Vehicle menu entries, RS:1255-1284; OtherCarCopy).
// "All drives" · "Other cars" · "Needs an answer (n)". Hidden when the scope has neither a drive in
// another car nor one waiting for an answer. The filter changes the LIST only; tiles never move.

import { h, render } from "../lib/dom.js";

export const BUILD = "2026-10-01.1";

export const CAR_VALUES = ["all", "other", "ask"];

/**
 * mountCarFilter(el, {value, askCount, hasOther}, onChange(value)). Returns {update(opts), destroy()}.
 */
export function mountCarFilter(el, opts, onChange) {
  let st = { value: CAR_VALUES.includes(opts.value) ? opts.value : "all", askCount: opts.askCount || 0, hasOther: !!opts.hasOther };

  function draw() {
    if (!st.hasOther && st.askCount === 0) { el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;
    const items = [["all", "All drives"], ["other", "Other cars"], ["ask", `Needs an answer (${st.askCount})`]];
    render(el, h`
      <div class="seg carfilter" role="group" aria-label="Which drives">
        ${items.map(([v, label]) => h`<button type="button" data-car="${v}" class="${v === st.value ? "on" : ""}" aria-pressed="${v === st.value ? "true" : "false"}">${label}</button>`)}
      </div>`);
  }

  const onClick = (e) => {
    const b = e.target.closest("button[data-car]");
    if (!b || !el.contains(b)) return;
    if (b.dataset.car === st.value) return;
    st.value = b.dataset.car;
    draw();
    onChange && onChange(st.value);
  };
  el.addEventListener("click", onClick);
  draw();
  return {
    update(next) { st = { ...st, ...next }; draw(); },
    destroy() { el.removeEventListener("click", onClick); el.innerHTML = ""; },
  };
}
