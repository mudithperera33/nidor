---
name: Supabase migration history
description: NIDOR's Supabase schema migration tracking and safe future CLI adoption.
---

Do not assume Supabase CLI is managing this project's schema. The connected Supabase database has no `supabase_migrations.schema_migrations` table or project migration-runner configuration. Full-bottle variants, per-variant low-stock thresholds, and atomic product/variant creation were applied directly from checked-in SQL in transactions, so the database has no CLI migration ledger entries for those changes.

**Why:** Direct application was the authorized path for this external database, but an absent migration ledger means a future CLI push could treat already-applied checked-in migrations as unapplied.

**How to apply:** Before using Supabase CLI migration commands, inspect the remote schema and reconcile the versions of all already-applied migrations. Do not blindly push or replay the whole migration directory.

The workspace's Supabase REST integration can point to a different project than NIDOR's configured application database. In this environment, that integration did not expose the NIDOR `products` or `product_variants` tables, while the app-configured database did.

**Why:** The installed integration and the application's database secret are separate connections; using the integration just because it is present could target an unrelated database.

**How to apply:** Confirm the intended target with the user and verify the NIDOR catalog schema through the app-configured database before any migration or inventory write.
