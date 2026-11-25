// Daily Derby shop: tips and limited cosmetic skins, paid through Stripe Checkout (hosted page:
// Apple Pay / Google Pay / cards; Adaptive Pricing shows each buyer their own currency).
//
//   GET  /shop                  -> { testMode, drops: [{id, sold, left}], skins: {handle: [{id, n}]} }
//   POST /checkout              -> body {kind: "tip"|"skin", id?, handle?, amount?}  ->  { url }  (send the buyer there)
//   GET  /order?session=cs_...  -> what that checkout bought, once Stripe has confirmed it
//   POST /stripe/webhook        -> Stripe calls this; verified with STRIPE_WEBHOOK_SECRET
//
// Prices and stock limits come from the site's derby.json ("shop"), which only the owner can change,
// never from the buyer's browser. Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (`wrangler secret put`).
// Vars: SITE_DATA, SITE_URL. KV: DERBY (keys "shop:sold:<id>", "shop:skins", "shop:order:<session>", "shop:log").

const STRIPE = "https://api.stripe.com/v1";
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const norm = h => String(h || "").trim().replace(/^@+/, "").toLowerCase();

export async function shopRoute(req, env, url, cors, json) {
  const p = url.pathname;
  if (p === "/shop" && req.method === "GET") {
    const cat = await catalog(env);
    const skins = (await env.DERBY.get("shop:skins", "json")) || {};
    const drops = [];
    for (const d of cat.drops || []) {
      const sold = await soldCount(env, d.id);
      drops.push({ id: d.id, sold, left: d.unlimited ? null : Math.max(0, (d.limit || 0) - sold) });
    }
    const styles = (await env.DERBY.get("shop:styles", "json")) || {};
    return json({ testMode: isTest(env), drops, skins, styles }, cors, 10);
  }
  if (p === "/checkout" && req.method === "POST") return checkout(req, env, cors, json);
  if (p === "/order" && req.method === "GET") {
    const id = url.searchParams.get("session") || "";
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: "bad session" }, cors, 0, 400);
    const o = await env.DERBY.get("shop:order:" + id, "json");
    return json(o || { status: "pending" }, cors, 0);
  }
  if (p === "/stripe/webhook" && req.method === "POST") return webhook(req, env);
  if (p === "/style" && req.method === "POST") return saveStyle(req, env, cors, json);
  return null;
}

// ---------------------------------------------------------------- checkout
async function checkout(req, env, cors, json) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "The shop isn't switched on yet." }, cors, 0, 503);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, cors, 0, 400); }
  const cat = await catalog(env);
  const handle = norm(b.handle);
  if (handle && !HANDLE_RE.test(handle)) return json({ error: "That doesn't look like an Instagram handle." }, cors, 0, 400);
  const site = (env.SITE_URL || "https://pixel69paddock.github.io").replace(/\/$/, "");
  const stall = Math.floor(Number(b.stall));
  const shedBack = b.ret === "shed" && stall >= 1 && stall <= 10000;
  const f = {
    mode: "payment",
    // shed purchases come back to the buyer's stall; everything else to the site's shop section
    success_url: shedBack ? `${site}/shed.html?stall=${stall}&paid={CHECKOUT_SESSION_ID}` : `${site}/?paid={CHECKOUT_SESSION_ID}#shop`,
    cancel_url: shedBack ? `${site}/shed.html?stall=${stall}` : `${site}/#shop`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": cat.currency || "usd",
    "metadata[kind]": b.kind,
    "payment_intent_data[metadata][kind]": b.kind,
  };
  if (handle) {
    f.client_reference_id = handle;
    f["metadata[handle]"] = handle;
    f["payment_intent_data[metadata][handle]"] = handle;
  }

  if (b.kind === "tip") {
    const t = cat.tips || {};
    const amount = Math.round(Number(b.amount));
    if (!(amount >= (t.min || 200) && amount <= (t.max || 20000))) return json({ error: `Tips go from ${money(t.min || 200)} to ${money(t.max || 20000)}.` }, cors, 0, 400);
    f["line_items[0][price_data][unit_amount]"] = String(amount);
    f["line_items[0][price_data][product_data][name]"] = "Tip for Daily Derby";
    f["line_items[0][price_data][product_data][description]"] = "Thank you for keeping the races running.";
    f["metadata[amount]"] = String(amount);
  } else if (b.kind === "skin") {
    const d = (cat.drops || []).find(x => x.id === b.id);
    if (!d || d.status !== "open") return json({ error: "That drop isn't on sale." }, cors, 0, 400);
    if (!handle) return json({ error: "Type the Instagram handle whose horse gets it." }, cors, 0, 400);
    if (!d.unlimited && (await soldCount(env, d.id)) >= d.limit) return json({ error: `${d.name} is sold out.` }, cors, 0, 409);
    const skins = (await env.DERBY.get("shop:skins", "json")) || {};
    const has = (skins[handle] || []).map(s => s.id);
    if (has.includes(d.id) || (d.part && has.includes("unlock-all"))) return json({ error: `@${handle} already has ${d.name}.` }, cors, 0, 409);
    f["line_items[0][price_data][unit_amount]"] = String(d.price);
    f["line_items[0][price_data][product_data][name]"] = `${d.name} for @${handle}'s horse`;
    f["line_items[0][price_data][product_data][description]"] = d.unlimited ? `Unlocks for @${handle}'s horse for good. Cosmetic only: it never changes race results.` : `Limited to ${d.limit}. Cosmetic only: it never changes race results.`;
    f["metadata[item]"] = d.id;
    f["payment_intent_data[metadata][item]"] = d.id;
    f["custom_text[submit][message]"] = `Saved on @${handle}'s horse as soon as you pay. No comment needed.`;
  } else {
    return json({ error: "bad request" }, cors, 0, 400);
  }
  f["custom_text[after_submit][message]"] = "Digital and cosmetic. Terms: " + site + "/terms.html";
  f.expires_at = String(Math.floor(Date.now() / 1000) + 30 * 60);

  // Adaptive Pricing: priced in US$, each buyer sees their own currency. Retry without it if the
  // account or API version doesn't accept the parameter (it can also be switched on in the Dashboard).
  let r = await stripe(env, "/checkout/sessions", { ...f, "adaptive_pricing[enabled]": "true" });
  if (r.error && /adaptive_pricing/.test(r.error.message || "")) r = await stripe(env, "/checkout/sessions", f);
  if (r.error) return json({ error: "Stripe: " + (r.error.message || "couldn't start checkout") }, cors, 0, 502);
  return json({ url: r.url }, cors, 0);
}

