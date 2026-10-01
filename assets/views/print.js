// TrueMile EV web | the designed documents: #/print/report, #/print/journey/<id>, #/print/mileage, and
// the pieces views/report.js builds its live preview from. Each document is one "paper" (lib/
// reportdesign.js docHtml inside a .print-paper carrying the reader's design); css/print.css hides every
// piece of page chrome on paper and turns the header / footer lines into running lines. The @page rule
// (paper size, orientation, margins, page numbers) is one <style id="rpt-page"> built from enum values
// only, added while a document is on screen and removed when it goes.
// The models are pure (lib/printmodel.js, lib/taxreport.js); this file selects the rows and renders.
import { esc, qs, store } from "../lib/dom.js";
import { allows, lockText, periodPrintWindow } from "../lib/gates.js";
import { inScope, typeOptions, vehicleLabel } from "../lib/rows.js";
import { stateFromQuery, tileWindow, DEFAULT_RANGE, RANGES } from "../lib/periods.js";
import { dateFmt } from "../lib/format.js";
import { derivedForAccount } from "../lib/csv.js";
import { reportModel, journeyModel, selectRows, effectiveFrom } from "../lib/printmodel.js";
import { mileageModel, yearsOf } from "../lib/taxreport.js";
import { groupJourneys, journeyCharges, findJourney } from "../lib/journeys.js";
import { parsePolyline, decimate, svgRoute } from "../lib/route.js";
import {
  parseDesign, serializeDesign, validLogo, pageCss, styleText, paperClass, docHtml, fileTitle,
  STORE_DESIGN, STORE_LOGO,
} from "../lib/reportdesign.js";
import * as api from "../lib/api.js";

export const BUILD = "2026-10-01.1";

const TRIP_COLORS = ["#22C55E", "#3B82F6", "#F59E0B", "#A855F7", "#14B8A6"];
const PAGE_STYLE_ID = "rpt-page";

// ── the stored design (per browser) ───────────────────────────────────────────────────────────

/** {design, logo} from this browser's storage; a missing, blocked or damaged store gives the defaults. */
export function loadDesign() {
  return { design: parseDesign(store.get(STORE_DESIGN, "")), logo: validLogo(store.get(STORE_LOGO, "")) };
}
export function saveDesign(design) { store.set(STORE_DESIGN, serializeDesign(design)); }
/** Stores (or, for null, removes) the logo; false when the browser would not keep it. */
export function saveLogo(url) {
  if (url && validLogo(url)) return store.set(STORE_LOGO, url) !== false;
  store.remove(STORE_LOGO);
  return true;
}

// ── @page ─────────────────────────────────────────────────────────────────────────────────────

/** Adds (or replaces) the page's one @page style for [design]. */
export function setPageCss(design) {
  let st = document.getElementById(PAGE_STYLE_ID);
  if (!st) {
    st = document.createElement("style");
    st.id = PAGE_STYLE_ID;
    document.head.appendChild(st);
  }
  const css = pageCss(design);
  if (st.textContent !== css) st.textContent = css;
}
export function clearPageCss() {
  const st = document.getElementById(PAGE_STYLE_ID);
  if (st) st.remove();
}

/**
 * While a document is on screen, any print (the button, Ctrl+P, the browser menu) names the tab after
 * the document, which Chrome and Edge use as the saved PDF's file name; afterwards the old title comes
 * back. [get]() → {kind, model, design} | null (null: leave the title alone). [before]() runs first
 * (a pending preview is drawn). Returns the unbind function.
 */
export function bindPrintTitle(get, before) {
  let old = null;
  const onBefore = () => {
    if (typeof before === "function") { try { before(); } catch (_) { /* print anyway */ } }
    const cur = get();
    if (!cur) return;
    if (old === null) old = document.title;
    document.title = fileTitle(cur.kind, cur.model, cur.design);
    setPageCss(cur.design);
  };
  const onAfter = () => { if (old !== null) { document.title = old; old = null; } };
  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  return () => {
    onAfter();
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
  };
}

// ── the paper ─────────────────────────────────────────────────────────────────────────────────

