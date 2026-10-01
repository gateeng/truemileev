// TrueMile EV — where an email link from Supabase lands (confirmed.html), and the product page's
// fallback when a link lands there instead (the project's Site URL).
//
// Supabase confirms the address first, then sends the browser here with its result appended:
//   #access_token=...&refresh_token=...&type=signup      the link worked
//   #error=access_denied&error_code=otp_expired&...      the link was already used or has expired
// (older setups put the error in the query string instead; both are read).
//
// Rules this file keeps:
//   - The address is cleaned with history.replaceState the moment the script runs, before the page
//     paints and before anything else reads it. This is a CLASSIC script in <head> for that reason.
//   - Tokens are never kept: parse() reads only the link type and the error codes, and returns
//     neither token. Nothing is stored (no storage, no cookie) and this file makes no network call
//     of its own. Signing in happens in the app.
//   - The session a link hands over is ENDED, not just dropped (9/30 audit F15). replaceState rewrites
//     only the current history entry, so the tokenized address can stay in the browser's history,
//     and a Supabase refresh token does not expire by itself. When the address carried a session
//     (a link that worked), capture() hands its access token to holdLinkToken() (in memory, never in
//     the result) and this file loads link-session.js, a module that takes the token once
//     (takeLinkToken) and ends that session on the server through lib/api.js: one
//     POST /auth/v1/logout?scope=local, which ends that session only, never the account's others.
//     A browser without modules still gets a clean address; only the sign-out is skipped.
//   - No text from the address is ever shown. error_description is not even read: anyone can put
//     any sentence in a link, and this page is on the real domain. The error CODE only picks one of
//     the fixed messages below. Everything is set with textContent.
//
// Two modes, from the script tag's data-mode:
//   "page"   (confirmed.html) — always cleans the address; always shows one message; applies the
//            site's light / dark theme itself (the product page's site.js is not loaded there).
//   "notice" (index.html)     — cleans the address only when it carries auth fields (so #beta and
//            friends still work) and then shows a small dismissible notice above the page.
//
// Importable without a DOM: the web tests read globalThis.TMAuthLanding.