// ---------------------------------------------------------------- webhook
async function webhook(req, env) {
  const body = await req.text();
  const ok = await verifySig(body, req.headers.get("Stripe-Signature") || "", env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(body);
  const s = ev.data && ev.data.object;
  if ((ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") && s && s.payment_status === "paid") {
    await fulfil(env, s);
  }
  return new Response("ok");
}

export async function fulfil(env, s) {
  const key = "shop:order:" + s.id;
  const done = await env.DERBY.get(key, "json");
  if (done && done.status !== "pending") return done;  // Stripe retries webhooks: do each order once
  const m = s.metadata || {};
  const handle = norm(m.handle);
  const base = { session: s.id, kind: m.kind, handle: handle || null, amount: s.amount_total, currency: s.currency, at: new Date().toISOString(), test: !s.livemode };
  let order;
  if (m.kind === "skin") {
    const cat = await catalog(env);
    const d = (cat.drops || []).find(x => x.id === m.item) || { id: m.item, name: m.item, limit: 0 };
    const sold = await soldCount(env, d.id);
    const skins = (await env.DERBY.get("shop:skins", "json")) || {};
    const owned = (skins[handle] || []).some(x => x.id === d.id);
    if ((!d.unlimited && sold >= d.limit) || owned) {
      // sold out (two people paid for the last one at once) or already owned: refund in full
      await stripe(env, "/refunds", { payment_intent: s.payment_intent, "metadata[reason]": owned ? "already owned" : "sold out" });
      order = { ...base, item: d.id, name: d.name, status: "refunded", reason: owned ? "already owned" : "sold out" };
    } else {
      const n = sold + 1;
      await env.DERBY.put("shop:sold:" + d.id, String(n));
      skins[handle] = [...(skins[handle] || []), { id: d.id, n, at: base.at }];
      await env.DERBY.put("shop:skins", JSON.stringify(skins));
      order = { ...base, item: d.id, name: d.name, n, limit: d.unlimited ? null : d.limit, status: "paid" };
      if (handle) order.key = await newKey(env, handle);
    }
  } else {
    order = { ...base, status: "paid" };
  }
  await env.DERBY.put(key, JSON.stringify(order));
  const log = (await env.DERBY.get("shop:log", "json")) || [];
  log.unshift(order);
  await env.DERBY.put("shop:log", JSON.stringify(log.slice(0, 500)));
  return order;
}

// Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">; reject anything older than 5 minutes
export async function verifySig(body, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map(kv => kv.split("=")).filter(a => a.length === 2 && a[0] !== "v1").map(([k, v]) => [k, v]));
  const sigs = header.split(",").filter(kv => kv.startsWith("v1=")).map(kv => kv.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, "0")).join("");
  return sigs.some(s => timingSafeEqual(s, hex));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// ---------------------------------------------------------------- style keys + saved styles
// A purchase gives the buying device a random key (only its SHA-256 is stored). With it, that device can save the
// horse's look (paid colours and stall extras) without commenting. Several devices = several keys.
async function sha(t) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function newKey(env, handle) {
  const raw = [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, "0")).join("");
  const list = (await env.DERBY.get("shop:keys:" + handle, "json")) || [];
  list.push(await sha(raw));
  await env.DERBY.put("shop:keys:" + handle, JSON.stringify(list.slice(-10)));
  return raw;
}
// shed code (same bits as shed.html shedEncode): saddle 2 | accessories 4 | wall 3 | plate 2 | stickers 8
const ACC_IDS = ["blinkers", "bonnet", "wraps", "rosette"];
const ST_IDS = ["horseshoe", "trophy", "flowers", "flag", "star", "heart", "carrot", "bolt"];
export function shedDecode(code) {
  const v = parseInt(String(code || ""), 36);
  if (!/^[0-9A-Z]{4}$/i.test(String(code || "")) || !(v < 1 << 19)) return null;
  return { saddle: v & 3, acc: ACC_IDS.filter((_, i) => v >> 2 & 1 << i), wall: v >> 6 & 7, plate: v >> 9 & 3, stickers: ST_IDS.filter((_, i) => v >> 11 & 1 << i) };
}
// what a style needs: palette for colours 5-20; one unlock per stall part beyond the free defaults
export function needs(st, grand) {
  const g = grand ? shedDecode(grand) : null, out = [];
  if ((st.idx || []).some(n => n > 4)) out.push("palette");
  if (![0, 1].includes(st.saddle) && !(g && g.saddle === st.saddle)) out.push("unlock-saddle");
  if ((st.acc || []).some(a => !(g && g.acc.includes(a)))) out.push("unlock-acc");
  if (st.wall && !(g && g.wall === st.wall)) out.push("unlock-paint");
  if (st.plate && !(g && g.plate === st.plate)) out.push("unlock-plate");
  if ((st.stickers || []).some(t => !(g && g.stickers.includes(t)))) out.push("unlock-stickers");
  return out;
}
function cleanStyle(x) {
  const idx = Array.isArray(x.idx) && x.idx.length === 4 && x.idx.every(n => Number.isInteger(n) && n >= 1 && n <= 20) ? x.idx : null;
  if (!idx) return null;
  const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max ? v : 0;
  return {
    idx, saddle: int(x.saddle, 3), wall: int(x.wall, 5), plate: int(x.plate, 3),
    acc: ACC_IDS.filter(a => (x.acc || []).includes(a)), stickers: ST_IDS.filter(t => (x.stickers || []).includes(t)),
    name: typeof x.name === "string" ? x.name.replace(/[^\p{L}\p{N} '.\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 18) : undefined
  };
}
async function saveStyle(req, env, cors, json) {
  let b; try { b = await req.json(); } catch { return json({ error: "bad request" }, cors, 0, 400); }
  const handle = norm(b.handle);
  if (!HANDLE_RE.test(handle) || typeof b.key !== "string" || b.key.length < 20) return json({ error: "bad request" }, cors, 0, 400);
  const keys = (await env.DERBY.get("shop:keys:" + handle, "json")) || [];
  if (!keys.includes(await sha(b.key))) return json({ error: `This device can't save @${handle}'s horse. Buy from this device, or DM us to move your key.` }, cors, 0, 403);
  const st = cleanStyle(b.style || {});
  if (!st) return json({ error: "bad style" }, cors, 0, 400);
  const cat = await catalog(env);
  const owned = ((await env.DERBY.get("shop:skins", "json")) || {})[handle] || [];
  const ids = new Set(owned.map(o => o.id));
  if (ids.has("unlock-all")) ["unlock-saddle", "unlock-acc", "unlock-paint", "unlock-plate", "unlock-stickers"].forEach(i => ids.add(i));
  const missing = needs(st, (cat.grandfathered || {})[handle]).filter(n => !ids.has(n));
  if (missing.length) return json({ error: "Not unlocked yet: " + missing.join(", "), missing }, cors, 0, 402);
  const styles = (await env.DERBY.get("shop:styles", "json")) || {};
  styles[handle] = { ...st, at: new Date().toISOString() };
  if (!st.name) delete styles[handle].name;
  await env.DERBY.put("shop:styles", JSON.stringify(styles));
  return json({ ok: true, style: styles[handle] }, cors, 0);
}

// ---------------------------------------------------------------- helpers
async function stripe(env, path, form) {
  const r = await fetch(STRIPE + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return r.json();
}
async function soldCount(env, id) { return Number(await env.DERBY.get("shop:sold:" + id)) || 0; }
const isTest = env => !String(env.STRIPE_SECRET_KEY || "").startsWith("sk_live_") && !String(env.STRIPE_SECRET_KEY || "").startsWith("rk_live_");
const money = c => "US$" + (c / 100).toFixed(c % 100 ? 2 : 0);

let memo = null;
async function catalog(env) {
  if (memo && Date.now() - memo.at < 60_000) return memo.data;
  try {
    const r = await fetch(env.SITE_DATA + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
    const data = (await r.json()).shop || {};
    memo = { at: Date.now(), data };
    return data;
  } catch {
    return memo ? memo.data : {};
  }
}
export const _reset = () => { memo = null; };
