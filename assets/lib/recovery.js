// TrueMile EV web: "Forgot password?" on the dashboard's sign-in, the SAME code flow as the app.
// Pure; no DOM, no network (lib/api.js makes the three calls, assets/app.js draws the steps).
//
// A port of the app's ui/auth/PasswordRecoveryApi.kt (the response classifiers) and
// ui/auth/PasswordRecoveryFlow.kt (the rules and the words), so a reader who resets on the web sees
// what the app would have shown:
//
//   POST /auth/v1/recover {email}                          -> emails a 6-digit code
//   POST /auth/v1/verify  {type: "recovery", email, token} -> a session for that account
//   PUT  /auth/v1/user    {password} + that session's token -> the new password
//
// The verified session is held in memory only and becomes the signed-in one after the new password is
// saved (api.auth.finishPasswordReset), so an abandoned reset never leaves a half-signed-in browser.
// The page asks for the code AND the new password on one screen, and checks the password before the
// code is spent: a too-short password never burns a single-use code.

export const BUILD = "2026-09-30.2";

/** GoTrue's email code is 6 digits by default and configurable up to 10 (PasswordRecoveryFlow). */
export const CODE_MIN_LENGTH = 6;
export const CODE_MAX_LENGTH = 10;
/** The Supabase Auth minimum password length (the app's sign-up sets no other rule). */
export const MIN_PASSWORD_LENGTH = 6;
/** GoTrue holds a second email to the same address for 60 s by default; mirrored here. */
export const RESEND_COOLDOWN_MS = 60_000;

export const SENT_MESSAGE =
  "If an account exists for that email, we sent a 6-digit code. It can take a minute to arrive — check your spam folder too.";
export const MSG_INVALID_EMAIL = "Enter a valid email address.";
export const MSG_CODE_REQUIRED = "Enter the 6-digit code from the email.";
export const MSG_PASSWORD_SHORT = `Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`;
export const MSG_PASSWORD_MISMATCH = "The two passwords are not the same.";
export const MSG_WRONG_CODE = "That code is wrong or has expired. Check it, or send a new code.";
export const MSG_SAME_PASSWORD = "Choose a password different from your old one.";
export const MSG_SESSION_EXPIRED = "That code has expired. Send a new code to try again.";
export const MSG_NETWORK = "Couldn't reach the TrueMile server. Check your connection and try again.";
export const MSG_SERVER = "Something went wrong on our side. Please try again in a few minutes.";
export const MSG_CODE_ACCEPTED = "Code accepted — now choose your new password.";
export const MSG_DEMO = "The demo account has no password to reset.";

