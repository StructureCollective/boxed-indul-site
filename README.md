# Boxed Indulgence — indulgent boxed catered meals site

The full, live backend is wired in: Cloudflare Workers + D1 for storage,
Stripe for deposit and lunch-sale payments, Resend for transactional email,
Cloudflare Access (Zero Trust) for admin sign-in, and two-way Google Calendar
sync for availability. Nothing runs in a browser-only "sandbox" anymore —
every page talks to the real Worker API in `src/`.

**The site will not fully work yet on a fresh deploy** until the one-time
Cloudflare setup below is completed (D1 database, Access application,
secrets). Until then, `/booking/`, `/lunch-sale/`, `/contact/`, and `/admin/`
will return errors when they call the API. Complete the checklist below
*before* pushing/deploying these changes to the live site, or right after —
just know the ordering, admin panel, and lunch sale pages won't function
until it's done.

## Go-live checklist

Do these in order. None of them require writing code — all dashboard or
one-line CLI steps.

### 1. Create the D1 database

**Dashboard (no CLI needed):** Cloudflare dashboard → Storage & Databases →
D1 SQL Database → Create database → name it `boxed-indulgence-db`. Open its
**Console** tab, paste in the contents of `schema.sql` from this repo, and
run it. Copy the **Database ID** shown on the database's overview page.

**Or via CLI**, from a machine with `wrangler` installed and network access:
```
npx wrangler login
npx wrangler d1 create boxed-indulgence-db
npm run db:init:remote
```

Either way, paste the resulting `database_id` into `wrangler.jsonc` under
`d1_databases[0].database_id`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 2. Set up Cloudflare Access (Zero Trust) for `/admin/*`

This is what replaces the old admin passcode with a real sign-in — only the
two approved emails will be able to reach `/admin/`.

1. Cloudflare dashboard → **Zero Trust** (left sidebar). First time in,
   it'll ask you to pick a **team name** — this becomes your team domain,
   `<team-name>.cloudflareaccess.com`. (Zero Trust has a free plan for up to
   50 users, which easily covers 2 admins.)
2. Zero Trust → **Access** → **Applications** → **Add an application** →
   **Self-hosted**.
