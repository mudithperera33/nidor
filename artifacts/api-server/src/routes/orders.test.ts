import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import { test } from "node:test";
import { createOrderRateLimiters } from "../lib/order-rate-limits";
import { buildOrderReceiptEmail } from "../lib/order-receipt-email";
import {
  createOrdersRouter,
  type OrderReceiptMailer,
  type OrderReceiptRecoverer,
  type OrderReceiptRetryCompleter,
  type OrderReceiptRetryRecorder,
} from "./orders";

type OrderPlacer = NonNullable<Parameters<typeof createOrdersRouter>[0]>;
type OrderResponse = {
  orderId: string;
  status: string;
  subtotalLkr: number;
  receiptEmailStatus?: "accepted" | "failed";
  lines: Array<{ variantId: string; unitPriceLkr: number; lineTotalLkr: number }>;
  error?: string;
};

const variantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";
const orderId = "d6e0d9cc-9236-4993-a144-c2815a11d335";
const idempotencyKey = "36b8f84d-df4e-4d49-b662-bcde71a8764f";

function createTestRateLimiters() {
  return createOrderRateLimiters(
    { windowMs: 60_000, createOrderLimit: 100, receiptRecoveryLimit: 100 },
    () => new MemoryStore(),
  );
}

async function postOrder(
  body: unknown,
  orderPlacer: OrderPlacer,
  requestKey: string | null = idempotencyKey,
  receiptMailer: OrderReceiptMailer = async () => {},
  receiptRetryRecorder: OrderReceiptRetryRecorder = async () => {},
  receiptRetryCompleter: OrderReceiptRetryCompleter = async () => {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { log: { warn() {}, error() {} } });
    next();
  });
  app.use("/api", createOrdersRouter(
    orderPlacer,
    undefined,
    createTestRateLimiters(),
    receiptMailer,
    receiptRetryRecorder,
    receiptRetryCompleter,
  ));

  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(requestKey === null ? {} : { "Idempotency-Key": requestKey }),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as OrderResponse };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function postReceiptLookup(
  body: unknown,
  orderReceiptRecoverer: OrderReceiptRecoverer,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { log: { warn() {}, error() {} } });
    next();
  });
  app.use("/api", createOrdersRouter(
    async () => ({ kind: "storage_unavailable" }),
    orderReceiptRecoverer,
    createTestRateLimiters(),
  ));

  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/orders/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as OrderResponse };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function customerDetails(lines: unknown[]) {
  return {
    customerName: "A. Customer",
    customerEmail: "customer@example.com",
    customerPhone: "+94 77 123 4567",
    deliveryAddress: "12 Flower Road, Colombo",
    lines,
  };
}

test("POST /api/orders stores only variant IDs and quantities from the client", async () => {
  let submitted: Parameters<OrderPlacer>[0] | undefined;
  let submittedKey: string | undefined;
  const { status, body } = await postOrder(
    {
      ...customerDetails([{ variantId, quantity: 2, priceLkr: 0 }]),
      totalLkr: 0,
    },
    async (input, key) => {
      submitted = input;
      submittedKey = key;
      return {
        kind: "created",
        order: {
          orderId,
          status: "pending_payment",
          subtotalLkr: 2501,
          lines: [{
            variantId,
            productName: "Quiet Garden",
            brand: "NIDOR",
            variantType: "decant",
            sizeMl: 5,
            quantity: 2,
            unitPriceLkr: 1250.5,
            lineTotalLkr: 2501,
          }],
        },
      };
    },
  );

  assert.equal(status, 201);
  assert.equal(body.subtotalLkr, 2501);
  assert.equal(body.receiptEmailStatus, "accepted");
  assert.equal(body.lines[0].unitPriceLkr, 1250.5);
  assert.deepEqual(submitted?.lines, [{ variantId, quantity: 2 }]);
  assert.ok(submitted && !("priceLkr" in submitted.lines[0]));
  assert.equal(submittedKey, idempotencyKey);
});

test("POST /api/orders requires a UUID idempotency key", async () => {
  let submitCount = 0;
  const { status, body } = await postOrder(
    customerDetails([{ variantId, quantity: 1 }]),
    async () => {
      submitCount += 1;
      return { kind: "storage_unavailable" };
    },
    null,
  );

  assert.equal(status, 400);
  assert.match(body.error ?? "", /Idempotency-Key UUID is required/i);
  assert.equal(submitCount, 0);
});

test("POST /api/orders returns the saved receipt for a repeated checkout key", async () => {
  const submittedKeys: string[] = [];
  let requestCount = 0;
  const orderPlacer: OrderPlacer = async (_input, key) => {
    submittedKeys.push(key);
    requestCount += 1;
    return {
      kind: requestCount === 1 ? "created" : "replayed",
      order: {
        orderId,
        status: "pending_payment",
        subtotalLkr: 1250.5,
        lines: [{
          variantId,
          productName: "Quiet Garden",
          brand: "NIDOR",
          variantType: "decant",
          sizeMl: 5,
          quantity: 1,
          unitPriceLkr: 1250.5,
          lineTotalLkr: 1250.5,
        }],
      },
    };
  };
  const first = await postOrder(customerDetails([{ variantId, quantity: 1 }]), orderPlacer);
  const retry = await postOrder(customerDetails([{ variantId, quantity: 1 }]), orderPlacer);

  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, first.body);
  assert.deepEqual(submittedKeys, [idempotencyKey, idempotencyKey]);
});

