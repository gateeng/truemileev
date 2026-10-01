// TrueMile EV — the report check page (verify.html). The QR code on a Business Mileage report leads
// here with ?id=<report ID>. The page asks verify_report for that report's record (lib/api.js
// verifyReport: a GET without sign-in, the JSON form) and shows it.
//
// Rules this file keeps:
//   - lib/api.js is still the only file that talks to the network; this one never fetches.
//   - Nothing from the address is shown except a well-formed report ID (api.reportIdOf), and every
//     word is set with textContent. The record's values are shown only after they parse as the
//     number, date or checksum they should be.
//   - The page says what the record is and no more: the figures are what the TrueMile EV account that
//     made the report registered with its ID. tax_reports rows are written by that account (PostgREST,
//     own_rows), so nothing on the server ties them to the trips: the page never says the app saved
//     them, never calls a report "authentic" or "verified", and says TrueMile EV does not check them.
//     A matching checksum shows only that a file is the one registered with this ID.
//
// Expected JSON from verify_report?id=<id>&format=json (200):
//   {found: true, year, period_start, period_end, business_distance, unit, business_pct, issued, sha256}
// with dates as epoch milliseconds or ISO text; the table's own column names (business_miles,
// distance_unit, created_at) are read too. 404, or {found: false}: no such report.
// Only the current ID form (TM-<year>-<32 hex>) is asked about: verify_report looks up nothing else
// (F21), so an early report's short ID gets its own answer ("legacy", no request) rather than a
// "no record" that would be untrue for a report that exists.
//
// Importable without a DOM: the web tests import it; the page run starts only where a document exists.

import * as api from "./lib/api.js";

export const PRODUCT_URL = "https://gateeng.com/truemileev/";
export const SUPPORT = "support@gateeng.com";

/** The words for each outcome. Every sentence is fixed here. */
export const TEXT = Object.freeze({
  found: {
    tone: "ok", title: "Business Mileage report registered",
    lead: "A Business Mileage report is registered with this ID. The figures below were registered by the " +
      "TrueMile EV account that made the report. TrueMile EV does not check them against the trips. " +
      "Compare them with the report you were given.",
    notes: [
      "If your PDF file's SHA-256 checksum matches the one above, it is the same file that was registered with this ID. " +
        "That does not show that the figures in it are correct.",
      "The figures are the driver's own mileage log, as registered by the driver's account. " +
        "TrueMile EV does not audit or vouch for the trips.",
    ],
  },
  not_found: {
    tone: "warn", title: "No report with this ID",
    lead: "TrueMile EV has no record of a report with this ID. The ID may have been mistyped, or the report, " +
      "or the account that made it, may have been deleted.",
    notes: [],
  },
  invalid: {
    tone: "warn", title: "This link has no report ID",
    lead: "Scan the QR code on the report again. The link it holds ends with the report's ID.",
    notes: [],
  },
  legacy: {
    tone: "info", title: "This report can't be checked on this page",
    lead: "Reports made with early versions of TrueMile EV have a shorter ID, and this page does not look those up. " +
      "To check this report, email " + SUPPORT + " with its ID.",
    notes: [],
  },
  unavailable: {
    tone: "warn", title: "The report could not be checked right now",
    lead: "Check your connection and try again in a few minutes.",
    notes: [],
  },
});

/** A date value (epoch ms, epoch seconds or ISO text) as YYYY-MM-DD (UTC), or "". */
export function dayOf(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  let d;
  if (Number.isFinite(n)) d = new Date(n > 1e11 ? n : n > 1e8 ? n * 1000 : NaN);
  else if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) d = new Date(String(v));
  else return "";
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * verify_report's record -> [[label, value, mono?]] for the rows the page shows. A value that does not
 * parse is left out rather than shown as it came.
 */
