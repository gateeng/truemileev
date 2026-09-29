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
//   - Tokens are never kept: parse() reads only the link type and the error fields, and returns
//     neither token. Nothing is stored (no storage, no cookie) and nothing is sent anywhere: this
//     file makes no network call at all. Signing in happens in the app.
//   - Text from the address (error_description) is shown with textContent only, and trimmed.
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
  var MAX_DESCRIPTION = 200;

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

  function clean(text) {
    var t = String(text == null ? "" : text).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return t.length > MAX_DESCRIPTION ? t.slice(0, MAX_DESCRIPTION - 1).trimEnd() + "…" : t;
  }

  /**
   * What the link's result was. Returns {kind, type, errorCode, description} and NEVER a token:
   *   kind "confirmed" — the link worked (tokens or a code present, or a non-recovery type)
   *        "recovery"  — a password-reset link (that happens in the app, by code)
   *        "expired"   — error_code / error otp_expired or access_denied
   *        "error"     — any other error; [description] is the server's text, trimmed
   *        "none"      — nothing an auth redirect appends
   */
  function parse(hash, search) {
    var h = fields(hash), q = fields(search);
    var pick = function (k) { return h.get(k) || q.get(k) || ""; };
    var error = clean(pick("error")), errorCode = clean(pick("error_code"));
    var description = clean(pick("error_description"));
    var type = clean(pick("type")).toLowerCase();
    if (error || errorCode || description) {
      var expired = EXPIRED_CODES.indexOf(errorCode) >= 0 || (!errorCode && EXPIRED_CODES.indexOf(error) >= 0);
      return { kind: expired ? "expired" : "error", type: type, errorCode: errorCode || error, description: description };
    }
    var worked = !!(pick("access_token") || pick("refresh_token") || pick("code") || pick("token_hash") || type);
    if (!worked) return { kind: "none", type: "", errorCode: "", description: "" };
    return { kind: type === "recovery" ? "recovery" : "confirmed", type: type, errorCode: "", description: "" };
  }

  var GUIDANCE = "If you can sign in to TrueMile EV, your email is already confirmed. If not, open the app, " +
    "sign in with your email and follow the steps to get a new code.";

  /** The words for [result]: {tone, title, lines[], detail}. [detail] is the server's text, or "". */
  function message(result) {
    var kind = result && result.kind;
    if (kind === "confirmed") return {
      tone: "ok", title: "Email confirmed",
      lines: ["Your email is confirmed. Open TrueMile EV on your phone and sign in."], detail: "",
    };
    if (kind === "expired") return {
      tone: "warn", title: "This link can't be used again",
      lines: ["This link was already used or has expired. " + GUIDANCE], detail: "",
    };
    if (kind === "error") return {
      tone: "warn", title: "That link didn't work",
      lines: [GUIDANCE], detail: (result && result.description) || "",
    };
    if (kind === "recovery") return {
      tone: "info", title: "Password reset",
      lines: ["Passwords are reset in the app. Open TrueMile EV, tap Forgot password? and follow the steps to get a code."],
      detail: "",
    };
    return {
      tone: "info", title: "Nothing to confirm here",
      lines: ["This page finishes the Confirm my email link from a TrueMile EV sign-up email. There is nothing to confirm right now."],
      detail: "",
    };
  }

  /**
   * Read the address, clean it at once, then work out what it said. In "page" mode any hash or query is
   * removed; in "notice" mode only an address that carries auth fields is touched. Returns parse()'s
   * result (no tokens), and whether the address was cleaned.
   */
  function capture(loc, hist, mode) {
    var hash = String((loc && loc.hash) || ""), search = String((loc && loc.search) || "");
    var auth = hasAuthParams(hash, search);
    var cleaned = false;
    if (auth || (mode === "page" && (hash || search))) {
      var keepSearch = mode !== "page" && !isAuthPart(search);
      try {
        hist.replaceState(null, "", String(loc.pathname || "") + (keepSearch ? search : ""));
        cleaned = true;
      } catch (_) { /* no history API: nothing else to do */ }
    }
    var result = auth ? parse(hash, search) : parse("", "");
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
    if (m.detail) {
      var d = el(doc, "p", "detail");
      d.appendChild(el(doc, "span", "k", "What the server said: "));
      d.appendChild(el(doc, "span", "", m.detail));
      box.appendChild(d);
    }
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
    if (m.detail) box.appendChild(el(doc, "span", "detail", "What the server said: " + m.detail));
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
  };

  // ── run: clean the address first, render once the body exists ──────────────────────────────────
  if (typeof document === "undefined" || typeof window === "undefined") return;
  var script = document.currentScript;
  var mode = (script && script.getAttribute("data-mode")) === "page" ? "page" : "notice";
  var captured = capture(window.location, window.history, mode);
  if (mode === "page") applyTheme(window, document);
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
    captured = capture(window.location, window.history, mode);
    if (mode !== "page") {
      var old = document.querySelector(".authnote");
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
    show();
  });
})(globalThis);
