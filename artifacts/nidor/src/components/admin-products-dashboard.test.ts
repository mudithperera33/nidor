import assert from 'node:assert/strict';
import { createElement } from 'react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';
import { test } from 'node:test';
import { AdminProductStockSummary } from './admin-product-stock-summary';
import { adminCatalogQueryKey, createSaveAdminProductMutationOptions } from '@/hooks/use-catalog';
import { productToDraft, type ProductRecord, type ProductVariantRecord } from '@/lib/product-catalog';

Object.assign(globalThis, { React });

const variant = (
  id: string,
  variantType: 'decant' | 'full_bottle',
  sizeMl: number,
  stockQuantity: number,
  stockNeedsConfiguration = false,
): ProductVariantRecord => ({
  id,
  product_id: 'quiet-garden',
  variant_type: variantType,
  size_ml: sizeMl,
  sku: `${id}-sku`,
  price_lkr: 1000,
  price_needs_configuration: false,
  stock_quantity: stockQuantity,
  stock_needs_configuration: stockNeedsConfiguration,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const product = (
  variants: ProductVariantRecord[],
  id = 'quiet-garden',
): ProductRecord => ({
  id,
  name: id === 'quiet-garden' ? 'Quiet Garden' : 'Amber Study',
  slug: id,
  brand: 'NIDOR',
  description: 'A green, quiet fragrance.',
  fragrance_family: 'Green',
  gender: null,
  concentration: null,
  top_notes: [],
  heart_notes: [],
  base_notes: [],
  mood: null,
  occasion: null,
  season: null,
  image_url: 'https://example.com/fragrance.jpg',
  theme_config: {},
  is_active: true,
  is_featured: false,
  display_order: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  product_variants: variants,
});

function renderProductStockSummary(item: ProductRecord) {
  return renderToStaticMarkup(createElement(
    AdminProductStockSummary,
    { productId: item.id, variants: item.product_variants },
  ));
}

test('admin inventory keeps each volume separate and labels configured zero stock', () => {
  const client = new QueryClient();
  const catalogue = [
    product([
      variant('decant-5', 'decant', 5, 7),
      variant('decant-10', 'decant', 10, 0),
      variant('bottle-50', 'full_bottle', 50, 3),
    ]),
    product([
      variant('decant-5-unset', 'decant', 5, 0, true),
      variant('bottle-30-unset', 'full_bottle', 30, 0, true),
    ], 'amber-study'),
  ];
  try {
    const markup = catalogue.map(renderProductStockSummary).join('');

    assert.match(markup, /data-testid="row-stock-format-quiet-garden-decant-5"><span>Decant · 5 ml<\/span><strong[^>]*>7 in stock/);
    assert.match(markup, /data-testid="row-stock-format-quiet-garden-decant-10"><span>Decant · 10 ml<\/span><strong[^>]*>0 in stock/);
    assert.match(markup, /data-testid="row-stock-format-quiet-garden-full_bottle-50"><span>Full bottle · 50 ml<\/span><strong[^>]*>3 in stock/);
    assert.match(markup, /data-testid="text-stock-format-amber-study-decant-5">Not configured/);
    assert.match(markup, /data-testid="text-stock-format-amber-study-full_bottle-30">Not configured/);
  } finally {
    client.clear();
}
});

test('editing and saving inventory refreshes the product list with each variant value', async () => {
  const client = new QueryClient();
  const before = product([
    variant('decant-5', 'decant', 5, 7),
    variant('decant-10', 'decant', 10, 0),
    variant('bottle-50', 'full_bottle', 50, 3),
  ]);
  let serverProduct = before;
  client.setQueryData(adminCatalogQueryKey, [before]);
  const listObserver = new QueryObserver(client, {
    queryKey: adminCatalogQueryKey,
    queryFn: async () => [serverProduct],
    staleTime: Infinity,
  });
  const unsubscribe = listObserver.subscribe(() => {});
  const draft = productToDraft(before);
  const draftStock = Object.fromEntries(draft.variants.map((item) => [
    `${item.variantType}-${item.sizeMl}`,
    { stockQuantity: item.stockQuantity, stockNeedsConfiguration: item.stockNeedsConfiguration },
  ]));

  assert.deepEqual(draftStock, {
    'decant-5': { stockQuantity: 7, stockNeedsConfiguration: false },
    'decant-10': { stockQuantity: 0, stockNeedsConfiguration: false },
    'full_bottle-50': { stockQuantity: 3, stockNeedsConfiguration: false },
  });

  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 5)!.stockQuantity = 9;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!.stockNeedsConfiguration = true;
  draft.variants.find((item) => item.variantType === 'full_bottle')!.stockQuantity = 4;
  let receivedDraftStock: typeof draftStock | undefined;
  const mutation = new MutationObserver(client, createSaveAdminProductMutationOptions(
    client,
    async ({ draft: savedDraft }) => {
      receivedDraftStock = Object.fromEntries(savedDraft.variants.map((item) => [
        `${item.variantType}-${item.sizeMl}`,
        { stockQuantity: item.stockQuantity, stockNeedsConfiguration: item.stockNeedsConfiguration },
      ]));
      serverProduct = product([
        variant('decant-5', 'decant', 5, 9),
        variant('decant-10', 'decant', 10, 0, true),
        variant('bottle-50', 'full_bottle', 50, 4),
      ]);
      return serverProduct;
    },
  ));

  try {
    await mutation.mutate({ draft });

    assert.deepEqual(receivedDraftStock, {
      'decant-5': { stockQuantity: 9, stockNeedsConfiguration: false },
      'decant-10': { stockQuantity: 0, stockNeedsConfiguration: true },
      'full_bottle-50': { stockQuantity: 4, stockNeedsConfiguration: false },
    });
    assert.deepEqual(client.getQueryData(adminCatalogQueryKey), [serverProduct]);

    const refreshedProducts = client.getQueryData<ProductRecord[]>(adminCatalogQueryKey) ?? [];
    const markup = refreshedProducts.map(renderProductStockSummary).join('');
    assert.match(markup, /data-testid="text-stock-format-quiet-garden-decant-5">9 in stock/);
    assert.match(markup, /data-testid="text-stock-format-quiet-garden-decant-10">Not configured/);
    assert.match(markup, /data-testid="text-stock-format-quiet-garden-full_bottle-50">4 in stock/);
  } finally {
    unsubscribe();
    client.clear();
  }
});
