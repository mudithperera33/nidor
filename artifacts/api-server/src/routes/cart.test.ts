import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import { test } from "node:test";
import { createCartRouter } from "./cart";

type CatalogLookup = NonNullable<Parameters<typeof createCartRouter>[0]>;
type TestVariantRow = {
  variant_id: string;
  slug: string;
  name: string;
  brand: string;
  image_url: string;
  variant_type: string | null;
  size_ml: number;
  price_lkr: string | null;
  price_needs_configuration: boolean;
  stock_quantity: number;
  stock_needs_configuration: boolean;
};
type ValidationResponse = {
  lines: Array<{
    variantId: string;
    status: string;
    canPurchase: boolean;
    product: { slug: string; name: string; brand: string; imageUrl: string } | null;
    variant: { priceLkr: number | null } | null;
  }>;
  error?: string;
};

const variantId = "398fa9b2-03d7-45a7-9f83-879fe97cc20a";

function catalogRow(overrides: Partial<TestVariantRow> = {}): TestVariantRow {
  return {
    variant_id: variantId,
    slug: "quiet-garden",
    name: "Quiet Garden",
    brand: "NIDOR",
    image_url: "/fragrances/quiet-garden.jpg",
    variant_type: "decant",
    size_ml: 5,
    price_lkr: "1250.00",
    price_needs_configuration: false,
    stock_quantity: 4,
    stock_needs_configuration: false,
    ...overrides,
  };
}

async function postCart(body: unknown, catalogLookup: CatalogLookup) {
  const app = express();
  app.use(express.json());
  app.use("/api", createCartRouter(catalogLookup));

  const server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/cart/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as ValidationResponse };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const statusCases = [
  {
    name: "valid variants are purchasable",
    rows: [catalogRow()],
    quantity: 2,
    status: "valid",
    canPurchase: true,
  },
  {
    name: "inactive variants are unavailable",
    rows: [],
    quantity: 1,
    status: "unavailable",
    canPurchase: false,
  },
  {
    name: "variants without a configured price cannot be purchased",
    rows: [catalogRow({ price_lkr: null, price_needs_configuration: true })],
    quantity: 1,
    status: "price_unconfigured",
    canPurchase: false,
  },
  {
    name: "variants without configured stock cannot be purchased",
    rows: [catalogRow({ stock_needs_configuration: true })],
    quantity: 1,
    status: "stock_unconfigured",
    canPurchase: false,
  },
  {
    name: "out-of-stock variants cannot be purchased",
    rows: [catalogRow({ stock_quantity: 0 })],
    quantity: 1,
    status: "out_of_stock",
    canPurchase: false,
  },
  {
    name: "quantities above available stock cannot be purchased",
    rows: [catalogRow({ stock_quantity: 2 })],
    quantity: 3,
    status: "insufficient_stock",
    canPurchase: false,
  },
] as const;

for (const scenario of statusCases) {
  test(`POST /api/cart/validate: ${scenario.name}`, async () => {
    const { status, body } = await postCart(
      { lines: [{ variantId, quantity: scenario.quantity }] },
      async () => [...scenario.rows],
    );

    assert.equal(status, 200);
    assert.equal(body.lines[0].status, scenario.status);
    assert.equal(body.lines[0].canPurchase, scenario.canPurchase);
    assert.equal(body.lines[0].variantId, variantId);
    if (scenario.status === "unavailable") {
      assert.equal(body.lines[0].product, null);
      assert.equal(body.lines[0].variant, null);
    }
  });
}

test("POST /api/cart/validate rejects duplicate variant IDs before catalog lookup", async () => {
  let lookupCount = 0;
  const { status, body } = await postCart(
    { lines: [{ variantId, quantity: 1 }, { variantId, quantity: 2 }] },
    async () => {
      lookupCount += 1;
      return [catalogRow()];
    },
  );

  assert.equal(status, 400);
  assert.equal(body.error, "Include each variant only once.");
  assert.equal(lookupCount, 0);
});

test("POST /api/cart/validate uses the catalog price, not a client-supplied price", async () => {
  const trustedCatalogPrice = 7654.32;
  const { status, body } = await postCart(
    {
      lines: [{ variantId, quantity: 1, priceLkr: 0 }],
      priceLkr: 0,
      totalLkr: 0,
    },
    async () => [catalogRow({ price_lkr: String(trustedCatalogPrice) })],
  );

  assert.equal(status, 200);
  assert.equal(body.lines[0].status, "valid");
  assert.ok(body.lines[0].variant);
  assert.equal(body.lines[0].variant.priceLkr, trustedCatalogPrice);
});