/** A document as a paper element's markup (the design's classes and custom properties on it). */
export function paperHtml(o, extraClass = "") {
  const d = parseDesign(o.design);
  return `<div class="${paperClass(d)}${extraClass ? " " + esc(extraClass) : ""}" style="${esc(styleText(d))}">` +
    docHtml({ ...o, design: d }) + `</div>`;
}

/** The route of a journey as a print-safe SVG (never a tile map), or "" when none was recorded. */
export async function journeyRouteSvg(j, units, title) {
  const map = await api.tripRoutes(j.trips.map((t) => t.id));
  const routes = j.trips.map((t) => decimate(parsePolyline(map.get(String(t.id)) || ""), 400));
  if (!routes.some((r) => r.length > 1)) return "";
  return svgRoute(routes, { width: 720, height: 420, units, colors: j.trips.map((_, i) => TRIP_COLORS[i % TRIP_COLORS.length]), title: `Route of ${title}` });
}

// ── building a document from the account ──────────────────────────────────────────────────────

/**
 * The environment every document is built in:
 * {acct, scope, names (Map id → label), units, zone, tier, now}
 */
export function envFor(ctx, scope) {
  const acct = ctx.account;
  const all = (scope && scope.all) || acct.vehicles;
  return {
    acct, scope, units: ctx.units, zone: ctx.tz, tier: ctx.tier, now: ctx.now(),
    names: new Map(all.map((v) => [v.id, vehicleLabel(v, all, ctx.tz)])),
  };
}

/** The scope's name on the vehicle line: the vehicle, or "N vehicles combined". */
export function scopeName(env) {
  const s = env.scope;
  if (s.id === "all") return `${(s.vehicles || s.all || []).length} vehicles combined`;
  return env.names.get(s.id) || "";
}

/** Period state from a route query, with the reader's default period when the query names none. */
export function periodFromQuery(q, defaultRange) {
  const range = q && RANGES.includes(q.range) ? q.range : (RANGES.includes(defaultRange) ? defaultRange : DEFAULT_RANGE);
  return stateFromQuery({ ...(q || {}), range });
}

const refused = (text, lock = false) => ({ ok: false, text, lock });

/**
 * buildPeriod(env, {range, off, from, to, types:Set, car}, design)
 *  → {ok:true, kind:"report", model, vehicleLine, note, rows} | {ok:false, text, lock}
 * The rows are the Report CSV's (selectRows); Pro prints the last 3 months, the start clamped.
 */
export function buildPeriod(env, p, design) {
  if (!allows(env.tier, "periodPrint")) return refused(`Period report: ${lockText("periodPrint")}`, true);
  const w = tileWindow(p.range, env.now, p.off, p.from, p.to, env.zone);
  if (!w) return refused("Pick the start and end dates first.");
  const pw = periodPrintWindow(env.tier, w, env.now, env.zone);
  if (!pw) return refused(`Pro reports cover the last 3 months and this period is older. Any range: ${lockText("periodPrintAnyRange")}.`, true);
  const allTime = p.range === "all";
  const win = { start: pw.start, end: pw.end, allTime };
  const typesOk = allows(env.tier, "tripTypes");
  const types = typesOk ? (p.types || new Set()) : new Set();
  const car = p.car === "other" || p.car === "ask" ? p.car : "all";
  const pick = (wn) => selectRows({ trips: env.acct.trips, charges: env.acct.charges, scope: env.scope, win: wn, types, car });
  const rows = pick(win);
  // The "starts on" note only when the cut removed something: for All time, when the unclamped
  // selection starts before the cut.
  let cutApplied = !!pw.clamped;
  if (cutApplied && allTime) {
    const full = pick({ start: w.start, end: w.end, allTime: true });
    cutApplied = full.trips.length + full.charges.length > 0 &&
      effectiveFrom({ start: 0, end: w.end, allTime: true }, full.trips, full.charges) < pw.start;
  }
  const scopeTrips = env.acct.trips.filter((t) => inScope(t, env.scope));
  const typeLabels = typeOptions(scopeTrips).filter((o) => types.has(o.id)).map((o) => o.label);
  const d = parseDesign(design);
  const model = reportModel({
    trips: rows.trips, charges: rows.charges, fromMs: Math.max(effectiveFrom(win, rows.trips, rows.charges), pw.start), toMs: win.end,
    units: env.units, zone: env.zone, typeLabels, notesByTrip: env.acct.notesByTrip,
    derived: derivedForAccount(env.acct.charges, env.acct.vehicles), vehicleNameOf: (t) => env.names.get(t.vehicleId) || "",
    sections: d.sections, tripCols: d.tripCols, chargeCols: d.chargeCols,
  });
  const note = cutApplied
    ? `Pro reports cover the last 3 months, so this one starts on ${dateFmt(pw.start, "MMM d, yyyy", env.zone)}. Any range: ${lockText("periodPrintAnyRange")}.`
    : "";
  return { ok: true, kind: "report", model, vehicleLine: scopeName(env), note, rows, win, typeLabels, car };
}