test("POST /api/orders emails only a persisted receipt and email failure does not fail checkout", async () => {
  let persisted = false;
  let mailAttempts = 0;
  const retryJobs: Array<{ orderId: string; errorCode: string }> = [];
  const orderPlacer: OrderPlacer = async () => {
    persisted = true;
    return {
      kind: "created",
      order: savedReceipt,
    };
  };
  const receiptMailer: OrderReceiptMailer = async (recipient, receipt) => {
    assert.equal(persisted, true);
    assert.equal(recipient, "customer@example.com");
    assert.deepEqual(receipt, savedReceipt);
    mailAttempts += 1;
    throw Object.assign(new Error("provider-secret-detail"), {
      code: "resend_rejected",
      status: 503,
    });
  };

  const { status, body } = await postOrder(
    customerDetails([{ variantId, quantity: 2 }]),
    orderPlacer,
    idempotencyKey,
    receiptMailer,
    async (retryOrderId, errorCode) => {
      retryJobs.push({ orderId: retryOrderId, errorCode });
    },
  );

  assert.equal(status, 201);
  assert.equal(body.orderId, orderId);
  assert.equal(body.receiptEmailStatus, "failed");
  assert.doesNotMatch(JSON.stringify(body), /provider-secret-detail|resend_rejected|503/);
  assert.equal(mailAttempts, 1);
  assert.deepEqual(retryJobs, [{ orderId, errorCode: "resend_rejected" }]);
});

test("receipt email contains saved line totals without checkout delivery details", () => {
  const email = buildOrderReceiptEmail(savedReceipt);
  const content = `${email.subject}\n${email.text}\n${email.html}`;

  assert.match(content, new RegExp(orderId));
  assert.match(content, /Quiet Garden/);
  assert.match(content, /LKR/);
  assert.doesNotMatch(content, /Flower Road|\+94 77 123 4567|delivery_address|customer_phone/i);
});

test("POST /api/orders does not send a receipt when the order was not saved", async () => {
  let mailAttempts = 0;
  const { status } = await postOrder(
    customerDetails([{ variantId, quantity: 1 }]),
    async () => ({ kind: "storage_unavailable" }),
    idempotencyKey,
    async () => { mailAttempts += 1; },
  );

  assert.equal(status, 503);
  assert.equal(mailAttempts, 0);
});

test("POST /api/orders rejects reusing a key with different checkout details", async () => {
  const { status, body } = await postOrder(
    customerDetails([{ variantId, quantity: 1 }]),
    async () => ({ kind: "rejected", reason: "idempotency_conflict" }),
  );

  assert.equal(status, 409);
  assert.match(body.error ?? "", /key was already used for different order details/i);
});

test("POST /api/orders rejects duplicate variant IDs before creating an order", async () => {
  let submitCount = 0;
  const { status, body } = await postOrder(
    customerDetails([{ variantId, quantity: 1 }, { variantId: variantId.toUpperCase(), quantity: 1 }]),
    async () => {
      submitCount += 1;
      return { kind: "storage_unavailable" };
    },
  );

  assert.equal(status, 400);
  assert.equal(body.error, "Include each fragrance format only once.");
  assert.equal(submitCount, 0);
});

test("POST /api/orders returns a clear conflict when inventory changed", async () => {
  const { status, body } = await postOrder(
    customerDetails([{ variantId, quantity: 2 }]),
    async () => ({ kind: "rejected", reason: "insufficient_stock" }),
  );

  assert.equal(status, 409);
  assert.match(body.error ?? "", /quantity is no longer available/i);
});

test("POST /api/orders rejects malformed delivery details", async () => {
  const { status, body } = await postOrder(
    { ...customerDetails([{ variantId, quantity: 1 }]), customerEmail: "not-an-email" },
    async () => ({ kind: "storage_unavailable" }),
  );

  assert.equal(status, 400);
  assert.match(body.error ?? "", /valid contact, delivery, and order details/i);
});

const savedReceipt = {
  orderId,
  status: "pending_payment" as const,
  subtotalLkr: 2501,
  lines: [{
    variantId,
    productName: "Quiet Garden",
    brand: "NIDOR",
    variantType: "decant" as const,
    sizeMl: 5,
    quantity: 2,
    unitPriceLkr: 1250.5,
    lineTotalLkr: 2501,
  }],
};

test("POST /api/orders/recover returns only the matching buyer's receipt", async () => {
  let received: { orderId: string; customerEmail: string } | undefined;
  const { status, body } = await postReceiptLookup(
    { orderId: orderId.toUpperCase(), customerEmail: "Customer@Example.com" },
    async (lookup) => {
      received = lookup;
      return { kind: "found", receipt: savedReceipt };
    },
  );

  assert.equal(status, 200);
  assert.deepEqual(body, savedReceipt);
  assert.deepEqual(received, { orderId, customerEmail: "customer@example.com" });
  assert.ok(!("customerName" in body));
  assert.ok(!("customerEmail" in body));
  assert.ok(!("customerPhone" in body));
  assert.ok(!("deliveryAddress" in body));
});

test("POST /api/orders/recover rejects an invalid order reference", async () => {
  let lookupCount = 0;
  const { status, body } = await postReceiptLookup(
    { orderId: "not-an-order-id", customerEmail: "customer@example.com" },
    async () => {
      lookupCount += 1;
      return { kind: "not_found" };
    },
  );

  assert.equal(status, 400);
  assert.match(body.error ?? "", /valid order reference and checkout email/i);
  assert.equal(lookupCount, 0);
});

test("POST /api/orders/recover does not reveal orders for a non-matching checkout email", async () => {
  const { status, body } = await postReceiptLookup(
    { orderId, customerEmail: "someone-else@example.com" },
    async () => ({ kind: "not_found" }),
  );

  assert.equal(status, 404);
  assert.equal(body.error, "No saved order matched those details.");
  assert.equal(Object.keys(body).length, 1);
});
