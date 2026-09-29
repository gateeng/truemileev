// TrueMile EV web: the dashboard shell. Boot, sign-in, the left sidebar (Account · Garage · Financial ·
// Charge · Map · Report, Settings pinned at the bottom), the topbar (section title, vehicle, plan,
// Refresh, the theme switch, sign out), the hash router with the first build's routes redirected, and
// the error boundary. Every figure is drawn by a view module; every request goes through lib/api.js
// (the only file that talks to the network).
//
// Modules are loaded with import() so a stale file left in the browser cache (GitHub Pages caches
// for up to ten minutes) shows one "Reload to finish" banner instead of a blank page.

export const BUILD = "2026-09-29.2";

const LIB = ["api", "tz", "units", "format", "periods", "rows", "metrics", "compare", "gates", "board", "dom",
  "journeys", "stops", "route", "tripdetail", "curve", "svgchart", "series", "csv", "printmodel", "taxreport",
  "route_hash", "theme", "icons", "plans", "insights", "finance", "chargefilter", "mapdata", "tripfilter",
  "reportdesign", "launch", "recovery"];
const VIEWS = ["tilegrid", "rangebar", "typefilter", "carfilter", "account", "garage", "settings", "financial",
  "charges", "charge", "charts", "map_section", "mapview", "trips", "trip", "journeys", "journey", "report",
  "print"];

const STALE_TEXT = "The dashboard was just updated. Reload to finish.";

/** The sidebar, in order (spec 2.2). Settings is pinned at the bottom. */
const SECTIONS = [
  { key: "account", label: "Account", icon: "account_circle", color: "var(--c-account)" },
  { key: "garage", label: "Garage", icon: "directions_car", color: "var(--c-garage)" },
  { key: "financial", label: "Financial", icon: "payments", color: "var(--c-financial)" },
  { key: "charge", label: "Charge", icon: "offline_bolt", color: "var(--c-charge)" },
  { key: "map", label: "Map", icon: "location_on", color: "var(--c-map)" },
  { key: "report", label: "Report", icon: "bar_chart", color: "var(--c-report)" },
  { key: "settings", label: "Settings", icon: "settings", color: "var(--c-settings)" },
];
const SECTION = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

const THEMES = [
  { pref: "system", icon: "brightness_6", label: "System" },
  { pref: "light", icon: "light_mode", label: "Light" },
  { pref: "dark", icon: "dark_mode", label: "Dark" },
];

// The brand mark (the favicon's shape), drawn in the page's own colours.
const LOGO = '<svg class="sb-logo" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 12 h18 a20 20 0 0 1 0 40 h-18 z" fill="var(--m-power)"/><circle cx="52" cy="32" r="6" fill="var(--c-board)"/></svg>';

const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hide", !on); };

let L = null;          // lib modules by name
let V = null;          // view modules by name
let api = null;
let account = null;
let scope = null;
let options = [];      // the header's vehicle options
let units = "imperial";
let zone = "UTC";
let handle = null;     // the mounted view's {unmount}
let ctx = null;
let quietHash = null;  // the hash setQuery just wrote (never re-mounts)
let signedIn = false;

// ── modules and the BUILD check ───────────────────────────────────────────────────────────────

async function loadModules() {
  const libs = await Promise.all(LIB.map((n) => import(`./lib/${n}.js`)));
  const views = await Promise.all(VIEWS.map((n) => import(`./views/${n}.js`)));
  L = Object.fromEntries(LIB.map((n, i) => [n, libs[i]]));
  V = Object.fromEntries(VIEWS.map((n, i) => [n, views[i]]));
}

function staleModules() {
  const out = [];
  for (const [n, m] of Object.entries(L)) if (m.BUILD !== BUILD) out.push(`lib/${n}.js`);
  for (const [n, m] of Object.entries(V)) if (m.BUILD !== BUILD) out.push(`views/${n}.js`);
  return out;
}

/** Every module file of the page, relative to this one ("lib/api.js", ...). */
const allModules = () => [...LIB.map((n) => `lib/${n}.js`), ...VIEWS.map((n) => `views/${n}.js`)];

/**
 * The "Reload to finish" banner. [files] = the modules to fetch past the cache before reloading (a
 * plain reload would reuse cached modules and show the same mix again); every module when unknown.
 */
function staleBanner(files) {
  const b = $("banner");
  if (!b || b.querySelector(".stale")) return;
  const d = document.createElement("div");
  d.className = "msg info stale";
  d.innerHTML = `<span>${STALE_TEXT}</span> <button type="button" class="small">Reload</button>`;
  const btn = d.querySelector("button");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const urls = (files && files.length ? files : allModules()).map((f) => new URL(`./${f}`, import.meta.url).href);
    try {
      // lib/api.js may itself be the stale or missing file; without it a plain reload is all there is.
      const a = api || await import("./lib/api.js");
      if (a && typeof a.refreshStatic === "function") await a.refreshStatic(urls, location.href);
    } catch (_) { /* reload anyway */ }
    location.reload();
  });
  b.appendChild(d);
}

