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
      drops.push({ id: d.id, sold, left: Math.max(0, (d.limit || 0) - sold) });
    }
    return json({ testMode: isTest(env), drops, skins }, cors, 10);
  }
  if (p === "/checkout" && req.method === "POST") return checkout(req, env, cors, json);
  if (p === "/order" && req.method === "GET") {
    const id = url.searchParams.get("session") || "";
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: "bad session" }, cors, 0, 400);
    const o = await env.DERBY.get("shop:order:" + id, "json");
    return json(o || { status: "pending" }, cors, 0);
  }
  if (p === "/stripe/webhook" && req.method === "POST") return webhook(req, env);
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
  const f = {
    mode: "payment",
    success_url: `${site}/?paid={CHECKOUT_SESSION_ID}#shop`,
    cancel_url: `${site}/#shop`,
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
    if ((await soldCount(env, d.id)) >= d.limit) return json({ error: `${d.name} is sold out.` }, cors, 0, 409);
    const skins = (await env.DERBY.get("shop:skins", "json")) || {};
    if ((skins[handle] || []).some(s => s.id === d.id)) return json({ error: `@${handle} already owns ${d.name}.` }, cors, 0, 409);
    f["line_items[0][price_data][unit_amount]"] = String(d.price);
    f["line_items[0][price_data][product_data][name]"] = `${d.name} skin for @${handle}`;
    f["line_items[0][price_data][product_data][description]"] = `Limited to ${d.limit}. Cosmetic only: it never changes race results.`;
    f["metadata[item]"] = d.id;
    f["payment_intent_data[metadata][item]"] = d.id;
    f["custom_text[submit][message]"] = `This skin goes to @${handle}'s horse.`;
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
    if (sold >= d.limit || owned) {
      // sold out (two people paid for the last one at once) or already owned: refund in full
      await stripe(env, "/refunds", { payment_intent: s.payment_intent, "metadata[reason]": owned ? "already owned" : "sold out" });
      order = { ...base, item: d.id, name: d.name, status: "refunded", reason: owned ? "already owned" : "sold out" };
    } else {
      const n = sold + 1;
      await env.DERBY.put("shop:sold:" + d.id, String(n));
      skins[handle] = [...(skins[handle] || []), { id: d.id, n, at: base.at }];
      await env.DERBY.put("shop:skins", JSON.stringify(skins));
      order = { ...base, item: d.id, name: d.name, n, limit: d.limit, status: "paid" };
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
