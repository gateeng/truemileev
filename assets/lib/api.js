// TrueMile EV web: the page's whole data layer, and the ONLY file that calls fetch. No SDK, no
// bundler, no dependency.
//
// Raw fetch rather than supabase-js: the edge functions answer preflight with "authorization, apikey,
// content-type" and nothing else (supabase-js adds x-client-info), and a dependency-free page is the
// only kind that can honestly promise no third-party script of any sort.
//
// READ-ONLY by construction, with two deliberate exceptions: request() checks every call against
// ALLOWED before anything leaves the page. GET reaches the tables below, get_stats, the signed-in user,
// the account's own report PDFs and the public report check (verify_report, for verify.html); POST
// reaches the auth endpoints (sign-in, the Google sign-in's code exchange, sign-out - including the
// end of the session an email link handed to confirmed.html or the product page, for link-session.js -
// and the password reset's recover / verify), the read-only my_effective_tier function and the
// delete_account function; PUT reaches the signed-in user, for a new password only. No other
// method exists here. Row-level security would let a signed-in browser write to the tables, and a
// write from here would skip the app's own date-ordered replays and fire server triggers, so the page
// never writes a table.
// The exceptions: Account -> Delete account (request() lets that one POST through only with the typed
// confirmation word as its whole body, deleteAccount below), and the sign-in page's "Forgot password?"
// (the app's code flow: recover emails a 6-digit code, verify trades it for a session, PUT /user sets
// the new password). Each of those paths is refused before it leaves the page unless its body is
// exactly the one shape that flow sends.

import {
  normTrip, normCharge, normParked, normVehicle, byDateThenId, JAMB_KEYS, projectJamb, normJamb, normTrailer,
  normHome, normTire, normDtc,
} from "./rows.js";

import {
  CODE_MIN_LENGTH, CODE_MAX_LENGTH, MIN_PASSWORD_LENGTH, classifySend, classifyVerify, classifyUpdate,
} from "./recovery.js";

/** Re-exported: the door-jamb keys api.garage() selects (never the VIN, raw OCR or confidence). */
export { JAMB_KEYS };

export const BUILD = "2026-10-01.1";

const REST_TABLES = ["vehicles", "trip_log", "charge_session", "phantom_losses", "trip_notes",
  "user_settings", "charge_curve_log", "tax_reports", "tire_records", "dtc_scans"];

/** The account-deletion function: the one POST that changes anything (Account -> Delete account). */
export const DELETE_PATH = "/functions/v1/delete_account";
/** The word the reader types, and the function's whole request body ({"confirm": <word>}). */
export const DELETE_CONFIRM_WORD = "DELETE";

/** Forgot password (the app's code flow): recover emails the code, verify trades it for a session,
 *  PUT on the user sets the new password. */
export const RECOVER_PATH = "/auth/v1/recover";
export const VERIFY_PATH = "/auth/v1/verify";
export const USER_PATH = "/auth/v1/user";
/** Sign-in, refresh and the Google sign-in's code exchange (grant_type=pkce). */
export const TOKEN_PATH = "/auth/v1/token";
/** The public check behind a Business Mileage report's QR code (verify.html); no sign-in. */
export const VERIFY_REPORT_PATH = "/functions/v1/verify_report";

/** What may leave the page. GET: exact paths (a table read takes any query) or a prefix ending "/". */
export const ALLOWED = Object.freeze({
  GET: Object.freeze([
    ...REST_TABLES.map((t) => `/rest/v1/${t}`),
    "/functions/v1/get_stats",
    USER_PATH,
    "/storage/v1/object/authenticated/reports/",
    VERIFY_REPORT_PATH,
  ]),
  POST: Object.freeze([TOKEN_PATH, "/auth/v1/logout", RECOVER_PATH, VERIFY_PATH,
    "/rest/v1/rpc/my_effective_tier", DELETE_PATH]),
  // The ONE write to the account itself: a new password, at the end of the reset (isPasswordBody).
  PUT: Object.freeze([USER_PATH]),
});

