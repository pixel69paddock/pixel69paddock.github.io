// Daily Derby claims server (Cloudflare Worker).
//
// Reads "HORSE dddd" comments on every @dailyderby_horse reel through the Instagram API
// (Instagram Login; permissions instagram_business_basic + instagram_business_manage_comments),
// works out who owns which look (first to comment a code gets it; a newer code from the same
// person swaps their look), and serves that to the site so "Check my horse" is instant.
//
//   GET /state                -> { lastSync, looks: {handle: code}, claims: [...] }  (rescans if older than 60s)
//   GET /check?handle=name    -> fresh scan (at most one every 15s), then that handle's status
//   GET /followers            -> { followers, at }  live follower count (cached 60s)
//   cron (twice a day)        -> renews the Instagram access token every ~7 days
//   /shop, /checkout, /order, /stripe/webhook -> the Stripe shop (shop.js)
//
// Secrets / vars (wrangler.toml + `wrangler secret put IG_TOKEN`):
//   IG_TOKEN    long-lived Instagram user access token (only used until the first renewal; then KV holds it)
//   SITE_DATA   URL of the site's derby.json (for removed horses and who is in the stable)
//   ORIGINS     comma-separated origins allowed to call this (the site, localhost)
// KV binding: DERBY

import { shopRoute } from "./shop.js";

const API = "https://graph.instagram.com/v25.0";
// [2] = optional 3D-shed code: "HORSE 4243+0A1B" (see shed.html shedEncode)
const CODE_RE = /horse\s*#?\s*([1-4]{4})(?![0-9])(?:\s*\+\s*([0-9a-z]{4})(?![0-9a-z]))?/i;
const STALE_MS = 60_000;      // /state rescans when the cached scan is older than this
const MIN_SCAN_MS = 15_000;   // never scan more often than this (rate limits)
const OLD_MEDIA_MS = 3 * 86400_000;
const OLD_MEDIA_TTL = 10 * 60_000;  // comments on reels older than 3 days are re-read every 10 min at most

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    try {
      // shop: tips + limited skins through Stripe (see shop.js)
      const shop = await shopRoute(req, env, url, cors, json);
      if (shop) return shop;
      if (url.pathname === "/state") {
        const st = await getState(env, false);
        return json(publicState(st), cors, 15);
      }
      if (url.pathname === "/check") {
        const handle = norm(url.searchParams.get("handle"));
        if (!/^[a-z0-9._]{1,30}$/.test(handle)) return json({ error: "bad handle" }, cors, 0, 400);
        const st = await getState(env, true);
        return json({ ...handleStatus(st, handle), lastSync: st.lastSync }, cors, 0);
      }
      if (url.pathname === "/followers") {
        // live follower count (the API gives the count, never the list); cached 60s for every visitor
        const c = await env.DERBY.get("followers", "json");
        if (c && Date.now() - c.t < 60_000) return json({ followers: c.n, at: new Date(c.t).toISOString() }, cors, 30);
        const token = (await env.DERBY.get("token")) || env.IG_TOKEN;
        const r = await fetch(`${API}/me?fields=followers_count&access_token=${enc(token)}`);
        const j = await r.json();
        if (!r.ok || typeof j.followers_count !== "number") {
          if (c) return json({ followers: c.n, at: new Date(c.t).toISOString(), stale: true }, cors, 30);
          throw new Error(j.error?.message || "no followers_count");
        }
        await env.DERBY.put("followers", JSON.stringify({ n: j.followers_count, t: Date.now() }));
        return json({ followers: j.followers_count, at: new Date().toISOString() }, cors, 30);
      }
      if (url.pathname === "/" || url.pathname === "/health") {
        const st = await env.DERBY.get("state", "json");
        return json({ ok: true, lastSync: st?.lastSync || null }, cors, 0);
      }
      return json({ error: "not found" }, cors, 0, 404);
    } catch (e) {
      // Fall back to the last good scan rather than failing the site.
      const st = await env.DERBY.get("state", "json");
      return json({ ...(st ? publicState(st) : {}), error: String(e.message || e) }, cors, 0, st ? 200 : 502);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(renewToken(env));
  },
};

// ---------------------------------------------------------------- scanning
async function getState(env, fresh) {
  const st = await env.DERBY.get("state", "json");
  const age = st ? Date.now() - Date.parse(st.lastSync) : Infinity;
  if (st && (age < MIN_SCAN_MS || (!fresh && age < STALE_MS))) return st;
  return scan(env, st);
}