function escText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const ico = (name, opts) => L.icons.icon(name, opts);

// ── boot ──────────────────────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    await loadModules();
  } catch (e) {
    staleBanner();
    const b = $("banner");
    const d = document.createElement("div");
    d.className = "msg err";
    d.textContent = "The dashboard could not start: " + (e && e.message ? e.message : String(e));
    b.appendChild(d);
    return;
  }
  L.theme.startTheme();
  document.addEventListener("tm:theme", (e) => {
    if (ctx) ctx.theme = (e.detail && e.detail.theme) || L.theme.currentTheme();
    syncTheme();
  });
  const stale = staleModules();
  if (stale.length) staleBanner(stale);

  api = L.api;
  zone = L.tz.localZone();
  buildTopbarSignedOut();
  const st = api.init(window.TM_CONFIG);
  if (!st.configured) { show($("unconfigured"), true); return; }

  const back = api.auth.adoptRedirect();
  wireSignIn();
  if (back && back.error) signInError(back.error);
  if (api.sessionIsVolatile && api.sessionIsVolatile()) storageNote();

  if (!api.auth.signedIn()) { showSignIn(); return; }
  let me = null;
  try {
    me = await api.auth.whoAmI();
  } catch (e) {
    // A network failure or a server error is not "signed out": the session is kept.
    unreachable(e);
    return;
  }
  if (!me) { showSignIn(); return; }
  await enter(me);
}

/** The server could not be reached at load: say so, with Try again, instead of the sign-in form. */
function unreachable(e) {
  show($("signIn"), false);
  const view = $("view");
  show(view, true);
  view.innerHTML = "";
  const d = document.createElement("div");
  d.className = "msg err";
  d.innerHTML = `<span></span> <button type="button" class="small">Try again</button>`;
  const status = e && e.status ? ` (server error ${e.status})` : "";
  d.querySelector("span").textContent = `Could not reach the server${status}. Check your connection and try again.`;
  d.querySelector("button").addEventListener("click", () => location.reload());
  view.appendChild(d);
}

/** Site storage is blocked: signing in works, but only until this page reloads. */
function storageNote() {
  const b = $("banner");
  if (!b || b.querySelector(".storage")) return;
  const d = document.createElement("div");
  d.className = "msg info storage";
  d.textContent = "This browser blocks site storage for this page, so you stay signed in only until the page reloads.";
  b.appendChild(d);
}

/** The plan lookup failed twice: the locks may be wrong, so say so instead of silently gating. */
function tierUnknownNote() {
  const b = $("banner");
  if (!b || b.querySelector(".tierunknown")) return;
  const d = document.createElement("div");
  d.className = "msg info tierunknown";
  d.innerHTML = `<span></span> <button type="button" class="small">Reload</button>`;
  d.querySelector("span").textContent = "Your plan could not be checked, so some pages may show as locked. Reload to try again.";
  d.querySelector("button").addEventListener("click", () => location.reload());
  b.appendChild(d);
}

function showSignIn() {
  show($("signIn"), true);
  show($("view"), false);
  show($("sidebar"), false);
  $("shell").classList.remove("with-nav", "rail");
}

function signInError(text) {
  const m = $("signInMsg");
  m.innerHTML = "";
  const d = document.createElement("div");
  d.className = "msg err";
  d.textContent = text;
  m.appendChild(d);
}

function wireSignIn() {
  $("googleBtn").addEventListener("click", () => { location.href = api.auth.googleUrl(); });
  const go = async () => {
    const email = $("email").value.trim();
    const pw = $("password").value;
    if (!email || !pw) { signInError("Enter your email and password."); return; }
    const btn = $("emailBtn");
    btn.disabled = true;
    $("signInMsg").innerHTML = "";
    try {
      await api.auth.signInPassword(email, pw);
      const me = await api.auth.whoAmI();
      if (!me) throw new Error("Sign-in failed");
      $("password").value = "";
      show($("signIn"), false);
      await enter(me);
    } catch (e) {
      signInError(e && e.message ? e.message : "Sign-in failed");
    } finally {
      btn.disabled = false;
    }
  };
  $("emailBtn").addEventListener("click", go);
  $("password").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  wireReset();
}

// ── forgot password: the app's code flow ─────────────────────────────────────────────────────
// The rules and every sentence are lib/recovery.js's (a port of the app's PasswordRecoveryFlow); the
// three calls are lib/api.js's. Step 1 emails a code. Step 2 takes the code and the new password
// together: the password is checked first, so a too-short one never spends the single-use code; a
// right code gives a session that is held HERE, in memory, and becomes this tab's sign-in only when
// the new password is saved (api.auth.finishPasswordReset). Leaving the flow drops it.

