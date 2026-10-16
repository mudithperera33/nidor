import assert from 'node:assert/strict';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import { test } from 'node:test';
import {
  adminCatalogQueryKey,
  createSaveAdminProductMutationOptions,
} from '@/hooks/use-catalog';
import {
  createEmptyProductDraft,
  productDraftToFragrance,
  productToDraft,
  saveAdminProduct,
  validateProductDraft,
  validateProductImageFile,
  type ProductRecord,
  type ProductVariantRecord,
} from '@/lib/product-catalog';
import type { SupabaseClient } from '@supabase/supabase-js';

type MockResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type MockQuery = {
  update: (payload: Record<string, unknown>) => MockQuery;
  select: (columns?: string) => MockQuery;
  eq: (column: string, value: string) => MockQuery;
  limit: (count: number) => Promise<MockResult>;
  single: () => Promise<MockResult>;
  then: PromiseLike<MockResult>['then'];
};

type MockCatalogState = {
  product: ProductRecord;
  variants: ProductVariantRecord[];
  failVariantId?: string;
};

test('draft preview uses current editor fields and configured 5 ml and 10 ml values', () => {
  const draft = createEmptyProductDraft(4);
  draft.name = 'Still Bloom';
  draft.slug = 'still-bloom';
  draft.brand = 'NIDOR';
  draft.description = 'A quiet floral fragrance.';
  draft.topNotes = ['Citrus'];
  draft.heartNotes = ['Jasmine'];
  draft.baseNotes = ['Musk'];
  draft.themeConfig = {
    ...draft.themeConfig,
    story: 'A garden after rain.',
    theme: { surface: '#e0e5dc', deep: '#26352d', accent: '#b8894a', light: true },
  };
  draft.variants[0] = {
    ...draft.variants[0]!,
    priceLkr: 1250,
    priceNeedsConfiguration: false,
    stockQuantity: 4,
    stockNeedsConfiguration: false,
  };
  draft.variants[1] = {
    ...draft.variants[1]!,
    priceLkr: 2500,
    priceNeedsConfiguration: false,
    stockQuantity: 0,
    stockNeedsConfiguration: false,
  };

  const preview = productDraftToFragrance(draft, 'blob:staged-image');

  assert.equal(preview.name, 'Still Bloom');
  assert.equal(preview.image, 'blob:staged-image');
  assert.equal(preview.story, 'A garden after rain.');
  assert.deepEqual(preview.notes.map((group) => group.notes), [['Citrus'], ['Jasmine'], ['Musk']]);
  assert.deepEqual(
    preview.variants.map(({ sizeMl, priceLkr, stockQuantity }) => ({ sizeMl, priceLkr, stockQuantity })),
    [
      { sizeMl: 5, priceLkr: 1250, stockQuantity: 4 },
      { sizeMl: 10, priceLkr: 2500, stockQuantity: 0 },
    ],
  );
  assert.equal(preview.theme.surface, '#e0e5dc');
});

function createMockSupabase(state: MockCatalogState): SupabaseClient {
  return {
    from(table: string) {
      let action: 'select' | 'update' = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Record<string, string> = {};

      const execute = (): MockResult => {
        if (table === 'products' && action === 'update') {
          state.product = { ...state.product, ...payload } as ProductRecord;
          return { data: { id: state.product.id }, error: null };
        }

        if (table === 'product_variants' && action === 'update') {
          const row = state.variants.find((item) => item.id === filters.id);
          if (!row || row.product_id !== filters.product_id) {
            return { data: null, error: { message: 'Variant not found.' } };
          }
          if (state.failVariantId === row.id) {
            state.failVariantId = undefined;
            return { data: null, error: { message: 'Simulated variant write failure.' } };
          }
          const nextVariantType = payload.variant_type ?? row.variant_type ?? 'decant';
          const conflictingVariant = state.variants.find((item) =>
            item.id !== row.id
            && item.product_id === row.product_id
            && (item.variant_type ?? 'decant') === nextVariantType
            && item.size_ml === payload.size_ml,
          );
          if (conflictingVariant) {
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "product_variants_product_id_variant_type_size_ml_key"',
              },
            };
          }
          Object.assign(row, payload);
          return { data: null, error: null };
        }

        if (table === 'products') {
          return {
            data: {
              ...state.product,
              product_variants: state.variants.map((item) => ({ ...item })),
            },
            error: null,
          };
        }

        return { data: null, error: null };
      };

      const query = {} as MockQuery;
      Object.assign(query, {
        update(nextPayload: Record<string, unknown>) {
          action = 'update';
          payload = nextPayload;
          return query;
        },
        select() {
          return query;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return query;
        },
        limit() {
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          return Promise.resolve(execute());
        },
        then(resolve: (value: MockResult) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve, reject);
        },
      });
      return query;
    },
  } as unknown as SupabaseClient;
}

