import type { Fragrance, FragranceTheme, FragranceVariant, FragranceVisualConfig, NoteGroup } from '@/data/fragrances';
import { buildAdminSignInRedirectUrl } from '@/lib/admin-redirect';
import { getSupabaseClient } from '@/lib/supabase';

export type ProductVariantRecord = {
  id: string;
  product_id: string;
  size_ml: 5 | 10;
  sku: string;
  price_lkr: number | string | null;
  price_needs_configuration: boolean;
  stock_quantity: number;
  stock_needs_configuration: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductRecord = {
  id: string;
  name: string;
  slug: string;
  brand: string;
  description: string;
  fragrance_family: string | null;
  gender: string | null;
  concentration: string | null;
  top_notes: string[];
  heart_notes: string[];
  base_notes: string[];
  mood: string | null;
  occasion: string | null;
  season: string | null;
  image_url: string;
  theme_config: Record<string, unknown>;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  product_variants: ProductVariantRecord[] | null;
};

export type ProductVariantDraft = {
  id?: string;
  sizeMl: 5 | 10;
  priceLkr: number | null;
  priceNeedsConfiguration: boolean;
  stockQuantity: number;
  stockNeedsConfiguration: boolean;
  isActive: boolean;
};

export type ProductDraft = {
  id?: string;
  name: string;
  slug: string;
  brand: string;
  description: string;
  fragranceFamily: string;
  gender: string;
  concentration: string;
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  mood: string;
  occasion: string;
  season: string;
  imageUrl: string;
  themeConfig: Record<string, unknown>;
  isActive: boolean;
  isFeatured: boolean;
  displayOrder: number;
  variants: ProductVariantDraft[];
};

export function createEmptyProductDraft(nextDisplayOrder = 1): ProductDraft {
  return {
    name: '',
    slug: '',
    brand: '',
    description: '',
    fragranceFamily: '',
    gender: '',
    concentration: '',
    topNotes: [],
    heartNotes: [],
    baseNotes: [],
    mood: '',
    occasion: '',
    season: '',
    imageUrl: '',
    themeConfig: {
      number: String(nextDisplayOrder).padStart(2, '0'),
      houseDisplay: '',
      story: '',
      theme: {
        surface: '#e7dccb',
        deep: '#242d40',
        accent: '#b8894a',
        light: false,
      },
      visual: { scale: 1, x: 0, y: 0, rotation: 0 },
    },
    isActive: false,
    isFeatured: false,
    displayOrder: nextDisplayOrder,
    variants: [
      {
        sizeMl: 5,
        priceLkr: null,
        priceNeedsConfiguration: true,
        stockQuantity: 0,
        stockNeedsConfiguration: true,
        isActive: true,
      },
      {
        sizeMl: 10,
        priceLkr: null,
        priceNeedsConfiguration: true,
        stockQuantity: 0,
        stockNeedsConfiguration: true,
        isActive: true,
      },
    ],
  };
}

export function productToDraft(product: ProductRecord): ProductDraft {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    description: product.description,
    fragranceFamily: product.fragrance_family ?? '',
    gender: product.gender ?? '',
    concentration: product.concentration ?? '',
    topNotes: toStringArray(product.top_notes),
    heartNotes: toStringArray(product.heart_notes),
    baseNotes: toStringArray(product.base_notes),
    mood: product.mood ?? '',
    occasion: product.occasion ?? '',
    season: product.season ?? '',
    imageUrl: product.image_url,
    themeConfig: objectValue(product.theme_config),
    isActive: product.is_active,
    isFeatured: product.is_featured,
    displayOrder: product.display_order,
    variants: [5, 10].map((sizeMl) => {
      const variant = product.product_variants?.find((item) => item.size_ml === sizeMl);
      return {
        ...(variant ? { id: variant.id } : {}),
        sizeMl: sizeMl as 5 | 10,
        priceLkr: variant?.price_lkr === null || variant?.price_lkr === undefined
          ? null
          : Number(variant.price_lkr),
        priceNeedsConfiguration: variant?.price_needs_configuration ?? true,
        stockQuantity: variant?.stock_quantity ?? 0,
        stockNeedsConfiguration: variant?.stock_needs_configuration ?? true,
        isActive: variant?.is_active ?? false,
      };
    }),
  };
}