const reset = { email: "", resendAtMs: 0, verified: null, busy: false, timer: 0 };

function resetMsg(text, kind = "err") {
  const m = $("resetMsg");
  m.innerHTML = "";
  if (!text) return;
  const d = document.createElement("div");
  d.className = `msg ${kind}`;
  d.textContent = text;
  m.appendChild(d);
}

function resetBusy(on) {
  reset.busy = on;
  for (const id of ["resetSendBtn", "resetSaveBtn", "resetHaveCodeBtn", "resetOtherEmailBtn"]) $(id).disabled = on;
  resendTick();
}

/** The "Send a new code (42 s)" countdown; the timer runs only while there is something to count. */
function resendTick() {
  const left = L.recovery.secondsUntilResend(reset.resendAtMs, Date.now());
  const b = $("resetResendBtn");
  b.textContent = L.recovery.resendLabel(left);
  b.disabled = reset.busy || left > 0;
  if (left > 0 && !reset.timer) reset.timer = setInterval(resendTick, 1000);
  if (left === 0 && reset.timer) { clearInterval(reset.timer); reset.timer = 0; }
}

function resetStep(step) {
  show($("resetAsk"), step === "ask");
  show($("resetCodeStep"), step === "code");
  show($("resetCodeField"), step === "code" && !reset.verified);
  if (step === "code") {
    $("resetSentTo").textContent = reset.verified ? L.recovery.MSG_CODE_ACCEPTED : `Code sent to ${reset.email}`;
    resendTick();
  }
}

function clearResetFields() {
  for (const id of ["resetCode", "newPassword", "newPassword2"]) $(id).value = "";
}

function openReset() {
  reset.verified = null;
  clearResetFields();
  $("resetEmail").value = $("email").value.trim() || reset.email;
  $("signInMsg").innerHTML = "";
  resetMsg("");
  show($("signIn"), false);
  show($("reset"), true);
  resetStep("ask");
  $("resetEmail").focus();
}

/** Leave the flow: the held session (if any) is dropped, never adopted. */
function closeReset() {
  reset.verified = null;
  clearResetFields();
  resetMsg("");
  show($("reset"), false);
  showSignIn();
}

async function sendResetCode(email) {
  // Enter on the email field bypasses the disabled button; a second request while one is out would
  // pass the cooldown check (resendAtMs is set only when the first answers) and send two emails.
  if (reset.busy) return;
  const block = L.recovery.requestBlocker(email, reset.resendAtMs, Date.now());
  if (block) { resetMsg(block); return; }
  resetBusy(true);
  resetMsg("");
  try {
    const o = await api.auth.requestPasswordReset(String(email).trim());
    if (o.kind === "sent") {
      reset.email = String(email).trim();
      reset.verified = null;
      reset.resendAtMs = Date.now() + L.recovery.RESEND_COOLDOWN_MS;
      $("resetCode").value = "";
      resetStep("code");
      resetMsg(L.recovery.SENT_MESSAGE, "info");
      $("resetCode").focus();
    } else {
      if (o.kind === "rate" && o.wait) reset.resendAtMs = Math.max(reset.resendAtMs, Date.now() + o.wait * 1000);
      resetMsg(L.recovery.outcomeMessage(o));
    }
  } finally {
    resetBusy(false);
  }
}

async function saveNewPassword() {
  if (reset.busy) return;
  const code = L.recovery.sanitizeCode($("resetCode").value);
  const pw = $("newPassword").value;
  const block = L.recovery.submitBlocker({ code, password: pw, again: $("newPassword2").value, verified: !!reset.verified });
  if (block) { resetMsg(block); return; }
  resetBusy(true);
  resetMsg("");
  try {
    if (!reset.verified) {
      const v = await api.auth.verifyResetCode(reset.email, code);
      if (v.kind !== "verified") { resetMsg(L.recovery.outcomeMessage(v)); return; }
      reset.verified = v.session;
      resetStep("code");
    }
    const u = await api.auth.finishPasswordReset(reset.verified, pw);
    if (u.kind === "updated") {
      reset.verified = null;
      clearResetFields();
      resetMsg("");
      show($("reset"), false);
      let me = null;
      try { me = await api.auth.whoAmI(); } catch (_) { me = null; }
      if (me) { await enter(me); return; }
      showSignIn();
      const m = $("signInMsg");
      m.innerHTML = "";
      const d = document.createElement("div");
      d.className = "msg ok";
      d.textContent = "Your new password is saved. Sign in with it.";
      m.appendChild(d);
      return;
    }
    if (u.kind === "expired") {
      // The held session is gone: a new code is needed, and the code field comes back.
      reset.verified = null;
      $("resetCode").value = "";
      resetStep("code");
    }
    resetMsg(L.recovery.outcomeMessage(u));
  } finally {
    resetBusy(false);
  }
}

