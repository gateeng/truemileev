// TrueMile EV — ends the session an email link handed to this site (9/30 audit F15).
//
// Supabase confirms a Confirm my email link (or any other link it emails) and then sends the browser
// to confirmed.html — or to the product page, when the link's own return address is not allow-listed —
// with a whole session appended: #access_token=...&refresh_token=.... This site signs nobody in from a
// link (signing in happens in the app), and auth-landing.js removes those tokens from the address
// before anything paints. But replaceState rewrites only the current history entry: the tokenized
// address can stay in the browser's own or synced history, and Supabase's refresh tokens do not expire
// by themselves. So that session is ended on the server as soon as the page opens.
//
// Rules this file keeps:
//   - auth-landing.js loads it only when the address carried a session, and hands the access token
//     over through TMAuthLanding.takeLinkToken(), which gives it out once. Nothing is stored, nothing
//     is shown, nothing about the account is read.
//   - The one request goes through lib/api.js (the only file that talks to the network):
//     endEmailLinkSession -> POST /auth/v1/logout?scope=local, signed with the link's own token. scope=
//     local ends THAT session only; the account's other sessions (the phone app's) are untouched.
//   - config.js (the public project URL and anon key) is loaded first when the page did not load it,
//     and the page's own theme rule (TMAuthLanding.applyTheme) is applied again after it, since
//     config.js applies the dashboard's stored theme.
//
// Importable without a DOM: the web tests import it; the page run starts only where a document exists.

import * as api from "./lib/api.js";

/** An in-memory stand-in for sessionStorage: this page keeps nothing, not even the storage probe. */
function memoryStorage() {
  const m = new Map();
  return {
    volatile: true,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** window.TM_CONFIG, loading assets/config.js (this module's folder) first when the page has none. */
export function loadConfig(win, doc, base = import.meta.url) {
  if (win && win.TM_CONFIG) return Promise.resolve(win.TM_CONFIG);
  return new Promise((resolve) => {
    try {
      const s = doc.createElement("script");
      s.src = new URL("config.js", base).href;
      s.onload = () => {
        try {
          const L = win.TMAuthLanding;
          if (L && typeof L.applyTheme === "function") L.applyTheme(win, doc);
        } catch (_) { /* keep whatever theme is applied */ }
        resolve(win.TM_CONFIG || null);
      };
      s.onerror = () => resolve(null);
      (doc.head || doc.documentElement).appendChild(s);
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Takes the held token (once) and ends its session. -> true when the server ended it; false when no
 * token was held, the configuration is missing, or the request failed. opts.fetch replaces the
 * browser's (tests).
 */
export async function endHeldLinkSession(win, doc, opts = {}) {
  const L = win && win.TMAuthLanding;
  const token = L && typeof L.takeLinkToken === "function" ? L.takeLinkToken() : "";
  if (!token) return false;
  const cfg = await loadConfig(win, doc, opts.base);
  if (!cfg || typeof api.endEmailLinkSession !== "function") return false;
  api.init(cfg, { storage: memoryStorage(), fetch: opts.fetch });
  return api.endEmailLinkSession(token);
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
if (typeof window !== "undefined" && typeof document !== "undefined" && window.TMAuthLanding) {
  window.TMAuthLanding.endLinkSession = () => endHeldLinkSession(window, document).catch(() => false);
  window.TMAuthLanding.endLinkSession();
}