const SESSION_KEY = "tm_session";
/** The Google sign-in's PKCE verifier, kept in this tab from the click until Google sends it back. */
const PKCE_KEY = "tm_pkce";
/** What a sign-in return may append to the query: GoTrue's error fields and the PKCE code. */
const ERROR_KEYS = ["error", "error_code", "error_description"];
const RETURN_KEYS = [...ERROR_KEYS, "code"];
/** Session tokens in a fragment: the implicit flow, which this page no longer accepts. */
const FRAGMENT_TOKEN_KEYS = ["access_token", "refresh_token", "provider_token", "provider_refresh_token"];
const PAGE = 1000;

/**
 * Every sentence a sign-in return can show. Nothing from the address is ever shown: an error in it is
 * matched to one of these by its code, so a crafted link cannot put its own words on this page.
 */
export const SIGN_IN_MESSAGES = Object.freeze({
  cancelled: "Sign-in was cancelled, or Google did not allow it. Try again.",
  expired: "That sign-in took too long and has expired. Try again.",
  server: "The sign-in server had a problem. Try again in a few minutes.",
  unfinished: "Sign-in didn't finish. Try again.",
  offline: "Could not reach the server to finish signing in. Check your connection and try again.",
  storage: "This browser blocks site storage for this page, so Google sign-in can't finish here. " +
    "Sign in with your email and password, or allow site data for this site and try again.",
});

/** A sign-in return's error fields -> one of SIGN_IN_MESSAGES (never the address's own text). */
export function signInErrorText(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(String(params || ""));
  const code = String(p.get("error_code") || "").trim().toLowerCase();
  const err = String(p.get("error") || "").trim().toLowerCase();
  const key = code || err;
  if (key === "otp_expired" || key === "flow_state_expired") return SIGN_IN_MESSAGES.expired;
  if (key === "server_error" || key === "unexpected_failure" || key === "temporarily_unavailable") return SIGN_IN_MESSAGES.server;
  if (key === "access_denied") return SIGN_IN_MESSAGES.cancelled;
  return SIGN_IN_MESSAGES.unfinished;
}

/** A session opened again after this long without use is signed out (and revoked) before anything shows. */
export const IDLE_SIGN_OUT_HOURS = 4;
const IDLE_SIGN_OUT_MS = IDLE_SIGN_OUT_HOURS * 3600 * 1000;

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
let idleEnded = false;           // whoAmI() signed an idle session out this page load

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
  refreshing = null; accountP = null; me = null; statsCalls = 0; taxP = null; garageP = null; idleEnded = false;
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
  if (m === "PUT") return ALLOWED.PUT.includes(p);
  return false;
}

/** [body] as an object: itself, or its JSON; null for anything else. */
function bodyObject(body) {
  let o = body;
  if (typeof body === "string") {
    try { o = JSON.parse(body); } catch (_) { return null; }
  }
  return o && typeof o === "object" && !Array.isArray(o) ? o : null;
}

const onlyKeys = (o, keys) => !!o && Object.keys(o).length === keys.length && keys.every((k) => k in o);
const filled = (v) => typeof v === "string" && v.trim() !== "";

/** recover's body: exactly {email}. */
export function isRecoverBody(body) {
  const o = bodyObject(body);
  return onlyKeys(o, ["email"]) && filled(o.email);
}

/** verify's body: exactly {type: "recovery", email, token} with a 6-10 digit token (lib/recovery.js). */
export function isVerifyBody(body) {
  const o = bodyObject(body);
  return onlyKeys(o, ["type", "email", "token"]) && o.type === "recovery" && filled(o.email) &&
    typeof o.token === "string" && new RegExp(`^\\d{${CODE_MIN_LENGTH},${CODE_MAX_LENGTH}}$`).test(o.token);
}

/** PUT /auth/v1/user's body: exactly {password}, and nothing else about the account (no email, no data). */
export function isPasswordBody(body) {
  const o = bodyObject(body);
  return onlyKeys(o, ["password"]) && typeof o.password === "string" && o.password.length >= MIN_PASSWORD_LENGTH;
}

/** A PKCE code verifier (RFC 7636): 43-128 unreserved characters. */
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** The Google sign-in's code exchange body: exactly {auth_code, code_verifier}. */
export function isPkceBody(body) {
  const o = bodyObject(body);
  return onlyKeys(o, ["auth_code", "code_verifier"]) && typeof o.auth_code === "string" &&
    /^[A-Za-z0-9._~-]{1,256}$/.test(o.auth_code) && typeof o.code_verifier === "string" && PKCE_VERIFIER_RE.test(o.code_verifier);
}

