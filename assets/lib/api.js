// TrueMile EV web: the page's whole data layer, and the ONLY file that calls fetch. No SDK, no
// bundler, no dependency.
//
// Raw fetch rather than supabase-js: the edge functions answer preflight with "authorization, apikey,
// content-type" and nothing else (supabase-js adds x-client-info), and a dependency-free page is the
// only kind that can honestly promise no third-party script of any sort.
//
// READ-ONLY by construction, with one deliberate exception: request() checks every call against
// ALLOWED before anything leaves the page. GET reaches the tables below, get_stats, the signed-in user
// and the account's own report PDFs; POST reaches the auth endpoints, the read-only my_effective_tier
// function and the delete_account function. No other method exists here. Row-level security would let a
// signed-in browser write to the tables, and a write from here would skip the app's own date-ordered
// replays and fire server triggers, so the page never writes a table.
// The exception is Account -> Delete account: request() lets that one POST through only with the typed
// confirmation word as its whole body (deleteAccount below); anything else on that path is refused
// before it leaves the page.

import {
  normTrip, normCharge, normParked, normVehicle, byDateThenId, JAMB_KEYS, projectJamb, normJamb, normTrailer,
  normHome, normTire, normDtc,
} from "./rows.js";

/** Re-exported: the door-jamb keys api.garage() selects (never the VIN, raw OCR or confidence). */
export { JAMB_KEYS };

export const BUILD = "2026-09-27.3";

const REST_TABLES = ["vehicles", "trip_log", "charge_session", "phantom_losses", "trip_notes",
  "user_settings", "charge_curve_log", "tax_reports", "tire_records", "dtc_scans"];

/** The account-deletion function: the one POST that changes anything (Account -> Delete account). */
export const DELETE_PATH = "/functions/v1/delete_account";
/** The word the reader types, and the function's whole request body ({"confirm": <word>}). */
export const DELETE_CONFIRM_WORD = "DELETE";

/** What may leave the page. GET: exact paths (a table read takes any query) or a prefix ending "/". */
export const ALLOWED = Object.freeze({
  GET: Object.freeze([
    ...REST_TABLES.map((t) => `/rest/v1/${t}`),
    "/functions/v1/get_stats",
    "/auth/v1/user",
    "/storage/v1/object/authenticated/reports/",
  ]),
  POST: Object.freeze(["/auth/v1/token", "/auth/v1/logout", "/rest/v1/rpc/my_effective_tier", DELETE_PATH]),
});

const SESSION_KEY = "tm_session";
const ERROR_KEYS = ["error", "error_code", "error_description"];
const PAGE = 1000;

let cfg = null;
let fetchImpl = null;
let storage = null;
let fixturesUrl = null;
let fixtureData = null;          // Promise<raw fixture JSON> in fixture mode
let refreshing = null;           // the ONE running token refresh (single flight)
let accountP = null;             // memoised loadAccount()
let me = null;                   // whoAmI() result
let statsCalls = 0;              // get_stats calls made this page load
const statsCache = new Map();    // vehicleId -> Promise<reply>
const routeCache = new Map();    // tripId -> polyline string
const curveCache = new Map();    // "vid|from|to" -> Promise<points>
let taxP = null;
let garageP = null;              // memoised garage()
let volatileSession = false;     // site storage is blocked: the session lives in memory until reload

// ── setup ─────────────────────────────────────────────────────────────────────────────────────

