import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { test } from "node:test";
import {
  createOrderReceiptRecovery,
  createOrderService,
  type OrderSubmission,
} from "./order-service";

const variantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";
const orderId = "d6e0d9cc-9236-4993-a144-c2815a11d335";
const idempotencyKey = "36b8f84d-df4e-4d49-b662-bcde71a8764f";

function createFakePool(options: {
  stockAtLock?: number;
  updateRowCount?: number;
  existingOrder?: boolean;
  existingFingerprint?: string;
  recoveryMatches?: boolean;
} = {}) {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let insertCount = 0;
  const lockedRow = {
    variant_id: variantId,
    product_name: "Quiet Garden",
    brand: "NIDOR",
    product_is_active: true,
    variant_is_active: true,
    variant_type: "full_bottle",
    size_ml: 50,
    price_lkr: "14500.25",
    price_needs_configuration: false,
    stock_quantity: options.stockAtLock ?? 3,
    stock_needs_configuration: false,
  };
  const client = {
    async query(sql: string, params?: unknown[]) {
      statements.push({ sql, params });
      if (sql.includes("FROM public.nidor_orders AS o")) {
        if (sql.includes("lower(o.customer_email)")) {
          return {
            rows: options.recoveryMatches ? [{
              order_id: orderId,
              request_fingerprint: "private-fingerprint",
              subtotal_lkr: "29000.50",
              variant_id: variantId,
              product_name: "Quiet Garden",
              brand: "NIDOR",
              variant_type: "full_bottle",
              size_ml: 50,
              quantity: 2,
              unit_price_lkr: "14500.25",
              line_total_lkr: "29000.50",
            }] : [],
            rowCount: options.recoveryMatches ? 1 : 0,
          };
        }
        return {
          rows: options.existingOrder ? [{
            order_id: orderId,
            request_fingerprint: options.existingFingerprint,
            subtotal_lkr: "29000.50",
            variant_id: variantId,
            product_name: "Quiet Garden",
            brand: "NIDOR",
            variant_type: "full_bottle",
            size_ml: 50,
            quantity: 2,
            unit_price_lkr: "14500.25",
            line_total_lkr: "29000.50",
          }] : [],
          rowCount: options.existingOrder ? 1 : 0,
        };
      }
      if (sql.includes("SELECT") && sql.includes("FOR UPDATE OF v, p")) {
        return { rows: [lockedRow], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO public.nidor_orders")) {
        insertCount += 1;
        return {
          rows: [{
            order_id: insertCount === 1 ? orderId : "8f4ba622-4eec-4e9b-9e7c-2c36fb218ce9",
            subtotal_lkr: "29000.50",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE public.product_variants")) {
        return { rows: [], rowCount: options.updateRowCount ?? 1 };
      }
      if (sql.includes("INSERT INTO public.nidor_order_items")) {
        return {
          rows: [{
            variant_id: variantId,
            product_name: "Quiet Garden",
            brand: "NIDOR",
            variant_type: "full_bottle",
            size_ml: 50,
            quantity: 2,
            unit_price_lkr: "14500.25",
            line_total_lkr: "29000.50",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: null };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, statements };
}

const orderInput: OrderSubmission = {
  customerName: "A. Customer",
  customerEmail: "customer@example.com",
  customerPhone: "+94 77 123 4567",
  deliveryAddress: "12 Flower Road, Colombo",
  lines: [{ variantId, quantity: 2 }],
};

const matchingFingerprint = createHash("sha256").update(JSON.stringify({
  customerName: "A. Customer",
  customerEmail: "customer@example.com",
  customerPhone: "+94 77 123 4567",
  deliveryAddress: "12 Flower Road, Colombo",
  lines: [{ variantId, quantity: 2 }],
})).digest("hex");

test("order transaction locks the selected variant and records its database price", async () => {
  const { pool, statements } = createFakePool();
  const placeOrder = createOrderService(() => pool);

  const result = await placeOrder(orderInput, idempotencyKey);

  assert.equal(result.kind, "created");
  if (result.kind !== "created") return;
  assert.equal(result.order.status, "pending_payment");
  assert.equal(result.order.subtotalLkr, 29000.5);
  assert.equal(result.order.lines[0].unitPriceLkr, 14500.25);
  assert.ok(statements.some(({ sql }) => sql.includes("FOR UPDATE OF v, p")));
  assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
  assert.ok(!statements.some(({ sql }) => sql === "ROLLBACK"));
  const insert = statements.find(({ sql }) => sql.includes("INSERT INTO public.nidor_orders"));
  assert.equal(insert?.params?.[5], idempotencyKey);
  assert.match(String(insert?.params?.[6]), /^[0-9a-f]{64}$/);
});

test("order transaction rolls back the order if stock cannot be deducted", async () => {
  const { pool, statements } = createFakePool({ updateRowCount: 0 });
  const placeOrder = createOrderService(() => pool);

  const result = await placeOrder(orderInput, idempotencyKey);

  assert.deepEqual(result, { kind: "rejected", reason: "insufficient_stock" });
  assert.ok(statements.some(({ sql }) => sql === "ROLLBACK"));
  assert.ok(!statements.some(({ sql }) => sql === "COMMIT"));
});

test("order transaction rejects quantities above locked stock before writing", async () => {
  const { pool, statements } = createFakePool({ stockAtLock: 1 });
  const placeOrder = createOrderService(() => pool);

  const result = await placeOrder(orderInput, idempotencyKey);

  assert.deepEqual(result, { kind: "rejected", reason: "insufficient_stock" });
  assert.ok(statements.some(({ sql }) => sql === "ROLLBACK"));
  assert.ok(!statements.some(({ sql }) => sql.includes("INSERT INTO public.nidor_orders")));
});

test("retrying a saved idempotency key returns its receipt without reserving stock", async () => {
  const { pool, statements } = createFakePool({
    existingOrder: true,
    existingFingerprint: matchingFingerprint,
  });
  const placeOrder = createOrderService(() => pool);

  const result = await placeOrder(orderInput, idempotencyKey);

  assert.equal(result.kind, "replayed");
  if (result.kind !== "replayed") return;
  assert.equal(result.order.orderId, orderId);
  assert.equal(result.order.subtotalLkr, 29000.5);
  assert.deepEqual(result.order.lines, [{
    variantId,
    productName: "Quiet Garden",
    brand: "NIDOR",
    variantType: "full_bottle",
    sizeMl: 50,
    quantity: 2,
    unitPriceLkr: 14500.25,
    lineTotalLkr: 29000.5,
  }]);
  assert.ok(!statements.some(({ sql }) => sql.includes("FOR UPDATE OF v, p")));
  assert.ok(!statements.some(({ sql }) => sql.includes("UPDATE public.product_variants")));
  assert.ok(!statements.some(({ sql }) => sql.includes("INSERT INTO public.nidor_orders")));
  assert.ok(statements.some(({ sql }) => sql === "ROLLBACK"));
});

test("reusing a saved key for changed checkout details is rejected", async () => {
  const { pool, statements } = createFakePool({
    existingOrder: true,
    existingFingerprint: "different-checkout-fingerprint",
  });
  const placeOrder = createOrderService(() => pool);

  const result = await placeOrder(orderInput, idempotencyKey);

  assert.deepEqual(result, { kind: "rejected", reason: "idempotency_conflict" });
  assert.ok(!statements.some(({ sql }) => sql.includes("FOR UPDATE OF v, p")));
  assert.ok(!statements.some(({ sql }) => sql.includes("UPDATE public.product_variants")));
});

test("a different checkout key is persisted independently", async () => {
  const { pool, statements } = createFakePool();
  const placeOrder = createOrderService(() => pool);

  const first = await placeOrder(orderInput, idempotencyKey);
  const secondKey = "b5e8e7d3-05c4-49fb-8993-2ce35a1f72e1";
  const second = await placeOrder(orderInput, secondKey);

  assert.equal(first.kind, "created");
  assert.equal(second.kind, "created");
  if (first.kind !== "created" || second.kind !== "created") return;
  assert.notEqual(first.order.orderId, second.order.orderId);
  const insertedKeys = statements
    .filter(({ sql }) => sql.includes("INSERT INTO public.nidor_orders"))
    .map(({ params }) => params?.[5]);
  assert.deepEqual(insertedKeys, [idempotencyKey, secondKey]);
});

test("receipt recovery matches both the order UUID and normalized checkout email", async () => {
  const { pool, statements } = createFakePool({ recoveryMatches: true });
  const recoverReceipt = createOrderReceiptRecovery(() => pool);

  const result = await recoverReceipt({
    orderId: orderId.toUpperCase(),
    customerEmail: " Customer@Example.com ",
  });

  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.deepEqual(result.receipt, {
    orderId,
    status: "pending_payment",
    subtotalLkr: 29000.5,
    lines: [{
      variantId,
      productName: "Quiet Garden",
      brand: "NIDOR",
      variantType: "full_bottle",
      sizeMl: 50,
      quantity: 2,
      unitPriceLkr: 14500.25,
      lineTotalLkr: 29000.5,
    }],
  });
  assert.match(statements[0].sql, /o\.id = \$1::uuid/);
  assert.match(statements[0].sql, /lower\(o\.customer_email\) = \$2/);
  assert.deepEqual(statements[0].params, [orderId, "customer@example.com"]);
  assert.ok(!("customerEmail" in result.receipt));
  assert.ok(!("deliveryAddress" in result.receipt));
});

test("receipt recovery returns not found when order and email do not match", async () => {
  const { pool } = createFakePool({ recoveryMatches: false });
  const recoverReceipt = createOrderReceiptRecovery(() => pool);

  const result = await recoverReceipt({
    orderId,
    customerEmail: "another@example.com",
  });

  assert.deepEqual(result, { kind: "not_found" });
});