/** The journeys of the scope, newest first (groupJourneys order). */
export function scopeJourneys(env) {
  return groupJourneys(env.acct.trips.filter((t) => inScope(t, env.scope)));
}

/** buildJourney(env, jid, vehicleId|null, design) → {ok, kind:"journey", model, vehicleLine, journey} */
export function buildJourney(env, jid, vid, design) {
  if (!allows(env.tier, "journeys")) return refused(`Journey report: ${lockText("journeys")}`, true);
  const js = scopeJourneys(env);
  if (!js.length) return refused("No journeys yet. Journeys are grouped in the app.");
  const j = (jid && (findJourney(js, jid, vid || null) || findJourney(js, jid))) || null;
  if (!j) return refused("This journey was not found for the selected vehicle.");
  const d = parseDesign(design);
  const model = journeyModel({
    journey: j, charges: journeyCharges(j, env.acct.charges), units: env.units, zone: env.zone, notesByTrip: env.acct.notesByTrip,
    derived: derivedForAccount(env.acct.charges, env.acct.vehicles), vehicleLabel: env.names.get(j.vehicleId) || "",
    sections: d.sections, tripCols: d.tripCols, chargeCols: d.chargeCols,
  });
  return { ok: true, kind: "journey", model, vehicleLine: env.names.get(j.vehicleId) || "", journey: j, note: "" };
}

/** buildMileage(env, year) → {ok, kind:"mileage", model, years} (one vehicle only). */
export function buildMileage(env, year) {
  if (!allows(env.tier, "businessPrint")) return refused(`Business mileage summary: ${lockText("businessPrint")}`, true);
  if (env.scope.id === "all") return refused("The business mileage summary is per vehicle. Pick one vehicle.");
  const trips = env.acct.trips.filter((t) => t.vehicleId === env.scope.id);
  const years = yearsOf(trips, env.now, env.zone);
  const y = years.includes(Number(year)) ? Number(year) : years[0];
  const model = mileageModel({ trips, year: y, nowMs: env.now, zone: env.zone, units: env.units, vehicleName: env.names.get(env.scope.id) || "" });
  return { ok: true, kind: "mileage", model, years, year: y, vehicleLine: env.names.get(env.scope.id) || "", note: "" };
}

/** "Sep 27, 2026" in the reader's zone: the date on the "Generated by" line. */
export const generatedOn = (env) => dateFmt(env.now, "MMM d, yyyy", env.zone);

// ── #/print/* ─────────────────────────────────────────────────────────────────────────────────

function toolbar(backHash, note = "") {
  return `<div class="print-toolbar">` +
    `<button type="button" class="btn primary" data-print>Print or save as PDF</button>` +
    `<a class="btn ghost" href="${esc(backHash)}" data-back>← Back</a>` +
    (note ? `<p class="note print-toolnote">${esc(note)}</p>` : "") +
    `</div>`;
}

function decodeSeg(s) {
  const v = String(s || "");
  if (!v.includes("%")) return v;
  try { return decodeURIComponent(v); } catch { return v; }
}

