// TrueMile EV — the launch copy on the public pages (the product page and the adapters page).
// Every word comes from lib/launch.js; this file only puts it in place:
//   [data-launch="key"]      gets launchText()[key] as its text
//   [data-launch-href="beta"] gets the beta sign-up mailto: link (subject and body template)
//   [data-launch-href="dash"] gets the web dashboard's address
//   #plans                   gets the three plan cards
//   #guarantee               gets the launch price guarantee
//   #betaSteps / #betaGets   get the beta's steps and what a tester gets
//   #adapterList             gets the proven adapters
// Importable without a DOM (the web tests call the builders directly).

import { LAUNCH, launchText, planCards, betaMailto } from "./lib/launch.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The three plan cards, as HTML. */
export function plansHtml() {
  return planCards().map((p) => `
    <div class="plan plan-${esc(p.key)}">
      <b>${esc(p.name)}</b>
      <div class="price">${esc(p.price)}</div>
      <span>${esc(p.blurb)}</span>
      <ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    </div>`).join("");
}

/** The launch price guarantee, as HTML. */
export function guaranteeHtml() {
  const g = LAUNCH.guarantee;
  return `
    <b>${esc(g.title)}</b>
    <span>${esc(g.summary)}</span>
    <ul>${g.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <span class="fine">${esc(g.fine)}</span>`;
}

/** The beta's steps, as HTML list items (an <ol> on the page). */
export function betaStepsHtml() {
  return LAUNCH.beta.steps.map((t) => `<li>${esc(t)}</li>`).join("");
}

/** What a beta tester gets, as HTML list items. */
export function betaGetsHtml() {
  return LAUNCH.beta.gets.map((t) => `<li>${esc(t)}</li>`).join("");
}

/** The proven adapters, as HTML (the adapters page's "Recommended" list). */
export function adaptersHtml() {
  return LAUNCH.adapters.map((a) => `<div><b>${esc(a.name)}</b><span>${esc(a.note)}</span></div>`).join("");
}

/** Fill every launch slot of [doc]. */
export function fillLaunch(doc) {
  const text = launchText();
  for (const el of doc.querySelectorAll("[data-launch]")) {
    const v = text[el.getAttribute("data-launch")];
    if (typeof v === "string") el.textContent = v;
  }
  for (const a of doc.querySelectorAll('[data-launch-href="beta"]')) a.setAttribute("href", betaMailto());
  for (const a of doc.querySelectorAll('[data-launch-href="dash"]')) a.setAttribute("href", LAUNCH.dashboard.href);
  const fill = (id, html) => { const el = doc.getElementById(id); if (el) el.innerHTML = html; };
  fill("plans", plansHtml());
  fill("guarantee", guaranteeHtml());
  fill("betaSteps", betaStepsHtml());
  fill("betaGets", betaGetsHtml());
  fill("adapterList", adaptersHtml());
}

if (typeof document !== "undefined") fillLaunch(document);
