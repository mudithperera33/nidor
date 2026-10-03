# Deploy NIDOR to Vercel

NIDOR is one app inside this pnpm monorepo. Import the GitHub repository as a
Vercel project and keep **Root Directory** set to the repository root (`./`).
The root `vercel.json` installs the workspace, builds only NIDOR, publishes its
static output, and routes client-side paths such as `/admin/products` back to
the SPA entry point.

## Environment variables

Set these in the Vercel project's Environment Variables for both Production
and Preview deployments:

- `VITE_SUPABASE_URL` — the NIDOR Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — that project's public anon/publishable key.

These are Vite build-time variables. Redeploy after changing them. Do not put a
Supabase service-role key, database URL, or other server credential in a
`VITE_` variable or commit it to GitHub.

## Supabase Auth redirects

After the first Vercel deployment, add the exact production callback URL
`https://<production-domain>/admin/products` to the NIDOR Supabase project's
Auth redirect URL allowlist. Add the relevant Vercel Preview URL pattern too if
you intend to test magic links from preview deployments. The production
`Site URL` should not be `localhost`.