function variant(
  id: string,
  variantType: 'decant' | 'full_bottle',
  sizeMl: number,
  stockQuantity: number,
): ProductVariantRecord {
  return {
    id,
    product_id: 'quiet-garden',
    variant_type: variantType,
    size_ml: sizeMl,
    sku: `${id}-sku`,
    price_lkr: 1000,
    price_needs_configuration: false,
    stock_quantity: stockQuantity,
    stock_needs_configuration: false,
    low_stock_threshold: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function product(variants: ProductVariantRecord[]): ProductRecord {
  return {
    id: 'quiet-garden',
    name: 'Quiet Garden',
    slug: 'quiet-garden',
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
  };
}

type CreationMockState = {
  slug: string;
  product: ProductRecord;
  duplicateSlug?: boolean;
  rpcError?: { message: string; code?: string };
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  directWriteCount: number;
  storageEvents: string[];
  uploadedBucket?: string;
  uploadedFile?: File;
  uploadedObjectPath?: string;
  uploadOptions?: { cacheControl: string; contentType: string; upsert: boolean };
  removedObjectPaths: string[];
};

function createMockCreationSupabase(state: CreationMockState): SupabaseClient {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const query = {} as Record<string, (...args: any[]) => any>;
      Object.assign(query, {
        select() {
          return query;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return query;
        },
        limit() {
          if (table === 'products' && filters.slug === state.slug && state.duplicateSlug) {
            return Promise.resolve({ data: [{ id: 'existing-product' }], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          return Promise.resolve({
            data: filters.id === state.product.id ? state.product : null,
            error: filters.id === state.product.id ? null : { message: 'Product not found.' },
          });
        },
        insert() {
          state.directWriteCount += 1;
          return query;
        },
        update() {
          state.directWriteCount += 1;
          return query;
        },
        upsert() {
          state.directWriteCount += 1;
          return query;
        },
      });
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.storageEvents.push('rpc');
      state.rpcCalls.push({ name, args });
      return Promise.resolve(state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: state.product.id, error: null });
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, file: File, options: CreationMockState['uploadOptions']) {
            state.storageEvents.push('upload');
            state.uploadedBucket = bucket;
            state.uploadedFile = file;
            state.uploadedObjectPath = path;
            state.uploadOptions = options;
            return Promise.resolve({ data: { path }, error: null });
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
          remove(paths: string[]) {
            state.storageEvents.push('remove');
            state.removedObjectPaths.push(...paths);
            return Promise.resolve({ data: { paths }, error: null });
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}

function creationDraft() {
  const draft = createEmptyProductDraft(6);
  draft.name = 'New Test Perfume';
  draft.brand = 'NIDOR Test';
  draft.slug = 'new-test-perfume';
  draft.imageUrl = 'https://test.supabase.co/storage/v1/object/public/product-images/new-test-perfume/test.png';
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 5)!.priceLkr = 1200;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 5)!.priceNeedsConfiguration = false;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 5)!.stockQuantity = 2;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 5)!.stockNeedsConfiguration = false;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!.priceLkr = 2000;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!.priceNeedsConfiguration = false;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!.stockQuantity = 0;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!.stockNeedsConfiguration = false;
  return draft;
}

function creationMockState(slug = 'new-test-perfume'): CreationMockState {
  const created = product([
    variant('created-decant-5', 'decant', 5, 2),
    variant('created-decant-10', 'decant', 10, 0),
  ]);
  created.id = 'new-perfume-id';
  created.slug = slug;
  created.name = 'New Test Perfume';
  created.is_active = false;
  created.product_variants!.forEach((item) => {
    item.product_id = created.id;
    item.price_needs_configuration = false;
    item.stock_needs_configuration = false;
  });
  return {
    slug,
    product: created,
    rpcCalls: [],
    directWriteCount: 0,
    storageEvents: [],
    removedObjectPaths: [],
  };
}

test('a partial variant failure is reported, refreshed, and can be retried', async () => {
  const initialProduct = product([
    variant('decant-5', 'decant', 5, 7),
    variant('decant-10', 'decant', 10, 0),
    variant('bottle-50', 'full_bottle', 50, 3),
  ]);
  const state: MockCatalogState = {
    product: initialProduct,
    variants: initialProduct.product_variants!.map((item) => ({ ...item })),
    failVariantId: 'decant-10',
  };
  const fakeClient = createMockSupabase(state);
  const queryClient = new QueryClient();
  queryClient.setQueryData(adminCatalogQueryKey, [initialProduct]);
  const listObserver = new QueryObserver(queryClient, {
    queryKey: adminCatalogQueryKey,
    queryFn: async () => [{
      ...state.product,
      product_variants: state.variants.map((item) => ({ ...item })),
    }],
    staleTime: Infinity,
  });
  const unsubscribe = listObserver.subscribe(() => {});
  const draft = productToDraft(initialProduct);
  draft.name = 'Quiet Garden Updated';
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 5)!.stockQuantity = 9;
  draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!.stockQuantity = 6;
  draft.variants.find((item) => item.variantType === 'full_bottle')!.stockQuantity = 4;
  const mutation = new MutationObserver(queryClient, createSaveAdminProductMutationOptions(
    queryClient,
    ({ draft: savedDraft, imageFile }) => saveAdminProduct(savedDraft, fakeClient, imageFile),
  ));

  try {
    await assert.rejects(
      mutation.mutate({ draft }),
      /Product details were saved, but a later variant update failed\. Earlier variant changes may also have been saved: Simulated variant write failure\./,
    );

    const afterPartialSave = queryClient.getQueryData<ProductRecord[]>(adminCatalogQueryKey)?.[0];
    assert.equal(afterPartialSave?.name, 'Quiet Garden Updated');
    assert.deepEqual(afterPartialSave?.product_variants?.map((item) => item.stock_quantity), [9, 0, 3]);

    await mutation.mutate({ draft });

    const afterRetry = queryClient.getQueryData<ProductRecord[]>(adminCatalogQueryKey)?.[0];
    assert.equal(afterRetry?.name, 'Quiet Garden Updated');
    assert.deepEqual(afterRetry?.product_variants?.map((item) => item.stock_quantity), [9, 6, 4]);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});

test('changing a full-bottle volume updates its existing variant and preserves its stock', async () => {
  const initialProduct = product([
    variant('decant-5', 'decant', 5, 7),
    variant('decant-10', 'decant', 10, 2),
    variant('bottle-50', 'full_bottle', 50, 3),
  ]);
  const state: MockCatalogState = {
    product: initialProduct,
    variants: initialProduct.product_variants!.map((item) => ({ ...item })),
  };
  const draft = productToDraft(initialProduct);
  const bottleDraft = draft.variants.find((item) => item.variantType === 'full_bottle')!;
  bottleDraft.sizeMl = 100;

  const saved = await saveAdminProduct(draft, createMockSupabase(state));
  const savedBottle = state.variants.find((item) => item.id === 'bottle-50');
  const reloadedBottle = saved.product_variants?.find((item) => item.variant_type === 'full_bottle');

  assert.equal(savedBottle?.id, 'bottle-50');
  assert.equal(savedBottle?.size_ml, 100);
  assert.equal(savedBottle?.stock_quantity, 3);
  assert.equal(state.variants.find((item) => item.id === 'decant-5')?.stock_quantity, 7);
  assert.equal(reloadedBottle?.id, 'bottle-50');
  assert.equal(reloadedBottle?.size_ml, 100);
  assert.equal(reloadedBottle?.stock_quantity, 3);
  const reloadedDraftBottle = productToDraft(saved).variants.find((item) => item.variantType === 'full_bottle');
  assert.equal(reloadedDraftBottle?.id, 'bottle-50');
  assert.equal(reloadedDraftBottle?.sizeMl, 100);
  assert.equal(reloadedDraftBottle?.stockQuantity, 3);
});

test('a full-bottle volume conflict is rejected without changing either variant stock', async () => {
  const initialProduct = product([
    variant('decant-5', 'decant', 5, 7),
    variant('decant-10', 'decant', 10, 2),
    variant('bottle-50', 'full_bottle', 50, 3),
    variant('bottle-100', 'full_bottle', 100, 8),
  ]);
  const state: MockCatalogState = {
    product: initialProduct,
    variants: initialProduct.product_variants!.map((item) => ({ ...item })),
  };
  const draft = productToDraft(initialProduct);
  const bottleDraft = draft.variants.find((item) => item.variantType === 'full_bottle')!;
  assert.equal(bottleDraft.id, 'bottle-50');
  bottleDraft.sizeMl = 100;

  await assert.rejects(
    saveAdminProduct(draft, createMockSupabase(state)),
    /Product details were saved, but a later variant update failed\. Earlier variant changes may also have been saved: duplicate key value violates unique constraint/,
  );
  assert.deepEqual(
    state.variants.map(({ id, size_ml, stock_quantity }) => ({ id, size_ml, stock_quantity })),
    [
      { id: 'decant-5', size_ml: 5, stock_quantity: 7 },
      { id: 'decant-10', size_ml: 10, stock_quantity: 2 },
      { id: 'bottle-50', size_ml: 50, stock_quantity: 3 },
      { id: 'bottle-100', size_ml: 100, stock_quantity: 8 },
    ],
  );
});

test('new perfume creation writes the product and required variants through one RPC', async () => {
  const draft = creationDraft();
  const state = creationMockState(draft.slug);
  const saved = await saveAdminProduct(draft, createMockCreationSupabase(state));

  assert.equal(saved.id, 'new-perfume-id');
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0]?.name, 'nidor_create_product_with_variants');
  assert.equal(state.directWriteCount, 0);

  const productPayload = state.rpcCalls[0]?.args.p_product as Record<string, unknown>;
  const variants = state.rpcCalls[0]?.args.p_variants as Array<Record<string, unknown>>;
  assert.equal(productPayload.slug, 'new-test-perfume');
  assert.equal(productPayload.description, '');
  assert.deepEqual(
    variants.map(({ variant_type, size_ml, price_lkr, stock_quantity }) =>
      ({ variant_type, size_ml, price_lkr, stock_quantity })),
    [
      { variant_type: 'decant', size_ml: 5, price_lkr: 1200, stock_quantity: 2 },
      { variant_type: 'decant', size_ml: 10, price_lkr: 2000, stock_quantity: 0 },
    ],
  );
});