const productSelect = '*, product_variants(*)';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readTheme(config: Record<string, unknown>): FragranceTheme {
  const theme = objectValue(config.theme);
  return {
    surface: typeof theme.surface === 'string' ? theme.surface : '#d9c79f',
    deep: typeof theme.deep === 'string' ? theme.deep : '#242d40',
    accent: typeof theme.accent === 'string' ? theme.accent : '#b8894a',
    light: typeof theme.light === 'boolean' ? theme.light : false,
  };
}

function readVisual(config: Record<string, unknown>): FragranceVisualConfig {
  const visual = objectValue(config.visual);
  const numeric = (key: keyof FragranceVisualConfig, fallback: number) =>
    typeof visual[key] === 'number' && Number.isFinite(visual[key]) ? visual[key] as number : fallback;

  return {
    scale: numeric('scale', 1),
    x: numeric('x', 0),
    y: numeric('y', 0),
    rotation: numeric('rotation', 0),
  };
}

function formatVariant(row: ProductVariantRecord): FragranceVariant {
  const price = row.price_lkr === null ? null : Number(row.price_lkr);
  return {
    id: row.id,
    sizeMl: row.size_ml,
    sku: row.sku,
    priceLkr: price !== null && Number.isFinite(price) ? price : null,
    priceNeedsConfiguration: row.price_needs_configuration,
    stockQuantity: row.stock_quantity,
    stockNeedsConfiguration: row.stock_needs_configuration,
    isActive: row.is_active,
  };
}

function formatProduct(row: ProductRecord): Fragrance {
  const config = objectValue(row.theme_config);
  const noteGroups: NoteGroup[] = [
    { label: 'Top notes', notes: toStringArray(row.top_notes) },
    { label: 'Heart notes', notes: toStringArray(row.heart_notes) },
    { label: 'Base notes', notes: toStringArray(row.base_notes) },
  ];

  return {
    id: row.slug,
    slug: row.slug,
    number: typeof config.number === 'string'
      ? config.number
      : String(row.display_order).padStart(2, '0'),
    name: row.name,
    brand: row.brand,
    house: typeof config.houseDisplay === 'string' ? config.houseDisplay : row.brand,
    family: row.fragrance_family ?? undefined,
    gender: row.gender ?? undefined,
    concentration: row.concentration ?? undefined,
    image: resolveProductImageUrl(row.image_url),
    theme: readTheme(config),
    description: row.description,
    story: typeof config.story === 'string' ? config.story : '',
    notes: noteGroups,
    visual: readVisual(config),
    variants: (row.product_variants ?? [])
      .map(formatVariant)
      .sort((left, right) => left.sizeMl - right.sizeMl),
  };
}

export function resolveProductImageUrl(imageUrl: string): string {
  if (/^(https?:|data:|blob:)/i.test(imageUrl)) return imageUrl;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = imageUrl.replace(/^\/+/, '');
  return `${base}/${path}`;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function fetchPublicFragrances(): Promise<Fragrance[]> {
  const { data, error } = await getSupabaseClient()
    .from('products')
    .select(productSelect)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  throwIfError(error);
  return (data as unknown as ProductRecord[]).map(formatProduct);
}

export async function fetchAdminProducts(): Promise<ProductRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('products')
    .select(productSelect)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  throwIfError(error);
  return data as unknown as ProductRecord[];
}

export async function checkProductAdminAccess(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('nidor_is_product_admin');
  throwIfError(error);
  return data === true;
}

