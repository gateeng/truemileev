// TrueMile EV web: the trip-type multi-select (the Report's Category filter, RS:1285-1311).
// Trigger "Type: All" / the single label / "N selected" (categoryTrigger, RS:236-240). An empty
// selection is "All". Locked below Pro: the trigger is disabled and the lock line sits under it.

import { h, render } from "../lib/dom.js";
import { lockText } from "../lib/gates.js";

export const BUILD = "2026-10-01.1";

/** The route's `types` key → the selected ids (comma-joined; blank = all). */
export function parseTypes(str) {
  return new Set(String(str ?? "").split(",").map((s) => s.trim()).filter((s) => s));
}
/** The selected ids → the route's `types` key ("" when all). Sorted, so one selection has one URL. */
export function formatTypes(set) {
  return [...(set || [])].sort().join(",");
}

/** categoryTrigger: "All" / the one label ("1 selected" for an unknown id) / "N selected". */
export function triggerText(selected, options) {
  if (!selected || selected.size === 0) return "All";
  if (selected.size === 1) {
    const id = [...selected][0];
    const o = options.find((x) => x.id === id);
    return o ? o.label : "1 selected";
  }
  return `${selected.size} selected`;
}

/**
 * mountTypeFilter(el, {options: [{id, label}], selected: Set<string>, locked: bool}, onChange(Set))
 * Returns {update(opts), destroy()}.
 */
export function mountTypeFilter(el, opts, onChange) {
  let st = { options: opts.options || [], selected: new Set(opts.selected || []), locked: !!opts.locked };
  let open = false;

  function draw() {
    const text = `Type: ${triggerText(st.selected, st.options)}`;
    render(el, h`
      <div class="typefilter">
        <button type="button" class="typefilter-btn${st.selected.size ? " on" : ""}" aria-haspopup="true"
          aria-expanded="${open ? "true" : "false"}" ${st.locked ? h`disabled` : ""}>${st.locked ? "🔒 " : ""}${text} ▾</button>
        ${st.locked ? h`<div class="note typefilter-lock">${lockText("tripTypes")}</div>` : ""}
        ${open && !st.locked ? h`
          <div class="typefilter-menu" role="group" aria-label="Trip types">
            ${st.options.map((o) => h`
              <label class="typefilter-item"><input type="checkbox" value="${o.id}" ${st.selected.has(o.id) ? h`checked` : ""}> <span>${o.label}</span></label>`)}
            <div class="typefilter-actions">
              <button type="button" data-act="all">All types</button>
              <button type="button" data-act="done" class="primary">Done</button>
            </div>
          </div>` : ""}
      </div>`);
  }

  const emit = () => { draw(); onChange && onChange(new Set(st.selected)); };

  const onClick = (e) => {
    const b = e.target.closest("button");
    if (!b || !el.contains(b) || b.disabled) return;
    if (b.classList.contains("typefilter-btn")) { open = !open; draw(); return; }
    if (b.dataset.act === "all") { st.selected = new Set(); emit(); return; }
    if (b.dataset.act === "done") { open = false; draw(); }
  };
  const onChangeBox = (e) => {
    const c = e.target.closest("input[type=checkbox]");
    if (!c) return;
    if (c.checked) st.selected.add(c.value); else st.selected.delete(c.value);
    emit();
  };
  // composedPath is fixed when the event starts, so a click whose target was re-rendered away inside
  // this control (the trigger itself) still counts as inside.
  const onDocClick = (e) => {
    if (!open) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (path.includes(el) || el.contains(e.target)) return;
    open = false;
    draw();
  };
  const onKey = (e) => { if (open && e.key === "Escape") { open = false; draw(); el.querySelector(".typefilter-btn")?.focus(); } };
  el.addEventListener("click", onClick);
  el.addEventListener("change", onChangeBox);
  el.addEventListener("keydown", onKey);
  document.addEventListener("click", onDocClick);
  draw();

  return {
    update(next) {
      st = { ...st, ...next, selected: new Set(next.selected ?? st.selected) };
      draw();
    },
    destroy() {
      el.removeEventListener("click", onClick);
      el.removeEventListener("change", onChangeBox);
      el.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
      el.innerHTML = "";
    },
  };
}
