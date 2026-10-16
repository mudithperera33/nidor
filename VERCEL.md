# Deploy NIDOR from GitHub to Vercel

This repository builds both the React storefront and the Express checkout API.
Supabase remains the database, authentication provider, and product-image storage.
No database migration or data transfer is performed by a Vercel build.

## 1. Import the repository

1. Commit and push the repository changes to your GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Use the repository root (`.`), **not** `artifacts/nidor`, as the Root Directory.
4. Choose **Other** as the framework preset. Use Node.js **22.x**.
5. Leave the build and install commands controlled by `vercel.json`:
   - Install: `corepack enable && pnpm install --frozen-lockfile`
   - Build: `pnpm run build:vercel`
   - Do not add an Output Directory override.

The custom build emits Vercel's Build Output API directory, `.vercel/output`.
The static site is served by Vercel's CDN; every `/api` request goes to the
bundled Node.js function. Other routes fall back to `index.html`, so reloading
shop, fragrance-world, cart, and admin pages works.

## 2. Set environment variables before deploying

Enter values in **Vercel → Project → Settings → Environment Variables**, not in
GitHub files or chat. `.env.example` lists names only.

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Existing Supabase project URL; public frontend configuration. |
| `VITE_SUPABASE_ANON_KEY` | Existing Supabase anonymous/publishable key; never use a service-role key here. |
| `SUPABASE_DB_URL` | Server-only PostgreSQL connection string for the same Supabase database. Prefer Supabase's pooler connection string for serverless/IPv4 access. Preserve TLS settings; do not disable certificate validation. |
| `RESEND_API_KEY` | Server-only Resend API key with permission to send from your verified domain. Replit connector credentials do not transfer to Vercel. |
| `NIDOR_RECEIPT_FROM` | Verified sender, such as `NIDOR <receipts@your-domain.com>`. |
| `RESEND_WEBHOOK_SECRET` | Signing secret for the Resend webhook pointing at this Vercel deployment. |
| `CRON_SECRET` | A random secret of at least 16 characters, used only by scheduled maintenance. Vercel adds it to cron requests as `Authorization: Bearer …`. |
| `CORS_ALLOWED_ORIGINS` | Optional exact, comma-separated storefront origins, including `https://your-domain.com`. No trailing slash or wildcard. |

Apply the frontend variables to every environment you build. They are embedded
at build time, so changing them requires redeployment. Use a separate test
database and email credentials for Preview deployments if previews should not
touch live inventory, orders, or customers. Do not blindly copy secrets to every
preview branch.

No `PORT`, `BASE_PATH`, Replit identity token, or Replit `DATABASE_URL` is required
on Vercel. Never prefix a server secret with `VITE_`.

## 3. Connect authentication and email callbacks

- In Supabase Auth's URL configuration, set the production Site URL and allow
  the production admin sign-in redirect (`https://your-domain.com/admin/products`).
- Keep the existing product-image storage bucket and its policies.
- In Resend, create/update the endpoint to:
  `https://your-domain.com/api/webhooks/resend`
- Subscribe it to `email.bounced` and `email.complained`; save its signing secret
  as `RESEND_WEBHOOK_SECRET` and redeploy.
- The production webhook must be accessible to Resend. If Vercel Deployment
  Protection covers production, configure an appropriate bypass before expecting
  webhook delivery. Do not weaken admin authentication.

Use the actual domain shown by Vercel; the placeholder URLs above are not deployed
URLs. No secret values are copied automatically from Replit.

## 4. Scheduled work and Vercel plans

Serverless functions cannot reliably keep the existing `setInterval` workers
alive. The Vercel entry point does not start them. Instead,
`GET /api/internal/maintenance` awaits one bounded cleanup and receipt retry batch.
It denies requests without the correct bearer secret, returns counts only, and
uses `Cache-Control: no-store`.

The checked-in cron runs **daily at approximately 02:00 UTC**, compatible with
Vercel Hobby's once-per-day restriction. Daily scheduling means failed receipt
emails can wait until the next daily run, and only two retries are processed per
invocation. Initial order receipts still send during checkout.

For prompt automatic retries:

- On Vercel Pro/Enterprise, change `crons[0].schedule` in `vercel.json` to
  `*/5 * * * *` and push the change.
- On Hobby, keep the daily fallback and configure a trusted external scheduler to
  call the same URL every five minutes, sending `Authorization: Bearer <CRON_SECRET>`
  as a header. Never put the secret in a URL, browser script, or public workflow.
- Cron runs only on production deployments. Review its execution logs in Vercel.

Do not run the same production retry worker from Replit and Vercel unnecessarily.
Plan which host owns scheduled jobs when moving traffic. Database leases and
bounded deletes protect concurrent claims, but using one scheduler is simpler.

## 5. Deploy and verify

Deploy in Vercel, then check:

- `/api/healthz` returns JSON, not the storefront HTML.
- Refreshing a nested storefront/admin URL loads the correct page.
- Admin sign-in and the existing Supabase catalogue/image operations work.
- A controlled test order saves exactly once, reserves the correct stock, and
  receives a receipt through Resend.
- Invalid webhook signatures are rejected; valid Resend test events update the
  corresponding delivery status.
- Maintenance without authorization returns 401 (503 if not configured).
- Authorized maintenance runs and the cron appears in production settings.

The API retains its conservative proxy policy (`trust proxy = false`). This can
group shoppers behind a Vercel function's network identity for rate limiting;
verify Vercel's actual forwarded-header behavior before changing that policy.
Do not enable unrestricted proxy trust.

After import, pushes to the Vercel project's configured production branch trigger
deployments automatically. Other branches normally produce Preview deployments.

## Local build check

With dependencies installed, run:

```sh
pnpm test
pnpm run build:vercel
pnpm run test:vercel
```

Generated `.vercel/` output is ignored by Git. The deployment output contains
bundled server code, but private API credentials remain runtime environment
variables and are not written into static files.
