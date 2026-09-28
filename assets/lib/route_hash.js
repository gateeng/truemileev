// TrueMile EV web: the page's hash routes ("#/path/seg?key=value"). Pure, DOM-free.
//
// Path segments are returned exactly as they appear in the hash (still percent-encoded), because the
// views decode their own id segment with decodeURIComponent. Query values are decoded.
// A fragment that does not start with "#/" is never a route: it is the sign-in return
// ("#access_token=…" / "#error=…"), handled at boot, or nothing.
//
// The seven sections (spec 2.5): account, garage, financial, charge, map, report, settings. The first
// build's routes (#/dashboard, #/trips, #/journeys, #/charges, #/charts, #/exports) still work: the
// shell replaces them with their new address, the query carried over (legacyRedirect).

export const BUILD = "2026-09-27.3";

/** The sidebar's sections, in order. */
export const SECTIONS = Object.freeze(["account", "garage", "financial", "charge", "map", "report", "settings"]);
/** Where an unknown route lands. */
export const LANDING = "map";

/** True when [hash] is a page route ("#/…" or "#/"). */
export function isRoute(hash) {
  return typeof hash === "string" && hash.startsWith("#/");
}

/** "#/trips/abc?from=2026-09-01&car=other" -> {path:["trips","abc"], query:{from:"2026-09-01", car:"other"}} */
export function parseHash(hash) {
  if (!isRoute(hash)) return { path: [], query: {} };
  const body = hash.slice(2);
  const q = body.indexOf("?");
  const pathPart = q < 0 ? body : body.slice(0, q);
  const queryPart = q < 0 ? "" : body.slice(q + 1);
  const path = pathPart.split("/").filter((s) => s !== "");
  const query = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) {
      if (k && !(k in query)) query[k] = v;
    }
  }
  return { path, query };
}

/**
 * The inverse: path segments (already encoded, or plain words) and a query object -> "#/a/b?k=v".
 * Keys are sorted; null, undefined and "" values are dropped.
 */
export function formatHash(path, query) {
  const segs = (Array.isArray(path) ? path : String(path || "").split("/")).map(String).filter((s) => s !== "");
  const u = new URLSearchParams();
  for (const k of Object.keys(query || {}).sort()) {
    const v = query[k];
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const qs = u.toString();
  return "#/" + segs.join("/") + (qs ? "?" + qs : "");
}

/** The same hash with its query re-ordered and emptied keys dropped (so two spellings compare equal). */
export function normalizeHash(hash) {
  const p = parseHash(hash);
  return formatHash(p.path, p.query);
}

const CHART_TO = { cost: ["financial"], money: ["financial"], temp: ["garage"], drain: ["garage"] };

/**
 * The first build's routes -> {path, query} of the new address (the query carried over), else null
 * (the route is current, or unknown: the shell sends an unknown route to #/map itself).
 *   #/, #/dashboard -> #/map · #/trips -> #/map?tab=trips · #/trips/<id> -> #/map/trip/<id>
 *   #/journeys -> #/map?tab=journeys · #/journeys/<jid> -> #/map/journey/<jid>
 *   #/charges -> #/charge · #/charges/<id> -> #/charge/<id>
 *   #/charts?chart=cost|money -> #/financial · temp|drain -> #/garage?tab=insights · other -> #/map
 *   #/exports -> #/report
 */
export function legacyRedirect(path, query) {
  const p = Array.isArray(path) ? path : [];
  const q = { ...(query || {}) };
  const [a, b] = p;
  switch (a) {
    case undefined:
    case "dashboard":
      return { path: ["map"], query: q };
    case "trips":
      return b ? { path: ["map", "trip", b], query: q } : { path: ["map"], query: { ...q, tab: "trips" } };
    case "journeys":
      return b ? { path: ["map", "journey", b], query: q } : { path: ["map"], query: { ...q, tab: "journeys" } };
    case "charges":
      return b ? { path: ["charge", b], query: q } : { path: ["charge"], query: q };
    case "charts": {
      const to = CHART_TO[q.chart];
      if (to && to[0] === "garage") return { path: ["garage"], query: { ...q, tab: "insights" } };
      if (to) return { path: ["financial"], query: q };
      return { path: ["map"], query: q };
    }
    case "exports":
      return { path: ["report"], query: q };
    default:
      return null;
  }
}

/**
 * The section a path belongs to (the sidebar's highlighted item): one of SECTIONS. The print routes
 * belong to Report; a first-build route to the section it now lives in; anything else to the landing.
 */
export function sectionOf(path) {
  const p = Array.isArray(path) ? path : [];
  const moved = legacyRedirect(p, {});
  const a = (moved ? moved.path : p)[0];
  if (a === "print") return "report";
  return SECTIONS.includes(a) ? a : LANDING;
}
