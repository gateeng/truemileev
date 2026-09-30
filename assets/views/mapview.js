// TrueMile EV web: the screen maps (MapLibre GL JS 6.11.2, served from assets/vendor/, on OpenFreeMap
// tiles, the app's day and night styles). The ONLY module that imports MapLibre. The library and its CSS
// load on the first map of a page load, never before, so pages without a map never pay for them.
//
// One map per view, never one per row; views call destroy() on unmount (browsers cap live WebGL
// contexts at about 16). Maps are screen-only: print CSS hides them and printed pages keep the SVG
// route. Our overlays are GeoJSON from lib/mapdata.js drawn as line and circle layers only (no symbol
// or text layers, so nothing needs the style's fonts and the demo "&notiles" style works offline).
// When the page theme changes, the style swaps liberty ↔ dark and the overlays are re-added.

import { mode } from "../lib/api.js";
import { esc } from "../lib/dom.js";
import { styleUrl, blankStyle, tileRequest, PIN, WIDTHS } from "../lib/mapdata.js";

export const BUILD = "2026-09-30.2";

export const MAP_FALLBACK_TEXT = "The map can't be shown in this browser.";
const LIB_PATH = "../vendor/maplibre-gl-6.11.2/maplibre-gl.mjs";
const CSS_PATH = "../vendor/maplibre-gl-6.11.2/maplibre-gl.css";

let libP = null;
/** The library, imported once per page load (memoised; a failed import may be retried). */
function loadLib() {
  if (!libP) {
    libP = import(LIB_PATH);
    libP.catch(() => { libP = null; });
  }
  return libP;
}

/** maplibre-gl.css, appended to <head> once (it is not linked from app.html). */
function ensureCss() {
  if (document.querySelector("link[data-tm-maplibre]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL(CSS_PATH, import.meta.url).href;
  l.setAttribute("data-tm-maplibre", "1");
  document.head.appendChild(l);
}

/** The resolved page theme: <html data-theme>, else the system preference. */
function pageTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "light") return t;
  try { return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch (_) { return "dark"; }
}

/** Demo data with "&notiles" in the page URL: no tile requests at all (ctx.noTiles). */
export function tilesOff() {
  try { return mode() === "fixtures" && new URLSearchParams(location.search).has("notiles"); } catch (_) { return false; }
}

function cssVar(name) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (_) { return ""; }
}

function styleFor(theme, noTiles) {
  return noTiles ? blankStyle(cssVar("--card2")) : styleUrl(theme);
}

function fallback(el, why) {
  if (why) console.warn("map:", why);
  el.classList.add("mapview-off");
  el.innerHTML = `<p class="note mapview-msg">${esc(MAP_FALLBACK_TEXT)}</p>`;
  return null;
}

function hasWebGl2() {
  try { return typeof WebGL2RenderingContext !== "undefined"; } catch (_) { return false; }
}

// ── markers (the app's bitmaps as small inline SVGs) ─────────────────────────────────────────

const MARKER_SVG = {
  // Trip start: dark disc, green inner disc, white play triangle.
  start: `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="#1A2336" stroke="#FFFFFF" stroke-width="1.5"/>` +
    `<circle cx="14" cy="14" r="9" fill="#00E676"/><path d="M11.5 9.5v9l7-4.5z" fill="#FFFFFF"/></svg>`,
  // Trip end: a checkered flag on a grey pole with a red dot at its foot.
  end: `<svg viewBox="0 0 28 32" width="28" height="32" aria-hidden="true"><rect x="3" y="2" width="2.2" height="27" rx="1" fill="#BBBBBB"/>` +
    `<rect x="5" y="3" width="19" height="13" fill="#FFFFFF" stroke="#1A2336" stroke-width="1"/>` +
    `<path d="M5 3h4.75v4.33H5zM14.5 3h4.75v4.33H14.5zM9.75 7.33h4.75v4.33H9.75zM19.25 7.33H24v4.33h-4.75zM5 11.67h4.75V16H5zM14.5 11.67h4.75V16H14.5z" fill="#1A2336"/>` +
    `<circle cx="4.1" cy="29" r="2.6" fill="#FF1744"/></svg>`,
  // A rest stop between two drives: amber disc, white ring, clock hands.
  rest: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#FF6D00" stroke="#FFFFFF" stroke-width="2"/>` +
    `<path d="M12 6.5V12l3.5 2.2" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>`,
};
const MARKER_LABEL = { start: "Start", end: "End", rest: "Stop" };

