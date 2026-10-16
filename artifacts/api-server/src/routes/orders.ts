import { Router, type IRouter } from "express";
import { createOrderRateLimiters, type OrderRateLimiters } from "../lib/order-rate-limits";
import {
  CreateOrderBody,
  CreateOrderResponse,
  RecoverOrderReceiptBody,
  RecoverOrderReceiptResponse,
} from "@workspace/api-zod";
import {
  placeNidorOrder,
  recoverNidorOrderReceipt,
  type CreatedOrder,
  type PlaceOrderResult,
  type RecoverOrderReceiptResult,
} from "../lib/order-service";
import { sendOrderReceiptEmail } from "../lib/order-receipt-email";
import {
  markOrderReceiptEmailAccepted,
  recordFailedOrderReceiptEmail,
} from "../lib/order-receipt-email-retries";
import { getNidorDatabasePool } from "../lib/nidor-database";

type OrderPlacer = (input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: string;
  lines: Array<{ variantId: string; quantity: number }>;
}, idempotencyKey: string) => Promise<PlaceOrderResult>;

export type OrderReceiptRecoverer = (input: {
  orderId: string;
  customerEmail: string;
}) => Promise<RecoverOrderReceiptResult>;

export type OrderReceiptMailer = (recipient: string, receipt: CreatedOrder) => Promise<string | null | void>;
export type OrderReceiptRetryRecorder = (orderId: string, errorCode: string) => Promise<void>;
export type OrderReceiptRetryCompleter = (orderId: string, providerEmailId?: string | null) => Promise<void>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rejectionMessages: Record<Extract<PlaceOrderResult, { kind: "rejected" }>["reason"], string> = {
  unavailable: "One or more selected fragrance formats are no longer available. Review your cart.",
  price_unconfigured: "A selected fragrance no longer has a confirmed price. Review your cart.",
  stock_unconfigured: "Stock for a selected fragrance format is being verified. Please try again later.",
  out_of_stock: "A selected fragrance format has sold out. Review your cart.",
  insufficient_stock: "The requested quantity is no longer available. Review your cart and reduce the quantity.",
  idempotency_conflict: "This checkout key was already used for different order details. Start a new checkout attempt.",
};

export function createOrdersRouter(
  orderPlacer: OrderPlacer = placeNidorOrder,
  orderReceiptRecoverer: OrderReceiptRecoverer = recoverNidorOrderReceipt,
  rateLimiters: OrderRateLimiters = createOrderRateLimiters(),
  receiptMailer: OrderReceiptMailer = sendOrderReceiptEmail,
  receiptRetryRecorder: OrderReceiptRetryRecorder = async (orderId, errorCode) =>
    recordFailedOrderReceiptEmail(getNidorDatabasePool(), orderId, errorCode),
  receiptRetryCompleter: OrderReceiptRetryCompleter = async (orderId, providerEmailId) =>
    markOrderReceiptEmailAccepted(getNidorDatabasePool(), orderId, providerEmailId),
): IRouter {
  const router: IRouter = Router();

  router.post("/orders/recover", rateLimiters.recoverReceipt, async (req, res): Promise<void> => {
    const parsed = RecoverOrderReceiptBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ issueCount: parsed.error.issues.length }, "Rejected invalid order receipt lookup");
      res.status(400).json({ error: "Enter a valid order reference and checkout email." });
      return;
    }

    try {
      const result = await orderReceiptRecoverer({
        orderId: parsed.data.orderId.toLowerCase(),
        customerEmail: parsed.data.customerEmail.trim().toLowerCase(),
      });
      if (result.kind === "storage_unavailable") {
        res.status(503).json({ error: "Saved orders are temporarily unavailable. Please try again." });
        return;
      }
      if (result.kind === "not_found") {
        res.status(404).json({ error: "No saved order matched those details." });
        return;
      }

      res.json(RecoverOrderReceiptResponse.parse(result.receipt));
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown";
      req.log.error({ errorCode }, "Could not recover the saved order receipt");
      res.status(503).json({ error: "Unable to recover your saved order right now. Please try again." });
    }
  });

  router.post("/orders", rateLimiters.createOrder, async (req, res): Promise<void> => {
    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
      res.status(400).json({ error: "A valid Idempotency-Key UUID is required." });
      return;
    }

    const parsed = CreateOrderBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ issueCount: parsed.error.issues.length }, "Rejected invalid order submission");
      res.status(400).json({ error: "Enter valid contact, delivery, and order details." });
      return;
    }
    if (new Set(parsed.data.lines.map((line) => line.variantId.toLowerCase())).size !== parsed.data.lines.length) {
      res.status(400).json({ error: "Include each fragrance format only once." });
      return;
    }

    const normalizedInput = {
      ...parsed.data,
      customerName: parsed.data.customerName.trim(),
      customerEmail: parsed.data.customerEmail.trim().toLowerCase(),
      customerPhone: parsed.data.customerPhone.trim(),
      deliveryAddress: parsed.data.deliveryAddress.trim(),
    };
    if (
      normalizedInput.customerName.length < 2
      || normalizedInput.customerPhone.length < 7
      || normalizedInput.deliveryAddress.length < 8
    ) {
      res.status(400).json({ error: "Enter a valid name, phone number, and delivery address." });
      return;
    }

    try {
      const result = await orderPlacer(normalizedInput, idempotencyKey.toLowerCase());
      if (result.kind === "storage_unavailable") {
        res.status(503).json({ error: "Orders are temporarily unavailable. Please try again." });
        return;
      }
      if (result.kind === "rejected") {
        res.status(409).json({ error: rejectionMessages[result.reason] });
        return;
      }

      let receiptEmailStatus: "accepted" | "failed" = "accepted";
      try {
        // Both created and replayed results identify an order already committed
        // by the order service. Resend's order-specific key prevents duplicate
        // messages if checkout is retried after a network interruption.
        const sentEmailId = await receiptMailer(normalizedInput.customerEmail, result.order);
        const providerEmailId = typeof sentEmailId === "string" ? sentEmailId : null;
        try {
          await receiptRetryCompleter(result.order.orderId, providerEmailId);
        } catch (error) {
          const errorCode = error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "unknown";
          req.log.warn({ orderId: result.order.orderId, errorCode }, "Could not update receipt email retry status");
        }
      } catch (error) {
        receiptEmailStatus = "failed";
        const status = error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : undefined;
        const code = error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown";
        try {
          await receiptRetryRecorder(result.order.orderId, code);
        } catch (queueError) {
          const queueErrorCode = queueError && typeof queueError === "object" && "code" in queueError
            ? String(queueError.code)
            : "unknown";
          req.log.error(
            { orderId: result.order.orderId, errorCode: queueErrorCode },
            "Could not queue receipt email retry",
          );
        }
        req.log.warn(
          {
            orderId: result.order.orderId,
            emailErrorCode: code,
            ...(status ? { emailStatus: status } : {}),
          },
          "Could not send the saved order receipt email",
        );
      }

      res.status(result.kind === "replayed" ? 200 : 201).json(
        CreateOrderResponse.parse({ ...result.order, receiptEmailStatus }),
      );
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown";
      req.log.error({ errorCode }, "Could not save the order");
      res.status(503).json({ error: "Unable to save your order right now. Your cart has not been placed." });
    }
  });

  return router;
}

export default createOrdersRouter();
