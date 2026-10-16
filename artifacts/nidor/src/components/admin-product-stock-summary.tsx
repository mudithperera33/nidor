import { isVariantLowStock } from '@/lib/low-stock';
import type { ProductVariantRecord } from '@/lib/product-catalog';

type AdminProductStockSummaryProps = {
  productId: string;
  variants: ProductVariantRecord[] | null;
};

const formatLabel = (variant: ProductVariantRecord) =>
  `${variant.variant_type === 'full_bottle' ? 'Full bottle' : 'Decant'} · ${variant.size_ml} ml`;

export function AdminProductStockSummary({ productId, variants }: AdminProductStockSummaryProps) {
  const activeVariants = (variants ?? []).filter((variant) => variant.is_active).sort((a, b) => {
    const typeOrder = (a.variant_type ?? 'decant') === (b.variant_type ?? 'decant')
      ? 0
      : (a.variant_type ?? 'decant') === 'decant' ? -1 : 1;
    return typeOrder || a.size_ml - b.size_ml;
  });
  const configuredVariants = activeVariants.filter((variant) => !variant.stock_needs_configuration);
  const unconfiguredCount = activeVariants.length - configuredVariants.length;
  const configuredStock = configuredVariants.reduce((sum, variant) => sum + variant.stock_quantity, 0);

  return (
    <div className="na-stock-overview">
      <span className={`na-stock-total ${unconfiguredCount ? 'needs-attention' : 'is-ready'}`} data-testid={`status-stock-${productId}`}>
        <i />{configuredStock} configured {configuredStock === 1 ? 'unit' : 'units'}
        {unconfiguredCount > 0 && <small> · {unconfiguredCount} {unconfiguredCount === 1 ? 'format' : 'formats'} need setup</small>}
      </span>
      <div className="na-stock-breakdown">
        {activeVariants.length > 0 ? activeVariants.map((variant) => {
          const variantKey = `${variant.variant_type ?? 'decant'}-${variant.size_ml}`;
          return <div className="na-stock-format" key={variant.id} data-testid={`row-stock-format-${productId}-${variantKey}`}>
            <span>{formatLabel(variant)}</span>
            <strong className={variant.stock_needs_configuration ? 'is-unconfigured' : ''} data-testid={`text-stock-format-${productId}-${variantKey}`}>
              {variant.stock_needs_configuration ? 'Not configured' : `${variant.stock_quantity} in stock`}
            </strong>
            {isVariantLowStock(variant) && <small className="na-low-stock-warning" role="status" data-testid={`warning-low-stock-${productId}-${variantKey}`}>
              Low stock · at or below {variant.low_stock_threshold}
            </small>}
          </div>;
        }) : <span className="na-stock-empty">No active formats</span>}
      </div>
    </div>
  );
}