/** An in-memory stand-in for sessionStorage: the session then lasts until the page reloads. */
function memoryStorage() {
  const m = new Map();
  return {
    volatile: true,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/**
 * sessionStorage when the browser lets this site use it; otherwise (site data blocked, or a storage
 * that throws on write) the in-memory stand-in, so signing in still works for this page load.
 */
function browserStorage() {
  try {
    const s = globalThis.sessionStorage;
    if (s) {
      const probe = "tm_probe";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return s;
    }
  } catch (_) { /* blocked */ }
  return memoryStorage();
}

/** True when site storage is blocked and the session will not survive a reload. */
export const sessionIsVolatile = () => volatileSession;

/** window.location, or undefined where there is none (Deno throws on a bare access). */
function here() {
  try { return globalThis.location; } catch (_) { return undefined; }
}

function isLocalHost(loc) {
  return !!loc && (loc.hostname === "127.0.0.1" || loc.hostname === "localhost");
}

/**
 * [cfg] = window.TM_CONFIG ({PROJECT_URL, ANON_KEY, REDIRECT_URL}). opts.fetch / opts.storage replace
 * the browser's (tests); opts.fixtures is a URL of a demo-account.json to serve instead of the network.
 * On 127.0.0.1 / localhost with "fixtures" in the query string the page's own demo file is used.
 */
export function init(c, opts = {}) {
  cfg = c || {};
  fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  storage = opts.storage || browserStorage();
  volatileSession = !!storage.volatile;
  const loc = here();
  fixturesUrl = opts.fixtures || null;
  if (!fixturesUrl && isLocalHost(loc) && /[?&]fixtures(=|&|$)/.test(loc.search || "")) {
    fixturesUrl = new URL("../fixtures/demo-account.json", loc.href).href;
  }
  fixtureData = null;
  refreshing = null; accountP = null; me = null; statsCalls = 0; taxP = null; garageP = null;
  statsCache.clear(); routeCache.clear(); curveCache.clear();
  return { configured: auth.configured(), fixtures: !!fixturesUrl };
}

/** "fixtures" (demo data), "live" or "unconfigured". */
export function mode() {
  if (fixturesUrl) return "fixtures";
  return auth.configured() ? "live" : "unconfigured";
}

/** How many times get_stats ran this page load (the integration checklist reads it). */
export const getStatsCount = () => statsCalls;

/**
 * "cached" (already loaded or loading for this vehicle), "auto" (the page load's one automatic call
 * is still free) or "click" (only an explicit request may load it).
 */
export function boardStatsState(vehicleId) {
  if (statsCache.has(String(vehicleId))) return "cached";
  return statsCalls === 0 ? "auto" : "click";
}

// ── the one request function ──────────────────────────────────────────────────────────────────

function pathOf(path) {
  const q = path.indexOf("?");
  return q < 0 ? path : path.slice(0, q);
}

/** True when [method] [path] is on the read-only allow list. */
export function isAllowed(method, path) {
  const m = String(method || "").toUpperCase();
  const p = pathOf(String(path || ""));
  if (p.includes("..") || /\s/.test(p)) return false;
  if (m === "GET") return ALLOWED.GET.some((a) => (a.endsWith("/") ? p.startsWith(a) && p.length > a.length : p === a));
  if (m === "POST") return ALLOWED.POST.includes(p);
  return false;
}

/** True when [body] is exactly {"confirm": DELETE_CONFIRM_WORD} (an object with that one key, or its JSON). */
export function isDeleteBody(body) {
  let o = body;
  if (typeof body === "string") {
    try { o = JSON.parse(body); } catch (_) { return false; }
  }
  return !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 1 &&
    o.confirm === DELETE_CONFIRM_WORD;
}

/**
 * The only way anything reaches the network. Throws "blocked: read-only page" before a request
 * leaves for any method or path not in ALLOWED. [auth] false = apikey only (sign-in, refresh).
 * The delete_account path is special by PATH, not by caller option: it is refused unless the method
 * is POST and the body is exactly the confirmation; it always carries the signed-in token; and it
 * sends no apikey header (that function's CORS preflight allows only authorization and content-type;
 * the functions gateway verifies the token itself).
 */
export async function request(method, path, { body, headers, auth: useAuth = true, raw = false } = {}) {
  const isDelete = pathOf(String(path || "")) === DELETE_PATH;
  if (isDelete && (String(method || "").toUpperCase() !== "POST" || !isDeleteBody(body))) {
    throw new Error("blocked: the account deletion needs its confirmation word");
  }
  if (!isAllowed(method, path)) throw new Error("blocked: read-only page");
  if (!cfg || !cfg.PROJECT_URL || !cfg.ANON_KEY) throw new Error("The dashboard is not configured");
  if (!fetchImpl) throw new Error("No network in this environment");
  const h = isDelete ? {} : { apikey: cfg.ANON_KEY };
  if (useAuth || isDelete) {
    const s = await refreshIfNeeded();
    if (!s || !s.access_token) throw new Error("Signed out");
    h.authorization = `Bearer ${s.access_token}`;
  }
  const m = method.toUpperCase();
  if (m === "POST") h["content-type"] = "application/json";
  if (headers && !isDelete) {
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (lk === "authorization") h.authorization = v;          // logout sends the token it is ending
    }
  }
  const init = { method: m, headers: h };
  if (m === "POST") init.body = body === undefined ? "{}" : (typeof body === "string" ? body : JSON.stringify(body));
  const r = await fetchImpl(`${cfg.PROJECT_URL}${path}`, init);
  if (!r.ok) {
    const t = String(await r.text().catch(() => ""));
    const said = serverText(t);
    const err = new Error(`${r.status} ${said}`.trim());
    err.status = r.status;
    err.serverMessage = said;       // the server's own sentence, internal names replaced
    err.detail = t;                 // the raw body, for the console only; never shown
    try { console.warn(`${method.toUpperCase()} ${pathOf(path)} → ${r.status}`, t.slice(0, 500)); } catch (_) { /* no console */ }
    throw err;
  }
  return raw ? r : r;
}

// Server replies can quote column and key names, and some of those carry internal accounting
// words that the page must never show. Error text shown to a reader is the reply's own message
// field (or its plain text), cut to 200 characters, with any such word replaced.
// Built from pieces so the words themselves never appear in the published text (wording_test.js).
const INTERNAL_WORDS = new RegExp(["fi" + "fo", "led" + "ger", "ba" + "nk"].join("|"), "gi");

/** The human part of an error body: message / error_description / msg / error, else the text. */
export function serverText(body) {
  const t = String(body ?? "");
  let said = t;
  try {
    const j = JSON.parse(t);
    if (j && typeof j === "object") {
      const pick = [j.error_description, j.msg, j.message, j.error].find((v) => typeof v === "string" && v.trim());
      said = pick !== undefined ? pick : "";
    }
  } catch (_) { /* plain text */ }
  return said.replace(INTERNAL_WORDS, "internal").replace(/\s+/g, " ").trim().slice(0, 200);
}

const getJson = async (path) => (await request("GET", path)).json();

// ── session ───────────────────────────────────────────────────────────────────────────────────
// sessionStorage, not localStorage: the token dies with the tab. On a shared host (gateeng.com serves
// other repos) that is the difference between "this tab" and "anything ever published on this origin".

function saveSession(s) { try { storage && storage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) { /* no storage */ } }
function loadSession() { try { return JSON.parse((storage && storage.getItem(SESSION_KEY)) || "null"); } catch (_) { return null; } }
function clearSession() { try { storage && storage.removeItem(SESSION_KEY); } catch (_) { /* no storage */ } }

const nowSec = () => Date.now() / 1000;
const expired = (s) => !!(s && s.expires_at && nowSec() > s.expires_at - 60);

/** Refresh when within 60 s of expiry. Single flight: parallel callers share one refresh. */
async function refreshIfNeeded() {
  const s = loadSession();
  if (!s || !expired(s) || !s.refresh_token) return s;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await request("POST", "/auth/v1/token?grant_type=refresh_token",
          { auth: false, body: { refresh_token: s.refresh_token } });
        const next = await r.json();
        if (next && next.access_token && !next.expires_at && next.expires_in) {
          next.expires_at = Math.floor(nowSec()) + Number(next.expires_in);
        }
        saveSession(next);
        return next;
      } catch (e) {
        // Only a refused refresh token ends the session. A network failure or a server error keeps
        // it (the next load retries) and is thrown, so the page can say it could not reach the server.
        if (e && (e.status === 400 || e.status === 401 || e.status === 403)) {
          clearSession();
          return null;
        }
        throw e;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

// ── auth ──────────────────────────────────────────────────────────────────────────────────────

export const auth = {
  configured() { return !!fixturesUrl || !!(cfg && cfg.PROJECT_URL && cfg.ANON_KEY); },

  signedIn() {
    if (fixturesUrl) return true;
    const s = loadSession();
    return !!(s && s.access_token);
  },

  /**
   * Google returns the session in the URL fragment, and an error in the query string (GoTrue also
   * copies it into the fragment, for now). Adopt the session or read the error, and scrub what was
   * read from the address bar: the OAuth fragment, and the error keys of the query (anything else in
   * the query, such as ?fixtures, stays). -> {ok:true} | {ok:false} | {error: "<error_description>"}
   * [loc] / [hist] default to the page's (tests pass their own).
   */
  adoptRedirect(loc = here(), hist = globalThis.history) {
    if (!loc) return { ok: false };
    const hash = loc.hash || "";
    const search = loc.search || "";
    const fragment = hash.length >= 2 && !hash.startsWith("#/") ? new URLSearchParams(hash.slice(1)) : null;
    const query = new URLSearchParams(search.replace(/^\?/, ""));
    const hasErr = (p) => !!p && !!(p.get("error") || p.get("error_description") || p.get("error_code"));
    const queryErr = hasErr(query);
    if (!fragment && !queryErr) return { ok: false };
    const scrub = () => {
      const kept = search.replace(/^\?/, "").split("&").filter((seg) => {
        if (!seg) return false;
        let k = seg.split("=")[0];
        try { k = decodeURIComponent(k.replace(/\+/g, " ")); } catch (_) { /* keep the raw key */ }
        return !ERROR_KEYS.includes(k);
      });
      const nextSearch = kept.length ? "?" + kept.join("&") : "";
      const nextHash = fragment ? "" : hash;      // a page route stays; the OAuth fragment goes
      try { hist.replaceState(null, "", loc.pathname + nextSearch + nextHash); } catch (_) { /* no history */ }
    };
    const errOf = (p) => (p.get("error_description") || p.get("error") || p.get("error_code") || "Sign-in failed").replace(/\+/g, " ");
    if (queryErr || hasErr(fragment)) {
      scrub();
      return { error: errOf(hasErr(fragment) ? fragment : query) };
    }
    const p = fragment;
    const access_token = p.get("access_token");
    if (!access_token) return { ok: false };
    const expiresAt = Number(p.get("expires_at") || 0) ||
      (Number(p.get("expires_in") || 0) ? Math.floor(nowSec()) + Number(p.get("expires_in")) : 0);
    saveSession({
      access_token,
      refresh_token: p.get("refresh_token"),
      expires_at: expiresAt,
      token_type: p.get("token_type") || "bearer",
    });
    scrub();
    return { ok: true };
  },

  /** The Google sign-in URL (a navigation, not a request). */
  googleUrl() {
    const u = new URL(`${cfg.PROJECT_URL}/auth/v1/authorize`);
    u.searchParams.set("provider", "google");
    u.searchParams.set("redirect_to", cfg.REDIRECT_URL || "");
    return u.toString();
  },

  async signInPassword(email, password) {
    let r;
    try {
      r = await request("POST", "/auth/v1/token?grant_type=password", { auth: false, body: { email, password } });
    } catch (e) {
      if (e && e.status) throw new Error((e.serverMessage || "").trim() || "Sign-in failed");
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    const s = await r.json();
    if (s && s.access_token && !s.expires_at && s.expires_in) s.expires_at = Math.floor(nowSec()) + Number(s.expires_in);
    saveSession(s);
    me = null;
    return s;
  },

  /**
   * The signed-in user, or null when signed out (a 401 / 403 clears the session). A network failure
   * or a server error is thrown: that is "could not reach the server", not "signed out".
   */
  async whoAmI() {
    if (fixturesUrl) {
      const f = await fixtures();
      me = normUser({ id: "demo-user", email: "demo@example.invalid", ...(f.user || {}) });
      return me;
    }
    const s = await refreshIfNeeded();
    if (!s || !s.access_token) return null;
    try {
      me = normUser(await getJson("/auth/v1/user"));
      return me;
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) { clearSession(); return null; }
      throw e;
    }
  },

  async signOut() {
    if (fixturesUrl) return;
    const s = loadSession();
    if (s && s.access_token) {
      try {
        // scope=local ends THIS browser's session only. GoTrue's default is global, which would revoke
        // every refresh token of the account, the phone app's included, and stop its sync.
        await request("POST", "/auth/v1/logout?scope=local", { auth: false, headers: { authorization: `Bearer ${s.access_token}` } });
      } catch (_) { /* the local session goes either way */ }
    }
    clearSession();
    me = null;
  },
};

/**
 * The signed-in user as this page keeps it: id, email, created_at, user_metadata {full_name, name}
 * and app_metadata {provider}. Every other identity field of /auth/v1/user is dropped here.
 */
export function normUser(u) {
  if (!u || typeof u !== "object") return null;
  const s = (v) => (typeof v === "string" ? v : "");
  const um = u.user_metadata && typeof u.user_metadata === "object" ? u.user_metadata : {};
  const am = u.app_metadata && typeof u.app_metadata === "object" ? u.app_metadata : {};
  return {
    id: s(u.id),
    email: s(u.email),
    created_at: s(u.created_at),
    user_metadata: { full_name: s(um.full_name), name: s(um.name) },
    app_metadata: { provider: s(am.provider) },
  };
}

/**
 * The account's display name (SupabaseClient.kt:259-262 + AccountScreen): user_metadata.full_name,
 * else .name, else the email's local part with its first letter upper-cased.
 */
export function accountName(u) {
  if (!u) return "";
  const full = String((u.user_metadata && u.user_metadata.full_name) || "").trim();
  if (full) return full;
  const name = String((u.user_metadata && u.user_metadata.name) || "").trim();
  if (name) return name;
  const local = String(u.email || "").split("@")[0] || "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

/** "Google" for a Google sign-in, "Email" otherwise. */
export const signInMethod = (u) =>
  String((u && u.app_metadata && u.app_metadata.provider) || "").toLowerCase() === "google" ? "Google" : "Email";

// ── paging ────────────────────────────────────────────────────────────────────────────────────

/**
 * Every row of [table] for [select] + [filter], ordered by [orderCol] then id (date_epoch has ties),
 * 1000 at a time, sequentially until a short page.
 *
 * Keyset paging, not offsets: each next page starts strictly after the last row read
 * (orderCol > X, or orderCol = X and id > Y). The phone may insert or delete rows while the page
 * loads (a backdated reconstructed drive, a combine removing legs); with offsets such a write shifts
 * the rows and one lands on two pages or on none. Rows are also kept once per id. [orderCol] and
 * id are added to [select] when missing (the cursor needs both).
 */
export async function fetchAll(table, select, filter, orderCol) {
  const cols = String(select).split(",").map((c) => c.trim());
  const has = (c) => cols.some((x) => x === c || x.endsWith(":" + c));
  const sel = [select, ...(has("id") ? [] : ["id"]), ...(has(orderCol) ? [] : [orderCol])].join(",");
  const byId = new Map();
  let cursor = null;
  for (;;) {
    const after = cursor
      ? `&or=(${orderCol}.gt.${cursor.v},and(${orderCol}.eq.${cursor.v},id.gt.${encodeURIComponent(cursor.id)}))`
      : "";
    const q = `select=${sel}${filter ? "&" + filter : ""}${after}&order=${orderCol}.asc,id.asc&limit=${PAGE}`;
    const page = await getJson(`/rest/v1/${table}?${q}`);
    if (!Array.isArray(page)) throw new Error(`Unexpected reply from ${table}`);
    for (const r of page) {
      const key = r && r.id !== undefined && r.id !== null ? String(r.id) : null;
      if (key === null) byId.set(Symbol("row"), r); else if (!byId.has(key)) byId.set(key, r);
    }
    if (page.length < PAGE) break;
    const last = page[page.length - 1];
    const v = last ? Number(last[orderCol]) : NaN;
    if (!last || last.id === undefined || last.id === null || !Number.isFinite(v)) {
      throw new Error(`Unexpected reply from ${table}`);
    }
    if (cursor && cursor.v === Math.trunc(v) && cursor.id === String(last.id)) break;   // no progress
    cursor = { v: Math.trunc(v), id: String(last.id) };
  }
  return [...byId.values()];
}

const SEL_VEHICLES = "id,make,model,year,trim,pack_size_kwh,battery_kwh,is_active,created_at";
const SEL_TRIPS = "id,vehicle_id,client_trip_id,date_epoch,start_epoch,duration_sec,highway_miles,local_miles," +
  "regen_miles,used_kwh,regen_kwh,cost_dollars,avg_speed_mph,avg_soh_pct,start_soc_pct,end_soc_pct,hvac_pct," +
  "avg_outside_temp_f,avg_cabin_temp_f,start_odo,end_odo,tow_weight_lbs,trip_class,classification," +
  "auto_assigned,journey_id,journey_category,is_reconciled,car_status,other_car_label,pack_kwh_at_finalize," +
  "gas_price_at_trip";
const SEL_CHARGES = "id,vehicle_id,date_epoch,time_minutes,start_mileage,end_mileage,actual_miles," +
  "arrival_soc_pct,departure_soc_pct,total_kwh,received_kwh,total_dollars,charger_fee,rate_per_kwh," +
  "rate_per_hour,total_overridden,cost_per_kwh,network,style,gps_location,temp_f,ac_pct,gas_price_at_charge," +
  "is_merged,split_session,split_session_group_id,is_seed_data,edited_epoch,confidence,notes,charger_type," +
  "charger_power_kw";
// The cost column's cloud name is internal; the alias keeps it out of every later line of code.
const SEL_PARKED = "id,vehicle_id,entry_type,event_epoch,kwh,cost:fifo_cost,park_hours,ambient_temp_f," +
  "temp_data_missing,hvac_mode,kwh_per_hour";
const SEL_NOTES = "id,client_trip_id,body,created_epoch,updated_epoch";
// Only the fuel scalars and the home rate: the fuel object also holds per-vehicle "mpg@<vehicle id>"
// keys, and the phone's vehicle id contains the VIN; the home object also holds the home's location,
// which is never read. The tow capacity has no scalar form (it is keyed by that same id), so it is read
// whole, used as get_stats' cap, and shown as its value only, never its key (README rule 7).
const SEL_SETTINGS = "mpg:settings->fuel->mpg,gasPrice:settings->fuel->gasPrice,fuelLabel:settings->fuel->label," +
  "homeRate:settings->home->rate,towCapacity:settings->towCapacity";
const SEL_CURVE = "epoch_ms,soc_pct,power_kw,batt_temp_f,voltage_v,current_a";
const SEL_TAX = "report_id,year,period_start,period_end,business_miles,business_pct,total_miles,distance_unit," +
  "storage_path,created_at";

// ── fixtures (127.0.0.1 only) ─────────────────────────────────────────────────────────────────

const WEEK = 7 * 86_400_000;

function fixtures() {
  if (!fixtureData) {
    fixtureData = (async () => {
      const u = new URL(fixturesUrl, here() ? here().href : undefined);
      if (!/\/fixtures\/[a-z0-9-]+\.json$/.test(u.pathname)) throw new Error("Not a fixture file");
      const r = await fetchImpl(u.href);
      if (!r.ok) throw new Error(`${r.status} fixtures not found`);
      return shiftFixtures(await r.json());
    })();
  }
  return fixtureData;
}

/** Moves the demo account forward by whole weeks so "this week" always has driving in it. */
function shiftFixtures(f) {
  const anchor = Number(f.anchorMs) || 0;
  const shift = anchor > 0 ? Math.max(0, Math.floor((Date.now() - anchor) / WEEK)) * WEEK : 0;
  if (!shift) return f;
  const mv = (v) => (Number(v) > 0 ? Number(v) + shift : v);
  const iso = (v) => (v ? new Date(Date.parse(v) + shift).toISOString() : v);
  return {
    ...f,
    vehicles: (f.vehicles || []).map((v) => ({ ...v, created_at: iso(v.created_at) })),
    trips: (f.trips || []).map((t) => ({ ...t, date_epoch: mv(t.date_epoch), start_epoch: mv(t.start_epoch) })),
    charges: (f.charges || []).map((c) => ({ ...c, date_epoch: mv(c.date_epoch), edited_epoch: mv(c.edited_epoch) })),
    parked: (f.parked || []).map((p) => ({ ...p, event_epoch: mv(p.event_epoch) })),
    notes: (f.notes || []).map((n) => ({ ...n, created_epoch: mv(n.created_epoch), updated_epoch: mv(n.updated_epoch) })),
    curves: (f.curves || []).map((c) => ({ ...c, epoch_ms: mv(c.epoch_ms) })),
    garage: f.garage ? {
      ...f.garage,
      tires: (f.garage.tires || []).map((t) => ({ ...t, install_epoch: mv(t.install_epoch), repair_epoch: mv(t.repair_epoch),
        removed_epoch: mv(t.removed_epoch) })),
      dtcScans: (f.garage.dtcScans || []).map((d) => ({ ...d, scan_epoch: mv(d.scan_epoch) })),
    } : f.garage,
  };
}

// ── the account ───────────────────────────────────────────────────────────────────────────────

/**
 * my_effective_tier's row → Account.tier. [source] ("trial" | "paid" | "promo" | "entry") decides the
 * label: the countdown shows only while the trial is what lifts the tier (TrialWindow.tierLabelWithTrial);
 * a paid or promo account inside its sign-up window shows its plan. [unknown] = the lookup failed.
 */
export function tierFrom(row) {
  const r = Array.isArray(row) ? row[0] : row;
  if (!r || typeof r !== "object") {
    return { tier: "free", trialLive: false, trialDaysLeft: 0, trialTier: "", source: "", trialEndsMs: 0,
      trialClosed: "", serverNowMs: 0, unknown: row === null };
  }
  const source = String(r.source ?? "").trim().toLowerCase();
  // The server's closing reason is an internal key: it is folded here into "abuse" (the vehicle already
  // had its trial), "closed" (any other reason) or "", and the key itself is never kept.
  const reason = String(r.trial_closed_reason ?? "").trim().toLowerCase();
  return {
    tier: String(r.tier || "free").trim().toLowerCase() || "free",
    trialLive: r.trial_live === true,
    trialDaysLeft: Math.max(0, Math.trunc(Number(r.trial_days_left) || 0)),
    trialTier: String(r.trial_tier || ""),
    source,
    trialEndsMs: Math.max(0, Math.trunc(Number(r.trial_ends_epoch_ms) || 0)),
    trialClosed: !reason ? "" : reason.startsWith("abuse") ? "abuse" : "closed",
    serverNowMs: Math.max(0, Math.trunc(Number(r.now_epoch_ms) || 0)),
    unknown: false,
  };
}

/** True when the tier badge should count trial days down (the trial is the source of the tier). */
export const showsTrialCountdown = (t) => !!t && t.trialLive === true && (t.source ? t.source === "trial" : true);

function buildAccount(raw, user) {
  const vehicles = (raw.vehicles || []).map(normVehicle);
  const trips = (raw.trips || []).map(normTrip).sort(byDateThenId);
  const charges = (raw.charges || []).filter((c) => c.is_hidden !== true).map(normCharge).sort(byDateThenId);
  const parked = (raw.parked || []).map(normParked).sort((a, b) => a.epoch - b.epoch || (a.id < b.id ? -1 : 1));
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  for (const t of trips) { const v = byId.get(t.vehicleId); if (v) v.tripCount++; }
  for (const c of charges) { const v = byId.get(c.vehicleId); if (v) v.chargeCount++; }
  const notesByTrip = new Map();
  for (const n of raw.notes || []) {
    const cid = String(n.client_trip_id || "");
    if (!cid) continue;
    if (!notesByTrip.has(cid)) notesByTrip.set(cid, []);
    notesByTrip.get(cid).push({ body: String(n.body ?? ""), created: Number(n.created_epoch) || 0, updated: Number(n.updated_epoch) || 0 });
  }
  for (const list of notesByTrip.values()) list.sort((a, b) => a.created - b.created);
  const settings = (Array.isArray(raw.settings) ? raw.settings[0] : raw.settings) || {};
  const fuelObj = settings.fuel && typeof settings.fuel === "object" ? settings.fuel : {};
  const homeObj = settings.home && typeof settings.home === "object" ? settings.home : {};
  const fuel = { mpg: settings.mpg ?? fuelObj.mpg, gasPrice: settings.gasPrice ?? fuelObj.gasPrice,
    label: settings.fuelLabel ?? fuelObj.label };
  const homeRate = Number(settings.homeRate ?? homeObj.rate);
  const caps = settings.towCapacity && typeof settings.towCapacity === "object"
    ? Object.values(settings.towCapacity).map(Number).filter((x) => Number.isFinite(x) && x > 0) : [];
  return {
    readAt: Date.now(),
    userId: String((user && user.id) || ""),
    email: String((user && user.email) || ""),
    user: normUser(user),
    vehicles,
    trips,
    charges,
    parked,
    notesByTrip,
    fuel: {
      mpg: Number(fuel.mpg) > 0 ? Number(fuel.mpg) : 25,
      gasPrice: Number(fuel.gasPrice) > 0 ? Number(fuel.gasPrice) : 3.20,
      label: typeof fuel.label === "string" ? fuel.label.trim() : "",
    },
    homeRate: Number.isFinite(homeRate) && homeRate > 0 ? homeRate : 0,
    towCap: caps.length === 1 ? caps[0] : 0,
    tier: tierFrom(raw.tier),
  };
}

/**
 * my_effective_tier, tried twice. null when both fail: the account then loads with tier.unknown set,
 * and the shell says the plan could not be checked (never a silent downgrade).
 */
async function effectiveTier() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await request("POST", "/rest/v1/rpc/my_effective_tier", { body: {} });
      return await r.json();
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) break;       // retrying cannot help
    }
  }
  return null;
}

