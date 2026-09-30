// TrueMile EV web: number, money, date and duration formatting (en-US). Pure, DOM-free.
//
// The app formats with Java's "%.Nf" (Locale.US for exports, the default locale for tiles, which is
// en-US for this owner). Java rounds HALF-UP on the shortest decimal representation of the double
// (FormattedFloatingDecimal.applyPrecision), which is NOT what Number.prototype.toFixed does:
// Java "%.1f" of 0.35 is "0.4", toFixed(1) is "0.3". fixed() below reproduces Java's digits.

import { parts } from "./tz.js";

export const BUILD = "2026-09-30.2";

/** U+2212, the typographic minus the "vs avg" line uses. */
export const MINUS = "−";

/**
 * "%.nf" (Java, Locale.US, no grouping). A result that rounds to zero prints without a sign
 * ("0.00", never "-0.00"). NaN / infinities print as Java does.
 */
export function fixed(v, n = 0) {
  v = Number(v);
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  n = Math.max(0, Math.trunc(n));
  const neg = v < 0;
  const s = Math.abs(v).toString();                     // shortest round-trip digits, like Java
  const [mant, expStr] = s.split("e");
  const exp = expStr ? Number(expStr) : 0;
  const [ip, fp = ""] = mant.split(".");
  let digits = ip + fp;
  let point = ip.length + exp;                          // decimal point sits after `point` digits
  const lead = digits.match(/^0*/)[0].length;           // strip leading zeros ("0.0123")
  if (lead === digits.length) { digits = "0"; point = 1; }
  else { digits = digits.slice(lead); point -= lead; }
  const keep = point + n;                               // digits kept before rounding
  let int;                                              // the scaled integer as a digit string
  if (keep < 0) int = "0";
  else {
    int = digits.slice(0, keep).padEnd(keep, "0") || "0";
    if (keep < digits.length && digits.charCodeAt(keep) >= 53) int = incr(int);
  }
  int = int.replace(/^0+(?=\d)/, "");
  const padded = int.padStart(n + 1, "0");
  const whole = padded.slice(0, padded.length - n);
  const frac = padded.slice(padded.length - n);
  const out = n > 0 ? `${whole}.${frac}` : whole;
  return neg && /[1-9]/.test(out) ? "-" + out : out;
}

function incr(ds) {
  const a = ds.split("");
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === "9") { a[i] = "0"; i--; }
    else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); return a.join(""); }
  }
  return "1" + a.join("");
}

/** "%,.nf": fixed() with US thousands separators (only the Trip Detail odometer uses it). */
export function grouped(v, n = 0) {
  const s = fixed(v, n);
  const neg = s.startsWith("-");
  const [w, f] = (neg ? s.slice(1) : s).split(".");
  const g = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + g + (f !== undefined ? "." + f : "");
}

/** "$" + fixed(v, n); a negative amount reads "-$1.23". */
export function money(v, n = 2) {
  const s = fixed(v, n);
  return s.startsWith("-") ? "-$" + s.slice(1) : "$" + s;
}

/**
 * formatTripDuration (UnitFormatter.kt:17-26): 0 → "0m"; 1-59 s → "<1m"; under an hour "Nm";
 * otherwise "Hh Mm" (no zero pad).
 */
export function tripDuration(sec) {
  const s = Math.max(0, Math.trunc(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (s >= 1 && s <= 59) return "<1m";
  return `${m}m`;
}

/** The charge detail's duration (ChargeScreen:4393-4394): whole minutes, "Hh Mm" from 60, else "Mm". */
export function hm(min) {
  const m = Math.trunc(Number(min) || 0);
  return m >= 60 ? `${Math.trunc(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** ReportCompare.fmtCount: ≥10 whole; below, one decimal with a trailing ".0" dropped. */
export function fmtCount(x) {
  if (x >= 10) return fixed(x, 0);
  const s = fixed(x, 1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (v, n) => String(v).padStart(n, "0");

/**
 * SimpleDateFormat(pattern, Locale.US) of [ms] in [zone], for the patterns the app uses:
 * yyyy yy MMMM MMM MM M dd d EEE HH H hh h mm ss a, anything else is literal ('...' quotes too).
 */
export function dateFmt(ms, pattern, zone) {
  const p = parts(ms, zone);
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "'") {
      const j = pattern.indexOf("'", i + 1);
      const end = j < 0 ? pattern.length : j;
      out += end === i + 1 ? "'" : pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (!/[yMdEHhmsa]/.test(c)) { out += c; i++; continue; }
    let j = i;
    while (j < pattern.length && pattern[j] === c) j++;
    const n = j - i;
    switch (c) {
      case "y": out += n === 2 ? pad(p.y % 100, 2) : pad(p.y, n); break;
      case "M": out += n >= 4 ? MONTHS_LONG[p.mo - 1] : n === 3 ? MONTHS[p.mo - 1] : pad(p.mo, n); break;
      case "d": out += pad(p.d, n); break;
      case "E": out += DAYS[p.dow]; break;
      case "H": out += pad(p.h, n); break;
      case "h": out += pad(p.h % 12 === 0 ? 12 : p.h % 12, n); break;
      case "m": out += pad(p.mi, n); break;
      case "s": out += pad(p.s, n); break;
      case "a": out += p.h < 12 ? "AM" : "PM"; break;
    }
    i = j;
  }
  return out;
}
