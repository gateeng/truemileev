// TrueMile EV — the launch copy on the public pages (the product page and the adapters page).
// Every word comes from lib/launch.js and, for Plans & pricing, from lib/plans.js (the dashboard's plan
// table reads the same rows, so the page and the dashboard can never disagree); this file only puts it
// in place:
//   [data-launch="key"]      gets launchText()[key] as its text
//   [data-launch-href="play"] gets the app's Google Play listing (the beta joins in the app, never by email)
//   [data-launch-href="dash"] gets the web dashboard's address
//   #pricingTrial            gets the trial note (the Plans & pricing section, id="pricing")
//   #plans                   gets the three plan cards: Basic, Pro and Max
//   #pricingNotes            gets how to subscribe and cancel, the price note, the button
//   #guarantee               gets the launch price guarantee while it is offered, and is hidden after it
//                            (lib/plans.js guaranteeOpen: through December 31, 2026, Chicago time, read
//                            from the viewer's clock when the page is shown)
//   #betaSteps / #betaGets   get the beta's steps and what a volunteer gets
//   #adapterList             gets the proven adapters
// Importable without a DOM (the web tests call the builders directly).

import { LAUNCH, launchText } from "./lib/launch.js";
import {
  PLAY_LISTING, PLAY_SUBSCRIPTIONS, TERMS_URL, PRICING, pricingPlans, guaranteeOpen,
} from "./lib/plans.js";

/** The app's Google Play listing: the beta's button and the pricing button (the join itself happens in the
 *  app). lib/plans.js PLAY_LISTING, the dashboard's own; web/tests/launch_test.js checks they match. */
export const PLAY_URL = PLAY_LISTING;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** [text], escaped, with its one [word] turned into a link to [href] (the words stay lib/plans.js's). */
const linked = (text, word, href) =>
  esc(text).replace(esc(word), `<a href="${esc(href)}">${esc(word)}</a>`);

/** The trial note above the plan cards, as HTML. */
export function pricingTrialHtml() {
  return esc(PRICING.trial);
}

/** The three plan cards (lib/plans.js pricingPlans), as HTML: a heading, the prices, who it is for, the
 *  features as a checklist and the plan's four limits as a description list. */
export function plansHtml() {
  return pricingPlans().map((p) => `
    <article class="pp pp-${esc(p.key)}" aria-labelledby="plan-${esc(p.key)}">
      <h3 id="plan-${esc(p.key)}">${esc(p.name)}</h3>
      <p class="pp-price"><b>${esc(p.price.main)}</b>${p.price.unit ? ` ${esc(p.price.unit)}` : ""}</p>
      ${p.price.lines.map((l) => `<p class="pp-alt">${esc(l)}</p>`).join("")}
      <p class="pp-who">${esc(p.who)}</p>
      ${p.intro ? `<p class="pp-intro">${esc(p.intro)}</p>` : ""}
      <ul class="pp-checks">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <dl class="pp-limits">${p.limits.map((l) => `
        <div><dt>${esc(l.label)}</dt><dd${l.off ? ' class="pp-off"' : ""}>${esc(l.text)}${l.note ? `<span class="pp-note">${esc(l.note)}</span>` : ""}</dd></div>`).join("")}
      </dl>
    </article>`).join("");
}

/** Under the cards: where to subscribe and cancel, what the prices are, and the button. (A complete copy of
 *  one's data on request is in the Terms only; the page does not repeat it, owner 10/11.) */
export function pricingNotesHtml() {
  return `
    <p>${esc(PRICING.buy)} <a href="${esc(PLAY_SUBSCRIPTIONS)}">${esc(PRICING.manage)}</a></p>
    <p>${esc(PRICING.prices)}</p>
    <p class="pp-cta"><a class="btn primary" href="${esc(PLAY_URL)}">${esc(PRICING.cta)}</a></p>`;
}

/** The launch price guarantee, as a small note: its title, its one sentence and a link to the full terms
 *  (lib/launch.js keeps the conditions, which the dashboard's Plan card and the terms show); "" once it
 *  is no longer offered at [nowMs]. */
export function guaranteeHtml(nowMs = Date.now()) {
  if (!guaranteeOpen(nowMs)) return "";
  const g = LAUNCH.guarantee;
  return `
    <b>${esc(g.title)}</b>
    <span>${esc(g.summary)} ${linked(PRICING.details, "Terms", TERMS_URL)}</span>`;
}

/** The beta's steps, as HTML list items (an <ol> on the page). */
export function betaStepsHtml() {
  return LAUNCH.beta.steps.map((t) => `<li>${esc(t)}</li>`).join("");
}

/** What a beta volunteer gets, as HTML list items. */
export function betaGetsHtml() {
  return LAUNCH.beta.gets.map((t) => `<li>${esc(t)}</li>`).join("");
}

/** The proven adapters, as HTML (the adapters page's "Recommended" list). */
export function adaptersHtml() {
  return LAUNCH.adapters.map((a) => `<div><b>${esc(a.name)}</b><span>${esc(a.note)}</span></div>`).join("");
}

/** Fill every launch slot of [doc]; [nowMs] decides whether the launch price guarantee still shows. */
export function fillLaunch(doc, nowMs = Date.now()) {
  const text = launchText();
  for (const el of doc.querySelectorAll("[data-launch]")) {
    const v = text[el.getAttribute("data-launch")];
    if (typeof v === "string") el.textContent = v;
  }
  for (const a of doc.querySelectorAll('[data-launch-href="play"]')) a.setAttribute("href", PLAY_URL);
  for (const a of doc.querySelectorAll('[data-launch-href="dash"]')) a.setAttribute("href", LAUNCH.dashboard.href);
  const fill = (id, html) => { const el = doc.getElementById(id); if (el) el.innerHTML = html; return el; };
  fill("pricingTrial", pricingTrialHtml());
  fill("plans", plansHtml());
  fill("pricingNotes", pricingNotesHtml());
  const guarantee = guaranteeHtml(nowMs);
  const gEl = fill("guarantee", guarantee);
  if (gEl) gEl.hidden = !guarantee;
  fill("betaSteps", betaStepsHtml());
  fill("betaGets", betaGetsHtml());
  fill("adapterList", adaptersHtml());
}

if (typeof document !== "undefined") fillLaunch(document);