(function (root) {
  "use strict";

  var PRODUCT_URL = "https://gateeng.com/truemileev/";
  var SUPPORT = "support@gateeng.com";

  // Every field Supabase (GoTrue) may append to a redirect. Any one of them marks the address as an
  // auth return, and all of them go when it is cleaned.
  var AUTH_KEYS = [
    "access_token", "refresh_token", "provider_token", "provider_refresh_token", "expires_in",
    "expires_at", "token_type", "type", "error", "error_code", "error_description", "code", "token_hash", "sb",
  ];
  var EXPIRED_CODES = ["otp_expired", "access_denied"];
  var MAX_CODE = 64;

  function fields(part) {
    var s = typeof part === "string" ? part : "";
    if (s.charAt(0) === "#" || s.charAt(0) === "?") s = s.slice(1);
    try { return new URLSearchParams(s); } catch (_) { return new URLSearchParams(""); }
  }

  /** True when [part] (a hash or a query string) carries any field an auth redirect appends. */
  function isAuthPart(part) {
    var p = fields(part);
    for (var i = 0; i < AUTH_KEYS.length; i++) if (p.has(AUTH_KEYS[i])) return true;
    return false;
  }

  function hasAuthParams(hash, search) {
    return isAuthPart(hash) || isAuthPart(search);
  }

  /** A code-like value from the address (an error code or a link type): one short token, else "". */
  function codeOf(text) {
    var t = String(text == null ? "" : text).trim().toLowerCase();
    return t.length <= MAX_CODE && /^[a-z0-9_.-]+$/.test(t) ? t : "";
  }

  /** A session access token (a JWT: three base64url parts, at most 8 KB) as Supabase appends it. */
  var TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

  /** The access token an auth return carries in [hash] or [search], or "" (never anything else). */
  function linkToken(hash, search) {
    var t = fields(hash).get("access_token") || fields(search).get("access_token") || "";
    return t.length <= 8192 && TOKEN_RE.test(t) ? t : "";
  }

  // The token of the last link that worked, until link-session.js takes it (once). Only in memory.
  var heldToken = "";
  function holdLinkToken(token) { heldToken = String(token || ""); }
  function takeLinkToken() { var t = heldToken; heldToken = ""; return t; }

  /**
   * What the link's result was. Returns {kind, type, errorCode} and NEVER a token, and never any text
   * from the address beyond a short code:
   *   kind "confirmed" — the link worked (tokens or a code present, or a non-recovery type)
   *        "recovery"  — a password-reset link (that happens in the app, by code)
   *        "expired"   — error_code / error otp_expired or access_denied
   *        "error"     — any other error (an error_description alone counts, but is not read)
   *        "none"      — nothing an auth redirect appends
   */
  function parse(hash, search) {
    var h = fields(hash), q = fields(search);
    var pick = function (k) { return h.get(k) || q.get(k) || ""; };
    var rawError = pick("error"), rawCode = pick("error_code");
    var error = codeOf(rawError), errorCode = codeOf(rawCode);
    var type = codeOf(pick("type"));
    if (rawError || rawCode || pick("error_description")) {
      var expired = EXPIRED_CODES.indexOf(errorCode) >= 0 || (!errorCode && EXPIRED_CODES.indexOf(error) >= 0);
      return { kind: expired ? "expired" : "error", type: type, errorCode: errorCode || error };
    }
    var worked = !!(pick("access_token") || pick("refresh_token") || pick("code") || pick("token_hash") || type);
    if (!worked) return { kind: "none", type: "", errorCode: "" };
    return { kind: type === "recovery" ? "recovery" : "confirmed", type: type, errorCode: "" };
  }

  var GUIDANCE = "If you can sign in to TrueMile EV, your email is already confirmed. If not, open the app, " +
    "sign in with your email and follow the steps to get a new code.";

  /** The words for [result]: {tone, title, lines[]}. Every word is fixed here; none comes from the address. */
  function message(result) {
    var kind = result && result.kind;
    if (kind === "confirmed") return {
      tone: "ok", title: "Email confirmed",
      lines: ["Your email is confirmed. Open TrueMile EV on your phone and sign in."],
    };
    if (kind === "expired") return {
      tone: "warn", title: "This link can't be used again",
      lines: ["This link was already used or has expired. " + GUIDANCE],
    };
    if (kind === "error") return {
      tone: "warn", title: "That link didn't work",
      lines: [GUIDANCE],
    };
    if (kind === "recovery") return {
      tone: "info", title: "Password reset",
      lines: ["Passwords are reset in the app. Open TrueMile EV, tap Forgot password? and follow the steps to get a code."],
    };
    return {
      tone: "info", title: "Nothing to confirm here",
      lines: ["This page finishes the Confirm my email link from a TrueMile EV sign-up email. There is nothing to confirm right now."],
    };
  }

  /**
   * Read the address, clean it at once, then work out what it said. In "page" mode any hash or query is
   * removed; in "notice" mode only an address that carries auth fields is touched. Returns parse()'s
   * result (no tokens), and whether the address was cleaned. When the link worked and handed over a
   * session, [onToken] (optional) gets its access token, for ending it; the result never has it.
   */
  function capture(loc, hist, mode, onToken) {
    var hash = String((loc && loc.hash) || ""), search = String((loc && loc.search) || "");
    var auth = hasAuthParams(hash, search);
    var token = auth ? linkToken(hash, search) : "";
    var cleaned = false;
    if (auth || (mode === "page" && (hash || search))) {
      var keepSearch = mode !== "page" && !isAuthPart(search);
      try {
        hist.replaceState(null, "", String(loc.pathname || "") + (keepSearch ? search : ""));
        cleaned = true;
      } catch (_) { /* no history API: nothing else to do */ }
    }
    var result = auth ? parse(hash, search) : parse("", "");
    if (token && typeof onToken === "function" && (result.kind === "confirmed" || result.kind === "recovery")) onToken(token);
    return { result: result, cleaned: cleaned };
  }

  // ── DOM ────────────────────────────────────────────────────────────────────────────────────────

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function link(doc, href, text, cls) {
    var a = el(doc, "a", cls || "", text);
    a.setAttribute("href", href);
    return a;
  }

  /**
   * Ends the held session: link-session.js when it is already here, else loads it (a module, from this
   * script's own folder). Does nothing when no session is held.
   */
  var sessionModuleAdded = false;
  function endHeldSession(doc, scriptSrc) {
    if (!heldToken) return false;
    var api = root.TMAuthLanding;
    if (api && typeof api.endLinkSession === "function") { api.endLinkSession(); return true; }
    if (sessionModuleAdded || !doc || !scriptSrc) return false;      // still loading: it takes the token when it runs
    try {
      var s = doc.createElement("script");
      s.type = "module";
      s.src = new URL("link-session.js", scriptSrc).href;
      (doc.head || doc.documentElement).appendChild(s);
      sessionModuleAdded = true;
      return true;
    } catch (_) { return false; }
  }

  /** confirmed.html: fill #landing with the message for [result]. */
  function renderPage(doc, result) {
    var box = doc.getElementById("landing");
    if (!box) return null;
    var m = message(result);
    while (box.firstChild) box.removeChild(box.firstChild);
    box.setAttribute("data-tone", m.tone);
    box.setAttribute("data-kind", (result && result.kind) || "none");
    box.appendChild(el(doc, "h1", "", m.title));
    for (var i = 0; i < m.lines.length; i++) box.appendChild(el(doc, "p", i === 0 ? "lead" : "", m.lines[i]));
    var links = el(doc, "div", "links");
    links.appendChild(link(doc, PRODUCT_URL, "About TrueMile EV", "btn primary"));
    links.appendChild(link(doc, "mailto:" + SUPPORT, SUPPORT, "btn"));
    box.appendChild(links);
    var help = el(doc, "p", "note", "Questions? Write to ");
    help.appendChild(link(doc, "mailto:" + SUPPORT, SUPPORT));
    help.appendChild(doc.createTextNode("."));
    box.appendChild(help);
    return m;
  }

  /** index.html: a small dismissible notice under the header, or nothing when there is no result. */
  function renderNotice(doc, result) {
    if (!result || result.kind === "none") return null;
    var m = message(result);
    var box = el(doc, "div", "authnote");
    box.setAttribute("role", "status");
    box.setAttribute("data-tone", m.tone);
    box.setAttribute("data-kind", result.kind);
    box.appendChild(el(doc, "b", "", m.title));
    for (var i = 0; i < m.lines.length; i++) box.appendChild(el(doc, "span", "", m.lines[i]));
    var help = el(doc, "span", "help", "Questions? ");
    help.appendChild(link(doc, "mailto:" + SUPPORT, SUPPORT));
    box.appendChild(help);
    var x = el(doc, "button", "x", "×");
    x.setAttribute("type", "button");
    x.setAttribute("aria-label", "Dismiss");
    x.addEventListener("click", function () { if (box.parentNode) box.parentNode.removeChild(box); });
    box.appendChild(x);
    var header = doc.querySelector("header.bar");
    if (header && header.parentNode) header.parentNode.insertBefore(box, header.nextSibling);
    else if (doc.body) doc.body.insertBefore(box, doc.body.firstChild);
    return m;
  }

  // The product page's theme rule (site.js): the system's choice, the clock only when it states none.
  function applyTheme(win, doc) {
    try {
      var mq = win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)");
      var light = win.matchMedia && win.matchMedia("(prefers-color-scheme: light)").matches;
      var hr = new Date().getHours();
      var theme = mq && mq.matches ? "dark" : light ? "light" : (hr >= 6 && hr < 18 ? "light" : "dark");
      doc.documentElement.setAttribute("data-theme", theme);
      if (mq && mq.addEventListener) mq.addEventListener("change", function (e) {
        doc.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      });
    } catch (_) { /* keep the page's default */ }
  }

  root.TMAuthLanding = {
    AUTH_KEYS: AUTH_KEYS.slice(), PRODUCT_URL: PRODUCT_URL, SUPPORT: SUPPORT, GUIDANCE: GUIDANCE,
    isAuthPart: isAuthPart, hasAuthParams: hasAuthParams, parse: parse, message: message,
    capture: capture, renderPage: renderPage, renderNotice: renderNotice, applyTheme: applyTheme,
    linkToken: linkToken, holdLinkToken: holdLinkToken, takeLinkToken: takeLinkToken, endHeldSession: endHeldSession,
    // link-session.js sets endLinkSession when it runs.
  };

  // ── run: clean the address first, render once the body exists ──────────────────────────────────
  if (typeof document === "undefined" || typeof window === "undefined") return;
  var script = document.currentScript;
  var mode = (script && script.getAttribute("data-mode")) === "page" ? "page" : "notice";
  var scriptSrc = (script && script.src) || "";
  var captured = capture(window.location, window.history, mode, holdLinkToken);
  if (mode === "page") applyTheme(window, document);
  endHeldSession(document, scriptSrc);
  var show = function () {
    if (mode === "page") renderPage(document, captured.result);
    else renderNotice(document, captured.result);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show, { once: true });
  else show();
  // A link opened in a tab that already shows this page changes only the hash (no reload): clean and
  // report that one too. (The product page's own anchors carry no auth field and are left alone.)
  window.addEventListener("hashchange", function () {
    if (mode !== "page" && !hasAuthParams(window.location.hash, window.location.search)) return;
    captured = capture(window.location, window.history, mode, holdLinkToken);
    endHeldSession(document, scriptSrc);
    if (mode !== "page") {
      var old = document.querySelector(".authnote");
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
    show();
  });
})(globalThis);
