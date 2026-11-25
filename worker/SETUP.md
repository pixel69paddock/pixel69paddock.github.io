# Instant horse claims: setup

The claims server (`src/index.js`) reads `HORSE dddd` comments on every @dailyderby_horse reel through
Instagram's official API, so "Check my horse" on the site answers in seconds. It runs free on Cloudflare
Workers. It only **reads** comments; it never posts, replies or likes.

Logins, approvals and the access token are yours to handle; Claude does the rest.

## 1. Meta developer app (about 10 minutes, in your browser)
1. Go to **developers.facebook.com** and log in (with any Facebook account you control). If asked, register as a developer.
2. **My Apps → Create app.** Name it `Daily Derby claims`. For the use case, choose **"Manage messaging & content on Instagram"**. Skip connecting a business if offered. Create the app.
3. In the app, open **Instagram → API setup with Instagram login**.
4. Under **"Generate access tokens"**, click **Add account** and log in as **dailyderby_horse**. Approve the permissions (it asks for basic profile and comments).
   - If it says the account needs a role: in **App roles → Roles**, add `dailyderby_horse` as an **Instagram Tester**, then in the Instagram app go to **Settings → Website permissions → Apps and websites → Tester invites** and accept. Then try **Add account** again.
5. Click **Generate token** next to dailyderby_horse and **copy the token**. Keep it private (it's like a password for reading the account). Don't paste it in chat; you'll paste it straight into Cloudflare in step 3.

## 2. Cloudflare account (2 minutes)
Sign up free at **dash.cloudflare.com** (email + password). No card needed for Workers.

## 3. Connect and deploy (Claude runs these; two steps are yours)
In a terminal, in `dailyderby-site/worker`:

```
npx wrangler login                          # yours: approve in the browser window that opens
npx wrangler kv namespace create DERBY      # Claude: puts the id into wrangler.toml
npx wrangler secret put IG_TOKEN            # yours: paste the token from step 1.5 when asked
npx wrangler deploy                         # Claude: prints the server URL
```

## 4. Switch the site over (Claude)
- Set `"claimsApi": "<server URL>"` in `data/derby.json`, push. The site then shows "Live from Instagram" and "Check my horse" checks instantly.
- The hourly sync task changes to copy the server's looks into `derby.json` (the race renderer reads them from there), so it no longer needs Chrome.

## Live follower count
The same server answers `GET /followers` with the account's follower count (official API, cached 60 s). Once `claimsApi` is set, the site's "stalls filled" numbers update live every minute; stall *names* still come from the hourly sync (the API never lists followers).

## Upkeep
- The token lasts 60 days; the server renews it by itself about every 7 days (cron twice a day). If a renewal ever fails, `GET /health` still answers and the site falls back to the hourly data; generate a new token (step 1.5) and run `npx wrangler secret put IG_TOKEN` again.
- Instagram rate limits: the server caches each scan for 15–60 s and re-reads comments on reels older than 3 days only every 10 min.

---

# Shop: tips + limited skins (Stripe)

The same worker runs the shop (`src/shop.js`). Payment happens on Stripe's hosted checkout page (Apple Pay, Google Pay,
cards). Prices are in US$; Adaptive Pricing shows each buyer their own currency. Keys never go in the site or this repo.

| Secret | What | How |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (test: `sk_test_…`, or a restricted key `rk_test_…` with Checkout Sessions: write and Refunds: write) | `npx wrangler secret put STRIPE_SECRET_KEY` (you paste it at the prompt) |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the webhook endpoint (`whsec_…`) | `npx wrangler secret put STRIPE_WEBHOOK_SECRET` |

## Turn it on (test mode first)
1. `npx wrangler deploy` (in `worker/`). Note the URL, e.g. `https://dailyderby-claims.<you>.workers.dev`.
2. `npx wrangler secret put STRIPE_SECRET_KEY`, paste the **test** key.
3. Stripe Dashboard (test mode) → Developers → Webhooks → Add endpoint: `<worker URL>/stripe/webhook`, events
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret, then
   `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
4. Stripe Dashboard → Settings → Adaptive Pricing: turn on (the worker also asks for it per checkout).
5. Stripe Dashboard → Settings → Public details: business name "Daily Derby", support link/email, and the terms URL
   `https://pixel69paddock.github.io/terms.html`.
6. Set `"shop": {"api": "<worker URL>"}` in `data/derby.json` and push. The shop buttons switch from "Opening soon" to live.
7. Test: buy Neon Gold for your own handle with card `4242 4242 4242 4242`. You should come back to the site with
   "Thank you! @you now owns Neon Gold #1 of 50", and the gold #1 chip on the standings.
8. Going live: repeat steps 2–3 with the live key and a live-mode webhook, set `"testMode": false`, push.

## Day to day
- Prices, the tip range and drops live in `data/derby.json` → `shop` (the worker reads them from the site, so buyers
  can't change a price). A drop's `status`: `open`, `closed` (shows sold out), or `hidden`.
- Stock and owners: `GET <worker URL>/shop`. Every order (with handle, amount, refunds): KV key `shop:log`
  (`npx wrangler kv key get --binding DERBY shop:log --remote`).
- Sold out while paying, or buying a skin the handle already owns: refunded in full automatically.
- Local test without Stripe: `worker/.dev.vars` (fake keys, git-ignored), `npx wrangler dev --local --port 8787`, then
  open the site on localhost with `?shopapi=http://127.0.0.1:8787`.