/** The scope a print route covers: ?veh= (Report's vehicle choice), else the page's vehicle. */
function scopeOf(ctx, q) {
  const want = q && q.veh ? String(q.veh) : "";
  if (want && typeof ctx.scopeFor === "function") {
    const ok = want === "all" || (ctx.account.vehicles || []).some((v) => v.id === want);
    if (ok) { try { return ctx.scopeFor(want); } catch (_) { /* the page's own scope */ } }
  }
  return ctx.scope;
}

export function mount(el, ctx) {
  const kind = (ctx.path && ctx.path[1]) || "report";
  const q = ctx.query || {};
  const { design, logo } = loadDesign();
  let alive = true;
  let current = null;           // {kind, model}

  const scope = scopeOf(ctx, q);
  const env = envFor(ctx, scope);

  const onClick = (e) => {
    const b = e.target.closest("[data-print]");
    if (b && !b.disabled) window.print();
  };
  el.addEventListener("click", onClick);
  el.classList.add("print-host");
  setPageCss(design);
  const unbindTitle = bindPrintTitle(() => (current ? { kind: current.kind, model: current.model, design } : null));
  const done = {
    unmount() {
      alive = false;
      el.removeEventListener("click", onClick);
      el.classList.remove("print-host");
      unbindTitle();
      clearPageCss();
    },
  };

  const draw = (back, r, routeHtml = "", extra = "") => {
    el.innerHTML = `<section class="print-view">${toolbar(back, r.note)}${extra}` +
      paperHtml({ kind: r.kind, model: r.model, design, logo, vehicleLine: r.vehicleLine, generatedOn: generatedOn(env), routeHtml }, "print-full") +
      `</section>`;
  };
  const refuse = (back, r) => {
    el.innerHTML = `<section class="print-view">${toolbar(back)}<div class="card"><p class="note lock">${r.lock ? "🔒 " : ""}${esc(r.text)}</p></div></section>`;
    const pb = el.querySelector("[data-print]");
    if (pb) pb.disabled = true;
  };
  const vehQ = q.veh ? { veh: q.veh } : {};

  if (kind === "report") {
    const p = periodFromQuery(q, ctx.defaultRange);
    const types = new Set(String(q.types || "").split(",").map((s) => s.trim()).filter(Boolean));
    const back = "#/report" + qs({ ...q, doc: "period" });
    const r = buildPeriod(env, { ...p, types, car: q.car }, design);
    if (!r.ok) { refuse(back, r); return done; }
    current = r;
    draw(back, r);
    return done;
  }

  if (kind === "journey") {
    const jid = decodeSeg(ctx.path[2]);
    const back = "#/report" + qs({ ...vehQ, doc: "journey", j: jid, v: q.v || "" });
    const r = buildJourney(env, jid, q.v || null, design);
    if (!r.ok) { refuse(back, r); return done; }
    current = r;
    const wantsRoute = parseDesign(design).sections.route;
    draw(back, r, wantsRoute ? `<p class="print-dim print-loading">Loading the route…</p>` : "");
    if (wantsRoute) {
      journeyRouteSvg(r.journey, env.units, r.model.title)
        .then((svg) => { if (alive) draw(back, r, svg); })
        .catch(() => { if (alive) draw(back, r, `<p class="print-dim">The route could not be loaded.</p>`); });
    }
    return done;
  }

  if (kind === "mileage") {
    const back = "#/report" + qs({ ...vehQ, doc: "mileage", year: q.year || "" });
    const r = buildMileage(env, q.year);
    if (!r.ok) { refuse(back, r); return done; }
    current = r;
    const pick = `<div class="print-toolbar print-yearbar"><label class="print-yearpick"><span>Year</span><select class="print-year" aria-label="Year">` +
      r.years.map((v) => `<option value="${v}"${v === r.year ? " selected" : ""}>${v}</option>`).join("") +
      `</select></label></div>`;
    draw(back, r, "", pick);
    el.querySelector(".print-year").addEventListener("change", (e) => ctx.nav("#/print/mileage" + qs({ ...vehQ, year: e.target.value })));
    return done;
  }

  refuse("#/report", refused("This page does not exist."));
  return done;
}
