// TrueMile EV web: DOM helpers every view shares. Browser-only (the pure modules never import this).
// Rendering is string templates escaped by default: h`...` escapes every interpolated value unless it
// is itself an h`` result or wrapped in raw().

import { lockText } from "./gates.js";
import { icon } from "./icons.js";

export const BUILD = "2026-09-30.2";

/** The icon helper, re-exported so a view needs one import for markup (lib/icons.js icon()). */
export { icon as iconHtml };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escapes any value (null / undefined → ""). */
export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** A string that h`` inserts as markup, unescaped. */
export class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
export const raw = (s) => (s instanceof Raw ? s : new Raw(s ?? ""));

function part(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

/** Tagged template: h`<b>${name}</b>` escapes name; arrays are joined; h`` results nest as markup. */
export function h(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Sets el's markup from an h`` result (or a plain string, escaped). */
export function render(el, html) {
  el.innerHTML = html instanceof Raw ? html.s : esc(html);
  return el;
}

/** A pill: <span class="pill {cls}">text</span>. */
export const pill = (text, cls = "") => h`<span class="pill${cls ? " " + cls : ""}">${text}</span>`;

/** The one lock line for a gated feature: the lock icon, then "Available with Pro" / "… Max". */
export const lockNote = (feature) => h`<p class="note lock">${raw(icon("lock", { size: 16 }))}<span>${lockText(feature)}</span></p>`;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * A modal <dialog class="dialog"> with a title, a close button and [bodyEl] (a Node, an h`` result
 * or text). Escape, the close button and a backdrop click close it; it removes itself. Returns close()
 * (which always closes). [canClose]() → false keeps the dialog open against Escape, the close button
 * and the backdrop (e.g. while a request runs); the caller still checks whether it was dismissed,
 * because a browser may close a dialog on a repeated Escape regardless.
 */
export function openDialog({ title, bodyEl, canClose }) {
  const d = document.createElement("dialog");
  d.className = "dialog";
  d.setAttribute("aria-label", title || "Dialog");
  render(d, h`<div class="dialog-head"><h3>${title}</h3><button type="button" class="dialog-x icon-btn" aria-label="Close">${raw(icon("close"))}</button></div><div class="dialog-body"></div>`);
  const body = d.querySelector(".dialog-body");
  if (bodyEl instanceof Node) body.appendChild(bodyEl);
  else if (bodyEl !== undefined && bodyEl !== null) render(body, bodyEl);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { if (d.open) d.close(); } catch (_) { /* already closed */ }
    d.remove();
  };
  const may = () => typeof canClose !== "function" || canClose() !== false;
  d.querySelector(".dialog-x").addEventListener("click", () => { if (may()) close(); });
  d.addEventListener("cancel", (e) => { if (!may()) e.preventDefault(); });   // Escape
  d.addEventListener("close", close);
  d.addEventListener("click", (e) => { if (e.target === d && may()) close(); });   // a click on the backdrop
  document.body.appendChild(d);
  if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  return close;
}

/** Hands the viewer a file: a Blob saved under [name] through a temporary <a download>. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/**
 * A horizontal swipe of at least [minPx] (48, RS:2245-2284) on [el]: cb("right") for a drag to the
 * right (the earlier period), cb("left") for a drag to the left. Vertical scrolling is untouched.
 * Returns the unbind function.
 */
export function onSwipe(el, cb, minPx = 48) {
  let x0 = null, y0 = null, id = null;
  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    x0 = e.clientX; y0 = e.clientY; id = e.pointerId;
  };
  const up = (e) => {
    if (x0 === null || e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = y0 = id = null;
    if (Math.abs(dx) >= minPx && Math.abs(dx) > Math.abs(dy) * 1.5) {
      el.dataset.swiped = String(Date.now());
      cb(dx > 0 ? "right" : "left");
    }
  };
  const cancel = () => { x0 = y0 = id = null; };
  el.style.touchAction = "pan-y";
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
  };
}

/** True when a click on [el] is the tail of a swipe that just stepped (so it must not also click). */
export const justSwiped = (el) => Date.now() - Number(el.dataset.swiped || 0) < 400;

/**
 * localStorage for per-viewer conveniences only; every access survives a blocked store (a read gives
 * the fallback, a write is dropped). Keys of this page start "tm.".
 */
