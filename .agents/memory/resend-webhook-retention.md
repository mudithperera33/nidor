---
name: Resend webhook retention
description: Resend's automatic delivery retry schedule and the retention tradeoff for webhook event IDs.
---

Resend's documented automatic webhook attempt schedule is immediate, then 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, and 10 more hours: about 27 hours 35 minutes total. NIDOR retains webhook deduplication IDs for 30 days and prunes them in batches of at most 500.

**Why:** The 30-day window is a large margin over automatic redelivery while keeping the deduplication table bounded. Resend also supports manual replay without a documented maximum age, so a replay after retention can be processed again.

**How to apply:** Keep retention comfortably longer than the automatic retry schedule. If old manual replays must remain deduplicated indefinitely, make event effects safe against replay or retain a compact durable event marker rather than keeping full webhook history forever.