function wireReset() {
  $("forgotBtn").addEventListener("click", openReset);
  $("resetBackBtn").addEventListener("click", closeReset);
  $("resetSendBtn").addEventListener("click", () => sendResetCode($("resetEmail").value));
  $("resetEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") sendResetCode($("resetEmail").value); });
  $("resetHaveCodeBtn").addEventListener("click", () => {
    const email = $("resetEmail").value.trim();
    if (!L.recovery.isPlausibleEmail(email)) { resetMsg(L.recovery.MSG_INVALID_EMAIL); return; }
    reset.email = email;
    reset.verified = null;
    resetMsg("");
    resetStep("code");
    $("resetCode").focus();
  });
  $("resetResendBtn").addEventListener("click", () => sendResetCode(reset.email));
  $("resetOtherEmailBtn").addEventListener("click", () => {
    reset.verified = null;
    clearResetFields();
    resetMsg("");
    resetStep("ask");
    $("resetEmail").focus();
  });
  $("resetCode").addEventListener("input", () => {
    const clean = L.recovery.sanitizeCode($("resetCode").value);
    if (clean !== $("resetCode").value) $("resetCode").value = clean;
  });
  $("resetSaveBtn").addEventListener("click", saveNewPassword);
  $("newPassword2").addEventListener("keydown", (e) => { if (e.key === "Enter") saveNewPassword(); });
}

// ── signed in ─────────────────────────────────────────────────────────────────────────────────

async function enter(me) {
  show($("signIn"), false);
  const view = $("view");
  show(view, true);
  view.innerHTML = `<div class="panel narrow center"><p class="loading">Loading your data…</p></div>`;
  try {
    account = await api.loadAccount();
  } catch (e) {
    view.innerHTML = "";
    const d = document.createElement("div");
    d.className = "msg err";
    d.innerHTML = `<span></span> <button type="button" class="small">Try again</button>`;
    d.querySelector("span").textContent = "Your data could not be loaded: " + (e && e.message ? e.message : String(e));
    d.querySelector("button").addEventListener("click", () => location.reload());
    view.appendChild(d);
    return;
  }
  signedIn = true;
  if (api.mode() === "fixtures") applyDemoTier();
  // Another account's report texts, logo and memberships never carry over on a shared browser.
  else L.dom.claimPersonalStore(account.userId);
  if (account.tier && account.tier.unknown) tierUnknownNote();
  if (!account.email && me && me.email) account.email = me.email;

  units = L.dom.store.get("tm.units", "imperial") === "metric" ? "metric" : "imperial";
  options = vehicleOptions();
  scope = options.length ? scopeFor(pickVehicle()) : { id: "all", vehicles: [], all: [] };
  buildSidebar();
  buildTopbar();

  window.addEventListener("hashchange", onHashChange);
  mountCurrent();
}

/** Demo data only (127.0.0.1): "?fixtures&tier=pro" previews another plan's locks. */
function applyDemoTier() {
  const raw = new URLSearchParams(location.search).get("tier");
  const t = raw === "entry" ? "free" : raw;       // "entry" is the lowest plan's shown name
  if (t === "trial") {
    account.tier = { ...account.tier, tier: "max", source: "trial", trialLive: true, trialDaysLeft: 6, trialTier: "max",
      trialEndsMs: 0, trialClosed: "", unknown: false };
  } else if (t && ["free", "pro", "max", "business"].includes(t)) {
    account.tier = { ...account.tier, tier: t, source: t === "free" ? "entry" : "paid", trialLive: false, trialDaysLeft: 0,
      trialEndsMs: 0, trialClosed: "", unknown: false };
  }
}

// ── vehicles and scope ────────────────────────────────────────────────────────────────────────

/** The header's vehicles: those with rows; every vehicle when none has any. */
function vehicleOptions() {
  const all = account.vehicles;
  const withRows = all.filter((v) => v.tripCount + v.chargeCount > 0);
  return withRows.length ? withRows : all.slice();
}

/** The stored vehicle (a stored "all" is read as the active one), else the active, else the busiest. */
function pickVehicle() {
  const saved = L.dom.store.get("tm.vehicle", "");
  if (saved && saved !== "all" && options.some((v) => v.id === saved)) return saved;
  const active = options.find((v) => v.isActive);
  if (active) return active.id;
  return options.slice().sort((a, b) => b.tripCount - a.tripCount)[0].id;
}

/** {id, vehicles, all} for a vehicle id, or "all" (Report's fleet choice: every vehicle with rows). */
function scopeFor(id) {
  return id === "all"
    ? { id: "all", vehicles: options.slice(), all: account.vehicles }
    : { id, vehicles: account.vehicles.filter((v) => v.id === id), all: account.vehicles };
}

const vehicleName = (v) => (v ? L.rows.vehicleLabel(v, account.vehicles, zone) : "");
const scopeVehicle = () => (scope && scope.id !== "all" ? account.vehicles.find((v) => v.id === scope.id) : null);

