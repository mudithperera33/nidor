import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowDown, ArrowUp, Check, CircleAlert, Copy, FileImage, ImagePlus, LoaderCircle, LogOut, Package, Plus, Search, Sparkles, X } from 'lucide-react';
import { useAdminCatalog, useSaveAdminProduct } from '@/hooks/use-catalog';
import { createEmptyProductDraft, productToDraft, resolveProductImageUrl, uploadExistingProductImage, uploadProductImage, type ProductDraft, type ProductRecord } from '@/lib/product-catalog';
import { Form } from '@/components/ui/form';
import '../admin-products.css';

type AdminProductsDashboardProps = {
  userEmail: string;
  onSignOut: () => void;
};

type FilterMode = 'all' | 'active' | 'inactive' | 'featured';

const money = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return 'Not configured';
  return `LKR ${Number(value).toLocaleString('en-LK')}`;
};

const normalizeSlug = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '');

const splitNotes = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

export function AdminProductsDashboard({ userEmail, onSignOut }: AdminProductsDashboardProps) {
  const catalog = useAdminCatalog(true);
  const saveProduct = useSaveAdminProduct();
  const products = catalog.data ?? [];
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ProductRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesFilter = filter === 'all'
        || (filter === 'active' && product.is_active)
        || (filter === 'inactive' && !product.is_active)
        || (filter === 'featured' && product.is_featured);
      const matchesSearch = !query || [product.name, product.brand, product.slug, product.fragrance_family]
        .some((value) => value?.toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [products, filter, search]);

  const activeCount = products.filter((product) => product.is_active).length;
  const configuredCount = products.filter((product) => (product.product_variants ?? []).some((variant) => variant.is_active && !variant.price_needs_configuration && variant.price_lkr !== null)).length;

  const form = useForm<ProductDraft>({
    defaultValues: createEmptyProductDraft(Math.max(0, ...products.map((item) => item.display_order)) + 1),
    mode: 'onSubmit',
  });
  const values = form.watch();

  const beginNew = () => {
    setSelected(null);
    form.reset(createEmptyProductDraft(Math.max(0, ...products.map((item) => item.display_order)) + 1));
    setImageError('');
    setNotice('');
    setEditorOpen(true);
  };

  const beginEdit = (record: ProductRecord) => {
    setSelected(record);
    form.reset(productToDraft(record));
    setImageError('');
    setNotice('');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saveProduct.isPending || imageBusy) return;
    setEditorOpen(false);
    setSelected(null);
  };

  const updateVariant = (index: number, changes: Partial<ProductDraft['variants'][number]>) => {
    const variants = form.getValues('variants').map((variant, itemIndex) => itemIndex === index ? { ...variant, ...changes } : variant);
    form.setValue('variants', variants, { shouldDirty: true, shouldValidate: true });
  };

  const submit = form.handleSubmit(async (draft) => {
    setNotice('');
    const normalizedSlug = normalizeSlug(draft.slug);
    if (!normalizedSlug) {
      form.setError('slug', { type: 'manual', message: 'Add a URL-friendly slug.' });
      return;
    }
    if (!draft.imageUrl.trim()) {
      form.setError('imageUrl', { type: 'manual', message: 'Upload a product image before saving.' });
      return;
    }
    try {
      await saveProduct.mutateAsync({
        ...draft,
        slug: normalizedSlug,
        name: draft.name.trim(),
        brand: draft.brand.trim(),
        description: draft.description.trim(),
        variants: draft.variants.map((variant) => ({
          ...variant,
          priceLkr: variant.priceNeedsConfiguration ? null : variant.priceLkr,
          stockQuantity: variant.stockNeedsConfiguration ? 0 : Math.max(0, variant.stockQuantity),
        })),
      });
      setEditorOpen(false);
      setSelected(null);
      setNotice(`${draft.name.trim()} saved to the catalogue.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The product could not be saved. Try again.');
    }
  });

  const handleImage = async (file?: File) => {
    if (!file) return;
    const slug = normalizeSlug(form.getValues('slug'));
    if (!slug) {
      setImageError('Add a product slug before uploading its image.');
      return;
    }
    setImageBusy(true);
    setImageError('');
    try {
      const url = await uploadProductImage(slug, file);
      form.setValue('imageUrl', url, { shouldDirty: true, shouldValidate: true });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Image upload failed.');
    } finally {
      setImageBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const moveProduct = async (record: ProductRecord, direction: -1 | 1) => {
    const ordered = [...products].sort((a, b) => a.display_order - b.display_order);
    const index = ordered.findIndex((item) => item.id === record.id);
    const target = ordered[index + direction];
    if (!target) return;
    const currentDraft = productToDraft(record);
    const targetDraft = productToDraft(target);
    try {
      await Promise.all([
        saveProduct.mutateAsync({ ...currentDraft, displayOrder: target.display_order }),
        saveProduct.mutateAsync({ ...targetDraft, displayOrder: record.display_order }),
      ]);
      setNotice('Catalogue order updated.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Catalogue order could not be updated.');
    }
  };

  const uploadLegacyImage = async () => {
    if (!selected) return;
    setImageBusy(true);
    setImageError('');
    try {
      const url = await uploadExistingProductImage(selected);
      form.setValue('imageUrl', url, { shouldDirty: true });
      setNotice('Image copied into the product image library.');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not migrate this image.');
    } finally {
      setImageBusy(false);
    }
  };

  return (
    <main className="nidor-admin">
      <header className="na-topbar">
        <a className="na-wordmark" href="/" aria-label="NIDOR storefront">NIDOR<span> / STUDIO</span></a>
        <div className="na-account">
          <span className="na-account-email" data-testid="text-user-email">{userEmail}</span>
          <button className="na-signout" type="button" onClick={onSignOut} data-testid="button-sign-out"><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      <div className="na-layout">
        <aside className="na-rail" aria-label="Admin navigation">
          <div className="na-rail-label">Workspace</div>
          <div className="na-rail-current"><Package size={16} /><span>Catalogue</span><i /></div>
          <div className="na-rail-foot"><span className="na-live-dot" /> COLLECTION SYSTEMS<br /><b>OWNER ACCESS</b></div>
        </aside>

        <section className="na-content" aria-labelledby="na-title">
          <div className="na-heading-row">
            <div>
              <div className="na-eyebrow"><span /> NIDOR / PRODUCT OPERATIONS</div>
              <h1 id="na-title">Catalogue<span>.</span></h1>
              <p className="na-intro">Maintain the editions, their stories, and the details that make each one ready to leave the studio.</p>
            </div>
            <button type="button" className="na-primary-button" onClick={beginNew} data-testid="button-create-product"><Plus size={16} /> New product</button>
          </div>

          <div className="na-overview">
            <div className="na-stat"><span>Catalogue</span><strong data-testid="value-product-count">{catalog.isLoading ? '—' : String(products.length).padStart(2, '0')}</strong><small>total editions</small></div>
            <div className="na-stat"><span>Live</span><strong data-testid="value-active-count">{catalog.isLoading ? '—' : String(activeCount).padStart(2, '0')}</strong><small>visible on storefront</small></div>
            <div className="na-stat"><span>Price-ready</span><strong data-testid="value-priced-count">{catalog.isLoading ? '—' : String(configuredCount).padStart(2, '0')}</strong><small>with configured price</small></div>
            <div className="na-overview-note"><Sparkles size={15} /><span>Small-batch edits<br />make a lasting impression.</span></div>
          </div>

          <div className="na-toolbar">
            <div className="na-filter-tabs" role="tablist" aria-label="Filter products">
              {(['all', 'active', 'inactive', 'featured'] as FilterMode[]).map((mode) => (
                <button type="button" key={mode} role="tab" aria-selected={filter === mode} className={filter === mode ? 'is-selected' : ''} onClick={() => setFilter(mode)} data-testid={`filter-${mode}`}>
                  {mode === 'all' ? 'All editions' : mode === 'active' ? 'Live' : mode === 'inactive' ? 'Inactive' : 'Featured'}
                  {mode === 'all' && <span>{products.length}</span>}
                </button>
              ))}
            </div>
            <label className="na-search"><Search size={16} /><span className="sr-only">Search catalogue</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an edition" data-testid="input-search-products" /><kbd>⌘ K</kbd></label>
          </div>

          {notice && !editorOpen && <div className="na-toast" role="status" data-testid="status-save">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={15} /></button></div>}

          {catalog.isLoading && (
            <div className="na-loading" aria-label="Loading catalogue" data-testid="loading-catalogue">
              {[1, 2, 3].map((item) => <div className="na-skeleton-row" key={item}><i /><span /><span /><b /></div>)}
            </div>
          )}
          {catalog.isError && (
            <div className="na-state na-error" role="alert"><CircleAlert size={22} /><div><strong>Catalogue unavailable</strong><p>{catalog.error instanceof Error ? catalog.error.message : 'We could not load product data.'}</p><button type="button" onClick={() => catalog.refetch()} data-testid="button-retry-catalogue">Retry catalogue load</button></div></div>
          )}
          {!catalog.isLoading && !catalog.isError && visibleProducts.length === 0 && (
            <div className="na-state na-empty"><div className="na-empty-mark">N</div><strong>{products.length ? 'No editions match this view.' : 'A collection begins here.'}</strong><p>{products.length ? 'Try a different filter or search term.' : 'Create the first product record and shape its story.'}</p>{!products.length && <button className="na-primary-button" onClick={beginNew} data-testid="button-create-first-product"><Plus size={16} /> Create first product</button>}</div>
          )}
          {!catalog.isLoading && !catalog.isError && visibleProducts.length > 0 && (
            <div className="na-table-wrap">
              <table className="na-table">
                <thead><tr><th scope="col">Edition</th><th scope="col">Variants</th><th scope="col">Stock status</th><th scope="col">Visibility</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleProducts.map((product, index) => {
                    const variants = product.product_variants ?? [];
                    const activeVariants = variants.filter((variant) => variant.is_active);
                    const needsAttention = activeVariants.some((variant) => variant.price_needs_configuration || variant.stock_needs_configuration);
                    const stock = activeVariants.reduce((sum, variant) => sum + variant.stock_quantity, 0);
                    return <tr key={product.id} data-testid={`row-product-${product.id}`}>
                      <td><div className="na-product-cell">
                         <div className="na-thumb">{product.image_url ? <img src={resolveProductImageUrl(product.image_url)} alt="" loading="lazy" /> : <FileImage size={19} />}</div>
                        <div className="na-product-info"><strong data-testid={`text-product-name-${product.id}`}>{product.name || 'Untitled edition'}</strong><span>{product.brand} <i /> {product.fragrance_family || 'Family not set'}</span><small>/{product.slug}</small></div>
                      </div></td>
                      <td><div className="na-variant-summary">{[5, 10].map((size) => {
                        const variant = variants.find((item) => item.size_ml === size);
                        return <span key={size} className={!variant?.is_active ? 'is-muted' : ''}><b>{size} ml</b><small>{variant?.is_active ? money(variant.price_lkr) : 'Off'}</small></span>;
                      })}</div></td>
                      <td><span className={`na-stock ${needsAttention ? 'needs-attention' : 'is-ready'}`} data-testid={`status-stock-${product.id}`}><i />{needsAttention ? 'Needs setup' : `${stock} in stock`}</span></td>
                      <td><span className={`na-status ${product.is_active ? 'is-live' : ''}`} data-testid={`status-visibility-${product.id}`}>{product.is_active ? 'Live' : 'Inactive'}</span>{product.is_featured && <span className="na-featured">Featured</span>}</td>
                      <td><div className="na-row-actions">
                        <button type="button" onClick={() => moveProduct(product, -1)} aria-label={`Move ${product.name} earlier`} disabled={index === 0 || saveProduct.isPending} data-testid={`button-move-up-${product.id}`}><ArrowUp size={15} /></button>
                        <button type="button" onClick={() => moveProduct(product, 1)} aria-label={`Move ${product.name} later`} disabled={index === visibleProducts.length - 1 || saveProduct.isPending} data-testid={`button-move-down-${product.id}`}><ArrowDown size={15} /></button>
                        <button type="button" className="na-edit-link" onClick={() => beginEdit(product)} data-testid={`button-edit-${product.id}`}>Edit <span>↗</span></button>
                      </div></td>
                    </tr>;
                  })}
                </tbody>
              </table>
              <div className="na-table-foot"><span>Showing {visibleProducts.length} of {products.length} editions</span><span>DISPLAY ORDER / ASCENDING</span></div>
            </div>
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="na-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <section className="na-editor" role="dialog" aria-modal="true" aria-labelledby="na-editor-title">
            <div className="na-editor-head">
              <div><div className="na-eyebrow"><span /> {selected ? 'EDIT EDITION' : 'NEW EDITION'}</div><h2 id="na-editor-title">{selected ? selected.name : 'Compose a product'}</h2></div>
              <button className="na-close" type="button" onClick={closeEditor} aria-label="Close editor" data-testid="button-close-editor"><X size={19} /></button>
            </div>
            <Form {...form}>
              <form onSubmit={submit} className="na-editor-form">
                <div className="na-editor-scroll">
                  <section className="na-form-section">
                    <div className="na-section-heading"><span>01</span><div><h3>Product identity</h3><p>The details customers see first.</p></div></div>
                    <div className="na-form-grid">
                      <label className="na-field na-field-wide">Product name<input {...form.register('name', { required: 'Product name is required.' })} placeholder="e.g. In Still Bloom" data-testid="input-product-name" />{form.formState.errors.name && <small className="na-field-error">{form.formState.errors.name.message}</small>}</label>
                      <label className="na-field">URL slug<input {...form.register('slug', { required: 'A unique URL slug is required.' })} placeholder="in-still-bloom" data-testid="input-product-slug" />{form.formState.errors.slug && <small className="na-field-error">{form.formState.errors.slug.message}</small>}</label>
                      <label className="na-field">Brand<input {...form.register('brand', { required: 'Brand is required.' })} placeholder="NIDOR" data-testid="input-product-brand" />{form.formState.errors.brand && <small className="na-field-error">{form.formState.errors.brand.message}</small>}</label>
                      <label className="na-field na-field-wide">Description<textarea {...form.register('description', { required: 'A product description is required.' })} placeholder="A concise description of the fragrance..." rows={3} data-testid="input-product-description" />{form.formState.errors.description && <small className="na-field-error">{form.formState.errors.description.message}</small>}</label>
                      <label className="na-field">Fragrance family<input {...form.register('fragranceFamily')} placeholder="Floral / amber" data-testid="input-fragrance-family" /></label>
                      <label className="na-field">Gender<input {...form.register('gender')} placeholder="Unisex" data-testid="input-gender" /></label>
                      <label className="na-field">Concentration<input {...form.register('concentration')} placeholder="Eau de parfum" data-testid="input-concentration" /></label>
                      <label className="na-field">Display order<input type="number" min="1" {...form.register('displayOrder', { valueAsNumber: true, min: 1 })} data-testid="input-display-order" /></label>
                    </div>
                  </section>

                  <section className="na-form-section">
                    <div className="na-section-heading"><span>02</span><div><h3>Olfactory profile</h3><p>Separate notes with commas.</p></div></div>
                    <div className="na-form-grid na-notes-grid">
                      {([
                        ['topNotes', 'Top notes', 'Citrus, petitgrain'],
                        ['heartNotes', 'Heart notes', 'Jasmine, tea'],
                        ['baseNotes', 'Base notes', 'Musk, cedar'],
                      ] as const).map(([key, label, placeholder]) => <label className="na-field" key={key}>{label}<textarea value={(values[key] ?? []).join(', ')} onChange={(event) => form.setValue(key, splitNotes(event.target.value), { shouldDirty: true })} placeholder={placeholder} rows={2} data-testid={`input-${key}`} /></label>)}
                    </div>
                    <div className="na-form-grid na-meta-grid">
                      <label className="na-field">Mood<input {...form.register('mood')} placeholder="Quietly luminous" data-testid="input-mood" /></label>
                      <label className="na-field">Occasion<input {...form.register('occasion')} placeholder="After hours" data-testid="input-occasion" /></label>
                      <label className="na-field">Season<input {...form.register('season')} placeholder="Late summer" data-testid="input-season" /></label>
                    </div>
                  </section>

                  <section className="na-form-section">
                    <div className="na-section-heading"><span>03</span><div><h3>Image asset</h3><p>Use a clear product image, up to 10 MB.</p></div></div>
                    <div className="na-image-control">
                      {values.imageUrl ? <img className="na-image-preview" src={resolveProductImageUrl(values.imageUrl)} alt={`Preview of ${values.name || 'product'}`} data-testid="img-product-preview" /> : <div className="na-image-empty"><ImagePlus size={21} /><span>No image attached</span></div>}
                      <div className="na-image-actions"><strong>{values.imageUrl ? 'Current image' : 'Product image'}</strong><span>{values.imageUrl ? values.imageUrl.split('/').pop() : 'PNG, JPEG or WebP'}</span>
                        <div className="na-inline-buttons"><button type="button" onClick={() => fileInput.current?.click()} disabled={imageBusy} data-testid="button-upload-image">{imageBusy ? <LoaderCircle className="na-spin" size={14} /> : <ImagePlus size={14} />} Upload image</button>{selected && <button type="button" onClick={uploadLegacyImage} disabled={imageBusy} data-testid="button-migrate-image"><Copy size={14} /> Copy to library</button>}</div>
                        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleImage(event.target.files?.[0])} data-testid="input-product-image" />
                        {imageError && <small className="na-field-error" role="alert" data-testid="status-image-error">{imageError}</small>}
                        {form.formState.errors.imageUrl && <small className="na-field-error" role="alert">{form.formState.errors.imageUrl.message}</small>}
                      </div>
                    </div>
                  </section>

                  <section className="na-form-section">
                    <div className="na-section-heading"><span>04</span><div><h3>Variant &amp; inventory</h3><p>Unverified prices and stock remain unconfigured.</p></div></div>
                    <div className="na-variants">
                      {form.getValues('variants').map((variant, index) => <div className="na-variant-card" key={variant.sizeMl}>
                        <div className="na-variant-title"><strong>{variant.sizeMl} ml</strong><span>FORMAT {String(index + 1).padStart(2, '0')}</span><label className="na-switch"><input type="checkbox" checked={variant.isActive} onChange={(event) => updateVariant(index, { isActive: event.target.checked })} data-testid={`toggle-variant-active-${variant.sizeMl}`} /><i /><span>{variant.isActive ? 'Available' : 'Paused'}</span></label></div>
                        <div className="na-variant-fields">
                          <label className={`na-field ${variant.priceNeedsConfiguration ? 'na-disabled-field' : ''}`}>Price (LKR)<input type="number" min="0" step="0.01" value={variant.priceLkr ?? ''} disabled={variant.priceNeedsConfiguration} onChange={(event) => updateVariant(index, { priceLkr: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Not configured" data-testid={`input-variant-price-${variant.sizeMl}`} /><span className="na-check-control"><input type="checkbox" checked={variant.priceNeedsConfiguration} onChange={(event) => updateVariant(index, { priceNeedsConfiguration: event.target.checked, priceLkr: event.target.checked ? null : variant.priceLkr })} data-testid={`toggle-price-unconfigured-${variant.sizeMl}`} /> Price needs configuration</span></label>
                          <label className={`na-field ${variant.stockNeedsConfiguration ? 'na-disabled-field' : ''}`}>Stock quantity<input type="number" min="0" value={variant.stockQuantity} disabled={variant.stockNeedsConfiguration} onChange={(event) => updateVariant(index, { stockQuantity: Math.max(0, Number(event.target.value)) })} data-testid={`input-variant-stock-${variant.sizeMl}`} /><span className="na-check-control"><input type="checkbox" checked={variant.stockNeedsConfiguration} onChange={(event) => updateVariant(index, { stockNeedsConfiguration: event.target.checked, stockQuantity: event.target.checked ? 0 : variant.stockQuantity })} data-testid={`toggle-stock-unconfigured-${variant.sizeMl}`} /> Stock needs verification</span></label>
                        </div>
                      </div>)}
                    </div>
                  </section>

                  <section className="na-form-section na-publish-section">
                    <div className="na-section-heading"><span>05</span><div><h3>Storefront status</h3><p>Inactive editions stay safely in the catalogue.</p></div></div>
                    <label className="na-status-choice"><span><strong>Publish edition</strong><small>Make this product visible in the collection.</small></span><input type="checkbox" {...form.register('isActive')} data-testid="toggle-product-active" /><i /></label>
                    <label className="na-status-choice"><span><strong>Feature this edition</strong><small>Give it featured placement in the collection.</small></span><input type="checkbox" {...form.register('isFeatured')} data-testid="toggle-product-featured" /><i /></label>
                  </section>
                </div>
                <footer className="na-editor-footer">
                  {notice && <span className="na-form-notice" role="alert" data-testid="status-editor">{notice}</span>}
                  <button type="button" className="na-secondary-button" onClick={closeEditor} disabled={saveProduct.isPending || imageBusy} data-testid="button-cancel-edit">Cancel</button>
                  <button type="submit" className="na-primary-button" disabled={saveProduct.isPending || imageBusy} data-testid="button-save-product">{saveProduct.isPending ? <LoaderCircle className="na-spin" size={15} /> : <Check size={15} />}{saveProduct.isPending ? 'Saving' : 'Save product'}</button>
                </footer>
              </form>
            </Form>
          </section>
        </div>
      )}
    </main>
  );
}

export default AdminProductsDashboard;