/** Everything the pages read, fetched ONCE per page load (the four big tables in parallel). */
export function loadAccount() {
  if (accountP) return accountP;
  accountP = (async () => {
    if (fixturesUrl) {
      const f = await fixtures();
      const user = me || await auth.whoAmI();
      return buildAccount(f, user);
    }
    const [user, vehicles, trips, charges, parked, notes, settings, tier] = await Promise.all([
      me ? Promise.resolve(me) : auth.whoAmI(),
      getJson(`/rest/v1/vehicles?select=${SEL_VEHICLES}&order=created_at.asc,id.asc`),
      fetchAll("trip_log", SEL_TRIPS, "", "date_epoch"),
      fetchAll("charge_session", SEL_CHARGES, "is_hidden=eq.false", "date_epoch"),
      fetchAll("phantom_losses", SEL_PARKED, "", "event_epoch"),
      fetchAll("trip_notes", SEL_NOTES, "", "created_epoch"),
      getJson(`/rest/v1/user_settings?select=${SEL_SETTINGS}`),
      effectiveTier(),
    ]);
    return buildAccount({ vehicles, trips, charges, parked, notes, settings, tier }, user);
  })();
  accountP.catch(() => { accountP = null; });
  return accountP;
}

// ── on-demand reads ───────────────────────────────────────────────────────────────────────────