3. Application configuration:
   - **Application name**: `Boxed Indulgence Admin`
   - **Session duration**: whatever you're comfortable with (24h is a
     reasonable default).
   - **Application domain**: `boxedindulgence.com`, path `/admin`. (This
     protects everything under `/admin/*`, including `/api/admin/*` since
     that's proxied through the same Worker.)
4. **Add a policy**:
   - **Policy name**: `Admins`
   - **Action**: Allow
   - **Include** rule: **Emails** — add both
     `boxedindulgenceadmin@gmail.com` and `admin@structurecollective.com`.
5. Save. Cloudflare will now show a login page (email + one-time PIN, unless
   you also set up Google/other identity providers) to anyone visiting
   `/admin/*` who isn't one of those two emails.
6. Open the application you just created and go to its **Overview** tab.
   Copy the **Application Audience (AUD) Tag** shown there.
7. Fill these into `wrangler.jsonc` under `vars`:
   - `CF_ACCESS_TEAM_DOMAIN` → `<your-team-name>.cloudflareaccess.com`
   - `CF_ACCESS_AUD` → the AUD tag from step 6

The Worker verifies the Access session server-side too (see
`src/lib/access.js`), so `/api/admin/*` can't be called directly even if
someone bypasses the Access login page somehow.

### 3. Set the remaining secrets

From the Cloudflare dashboard (Worker → Settings → Variables and Secrets) or
CLI:
```
npx wrangler secret put STRIPE_SECRET_KEY       # sk_test_... or sk_live_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_...
npx wrangler secret put RESEND_API_KEY           # from resend.com
npx wrangler secret put GOOGLE_CLIENT_SECRET     # from Google Cloud Console OAuth client
```
There's no `ADMIN_KEY` anymore — Cloudflare Access replaced it entirely.

### 4. Set up the Stripe webhook

Stripe dashboard → Developers → Webhooks → Add endpoint →
`https://boxedindulgence.com/api/stripe/webhook`, listening for
`checkout.session.completed`. Copy the signing secret into
`STRIPE_WEBHOOK_SECRET` (step 3).

### 5. Connect Google Calendar

Once the site is live and you can reach `/admin/`, open the **Calendar &
Dates** tab and click **Connect Google Calendar** — this runs the OAuth flow
and stores a refresh token in D1. After that, confirmed bookings push to the
calendar automatically, and busy times pull back in daily (and on demand via
**Sync Now**).

### 6. Confirm menu prices

`public/data/content.json` → `orderMenus` currently has **placeholder
prices** carried over from the uploaded templates. Edit those to real prices
before taking real orders — see the `_orderMenus_instructions` note in that
file.

## Architecture

- `src/index.js` — the Worker: routes `/api/*`, verifies the Cloudflare
  Access session for `/api/admin/*`, falls back to the `ASSETS` binding
  (the `public/` folder) for everything else, and runs a daily cron
  (`scheduled()`) to pull busy dates from Google Calendar.
- `src/lib/` — D1 queries (`db.js`), Stripe REST calls (`stripe.js`), Resend
  email templates (`email.js`), Cloudflare Access JWT verification
  (`access.js`), Google Calendar OAuth + sync (`calendar.js`), server-side
  menu pricing (`menu-data.js`, reads `public/data/content.json` so prices
  are edited in one place and both the form and the Worker agree).
- `public/` — the static site. `public/js/*.js` are the live frontend
  scripts (no more sandbox/live split — `mock-db.js` is gone).
- `schema.sql` — the D1 schema: `bookings`, `blocked_dates`,
  `contact_messages`, `lunch_sale_events`, `lunch_sale_orders`,
  `lunch_sale_signups`, `google_calendar_connection`.
- `going-live-reference/` — now just a historical snapshot of the frontend
  scripts and `wrangler.jsonc` from when the site ran in sandbox mode. It's
  no longer needed for anything and can be deleted whenever you like.

### Custom-order flow (Boxed Lunch / Charcuterie / Custom Boxed Meal)

`/booking/` → customer picks a date, builds an itemized order from
`content.json`'s `orderMenus`, submits → email to admin + confirmation email
to customer → admin approves (optionally overriding the total for
quoted/custom items) on `/admin/` → time-limited (72h, configurable via
`DEPOSIT_LINK_EXPIRY_HOURS`) deposit link emailed to the customer →
`/booking/checkout/` creates a fresh Stripe Checkout Session only at the
moment the customer clicks Pay → webhook confirms the booking, pushes it to
Google Calendar, and emails both sides.

### Lunch Sale flow

Admin posts a lunch-sale event from `/admin/` → **Lunch Sale** tab (menu,
price, drop-off time(s)/location(s), sale date, order cutoff, slot cap, max
qty per order) and sets it **Live**. It then shows on the homepage and at
`/lunch-sale/` with a live slots-remaining count. Customers order (quantity +
drop-off choice), pay in full at Stripe Checkout, and the order lands in the
searchable **Orders** table on `/admin/`. When no sale is live, the homepage
shows a placeholder and `/lunch-sale/` offers an email signup — admins can
notify everyone on that list with one click once a new sale goes live.

## Editing seasonal content

The "Current Promotions," "Boxed Meal Collections," "Order form pricing,"
and "Testimonials" all come from `public/data/content.json`. Edit the JSON,
redeploy — no code changes needed.

## Brand assets

Every image on the site is a real supplied brand asset:

- `public/img/logo.png` — full circular logo, used in the header and admin
  page.
- `public/img/wordmark.png` — transparent wordmark lockup.
- `public/img/hero-bg.jpg` — the homepage hero background photo.
- `public/img/chef.png` — the curator illustration.
- `public/img/favicon.ico`, `favicon-16.png`, `favicon-32.png`,
  `favicon-48.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` —
  favicon/home-screen icons.
- `public/img/og-image.jpg` — the social share preview image (1200×630).

Every `og:image`, `og:url`, and `twitter:image` tag points at
`https://boxedindulgence.com/...`. If the site ever moves to a different
domain, update those (find/replace across `public/*/index.html`) or link
previews won't show an image when shared.

## Deploying from GitHub

**Option A — GitHub Actions** (`.github/workflows/deploy.yml`): deploys on
every push to `main`. Requires repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

**Option B — Cloudflare Workers Builds**: dashboard → Workers & Pages → your
worker → Settings → Builds → connected to GitHub. Deploys automatically on
push. Make sure the Worker's name in the dashboard matches `wrangler.jsonc`'s
`"name"` (`boxed-indul-site`).

**Either way**: a deploy will fail if `d1_databases[0].database_id` in
`wrangler.jsonc` is still the placeholder — complete step 1 of the go-live
checklist first.

## Project structure

```
public/index.html                 Home page (+ lunch-sale block)
public/booking/index.html         Custom order page (calendar + itemized form)
public/booking/checkout/          Real deposit checkout bridge page (permanent — not simulated)
public/lunch-sale/index.html      Lunch-sale order page + notify-me signup
public/contact/index.html         Contact page
public/admin/index.html           Admin dashboard (Cloudflare Access-gated)
public/js/                        Live frontend scripts (main, booking, checkout, contact, admin, lunch-sale, menu-selector)
public/data/content.json          Editable seasonal content + order menu pricing
public/img/                       Logo, wordmark, hero photo, chef avatar — real brand assets
src/                               The Worker (routes, D1 queries, Stripe, email, Access, Calendar)
going-live-reference/             Historical snapshot from sandbox mode — safe to delete
schema.sql                        D1 database schema
wrangler.jsonc                    Cloudflare config (Worker + D1 + vars)
```
