export type LowStockVariant = {
  is_active: boolean;
  stock_needs_configuration: boolean;
  stock_quantity: number;
  low_stock_threshold?: number | null;
};

export function isVariantLowStock(variant: LowStockVariant): boolean {
  const threshold = variant.low_stock_threshold;
  return variant.is_active
    && !variant.stock_needs_configuration
    && Number.isInteger(variant.stock_quantity)
    && typeof threshold === 'number'
    && Number.isInteger(threshold)
    && threshold >= 0
    && variant.stock_quantity <= threshold;
}