// ── sidebar ───────────────────────────────────────────────────────────────────────────────────

function sbItem(s) {
  return `<a class="sb-item" data-sect="${s.key}" href="#/${s.key}" style="--c:${s.color}" title="${s.label}">` +
    `${ico(s.icon, { size: 24 })}<span>${s.label}</span></a>`;
}

function buildSidebar() {
  const sb = $("sidebar");
  const email = account.email || "";
  sb.innerHTML =
    `<a class="sb-brand" href="#/map" title="TrueMile EV">${LOGO}<span>TrueMile <b>EV</b></span></a>` +
    `<nav class="sb-nav" aria-label="Sections">${SECTIONS.filter((s) => s.key !== "settings").map(sbItem).join("")}</nav>` +
    `<div class="sb-bottom">${sbItem(SECTION.settings)}` +
    (email ? `<div class="sb-email" title="${escText(email)}">${escText(email)}</div>` : "") +
    `<button type="button" class="sb-collapse" aria-label="Collapse the menu" title="Collapse the menu">${ico("chevron_left", { size: 22 })}<span>Collapse</span></button>` +
    `</div>`;
  show(sb, true);
  const shell = $("shell");
  shell.classList.add("with-nav");
  shell.classList.toggle("rail", L.dom.store.get("tm.sidebar", "full") === "rail");
  syncCollapse();
  sb.querySelector(".sb-collapse").addEventListener("click", () => {
    const rail = !shell.classList.contains("rail");
    shell.classList.toggle("rail", rail);
    L.dom.store.set("tm.sidebar", rail ? "rail" : "full");
    syncCollapse();
  });
  sb.addEventListener("click", (e) => { if (e.target.closest("a.sb-item, a.sb-brand")) closeDrawer(false); });
  sb.addEventListener("keydown", onDrawerKey);
  $("scrim").addEventListener("click", () => closeDrawer(true));
  // Rotating a phone (or widening the window) past 768 px turns the drawer into the rail: drop the
  // drawer's modal state so focus is not trapped in the rail and the page is not hidden from readers.
  try {
    const mq = window.matchMedia(DRAWER_QUERY);
    const onChange = () => { if (!mq.matches) closeDrawer(false); };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else if (typeof mq.addListener === "function") mq.addListener(onChange);
  } catch (_) { /* no matchMedia */ }
}

function syncCollapse() {
  const b = document.querySelector(".sb-collapse");
  if (!b) return;
  const rail = $("shell").classList.contains("rail");
  const t = rail ? "Expand the menu" : "Collapse the menu";
  b.setAttribute("aria-label", t);
  b.title = t;
  b.setAttribute("aria-expanded", rail ? "false" : "true");
}