/** The grant_type of a /auth/v1/token path ("" when there is none). */
function grantOf(path) {
  const p = String(path || "");
  const q = p.indexOf("?");
  return q < 0 ? "" : (new URLSearchParams(p.slice(q + 1)).get("grant_type") || "");
}

/**
 * The body guard for each path that changes something; a path not listed here has none. [grant]
 * narrows a rule to one grant_type of the token endpoint.
 */
const BODY_RULES = [
  { method: "POST", path: RECOVER_PATH, ok: isRecoverBody, why: "blocked: a reset code request carries the email only" },
  { method: "POST", path: VERIFY_PATH, ok: isVerifyBody, why: "blocked: only a password-reset code is checked here" },
  { method: "PUT", path: USER_PATH, ok: isPasswordBody, why: "blocked: only a new password may be sent" },
  { method: "POST", path: TOKEN_PATH, grant: "pkce", ok: isPkceBody,
    why: "blocked: a sign-in code exchange carries the code and its verifier only" },
];

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
  const rule = BODY_RULES.find((r) => r.method === String(method || "").toUpperCase() && r.path === pathOf(String(path || "")) &&
    (!r.grant || grantOf(path) === r.grant));
  if (rule && !rule.ok(body)) throw new Error(rule.why);
  if (!cfg || !cfg.PROJECT_URL || !cfg.ANON_KEY) throw new Error("The dashboard is not configured");
  if (!fetchImpl) throw new Error("No network in this environment");
  const h = isDelete ? {} : { apikey: cfg.ANON_KEY };
  if (useAuth || isDelete) {
    const s = await refreshIfNeeded();
    if (!s || !s.access_token) throw new Error("Signed out");
    h.authorization = `Bearer ${s.access_token}`;
  }
  const m = method.toUpperCase();
  const sends = m === "POST" || m === "PUT";
  if (sends) h["content-type"] = "application/json";
  if (headers && !isDelete) {
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (lk === "authorization") h.authorization = v;          // logout sends the token it is ending
    }
  }
  const init = { method: m, headers: h };
  if (sends) init.body = body === undefined ? "{}" : (typeof body === "string" ? body : JSON.stringify(body));
  const r = await fetchImpl(`${cfg.PROJECT_URL}${path}`, init);
  if (!r.ok) {
    const t = String(await r.text().catch(() => ""));
    const said = serverText(t);
    const err = new Error(`${r.status} ${said}`.trim());
    err.status = r.status;
    err.serverMessage = said;       // the server's own sentence, internal names replaced
    err.detail = t;                 // the raw body, for the console only; never shown
    try { err.retryAfter = (r.headers && r.headers.get && r.headers.get("retry-after")) || null; } catch (_) { err.retryAfter = null; }
    try { console.warn(`${method.toUpperCase()} ${pathOf(path)} → ${r.status}`, t.slice(0, 500)); } catch (_) { /* no console */ }
    throw err;
  }
  if (useAuth) touchSession();                    // a signed-in call went through: the session is in use
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
// sessionStorage, not localStorage: the token is scoped to this tab. On a shared host (gateeng.com serves
// other repos) that is the difference between "this tab" and "anything ever published on this origin".
// It does NOT end when the tab closes: browsers restore a closed tab, session storage included (Reopen
// closed tab, a restored browser session). So the record carries when it was last used, and a session
// opened again after IDLE_SIGN_OUT_HOURS without use is signed out, and revoked on the server, before
// anything is shown (whoAmI). Sign out stays the one sure end on a shared computer.

/** Stores [s] stamped with the time it was last used (now). */
function saveSession(s) {
  try {
    if (!storage) return;
    const rec = s && typeof s === "object" ? { ...s, last_active_ms: Date.now() } : s;
    storage.setItem(SESSION_KEY, JSON.stringify(rec));
  } catch (_) { /* no storage */ }
}
function loadSession() { try { return JSON.parse((storage && storage.getItem(SESSION_KEY)) || "null"); } catch (_) { return null; } }
function clearSession() { try { storage && storage.removeItem(SESSION_KEY); } catch (_) { /* no storage */ } }

