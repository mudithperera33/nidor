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
  sizeMl: 5 | 10;
  sku: string;
  priceLkr: number | null;
  priceNeedsConfiguration: boolean;
  stockQuantity: number;
  stockNeedsConfiguration: boolean;
  isActive: boolean;
};

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
};