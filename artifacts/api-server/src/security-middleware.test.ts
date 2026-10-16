import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express, { type Express } from "express";
import type { Store } from "express-rate-limit";
import { test } from "node:test";
import { createNidorCorsOptions, parseCorsAllowedOrigins } from "./lib/cors-config";
import { createOrderRateLimiters, type OrderRateLimitStoreFactory } from "./lib/order-rate-limits";
import { createOrdersRouter, type OrderReceiptRecoverer } from "./routes/orders";

type OrderPlacer = NonNullable<Parameters<typeof createOrdersRouter>[0]>;
type Fetch = (baseUrl: string) => Promise<void>;

const orderId = "d6e0d9cc-9236-4993-a144-c2815a11d335";
const variantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";
const idempotencyKey = "36b8f84d-df4e-4d49-b662-bcde71a8764f";

function createSharedTestStoreFactory() {
  const counters = new Map<string, { totalHits: number; resetTime: Date }>();
  let now = Date.now();
  const factory: OrderRateLimitStoreFactory = (namespace, windowMs): Store => ({
    prefix: `test:${namespace}`,
    localKeys: false,
    increment(key) {
      const storageKey = `${namespace}:${key}`;
      let counter = counters.get(storageKey);
      if (!counter || counter.resetTime.getTime() <= now) {
        counter = { totalHits: 0, resetTime: new Date(now + windowMs) };
        counters.set(storageKey, counter);
      }
      counter.totalHits += 1;
      return { ...counter };
    },
    decrement(key) {
      const counter = counters.get(`${namespace}:${key}`);
      if (counter) counter.totalHits = Math.max(0, counter.totalHits - 1);
    },
    resetKey(key) {
      counters.delete(`${namespace}:${key}`);
    },
  });
  return {
    factory,
    advanceWindow(milliseconds: number) {
      now += milliseconds;
    },
  };
}

function buildTestApp(
  orderPlacer: OrderPlacer,
  orderReceiptRecoverer: OrderReceiptRecoverer,
  storeFactory: OrderRateLimitStoreFactory,
): Express {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { log: { warn() {}, error() {} } });
    next();
  });
  app.use("/api", createOrdersRouter(
    orderPlacer,
    orderReceiptRecoverer,
    createOrderRateLimiters({
      windowMs: 60_000,
      createOrderLimit: 1,
      receiptRecoveryLimit: 1,
    }, storeFactory),
  ));
  return app;
}

async function withServer<T>(app: Express, run: Fetch): Promise<T> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    return await run(baseUrl) as T;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("order and receipt endpoints return controlled 429 responses with proxy trust disabled", async () => {
  let orderCount = 0;
  let recoveryCount = 0;
  const sharedStore = createSharedTestStoreFactory();
  const createdOrder = {
    orderId,
    status: "pending_payment" as const,
    subtotalLkr: 1250,
    lines: [{
      variantId,
      productName: "Hawas Chrome",
      brand: "Rasasi",
      variantType: "decant" as const,
      sizeMl: 5,
      quantity: 1,
      unitPriceLkr: 1250,
      lineTotalLkr: 1250,
    }],
  };
  const app = buildTestApp(
    async () => {
      orderCount += 1;
      return { kind: "created", order: createdOrder };
    },
    async () => {
      recoveryCount += 1;
      return { kind: "found", receipt: createdOrder };
    },
    sharedStore.factory,
  );
  assert.equal(app.get("trust proxy"), false);

  await withServer(app, async (baseUrl) => {
    const orderBody = {
      customerName: "A. Customer",
      customerEmail: "customer@example.com",
      customerPhone: "+94 77 123 4567",
      deliveryAddress: "12 Flower Road, Colombo",
      lines: [{ variantId, quantity: 1 }],
    };
    const orderRequest = () => fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(orderBody),
    });

    const acceptedOrder = await orderRequest();
    assert.equal(acceptedOrder.status, 201);
    const limitedOrder = await orderRequest();
    assert.equal(limitedOrder.status, 429);
    assert.match((await limitedOrder.json() as { error: string }).error, /too many order attempts/i);
    assert.equal(orderCount, 1);

    const recoveryBody = JSON.stringify({ orderId, customerEmail: "customer@example.com" });
    const recoveryRequest = () => fetch(`${baseUrl}/api/orders/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: recoveryBody,
    });
    const acceptedRecovery = await recoveryRequest();
    assert.equal(acceptedRecovery.status, 200);
    const recoveredReceipt = await acceptedRecovery.json() as Record<string, unknown>;
    assert.equal("deliveryAddress" in recoveredReceipt, false);

    const limitedRecovery = await recoveryRequest();
    assert.equal(limitedRecovery.status, 429);
    assert.match((await limitedRecovery.json() as { error: string }).error, /too many receipt lookups/i);
    assert.equal(recoveryCount, 1);
  });
});

test("unverified forwarded IP headers do not change the direct client identity", async () => {
  const app = express();
  app.set("trust proxy", false);
  app.get("/client-ip", (req, res) => {
    res.json({ ip: req.ip });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/client-ip`, {
      headers: { "x-forwarded-for": "198.51.100.10" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ip: "127.0.0.1" });
  });
});