test('a slug conflict is reported before the atomic creation RPC runs', async () => {
  const draft = creationDraft();
  const state = creationMockState(draft.slug);
  state.duplicateSlug = true;

  await assert.rejects(
    saveAdminProduct(draft, createMockCreationSupabase(state)),
    /That URL slug is already in use/,
  );
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.directWriteCount, 0);
});

test('an atomic creation RPC rejection never falls back to separate product or variant writes', async () => {
  const draft = creationDraft();
  const state = creationMockState(draft.slug);
  state.rpcError = { code: '23514', message: 'Simulated variant constraint failure.' };

  await assert.rejects(
    saveAdminProduct(draft, createMockCreationSupabase(state)),
    /Simulated variant constraint failure/,
  );
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.directWriteCount, 0);
});

test('draft validation allows zero stock but rejects invalid values and unsafe publishing', () => {
  const draft = creationDraft();
  const tenMl = draft.variants.find((item) => item.variantType === 'decant' && item.sizeMl === 10)!;
  tenMl.stockQuantity = 0;
  assert.equal(validateProductDraft(draft), null);

  tenMl.stockQuantity = -1;
  assert.match(validateProductDraft(draft) ?? '', /whole number of 0 or greater/);
  tenMl.stockQuantity = 0;
  tenMl.priceLkr = 1.235;
  assert.match(validateProductDraft(draft) ?? '', /up to two decimal places/);
  tenMl.priceLkr = 2000;
  draft.isActive = true;
  draft.variants.forEach((item) => {
    item.priceNeedsConfiguration = true;
    item.stockNeedsConfiguration = true;
  });
  assert.match(validateProductDraft(draft) ?? '', /Configure price and stock/);
});

