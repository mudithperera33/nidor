import assert from "node:assert/strict";
import { test } from "node:test";
import { sendOrderReceiptEmail } from "./order-receipt-email";
import type { CreatedOrder } from "./order-service";

const receipt: CreatedOrder = {
  orderId: "d6e0d9cc-9236-4993-a144-c2815a11d335",
  status: "pending_payment",
  subtotalLkr: 500,
  lines: [{
    variantId: "b6e0d9cc-9236-4993-a144-c2815a11d335",
    productName: "Test fragrance",
    brand: "NIDOR",
    variantType: "decant",
    sizeMl: 5,
    quantity: 1,
    unitPriceLkr: 500,
    lineTotalLkr: 500,
  }],
};

test("external hosting sends through Resend with the saved receipt and stable idempotency key", async () => {
  let called = false;
  const request: typeof fetch = async (url, init) => {
    called = true;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-only-key");
    assert.equal(headers.get("idempotency-key"), `nidor-order-receipt-${receipt.orderId}`);
    assert(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.from, "NIDOR <receipts@example.com>");
    assert.equal(body.to, "shopper@example.com");
    assert.deepEqual(body.tags, [{ name: "nidor_order_id", value: receipt.orderId }]);
    assert.match(body.text, /Payment has not been collected online/);
    assert.doesNotMatch(JSON.stringify(body), /test-only-key/);
    return Response.json({ id: "test-provider-message" });
  };
  assert.equal(await sendOrderReceiptEmail("shopper@example.com", receipt, {
    apiKey: "test-only-key",
    from: "NIDOR <receipts@example.com>",
    request,
  }), "test-provider-message");
  assert.equal(called, true);
});

test("Resend rejections expose only a controlled error, not the response body", async () => {
  await assert.rejects(sendOrderReceiptEmail("shopper@example.com", receipt, {
    apiKey: "test-only-key",
    from: "receipts@example.com",
    request: async () => new Response("private provider error", { status: 403 }),
  }), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.message, "Resend rejected the receipt email.");
    assert.equal((error as Error & { code: string }).code, "resend_rejected");
    return true;
  });
});