function setActiveSection(key) {
  for (const a of document.querySelectorAll("#sidebar .sb-item")) {
    if (a.dataset.sect === key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

// The phone drawer (<768 px): a modal panel over a scrim; Escape, the scrim or a navigation closes it.
const DRAWER_QUERY = "(max-width: 767.98px)";
const drawerMode = () => { try { return window.matchMedia(DRAWER_QUERY).matches; } catch (_) { return false; } };

function openDrawer() {
  const sb = $("sidebar");
  sb.classList.add("open");
  sb.setAttribute("role", "dialog");
  sb.setAttribute("aria-modal", "true");
  show($("scrim"), true);
  const btn = $("tbMenu");
  if (btn) btn.setAttribute("aria-expanded", "true");
  const first = sb.querySelector('.sb-item[aria-current="page"]') || sb.querySelector(".sb-item");
  if (first) first.focus();
}

function closeDrawer(refocus) {
  const sb = $("sidebar");
  if (!sb || !sb.classList.contains("open")) return;
  sb.classList.remove("open");
  sb.removeAttribute("role");
  sb.removeAttribute("aria-modal");
  show($("scrim"), false);
  const btn = $("tbMenu");
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  }
}

function onDrawerKey(e) {
  const sb = $("sidebar");
  if (!sb.classList.contains("open")) return;
  if (!drawerMode()) { closeDrawer(false); return; }    // the rail is not a modal
  if (e.key === "Escape") { e.preventDefault(); closeDrawer(true); return; }
  if (e.key !== "Tab") return;
  const f = [...sb.querySelectorAll("a[href], button:not([disabled])")].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ── topbar ────────────────────────────────────────────────────────────────────────────────────

function themeSwitchHtml() {
  const pref = L.theme.currentPref();
  const cur = THEMES.find((t) => t.pref === pref) || THEMES[0];
  return `<div class="themesw" role="radiogroup" aria-label="Theme">` +
    THEMES.map((t) => `<button type="button" role="radio" data-theme-pref="${t.pref}" aria-checked="${t.pref === pref}" ` +
      `tabindex="${t.pref === pref ? "0" : "-1"}" title="${t.label}" aria-label="${t.label}">${ico(t.icon, { size: 20 })}</button>`).join("") +
    `</div>` +
    `<div class="themesw-one"><button type="button" class="icon-btn" id="themeOne" aria-haspopup="true" aria-expanded="false" ` +
    `title="Theme: ${cur.label}" aria-label="Theme: ${cur.label}">${ico(cur.icon, { size: 22 })}</button>` +
    `<div class="menu" id="themeMenu" role="menu" aria-label="Theme" hidden>` +
    THEMES.map((t) => `<button type="button" role="menuitemradio" data-theme-pref="${t.pref}" aria-checked="${t.pref === pref}">` +
      `${ico(t.icon, { size: 20 })}<span>${t.label}</span></button>`).join("") +
    `</div></div>`;
}

/** Signed out: the brand on the left, only the theme switch on the right. */
function buildTopbarSignedOut() {
  const right = $("tbRight");
  right.innerHTML = themeSwitchHtml();
  wireTheme(right);
}

function buildTopbar() {
  const fixtures = api.mode() === "fixtures";
  const left = $("tbLeft");
  left.innerHTML =
    `<button type="button" class="icon-btn tb-menu" id="tbMenu" aria-label="Open the menu" aria-controls="sidebar" aria-expanded="false">${ico("menu", { size: 24 })}</button>` +
    `<span class="tb-sect" id="tbSect" aria-hidden="true"></span>` +
    `<div class="tb-titles"><h1 id="tbTitle"></h1><div class="tb-sub" id="tbSub"></div></div>`;
  $("tbMenu").addEventListener("click", () => { if ($("sidebar").classList.contains("open")) closeDrawer(true); else openDrawer(); });

  const right = $("tbRight");
  let html = "";
  if (options.length > 1) {
    html += `<select id="vehiclePicker" class="tb-vehicle" aria-label="Vehicle">` +
      options.map((v) => `<option value="${escText(v.id)}">${escText(vehicleName(v))}</option>`).join("") + `</select>`;
  }
  const t = account.tier;
  if (t && !t.unknown) {
    html += `<a class="pill ${L.plans.planTone(t)}" href="#/account" title="Your plan">${escText(L.plans.planBadge(t))}</a>`;
  }
  if (fixtures) html += `<span class="pill demo">Demo data</span>`;
  html += `<button type="button" id="refreshBtn" class="btn ghost sm tb-refresh" title="Load everything again">${ico("refresh", { size: 20 })}<span class="lbl">Refresh</span></button>`;
  html += themeSwitchHtml();
  if (!fixtures) html += `<button type="button" id="signOutBtn" class="icon-btn" title="Sign out" aria-label="Sign out">${ico("logout", { size: 22 })}</button>`;
  right.innerHTML = html;

  const picker = $("vehiclePicker");
  if (picker) {
    picker.value = scope ? scope.id : "";
    picker.addEventListener("change", () => setVehicle(picker.value));
  }
  $("refreshBtn").addEventListener("click", () => location.reload());
  wireTheme(right);
  const so = $("signOutBtn");
  if (so) {
    so.addEventListener("click", async () => {
      so.disabled = true;
      await api.auth.signOut().catch(() => {});
      location.replace(location.pathname + location.search);
    });
  }
}

function wireTheme(root) {
  const group = root.querySelector(".themesw");
  const one = root.querySelector("#themeOne");
  const menu = root.querySelector("#themeMenu");
  const choose = (pref, focus) => {
    L.theme.setThemePref(pref);
    syncTheme();
    if (focus) root.querySelector(`.themesw [data-theme-pref="${pref}"]`)?.focus();
  };
  group.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-pref]");
    if (b) choose(b.dataset.themePref, false);
  });
  group.addEventListener("keydown", (e) => {
    const i = THEMES.findIndex((t) => t.pref === L.theme.currentPref());
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); choose(THEMES[(i + 1) % 3].pref, true); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); choose(THEMES[(i + 2) % 3].pref, true); }
  });
  const closeMenu = (refocus) => {
    if (menu.hidden) return;
    menu.hidden = true;
    one.setAttribute("aria-expanded", "false");
    if (refocus) one.focus();
  };
  one.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    one.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) menu.querySelector('[aria-checked="true"]')?.focus();
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-pref]");
    if (!b) return;
    choose(b.dataset.themePref, false);
    closeMenu(true);
  });
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeMenu(true); } });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== one) closeMenu(false); });
}

/** Every theme control shows the stored choice (header and Settings). */
function syncTheme() {
  const pref = L.theme.currentPref();
  const cur = THEMES.find((t) => t.pref === pref) || THEMES[0];
  for (const b of document.querySelectorAll(".themesw [data-theme-pref], #themeMenu [data-theme-pref]")) {
    const on = b.dataset.themePref === pref;
    b.setAttribute("aria-checked", on ? "true" : "false");
    if (b.closest(".themesw")) b.tabIndex = on ? 0 : -1;
  }
  const one = $("themeOne");
  if (one) {
    one.innerHTML = ico(cur.icon, { size: 22 });
    one.title = `Theme: ${cur.label}`;
    one.setAttribute("aria-label", `Theme: ${cur.label}`);
  }
}

