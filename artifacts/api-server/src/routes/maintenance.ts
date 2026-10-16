import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { getNidorDatabasePool } from "../lib/nidor-database";
import { runOrderReceiptEmailRetryBatch } from "../lib/order-receipt-email-retries";
import { pruneExpiredResendWebhookEvents } from "../lib/resend-receipt-webhook";

type MaintenanceJobs = {
  retryReceipts: () => Promise<number>;
  pruneEvents: () => Promise<number>;
};

function requirePool() {
  const pool = getNidorDatabasePool();
  if (!pool) throw new Error("NIDOR database is not configured.");
  return pool;
}

export function createMaintenanceRouter(
  jobs: MaintenanceJobs = {
    // Keep each serverless invocation small enough to await all work.
    retryReceipts: () => runOrderReceiptEmailRetryBatch(requirePool(), undefined, 2),
    pruneEvents: () => pruneExpiredResendWebhookEvents(requirePool()),
  },
  getSecret: () => string | undefined = () => process.env.CRON_SECRET,
): IRouter {
  const router = Router();
  router.get("/internal/maintenance", async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const secret = getSecret();
    if (!secret || secret.length < 16) {
      res.status(503).json({ error: "Scheduled maintenance is not configured." });
      return;
    }
    const expected = Buffer.from(`Bearer ${secret}`);
    const supplied = Buffer.from(req.get("Authorization") ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    try {
      // Await both tasks before responding; no timers or work after response.
      const prunedEvents = await jobs.pruneEvents();
      const processedRetries = await jobs.retryReceipts();
      res.json({ prunedEvents, processedRetries });
    } catch {
      req.log.warn("Scheduled receipt maintenance failed");
      res.status(503).json({ error: "Scheduled maintenance could not complete." });
    }
  });
  return router;
}

export default createMaintenanceRouter();