export async function requestAdminSignIn(email: string): Promise<void> {
  const redirectTo = buildAdminSignInRedirectUrl({
    currentOrigin: window.location.origin,
    basePath: import.meta.env.BASE_URL,
    replitDevDomain: import.meta.env.VITE_REPLIT_DEV_DOMAIN,
  });
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectTo,
    },
  });
  throwIfError(error);
}

export async function signOutAdmin(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  throwIfError(error);
}

export async function saveAdminProduct(draft: ProductDraft): Promise<ProductRecord> {
  const client = getSupabaseClient();
  const productPayload = {
    name: draft.name.trim(),
    slug: draft.slug.trim().toLowerCase(),
    brand: draft.brand.trim(),
    description: draft.description.trim(),
    fragrance_family: draft.fragranceFamily.trim() || null,
    gender: draft.gender.trim() || null,
    concentration: draft.concentration.trim() || null,
    top_notes: draft.topNotes,
    heart_notes: draft.heartNotes,
    base_notes: draft.baseNotes,
    mood: draft.mood.trim() || null,
    occasion: draft.occasion.trim() || null,
    season: draft.season.trim() || null,
    image_url: draft.imageUrl,
    theme_config: draft.themeConfig,
    is_active: draft.isActive,
    is_featured: draft.isFeatured,
    display_order: draft.displayOrder,
  };

  const productResult = draft.id
    ? await client.from('products').update(productPayload).eq('id', draft.id).select('id').single()
    : await client.from('products').insert(productPayload).select('id').single();

  if (productResult.error) throw new Error(productResult.error.message);
  const productId = productResult.data?.id;
  if (typeof productId !== 'string') {
    throw new Error('Supabase did not return the saved product ID.');
  }

  const variantRows = draft.variants.map((variant) => ({
    ...(variant.id ? { id: variant.id } : {}),
    product_id: productId,
    size_ml: variant.sizeMl,
    sku: `${productPayload.slug}-${variant.sizeMl}ml`,
    price_lkr: variant.priceNeedsConfiguration ? null : variant.priceLkr,
    price_needs_configuration: variant.priceNeedsConfiguration || variant.priceLkr === null,
    stock_quantity: variant.stockQuantity,
    stock_needs_configuration: variant.stockNeedsConfiguration,
    is_active: variant.isActive,
  }));

  const variantResult = await client
    .from('product_variants')
    .upsert(variantRows, { onConflict: 'product_id,size_ml' });

  if (variantResult.error) {
    throw new Error(
      `Product details were saved, but variant changes failed: ${variantResult.error.message}`,
    );
  }

  const { data, error } = await client
    .from('products')
    .select(productSelect)
    .eq('id', productId)
    .single();

  throwIfError(error);
  return data as unknown as ProductRecord;
}

const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maxProductImageBytes = 10 * 1024 * 1024;

export async function uploadProductImage(slug: string, file: File): Promise<string> {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  }
  if (file.size > maxProductImageBytes) {
    throw new Error('Product images must be 10 MB or smaller.');
  }

  const safeFilename = file.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'product-image';
  const objectPath = `${slug.trim().toLowerCase()}/${safeFilename}`;
  const { error } = await getSupabaseClient()
    .storage
    .from('product-images')
    .upload(objectPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: true,
    });

  throwIfError(error);
  return getSupabaseClient().storage.from('product-images').getPublicUrl(objectPath).data.publicUrl;
}

export async function uploadExistingProductImage(product: ProductRecord): Promise<string> {
  if (/\/storage\/v1\/object\/public\/product-images\//.test(product.image_url)) {
    throw new Error('This image is already stored in Supabase Storage.');
  }

  const response = await fetch(resolveProductImageUrl(product.image_url));
  if (!response.ok) throw new Error(`Could not read the current product image (${response.status}).`);

  const blob = await response.blob();
  const filename = product.image_url.split('/').pop() || `${product.slug}.png`;
  const file = new File([blob], filename, {
    type: blob.type || 'image/png',
  });
  return uploadProductImage(product.slug, file);
}