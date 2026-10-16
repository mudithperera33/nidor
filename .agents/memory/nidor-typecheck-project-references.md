---
name: NIDOR workspace typecheck references
description: Rebuild workspace declarations before artifact typechecks when package source and generated declarations are out of sync.
---

Run `pnpm run typecheck:libs` before standalone artifact typechecks when generated workspace package exports appear to be missing. Leaf checks do not rebuild every referenced package, so stale declaration output can report exports missing even though the source exports them.

**Why:** TypeScript project references can resolve stale declarations; this has affected both generated API-client types in NIDOR and API-Zod types in the server.

**How to apply:** Before diagnosing missing workspace exports as source errors, rebuild library references, then rerun the affected artifact typecheck.
