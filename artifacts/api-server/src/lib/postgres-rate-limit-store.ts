import { createHash } from "node:crypto";
import type { Store } from "express-rate-limit";
import type { Pool } from "pg";

const PRUNE_INTERVAL_MS = 60_000;
const PRUNE_BATCH_SIZE = 1_000;

type CounterRow = {
  total_hits: number;
  reset_time: Date;
};

/**
 * A fixed-window express-rate-limit store backed by PostgreSQL.
 *
 * Counters are shared by all API processes using the same database. The
 * database row expires at the end of the window, so process restarts do not
 * reset an active quota. Expired rows are removed opportunistically.
 */
export class PostgresRateLimitStore implements Store {
  readonly prefix: string;
  readonly localKeys = false;

  private lastPruneAt = 0;
  private prunePromise: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool | null,
    namespace: string,
    private readonly windowMs: number,
  ) {
    this.prefix = `nidor:${namespace}`;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const pool = this.requirePool();
    await this.pruneExpired(pool);

    const clientKeyHash = createHash("sha256").update(key).digest("hex");
    const result = await pool.query<CounterRow>(
      `WITH clock AS MATERIALIZED (
         SELECT statement_timestamp() AS window_started_at
       )
       INSERT INTO public.nidor_order_rate_limit_counters (
         scope, client_key_hash, total_hits, expires_at
       )
       SELECT $1, $2, 1,
               clock.window_started_at + ($3::bigint * INTERVAL '1 millisecond')
         FROM clock
       ON CONFLICT (scope, client_key_hash) DO UPDATE
         SET total_hits = CASE
               WHEN nidor_order_rate_limit_counters.expires_at
                    <= (SELECT window_started_at FROM clock)
                 THEN 1
               ELSE nidor_order_rate_limit_counters.total_hits + 1
             END,
             expires_at = CASE
               WHEN nidor_order_rate_limit_counters.expires_at
                    <= (SELECT window_started_at FROM clock)
                  THEN (SELECT window_started_at FROM clock)
                      + ($3::bigint * INTERVAL '1 millisecond')
               ELSE nidor_order_rate_limit_counters.expires_at
             END
       RETURNING total_hits, expires_at AS reset_time`,
      [this.prefix, clientKeyHash, this.windowMs],
    );

    const counter = result.rows[0];
    if (!counter) {
      throw new Error("PostgreSQL did not return the updated rate-limit counter.");
    }
    return { totalHits: counter.total_hits, resetTime: counter.reset_time };
  }

  async decrement(key: string): Promise<void> {
    const clientKeyHash = createHash("sha256").update(key).digest("hex");
    await this.requirePool().query(
      `UPDATE public.nidor_order_rate_limit_counters
          SET total_hits = GREATEST(total_hits - 1, 0)
        WHERE scope = $1 AND client_key_hash = $2`,
      [this.prefix, clientKeyHash],
    );
  }

  async resetKey(key: string): Promise<void> {
    const clientKeyHash = createHash("sha256").update(key).digest("hex");
    await this.requirePool().query(
      `DELETE FROM public.nidor_order_rate_limit_counters
        WHERE scope = $1 AND client_key_hash = $2`,
      [this.prefix, clientKeyHash],
    );
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error("Shared order rate limits require SUPABASE_DB_URL.");
    }
    return this.pool;
  }

  private async pruneExpired(pool: Pool): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    if (this.prunePromise) return this.prunePromise;

    this.lastPruneAt = now;
    this.prunePromise = pool.query(
      `WITH expired AS (
         SELECT ctid
           FROM public.nidor_order_rate_limit_counters
          WHERE expires_at <= statement_timestamp()
          ORDER BY expires_at
          LIMIT $1
       )
       DELETE FROM public.nidor_order_rate_limit_counters AS counters
        USING expired
        WHERE counters.ctid = expired.ctid`,
      [PRUNE_BATCH_SIZE],
    ).then(() => undefined).catch((error: unknown) => {
      this.lastPruneAt = 0;
      throw error;
    }).finally(() => {
      this.prunePromise = undefined;
    });
    return this.prunePromise;
  }
}
