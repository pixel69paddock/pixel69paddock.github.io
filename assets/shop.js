// Daily Derby shop: tip jar + limited cosmetic skins. Payment happens on Stripe's own checkout page
// (Apple Pay / Google Pay / card, in the buyer's currency); this file only shows the shop and sends people there.
// Data: derby.json "shop" (prices, drops, api); live stock + who owns which skin: <shop.api>/shop
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = h => String(h || "").trim().replace(/^@+/, "").toLowerCase();
  const money = c => "US$" + (c / 100).toFixed(c % 100 ? 2 : 0);
  const toast = m => { const t = $("#toast"); if (!t) return alert(m); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3600); };
  const sec = $("#shop"), box = $("#shopWrap");
  if (!sec || !box) return;
  let S = null, API = null, LIVE = { drops: [], skins: {} }, tipAmt = 500;

  const myHandle = () => { try { return JSON.parse(localStorage.getItem("dd-horse") || "{}").handle || ""; } catch { return ""; } };

  fetch("data/derby.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()).then(D => {
    S = D.shop; if (!S) return;
    API = (S.api || "").replace(/\/$/, "") || null;
    // local testing only: ?shopapi=http://127.0.0.1:8787 on localhost
    const dev = new URLSearchParams(location.search).get("shopapi");
    if (dev && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API = dev;
    sec.hidden = false;
    if (S.tips && S.tips.amounts) tipAmt = S.tips.amounts[Math.min(1, S.tips.amounts.length - 1)];
    render();
    if (API) refresh();
    const paid = new URLSearchParams(location.search).get("paid");
    if (paid) receipt(paid);
  }).catch(() => {});

  function refresh() {
    return fetch(API + "/shop", { cache: "no-store" }).then(r => r.json()).then(j => {
      LIVE = j; window.DD_SKINS = j.skins || {};
      if (window.ddReboard) window.ddReboard();
      render();
    }).catch(() => {});
  }

  function render() {
    const drops = (S.drops || []).filter(d => d.status !== "hidden" && d.featured);
    const more = (S.drops || []).filter(d => d.status !== "hidden" && !d.featured);
    // the test-mode notice is for the owner only: localhost or ?test in the address
    const showTest = new URLSearchParams(location.search).has("test") || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const test = showTest && (API ? LIVE.testMode !== false && (LIVE.testMode || S.testMode) : S.testMode);
    const me = myHandle();
    box.innerHTML = `
      <p class="kicker">Shop</p>
      <h2 class="px">Support the paddock</h2>
      <p class="sub">Racing is free and always will be. If you'd like to chip in, tip the stable or grab a limited skin for your horse. Prices are in US$, and you pay in your own currency at checkout.</p>
      ${test ? `<div class="shop-test"><b>Test mode.</b> No real money is taken. Pay with Stripe's test card 4242 4242 4242 4242, any future date, any CVC.</div>` : ""}
      <div class="shop-grid">
        ${drops.map(dropCard).join("")}
        ${more.length ? `<a class="card shop-card shed-more" href="shed.html${myHandle() ? "?h=" + encodeURIComponent(myHandle()) : ""}"><div class="shop-art more-art" aria-hidden="true">🌌🔥🦓<br>💠🪧</div><h3>More in the Shed <small>${more.length} limited extras</small></h3><p class="shop-desc">Galaxy and Zebra coats, a flame mane, glow hooves and a neon name sign for your stall. Try them on your own horse in 3D for free.</p><span class="btn btn-ghost shop-buy">Open the Shed →</span></a>` : ""}
        <div class="card shop-card tip">
          <div class="shop-art jar" aria-hidden="true">🫙<span>🐎</span></div>
          <h3>Tip jar</h3>
          <p class="shop-desc">Keeps the races running every day: art, music and the race caller's voice.</p>
          <div class="tip-amts" role="group" aria-label="Tip amount">
            ${(S.tips?.amounts || [200, 500, 1000]).map(a => `<button type="button" class="tip-amt" data-amt="${a}" aria-pressed="${a === tipAmt}">${money(a)}</button>`).join("")}
            <label class="tip-own"><span>US$</span><input id="tipOwn" inputmode="decimal" placeholder="other" aria-label="Other amount in US dollars"></label>
          </div>
          <div class="finder shop-handle"><label class="field" for="tipHandle"><span>@</span><input id="tipHandle" placeholder="your handle (optional)" autocapitalize="none" spellcheck="false" value="${esc(me)}"></label></div>
          <button class="btn btn-gold shop-buy" id="tipBuy" type="button" ${API ? "" : "disabled"}>${API ? `Tip ${money(tipAmt)}` : "Opening soon"}</button>
        </div>
      </div>
      <p class="shop-fine">Apple Pay, Google Pay and cards through Stripe. Cosmetic only: nothing here changes odds or race results. <a href="terms.html">Terms &amp; refunds</a></p>
      <div id="shopReceipt" aria-live="polite"></div>`;
    wire();
  }

  function dropCard(d) {
    const live = (LIVE.drops || []).find(x => x.id === d.id);
    const sold = live ? live.sold : 0, left = live ? live.left : d.limit;
    const out = d.status === "closed" || (live && left <= 0);
    const owners = Object.entries(LIVE.skins || {}).filter(([, a]) => a.some(s => s.id === d.id)).map(([h, a]) => ({ h, n: a.find(s => s.id === d.id).n })).sort((a, b) => a.n - b.n);
    const look = window.DD && window.DD.lookOf ? window.DD.lookOf(myHandle()) : "1111";
    const art = window.DD && window.DD.spriteTag ? window.DD.spriteTag(look, 150) : "";
    return `<div class="card shop-card drop" data-id="${esc(d.id)}">
      <div class="shop-art skin-${esc(d.id)}">${art}<span class="plate">#${Math.min(sold + 1, d.limit)}/${d.limit}</span></div>
      <h3>${esc(d.name)} <small>limited skin</small></h3>
      <p class="shop-desc">${esc(d.blurb || "")}</p>
      <div class="stock"><div class="bar"><i style="width:${Math.round(100 * sold / d.limit)}%"></i></div><span>${out ? "Sold out" : `${left} of ${d.limit} left`}</span></div>
      <div class="finder shop-handle"><label class="field" for="h-${esc(d.id)}"><span>@</span><input id="h-${esc(d.id)}" class="drop-handle" placeholder="whose horse gets it?" autocapitalize="none" spellcheck="false" value="${esc(myHandle())}"></label></div>
      <button class="btn btn-neon shop-buy drop-buy" type="button" ${API && !out ? "" : "disabled"}>${out ? "Sold out" : API ? `Buy for ${money(d.price)}` : "Opening soon"}</button>
      ${owners.length ? `<p class="owners">Owned by ${owners.slice(0, 8).map(o => `<b>#${o.n}</b> @${esc(o.h)}`).join(" · ")}${owners.length > 8 ? ` and ${owners.length - 8} more` : ""}</p>` : ""}
    </div>`;
  }

  function wire() {
    box.querySelectorAll(".tip-amt").forEach(b => b.addEventListener("click", () => {
      tipAmt = +b.dataset.amt; $("#tipOwn").value = "";
      box.querySelectorAll(".tip-amt").forEach(x => x.setAttribute("aria-pressed", x === b));
      if (API) $("#tipBuy").textContent = `Tip ${money(tipAmt)}`;
    }));
    $("#tipOwn").addEventListener("input", e => {
      const v = Math.round(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) * 100);
      if (v > 0) { tipAmt = v; box.querySelectorAll(".tip-amt").forEach(x => x.setAttribute("aria-pressed", "false")); if (API) $("#tipBuy").textContent = `Tip ${money(v)}`; }
    });
    $("#tipBuy").addEventListener("click", e => {
      const min = S.tips?.min || 200, max = S.tips?.max || 20000;
      if (tipAmt < min || tipAmt > max) return toast(`Tips go from ${money(min)} to ${money(max)}.`);
      go(e.currentTarget, { kind: "tip", amount: tipAmt, handle: norm($("#tipHandle").value) });
    });
    box.querySelectorAll(".drop-buy").forEach(b => b.addEventListener("click", () => {
      const card = b.closest(".drop"), h = norm(card.querySelector(".drop-handle").value);
      if (!h) { card.querySelector(".drop-handle").focus(); return toast("Type the Instagram handle whose horse gets the skin."); }
      go(b, { kind: "skin", id: card.dataset.id, handle: h });
    }));
  }

  async function go(btn, body) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Opening checkout…";
    try {
      const r = await fetch(API + "/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.url) { location.href = j.url; return; }
      toast(j.error || "Couldn't open checkout. Try again.");
    } catch { toast("Couldn't reach the shop. Try again."); }
    btn.disabled = false; btn.textContent = label;
  }

  // back from Stripe: ?paid=cs_... -> wait for the webhook to land, then say thanks
  async function receipt(id) {
    history.replaceState(null, "", location.pathname + "#shop");
    setTimeout(() => sec.scrollIntoView({ behavior: "smooth" }), 400);
    const out = () => $("#shopReceipt");
    if (out()) out().innerHTML = `<div class="shop-receipt">Payment received. Confirming…</div>`;
    for (let i = 0; i < 12; i++) {
      try {
        const o = await fetch(API + "/order?session=" + encodeURIComponent(id), { cache: "no-store" }).then(r => r.json());
        if (o.status === "paid") {
          const msg = o.kind === "skin"
            ? `<b>Thank you!</b> @${esc(o.handle)} now owns <b>${esc(o.name)} #${o.n} of ${o.limit}</b>. It shows on the site now.`
            : `<b>Thank you for the tip${o.handle ? ", @" + esc(o.handle) : ""}!</b> It keeps the races running. 🐎`;
          await refresh();
          if (out()) out().innerHTML = `<div class="shop-receipt ok">${msg}</div>`;
          return;
        }
        if (o.status === "refunded") { if (out()) out().innerHTML = `<div class="shop-receipt">${esc(o.name)} sold out just before your payment went through, so you've been refunded in full.</div>`; return; }
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    if (out()) out().innerHTML = `<div class="shop-receipt">Payment received. It can take a minute to show here; Stripe has emailed your receipt.</div>`;
  }
})();
