// TrueMile EV web: light or dark. Stored per browser; System follows the OS.
// The choice ("system" | "light" | "dark") lives in localStorage "tm.theme" through dom.store (a blocked
// store simply forgets it at reload). "system" follows the browser's prefers-color-scheme, live; a
// browser that states no preference at all falls back to the clock (06:00-18:00 light, dark after).
// config.js applies an explicit light / dark choice before the first paint, so it never flashes.
// Importing this file touches nothing; startTheme() does the work (so Deno can import it).
//
// Every change of the applied theme dispatches document "tm:theme" with detail {theme, pref}: the maps
// swap their style on it. SVG charts use CSS variables and need nothing.

import { store } from "./dom.js";

export const BUILD = "2026-09-30.2";

export const THEME_PREFS = Object.freeze(["system", "light", "dark"]);
const KEY = "tm.theme";

/** The theme for a stated preference ("dark" | "light" | null) and the local hour. */
export function pickTheme(pref, hour) {
  if (pref === "dark" || pref === "light") return pref;
  return hour >= 6 && hour < 18 ? "light" : "dark";
}

/**
 * The applied theme: an explicit light / dark [pref] wins; otherwise ("system", or anything unknown)
 * the browser's [systemPref] ("dark" | "light" | null); otherwise the clock.
 */
export function resolveTheme(pref, systemPref, hour) {
  if (pref === "light" || pref === "dark") return pref;
  return pickTheme(systemPref === "dark" || systemPref === "light" ? systemPref : null, hour);
}

/** A stored value read back as one of THEME_PREFS ("system" when missing or unknown). */
export const normPref = (v) => (v === "light" || v === "dark" ? v : "system");

let pref = "system";
let theme = null;
let started = false;

function media(q) {
  try { return globalThis.matchMedia ? globalThis.matchMedia(q) : null; } catch (_) { return null; }
}

function systemPref() {
  const dark = media("(prefers-color-scheme: dark)");
  if (dark && dark.matches) return "dark";
  const light = media("(prefers-color-scheme: light)");
  if (light && light.matches) return "light";
  return null;
}

function apply() {
  const next = resolveTheme(pref, systemPref(), new Date().getHours());
  const root = globalThis.document && globalThis.document.documentElement;
  if (root) root.setAttribute("data-theme", next);
  const changed = theme !== null && next !== theme;
  theme = next;
  if (changed) {
    try {
      globalThis.document.dispatchEvent(new CustomEvent("tm:theme", { detail: { theme: next, pref } }));
    } catch (_) { /* no DOM */ }
  }
  return next;
}

/**
 * Reads the stored choice, sets data-theme on <html> and keeps following the system while the choice
 * is "system". Safe to call more than once. -> {pref, theme}
 */
export function startTheme() {
  pref = normPref(store.get(KEY, "system"));
  apply();
  if (!started) {
    started = true;
    const dark = media("(prefers-color-scheme: dark)");
    const onSystem = () => { if (pref === "system") apply(); };
    if (dark) {
      if (dark.addEventListener) dark.addEventListener("change", onSystem);
      else if (dark.addListener) dark.addListener(onSystem);
    }
  }
  return { pref, theme };
}

/** Stores and applies a choice ("system" | "light" | "dark"); returns the applied theme. */
export function setThemePref(next) {
  pref = normPref(next);
  if (pref === "system") store.remove(KEY); else store.set(KEY, pref);
  return apply();
}

/** The applied theme ("light" | "dark"). */
export function currentTheme() {
  return theme || resolveTheme(pref, systemPref(), new Date().getHours());
}

/** The stored choice ("system" | "light" | "dark"). */
export const currentPref = () => pref;
