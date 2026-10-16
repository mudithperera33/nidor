import type { Fragrance, FragranceTheme, FragranceVariant, FragranceVisualConfig, NoteGroup } from '@/data/fragrances';
import { getSupabaseClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductVariantType = 'decant' | 'full_bottle';

export type ProductVariantRecord = {
  id: string;
  product_id: string;
  variant_type?: ProductVariantType;
  size_ml: number;
  sku: string;
  price_lkr: number | string | null;
  price_needs_configuration: boolean;
  stock_quantity: number;
  stock_needs_configuration: boolean;
  low_stock_threshold?: number | null;
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
  variantType: ProductVariantType;
  sizeMl: number | null;
  originalSizeMl?: number | null;
  sku: string;
  priceLkr: number | null;
  priceNeedsConfiguration: boolean;
  stockQuantity: number;
  stockNeedsConfiguration: boolean;
  lowStockThreshold: number | null;
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

export type UploadedProductImage = {
  path: string;
  publicUrl: string;
};

const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateProductDraft(
  draft: ProductDraft,
  hasPendingImage = false,
): string | null {
  if (!draft.name.trim()) return 'Perfume name is required.';
  if (!draft.brand.trim()) return 'Brand is required.';
  if (!validSlug.test(draft.slug.trim().toLowerCase())) {
    return 'Use a URL slug with lowercase letters, numbers, and hyphens.';
  }
  if (!hasPendingImage && !draft.imageUrl.trim()) return 'Upload a product image before saving.';
  if (!Number.isInteger(draft.displayOrder) || draft.displayOrder < 0) {
    return 'Display order must be a whole number of 0 or greater.';
  }
  if (draft.gender && !['Men', 'Women', 'Unisex'].includes(draft.gender)) {
    return 'Choose Men, Women, or Unisex for the audience.';
  }

  for (const sizeMl of [5, 10]) {
    if (!draft.variants.some((variant) => variant.variantType === 'decant' && variant.sizeMl === sizeMl)) {
      return `Add the required ${sizeMl} ml decant format.`;
    }
  }

  const seenFormats = new Set<string>();
  for (const variant of draft.variants) {
    if (variant.variantType === 'full_bottle' && variant.sizeMl === null) {
      if (variant.isActive) return 'Enter the actual full-bottle volume in ml, or pause this option.';
      continue;
    }
    if (!Number.isInteger(variant.sizeMl) || (variant.sizeMl ?? 0) < 1) {
      return 'Variant volumes must be positive whole numbers of ml.';
    }
    if (variant.variantType === 'decant' && variant.sizeMl !== 5 && variant.sizeMl !== 10) {
      return 'Decant sizes must be 5 ml or 10 ml.';
    }
    const key = `${variant.variantType}:${variant.sizeMl}`;
    if (seenFormats.has(key)) return 'Each perfume can have only one variant for each format and volume.';
    seenFormats.add(key);

    if (!variant.priceNeedsConfiguration) {
      const price = variant.priceLkr;
      if (price === null || !Number.isFinite(price) || price < 0
        || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) {
        return `${variant.sizeMl} ml price must be a nonnegative LKR amount with up to two decimal places.`;
      }
    }
    if (!variant.stockNeedsConfiguration
      && (!Number.isInteger(variant.stockQuantity) || variant.stockQuantity < 0)) {
      return `${variant.sizeMl} ml stock must be a whole number of 0 or greater.`;
    }
    if (variant.lowStockThreshold !== null
      && (!Number.isInteger(variant.lowStockThreshold) || variant.lowStockThreshold < 0)) {
      return 'Low-stock thresholds must be whole numbers of 0 or greater.';
    }
  }

  if (!draft.id && draft.isActive && !draft.variants.some((variant) =>
    variant.isActive
    && !variant.priceNeedsConfiguration
    && variant.priceLkr !== null
    && !variant.stockNeedsConfiguration,
  )) {
    return 'Configure price and stock for at least one active format before publishing.';
  }
  return null;
}

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
        variantType: 'decant',
        sizeMl: 5,
        sku: '',
        priceLkr: null,
        priceNeedsConfiguration: true,
        stockQuantity: 0,
        stockNeedsConfiguration: true,
        lowStockThreshold: null,
        isActive: true,
      },
      {
        variantType: 'decant',
        sizeMl: 10,
        sku: '',
        priceLkr: null,
        priceNeedsConfiguration: true,
        stockQuantity: 0,
        stockNeedsConfiguration: true,
        lowStockThreshold: null,
        isActive: true,
      },
      {
        variantType: 'full_bottle',
        sizeMl: null,
        originalSizeMl: null,
        sku: '',
        priceLkr: null,
        priceNeedsConfiguration: true,
        stockQuantity: 0,
        stockNeedsConfiguration: true,
        lowStockThreshold: null,
        isActive: false,
      },
    ],
  };
}

