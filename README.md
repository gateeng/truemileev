# TrueMile EV — website and dashboard

`index.html` is the public page. `app.html` is the signed-in dashboard. No framework, no bundler, no
CDN, no web font, no analytics, no chart library. Map tiles come from OpenFreeMap and are the page's
one outside service (see rule 6). Charts, and routes on printed pages, are plain SVG.

```
web/truemileev/
  index.html            public page: what the app does, how it works, links
  app.html              the dashboard (noindex): one page, hash routes (#/account, #/map, ...)
  confirmed.html        where the sign-up email's Confirm my email link lands (noindex; the app sends it
                        as redirect_to); assets/auth-landing.js reports the result, and
                        assets/link-session.js ends the session the link handed over
  verify.html           the report check behind a Business Mileage report's QR code (noindex):
                        assets/verify-page.js asks verify_report (format=json, via lib/api.js) and shows
                        the record as text; an early report's short ID is not looked up (it says to
                        email support instead)
  assets/config.js      project URL + the public anon key (tools/web-config.py fills it); applies a
                        stored Light / Dark choice before the first paint
  assets/app.js         the shell: sign-in, the left sidebar, the topbar (vehicle, plan, Refresh, the
                        theme switch), the router (old links redirected), the error boundary
  assets/style.css      the design system: tokens (light and dark), shell, shared components
  assets/lib/*.js       data (api.js is the only file that talks to the network) and pure logic
  assets/views/*.js     one module per section or detail page: account, garage, financial, charges
                        (Charge), charge, map_section (Map), trips, trip, journeys, journey, report,
                        print, settings; plus the shared tilegrid, rangebar, typefilter, carfilter,
                        charts and mapview (the only module that loads MapLibre)
  assets/css/*.css      per-section styles
  assets/vendor/        MapLibre GL JS 6.11.2 (BSD-3-Clause) and the Material icons license
                        (Apache-2.0); byte-identical copies, hashes pinned by the tests
```

The sections, in the sidebar's order: **Account** (email, sign-in method, plan and trial, how to
upgrade and manage payments in Google Play, My data CSV, delete account), **Garage** (vehicle, door-jamb
label values, tires, tow and trailers, home charger, insights, diagnostics), **Financial** (the Board
figures, total paid, saved, efficiency, spend by network, memberships kept in this browser, monthly
table, cost charts), **Charge** (tiles, a filterable charge list, a map of charge locations, charge
detail with the charging curve and your learned DC curve), **Map** (distance tiles including journeys,
a filterable trip list, trip detail with the route map, journeys), **Report** (period, journey and
business mileage documents with filters, title / header / footer / footnote, templates, accent, logo,
print preview, PDF and CSV, issued mileage reports) and **Settings** (units, theme, default period,
tiles, per-browser preferences, licenses).

## 1. The anon key (already done)

`assets/config.js` carries the project's **anon / public** key. It is filled in — run
`python tools/web-config.py` to re-fill it if it is ever cleared or the key is rotated; that script
reads it from `SupabaseClient.kt`, the one place that already has it, so there is nothing to copy by
hand and nothing to mistype.

That key is public by design — it is in the APK, and every row it can reach is gated by row-level
security against the signed-in user, not by the key. Rotating it means rebuilding the app too.
Only the public anon key ever belongs in this folder: everything here is served to every visitor.

With the key missing the dashboard shows "One value missing" and does nothing else.

## 2. Sign-in

Email and password work as soon as the key is in. Google needs the exact page URL in both consoles:

**Supabase** → Authentication → URL Configuration → Redirect URLs:
`https://gateeng.com/truemileev/app.html` (and `http://127.0.0.1:8777/truemileev/app.html` to test
locally).

**Google Cloud** → APIs & Services → Credentials → the OAuth client behind `GOOGLE_WEB_CLIENT_ID`
- Authorised JavaScript origins: `https://gateeng.com`
- Authorised redirect URIs: `https://fsnmjxtthahperapdihw.supabase.co/auth/v1/callback`

The last one is Supabase's own callback, not this site's — Google returns to Supabase, Supabase
returns to `app.html`. If the page URL is not allow-listed, Supabase sends the browser to the Site URL
instead and the page stays signed out.

Google sign-in uses the **PKCE** flow (`lib/api.js` `googleUrl` / `adoptRedirect`): the click stores a
random verifier in this tab's session storage and sends its SHA-256 challenge to `/auth/v1/authorize`;
Supabase returns to `app.html?code=…`, and only this tab can trade that one-time code for a session
(`POST /auth/v1/token?grant_type=pkce` with exactly `{auth_code, code_verifier}`). No token ever sits in
the address, so none lands in browser history, and a link carrying someone else's code or tokens
cannot sign this browser in to their account: session tokens in a fragment are never adopted. An
error in the return is shown as one of `SIGN_IN_MESSAGES`, never as text from the address.

