// TrueMile EV web: #/account. The app's My Account + Plans, on the web:
//   Profile (name, email, sign-in method, member since) · Plan (the plan, where it comes from, the
//   trial, what Basic, Pro and Max include, Upgrade / Manage in Google Play) · Payments (handled by
//   Google Play; nothing to list here) · My data (Pro and Max: the full CSV; Basic: the simple report of
//   what it sees, owner B5; a complete copy on request is in the Terms only, owner 10/11) · Session ·
//   Delete account.
// Delete account is the page's one call that changes anything: api.deleteAccount, after the reader
// types the confirmation word. The server deletes the user last, so a reply means the account is still
// there (deleteError says only what is known).

import * as api from "../lib/api.js";
import { h, render, raw, openDialog, saveBlob, store, iconHtml } from "../lib/dom.js";
import { dateFmt } from "../lib/format.js";
import { vehicleLabel } from "../lib/rows.js";
import { myDataCsv } from "../lib/csv.js";
import {
  planBadge, planTone, sourceLine, trialCard, comparisonRows, currentColumn, canUpgrade, managedInPlay,
  needsPlayWarning, planPrice, guaranteeOpen, PLAY_LISTING, PLAY_SUBSCRIPTIONS,
} from "../lib/plans.js";
import { LAUNCH, guaranteeLine } from "../lib/launch.js";
import { allows } from "../lib/gates.js";
import { mountSimpleReport } from "./simplereport.js";

export const BUILD = "2026-11-12.2";

// Shown in every delete dialog, whatever the plan looks like here: delete_account never calls Google
// Play, so a live subscription keeps renewing after the account is gone. The menu path is kept to what
// Google's help (answer 7018481, checked 9/29) confirms: it names Payments & subscriptions, no Profile step.
export const PLAY_CANCEL_NOTE = "Deleting your account doesn't cancel a Google Play subscription. " +
  "Cancel it in Google Play first (in the Google Play Store under Payments & subscriptions).";

// ── Sign in again before deleting (audit 9/30, F24) ──────────────────────────────────────────────
// delete_account can ask for a recent sign-in (api.isReauthRequired). The dialog says so and offers
// "Sign in again": this tab is signed out, the sign-in page says why, and once the same account has
// signed in the dialog opens again (app.js signInAgainToDelete / enter). Nothing is deleted on the way.

/** The dialog's sentence when the server asks for a fresh sign-in. */
export const REAUTH_TEXT = "For your safety, sign in again before you delete your account. Nothing was deleted. " +
  "After you sign in, the delete dialog opens again.";
/** The dialog's sentence when it opens again after that sign-in. */
export const SIGNED_IN_AGAIN_TEXT = `You're signed in again. Type ${api.DELETE_CONFIRM_WORD} to finish deleting your account.`;
/** A second "sign in again" moments after a fresh sign-in: said instead of asking for yet another. */
export const REAUTH_LOOP_TEXT = "Your new sign-in wasn't accepted yet, so nothing was deleted. Try again in a few minutes.";
/** A second "sign in again" this soon after a fresh sign-in is not answered with another sign-in. */
export const REAUTH_LOOP_GUARD_MS = 2 * 60 * 1000;

/**
 * Answer a "sign in again" with a sign-in? Yes, unless the dialog opened after a sign-in less than
 * REAUTH_LOOP_GUARD_MS ago ([againAtMs]; null = it did not): then the server did not accept the new
 * sign-in, and asking again would only loop. Longer than that, the reader may simply have waited past
 * the server's limit.
 */
export function shouldSignInAgain(againAtMs, nowMs) {
  if (againAtMs === null || againAtMs === undefined || !Number.isFinite(againAtMs)) return true;
  const since = nowMs - againAtMs;
  return since < 0 || since > REAUTH_LOOP_GUARD_MS;
}

/** "google" or "email": how the reader signs in (the sign-in page's note and its prefilled email). */
export const reauthMethod = (user) => (api.signInMethod(user) === "Google" ? "google" : "email");

