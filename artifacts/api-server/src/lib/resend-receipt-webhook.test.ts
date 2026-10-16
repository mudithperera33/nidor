import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import pino from "pino";
import { test } from "node:test";
import { createApp } from "../app";
import { createResendWebhookRouter } from "../routes/resend-webhook";
import {
  parseResendReceiptEvent,
  pruneExpiredResendWebhookEvents,
  recordResendReceiptEvent,
  verifyResendWebhookSignature,
} from "./resend-receipt-webhook";

const secretBytes = Buffer.from("test-resend-signing-secret");
const secret = `whsec_${secretBytes.toString("base64")}`;

function signed(raw: Buffer, timestamp: number, id = "msg_event_123") {
  const signature = createHmac("sha256", secretBytes)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw]))
    .digest("base64");
  return { id, timestamp: String(timestamp), signature: `v1,${signature}` };
}

test("Resend signature verification accepts exact recent signed bytes only", () => {
  const timestamp = 1_800_000_000;
  const raw = Buffer.from('{"type":"email.bounced"}');
  const headers = signed(raw, timestamp);

  assert.equal(verifyResendWebhookSignature(raw, headers, secret, timestamp), true);
  assert.equal(verifyResendWebhookSignature(Buffer.from(`${raw.toString()} `), headers, secret, timestamp), false);
  assert.equal(verifyResendWebhookSignature(raw, headers, secret, timestamp + 301), false);
  assert.equal(verifyResendWebhookSignature(raw, headers, "wrong", timestamp), false);
});

test("only bounce and complaint events with a provider email ID are acted on", () => {
  assert.deepEqual(
    parseResendReceiptEvent({ type: "email.bounced", data: { email_id: "a1" }, to: ["private@example.com"] }),
    { type: "email.bounced", data: { email_id: "a1" } },
  );
  assert.equal(parseResendReceiptEvent({ type: "email.delivered", data: { email_id: "a1" } }), null);
  assert.equal(parseResendReceiptEvent({ type: "email.bounced", data: {} }), null);
  assert.doesNotMatch(JSON.stringify(parseResendReceiptEvent({
    type: "email.bounced",
    data: { email_id: "a1", to: ["private@example.com"] },
  })), /private@example\.com/);
});

test("delivery events use an idempotent update and persist no provider payload", async () => {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      statements.push({ sql, params });
      return { rows: [{ inserted: true, updated: true }], rowCount: 1 };
    },
  };
  const event = parseResendReceiptEvent({ type: "email.complained", data: { email_id: "email_123" } });
  assert.ok(event);
  const result = await recordResendReceiptEvent(pool as never, "msg_event_123", event);
  assert.equal(result, "recorded");
  assert.match(statements[0]!.sql, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(statements[0]!.sql, /provider_email_id = \$3/);
  assert.deepEqual(statements[0]!.params, ["msg_event_123", "email.complained", "email_123"]);
  assert.doesNotMatch(JSON.stringify(statements), /private@example\.com|raw payload/);
});

test("webhook event cleanup requests one bounded batch and returns only the deleted count", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: [{ deleted_count: 500 }], rowCount: 1 };
    },
  };

  assert.equal(await pruneExpiredResendWebhookEvents(pool as never), 500);
  assert.deepEqual(calls, [{
    sql: "SELECT public.nidor_prune_receipt_email_webhook_events($1::int) AS deleted_count",
    params: [500],
  }]);
  assert.doesNotMatch(JSON.stringify(calls), /nidor_orders|nidor_order_receipt_email_retries|provider payload/i);
});

test("webhook event cleanup rejects impossible batch results", async () => {
  const pool = {
    async query() {
      return { rows: [{ deleted_count: 501 }], rowCount: 1 };
    },
  };
  await assert.rejects(pruneExpiredResendWebhookEvents(pool as never), /invalid row count/i);
});

test("mounted Resend route rejects bad signatures and updates matching delivery state once", async () => {
  const events = new Set<string>();
  const deliveryByProviderId = new Map<string, string>();
  const sqlCalls: unknown[][] = [];
  const pool = {
    async query(_sql: string, params: unknown[] = []) {
      sqlCalls.push(params);
      const [eventId, eventType, providerEmailId] = params as [string, string, string];
      if (events.has(eventId)) return { rows: [{ inserted: false, updated: false }], rowCount: 1 };
      events.add(eventId);
      deliveryByProviderId.set(providerEmailId, eventType === "email.bounced" ? "bounced" : "complained");
      return { rows: [{ inserted: true, updated: true }], rowCount: 1 };
    },
  };
  const logOutput: string[] = [];
  const testLogger = pino({ level: "info" }, {
    write(chunk: string) {
      logOutput.push(chunk);
    },
  });
  const app = createApp(
    createResendWebhookRouter(secret, pool as never),
    testLogger,
  );
  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const rawBody = Buffer.from(JSON.stringify({
    type: "email.bounced",
    data: { email_id: "resend_email_1", to: ["private@example.com"] },
    customer_email: "private@example.com",
    raw_provider_detail: "provider-private-detail",
  }));
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = signed(rawBody, timestamp, "msg_bounce_1");
  const post = (body: Buffer, signatureHeaders: ReturnType<typeof signed>, signature = signatureHeaders.signature) =>
    fetch(`http://127.0.0.1:${address.port}/api/webhooks/resend`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": signatureHeaders.id,
        "svix-timestamp": signatureHeaders.timestamp,
        "svix-signature": signature,
      },
      body,
    });

  try {
    const invalid = await post(rawBody, headers, "v1,invalid");
    assert.equal(invalid.status, 401);
    assert.equal(sqlCalls.length, 0);

    const accepted = await post(rawBody, headers);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { received: true, duplicate: false });
    assert.equal(deliveryByProviderId.get("resend_email_1"), "bounced");

    const replay = await post(rawBody, headers);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { received: true, duplicate: true });
    assert.equal(sqlCalls.length, 2);

    const complaintBody = Buffer.from(JSON.stringify({
      type: "email.complained",
      data: { email_id: "resend_email_2" },
    }));
    const complaintHeaders = signed(complaintBody, timestamp, "msg_complaint_1");
    const complaint = await post(complaintBody, complaintHeaders);
    assert.equal(complaint.status, 200);
    assert.deepEqual(await complaint.json(), { received: true, duplicate: false });
    assert.equal(deliveryByProviderId.get("resend_email_2"), "complained");
    assert.doesNotMatch(logOutput.join(""), /private@example\.com|provider-private-detail/);
    assert.doesNotMatch(JSON.stringify(sqlCalls), /private@example\.com|provider-private-detail/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