/** "Too many requests. Please wait 42 seconds and try again." */
export function rateLimitMessage(waitSeconds) {
  const w = Number(waitSeconds);
  if (Number.isFinite(w) && w > 0) {
    const n = Math.ceil(w);
    return `Too many requests. Please wait ${n} second${n === 1 ? "" : "s"} and try again.`;
  }
  return "Too many requests right now. Please wait a few minutes and try again.";
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isPlausibleEmail = (email) => EMAIL_SHAPE.test(String(email ?? "").trim());

/** Codes are digits only; anything pasted around them (spaces, dashes) is dropped. */
export const sanitizeCode = (input) => String(input ?? "").replace(/[^0-9]/g, "").slice(0, CODE_MAX_LENGTH);

/** Seconds until another code may be requested (0 = now). */
export function secondsUntilResend(resendAtMs, nowMs) {
  return !resendAtMs || resendAtMs <= nowMs ? 0 : Math.ceil((resendAtMs - nowMs) / 1000);
}

/** "Send a new code (42 s)" while the cooldown runs, else "Send a new code". */
export const resendLabel = (secondsLeft) => (secondsLeft > 0 ? `Send a new code (${secondsLeft} s)` : "Send a new code");

/** Why a code request cannot go out now, or "" when it can. */
export function requestBlocker(email, resendAtMs, nowMs) {
  if (!isPlausibleEmail(email)) return MSG_INVALID_EMAIL;
  const s = secondsUntilResend(resendAtMs, nowMs);
  return s > 0 ? rateLimitMessage(s) : "";
}

/**
 * Why the code screen cannot submit, or "" when it can. [verified] = a session is already held (the
 * code was spent and only the password step failed), so no code is needed again.
 */
export function submitBlocker({ code, password, again, verified }) {
  if (!verified && sanitizeCode(code).length < CODE_MIN_LENGTH) return MSG_CODE_REQUIRED;
  const pw = String(password ?? "");
  if (pw.length < MIN_PASSWORD_LENGTH) return MSG_PASSWORD_SHORT;
  if (pw !== String(again ?? "")) return MSG_PASSWORD_MISMATCH;
  return "";
}

// ── GoTrue's replies ────────────────────────────────────────────────────────────────────────────
// Errors come in two shapes depending on its version, {error_code, msg} (current) and
// {error, error_description} (older), plus {message} on some paths; these read all of them.

function parse(body) {
  if (body && typeof body === "object") return body;
  try {
    const o = JSON.parse(String(body ?? ""));
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch (_) {
    return null;
  }
}
const str = (v) => (typeof v === "string" ? v : "");

/** GoTrue's machine code for an error ("otp_expired", "same_password", ...), or "". */
export function errorCode(body) {
  const o = parse(body);
  if (!o) return "";
  const c = str(o.error_code).trim();
  if (c) return c;
  const e = str(o.error).trim();
  return e && !e.includes(" ") ? e : "";
}

/** GoTrue's human message, whichever shape it came in, or "". */
export function errorMessage(body) {
  const o = parse(body);
  if (!o) return "";
  for (const k of ["msg", "message", "error_description", "error"]) {
    const v = str(o[k]).trim();
    if (v) return v;
  }
  return "";
}

/** How long GoTrue asked us to wait ("...only request this after 42 seconds", or Retry-After); null if neither says. */
export function waitSeconds(body, retryAfter) {
  const m = /after\s+(\d+)\s+second/i.exec(errorMessage(body));
  if (m && Number(m[1]) > 0) return Number(m[1]);
  const h = Number(String(retryAfter ?? "").trim());
  return Number.isInteger(h) && h > 0 ? h : null;
}

function isInvalidEmail(body) {
  const c = errorCode(body);
  if (c === "email_address_invalid" || c === "validation_failed") return true;
  const m = errorMessage(body).toLowerCase();
  return m.includes("invalid format") || m.includes("valid email");
}

/**
 * /recover. Any 2xx is sent. A 4xx other than 429 or a malformed address is ALSO reported as sent: the
 * screen always says "if an account exists...", so no status may reveal whether one does. A 5xx is a
 * real failure (typically the mail could not be sent). [status] 0 = the network failed.
 *  -> {kind: "sent"} | {kind: "rate", wait} | {kind: "invalidEmail"} | {kind: "failed", network}
 */
export function classifySend(status, body, retryAfter) {
  if (!status) return { kind: "failed", network: true };
  if (status >= 200 && status < 300) return { kind: "sent" };
  if (status === 429) return { kind: "rate", wait: waitSeconds(body, retryAfter) };
  if (status >= 400 && status < 500 && isInvalidEmail(body)) return { kind: "invalidEmail" };
  if (status >= 400 && status < 500) return { kind: "sent" };
  return { kind: "failed", network: false };
}

/** A 2xx /verify body -> {access_token, refresh_token, expires_at, token_type}, or null without both tokens. */
export function parseSession(body, nowSec = Date.now() / 1000) {
  const o = parse(body);
  if (!o) return null;
  const access = str(o.access_token).trim();
  const refresh = str(o.refresh_token).trim();
  if (!access || !refresh) return null;
  let expiresAt = Number(o.expires_at || 0) || 0;
  if (!expiresAt && Number(o.expires_in || 0) > 0) expiresAt = Math.floor(nowSec) + Number(o.expires_in);
  return { access_token: access, refresh_token: refresh, expires_at: expiresAt, token_type: str(o.token_type) || "bearer" };
}

/** /verify -> {kind: "verified", session} | {kind: "invalid"} | {kind: "rate", wait} | {kind: "failed", network} */
export function classifyVerify(status, body, retryAfter, nowSec) {
  if (!status) return { kind: "failed", network: true };
  if (status >= 200 && status < 300) {
    const session = parseSession(body, nowSec);
    return session ? { kind: "verified", session } : { kind: "failed", network: false };
  }
  if (status === 429) return { kind: "rate", wait: waitSeconds(body, retryAfter) };
  if (status >= 400 && status < 500) return { kind: "invalid" };
  return { kind: "failed", network: false };
}

/**
 * PUT /user -> {kind: "updated"} | {kind: "same"} | {kind: "rejected", message} | {kind: "expired"} |
 *              {kind: "rate", wait} | {kind: "failed", network}
 */
export function classifyUpdate(status, body, retryAfter) {
  if (!status) return { kind: "failed", network: true };
  const code = errorCode(body);
  if (status >= 200 && status < 300) return { kind: "updated" };
  if (status === 429) return { kind: "rate", wait: waitSeconds(body, retryAfter) };
  if (code === "same_password") return { kind: "same" };
  if (status === 401 || status === 403 || code === "session_not_found" || code === "bad_jwt") return { kind: "expired" };
  if (status === 400 || status === 422) return { kind: "rejected", message: errorMessage(body) || "That password was not accepted." };
  return { kind: "failed", network: false };
}

/** The sentence the page shows for any outcome that is not a success ("" for a success). */
export function outcomeMessage(o) {
  switch (o && o.kind) {
    case "rate": return rateLimitMessage(o.wait);
    case "invalidEmail": return MSG_INVALID_EMAIL;
    case "invalid": return MSG_WRONG_CODE;
    case "same": return MSG_SAME_PASSWORD;
    case "rejected": return o.message || "That password was not accepted.";
    case "expired": return MSG_SESSION_EXPIRED;
    case "failed": return o.network ? MSG_NETWORK : MSG_SERVER;
    case "demo": return MSG_DEMO;
    default: return "";
  }
}
