/**
 * Baby Heard Timeline - admin API.
 *
 * GET  /api/data   public; current timeline, seeded from the bundled default
 * POST /api/login  { password } -> { token, expiresAt }; rate limited per IP
 * PUT  /api/data   Bearer token; validates then stores
 *
 * The password lives only as a Worker secret (ADMIN_PASSWORD). Session tokens are
 * HMAC-SHA256 signed with SESSION_SECRET and expire; nothing is stored per session.
 */

import SEED from "../../v2/data.json";

const KEY = "timeline";
const TOKEN_TTL_S = 60 * 60 * 8;      // 8 hours
const MAX_ATTEMPTS = 8;                // per IP
const ATTEMPT_WINDOW_S = 15 * 60;

const ALLOWED_ORIGINS = [
  "https://baby.cheryleandmichael.com",
  "http://localhost:8777",
  "http://127.0.0.1:8777",
];

/* ---------- helpers ---------- */

const enc = new TextEncoder();

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
      ...extra,
    },
  });
}

/** Length-independent comparison, so failures don't leak the password by timing. */
function timingSafeEqual(a, b) {
  const ab = enc.encode(a), bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function issueToken(secret) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  return { token: `${payload}.${await hmac(secret, payload)}`, expiresAt: exp * 1000 };
}

async function verifyToken(secret, token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!timingSafeEqual(sig, await hmac(secret, payload))) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

/* ---------- validation ----------
   A malformed save would break the public page, so the shape is checked here
   rather than trusted from the client. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATS = ["baby", "visit", "edwina", "loretta", "work", "family"];

function fail(msg) { throw new Error(msg); }

function checkDate(v, where) {
  if (typeof v !== "string" || !DATE_RE.test(v)) fail(`${where}: expected YYYY-MM-DD, got ${JSON.stringify(v)}`);
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) fail(`${where}: not a real date (${v})`);
  return v;
}

function checkSpan(s, where) {
  if (!s || typeof s !== "object") fail(`${where}: span must be an object`);
  checkDate(s.start, `${where}.start`);
  checkDate(s.end, `${where}.end`);
  if (s.end < s.start) fail(`${where}: end (${s.end}) is before start (${s.start})`);
  return { start: s.start, end: s.end };
}

function checkEvent(e, i) {
  const at = `events[${i}]`;
  if (!e || typeof e !== "object") fail(`${at}: must be an object`);
  if (typeof e.id !== "string" || !e.id.trim()) fail(`${at}.id: required`);
  if (typeof e.label !== "string" || !e.label.trim()) fail(`${at}.label: required`);
  if (!CATS.includes(e.cat)) fail(`${at}.cat: must be one of ${CATS.join(", ")}`);

  const out = { id: e.id.trim(), label: e.label.trim(), cat: e.cat };
  for (const flag of ["parent", "child", "visitor"]) if (e[flag] === true) out[flag] = true;
  if (typeof e.sub === "string" && e.sub.trim()) out.sub = e.sub.trim();

  const kinds = ["date" in e && e.date, "start" in e && e.start, Array.isArray(e.options)].filter(Boolean).length;
  if (kinds === 0) fail(`${at}: needs a date, a start/end, or options`);

  if (Array.isArray(e.options)) {
    if (typeof e.group !== "string" || !e.group.trim()) fail(`${at}.group: required when the event has options`);
    if (e.options.length < 2) fail(`${at}.options: needs at least two`);
    out.group = e.group.trim();
    out.options = e.options.map((o, j) => {
      const oat = `${at}.options[${j}]`;
      if (!Number.isInteger(o?.n)) fail(`${oat}.n: must be a whole number`);
      if (typeof o.label !== "string" || !o.label.trim()) fail(`${oat}.label: required`);
      if (!Array.isArray(o.spans) || !o.spans.length) fail(`${oat}.spans: needs at least one`);
      const opt = { n: o.n, label: o.label.trim(), spans: o.spans.map((s, k) => checkSpan(s, `${oat}.spans[${k}]`)) };
      if (typeof o.gapLabel === "string" && o.gapLabel.trim()) opt.gapLabel = o.gapLabel.trim();
      return opt;
    });
    const ns = out.options.map((o) => o.n);
    if (new Set(ns).size !== ns.length) fail(`${at}.options: option numbers must be unique`);
  } else if (e.date) {
    out.date = checkDate(e.date, `${at}.date`);
  } else {
    const s = checkSpan({ start: e.start, end: e.end }, at);
    out.start = s.start; out.end = s.end;
  }
  return out;
}

function validate(input) {
  if (!input || typeof input !== "object") fail("payload must be an object");
  if (!Array.isArray(input.events) || !input.events.length) fail("events: needs at least one");
  if (input.events.length > 200) fail("events: too many (max 200)");

  const events = input.events.map(checkEvent);
  const ids = events.map((e) => e.id);
  if (new Set(ids).size !== ids.length) fail("events: ids must be unique");

  const cl = input.cheryleLeave || {};
  const leave = checkSpan({ start: cl.start, end: cl.end }, "cheryleLeave");

  const tbd = (Array.isArray(input.tbd) ? input.tbd : [])
    .filter((t) => t && typeof t.what === "string" && t.what.trim())
    .slice(0, 50)
    .map((t) => {
      const o = { what: t.what.trim() };
      if (typeof t.hint === "string" && t.hint.trim()) o.hint = t.hint.trim();
      return o;
    });

  return { version: 1, cheryleLeave: leave, events, tbd, updatedAt: new Date().toISOString() };
}

/* ---------- rate limiting ---------- */

async function tooManyAttempts(env, ip) {
  const n = Number(await env.TIMELINE.get(`fail:${ip}`)) || 0;
  return n >= MAX_ATTEMPTS;
}
async function noteFailure(env, ip) {
  const n = (Number(await env.TIMELINE.get(`fail:${ip}`)) || 0) + 1;
  await env.TIMELINE.put(`fail:${ip}`, String(n), { expirationTtl: ATTEMPT_WINDOW_S });
}

/* ---------- routes ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (path === "/api/data" && request.method === "GET") {
      const stored = await env.TIMELINE.get(KEY, "json");
      return json(request, stored || { ...SEED, source: "seed" });
    }

    if (path === "/api/login" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
        return json(request, { error: "Server is not configured yet." }, 503);
      }
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      if (await tooManyAttempts(env, ip)) {
        return json(request, { error: "Too many attempts. Try again in 15 minutes." }, 429);
      }
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "Bad request." }, 400); }
      if (!timingSafeEqual(String(body?.password ?? ""), env.ADMIN_PASSWORD)) {
        await noteFailure(env, ip);
        return json(request, { error: "That password isn't right." }, 401);
      }
      await env.TIMELINE.delete(`fail:${ip}`);
      return json(request, await issueToken(env.SESSION_SECRET));
    }

    if (path === "/api/data" && request.method === "PUT") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.SESSION_SECRET || !(await verifyToken(env.SESSION_SECRET, token))) {
        return json(request, { error: "Your session expired. Sign in again." }, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "Bad request." }, 400); }
      let clean;
      try { clean = validate(body); }
      catch (err) { return json(request, { error: err.message }, 422); }
      await env.TIMELINE.put(KEY, JSON.stringify(clean));
      return json(request, { ok: true, updatedAt: clean.updatedAt });
    }

    if (path === "/api/health") {
      return json(request, {
        ok: true,
        configured: Boolean(env.ADMIN_PASSWORD && env.SESSION_SECRET),
      });
    }

    return json(request, { error: "Not found." }, 404);
  },
};