test('image validation accepts PNG, JPEG, and WebP without transforming the file', () => {
  assert.equal(validateProductImageFile({ type: 'image/png', size: 1024 } as File), null);
  assert.equal(validateProductImageFile({ type: 'image/jpeg', size: 1024 } as File), null);
  assert.equal(validateProductImageFile({ type: 'image/webp', size: 1024 } as File), null);
  assert.match(validateProductImageFile({ type: 'image/svg+xml', size: 1024 } as File) ?? '', /PNG, JPEG, or WebP/);
  assert.match(validateProductImageFile({ type: 'image/png', size: 11 * 1024 * 1024 } as File) ?? '', /10 MB or smaller/);
});

test('product images upload unchanged to a unique object path before creation and are cleaned after a database rejection', async () => {
  const draft = creationDraft();
  const pngFile = { name: 'transparent image.png', type: 'image/png', size: 2048 } as File;
  const state = creationMockState(draft.slug);
  await saveAdminProduct(draft, createMockCreationSupabase(state), pngFile);

  assert.deepEqual(state.storageEvents, ['upload', 'rpc']);
  assert.equal(state.uploadedBucket, 'product-images');
  assert.equal(state.uploadedFile, pngFile);
  assert.equal(state.uploadOptions?.contentType, 'image/png');
  assert.equal(state.uploadOptions?.upsert, false);
  assert.match(state.uploadedObjectPath ?? '', /^new-test-perfume\/[a-f0-9-]+-transparent-image\.png$/);
  assert.match(
    String(state.rpcCalls[0]?.args.p_product && (state.rpcCalls[0]?.args.p_product as Record<string, unknown>).image_url),
    /\/storage\/v1\/object\/public\/product-images\/new-test-perfume\//,
  );

  const rejectedState = creationMockState(draft.slug);
  rejectedState.rpcError = { code: '23514', message: 'Simulated variant constraint failure.' };
  await assert.rejects(
    saveAdminProduct(draft, createMockCreationSupabase(rejectedState), pngFile),
  );
  assert.deepEqual(rejectedState.storageEvents, ['upload', 'rpc', 'remove']);
  assert.equal(rejectedState.removedObjectPaths[0], rejectedState.uploadedObjectPath);
});
