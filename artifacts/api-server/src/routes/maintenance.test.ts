import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { createMaintenanceRouter } from "./maintenance";
import { runOrderReceiptEmailRetryBatch } from "../lib/order-receipt-email-retries";

const secret = "test-only-maintenance-secret";

test("serverless retries can request a smaller batch and reject invalid limits before querying", async () => {
  const calls: unknown[][] = [];
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      calls.push(params);
      return { rows: [], rowCount: 0 };
    },
  };
  assert.equal(await runOrderReceiptEmailRetryBatch(pool as never, undefined, 2), 0);
  assert.deepEqual(calls[1], [5, 2, 5]);
  await assert.rejects(runOrderReceiptEmailRetryBatch(pool as never, undefined, 11), /between 1 and 10/);
  assert.equal(calls.length, 2);
});

test("scheduled jobs reject missing configuration and unauthorized requests before doing work", async (t) => {
  let called = 0;
  const jobs = {
    retryReceipts: async () => { called++; return 2; },
    pruneEvents: async () => { called++; return 5; },
  };
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use("/missing", createMaintenanceRouter(jobs, () => undefined));
  app.use("/api", createMaintenanceRouter(jobs, () => secret));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(`${base}/missing/internal/maintenance`)).status, 503);
  for (const authorization of ["", "Bearer invalid", `Bearer ${secret}extra`]) {
    const response = await fetch(`${base}/api/internal/maintenance`, { headers: { authorization } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await fetch(`${base}/api/internal/maintenance`, { method: "POST" })).status, 404);
  assert.equal(called, 0);
});

test("authorized maintenance awaits both jobs and returns counts only", async (t) => {
  const calls: string[] = [];
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use("/api", createMaintenanceRouter({
    pruneEvents: async () => { calls.push("prune"); return 5; },
    retryReceipts: async () => { await Promise.resolve(); calls.push("retry"); return 2; },
  }, () => secret));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/internal/maintenance`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { prunedEvents: 5, processedRetries: 2 });
  assert.deepEqual(calls, ["prune", "retry"]);
});

test("maintenance failures do not disclose credentials or database errors", async (t) => {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use("/api", createMaintenanceRouter({
    pruneEvents: async () => { throw new Error("private-database-error"); },
    retryReceipts: async () => { assert.fail("No further work after failure"); },
  }, () => secret));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/internal/maintenance`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Scheduled maintenance could not complete." });
});