/** The topbar's section icon, title and subtitle (a breadcrumb on a detail page, else the vehicle). */
function setHeader(sectKey, title, subtitleHtml) {
  const s = SECTION[sectKey] || SECTION.map;
  const icon = $("tbSect");
  if (icon) {
    icon.style.setProperty("--c", s.color);
    icon.innerHTML = ico(s.icon, { size: 24 });
  }
  const h1 = $("tbTitle");
  if (h1) h1.textContent = title;
  const sub = $("tbSub");
  if (sub) sub.innerHTML = subtitleHtml || "";
}

// ── navigation ────────────────────────────────────────────────────────────────────────────────

/** The route table (spec 2.5). -> [view module, title] | null */
function pick(path) {
  const [a, b, c] = path;
  switch (a) {
    case "account": return b ? null : [V.account, "Account"];
    case "garage": return b ? null : [V.garage, "Garage"];
    case "financial": return b ? null : [V.financial, "Financial"];
    case "charge": return b ? [V.charge, "Charge session"] : [V.charges, "Charge"];
    case "map":
      if (!b) return [V.map_section, "Map"];
      if (b === "trip" && c) return [V.trip, "Trip"];
      if (b === "journey" && c) return [V.journey, "Journey"];
      return null;
    case "report": return b ? null : [V.report, "Report"];
    case "print":
      if (b === "report" || b === "mileage" || (b === "journey" && c)) return [V.print, "Print"];
      return null;
    case "settings": return b ? null : [V.settings, "Settings"];
    default: return null;
  }
}

/** The subtitle: a breadcrumb for a detail page, else the vehicle's name (or the fleet's size). */
function subtitleFor(path, sect) {
  const [a, b, c] = path;
  const crumb = (label, href, rest) => `<a href="${href}">${escText(label)}</a> › ${escText(rest)}`;
  const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
  if (a === "charge" && b) {
    const ch = account.charges.find((x) => x.id === dec(b));
    const rest = ch ? `${L.format.dateFmt(ch.date, "MMM d", zone)} · ${ch.network.trim() || "Charge"}` : "Session";
    return crumb("Charge", "#/charge", rest);
  }
  if (a === "map" && b === "trip" && c) {
    const t = account.trips.find((x) => x.id === dec(c));
    return crumb("Map", "#/map?tab=trips", t ? L.format.dateFmt(t.date, "MMM d · h:mm a", zone) : "Trip");
  }
  if (a === "map" && b === "journey" && c) {
    const id = dec(c);
    const t = account.trips.find((x) => x.journeyId === id);
    return crumb("Map", "#/map?tab=journeys", L.journeys.displayName(id, t ? t.journeyName : null));
  }
  if (a === "print") return crumb("Report", "#/report", "Print");
  if (sect === "account" || sect === "settings") return escText(account.email || "");
  if (!scope || !account.vehicles.length) return "";
  if (scope.id === "all") return `${scope.vehicles.length} vehicles`;
  return escText(vehicleName(scopeVehicle()));
}

function currentRoute() {
  const hash = location.hash;
  if (!L.route_hash.isRoute(hash)) return { path: [], query: {} };
  return L.route_hash.parseHash(hash);
}

function replaceHash(next) {
  quietHash = next;
  history.replaceState(history.state, "", location.pathname + location.search + next);
}

function nav(hash) {
  const next = L.route_hash.normalizeHash(String(hash || "#/map"));
  if (L.route_hash.normalizeHash(location.hash || "#/") === next) { mountCurrent(); return; }
  location.hash = next;
}

function setQuery(partial) {
  const cur = currentRoute();
  const q = { ...cur.query, ...(partial || {}) };
  const next = L.route_hash.formatHash(cur.path, q);
  if (ctx) ctx.query = L.route_hash.parseHash(next).query;
  if (next !== location.hash) replaceHash(next);
}

function onHashChange() {
  const hash = location.hash;
  if (hash && !L.route_hash.isRoute(hash)) return;               // not a page route: never routed
  if (quietHash !== null && L.route_hash.normalizeHash(hash || "#/") === quietHash) { quietHash = null; return; }
  quietHash = null;
  closeDrawer(false);
  mountCurrent();
}

// ── settings hooks (each re-mounts the current view) ──────────────────────────────────────────

function setVehicle(id) {
  if (!options.some((v) => v.id === id)) return;
  L.dom.store.set("tm.vehicle", id);
  scope = scopeFor(id);
  const picker = $("vehiclePicker");
  if (picker) picker.value = id;
  mountCurrent();
}