export function productToDraft(product: ProductRecord): ProductDraft {
  const variants = product.product_variants ?? [];
  const decants = ([5, 10] as const).map((sizeMl) => {
    const variant = variants.find((item) => (item.variant_type ?? 'decant') === 'decant' && item.size_ml === sizeMl);
    return {
      ...(variant ? { id: variant.id } : {}),
      variantType: 'decant' as const,
      sizeMl,
      sku: variant?.sku ?? '',
      priceLkr: variant?.price_lkr === null || variant?.price_lkr === undefined
        ? null
        : Number(variant.price_lkr),
      priceNeedsConfiguration: variant?.price_needs_configuration ?? true,
      stockQuantity: variant?.stock_quantity ?? 0,
      stockNeedsConfiguration: variant?.stock_needs_configuration ?? true,
      lowStockThreshold: variant?.low_stock_threshold ?? null,
      isActive: variant?.is_active ?? false,
    };
  });
  const bottle = variants.find((item) => item.variant_type === 'full_bottle');
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
    variants: [
      ...decants,
      {
        ...(bottle ? { id: bottle.id } : {}),
        variantType: 'full_bottle',
        sizeMl: bottle?.size_ml ?? null,
        originalSizeMl: bottle?.size_ml ?? null,
        sku: bottle?.sku ?? '',
        priceLkr: bottle?.price_lkr === null || bottle?.price_lkr === undefined
          ? null
          : Number(bottle.price_lkr),
        priceNeedsConfiguration: bottle?.price_needs_configuration ?? true,
        stockQuantity: bottle?.stock_quantity ?? 0,
        stockNeedsConfiguration: bottle?.stock_needs_configuration ?? true,
        lowStockThreshold: bottle?.low_stock_threshold ?? null,
        isActive: bottle?.is_active ?? false,
      },
    ],
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
    variantType: row.variant_type ?? 'decant',
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
      .sort((left, right) => {
        if (left.variantType !== right.variantType) {
          return left.variantType === 'decant' ? -1 : 1;
        }
        return left.sizeMl - right.sizeMl;
      }),
    isFeatured: row.is_featured,
  };
}