export const store = {
  get(key, fallback = null) {
    try { const v = globalThis.localStorage.getItem(key); return v === null ? fallback : v; } catch (_) { return fallback; }
  },
  set(key, value) {
    try { globalThis.localStorage.setItem(key, String(value)); return true; } catch (_) { return false; }
  },
  remove(key) {
    try { globalThis.localStorage.removeItem(key); } catch (_) { /* no storage */ }
  },
  /** A JSON value, or [fallback] when missing, unreadable or not JSON. */
  getJson(key, fallback = null) {
    const t = this.get(key, null);
    if (t === null) return fallback;
    try { const v = JSON.parse(t); return v === null || v === undefined ? fallback : v; } catch (_) { return fallback; }
  },
  /** Stores [value] as JSON; false when the browser refused (blocked or full). */
  setJson(key, value) {
    let t;
    try { t = JSON.stringify(value); } catch (_) { return false; }
    return this.set(key, t);
  },
  /** Every stored key (an empty list when the store is blocked). */
  keys() {
    try {
      const s = globalThis.localStorage;
      const out = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k !== null) out.push(k); }
      return out;
    } catch (_) { return []; }
  },
  /** Removes every key starting with [prefix]; returns how many went. */
  removePrefix(prefix) {
    const p = String(prefix || "");
    if (!p) return 0;
    let n = 0;
    for (const k of this.keys()) if (k.startsWith(p)) { this.remove(k); n++; }
    return n;
  },
  /** True when a write sticks (false: blocked site storage, choices last only until the tab closes). */
  writable() {
    try {
      const s = globalThis.localStorage;
      s.setItem("tm.probe", "1");
      s.removeItem("tm.probe");
      return true;
    } catch (_) { return false; }
  },
};

/** The key holding a one-way tag of the account that owns this browser's personal entries. */
export const OWNER_KEY = "tm.owner";
/**
 * Per-browser entries that are personal, not neutral preferences: the report's texts and logo
 * (tm.report.*) and the memberships (tm.memberships). Units, theme, tiles and the menu stay shared.
 */
export const PERSONAL_PREFIXES = Object.freeze(["tm.report.", "tm.memberships"]);

/** FNV-1a (32-bit) of [s] as 8 hex digits: a tag to compare accounts by, never the id itself. */
export function ownerTag(s) {
  let h = 0x811c9dc5;
  const t = String(s ?? "");
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/**
 * Called once the signed-in account is known: when this browser's personal entries were written by a
 * different account (or by no known one), they are removed before any section reads them, so the next
 * person on a shared computer never sees the last one's report texts, logo or memberships. Returns how
 * many entries went. [st] = the store (tests pass a fake).
 */
export function claimPersonalStore(userId, st = store) {
  const id = String(userId ?? "");
  if (!id) return 0;
  const tag = ownerTag(id);
  if (st.get(OWNER_KEY, "") === tag) return 0;
  let n = 0;
  for (const p of PERSONAL_PREFIXES) n += st.removePrefix(p);
  st.set(OWNER_KEY, tag);
  return n;
}

/**
 * The filter side sheet (<dialog class="sheet">): a right-hand panel from 768 px, a bottom sheet on a
 * phone. Header = [title] + close; body = [bodyEl]; footer = Reset (ghost, when [onReset]) and
 * [applyText] (primary, default "Apply", when [onApply]). Apply runs onApply() and closes unless it
 * returns false; Reset runs onReset() and keeps the sheet open. Escape, the close button and a click
 * on the backdrop close it. Returns close(); [onClose] runs once, however it closed.
 */
export function openSheet({ title, bodyEl, onApply, onReset, applyText = "Apply", onClose } = {}) {
  const d = document.createElement("dialog");
  d.className = "sheet";
  d.setAttribute("aria-label", title || "Filters");
  render(d, h`<div class="sheet-head"><h3>${title}</h3><button type="button" class="icon-btn sheet-x" aria-label="Close">${raw(icon("close"))}</button></div>
    <div class="sheet-body"></div>
    ${onApply || onReset ? h`<div class="sheet-foot">
      ${onReset ? h`<button type="button" class="btn ghost sheet-reset">Reset</button>` : ""}
      ${onApply ? h`<button type="button" class="btn primary sheet-apply">${applyText}</button>` : ""}
    </div>` : ""}`);
  const body = d.querySelector(".sheet-body");
  if (bodyEl instanceof Node) body.appendChild(bodyEl);
  else if (bodyEl !== undefined && bodyEl !== null) render(body, bodyEl);
  const opener = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { if (d.open) d.close(); } catch (_) { /* already closed */ }
    d.remove();
    if (typeof onClose === "function") { try { onClose(); } catch (_) { /* the caller's */ } }
    if (opener && typeof opener.focus === "function" && opener.isConnected) { try { opener.focus(); } catch (_) { /* gone */ } }
  };
  d.querySelector(".sheet-x").addEventListener("click", close);
  d.addEventListener("close", close);
  d.addEventListener("click", (e) => { if (e.target === d) close(); });
  const apply = d.querySelector(".sheet-apply");
  if (apply) apply.addEventListener("click", () => { if (onApply() !== false) close(); });
  const reset = d.querySelector(".sheet-reset");
  if (reset) reset.addEventListener("click", () => onReset());
  document.body.appendChild(d);
  if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  return close;
}

/** Formats a query object as "a=1&b=2" (keys sorted, empty values dropped), for in-page links. */
export function qs(query) {
  const u = new URLSearchParams();
  for (const k of Object.keys(query || {}).sort()) {
    const v = query[k];
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? "?" + s : "";
}