/** The stored session was used just now (a signed-in request went through, or the reader changed page). */
function touchSession() {
  const s = loadSession();
  if (s && s.access_token) saveSession(s);
}

/**
 * True when [s] was last used more than IDLE_SIGN_OUT_HOURS ago. This page stamps last_active_ms on
 * every record it saves. A record saved by an older build of the page has no stamp; its last use can be
 * no later than its access token's expiry (that build refreshed the token whenever a call came within a
 * minute of it), so it counts as idle once that expiry is IDLE_SIGN_OUT_HOURS behind, or when it has no
 * expiry to go by.
 */
export function idleTooLong(s, nowMs = Date.now()) {
  const t = Number(s && s.last_active_ms);
  if (Number.isFinite(t) && t > 0) return nowMs - t > IDLE_SIGN_OUT_MS;
  const exp = Number(s && s.expires_at);
  if (!Number.isFinite(exp) || exp <= 0) return true;
  return nowMs - exp * 1000 > IDLE_SIGN_OUT_MS;
}

/** Only what the page needs of a token reply: never the user object or Google's own provider tokens. */
function sessionOf(s) {
  const expiresAt = Number(s.expires_at) || (Number(s.expires_in) ? Math.floor(nowSec()) + Number(s.expires_in) : 0);
  return { access_token: s.access_token, refresh_token: s.refresh_token || null, expires_at: expiresAt,
    token_type: s.token_type || "bearer" };
}

const nowSec = () => Date.now() / 1000;
const expired = (s) => !!(s && s.expires_at && nowSec() > s.expires_at - 60);

// ── PKCE (the Google sign-in) ─────────────────────────────────────────────────────────────────
// The authorization-code flow with a proof key: Google sends back a one-time ?code= that only this tab
// can trade for a session, because only this tab holds the verifier. No token ever sits in the address
// (the implicit flow put the session in app.html#access_token=..., which browser history keeps), and a
// link carrying someone else's code or tokens cannot sign this browser in to their account.

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh PKCE verifier: 48 random bytes, base64url (64 characters). */
export function pkceVerifier() {
  const a = new Uint8Array(48);
  crypto.getRandomValues(a);
  return base64url(a);
}

/** The S256 challenge of [verifier]: base64url(SHA-256(verifier)), no padding. */
export async function pkceChallenge(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(verifier)));
  return base64url(new Uint8Array(d));
}

