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
const HKEY = "history";
const MAX_HISTORY = 20;
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


/* ---------- version history ---------- */

/** Key order differs between hand-written seed data and validator output, so
    compare a canonical form rather than raw JSON. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Plain-language description of what one save changed. */
function describeChange(before, after) {
  const o = new Map((before?.events || []).map((e) => [e.id, e]));
  const n = new Map((after?.events || []).map((e) => [e.id, e]));
  const added = [], removed = [], changed = [];
  for (const [id, e] of n) if (!o.has(id)) added.push(e.label);
  for (const [id, e] of o) if (!n.has(id)) removed.push(e.label);
  for (const [id, e] of n) {
    const was = o.get(id);
    if (was && stable(was) !== stable(e)) changed.push(e.label);
  }
  const say = (verb, list) =>
    list.length === 1 ? `${verb} ${list[0]}`
                      : `${verb} ${list.length} entries`;
  const parts = [];
  if (added.length) parts.push(say("Added", added));
  if (removed.length) parts.push(say("Removed", removed));
  if (changed.length) parts.push(say("Edited", changed));
  if (!parts.length) {
    const leaveMoved = stable(before?.cheryleLeave) !== stable(after?.cheryleLeave);
    const tbdMoved = stable(before?.tbd || []) !== stable(after?.tbd || []);
    if (leaveMoved) parts.push("Changed Cheryle's leave");
    if (tbdMoved) parts.push("Changed the to-be-decided list");
  }
  return parts.join(" · ") || "No visible change";
}

async function readHistory(env) {
  return (await env.TIMELINE.get(HKEY, "json")) || [];
}

/** Archive `snapshot` as the version being replaced by `next`. */
async function archive(env, snapshot, next) {
  if (!snapshot) return;
  const history = await readHistory(env);
  history.unshift({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: snapshot.updatedAt || new Date().toISOString(),
    archivedAt: new Date().toISOString(),
    change: describeChange(snapshot, next),
    count: (snapshot.events || []).length,
    data: { version: 1, cheryleLeave: snapshot.cheryleLeave, events: snapshot.events, tbd: snapshot.tbd || [] },
  });
  await env.TIMELINE.put(HKEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
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

async function authed(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(env.SESSION_SECRET) && (await verifyToken(env.SESSION_SECRET, tok));
}


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
      if (!(await authed(env, request))) {
        return json(request, { error: "Your session expired. Sign in again." }, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "Bad request." }, 400); }
      let clean;
      try { clean = validate(body); }
      catch (err) { return json(request, { error: err.message }, 422); }
      const previous = (await env.TIMELINE.get(KEY, "json")) || SEED;
      await archive(env, previous, clean);
      await env.TIMELINE.put(KEY, JSON.stringify(clean));
      return json(request, { ok: true, updatedAt: clean.updatedAt });
    }


    if (path === "/api/history" && request.method === "GET") {
      if (!(await authed(env, request))) {
        return json(request, { error: "Your session expired. Sign in again." }, 401);
      }
      const history = await readHistory(env);
      /* metadata only - restoring happens server-side, so snapshots never travel */
      return json(request, history.map(({ id, savedAt, archivedAt, change, count }) =>
        ({ id, savedAt, archivedAt, change, count })));
    }

    if (path === "/api/restore" && request.method === "POST") {
      if (!(await authed(env, request))) {
        return json(request, { error: "Your session expired. Sign in again." }, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "Bad request." }, 400); }
      const history = await readHistory(env);
      const entry = history.find((h) => h.id === body?.id);
      if (!entry) return json(request, { error: "That version is no longer available." }, 404);

      let clean;
      try { clean = validate(entry.data); }
      catch (err) { return json(request, { error: `That version can't be restored: ${err.message}` }, 422); }

      /* archive what is live now, so the restore itself can be undone */
      const current = (await env.TIMELINE.get(KEY, "json")) || SEED;
      await archive(env, current, clean);
      await env.TIMELINE.put(KEY, JSON.stringify(clean));
      return json(request, { ok: true, updatedAt: clean.updatedAt, data: clean });
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
