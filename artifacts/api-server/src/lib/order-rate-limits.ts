import { rateLimit } from "express-rate-limit";
import type { Store } from "express-rate-limit";
import type { RequestHandler } from "express";
import { getNidorDatabasePool } from "./nidor-database";
import { PostgresRateLimitStore } from "./postgres-rate-limit-store";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_ORDER_LIMIT = 10;
const DEFAULT_RECEIPT_RECOVERY_LIMIT = 5;

export type OrderRateLimiters = {
  createOrder: RequestHandler;
  recoverReceipt: RequestHandler;
};

export type OrderRateLimitConfig = {
  windowMs?: number;
  createOrderLimit?: number;
  receiptRecoveryLimit?: number;
};

export type OrderRateLimitStoreFactory = (namespace: string, windowMs: number) => Store;

/**
 * Use PostgreSQL so limits are shared across API processes and replicas. The
 * default express-rate-limit key generator uses Express's req.ip; app.ts keeps
 * proxy trust disabled, so this remains the direct socket address until the
 * deployed proxy path has been verified.
 */
export function createOrderRateLimiters(
  config: OrderRateLimitConfig = {},
  storeFactory: OrderRateLimitStoreFactory = (namespace, windowMs) =>
    new PostgresRateLimitStore(getNidorDatabasePool(), namespace, windowMs),
): OrderRateLimiters {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const createOrderLimit = config.createOrderLimit ?? DEFAULT_ORDER_LIMIT;
  const receiptRecoveryLimit = config.receiptRecoveryLimit ?? DEFAULT_RECEIPT_RECOVERY_LIMIT;

  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate-limit window must be a positive integer.");
  }
  if (!Number.isInteger(createOrderLimit) || createOrderLimit < 1) {
    throw new Error("Order rate limit must be a positive integer.");
  }
  if (!Number.isInteger(receiptRecoveryLimit) || receiptRecoveryLimit < 1) {
    throw new Error("Receipt recovery rate limit must be a positive integer.");
  }

  return {
    createOrder: rateLimit({
      windowMs,
      limit: createOrderLimit,
      store: storeFactory("create-order", windowMs),
      passOnStoreError: false,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res): void => {
        res.status(429).json({ error: "Too many order attempts. Please wait before trying again." });
      },
    }),
    recoverReceipt: rateLimit({
      windowMs,
      limit: receiptRecoveryLimit,
      store: storeFactory("recover-receipt", windowMs),
      passOnStoreError: false,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res): void => {
        res.status(429).json({ error: "Too many receipt lookups. Please wait before trying again." });
      },
    }),
  };
}