function markerEl(kind) {
  const k = MARKER_SVG[kind] ? kind : "rest";
  const d = document.createElement("div");
  d.className = `mapview-marker mapview-${k}`;
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", MARKER_LABEL[k]);
  d.title = MARKER_LABEL[k];
  d.innerHTML = MARKER_SVG[k];
  return d;
}

// ── the map ───────────────────────────────────────────────────────────────────────────────────

const EMPTY = () => ({ type: "FeatureCollection", features: [] });
const LINE_LAYERS = ["tm-lines", "tm-lines-dash"];

/**
 * mountMap(el, {kind, height, interactive, ariaLabel, noTiles}) → Promise<MapHandle | null>.
 * kind "trip" | "journey" | "period" | "charges" | "pin" sets the line widths and pin sizes. null means
 * the map could not be made (no WebGL2, the library did not load): the fallback sentence is already in
 * [el] and the caller keeps its list or SVG. [noTiles] defaults to demo "&notiles".
 * If the caller unmounts before this resolves, it must still call destroy() on the handle it gets.
 */
export async function mountMap(el, { kind = "trip", height = 360, interactive = true, ariaLabel = "Map", noTiles } = {}) {
  el.classList.add("mapview");
  el.style.height = `${Math.max(120, Math.round(Number(height) || 360))}px`;
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", ariaLabel);
  if (!hasWebGl2()) return fallback(el, "no WebGL2");
  let ml;
  try {
    ensureCss();
    ml = await loadLib();
  } catch (e) {
    return fallback(el, e && e.message);
  }
  if (!el.isConnected) return null;
  const off = noTiles === undefined ? tilesOff() : !!noTiles;
  let theme = pageTheme();
  let map;
  try {
    map = new ml.Map({
      container: el,
      style: styleFor(theme, off),
      attributionControl: off ? false : { compact: true },
      cooperativeGestures: !!interactive,
      interactive: !!interactive,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      hash: false,
      center: [-98.5, 39.5],
      zoom: 3,
      transformRequest: (url) => tileRequest(url),
    });
  } catch (e) {
    return fallback(el, e && e.message);
  }
  if (interactive) {
    try {
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
      if (map.keyboard) map.keyboard.disableRotation();
    } catch (_) { /* controls are optional */ }
  }
  if (off) {
    const n = document.createElement("div");
    n.className = "note mapview-notiles";
    n.textContent = "Map tiles are off (demo)";
    el.appendChild(n);
  }
  map.on("error", (e) => { console.warn("map:", (e && e.error && e.error.message) || e); });

  const widths = WIDTHS[kind] || WIDTHS.trip;
  const pinRadius = kind === "pin" ? 10 : ["min", 18, ["+", 8, ["*", 2.2, ["ln", ["max", 1, ["coalesce", ["get", "n"], 1]]]]]];
  let data = { lines: EMPTY(), points: EMPTY(), markers: [], fit: null };
  let markers = [];
  let popup = null;
  let destroyed = false;
  let styleReady = false;   // set on style.load, cleared while a new style loads
  const pointCbs = [], lineCbs = [];

  function addOverlays() {
    if (destroyed || !styleReady) return;
    const upsert = (id, fc) => {
      const src = map.getSource(id);
      if (src) src.setData(fc); else map.addSource(id, { type: "geojson", data: fc });
    };
    upsert("tm-lines", data.lines || EMPTY());
    upsert("tm-points", data.points || EMPTY());
    const solid = ["!=", ["get", "interp"], true];
    if (!map.getLayer("tm-lines-casing")) {
      map.addLayer({ id: "tm-lines-casing", type: "line", source: "tm-lines", filter: solid,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0A0E1A", "line-opacity": 0.6, "line-width": widths.casing } });
    }
    if (!map.getLayer("tm-lines")) {
      map.addLayer({ id: "tm-lines", type: "line", source: "tm-lines", filter: solid,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["coalesce", ["get", "stroke"], PIN.ring], "line-width": widths.line } });
    }
    if (!map.getLayer("tm-lines-dash")) {
      map.addLayer({ id: "tm-lines-dash", type: "line", source: "tm-lines", filter: ["==", ["get", "interp"], true],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": ["coalesce", ["get", "stroke"], PIN.ring], "line-width": widths.line, "line-opacity": 0.85,
          "line-dasharray": [1.2, 1.2] } });
    }
    if (!map.getLayer("tm-points")) {
      map.addLayer({ id: "tm-points", type: "circle", source: "tm-points",
        paint: {
          "circle-radius": pinRadius,
          "circle-color": PIN.disc,
          "circle-stroke-color": ["case", ["==", ["get", "home"], true], PIN.home, PIN.ring],
          "circle-stroke-width": 2.5,
        } });
    }
  }

  function placeMarkers() {
    for (const m of markers) { try { m.remove(); } catch (_) { /* gone */ } }
    markers = [];
    for (const mk of data.markers || []) {
      if (!mk || !Array.isArray(mk.lngLat)) continue;
      const opts = { element: markerEl(mk.kind) };
      if (mk.kind === "end") { opts.anchor = "bottom-left"; opts.offset = [-4, 2]; }
      try { markers.push(new ml.Marker(opts).setLngLat(mk.lngLat).addTo(map)); } catch (_) { /* skip a bad marker */ }
    }
  }

  function fit() {
    if (!data.fit) return;
    try { map.fitBounds(data.fit, { padding: 40, maxZoom: 15, duration: 0 }); } catch (_) { /* degenerate bounds */ }
  }

  map.on("style.load", () => {
    styleReady = true;
    try { addOverlays(); } catch (e) { console.warn("map:", e && e.message); }
  });

  // Our own click delegation: query only the layers that exist right now.
  map.on("click", (e) => {
    const have = (ids) => ids.filter((id) => map.getLayer(id));
    const pts = have(["tm-points"]);
    let hit = pts.length ? map.queryRenderedFeatures(e.point, { layers: pts }) : [];
    if (hit.length && pointCbs.length) {
      const f = hit[0];
      const ll = f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
      for (const cb of pointCbs) cb({ ...(f.properties || {}) }, ll);
      return;
    }
    const lines = have(LINE_LAYERS);
    hit = lines.length ? map.queryRenderedFeatures(e.point, { layers: lines }) : [];
    if (hit.length && lineCbs.length) {
      for (const cb of lineCbs) cb({ ...(hit[0].properties || {}) }, [e.lngLat.lng, e.lngLat.lat]);
    }
  });
  const pointer = (on) => () => { if (interactive) map.getCanvas().style.cursor = on ? "pointer" : ""; };
  for (const id of ["tm-points", ...LINE_LAYERS]) {
    map.on("mouseenter", id, pointer(true));
    map.on("mouseleave", id, pointer(false));
  }

  const onTheme = (ev) => {
    const next = ev && ev.detail && (ev.detail.theme === "light" || ev.detail.theme === "dark") ? ev.detail.theme : pageTheme();
    if (destroyed || next === theme) return;
    theme = next;
    styleReady = false;
    try { map.setStyle(styleFor(theme, off), { diff: false }); } catch (e) { console.warn("map:", e && e.message); }
  };
  document.addEventListener("tm:theme", onTheme);

  return {
    setData({ lines, points, markers: mk, fit: bounds } = {}) {
      if (destroyed) return;
      data = { lines: lines || EMPTY(), points: points || EMPTY(), markers: mk || [], fit: bounds || null };
      if (styleReady) addOverlays();
      placeMarkers();
      fit();
    },
    onPointClick(cb) { if (typeof cb === "function") pointCbs.push(cb); },
    onLineClick(cb) { if (typeof cb === "function") lineCbs.push(cb); },
    popup(lngLat, html) {
      if (destroyed) return;
      if (popup) { try { popup.remove(); } catch (_) { /* gone */ } }
      popup = new ml.Popup({ closeButton: true, maxWidth: "300px", className: "mapview-popup" })
        .setLngLat(lngLat).setHTML(String(html ?? "")).addTo(map);
    },
    resize() { if (!destroyed) { try { map.resize(); fit(); } catch (_) { /* hidden */ } } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("tm:theme", onTheme);
      if (popup) { try { popup.remove(); } catch (_) { /* gone */ } }
      for (const m of markers) { try { m.remove(); } catch (_) { /* gone */ } }
      markers = [];
      try { map.remove(); } catch (_) { /* already gone */ }
    },
  };
}