test("separate API instances share order and receipt limits until the stored window expires", async () => {
  let orderCount = 0;
  let recoveryCount = 0;
  const sharedStore = createSharedTestStoreFactory();
  const createOrder = async () => {
    orderCount += 1;
    return {
      kind: "created" as const,
      order: {
        orderId,
        status: "pending_payment" as const,
        subtotalLkr: 1250,
        lines: [{
          variantId,
          productName: "Hawas Chrome",
          brand: "Rasasi",
          variantType: "decant" as const,
          sizeMl: 5,
          quantity: 1,
          unitPriceLkr: 1250,
          lineTotalLkr: 1250,
        }],
      },
    };
  };
  const recoverReceipt: OrderReceiptRecoverer = async () => {
    recoveryCount += 1;
    return { kind: "not_found" };
  };
  const appA = buildTestApp(createOrder, recoverReceipt, sharedStore.factory);
  const appB = buildTestApp(createOrder, recoverReceipt, sharedStore.factory);
  const orderBody = {
    customerName: "A. Customer",
    customerEmail: "customer@example.com",
    customerPhone: "+94 77 123 4567",
    deliveryAddress: "12 Flower Road, Colombo",
    lines: [{ variantId, quantity: 1 }],
  };

  await withServer(appA, async (baseUrlA) => {
    const firstOrder = await fetch(`${baseUrlA}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(orderBody),
    });
    assert.equal(firstOrder.status, 201);
  });
  await withServer(appB, async (baseUrlB) => {
    const secondOrder = await fetch(`${baseUrlB}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(orderBody),
    });
    assert.equal(secondOrder.status, 429);
    assert.equal(orderCount, 1);

    const receiptBody = JSON.stringify({ orderId, customerEmail: "customer@example.com" });
    const firstReceipt = await fetch(`${baseUrlB}/api/orders/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: receiptBody,
    });
    assert.equal(firstReceipt.status, 404);

    await withServer(appA, async (baseUrlA) => {
      const secondReceipt = await fetch(`${baseUrlA}/api/orders/recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: receiptBody,
      });
      assert.equal(secondReceipt.status, 429);
      assert.equal(recoveryCount, 1);
    });

    sharedStore.advanceWindow(60_001);

    const orderAfterExpiry = await fetch(`${baseUrlB}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(orderBody),
    });
    assert.equal(orderAfterExpiry.status, 201);
    const receiptAfterExpiry = await fetch(`${baseUrlB}/api/orders/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: receiptBody,
    });
    assert.equal(receiptAfterExpiry.status, 404);
    assert.equal(orderCount, 2);
    assert.equal(recoveryCount, 2);
  });
});

test("CORS allows only configured exact origins and rejects invalid origin configuration", async () => {
  const allowedOrigin = "https://shop.example";
  const app = express();
  app.use(cors(createNidorCorsOptions(new Set([allowedOrigin]))));
  app.options("/api/orders", (_req, res) => {
    res.sendStatus(204);
  });

  await withServer(app, async (baseUrl) => {
    const preflight = (origin: string) => fetch(`${baseUrl}/api/orders`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,idempotency-key",
      },
    });

    const allowed = await preflight(allowedOrigin);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);

    const rejected = await preflight("https://unlisted.example");
    assert.equal(rejected.status, 204);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  });

  assert.deepEqual([...parseCorsAllowedOrigins("https://shop.example, http://localhost:3000")], [
    "https://shop.example",
    "http://localhost:3000",
  ]);
  assert.throws(() => parseCorsAllowedOrigins("https://shop.example/admin"), /exact HTTP or HTTPS origins/i);
  assert.throws(() => parseCorsAllowedOrigins("javascript:alert(1)"), /exact HTTP or HTTPS origins/i);
});
