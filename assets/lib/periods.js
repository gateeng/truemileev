// TrueMile EV web: the Report's periods. Pure, DOM-free. Port of Reportscreen.kt:87-296
// (ReportRange, rangeSteps, periodWindow, endOfDay, rangeValueLabel, rangeButtonLabel).

import { parts, fromLocal, startOfDay, endOfDay, addDays, parseYmd } from "./tz.js";
import { dateFmt } from "./format.js";

export const BUILD = "2026-09-27.3";

/** The owner's order (9/26): day, week, month, year, YTD, all time, custom. */
export const RANGES = ["day", "week", "month", "year", "ytd", "all", "custom"];
export const LABELS = {
  day: "Day", week: "Week", month: "Month", year: "Year", ytd: "Year to date", all: "All time", custom: "Custom…",
};
export const DEFAULT_RANGE = "week";

/** rangeSteps: only Day, Week, Month and Year step back one period at a time. */
export const steppable = (range) => range === "day" || range === "week" || range === "month" || range === "year";

/**
 * periodWindow (RS:154-182): one whole period, [offset] periods back (0 = current, never positive).
 * The current period runs to the END OF TODAY; an earlier one to its last millisecond.
 *  day   one calendar day
 *  week  a ROLLING seven days ending on the day ("Sep 20-26"), stepping seven days at a time
 *  month one calendar month; year one calendar year
 *  ytd   Jan 1 to the end of today (offset ignored), also the answer for any non-period range
 */
export function periodWindow(range, nowMs, offset = 0, zone) {
  const back = Math.min(Math.trunc(offset) || 0, 0);
  const today = startOfDay(nowMs, zone);
  const p = parts(today, zone);
  let start, next;
  switch (range) {
    case "day":
      start = addDays(today, back, zone);
      next = addDays(start, 1, zone);
      break;
    case "week":
      start = addDays(today, 7 * back - 6, zone);
      next = addDays(start, 7, zone);
      break;
    case "month":
      start = fromLocal(p.y, p.mo + back, 1, 0, 0, 0, 0, zone);
      next = fromLocal(p.y, p.mo + back + 1, 1, 0, 0, 0, 0, zone);
      break;
    case "year":
      start = fromLocal(p.y + back, 1, 1, 0, 0, 0, 0, zone);
      next = fromLocal(p.y + back + 1, 1, 1, 0, 0, 0, 0, zone);
      break;
    default:
      return { start: fromLocal(p.y, 1, 1, 0, 0, 0, 0, zone), end: endOfDay(nowMs, zone) };
  }
  return { start, end: back === 0 ? endOfDay(nowMs, zone) : next - 1 };
}

/**
 * The custom window from two "yyyy-mm-dd" dates: the first at local midnight, the last at
 * 23:59:59.999, swapped when picked backwards, never past the end of today. null while half-built.
 */
export function customWindow(fromYmd, toYmd, zone, nowMs = Date.now()) {
  const a = parseYmd(fromYmd), b = parseYmd(toYmd);
  if (!a || !b) return null;
  let s = fromLocal(a.y, a.mo, a.d, 0, 0, 0, 0, zone);
  let e = fromLocal(b.y, b.mo, b.d + 1, 0, 0, 0, 0, zone) - 1;
  if (s > e) {
    s = fromLocal(b.y, b.mo, b.d, 0, 0, 0, 0, zone);
    e = fromLocal(a.y, a.mo, a.d + 1, 0, 0, 0, 0, zone) - 1;
  }
  const todayEnd = endOfDay(nowMs, zone);
  if (e > todayEnd) e = todayEnd;
  if (s > e) s = startOfDay(e, zone);
  return { start: s, end: e };
}

/**
 * A half-built custom range (only one date picked) covers what reportRangeWindow gives it (RS:202-208):
 * the picked start to now, or seven days before now to the picked end (its end of day), swapped when
 * backwards. null when both dates are picked (customWindow applies) or neither is.
 */
