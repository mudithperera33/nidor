import type { Pool } from "pg";
import { logger } from "./logger";
import { getNidorDatabasePool } from "./nidor-database";
import { sendOrderReceiptEmail } from "./order-receipt-email";
import type { CreatedOrder } from "./order-service";

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MINUTES = [1, 5, 15, 60] as const;
const CLAIM_BATCH_SIZE = 10;
const LEASE_MINUTES = 5;
const POLL_INTERVAL_MS = 30_000;

type Queryable = Pick<Pool, "query">;
type FailedJob = { order_id: string; attempt_count: number };
type ReceiptEmailRow = {
  order_id: string;
  customer_email: string;
  subtotal_lkr: string;
  variant_id: string;
  product_name: string;
  brand: string;
  variant_type: "decant" | "full_bottle";
  size_ml: number;
  quantity: number;
  unit_price_lkr: string;
  line_total_lkr: string;
};
type ReceiptEmailSender = (recipient: string, receipt: CreatedOrder) => Promise<string | null | void>;

function safeErrorCode(error: unknown): string {
  const value = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown";
  return /^[a-z0-9_-]{1,64}$/i.test(value) ? value : "unknown";
}

export async function recordFailedOrderReceiptEmail(
  pool: Queryable | null,
  orderId: string,
  errorCode: string,
): Promise<void> {
  if (!pool) throw new Error("Receipt email retry storage is unavailable.");
  const normalizedCode = /^[a-z0-9_-]{1,64}$/i.test(errorCode) ? errorCode : "unknown";
  await pool.query(
    `INSERT INTO public.nidor_order_receipt_email_retries (
       order_id, status, attempt_count, next_attempt_at, last_attempt_at, last_error_code
     )
     VALUES ($1::uuid, 'pending', 1, statement_timestamp() + INTERVAL '1 minute',
             statement_timestamp(), $2)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, normalizedCode],
  );
}

export async function markOrderReceiptEmailAccepted(
  pool: Queryable | null,
  orderId: string,
  providerEmailId?: string | null,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO public.nidor_order_receipt_email_retries (
       order_id, status, attempt_count, provider_email_id, accepted_at
     )
     VALUES ($1::uuid, 'accepted', 1, $2, statement_timestamp())
     ON CONFLICT (order_id) DO UPDATE
       SET status = 'accepted',
           provider_email_id = COALESCE(EXCLUDED.provider_email_id, nidor_order_receipt_email_retries.provider_email_id),
           accepted_at = statement_timestamp(),
           lease_expires_at = NULL,
           last_error_code = NULL,
           updated_at = statement_timestamp()
       WHERE nidor_order_receipt_email_retries.status NOT IN ('bounced', 'complained')`,
    [orderId, providerEmailId ?? null],
  );
}

async function claimDueJobs(pool: Queryable, batchSize: number): Promise<FailedJob[]> {
  const result = await pool.query<FailedJob>(
    `WITH due AS MATERIALIZED (
       SELECT order_id
         FROM public.nidor_order_receipt_email_retries
        WHERE attempt_count < $1
          AND (
            (status = 'pending' AND next_attempt_at <= statement_timestamp())
            OR (status = 'sending' AND lease_expires_at <= statement_timestamp())
          )
        ORDER BY next_attempt_at, order_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     )
     UPDATE public.nidor_order_receipt_email_retries AS jobs
        SET status = 'sending',
            attempt_count = jobs.attempt_count + 1,
            last_attempt_at = statement_timestamp(),
            lease_expires_at = statement_timestamp() + ($3::int * INTERVAL '1 minute'),
            updated_at = statement_timestamp()
       FROM due
      WHERE jobs.order_id = due.order_id
     RETURNING jobs.order_id::text, jobs.attempt_count`,
    [MAX_ATTEMPTS, batchSize, LEASE_MINUTES],
  );
  return result.rows;
}

async function loadReceiptEmailRows(pool: Queryable, orderId: string): Promise<ReceiptEmailRow[]> {
  const result = await pool.query<ReceiptEmailRow>(
    `SELECT
       o.id::text AS order_id,
       o.customer_email,
       o.subtotal_lkr::text,
       i.variant_id::text AS variant_id,
       i.product_name_snapshot AS product_name,
       i.brand_snapshot AS brand,
       i.variant_type_snapshot AS variant_type,
       i.size_ml_snapshot AS size_ml,
       i.quantity,
       i.unit_price_lkr::text,
       i.line_total_lkr::text
     FROM public.nidor_orders AS o
     JOIN public.nidor_order_items AS i ON i.order_id = o.id
     WHERE o.id = $1::uuid
     ORDER BY i.created_at, i.id`,
    [orderId],
  );
  return result.rows;
}