**Email confirmation link.** The app sends `redirect_to=https://gateeng.com/truemileev/confirmed.html`
on sign-up and on a re-sent confirmation, so that address must be in the same Redirect URLs list, and
the Site URL must be `https://gateeng.com/truemileev/` (docs/SUPABASE_EMAIL_TEMPLATES.md). Supabase
confirms the address before it redirects and appends its result (`#access_token=…&type=signup` or
`#error=…&error_code=otp_expired`). `assets/auth-landing.js`, a classic script in the `<head>` of
`confirmed.html` and of the product page, removes that from the address with `history.replaceState`
before anything paints, keeps no token and stores nothing, then says what happened (the product page
only when an auth result is present; `#beta` and other anchors are left alone). Signing in happens in
the app. `app.html` is not involved: its own sign-in return is handled by `lib/api.js`.
A link that worked hands over a whole session, and `replaceState` cleans only the current history
entry, so that session is ended rather than just dropped (audit 9/30, F15): `auth-landing.js` holds
the access token in memory and loads `assets/link-session.js`, which takes it once and sends one
`POST /auth/v1/logout?scope=local` signed with it through `lib/api.js` (`endEmailLinkSession`). That
ends the link's session only; the account's other sessions, the phone app's included, are untouched.
`confirmed.html`'s CSP therefore allows a connection to the project's API (and nowhere else), and
`link-session.js` loads `config.js` for the public anon key when the page has not.

**Forgot password?** (under the email sign-in) is the app's own code flow (`lib/recovery.js`, a port of
`ui/auth/PasswordRecoveryFlow.kt`): `POST /auth/v1/recover` emails a code, `POST /auth/v1/verify`
(`type: "recovery"`) trades the code for a session that is held in memory only, and `PUT /auth/v1/user`
sets the new password with that session's own token; only then does the session become the tab's
sign-in. It needs the Supabase "Reset Password" email template to carry the code (`{{ .Token }}`),
the same template the app relies on.

The session lives in `sessionStorage`, scoped to this tab: a link opened in a new tab starts signed
out, which is why the dashboard is a single page with hash routes. It does **not** die with the tab:
browsers restore a closed tab, session storage included (Reopen closed tab, a restored browser
session), so a closed tab on a shared computer can come back signed in. Two things limit that: the
stored session carries when it was last used, and a session opened again after `IDLE_SIGN_OUT_HOURS`
(4) without use is signed out and revoked on the server before anything is shown; and Sign out
refreshes an expired access token first, so its logout really ends the server session (GoTrue refuses a
logout signed with an expired token). The sign-in form and the privacy policy tell readers on a shared
computer to use Sign out.

## 3. Publishing — it goes live at `https://gateeng.com/truemileev/`

Nothing in THIS repo is served to anyone. The live pages are separate repos in the `gateeng` GitHub
org; gateeng.com is the org site's custom domain, which is why a project repo named `truemileev`
appears at `https://gateeng.com/truemileev/`.

1. `python tools/web-stamp.py` — a new BUILD stamp in every module and a new `?v=` in `app.html`.
   GitHub Pages caches files for up to ten minutes; when a browser pairs a new page with an older
   module, the dashboard says "The dashboard was just updated. Reload to finish."
2. Clone `gateeng/truemileev`, diff every file against this folder, and copy only the intended
   changes. The owner edits the live repo directly (the product page's footer, the Search Console
   verification file): live wins there. Always diff before overwriting.
3. Commit, push to `main`; Pages rebuilds in about a minute.

Never copy `web/tests/` or `web/fixtures/`: they are not part of this folder and never published.
No file or folder here may start with `_` or `.` (Pages runs Jekyll, which skips them).

**A custom domain later.** A custom domain set on the `truemileev` project repo MOVES it — it stops
answering at gateeng.com/truemileev/. Whichever origin becomes canonical, both console entries above
have to be re-done with it, and sign-in breaks until they are. The origin is also a security boundary:
everything published under gateeng.com shares one storage jar.

## 4. Running it locally

    python -m http.server 8777 --bind 127.0.0.1 --directory web

then open `http://127.0.0.1:8777/truemileev/app.html?fixtures`. On 127.0.0.1 or localhost, `?fixtures`
serves a synthetic demo account (`web/fixtures/demo-account.json`, made by `make-fixtures.js`) through
the same data layer, with no sign-in; maps load OpenFreeMap tiles for the synthetic area unless the
URL adds `&notiles`, and nothing else leaves 127.0.0.1. A "Demo data" pill shows in the topbar.
`&tier=entry`, `&tier=pro`, `&tier=max`, `&tier=trial` or `&tier=business` previews that plan's
locks. ES modules do not load from `file://`, so the server is needed.

Tests (Deno 2): `deno test --allow-read web/tests/`. They pin the formulas to the app's own test
vectors, and they check the rules below across every published file.

## 5. Rules for anything added here later

