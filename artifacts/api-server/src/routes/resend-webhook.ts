import { Router, type IRouter } from "express";
import { getNidorDatabasePool } from "../lib/nidor-database";
import {
  parseResendReceiptEvent,
  recordResendReceiptEvent,
  verifyResendWebhookSignature,
} from "../lib/resend-receipt-webhook";

export function createResendWebhookRouter(
  secret = process.env.RESEND_WEBHOOK_SECRET,
  pool = getNidorDatabasePool(),
): IRouter {
  const router: IRouter = Router();
  router.post("/", async (req, res): Promise<void> => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    const eventId = req.get("svix-id");
    if (
      !secret
      || !rawBody
      || !verifyResendWebhookSignature(rawBody, {
        id: eventId,
        timestamp: req.get("svix-timestamp"),
        signature: req.get("svix-signature"),
      }, secret)
    ) {
      res.status(401).json({ error: "Invalid webhook signature." });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid webhook event." });
      return;
    }
    const event = parseResendReceiptEvent(payload);
    if (!event) {
      res.status(200).json({ received: true });
      return;
    }
    if (!eventId || !/^[\x21-\x7e]{1,200}$/.test(eventId)) {
      res.status(400).json({ error: "Invalid webhook event." });
      return;
    }
    if (!pool) {
      res.status(503).json({ error: "Webhook storage is unavailable." });
      return;
    }
    try {
      const result = await recordResendReceiptEvent(pool, eventId, event);
      res.status(200).json({ received: true, duplicate: result === "duplicate" });
    } catch {
      // Do not log provider headers, payloads, or customer data.
      req.log.error("Could not record receipt delivery event");
      res.status(503).json({ error: "Webhook event could not be recorded." });
    }
  });
  return router;
}

export default createResendWebhookRouter();
