// TrueMile EV — web dashboard configuration (a classic script: it sets window.TM_CONFIG, and applies a
// stored theme choice before the page paints).
//
// PROJECT_URL and ANON_KEY are the SAME public pair the Android app ships (SupabaseClient.kt).
// The anon key is public by design: every row this page can reach is gated by row-level security
// against the signed-in user, not by the key. It is committed here; `python tools/web-config.py`
// re-fills the ANON_KEY line from SupabaseClient.kt if it is ever cleared or the key is rotated.
//
// Only the public anon key belongs in this file. It is served to every visitor's browser.
window.TM_CONFIG = {
  PROJECT_URL: "https://fsnmjxtthahperapdihw.supabase.co",
  ANON_KEY:    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzbm1qeHR0aGFocGVyYXBkaWh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTYwMDQsImV4cCI6MjA5NjI3MjAwNH0.rC_Vw_HbFw3FpTjcg7Lu1gc0ClLaXY0_LWOtLsuHe3Q",

  // Where Google sends the browser back after sign-in. Must match, exactly, one of the redirect
  // URLs allowed in Supabase (Authentication → URL Configuration) and in the Google Cloud OAuth
  // client's "Authorised redirect URIs". Leave as-is to use whatever origin this page is served
  // from, which is what you want in production.
  REDIRECT_URL: window.location.origin + window.location.pathname,

  // Table writes stay off by decision, not by accident. The tables this page reads carry a FOR ALL
  // policy, so a browser COULD write to them directly - and a direct write bypasses the date-ordered
  // cost replay the app and the sync functions run, leaving the money wrong on both surfaces with no
  // error. Corrections belong in the app. The one call that changes anything is Account -> Delete
  // account, which goes to the delete_account function after a typed confirmation; it is not a table
  // write. Leave this false.
  ALLOW_WRITES: false,
};

// A stored Light / Dark choice, applied before the first paint (this file loads in <head>, as a classic
// script: the page's CSP allows no inline script). "System" needs nothing here: the stylesheet's media
// query already follows the browser until lib/theme.js takes over.
try { var p = window.localStorage.getItem("tm.theme");
      if (p === "light" || p === "dark") document.documentElement.setAttribute("data-theme", p); } catch (e) {}