/** The sign-in page's note while a "sign in again to delete" is waiting. [method] "" when unknown. */
export function reauthSignInNote(method, email) {
  const tail = " After you sign in, the delete dialog opens again.";
  const who = String(email || "").trim();
  if (method === "google") return `For your safety, sign in again to delete your account: use Continue with Google${who ? ` with ${who}` : ""}.${tail}`;
  if (method === "email") return `For your safety, sign in again to delete your account: enter your password below.${tail}`;
  return `For your safety, sign in again to delete your account.${tail}`;
}

const ext = (href, text, cls = "") =>
  h`<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function mount(el, ctx) {
  const acct = ctx.account;
  const zone = ctx.tz;
  const tier = ctx.tier || acct.tier;
  const user = acct.user || null;
  const name = api.accountName(user) || api.accountName({ email: acct.email }) || "Your account";
  const email = acct.email || (user && user.email) || "";
  const createdMs = user && user.created_at ? Date.parse(user.created_at) : NaN;
  const since = Number.isFinite(createdMs) ? dateFmt(createdMs, "MMM d, yyyy", zone) : "—";
  const fixtures = !!ctx.fixtures;
  const all = acct.vehicles;
  const withRows = all.filter((v) => v.tripCount + v.chargeCount > 0);
  const dataVehicles = withRows.length ? withRows : all;
  const names = new Map(all.map((v) => [v.id, vehicleLabel(v, all, zone)]));
  // B5: the full download is Pro and up; Basic's report covers the vehicles it can pick (never one the
  // plan choice locked, D2).
  const myDataOk = allows(tier, "myData");
  const simpleVehicles = ctx.vehicles && ctx.vehicles.length ? ctx.vehicles : dataVehicles;
  let alive = true;

  const trial = trialCard(tier, tier && tier.serverNowMs > 0 ? tier.serverNowMs : ctx.now());
  const col = currentColumn(tier);
  const rows = comparisonRows();
  const cell = (v, on) => v === true ? h`<td class="account-yes${on ? " account-cur" : ""}"><span aria-hidden="true">✓</span><span class="sr-only">Included</span></td>`
    : v === false ? h`<td class="account-no${on ? " account-cur" : ""}"><span class="sr-only">Not included</span>—</td>`
    : h`<td class="account-lim${on ? " account-cur" : ""}">${v}</td>`;

  render(el, h`
    <div class="grid-cards account">
      <div class="account-side">
      <section class="card account-profile" aria-labelledby="acct-profile">
        <div class="card-head"><h2 class="card-title" id="acct-profile">${raw(iconHtml("person", { size: 18 }))}Profile</h2></div>
        <div class="account-who">
          <span class="account-avatar" aria-hidden="true">${(name.trim().charAt(0) || "?").toUpperCase()}</span>
          <div class="account-who-text"><div class="account-name">${name}</div><div class="subtitle">${email}</div></div>
        </div>
        <dl class="kv">
          <dt>Email</dt><dd>${email || "—"}</dd>
          <dt>Sign-in method</dt><dd>${api.signInMethod(user)}</dd>
          <dt>Member since</dt><dd>${since}</dd>
        </dl>
      </section>

      <section class="card account-payments" aria-labelledby="acct-pay">
        <div class="card-head"><h2 class="card-title" id="acct-pay">${raw(iconHtml("receipt_long", { size: 18 }))}Payments</h2></div>
        <p>Payments are handled by Google Play. TrueMile never sees your card, and your payment history is not stored with your TrueMile data. Receipts, renewals and cancellations: Google Play → Payments &amp; subscriptions.</p>
        <p>${ext(PLAY_SUBSCRIPTIONS, h`${raw(iconHtml("credit_card", { size: 18 }))}<span>Open Google Play subscriptions</span>`, "btn ghost")}</p>
      </section>

      <section class="card account-data" aria-labelledby="acct-data">
        <div class="card-head"><h2 class="card-title" id="acct-data">${raw(iconHtml("download", { size: 18 }))}My data</h2></div>
        ${myDataOk ? h`
        <p>Download every trip &amp; charge you've logged (CSV).</p>
        <p class="note">One file per vehicle, in the units they were recorded in (mi, °F), with each drive's route. Made in this browser; nothing is sent anywhere.</p>
        <div class="account-btns">
          ${dataVehicles.length ? dataVehicles.map((v) => h`<button type="button" class="btn" data-mydata="${v.id}">${raw(iconHtml("file_download", { size: 20 }))}<span>${dataVehicles.length > 1 ? names.get(v.id) : "Download my data"}</span></button>`)
            : h`<p class="note">No vehicle yet: vehicles are added in the app.</p>`}
        </div>
        <div class="account-msg" aria-live="polite"></div>` : h`<div class="account-simple"></div>`}
      </section>

      <section class="card account-session" aria-labelledby="acct-session">
        <div class="card-head"><h2 class="card-title" id="acct-session">${raw(iconHtml("logout", { size: 18 }))}Session</h2></div>
        <p>Signed in as <b>${email || name}</b> in this browser tab.</p>
        ${fixtures ? h`<p class="note">This is the demo account: there is nothing to sign out of.</p>`
          : h`<button type="button" class="btn ghost account-signout">${raw(iconHtml("logout", { size: 20 }))}<span>Sign out</span></button>`}
      </section>

      </div>
      <section class="card account-plan" aria-labelledby="acct-plan">
        <div class="card-head"><h2 class="card-title" id="acct-plan">${raw(iconHtml("workspace_premium", { size: 18 }))}Plan</h2>
          ${tier && !tier.unknown ? h`<span class="card-actions"><span class="pill ${planTone(tier)}">${planBadge(tier)}</span></span>` : ""}</div>
        <p class="account-source">${sourceLine(tier)}</p>
        ${trial ? h`<div class="msg ${trial.state === "ended" || trial.state === "blocked" ? "warn" : "info"} account-trial">
            <b>${trial.title}</b><div>${trial.body}</div>${trial.note ? h`<div class="note">${trial.note}</div>` : ""}</div>` : ""}
        <h3 class="account-h">What your plan includes</h3>
        <div class="scroll account-compare">
          <table class="table">
            <thead><tr><th scope="col">Feature</th>
              <th scope="col" class="${col === "basic" ? "account-cur" : ""}">${LAUNCH.entryPlan}${col === "basic" ? h` <span class="pill tier-entry">Yours</span>` : ""}</th>
              <th scope="col" class="${col === "pro" ? "account-cur" : ""}">Pro${col === "pro" ? h` <span class="pill tier-pro">Yours</span>` : ""}<div class="note account-price">${planPrice("pro")}</div></th>
              <th scope="col" class="${col === "max" ? "account-cur" : ""}">Max${col === "max" ? h` <span class="pill tier-max">Yours</span>` : ""}<div class="note account-price">${planPrice("max")}</div></th></tr></thead>
            <tbody>${rows.map((r) => h`<tr><td>${r.label}</td>${cell(r.basic, col === "basic")}${cell(r.pro, col === "pro")}${cell(r.max, col === "max")}</tr>`)}</tbody>
          </table>
        </div>
        <p class="note account-prices">${LAUNCH.priceNote}</p>
        ${guaranteeOpen(ctx.now()) ? h`<p class="note account-guarantee">${guaranteeLine()}</p>` : ""}
        ${canUpgrade(tier) ? h`<div class="account-upgrade">
            ${ext(PLAY_LISTING, h`${raw(iconHtml("workspace_premium", { size: 20 }))}<span>Upgrade in the TrueMile app</span>`, "btn primary")}
            <p class="note">Plans are bought through Google Play inside the app: open TrueMile → Settings → My account → Plans &amp; subscription. Your plan shows up here the next time you open this page.</p>
          </div>` : ""}
        ${managedInPlay(tier) || !tier || tier.unknown ? h`<p class="account-manage">${ext(PLAY_SUBSCRIPTIONS, h`${raw(iconHtml("credit_card", { size: 18 }))}<span>Manage in Google Play</span>`, "btn ghost")}</p>` : ""}
      </section>

      <section class="card account-danger span-all" aria-labelledby="acct-delete">
        <div class="card-head"><h2 class="card-title" id="acct-delete">${raw(iconHtml("delete_forever", { size: 18 }))}Delete my account</h2></div>
        <p>Deletes your account and all personal data from our servers. This cannot be undone.</p>
        <button type="button" class="btn danger account-delete" ${fixtures ? h`disabled aria-describedby="acct-demo-note"` : ""}>${raw(iconHtml("delete_forever", { size: 20 }))}<span>Delete account…</span></button>
        ${fixtures ? h`<p class="note" id="acct-demo-note">The demo account cannot be deleted</p>` : ""}
        <div class="account-delete-msg" aria-live="assertive"></div>
      </section>
    </div>`);

  const $ = (s) => el.querySelector(s);
  const msg = $(".account-msg");
  const simple = myDataOk ? null : mountSimpleReport($(".account-simple"), ctx, { vehicles: simpleVehicles, names });

  // ── My data ────────────────────────────────────────────────────────────────────────────────
  async function downloadMyData(vid, btn) {
    const v = all.find((x) => x.id === vid);
    if (!v || !myDataOk) return;
    const trips = acct.trips.filter((t) => t.vehicleId === vid);
    const charges = acct.charges.filter((c) => c.vehicleId === vid);
    if (!trips.length && !charges.length) { render(msg, h`<p class="msg info">No data yet</p>`); return; }
    btn.disabled = true;
    try {
      const routes = new Map();
      const ids = trips.map((t) => t.id);
      for (let i = 0; i < ids.length; i += 10) {
        if (!alive) return;
        render(msg, h`<p class="note">Fetching routes ${i} / ${ids.length}…</p>`);
        const got = await api.tripRoutes(ids.slice(i, i + 10));
        for (const [id, poly] of got) routes.set(id, poly);
      }
      if (!alive) return;
      const out = myDataCsv({ vehicle: v, vehicleName: names.get(vid), trips, charges, routes, todayMs: ctx.now(), zone });
      saveBlob(new Blob([out.text], { type: "text/csv;charset=utf-8" }), out.name);
      render(msg, h`<p class="note">Saved ${out.name} (${trips.length} trips, ${charges.length} charging sessions)</p>`);
    } catch (e) {
      render(msg, h`<p class="msg err">Could not build the file: ${e && e.message ? e.message : String(e)}</p>`);
    } finally {
      btn.disabled = false;
    }
  }
  const onClick = (e) => {
    const b = e.target.closest("button[data-mydata]");
    if (b) downloadMyData(b.dataset.mydata, b);
  };
  el.addEventListener("click", onClick);

  // ── Session ────────────────────────────────────────────────────────────────────────────────
  const so = $(".account-signout");
  if (so) {
    so.addEventListener("click", async () => {
      so.disabled = true;
      await api.auth.signOut().catch(() => {});
      location.replace(location.pathname + location.search);
    });
  }

  // ── Delete account ─────────────────────────────────────────────────────────────────────────
  const del = $(".account-delete");
  if (del && !fixtures) del.addEventListener("click", () => openDelete());

  // "Sign in again" (F24): this tab is signed out and the sign-in page explains why; app.js opens the
  // dialog again once the same account is back (ctx.openDelete).
  const signInAgain = () => {
    if (typeof ctx.signInAgainToDelete === "function") ctx.signInAgainToDelete({ provider: reauthMethod(user), email });
  };
  // Set just before openDelete() when the dialog opens again after that sign-in (its time), else null.
  let reopenedAtMs = null;

  function openDelete() {
    const word = api.DELETE_CONFIRM_WORD;
    const againAtMs = Number.isFinite(reopenedAtMs) ? reopenedAtMs : null;
    reopenedAtMs = null;
    render($(".account-delete-msg"), "");
    const body = document.createElement("div");
    body.className = "account-delete-dialog";
    render(body, h`
      ${againAtMs !== null ? h`<p class="msg ok account-again">${SIGNED_IN_AGAIN_TEXT}</p>` : ""}
      <div class="msg ${needsPlayWarning(tier) ? "warn" : "info"} account-play">
          <p>${PLAY_CANCEL_NOTE}</p>
          ${ext(PLAY_SUBSCRIPTIONS, "Open Google Play subscriptions")}
        </div>
      <p>This permanently deletes your account and its data from our servers — your trips and routes, your charges with their locations and prices, your settings and your reports. A battery-health record keyed to the vehicle's VIN stays with the vehicle: it holds no name, email, account, locations or costs, but a VIN can identify a vehicle's owner, so it is not anonymous (see the <a href="https://gateeng.com/truemile-privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>; email us the VIN to have it deleted). A one-way code that stores no VIN, no adapter address and no account is kept for up to 90 days so the introductory period can't be restarted on the same vehicle. Community price contributions you made (a public station's location and price under a coded identifier, never your account) expire within 14 days, and the other short-lived records the Privacy Policy lists — the sign-in security log, crash reports, our host's request logs, backups and the deleted account's ID — roll off on its schedule. Re-signing up starts from scratch.</p>
      <p class="note">The TrueMile app on your phone keeps its own copy until you delete the account there or uninstall the app. It will be signed out. Signing in again on that phone can upload that copy to a new account.</p>
      <label for="acct-confirm">Type ${word} to confirm.</label>
      <input id="acct-confirm" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
      <div class="account-dlg-msg" aria-live="assertive"></div>
      <div class="account-dlg-btns">
        <button type="button" class="btn ghost account-cancel">Cancel</button>
        <button type="button" class="btn danger account-forever" disabled>${raw(iconHtml("delete_forever", { size: 20 }))}<span>Delete forever</span></button>
        <button type="button" class="btn primary account-reauth" hidden>${raw(iconHtml("person", { size: 20 }))}<span>Sign in again</span></button>
      </div>`);
    let busy = false;
    const close = openDialog({ title: "Delete account?", bodyEl: body, canClose: () => !busy });
    const dlg = body.closest("dialog");
    const xBtn = dlg ? dlg.querySelector(".dialog-x") : null;
    const input = body.querySelector("#acct-confirm");
    const go = body.querySelector(".account-forever");
    const cancel = body.querySelector(".account-cancel");
    const again = body.querySelector(".account-reauth");
    const out = body.querySelector(".account-dlg-msg");
    const sync = () => { go.disabled = busy || input.value.trim() !== word; if (xBtn) xBtn.disabled = busy; };
    input.addEventListener("input", sync);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !go.disabled) go.click(); });
    cancel.addEventListener("click", () => { if (!busy) close(); });
    again.addEventListener("click", () => { if (!busy) { close(); signInAgain(); } });
    go.addEventListener("click", async () => {
      if (busy || input.value.trim() !== word) return;
      busy = true;
      sync();
      cancel.disabled = true;
      input.disabled = true;
      go.querySelector("span").textContent = "Deleting…";
      out.innerHTML = "";
      try {
        await api.deleteAccount(input.value);
        store.removePrefix("tm.");
        close();
        if (typeof ctx.accountDeleted === "function") ctx.accountDeleted();
        else location.replace(location.pathname + location.search);
      } catch (e) {
        busy = false;
        cancel.disabled = false;
        input.disabled = false;
        go.querySelector("span").textContent = "Delete forever";
        sync();
        // The server wants a fresh sign-in first (F24): nothing was deleted. Offer "Sign in again" in
        // place of Delete forever, unless the reader signed in again moments ago (then say it failed,
        // rather than loop through sign-in).
        if (api.isReauthRequired(e)) {
          const retry = shouldSignInAgain(againAtMs, ctx.now()) && typeof ctx.signInAgainToDelete === "function";
          const text = retry ? REAUTH_TEXT : REAUTH_LOOP_TEXT;
          if (body.isConnected) {
            render(out, h`<p class="msg ${retry ? "info" : "err"}">${text}</p>`);
            if (retry) {
              go.hidden = true;
              input.disabled = true;
              again.hidden = false;
              again.focus();
            }
          } else if (alive) {
            const pageMsg = $(".account-delete-msg");
            render(pageMsg, h`<p class="msg ${retry ? "info" : "err"}">${text}</p>
              ${retry ? h`<button type="button" class="btn primary account-reauth-page">${raw(iconHtml("person", { size: 20 }))}<span>Sign in again</span></button>` : ""}`);
            const b = pageMsg.querySelector(".account-reauth-page");
            if (b) b.addEventListener("click", signInAgain);
          }
          return;
        }
        // A dismissed dialog (a browser may close it on a repeated Escape) → say it on the page instead.
        if (body.isConnected) render(out, h`<p class="msg err">${deleteError(e)}</p>`);
        else if (alive) render($(".account-delete-msg"), h`<p class="msg err">${deleteError(e)}</p>`);
      }
    });
    input.focus();
  }

  // Back from signing in again (F24): the dialog opens once, with a line saying so.
  if (ctx.openDelete && del && !fixtures) {
    reopenedAtMs = ctx.now();
    openDelete();
  }

  return {
    unmount() {
      alive = false;
      el.removeEventListener("click", onClick);
      if (simple) simple.destroy();
    },
  };
}

// Errors thrown before anything is sent (api.request's own guards): the account is certainly intact.
const NOT_SENT = /^(blocked:|The dashboard is not configured|No network in this environment|Type the confirmation word)/;
// Gateway replies: the function may still be running (or have finished) behind them.
const GATEWAY = new Set([502, 503, 504]);

/** The step a delete_account error reply names ("storage-purge", "delete", …), or "". */
function stepOf(e) {
  try { const j = JSON.parse(String((e && e.detail) || "")); return j && typeof j.step === "string" ? j.step : ""; } catch (_) { return ""; }
}

/**
 * The reader's sentence for a failed deletion. Only what is known is claimed: a reply from the
 * function means the account is still there (it deletes the user last), but issued report PDFs are
 * purged just before that; no reply (a dropped connection, a gateway timeout, a 2xx without the
 * confirmation) means the outcome is unknown.
 */
export function deleteError(e) {
  const status = e && e.status;
  const msg = String((e && e.message) || "");
  const said = String((e && (e.serverMessage || e.message)) || "no reply").replace(/[.\s]+$/, "");
  if (api.isReauthRequired(e)) return REAUTH_TEXT;
  if (status === 401) return "Your session is no longer valid. If you just deleted this account, it is gone; otherwise sign in again and retry.";
  if (status === 400) return "The confirmation word did not reach the server. Nothing was deleted.";
  if (!status && msg === "Signed out") {
    return "You are signed out in this tab, so the request was not sent and your account is still there. Sign in again, then delete it from Account.";
  }
  if (!status && NOT_SENT.test(msg)) return `The request was not sent, so your account is still there: ${said}.`;
  if (!status || GATEWAY.has(status)) {
    return `We could not confirm whether your account was deleted (${said}). Reload this page: if it asks you to sign in and your sign-in no longer works, the account was deleted. Otherwise it is still there and you can try again.`;
  }
  const step = stepOf(e);
  const partial = step === "storage-purge" || step === "delete"
    ? " Some of your issued mileage-report PDFs may already have been removed; trying again completes the deletion." : "";
  return `Your account is still there: ${said}.${partial} Try again in a minute.`;
}