function setUnits(u) {
  const next = u === "metric" ? "metric" : "imperial";
  L.dom.store.set("tm.units", next);
  units = next;
  mountCurrent();
}

function setTheme(pref) {
  L.theme.setThemePref(pref);
  syncTheme();
  mountCurrent();
}

function defaultRange() {
  const r = L.dom.store.get("tm.range", "");
  return L.periods.RANGES.includes(r) && r !== "custom" ? r : L.periods.DEFAULT_RANGE;
}

function mountCurrent() {
  if (handle && typeof handle.unmount === "function") {
    try { handle.unmount(); } catch (_) { /* the old page is going anyway */ }
  }
  handle = null;

  let { path, query } = currentRoute();
  const moved = L.route_hash.legacyRedirect(path, query);
  if (moved) {
    // A first-build address: the same page under its new name (the query carried over).
    path = moved.path;
    query = moved.query;
    replaceHash(L.route_hash.formatHash(path, query));
  }
  let picked = pick(path);
  if (!picked) {
    // Anything else lands on Map (and the address bar says so).
    path = ["map"];
    query = {};
    replaceHash(L.route_hash.formatHash(path, query));
    picked = pick(path);
  }
  const [mod, title] = picked;
  const section = L.route_hash.sectionOf(path);

  const view = $("view");
  const el = document.createElement("div");
  el.className = "view-root";
  view.replaceChildren(el);
  setActiveSection(section);
  setHeader(section, title, subtitleFor(path, section));
  document.title = `${title} · TrueMile EV`;
  try { window.scrollTo(0, 0); } catch (_) { /* no scroll */ }

  ctx = {
    account,
    scope,
    units,
    tz: zone,
    tier: account.tier,
    path,
    query,
    nav,
    setQuery,
    now: () => Date.now(),
    section,
    theme: L.theme.currentTheme(),
    vehicles: options.slice(),
    scopeFor,
    setUnits,
    setTheme,
    setVehicle,
    defaultRange: defaultRange(),
    fixtures: api.mode() === "fixtures",
    noTiles: api.mode() === "fixtures" && /[?&]notiles(=|&|$)/.test(location.search || ""),
    /** A view may name its page more precisely (the topbar subtitle; plain text). */
    setSubtitle(text) { const sub = $("tbSub"); if (sub) sub.textContent = String(text ?? ""); },
    /** Account → Delete succeeded: the whole shell gives way to the done card. */
    accountDeleted,
  };

  // No vehicle yet: Account and Settings still work; every other section says where vehicles come from.
  if (!account.vehicles.length && section !== "account" && section !== "settings") {
    el.innerHTML = `<div class="panel narrow"><h2>No vehicle yet</h2><p class="note">Vehicles are added in the app. ` +
      `Once one has synced, its drives and charges show up here.</p></div>`;
    return;
  }
  if (!mod || typeof mod.mount !== "function") {
    pageError(el, new Error("This page is not available in this version of the dashboard"));
    return;
  }
  try {
    const r = mod.mount(el, ctx);
    if (r && typeof r.then === "function") {
      r.then((x) => { handle = x || null; }, (e) => pageError(el, e));
    } else {
      handle = r || null;
    }
  } catch (e) {
    pageError(el, e);
  }
}

/**
 * After the account was deleted: no sidebar, no topbar controls, no route; one centred card and a link
 * to the product page. Nothing reloads by itself.
 */
function accountDeleted() {
  if (handle && typeof handle.unmount === "function") { try { handle.unmount(); } catch (_) { /* going */ } }
  handle = null;
  signedIn = false;
  window.removeEventListener("hashchange", onHashChange);
  closeDrawer(false);
  show($("sidebar"), false);
  $("shell").classList.remove("with-nav", "rail");
  $("tbLeft").innerHTML = `<a class="tb-brand" href="index.html">TrueMile <b>EV</b></a>`;
  $("tbRight").innerHTML = "";
  $("banner").innerHTML = "";
  try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* no history */ }
  document.title = "Account deleted · TrueMile EV";
  const view = $("view");
  view.innerHTML = `<div class="panel narrow center account-done"><h1>Your account has been deleted.</h1>` +
    `<p class="note">Everything stored with it on our servers is gone.</p>` +
    `<p><a class="btn primary" href="index.html">Go to the TrueMile EV page</a></p></div>`;
  show(view, true);
}

function pageError(el, e) {
  console.error(e);
  el.innerHTML = "";
  const d = document.createElement("div");
  d.className = "msg err";
  d.textContent = "This page hit a problem: " + (e && e.message ? e.message : String(e));
  el.appendChild(d);
}

boot().catch((e) => {
  console.error(e);
  const b = $("banner");
  if (b) {
    const d = document.createElement("div");
    d.className = "msg err";
    d.textContent = "The dashboard could not start: " + (e && e.message ? e.message : String(e));
    b.appendChild(d);
  }
});
