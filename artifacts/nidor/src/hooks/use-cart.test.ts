import assert from "node:assert/strict";
import { test } from "node:test";
import { setCartLineQuantity } from "./use-cart";

test("cart lines keep the selected full-bottle variant ID", () => {
  const selectedVariantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";

  assert.deepEqual(
    setCartLineQuantity([], selectedVariantId, 1),
    [{ variantId: selectedVariantId, quantity: 1 }],
  );
});

test("changing quantity updates the same selected variant ID", () => {
  const selectedVariantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";
  const existing = [{ variantId: selectedVariantId, quantity: 1 }];

  assert.deepEqual(
    setCartLineQuantity(existing, selectedVariantId, 2),
    [{ variantId: selectedVariantId, quantity: 2 }],
  );
});
