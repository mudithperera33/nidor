import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { logger } from "./logger";
import { getNidorDatabasePool } from "./nidor-database";

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;
const WEBHOOK_EVENT_CLEANUP_BATCH_SIZE = 500;
const WEBHOOK_EVENT_CLEANUP_INTERVAL_MS = 5 * 60_000;

type WebhookEvent = {
  type: "email.bounced" | "email.complained";
  data: { email_id: string };
  created_at?: string;
};

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyResendWebhookSignature(
  rawBody: Buffer,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const id = headers.id;
  const timestamp = headers.timestamp;
  const signature = headers.signature;
  if (!id || !timestamp || !signature || !secret.startsWith("whsec_")) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const signedContent = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`),
    rawBody,
  ]);
  const expected = createHmac("sha256", key).update(signedContent).digest();
  return signature.split(" ").some((candidate) => {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(candidate);
    if (!match) return false;
    return safeEqual(expected, Buffer.from(match[1]!, "base64"));
  });
}

export function parseResendReceiptEvent(value: unknown): WebhookEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type !== "email.bounced" && event.type !== "email.complained") return null;
  if (!event.data || typeof event.data !== "object") return null;
  const emailId = (event.data as Record<string, unknown>).email_id;
  if (typeof emailId !== "string" || emailId.length < 1 || emailId.length > 200) return null;
  return { type: event.type, data: { email_id: emailId } };
}

export async function recordResendReceiptEvent(
  pool: Pick<Pool, "query">,
  eventId: string,
  event: WebhookEvent,
): Promise<"recorded" | "duplicate"> {
  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO public.nidor_receipt_email_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id
     ), updated AS (
       UPDATE public.nidor_order_receipt_email_retries AS retries
        SET status = CASE $2
              WHEN 'email.bounced' THEN 'bounced'
              ELSE 'complained'
            END,
            lease_expires_at = NULL,
            last_error_code = CASE $2
              WHEN 'email.bounced' THEN 'provider_bounced'
              ELSE 'provider_complaint'
            END,
            updated_at = statement_timestamp()
       FROM inserted
      WHERE retries.provider_email_id = $3
       RETURNING retries.order_id
     )
     SELECT EXISTS (SELECT 1 FROM inserted) AS inserted,
            EXISTS (SELECT 1 FROM updated) AS updated`,
    [eventId, event.type, event.data.email_id],
  );
  return (result.rows[0] as { inserted?: boolean } | undefined)?.inserted ? "recorded" : "duplicate";
}

type WebhookEventCleanupQueryable = Pick<Pool, "query">;

export async function pruneExpiredResendWebhookEvents(
  pool: WebhookEventCleanupQueryable,
): Promise<number> {
  const result = await pool.query<{ deleted_count: number }>(
    "SELECT public.nidor_prune_receipt_email_webhook_events($1::int) AS deleted_count",
    [WEBHOOK_EVENT_CLEANUP_BATCH_SIZE],
  );
  const deletedCount = result.rows[0]?.deleted_count;
  if (!Number.isInteger(deletedCount) || deletedCount < 0 || deletedCount > WEBHOOK_EVENT_CLEANUP_BATCH_SIZE) {
    throw new Error("Receipt webhook event cleanup returned an invalid row count.");
  }
  return deletedCount;
}

function safeCleanupErrorCode(error: unknown): string {
  const value = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown";
  return /^[a-z0-9_-]{1,64}$/i.test(value) ? value : "unknown";
}

export function startResendWebhookEventCleanupWorker(
  pool: Pool | null = getNidorDatabasePool(),
): () => void {
  if (!pool) return () => {};

  let running = false;
  const cleanup = async () => {
    if (running) return;
    running = true;
    try {
      const deletedCount = await pruneExpiredResendWebhookEvents(pool);
      if (deletedCount > 0) {
        logger.info({ deletedCount }, "Pruned expired receipt webhook event identifiers");
      }
    } catch (error) {
      logger.warn({ errorCode: safeCleanupErrorCode(error) }, "Receipt webhook event retention cleanup failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void cleanup(), WEBHOOK_EVENT_CLEANUP_INTERVAL_MS);
  timer.unref();
  void cleanup();
  return () => clearInterval(timer);
}