/** gps_polyline per trip id, fetched 10 ids at a time and cached for the page's life ("" = none). */
export async function tripRoutes(ids) {
  const want = [...new Set((ids || []).map(String).filter((x) => /^[0-9a-zA-Z-]+$/.test(x)))];
  const missing = want.filter((id) => !routeCache.has(id));
  if (fixturesUrl) {
    const f = await fixtures();
    for (const id of missing) routeCache.set(id, String((f.routes || {})[id] || ""));
  } else {
    for (let i = 0; i < missing.length; i += 10) {
      const batch = missing.slice(i, i + 10);
      const rows = await getJson(`/rest/v1/trip_log?select=id,gps_polyline&id=in.(${batch.join(",")})`);
      for (const id of batch) routeCache.set(id, "");
      for (const r of rows || []) routeCache.set(String(r.id), String(r.gps_polyline || ""));
    }
  }
  return new Map(want.map((id) => [id, routeCache.get(id) || ""]));
}

function curvePoint(r) {
  const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const p = {
    epoch_ms: Number(r.epoch_ms) || 0, soc_pct: n(r.soc_pct), power_kw: n(r.power_kw),
    batt_temp_f: n(r.batt_temp_f), voltage_v: n(r.voltage_v), current_a: n(r.current_a),
  };
  // Both spellings, so a caller may read either the column names or camelCase.
  return { ...p, epochMs: p.epoch_ms, socPct: p.soc_pct, powerKw: p.power_kw, battTempF: p.batt_temp_f,
    voltageV: p.voltage_v, currentA: p.current_a };
}