1. **Read-only, with two exceptions: Account → Delete account calls the `delete_account` function
   after the user types the confirmation word, and Forgot password? sets a new password
   (`PUT /auth/v1/user` with exactly `{password}`). `api.js` refuses each of those without its exact
   body, and refuses every other write.** The tables this page reads carry a `FOR ALL` policy, so a browser
   *could* write to them — and a direct write bypasses the date-ordered cost replay the app and the
   sync functions run, leaving the money wrong on both surfaces with no error. Corrections belong in
   the app. `assets/lib/api.js` is the only file that talks to the network, and it refuses anything
   but reads (including the public report check behind verify.html), sign-in (with the Google
   sign-in's code exchange), sign-out (including ending the session an email link handed to
   confirmed.html or the product page), the password reset's three calls, the read-only tier lookup and
   that one confirmed deletion before a request leaves. Per-browser preferences (units, theme, tiles, report design, memberships) stay in
   this browser's storage and are never sent.
2. **Board figures come from get_stats. Period figures (the Report tiles, vs avg, charts, exports) are
   computed in the browser from the rows with the same formulas the app's Report uses; the app's
   Report does the same on the phone, and the tests pin the formulas.**
3. **get_stats at most once per page load, automatically; a second vehicle only on a click. Refresh
   reloads the page. No polling.** `get_stats` records an app-open on every call. It also has a
   per-account call limit shared with the app (`supabase/functions/_shared/rate_limits.ts`); a 429
   shows `api.BOARD_STATS_BUSY` ("asked for too often ... reload in a few minutes"), never a status code.
   A Business Mileage report registered without its PDF (the app registers it even when the upload
   failed) says so in the Report section (`api.REPORT_PDF_MISSING`) instead of storage's raw answer.
4. **Relabel the internal accounting names.** The prepaid-energy figures arrive under internal key
   names; both render as "Prepaid", told apart by their units, the way the app labels them. No raw
   JSON panel, no generic key→label table; CSV headers are the app's own human labels.
5. **Only drives with an empty car status are counted. Drives in another car and drives waiting for an
   answer may be listed, marked as such, never counted.**
6. **No third-party code. MapLibre GL JS 6.11.2 is served from this folder (`assets/vendor/`,
   BSD-3-Clause, byte-identical to npm; the tests pin its hashes). The one outside service is
   OpenFreeMap map tiles (`tiles.openfreemap.org`), loaded only by the dashboard's maps and telling
   OpenFreeMap the map area being viewed, as the privacy policy's "Map tiles (OpenFreeMap)" line says.
   Only that host is allowed.** No CDN, no remote font, no error-reporting SDK. `app.html`
   carries a Content-Security-Policy: scripts, styles, images and workers from this folder only,
   network requests to this folder, the project's API and the tile host only. The CSP alone does not
   cover the map tiles: MapLibre fetches them inside its worker, and a same-origin worker does not
   inherit a `<meta>` CSP (GitHub Pages sends no CSP header). The tile allow-list is enforced by
   `lib/mapdata.js` `tileRequest` (MapLibre's `transformRequest`, run on the page before the worker
   fetches): the tile host, this site, `data:` and `blob:` pass; any other URL — for example a TileJSON
   that starts pointing elsewhere — is rewritten to an empty `data:` reply and logged once. Printed
   pages never contain a tile map. Account links to the app's Google Play listing and subscriptions
   page (`https://play.google.com`, links only, nothing loaded from there).
7. **Never widen what is disclosed.** Routes, charge locations, home coordinates and the VIN are
   disclosed as *stored*. Behind the user's own session that is fine; a share link, an embed, a
   public URL or a third-party payload turns storage into publication. The dashboard never selects
   the VIN column, never shows a VIN and never prints charge coordinates on a page or in a PDF; on
   screen, charge locations show on the maps only, and home pins are hidden unless you turn them on.
   The two CSV files are the exception, as in the app: the Report CSV and the My data CSV carry each
   charge's GPS column exactly as the app's own exports do (`csv_test.js` pins it). Dropping it from the
   Report CSV is an open owner decision (§6). Garage → Tow shows the tow
   capacity's value, never its key (the key contains the VIN).

## 6. Not here yet

- **Admin metrics.** Everything an operator would want — crash reports, activity, subscriptions —
  has row-level security with no policies, so it is invisible to a browser by design and correctly
  so. It would need a new server-side function with an admin allowlist. Not built.

Asked for in the redesign but not deliverable from the browser as things stand. Each needs an owner
decision (and most an app or cloud change); the page shows a plain explanation in their place:

- **Window sticker (Garage → Vehicle).** The app fetches it from Ford with the VIN; this page never
  selects the VIN (rule 7). Options: keep it app-only (today), or allow selecting the VIN here and
  linking Ford's sticker URL.
- **Door-jamb photos (Garage → Vehicle).** The photos stay in the app's private storage and are never
  uploaded; only the values read from them are shown. Options: keep them phone-only (today), or upload
  them to storage (a privacy-policy change).
- **Memberships (Financial).** The app records none, so the list is typed in and kept per browser
  (never uploaded, cleared when another account signs in here). Real memberships need an app field
  and a cloud column.
- **Payment history (Account → Payments).** Payments go through Google Play; the subscription table
  is invisible to a browser (see Admin metrics), so the page links to Google Play instead. A history
  would need read access to the user's own subscription rows.
- **GPS column in the Report CSV.** Kept for parity with the app's export (rule 7). Owner call:
  keep it, or drop it from the Report CSV and keep it only in My data.
