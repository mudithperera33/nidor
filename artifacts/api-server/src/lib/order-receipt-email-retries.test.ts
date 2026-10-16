import assert from "node:assert/strict";
import type { Pool } from "pg";
import { test } from "node:test";
import {
  recordFailedOrderReceiptEmail,
  runOrderReceiptEmailRetryBatch,
} from "./order-receipt-email-retries";
import { getOrderReceiptEmailIdempotencyKey } from "./order-receipt-email";

const orderId = "d6e0d9cc-9236-4993-a144-c2815a11d335";
const variantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";

const emailRows = [{
  order_id: orderId,
  customer_email: "customer@example.com",
  subtotal_lkr: "2501.00",
  variant_id: variantId,
  product_name: "Quiet Garden",
  brand: "NIDOR",
  variant_type: "decant" as const,
  size_ml: 5,
  quantity: 2,
  unit_price_lkr: "1250.50",
  line_total_lkr: "2501.00",
}];

function createPool(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  return {
    async query(sql: string, params?: unknown[]) {
      return query(sql, params);
    },
  } as unknown as Pool;
}

test("failed receipt queue stores one retry per order without storing provider details", async () => {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = createPool(async (sql, params) => {
    statements.push({ sql, params });
    return { rows: [], rowCount: 1 };
  });

  await recordFailedOrderReceiptEmail(pool, orderId, "resend_rejected");

  assert.equal(statements.length, 1);
  assert.match(statements[0]!.sql, /INSERT INTO public\.nidor_order_receipt_email_retries/);
  assert.match(statements[0]!.sql, /ON CONFLICT \(order_id\) DO NOTHING/);
  assert.deepEqual(statements[0]!.params, [orderId, "resend_rejected"]);
});

test("retry claims a job, sends the saved receipt, and marks acceptance without touching orders or stock", async () => {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = createPool(async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes("FOR UPDATE SKIP LOCKED")) {
      return { rows: [{ order_id: orderId, attempt_count: 2 }], rowCount: 1 };
    }
    if (sql.includes("FROM public.nidor_orders AS o")) {
      return { rows: emailRows, rowCount: 1 };
    }
    if (sql.includes("AS still_owned")) {
      return { rows: [{ still_owned: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  let sent: { recipient: string; receiptOrderId: string } | undefined;

  const processed = await runOrderReceiptEmailRetryBatch(pool, async (recipient, receipt) => {
    sent = { recipient, receiptOrderId: receipt.orderId };
  });

  assert.equal(processed, 1);
  assert.deepEqual(sent, { recipient: "customer@example.com", receiptOrderId: orderId });
  assert.ok(statements.some(({ sql }) => sql.includes("VALUES ($1::uuid, 'accepted', 1, $2")));
  assert.ok(statements.every(({ sql }) => !/INSERT INTO public\.nidor_orders|UPDATE public\.product_variants/i.test(sql)));
  assert.equal(getOrderReceiptEmailIdempotencyKey(orderId), `nidor-order-receipt-${orderId}`);
});

test("failed fifth attempt is exhausted and cannot be claimed again", async () => {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = createPool(async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes("FOR UPDATE SKIP LOCKED")) {
      return { rows: [{ order_id: orderId, attempt_count: 5 }], rowCount: 1 };
    }
    if (sql.includes("FROM public.nidor_orders AS o")) {
      return { rows: emailRows, rowCount: 1 };
    }
    if (sql.includes("AS still_owned")) {
      return { rows: [{ still_owned: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });

  await runOrderReceiptEmailRetryBatch(pool, async () => {
    throw Object.assign(new Error("provider details must not be persisted"), { code: "resend_rejected" });
  });

  const failureUpdate = statements.find(({ sql }) => sql.includes("status = $2"));
  assert.deepEqual(failureUpdate?.params, [orderId, "exhausted", 60, "resend_rejected"]);
  assert.doesNotMatch(JSON.stringify(failureUpdate), /provider details must not be persisted/);
});

test("a bounce after a retry is claimed prevents the queued send from starting", async () => {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let status = "pending";
  const pool = createPool(async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes("FOR UPDATE SKIP LOCKED")) {
      status = "sending";
      return { rows: [{ order_id: orderId, attempt_count: 2 }], rowCount: 1 };
    }
    if (sql.includes("FROM public.nidor_orders AS o")) {
      // Simulate the signed webhook updating the claimed row while its receipt loads.
      status = "bounced";
      return { rows: emailRows, rowCount: 1 };
    }
    if (sql.includes("AS still_owned")) {
      return { rows: [{ still_owned: status === "sending" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  let sendCount = 0;

  await runOrderReceiptEmailRetryBatch(pool, async () => {
    sendCount += 1;
  });

  assert.equal(sendCount, 0);
  assert.equal(status, "bounced");
  assert.ok(statements.some(({ sql }) => sql.includes("status = 'sending'") && sql.includes("AS still_owned")));
  assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO public.nidor_order_receipt_email_retries")), false);
});

for (const deliveryStatus of ["bounced", "complained"]) {
test(`a stale successful worker cannot overwrite ${deliveryStatus} metadata received during send`, async () => {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let status = "pending";
  const pool = createPool(async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes("FOR UPDATE SKIP LOCKED")) {
      status = "sending";
      return { rows: [{ order_id: orderId, attempt_count: 2 }], rowCount: 1 };
    }
    if (sql.includes("FROM public.nidor_orders AS o")) return { rows: emailRows, rowCount: 1 };
    if (sql.includes("AS still_owned")) {
      return { rows: [{ still_owned: status === "sending" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO public.nidor_order_receipt_email_retries")) {
      assert.equal(status, deliveryStatus);
      // PostgreSQL evaluates this WHERE against the current row when resolving
      // the conflict, so even a stale successful sender cannot update metadata.
      assert.match(sql, /WHERE nidor_order_receipt_email_retries\.status NOT IN \('bounced', 'complained'\)/);
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  });

  await runOrderReceiptEmailRetryBatch(pool, async () => {
    // A webhook commits while the external send is already in flight.
    status = deliveryStatus;
    return "provider-email-123";
  });

  assert.equal(status, deliveryStatus);
  assert.ok(statements.some(({ sql }) => sql.includes("AS still_owned")));
});
}
