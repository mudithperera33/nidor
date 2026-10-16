import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isVariantLowStock, type LowStockVariant } from './low-stock';

const variant = (overrides: Partial<LowStockVariant> = {}): LowStockVariant => ({
  is_active: true,
  stock_needs_configuration: false,
  stock_quantity: 3,
  low_stock_threshold: 3,
  ...overrides,
});

test('flags configured active stock at or below its own threshold', () => {
  assert.equal(isVariantLowStock(variant()), true);
  assert.equal(isVariantLowStock(variant({ stock_quantity: 2 })), true);
  assert.equal(isVariantLowStock(variant({ stock_quantity: 4 })), false);
});

test('a zero threshold can flag only zero stock', () => {
  assert.equal(isVariantLowStock(variant({ stock_quantity: 0, low_stock_threshold: 0 })), true);
  assert.equal(isVariantLowStock(variant({ stock_quantity: 1, low_stock_threshold: 0 })), false);
});

test('does not flag variants without a configured threshold or verified stock', () => {
  assert.equal(isVariantLowStock(variant({ low_stock_threshold: null })), false);
  assert.equal(isVariantLowStock(variant({ low_stock_threshold: undefined })), false);
  assert.equal(isVariantLowStock(variant({ stock_needs_configuration: true })), false);
});

test('does not flag inactive variants', () => {
  assert.equal(isVariantLowStock(variant({ is_active: false })), false);
});