export function reportRows(record) {
  const j = record && typeof record === "object" ? record : {};
  const rows = [];
  const year = Math.trunc(Number(j.year));
  if (Number.isFinite(year) && year >= 2000 && year <= 2100) rows.push(["Tax year", String(year)]);
  const a = dayOf(j.period_start), b = dayOf(j.period_end);
  if (a && b) rows.push(["Period", `${a} to ${b}`]);
  const unit = String(j.unit ?? j.distance_unit ?? "mi").trim().toLowerCase() === "km" ? "km" : "mi";
  let dist = j.business_distance !== undefined && j.business_distance !== null ? Number(j.business_distance) : NaN;
  if (!Number.isFinite(dist) && j.business_miles !== undefined && j.business_miles !== null) {
    const miles = Number(j.business_miles);
    dist = Number.isFinite(miles) ? (unit === "km" ? miles * 1.609344 : miles) : NaN;
  }
  if (Number.isFinite(dist) && dist >= 0) rows.push(["Business distance", `${dist.toFixed(1)} ${unit}`]);
  const pct = j.business_pct !== undefined && j.business_pct !== null ? Number(j.business_pct) : NaN;
  if (Number.isFinite(pct) && pct >= 0 && pct <= 100) rows.push(["Business use", `${Math.round(pct)}%`]);
  const issued = dayOf(j.issued ?? j.created_at);
  if (issued) rows.push(["Registered on", issued]);
  const sha = String(j.sha256 ?? "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(sha)) rows.push(["PDF SHA-256", sha, true]);
  return rows;
}

/** The address's report ID (api.reportIdOf), or "". */
export function idFromSearch(search) {
  try { return api.reportIdOf(new URLSearchParams(String(search || "").replace(/^\?/, "")).get("id")); } catch (_) { return ""; }
}

/** {kind, id, rows} for [search]: asks verify_report only when the address carries a report ID. */
export async function check(search) {
  const id = idFromSearch(search);
  if (!id) return { kind: "invalid", id: "", rows: [] };
  const out = await api.verifyReport(id);
  if (out.kind === "found") return { kind: "found", id, rows: reportRows(out.record) };
  const kind = out.kind === "not_found" || out.kind === "invalid" || out.kind === "legacy" ? out.kind : "unavailable";
  return { kind, id, rows: [] };
}

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────────

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

/** Fills #verify with [result] ({kind, id, rows}). Text only. */
export function render(doc, result) {
  const box = doc.getElementById("verify");
  if (!box) return null;
  const kind = result && TEXT[result.kind] ? result.kind : "unavailable";
  const t = TEXT[kind];
  while (box.firstChild) box.removeChild(box.firstChild);
  box.setAttribute("data-tone", t.tone);
  box.setAttribute("data-kind", kind);
  box.appendChild(el(doc, "h1", "", t.title));
  box.appendChild(el(doc, "p", "lead", t.lead));
  const rows = [];
  if (result && result.id && kind !== "invalid") rows.push(["Report ID", result.id, true]);
  if (kind === "found") rows.push(...(result.rows || []));
  if (rows.length) {
    const dl = el(doc, "dl", "vrows");
    for (const [k, v, mono] of rows) {
      dl.appendChild(el(doc, "dt", "", k));
      dl.appendChild(el(doc, "dd", mono ? "mono" : "", v));
    }
    box.appendChild(dl);
  }
  for (const n of t.notes) box.appendChild(el(doc, "p", "", n));
  const links = el(doc, "div", "links");
  const about = el(doc, "a", "btn primary", "About TrueMile EV");
  about.setAttribute("href", PRODUCT_URL);
  links.appendChild(about);
  const mail = el(doc, "a", "btn", SUPPORT);
  mail.setAttribute("href", "mailto:" + SUPPORT);
  links.appendChild(mail);
  box.appendChild(links);
  return t;
}

/** The product page's theme rule (site.js): the system's choice, unless config.js applied a stored one. */
function applyTheme(win, doc) {
  try {
    if (doc.documentElement.getAttribute("data-theme")) return;
    const dark = win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches;
    const light = win.matchMedia && win.matchMedia("(prefers-color-scheme: light)").matches;
    const hr = new Date().getHours();
    doc.documentElement.setAttribute("data-theme", dark ? "dark" : light ? "light" : (hr >= 6 && hr < 18 ? "light" : "dark"));
  } catch (_) { /* keep the stylesheet's default */ }
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById("verify")) {
  applyTheme(window, document);
  api.init(window.TM_CONFIG);
  check(window.location.search)
    .catch(() => ({ kind: "unavailable", id: "", rows: [] }))
    .then((r) => render(document, r));
}