async function stillOwnsReceiptRetry(pool: Queryable, job: FailedJob): Promise<boolean> {
  const result = await pool.query<{ still_owned: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM public.nidor_order_receipt_email_retries
        WHERE order_id = $1::uuid
          AND status = 'sending'
          AND attempt_count = $2
          AND lease_expires_at > statement_timestamp()
     ) AS still_owned`,
    [job.order_id, job.attempt_count],
  );
  return result.rows[0]?.still_owned === true;
}

function buildCreatedOrder(rows: ReceiptEmailRow[]): { recipient: string; receipt: CreatedOrder } | null {
  const first = rows[0];
  if (!first) return null;
  if (rows.some((row) => row.order_id !== first.order_id || row.customer_email !== first.customer_email)) {
    throw new Error("Receipt email rows do not belong to one saved order.");
  }
  return {
    recipient: first.customer_email,
    receipt: {
      orderId: first.order_id,
      status: "pending_payment",
      subtotalLkr: Number(first.subtotal_lkr),
      lines: rows.map((row) => ({
        variantId: row.variant_id,
        productName: row.product_name,
        brand: row.brand,
        variantType: row.variant_type,
        sizeMl: row.size_ml,
        quantity: row.quantity,
        unitPriceLkr: Number(row.unit_price_lkr),
        lineTotalLkr: Number(row.line_total_lkr),
      })),
    },
  };
}

async function recordRetryOutcome(
  pool: Queryable,
  job: FailedJob,
  outcome: { accepted: true } | { accepted: false; errorCode: string },
): Promise<void> {
  if (outcome.accepted) {
    await markOrderReceiptEmailAccepted(pool, job.order_id);
    return;
  }
  const exhausted = job.attempt_count >= MAX_ATTEMPTS;
  const delayMinutes = RETRY_DELAY_MINUTES[job.attempt_count - 1] ?? RETRY_DELAY_MINUTES.at(-1)!;
  await pool.query(
    `UPDATE public.nidor_order_receipt_email_retries
        SET status = $2,
            next_attempt_at = CASE
              WHEN $2 = 'pending'
                THEN statement_timestamp() + ($3::int * INTERVAL '1 minute')
              ELSE next_attempt_at
            END,
            lease_expires_at = NULL,
            last_error_code = $4,
            updated_at = statement_timestamp()
      WHERE order_id = $1::uuid
        AND status = 'sending'`,
    [job.order_id, exhausted ? "exhausted" : "pending", delayMinutes, outcome.errorCode],
  );
}

export async function runOrderReceiptEmailRetryBatch(
  pool: Queryable,
  send: ReceiptEmailSender = sendOrderReceiptEmail,
  batchSize = CLAIM_BATCH_SIZE,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > CLAIM_BATCH_SIZE) {
    throw new Error("Receipt retry batch size must be between 1 and 10.");
  }
  await pool.query(
    `UPDATE public.nidor_order_receipt_email_retries
        SET status = 'exhausted',
            lease_expires_at = NULL,
            updated_at = statement_timestamp()
      WHERE status = 'sending'
        AND attempt_count >= $1
        AND lease_expires_at <= statement_timestamp()`,
    [MAX_ATTEMPTS],
  );

  const jobs = await claimDueJobs(pool, batchSize);
  for (const job of jobs) {
    try {
      const saved = buildCreatedOrder(await loadReceiptEmailRows(pool, job.order_id));
      if (!saved) throw Object.assign(new Error("Saved receipt is missing."), { code: "receipt_not_found" });
      // A verified bounce/complaint may have changed the row after it was claimed
      // and while the saved receipt was being loaded. Do not send from a stale claim.
      if (!await stillOwnsReceiptRetry(pool, job)) continue;
      const sentEmailId = await send(saved.recipient, saved.receipt);
      const providerEmailId = typeof sentEmailId === "string" ? sentEmailId : null;
      await markOrderReceiptEmailAccepted(pool, job.order_id, providerEmailId);
    } catch (error) {
      const errorCode = safeErrorCode(error);
      logger.warn({ orderId: job.order_id, attempt: job.attempt_count, errorCode }, "Receipt email retry failed");
      await recordRetryOutcome(pool, job, { accepted: false, errorCode });
    }
  }
  return jobs.length;
}

export function startOrderReceiptEmailRetryWorker(
  pool: Pool | null = getNidorDatabasePool(),
  send: ReceiptEmailSender = sendOrderReceiptEmail,
): () => void {
  if (!pool) {
    logger.warn("Receipt email retry worker is disabled because the NIDOR database is unavailable");
    return () => {};
  }

  let running = false;
  let lastUnavailableLogAt = 0;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const availability = await pool.query<{ available: boolean }>(
        "SELECT to_regclass('public.nidor_order_receipt_email_retries') IS NOT NULL AS available",
      );
      if (!availability.rows[0]?.available) {
        if (Date.now() - lastUnavailableLogAt > 5 * 60_000) {
          logger.warn("Receipt email retry worker is waiting for its database migration");
          lastUnavailableLogAt = Date.now();
        }
        return;
      }
      const processed = await runOrderReceiptEmailRetryBatch(pool, send);
      if (processed > 0) logger.info({ processed }, "Processed receipt email retry batch");
    } catch (error) {
      logger.warn({ errorCode: safeErrorCode(error) }, "Receipt email retry batch could not run");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  timer.unref();
  void poll();
  return () => clearInterval(timer);
}
