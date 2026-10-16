---
name: Scoped pnpm updates
description: Keep transitive security fixes from changing unrelated workspace dependencies or catalog declarations.
---

For a targeted transitive dependency fix, review workspace manifests and optional-peer resolutions as well as the target package entries. Recursive pnpm updates can refresh unrelated peer versions or convert `catalog:` references to literal versions. Restore unrelated declarations and validate the final lockfile with a frozen install.

An artifact-local ignored `node_modules/.bin` launcher can also retain a hard-coded path to an older package version after the lockfile and root package store are correct. In that case, inspect the generated launcher before changing manifests or the lockfile.

**Why:** During NIDOR's targeted security update, pnpm refreshed an unrelated optional `tsx` peer resolution and rewrote catalog references; those changes were restored to keep the patch scoped.

**How to apply:** After recursive updates, compare the lockfile and affected workspace manifests to their baseline, then run `pnpm install --frozen-lockfile` before tests. If a package script still resolves a nonexistent installed version, remove only the stale ignored launcher and rerun the standard command.