async function scan(env, prev) {
  const token = (await env.DERBY.get("token")) || env.IG_TOKEN;
  if (!token) throw new Error("no Instagram token configured");
  const cache = (await env.DERBY.get("commentCache", "json")) || {};
  const media = await pages(`${API}/me/media?fields=id,permalink,timestamp&limit=50&access_token=${enc(token)}`, 4);
  const found = [];
  const now = Date.now();
  const newCache = {};
  for (const m of media) {
    const old = now - Date.parse(m.timestamp) > OLD_MEDIA_MS;
    const hit = cache[m.id];
    let comments;
    if (old && hit && now - hit.at < OLD_MEDIA_TTL) comments = hit.items;
    else {
      const raw = await pages(`${API}/${m.id}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&limit=50&access_token=${enc(token)}`, 10);
      comments = [];
      for (const c of raw) {
        comments.push(slim(c));
        for (const r of c.replies?.data || []) comments.push(slim(r));
      }
      comments = comments.filter(c => CODE_RE.test(c.text || ""));
    }
    newCache[m.id] = { at: old && hit && now - hit.at < OLD_MEDIA_TTL ? hit.at : now, items: comments };
    for (const c of comments) found.push({ ...c, reel: m.permalink });
  }
  const site = await siteData(env);
  const st = resolve(found, site);
  await env.DERBY.put("commentCache", JSON.stringify(newCache));
  await env.DERBY.put("state", JSON.stringify(st));
  return st;
}

function slim(c) {
  return { id: c.id, text: (c.text || "").slice(0, 120), username: c.username, timestamp: c.timestamp };
}

// Everything is derived from the comments themselves, so a rescan always gives the same answer.
function resolve(found, site) {
  const removed = new Set((site.horses || []).filter(h => h.status === "removed").map(h => norm(h.handle)));
  const stable = new Set((site.horses || []).filter(h => h.status !== "removed").map(h => norm(h.handle)));
  const self = norm(site.account || "dailyderby_horse");
  // each person's newest code comment
  const newest = {};
  for (const c of found) {
    const h = norm(c.username);
    if (!h || h === self || removed.has(h)) continue;
    const code = c.text.match(CODE_RE)[1];
    const at = iso(c.timestamp);
    if (!newest[h] || at > newest[h].at) newest[h] = { handle: h, look: code, at, reel: c.reel };
  }
  // looks are free for all (owner 2026-11-23); the first to claim a look gets the "Original" mark
  const originals = {}, looks = {}, claims = [];
  for (const c of Object.values(newest).sort((a, b) => a.at.localeCompare(b.at))) {
    const st = stable.has(c.handle) ? "locked" : "waiting";
    if (st === "locked") { looks[c.handle] = c.look; if (!originals[c.look]) originals[c.look] = c.handle; }
    claims.push({ ...c, status: st, ...(originals[c.look] === c.handle && st === "locked" ? { original: true } : {}) });
  }
  claims.sort((a, b) => b.at.localeCompare(a.at));
  return { lastSync: new Date().toISOString().replace(/\.\d+Z$/, "Z"), looks, originals, claims };
}

function handleStatus(st, handle) {
  const claim = st.claims.find(c => c.handle === handle) || null;
  return { handle, look: st.looks[handle] || null, claim };
}

function publicState(st) {
  return { lastSync: st.lastSync, looks: st.looks, originals: st.originals || {}, claims: st.claims, syncEveryMin: 1, live: true };
}

async function siteData(env) {
  const hit = await env.DERBY.get("siteData", "json");
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  try {
    const r = await fetch(env.SITE_DATA + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
    const data = await r.json();
    const keep = { account: data.account, horses: (data.horses || []).map(h => ({ handle: h.handle, status: h.status })) };
    await env.DERBY.put("siteData", JSON.stringify({ at: Date.now(), data: keep }));
    return keep;
  } catch {
    return hit ? hit.data : { horses: [] };
  }
}

// ---------------------------------------------------------------- token renewal
async function renewToken(env) {
  const meta = (await env.DERBY.get("tokenMeta", "json")) || {};
  if (meta.renewedAt && Date.now() - meta.renewedAt < 7 * 86400_000) return;
  const token = (await env.DERBY.get("token")) || env.IG_TOKEN;
  if (!token) return;
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${enc(token)}`);
  const j = await r.json();
  if (j.access_token) {
    await env.DERBY.put("token", j.access_token);
    await env.DERBY.put("tokenMeta", JSON.stringify({ renewedAt: Date.now(), expiresIn: j.expires_in }));
  } else {
    await env.DERBY.put("tokenMeta", JSON.stringify({ ...meta, lastError: JSON.stringify(j).slice(0, 300), triedAt: Date.now() }));
  }
}

// ---------------------------------------------------------------- helpers
async function pages(first, max) {
  const out = [];
  let next = first;
  for (let i = 0; next && i < max; i++) {
    const r = await fetch(next);
    const j = await r.json();
    if (j.error) throw new Error(`Instagram API: ${j.error.message || j.error.type}`);
    out.push(...(j.data || []));
    next = j.paging?.next || null;
  }
  return out;
}

const norm = h => String(h || "").trim().replace(/^@+/, "").toLowerCase();
const enc = encodeURIComponent;
const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, headers, maxAge, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

export { resolve, CODE_RE };