/** The verifier kept for this tab's Google sign-in, removed as it is read (it is good for one exchange). */
function takeVerifier() {
  let v = null;
  try { v = storage && storage.getItem(PKCE_KEY); } catch (_) { v = null; }
  try { storage && storage.removeItem(PKCE_KEY); } catch (_) { /* no storage */ }
  return typeof v === "string" && PKCE_VERIFIER_RE.test(v) ? v : null;
}

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
   * The Google sign-in's return (PKCE): GoTrue sends the browser back with ?code=<one-time code>, or
   * with an error in the query (and, for now, a copy in the fragment). A code is traded for a session
   * with this tab's verifier (POST /auth/v1/token?grant_type=pkce); an error becomes one of
   * SIGN_IN_MESSAGES, never the address's own text. Session tokens in a fragment (the implicit flow)
   * are never adopted: that would let a crafted link sign this browser in to another account. What
   * was read is scrubbed from the address bar first: the code and the error keys of the query
   * (anything else, such as ?fixtures, stays) and an auth fragment (a page route stays).
   * -> {ok:true} | {ok:false} | {error: <one of SIGN_IN_MESSAGES>}
   * [loc] / [hist] default to the page's (tests pass their own).
   */
  async adoptRedirect(loc = here(), hist = globalThis.history) {
    if (!loc) return { ok: false };
    const hash = loc.hash || "";
    const search = loc.search || "";
    const fragment = hash.length >= 2 && !hash.startsWith("#/") ? new URLSearchParams(hash.slice(1)) : null;
    const query = new URLSearchParams(search.replace(/^\?/, ""));
    const hasErr = (p) => !!p && !!(p.get("error") || p.get("error_description") || p.get("error_code"));
    const queryErr = hasErr(query);
    const fragErr = hasErr(fragment);
    const fragTokens = !!fragment && FRAGMENT_TOKEN_KEYS.some((k) => fragment.has(k));
    const code = query.get("code");
    if (!queryErr && !fragErr && !fragTokens && !code) return { ok: false };
    const authFragment = fragErr || fragTokens;
    const scrub = () => {
      const kept = search.replace(/^\?/, "").split("&").filter((seg) => {
        if (!seg) return false;
        let k = seg.split("=")[0];
        try { k = decodeURIComponent(k.replace(/\+/g, " ")); } catch (_) { /* keep the raw key */ }
        return !RETURN_KEYS.includes(k);
      });
      const nextSearch = kept.length ? "?" + kept.join("&") : "";
      const nextHash = authFragment ? "" : hash;  // a page route (or any other anchor) stays; an auth fragment goes
      try { hist.replaceState(null, "", loc.pathname + nextSearch + nextHash); } catch (_) { /* no history */ }
    };
    scrub();
    if (queryErr || fragErr) {
      takeVerifier();                             // this attempt is over
      return { error: signInErrorText(fragErr ? fragment : query) };
    }
    if (!code) return { error: SIGN_IN_MESSAGES.unfinished };   // tokens in the fragment: never adopted
    const verifier = takeVerifier();
    if (!verifier) return { error: volatileSession ? SIGN_IN_MESSAGES.storage : SIGN_IN_MESSAGES.unfinished };
    let r;
    try {
      r = await request("POST", `${TOKEN_PATH}?grant_type=pkce`, { auth: false, body: { auth_code: code, code_verifier: verifier } });
    } catch (e) {
      if (e && (e.status || /^blocked:/.test(String(e.message)))) return { error: SIGN_IN_MESSAGES.unfinished };
      return { error: SIGN_IN_MESSAGES.offline };
    }
    const s = await r.json().catch(() => null);
    if (!s || typeof s !== "object" || !s.access_token) return { error: SIGN_IN_MESSAGES.unfinished };
    saveSession(sessionOf(s));
    me = null;
    return { ok: true };
  },

  /**
   * The Google sign-in URL (a navigation, not a request), with a fresh PKCE challenge whose verifier
   * stays in this tab. Throws SIGN_IN_MESSAGES.storage when the browser blocks site storage: the
   * verifier would not survive the trip to Google and back.
   */
  async googleUrl() {
    if (volatileSession || !storage) throw new Error(SIGN_IN_MESSAGES.storage);
    const verifier = pkceVerifier();
    try { storage.setItem(PKCE_KEY, verifier); } catch (_) { throw new Error(SIGN_IN_MESSAGES.storage); }
    const u = new URL(`${cfg.PROJECT_URL}/auth/v1/authorize`);
    u.searchParams.set("provider", "google");
    u.searchParams.set("redirect_to", cfg.REDIRECT_URL || "");
    u.searchParams.set("code_challenge", await pkceChallenge(verifier));
    u.searchParams.set("code_challenge_method", "s256");
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
    // A tab reopened (or a browser session restored) long after its last use: sign it out, and end it
    // on the server, before anything of the account is shown.
    const held = loadSession();
    if (held && held.access_token && idleTooLong(held)) {
      idleEnded = true;
      await auth.signOut();
      return null;
    }
    // Opening the page is use; this also stamps a record an older build of the page saved without one.
    if (held && held.access_token) saveSession(held);
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

  // ── forgot password: the app's code flow (lib/recovery.js has the rules and the words) ────────
  // 1. requestPasswordReset(email)        POST /auth/v1/recover {email}: the server emails a code, and
  //    answers the same whether or not the address has an account.
  // 2. verifyResetCode(email, code)       POST /auth/v1/verify {type: "recovery", email, token}: a right
  //    code comes back as a session, which is RETURNED, not kept (nothing is signed in yet).
  // 3. finishPasswordReset(session, pw)   PUT /auth/v1/user {password} with that session's own token;
  //    only when the server takes the new password does the session become this tab's sign-in.
  // Each returns lib/recovery.js's outcome ({kind: ...}); none throws for a server or network answer.
  // Anon key only, like every other call here.

  async requestPasswordReset(email) {
    if (fixturesUrl) return { kind: "demo" };
    try {
      await request("POST", RECOVER_PATH, { auth: false, body: { email: String(email ?? "").trim() } });
      return classifySend(200, "");
    } catch (err) {
      return outcomeOf(err, classifySend);
    }
  },

  async verifyResetCode(email, code) {
    if (fixturesUrl) return { kind: "demo" };
    try {
      const r = await request("POST", VERIFY_PATH,
        { auth: false, body: { type: "recovery", email: String(email ?? "").trim(), token: String(code ?? "") } });
      return classifyVerify(r.status || 200, await r.text().catch(() => ""), null, nowSec());
    } catch (err) {
      return outcomeOf(err, classifyVerify);
    }
  },

  async finishPasswordReset(session, password) {
    if (fixturesUrl) return { kind: "demo" };
    if (!session || !session.access_token) return { kind: "expired" };
    let out;
    try {
      await request("PUT", USER_PATH, {
        auth: false, headers: { authorization: `Bearer ${session.access_token}` }, body: { password: String(password ?? "") },
      });
      out = classifyUpdate(200, "");
    } catch (err) {
      out = outcomeOf(err, classifyUpdate);
    }
    if (out.kind === "updated") {
      saveSession({ access_token: session.access_token, refresh_token: session.refresh_token || null,
        expires_at: session.expires_at || 0, token_type: session.token_type || "bearer" });
      me = null;
    }
    return out;
  },

  /** True when whoAmI() signed out a session that had not been used for IDLE_SIGN_OUT_HOURS. */
  endedForIdle() { return idleEnded; },

  /** The reader is using the page (a page change): keeps the stored session from counting as idle. */
  touch() { if (!fixturesUrl) touchSession(); },

  async signOut() {
    if (fixturesUrl) return;
    // After an idle hour the access token has expired, and GoTrue refuses a logout signed with an
    // expired token (403 bad_jwt): the server session, and its refresh token, would stay alive. Refresh
    // first, so the logout really ends it. A refused refresh means the server session is already gone
    // (refreshIfNeeded clears it and returns null); a network failure falls back to the stored token.
    let s = null;
    try { s = await refreshIfNeeded(); } catch (_) { s = loadSession(); }
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

/** A session access token (a JWT: three base64url parts) as Supabase appends it to an email link. */
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LINK_TOKEN_MAX = 8192;

/**
 * Ends, on the server, the session an email link handed to this site (9/30 audit F15). Supabase
 * confirms a Confirm my email link and then sends the browser to confirmed.html (or the product page)
 * with a whole session appended (#access_token=...&refresh_token=...). Nothing here signs in from a
 * link and auth-landing.js removes the tokens from the address at once, but the tokenized address can
 * stay in the browser's history, and a refresh token does not expire on its own. So link-session.js
 * calls this with the link's access token: ONE POST /auth/v1/logout?scope=local signed with that token,
 * which ends that session only (never the account's other sessions: the phone app keeps its own).
 * The token is never stored, and nothing about the account is read. -> true when the server ended it,
 * false otherwise (no request at all for anything that is not a token).
 */
export async function endEmailLinkSession(accessToken) {
  const t = String(accessToken ?? "");
  if (fixturesUrl || t.length > LINK_TOKEN_MAX || !LINK_TOKEN_RE.test(t)) return false;
  try {
    await request("POST", "/auth/v1/logout?scope=local", { auth: false, headers: { authorization: `Bearer ${t}` } });
    return true;
  } catch (_) {
    return false;          // already ended, expired, or offline: nothing else this page can do
  }
}

/**
 * A reset step's failed request as lib/recovery.js's outcome: the server's status and body when one
 * came back, "network" when nothing did. A page-side block (a body the allow list refused) is a bug in
 * this page, not an answer, and is thrown.
 */
function outcomeOf(err, classify) {
  if (err && /^blocked:/.test(String(err.message))) throw err;
  if (err && err.status) return classify(err.status, err.detail || "", err.retryAfter || null);
  return classify(0, "");
}

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

/** What a Board card says when get_stats answered 429 (BOARD_STATS_BUSY) or failed otherwise. */
export const BOARD_STATS_BUSY = "The Board figures were asked for too often in a short time. " +
  "Reload the page in a few minutes to see them.";

/**
 * The whole sentence for a failed boardStats(). get_stats answers 429 when an account has asked for the
 * Board figures too often (a per-account limit the app and this page share, audit 9/30 G1); that is said
 * plainly, never as a status code. Anything else: "The Board figures did not load: <its message>".
 */
export function boardStatsErrorText(err) {
  if (err && err.status === 429) return BOARD_STATS_BUSY;
  return `The Board figures did not load: ${String((err && err.message) || err || "unknown error")}`;
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

/**
 * A Business Mileage report ID as the app prints it: "TM-<year>-" and 6 (early reports) to 32 hex
 * characters. Nothing else is ever sent to verify_report or shown by verify.html.
 */
export const REPORT_ID_RE = /^TM-\d{4}-[0-9A-F]{6,32}$/;

/** [id] as a report ID (trimmed, upper-cased), or "" when it is not one. */
export function reportIdOf(id) {
  const t = String(id ?? "").trim().toUpperCase();
  return REPORT_ID_RE.test(t) ? t : "";
}

/**
 * The ID the app mints now: "TM-<year>-" and a UUID's 32 hex characters (TaxReportPdf.kt). It is the
 * only form verify_report looks up (audit 9/30, F21): an early report's 6-character ID could be guessed
 * by trying them all against a public check, so the server answers any other form as not found
 * without reading anything.
 */
export const CURRENT_REPORT_ID_RE = /^TM-\d{4}-[0-9A-F]{32}$/;

/**
 * The public check behind a report's QR code (verify.html): verify_report's JSON record of [id], asked
 * without sign-in (GET, anon key only). -> {kind: "found", id, record} | {kind: "not_found", id} |
 * {kind: "invalid"} (no request) | {kind: "legacy", id} (an early report's short ID, which the server
 * does not look up: no request, so the page never says such a report does not exist) |
 * {kind: "unavailable", id} (no answer, or not the JSON form).
 */
export async function verifyReport(id) {
  const rid = reportIdOf(id);
  if (!rid) return { kind: "invalid" };
  if (!CURRENT_REPORT_ID_RE.test(rid)) return { kind: "legacy", id: rid };
  let r;
  try {
    r = await request("GET", `${VERIFY_REPORT_PATH}?id=${encodeURIComponent(rid)}&format=json`, { auth: false });
  } catch (e) {
    if (e && e.status === 404) return { kind: "not_found", id: rid };
    if (e && e.status === 400) return { kind: "invalid" };
    return { kind: "unavailable", id: rid };
  }
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== "object" || Array.isArray(j)) return { kind: "unavailable", id: rid };
  if (j.found === false) return { kind: "not_found", id: rid };
  return { kind: "found", id: rid, record: j };
}

/** What the Report section says when an issued report has no PDF behind it (taxReportPdf's err.missing). */
export const REPORT_PDF_MISSING = "This report's PDF was not saved to your account (its upload did not go through " +
  "when the report was made), so it can't be downloaded here. Make the report again in the app to save a new copy.";

/**
 * Storage's answer for a file that is not there: 404, or 400 with {"statusCode":"404","error":"not_found",
 * "message":"Object not found","code":"NoSuchKey"} (what the live storage answers, probed 9/30).
 */
function isMissingObject(err) {
  if (!err || !err.status) return false;
  if (err.status === 404) return true;
  return err.status === 400 && /"statusCode"\s*:\s*"?404|not_found|NoSuchKey|Object not found/i.test(String(err.detail || ""));
}

/**
 * One issued report's PDF, as a Blob (the account's own folder in the reports bucket). A report can be
 * registered without its file: the app registers it even when the upload failed (a lost connection,
 * or the account's file limit), so a missing file is thrown with err.missing and REPORT_PDF_MISSING
 * as its message instead of storage's raw answer.
 */
export async function taxReportPdf(storagePath) {
  if (fixturesUrl) throw new Error("The demo data has no report files");
  const clean = String(storagePath || "").replace(/^\/+/, "").replace(/^reports\//, "");
  if (!clean || clean.includes("..")) throw new Error("No report file");
  const path = "/storage/v1/object/authenticated/reports/" + clean.split("/").map(encodeURIComponent).join("/");
  let r;
  try {
    r = await request("GET", path);
  } catch (e) {
    if (!isMissingObject(e)) throw e;
    const m = new Error(REPORT_PDF_MISSING);
    m.missing = true;
    m.status = e.status;
    throw m;
  }
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