export function productDraftToFragrance(draft: ProductDraft, imageOverride?: string): Fragrance {
  const config = objectValue(draft.themeConfig);
  const variants = draft.variants
    .filter((variant): variant is typeof variant & { sizeMl: number } =>
      Number.isInteger(variant.sizeMl) && (variant.sizeMl ?? 0) > 0,
    )
    .map((variant, index) => ({
      id: variant.id ?? `${(draft.id ?? draft.slug) || 'draft'}-${variant.variantType}-${variant.sizeMl}-${index}`,
      variantType: variant.variantType,
      sizeMl: variant.sizeMl,
      sku: variant.sku,
      priceLkr: variant.priceLkr,
      priceNeedsConfiguration: variant.priceNeedsConfiguration,
      stockQuantity: variant.stockQuantity,
      stockNeedsConfiguration: variant.stockNeedsConfiguration,
      isActive: variant.isActive,
    }))
    .sort((left, right) => {
      if (left.variantType !== right.variantType) {
        return left.variantType === 'decant' ? -1 : 1;
      }
      return left.sizeMl - right.sizeMl;
    });

  return {
    id: (draft.id ?? draft.slug) || 'draft-preview',
    slug: draft.slug || 'draft-preview',
    number: typeof config.number === 'string'
      ? config.number
      : String(draft.displayOrder).padStart(2, '0'),
    name: draft.name,
    brand: draft.brand,
    house: typeof config.houseDisplay === 'string' ? config.houseDisplay : draft.brand,
    family: draft.fragranceFamily || undefined,
    gender: draft.gender || undefined,
    concentration: draft.concentration || undefined,
    image: imageOverride ?? (draft.imageUrl ? resolveProductImageUrl(draft.imageUrl) : ''),
    theme: readTheme(config),
    description: draft.description,
    story: typeof config.story === 'string' ? config.story : '',
    notes: [
      { label: 'Top notes', notes: draft.topNotes },
      { label: 'Heart notes', notes: draft.heartNotes },
      { label: 'Base notes', notes: draft.baseNotes },
    ],
    visual: readVisual(config),
    variants,
    isFeatured: draft.isFeatured,
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

export async function assertProductSlugAvailable(
  slug: string,
  excludeProductId?: string,
  client: SupabaseClient = getSupabaseClient(),
): Promise<void> {
  const { data, error } = await client
    .from('products')
    .select('id')
    .eq('slug', slug)
    .limit(2);
  throwIfError(error);

  const matches = (data ?? []) as Array<{ id: string }>;
  if (matches.some((product) => product.id !== excludeProductId)) {
    throw new Error('That URL slug is already in use. Choose a different slug.');
  }
}

function formatProductCreationError(error: { message: string; code?: string }): string {
  if (error.code === 'PGRST202' || error.code === '42883') {
    return 'The atomic product-creation migration is not available yet. Apply the pending NIDOR catalog migrations, then try again.';
  }
  if (error.code === '23505' && error.message.includes('products_slug_key')) {
    return 'That URL slug is already in use. Choose a different slug.';
  }
  if (error.code === '23505' && error.message.includes('product_variants_sku_key')) {
    return 'That SKU is already in use. Enter a different SKU for this format.';
  }
  return error.message;
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
  const redirectTo = new URL(
    `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}admin/products`,
    window.location.origin,
  ).toString();
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

export async function saveAdminProduct(
  draft: ProductDraft,
  client: SupabaseClient = getSupabaseClient(),
  imageFile?: File,
): Promise<ProductRecord> {
  const validationError = validateProductDraft(draft, Boolean(imageFile));
  if (validationError) throw new Error(validationError);
  if (imageFile) {
    const imageValidationError = validateProductImageFile(imageFile);
    if (imageValidationError) throw new Error(imageValidationError);
  }

  const { error: typeColumnError } = await client
    .from('product_variants')
    .select('variant_type')
    .limit(0);
  const supportsVariantTypes = !typeColumnError;
  if (typeColumnError && typeColumnError.code !== 'PGRST204' && typeColumnError.code !== '42703') {
    throw new Error(typeColumnError.message);
  }
  if (!supportsVariantTypes && (!draft.id || draft.variants.some((variant) =>
    variant.variantType === 'full_bottle' && variant.sizeMl !== null,
  ))) {
    throw new Error('Apply the full-bottle catalog migration before saving product variants.');
  }

  const { error: thresholdColumnError } = await client
    .from('product_variants')
    .select('low_stock_threshold')
    .limit(0);
  if (thresholdColumnError) {
    if (thresholdColumnError.code === 'PGRST204' || thresholdColumnError.code === '42703') {
      throw new Error('Apply the low-stock threshold migration before saving product variants.');
    }
    throw new Error(thresholdColumnError.message);
  }

  const productSlug = draft.slug.trim().toLowerCase();
  await assertProductSlugAvailable(productSlug, draft.id, client);

  const productPayload = {
    name: draft.name.trim(),
    slug: productSlug,
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

  const variantPayloads = draft.variants.flatMap((variant) => {
    const sizeMl = variant.sizeMl ?? (variant.id ? variant.originalSizeMl ?? null : null);
    if (sizeMl === null) return [];
    const variantType = variant.variantType;
    const autoSku = variantType === 'full_bottle'
      ? `${productPayload.slug}-full-bottle-${sizeMl}ml`
      : `${productPayload.slug}-${sizeMl}ml`;
    return [{
      ...(variant.id ? { id: variant.id } : {}),
      ...(supportsVariantTypes ? { variant_type: variantType } : {}),
      size_ml: sizeMl,
      sku: variant.sku.trim() || autoSku,
      price_lkr: variant.priceNeedsConfiguration ? null : variant.priceLkr,
      price_needs_configuration: variant.priceNeedsConfiguration || variant.priceLkr === null,
      stock_quantity: variant.stockNeedsConfiguration ? 0 : variant.stockQuantity,
      stock_needs_configuration: variant.stockNeedsConfiguration,
      low_stock_threshold: variant.lowStockThreshold,
      is_active: variant.sizeMl === null && variant.id ? false : variant.isActive,
    }];
  });

  const uploadedImage = imageFile
    ? await uploadProductImageAsset(productSlug, imageFile, client)
    : null;
  productPayload.image_url = uploadedImage?.publicUrl ?? draft.imageUrl.trim();

  if (!draft.id) {
    if (!supportsVariantTypes) {
      throw new Error('Apply the full-bottle catalog migration before adding a perfume.');
    }
    const createVariants = variantPayloads.map((row) => {
      const { id, ...variant } = row;
      if (id) throw new Error('A new perfume cannot reuse existing variant IDs.');
      return variant;
    });
    const { data: createdId, error: createError } = await client.rpc(
      'nidor_create_product_with_variants',
      {
        p_product: productPayload,
        p_variants: createVariants,
      },
    );

    if (createError) {
      const message = formatProductCreationError(createError);
      if (uploadedImage && createError.code) {
        try {
          await removeProductImage(uploadedImage.path, client);
        } catch (cleanupError) {
          throw new Error(
            `${message} The database rejected the creation, but the uploaded image could not be removed: ${
              cleanupError instanceof Error ? cleanupError.message : 'unknown storage error'
            }`,
          );
        }
      } else if (uploadedImage) {
        throw new Error(
          `${message} The save outcome could not be confirmed, so the uploaded image was kept. Refresh the catalogue before retrying.`,
        );
      }
      throw new Error(message);
    }

    if (typeof createdId !== 'string') {
      throw new Error('The creation request returned no product ID. Refresh the catalogue before retrying.');
    }
    const { data, error } = await client
      .from('products')
      .select(productSelect)
      .eq('id', createdId)
      .single();
    if (error) {
      throw new Error(`Product and variants were created, but the product could not be reloaded: ${error.message}`);
    }
    return data as unknown as ProductRecord;
  }

  const productResult = await client
    .from('products')
    .update(productPayload)
    .eq('id', draft.id)
    .select('id')
    .single();
  if (productResult.error) throw new Error(productResult.error.message);
  const productId = productResult.data?.id;
  if (typeof productId !== 'string') throw new Error('Supabase did not return the saved product ID.');

  const variantRows = variantPayloads.map((row) => ({ ...row, product_id: productId }));
  const existingRows = variantRows.filter((row) => 'id' in row && typeof row.id === 'string');
  const newRows = variantRows.filter((row) => !('id' in row) || typeof row.id !== 'string');
  for (const row of existingRows) {
    const { id, ...payload } = row;
    const { error } = await client.from('product_variants').update(payload).eq('id', id).eq('product_id', productId);
    if (error) {
      throw new Error(
        `Product details were saved, but a later variant update failed. Earlier variant changes may also have been saved: ${error.message}`,
      );
    }
  }
  if (newRows.length) {
    const { error } = await client.from('product_variants').upsert(newRows, {
      onConflict: supportsVariantTypes
        ? 'product_id,variant_type,size_ml'
        : 'product_id,size_ml',
    });
    if (error) {
      throw new Error(
        `Product details were saved, but new variant changes failed. Earlier variant changes may also have been saved: ${error.message}`,
      );
    }
  }

  const { data, error } = await client
    .from('products')
    .select(productSelect)
    .eq('id', productId)
    .single();

  if (error) {
    throw new Error(`Product and variant changes were saved, but the updated product could not be reloaded: ${error.message}`);
  }
  return data as unknown as ProductRecord;
}

const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maxProductImageBytes = 10 * 1024 * 1024;

export function validateProductImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!acceptedImageTypes.has(file.type)) {
    return 'Choose a PNG, JPEG, or WebP image.';
  }
  if (file.size > maxProductImageBytes) {
    return 'Product images must be 10 MB or smaller.';
  }
  return null;
}

export async function uploadProductImageAsset(
  slug: string,
  file: File,
  client: SupabaseClient = getSupabaseClient(),
): Promise<UploadedProductImage> {
  const validationError = validateProductImageFile(file);
  if (validationError) throw new Error(validationError);
  const safeFilename = file.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'product-image';
  const objectPath = `${slug.trim().toLowerCase()}/${crypto.randomUUID()}-${safeFilename}`;
  const bucket = client.storage.from('product-images');
  const { error } = await bucket.upload(objectPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  throwIfError(error);
  return {
    path: objectPath,
    publicUrl: bucket.getPublicUrl(objectPath).data.publicUrl,
  };
}

export async function uploadProductImage(slug: string, file: File): Promise<string> {
  const uploaded = await uploadProductImageAsset(slug, file);
  return uploaded.publicUrl;
}

export async function removeProductImage(
  path: string,
  client: SupabaseClient = getSupabaseClient(),
): Promise<void> {
  const { error } = await client.storage.from('product-images').remove([path]);
  throwIfError(error);
}

export async function downloadExistingProductImage(product: ProductRecord): Promise<File> {
  if (/\/storage\/v1\/object\/public\/product-images\//.test(product.image_url)) {
    throw new Error('This image is already stored in Supabase Storage.');
  }

  const response = await fetch(resolveProductImageUrl(product.image_url));
  if (!response.ok) throw new Error(`Could not read the current product image (${response.status}).`);

  const blob = await response.blob();
  const filename = product.image_url.split('/').pop() || `${product.slug}.png`;
  return new File([blob], filename, {
    type: blob.type || 'image/png',
  });
}