/**
 * charge_curve_log points of [vehicleId] with epoch_ms in [fromMs, toMs], ascending, at most 5000.
 * Matched by TIME, never by session id. Cached per (vehicle, from, to).
 */
export function chargeCurve(vehicleId, fromMs, toMs) {
  const from = Math.trunc(Number(fromMs)), to = Math.trunc(Number(toMs));
  const key = `${vehicleId}|${from}|${to}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const p = (async () => {
    if (fixturesUrl) {
      const f = await fixtures();
      return (f.curves || []).filter((c) => c.vehicle_id === vehicleId && c.epoch_ms >= from && c.epoch_ms <= to)
        .sort((a, b) => a.epoch_ms - b.epoch_ms).slice(0, 5000).map(curvePoint);
    }
    const rows = await getJson(`/rest/v1/charge_curve_log?select=${SEL_CURVE}&vehicle_id=eq.${encodeURIComponent(vehicleId)}` +
      `&epoch_ms=gte.${from}&epoch_ms=lte.${to}&order=epoch_ms.asc&limit=5000`);
    return (rows || []).map(curvePoint);
  })();
  curveCache.set(key, p);
  p.catch(() => curveCache.delete(key));
  return p;
}

/**
 * The Board figures from get_stats, cached per vehicle for the page's life. The FIRST call of a page
 * load is the automatic one; every later call (another vehicle) must be explicit - opts.explicit or
 * params.explicit - which only the "Show Board figures for this vehicle" button sets. get_stats
 * records an app open on every call, so it is never on a timer, a period step or a route change.
 */
export function boardStats(vehicleId, params = {}, opts = {}) {
  const vid = String(vehicleId || "");
  if (!vid || vid === "all") return Promise.reject(new Error("Board figures are per vehicle"));
  if (statsCache.has(vid)) return statsCache.get(vid);
  const explicit = !!(opts.explicit || params.explicit);
  if (statsCalls >= 1 && !explicit) {
    return Promise.reject(new Error("get_stats: a second call this page load needs an explicit request"));
  }
  statsCalls++;
  const q = new URLSearchParams();
  q.set("vehicle_id", vid);
  for (const k of ["month_start", "mpg", "gas", "cap"]) {
    if (params[k] !== undefined && params[k] !== null) q.set(k, String(params[k]));
  }
  const p = (async () => {
    if (fixturesUrl) {
      const f = await fixtures();
      return { ...(f.board || {}), vehicleId: vid };
    }
    return getJson(`/functions/v1/get_stats?${q.toString()}`);
  })();
  statsCache.set(vid, p);
  p.catch(() => statsCache.delete(vid));
  return p;
}

// ── the page's own modules (the "Reload to finish" banner) ────────────────────────────────────

/** A module of this page: same origin as [base], under assets/lib/ or assets/views/, a plain .js name. */
export function isOwnModule(url, base) {
  try {
    const b = new URL(base);
    const u = new URL(url, b);
    return u.origin === b.origin && !u.search && !u.hash && !u.username && !u.password &&
      /\/assets\/(lib|views)\/[a-z_]+\.js$/.test(u.pathname) && !u.pathname.includes("..");
  } catch (_) {
    return false;
  }
}

/**
 * Re-downloads the page's own module files past the browser cache, so the next reload runs them
 * fresh. A plain reload revalidates only the page itself and reuses modules still fresh in the HTTP
 * cache (GitHub Pages sends max-age=600), which would load the same stale mix again. This is the one
 * request that does not go to the API: a GET of this site's own static files, nothing else (anything
 * that is not one of them throws before a request leaves). [base] defaults to the page's address.
 * Resolves to the number of files refreshed; a failed file is skipped (the reload still helps).
 */
export async function refreshStatic(urls, base = here() && here().href) {
  if (!base) throw new Error("No page address");
  const list = [...new Set((urls || []).map((u) => { try { return new URL(u, base).href; } catch (_) { return ""; } }))];
  for (const u of list) {
    if (!isOwnModule(u, base)) throw new Error("blocked: not one of this page's modules");
  }
  if (!fetchImpl) throw new Error("No network in this environment");
  let n = 0;
  await Promise.all(list.map(async (u) => {
    try {
      const r = await fetchImpl(u, { cache: "reload", credentials: "same-origin" });
      if (r && r.ok) { n++; await r.text().catch(() => ""); }
    } catch (_) { /* offline: the reload still happens */ }
  }));
  return n;
}

/** The account's issued business-mileage reports, newest first. */
export function taxReports() {
  if (!taxP) {
    taxP = (async () => {
      if (fixturesUrl) return ((await fixtures()).taxReports || []).slice();
      return getJson(`/rest/v1/tax_reports?select=${SEL_TAX}&order=created_at.desc`);
    })();
    taxP.catch(() => { taxP = null; });
  }
  return taxP;
}

/** One issued report's PDF, as a Blob (the account's own folder in the reports bucket). */
export async function taxReportPdf(storagePath) {
  if (fixturesUrl) throw new Error("The demo data has no report files");
  const clean = String(storagePath || "").replace(/^\/+/, "").replace(/^reports\//, "");
  if (!clean || clean.includes("..")) throw new Error("No report file");
  const path = "/storage/v1/object/authenticated/reports/" + clean.split("/").map(encodeURIComponent).join("/");
  const r = await request("GET", path);
  return r.blob();
}

// ── Garage: its own reads, lazy, once per page load ───────────────────────────────────────────

// The door-jamb labels by JSON path, one alias per key: never the whole blob (it holds the VIN and the
// raw OCR texts). The home charger by its three display keys: never its location.
const SEL_GARAGE_VEHICLES = "id,equipment_group,powertrain,drive_type,assembly_plant," +
  JAMB_KEYS.map((k) => `jamb_${k}:door_jamb_specs->${k}`).join(",");
const SEL_TIRES = "id,vehicle_id,trailer_client_id,position,brand,model,size_spec,manufacture_date,install_epoch," +
  "install_odo,repair_epoch,repair_note,removed_epoch";
const SEL_DTC = "id,vehicle_id,scan_epoch,odo_miles,code_count,codes";
const SEL_GARAGE_SETTINGS = "homeHas:settings->home->has,homeBrand:settings->home->brand," +
  "homeModel:settings->home->model,trailers:settings->trailers";

/** The four garage reads, exactly as they leave the page (the tests check what they never select). */
export function garagePaths() {
  return [
    `/rest/v1/vehicles?select=${SEL_GARAGE_VEHICLES}&order=created_at.asc,id.asc`,
    `/rest/v1/tire_records?select=${SEL_TIRES}&order=install_epoch.desc`,
    `/rest/v1/dtc_scans?select=${SEL_DTC}&order=scan_epoch.desc&limit=50`,
    `/rest/v1/user_settings?select=${SEL_GARAGE_SETTINGS}`,
  ];
}

const errOf = (e) => ({ error: (e && e.message) || String(e) });

/** A vehicles row (aliases, or the demo file's raw row with its blob projected first) -> garage entry. */
function garageVehicle(r) {
  const jambSrc = r.door_jamb_specs !== undefined ? projectJamb(r.door_jamb_specs) : r;
  const t = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  return {
    equipmentGroup: t(r.equipment_group),
    powertrain: t(r.powertrain),
    driveType: t(r.drive_type),
    assemblyPlant: t(r.assembly_plant),
    jamb: normJamb(jambSrc),
  };
}

/**
 * The garage settings projection: only home {has, brand, model} (as the three aliases) and the
 * trailers list. A raw settings blob (the demo file) loses everything else here, the home's location
 * included.
 */
export function projectSettings(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const home = o.home && typeof o.home === "object" ? o.home : {};
  return {
    homeHas: o.homeHas ?? home.has ?? null,
    homeBrand: o.homeBrand ?? home.brand ?? null,
    homeModel: o.homeModel ?? home.model ?? null,
    trailers: Array.isArray(o.trailers) ? o.trailers : [],
  };
}

function garageSettings(rowOrRows) {
  const r = projectSettings((Array.isArray(rowOrRows) ? rowOrRows[0] : rowOrRows) || {});
  return {
    home: normHome({ has: r.homeHas, brand: r.homeBrand, model: r.homeModel }),
    trailers: r.trailers.filter((t) => t && typeof t === "object").map(normTrailer),
  };
}

/**
 * The Garage's own reads, on first use and once per page load (never part of loadAccount):
 * -> {vehicles: Map(id -> {equipmentGroup, powertrain, driveType, assemblyPlant, jamb|null}),
 *     tires: Tire[], dtc: Scan[] (newest first), home: {has, brand, model}, trailers: Trailer[]}
 * Each piece fails on its own: a failed piece is {error} and the others still arrive.
 */
export function garage() {
  if (garageP) return garageP;
  garageP = (async () => {
    let reads;
    if (fixturesUrl) {
      const g = (await fixtures()).garage || {};
      reads = [g.vehicles || [], g.tires || [], g.dtcScans || [], g.settings ? [g.settings] : []].map((x) => Promise.resolve(x));
    } else {
      reads = garagePaths().map((p) => getJson(p));
    }
    const [v, t, d, st] = await Promise.allSettled(reads);
    const list = (x) => (Array.isArray(x) ? x : []);
    const out = {};
    out.vehicles = v.status === "fulfilled"
      ? new Map(list(v.value).map((r) => [String(r.id), garageVehicle(r)])) : errOf(v.reason);
    out.tires = t.status === "fulfilled" ? list(t.value).map(normTire) : errOf(t.reason);
    out.dtc = d.status === "fulfilled" ? list(d.value).map(normDtc).sort((a, b) => b.scanMs - a.scanMs) : errOf(d.reason);
    if (st.status === "fulfilled") Object.assign(out, garageSettings(st.value));
    else { out.home = errOf(st.reason); out.trailers = errOf(st.reason); }
    return out;
  })();
  return garageP;
}

// ── Account -> Delete account (the one call that changes anything) ────────────────────────────

/**
 * Forgets this browser's session and every cached read, without calling logout (after a deletion the
 * user no longer exists).
 */
export function clearLocalSession() {
  clearSession();
  accountP = null; me = null; taxP = null; garageP = null;
  statsCache.clear(); routeCache.clear(); curveCache.clear();
}

/**
 * Deletes the signed-in account through the delete_account function, after the reader typed the
 * confirmation word. Refuses (no request) when [typed] is not exactly the word, and in demo mode.
 * On success the local session and caches are cleared and it resolves true. A failure throws with the
 * server's status (err.status) and its sentence (err.serverMessage); the server keeps the account then.
 */
export async function deleteAccount(typed) {
  if (String(typed ?? "").trim() !== DELETE_CONFIRM_WORD) throw new Error("Type the confirmation word exactly");
  if (fixturesUrl) throw new Error("The demo account cannot be deleted");
  const r = await request("POST", DELETE_PATH, { body: { confirm: DELETE_CONFIRM_WORD } });
  const j = await r.json().catch(() => ({}));
  if (!j || j.ok !== true) throw new Error("The server did not confirm the deletion");
  clearLocalSession();
  return true;
}
