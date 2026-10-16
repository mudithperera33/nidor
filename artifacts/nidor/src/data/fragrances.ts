export type FragranceTheme = {
  surface: string;
  deep: string;
  accent: string;
  light: boolean;
};

export type NoteGroup = {
  label: 'Top notes' | 'Heart notes' | 'Base notes';
  notes: string[];
};

export type FragranceVisualConfig = {
  scale: number;
  x: number;
  y: number;
  rotation: number;
};

export type FragranceVariant = {
  id: string;
  variantType: 'decant' | 'full_bottle';
  sizeMl: number;
  sku: string;
  priceLkr: number | null;
  priceNeedsConfiguration: boolean;
  stockQuantity: number;
  stockNeedsConfiguration: boolean;
  isActive: boolean;
};

export function variantDisplayName(variant: Pick<FragranceVariant, 'variantType' | 'sizeMl'>): string {
  return variant.variantType === 'full_bottle'
    ? `Full bottle · ${variant.sizeMl} ml`
    : `${variant.sizeMl} ml decant`;
}

export function isVariantConfigured(variant: FragranceVariant): boolean {
  return variant.isActive
    && Number.isInteger(variant.sizeMl)
    && variant.sizeMl > 0
    && !variant.priceNeedsConfiguration
    && variant.priceLkr !== null
    && Number.isFinite(variant.priceLkr)
    && variant.priceLkr >= 0
    && !variant.stockNeedsConfiguration
    && Number.isInteger(variant.stockQuantity)
    && variant.stockQuantity >= 0;
}

export type Fragrance = {
  id: string;
  slug: string;
  number: string;
  name: string;
  brand: string;
  house: string;
  family?: string;
  gender?: string;
  concentration?: string;
  image: string;
  theme: FragranceTheme;
  description: string;
  story: string;
  notes: NoteGroup[];
  visual: FragranceVisualConfig;
  variants: FragranceVariant[];
  isFeatured?: boolean;
};