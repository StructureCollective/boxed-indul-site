# Boxed Indulgence — gourmet gift box site (sandbox preview)

A working mockup of an upscale gift box ordering website: Home, Order
(availability calendar + approval-gated deposit), Contact, and an Admin
approval page — currently running as a **fully client-side sandbox** so it
deploys with zero Cloudflare setup.

## Current mode: sandbox (no setup required)

Everything — the availability calendar, order requests, contact messages,
admin approve/reject, and the deposit "payment" — runs entirely in the
browser using `localStorage` as a stand-in database. See
`public/js/mock-db.js`. There is no server, no database, no Stripe account,
and no email service involved. That means:

- **Nothing to configure.** `wrangler.jsonc` just points at the `public/`
  folder as static assets — deploy it as-is, from GitHub or `wrangler deploy`.
- **Data is per-browser.** An order submitted on your laptop won't show up
  if you open the admin page on your phone, and clearing browser data wipes
  it. That's expected for a preview — it's not meant to hold real orders.
- **The deposit page is simulated.** `/booking/checkout/` looks like a
  payment form but doesn't process anything — any input works, submitting it
  just marks the order "confirmed" in the browser's storage.
- **The admin passcode (`preview`, in `public/js/admin.js`) is not real
  security.** It's a soft gate for a demo, not authentication — anyone who
  views page source can see it.

To try the full loop: submit a request on `/booking/`, then open `/admin/`
(passcode `preview`) to approve it, then use the "Open Deposit Page" link
that appears to simulate the customer paying. There's a "Reset All Sandbox
Data" button on the admin page if you want to clear everything between demos.

## Going live later

The real backend — Cloudflare D1 for storage, Stripe (test or live mode) for
actual deposit payments, and Resend for real email notifications — is
already fully built. It's just not wired in right now. It lives in:

- `src/` — the Worker (routes, D1 queries, Stripe REST calls, email
  templates). Untouched, ready to go.
- `going-live-reference/` — the original fetch-based `booking.js`,
  `contact.js`, `admin.js`, and a `wrangler.live.jsonc` with the D1 binding
  and vars restored.

To switch from sandbox to live:

1. Copy `going-live-reference/wrangler.live.jsonc` over `wrangler.jsonc`
   (or merge the `main`, `d1_databases`, and `vars` blocks back in).
2. Copy the three `*.live.js` files from `going-live-reference/` over the
   sandbox versions in `public/js/` (renaming them back to `booking.js`,
   `contact.js`, `admin.js`), and remove the `mock-db.js` `<script>` tags
   from `public/booking/index.html`, `public/contact/index.html`, and
   `public/admin/index.html` (no longer needed).
3. Create a D1 database and apply `schema.sql`, get a free Stripe test-mode
   key, get a Resend API key, and pick a real `ADMIN_KEY` — set these up
   following the steps below.
4. Delete `public/booking/checkout/` (the simulated payment page) — the
   live flow uses real Stripe Checkout instead, hosted by Stripe.

### One-time setup for the live backend

1. **Install dependencies**
   ```
   npm install
   ```

2. **Log in to Cloudflare**
   ```
   npx wrangler login
   ```

3. **Create the D1 database**
   ```
   npx wrangler d1 create boxed-indulgence-db
   ```
   Copy the `database_id` it prints into `wrangler.jsonc` under
   `d1_databases[0].database_id`. (Can also be done with zero CLI use, from
   the Cloudflare dashboard — Storage & Databases → D1 SQL Database → Create
   database — then paste the ID and run `schema.sql` from the database's
   Console tab.)

4. **Apply the schema** (if using the CLI)
   ```
   npm run db:init:remote
   ```

5. **Fill in `wrangler.jsonc` vars**
   - `CLIENT_NOTIFY_EMAIL` — where order/contact notifications go.
   - `FROM_EMAIL` — the address emails are sent *from*, on a domain verified
     in Resend.
   - `SITE_URL` — the site's real deployed URL.

6. **Set secrets** (from the Cloudflare dashboard — Worker → Settings →
   Variables and Secrets — or via CLI):
   ```
   npx wrangler secret put STRIPE_SECRET_KEY       # sk_test_... or sk_live_...
   npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_...
   npx wrangler secret put RESEND_API_KEY           # from resend.com
   npx wrangler secret put ADMIN_KEY                # a real passphrase
   ```

7. **Set up the Stripe webhook**: Stripe dashboard → Developers → Webhooks →
   Add endpoint → `https://<your-worker-url>/api/stripe/webhook`, listening
   for `checkout.session.completed`. Copy the signing secret into
   `STRIPE_WEBHOOK_SECRET`.

## Deploying from GitHub

Two options:

**Option A — GitHub Actions (included, `.github/workflows/deploy.yml`)**
Deploys on every push to `main`. Requires two repo secrets: `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`.

**Option B — Cloudflare Workers Builds**
Dashboard → Workers & Pages → your worker → Settings → Builds → connected to
GitHub. Deploys automatically on push, no Actions needed. If using this,
you can delete `.github/workflows/deploy.yml`. Make sure the Worker's name
in the Cloudflare dashboard matches `wrangler.jsonc`'s `"name"` field
(currently `boxed-indul-site`) — if Cloudflare Workers Builds auto-created a
worker with a different name, either rename it there or update
`wrangler.jsonc` to match.

## Editing seasonal content

The "Current Promotions," "Gift Box Collections," and "Testimonials"
sections come from `public/data/content.json`. Edit the JSON, then redeploy
— no code changes needed for routine updates. This works the same in
sandbox or live mode.

## Home page food photos / Instagram grid

Currently placeholder images, and the Instagram handle (`@boxedindulgence`)
is a **placeholder guess** — no real handle was provided yet. Update the
`href` on every Instagram link in `public/index.html` (and the footer) once
you have the real one. Instagram's API requires the client's own Instagram
Business account connected through Meta's Graph API (there's no public
scraping option anymore). Options, roughly in order of effort:

1. Manually drop the client's best photos into `public/img/`, replacing
   `insta-1.jpg` … `insta-6.jpg`.
2. Use a no-code embed widget (SnapWidget, Elfsight) — drop their embed
   snippet into `public/index.html` in place of the `.insta-grid`.
3. Build a real Graph API integration once the client can grant API access.

## Brand assets

`public/img/logo.png` (full circular logo), `public/img/wordmark.png`
(transparent wordmark lockup), `public/img/hero-bg.jpg` (real product photo,
used as the homepage hero background), and `public/img/chef.png` (chef
avatar illustration — not currently placed on a page, but available for an
About/Meet the Curator section if the client wants one added) are the real
supplied brand assets. Everything else under `public/img/` (`insta-*.jpg`,
`menu-bg.jpg`) is a generated placeholder, clearly labeled as such.

## Project structure

```
public/index.html               Home page
public/booking/index.html        Order page (calendar + request form)
public/booking/checkout/         Simulated deposit page (sandbox only)
public/contact/index.html        Contact page
public/admin/index.html          Admin approval page
public/js/mock-db.js             Sandbox "database" (localStorage) — sandbox only
public/js/booking.js, contact.js, admin.js, checkout.js   Sandbox frontend logic
public/data/content.json         Editable seasonal content (promos/boxes/testimonials)
public/img/                      Logo, wordmark, hero photo, chef avatar + placeholder photos
src/                              Real backend (D1 + Stripe + Resend) — not currently wired in
going-live-reference/             Archived live frontend JS + wrangler config, for later
schema.sql                        D1 database schema (for going-live)
wrangler.jsonc                    Cloudflare config — currently assets-only
```