export function halfCustomWindow(fromYmd, toYmd, zone, nowMs = Date.now()) {
  const a = parseYmd(fromYmd), b = parseYmd(toYmd);
  if ((a && b) || (!a && !b)) return null;
  let s = a ? fromLocal(a.y, a.mo, a.d, 0, 0, 0, 0, zone) : nowMs - 7 * 86_400_000;
  let e = b ? endOfDay(fromLocal(b.y, b.mo, b.d, 12, 0, 0, 0, zone), zone) : nowMs;
  if (s > e) [s, e] = [e, s];
  return { start: s, end: e };
}

/**
 * The window the TILES cover: All time is [0, end of today] (RS:217-221); Custom is the picked
 * dates (null while half-built); every other range its period.
 */
export function tileWindow(range, nowMs, offset, fromYmd, toYmd, zone) {
  if (range === "all") return { start: 0, end: endOfDay(nowMs, zone) };
  if (range === "custom") return customWindow(fromYmd, toYmd, zone, nowMs);
  return periodWindow(range, nowMs, steppable(range) ? offset : 0, zone);
}

/**
 * rangeValueLabel (RS:269-296), en-US: the window itself, not the range's name.
 *  day "Sep 25" · month "Sep 2026" · year "2026" · all "All time"
 *  week / ytd / custom: one date "Jan 1"; inside a month "Sep 20-26"; else "Aug 28 - Sep 3";
 *  a custom window starting in an earlier year "Jul 1, 2025 - Sep 17"
 *  day / week / ytd / custom add ", yyyy" when the window ENDS in another year than now.
 * A half-built custom window (win null) reads "Pick dates" (rangeButtonLabel).
 */
export function rangeValueLabel(range, win, nowMs, zone) {
  if (range === "all") return LABELS.all;
  if (!win) return range === "custom" ? "Pick dates" : "";
  const from = win.start, to = win.end;
  const f = (ms, pat) => dateFmt(ms, pat, zone);
  const year = f(to, "yyyy") !== f(nowMs, "yyyy") ? `, ${f(to, "yyyy")}` : "";
  switch (range) {
    case "day": return f(to, "MMM d") + year;
    case "month": return f(to, "MMM yyyy");
    case "year": return f(to, "yyyy");
    default: {
      let s;
      if (f(from, "yyyyMMdd") === f(to, "yyyyMMdd")) s = f(to, "MMM d");
      else if (f(from, "yyyyMM") === f(to, "yyyyMM")) s = `${f(from, "MMM d")}-${f(to, "d")}`;
      else if (range === "custom" && f(from, "yyyy") !== f(to, "yyyy")) s = `${f(from, "MMM d")}, ${f(from, "yyyy")} - ${f(to, "MMM d")}`;
      else s = `${f(from, "MMM d")} - ${f(to, "MMM d")}`;
      return s + year;
    }
  }
}

/** Not used: the web lists the whole window (spec 13.8). Kept for the frozen API. */
export function listCaption() { return ""; }

/**
 * The Dashboard's period state from route query keys (range, off, from, to), validated: an unknown
 * range is the default Week, off is an integer ≤ 0 (0 for a range that does not step).
 */
export function stateFromQuery(q = {}) {
  const range = RANGES.includes(q.range) ? q.range : DEFAULT_RANGE;
  let off = Math.trunc(Number(q.off)) || 0;
  if (off > 0 || !steppable(range)) off = 0;
  const from = parseYmd(q.from) ? q.from : "";
  const to = parseYmd(q.to) ? q.to : "";
  return { range, off, from: range === "custom" ? from : "", to: range === "custom" ? to : "" };
}

/** The inverse: the query keys for a period state (defaults dropped). */
export function queryFromState(s) {
  const q = {};
  if (s.range && s.range !== DEFAULT_RANGE) q.range = s.range;
  if (s.off && steppable(s.range)) q.off = String(s.off);
  if (s.range === "custom") { if (s.from) q.from = s.from; if (s.to) q.to = s.to; }
  return q;
}
