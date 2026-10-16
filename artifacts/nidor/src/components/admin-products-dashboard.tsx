import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowDown, ArrowUp, Check, CircleAlert, Copy, Eye, FileImage, ImagePlus, LoaderCircle, LogOut, MailCheck, Package, Plus, Search, Sparkles, X } from 'lucide-react';
import { useAdminCatalog, useSaveAdminProduct } from '@/hooks/use-catalog';
import { createEmptyProductDraft, downloadExistingProductImage, productDraftToFragrance, productToDraft, resolveProductImageUrl, validateProductDraft, validateProductImageFile, type ProductDraft, type ProductRecord } from '@/lib/product-catalog';
import { AdminProductStockSummary } from '@/components/admin-product-stock-summary';
import AdminReceiptEmailRetries from '@/components/admin-receipt-email-retries';
import { FragranceExperience } from '@/components/fragrance-experience';
import { Form } from '@/components/ui/form';
import '../admin-products.css';

type AdminProductsDashboardProps = {
  userEmail: string;
  onSignOut: () => void;
};

type FilterMode = 'all' | 'active' | 'inactive' | 'featured';
type WorkspaceTab = 'catalogue' | 'receipts';

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
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('catalogue');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ProductRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState('');
  const [draggingImage, setDraggingImage] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewVariantId, setPreviewVariantId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const slugManuallyEdited = useRef(false);
  const previewWasOpen = useRef(false);

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
  const configuredCount = products.filter((product) => (product.product_variants ?? []).some((variant) =>
    variant.is_active && !variant.price_needs_configuration && variant.price_lkr !== null
    && !variant.stock_needs_configuration,
  )).length;

  const form = useForm<ProductDraft>({
    defaultValues: createEmptyProductDraft(Math.max(0, ...products.map((item) => item.display_order)) + 1),
    mode: 'onSubmit',
  });
  const values = form.watch();

  const clearStagedImage = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPendingImage(null);
    setPendingImagePreview('');
    setDraggingImage(false);
  };

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (previewOpen) {
      previewScrollRef.current?.scrollTo({ top: 0 });
      previewScrollRef.current?.focus();
      previewWasOpen.current = true;
    } else if (previewWasOpen.current) {
      previewWasOpen.current = false;
      previewTriggerRef.current?.focus();
    }
  }, [previewOpen]);

  const beginNew = () => {
    clearStagedImage();
    slugManuallyEdited.current = false;
    setSelected(null);
    setPreviewOpen(false);
    form.reset(createEmptyProductDraft(Math.max(0, ...products.map((item) => item.display_order)) + 1));
    setImageError('');
    setNotice('');
    setEditorOpen(true);
  };

  const beginEdit = (record: ProductRecord) => {
    clearStagedImage();
    slugManuallyEdited.current = true;
    setSelected(record);
    setPreviewOpen(false);
    form.reset(productToDraft(record));
    setImageError('');
    setNotice('');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saveProduct.isPending || imageBusy) return;
    setPreviewOpen(false);
    clearStagedImage();
    setEditorOpen(false);
    setSelected(null);
  };

  const updateVariant = (index: number, changes: Partial<ProductDraft['variants'][number]>) => {
    const variants = form.getValues('variants').map((variant, itemIndex) => itemIndex === index ? { ...variant, ...changes } : variant);
    form.setValue('variants', variants, { shouldDirty: true, shouldValidate: true });
  };

  const nameRegistration = form.register('name', { required: 'Product name is required.' });
  const slugRegistration = form.register('slug', { required: 'A unique URL slug is required.' });

  const submit = form.handleSubmit(async (draft) => {
    setNotice('');
    const normalizedSlug = normalizeSlug(draft.slug);
    if (!normalizedSlug) {
      form.setError('slug', { type: 'manual', message: 'Add a URL-friendly slug.' });
      return;
    }
    const nextDraft = {
      ...draft,
      slug: normalizedSlug,
      name: draft.name.trim(),
      brand: draft.brand.trim(),
      description: draft.description.trim(),
      variants: draft.variants.map((variant) => ({
        ...variant,
        priceLkr: variant.priceNeedsConfiguration ? null : variant.priceLkr,
        stockQuantity: variant.stockNeedsConfiguration ? 0 : variant.stockQuantity,
      })),
    };
    const validationError = validateProductDraft(nextDraft, Boolean(pendingImage));
    if (validationError) {
      setNotice(validationError);
      return;
    }
    if (selected?.is_active && !nextDraft.isActive
      && !window.confirm(`Unpublish ${selected.name}? It will no longer appear in the public collection.`)) {
      return;
    }
    try {
      await saveProduct.mutateAsync({ draft: nextDraft, imageFile: pendingImage ?? undefined });
      clearStagedImage();
      setEditorOpen(false);
      setSelected(null);
      setNotice(`${nextDraft.name} saved to the catalogue.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The product could not be saved. Try again.');
    }
  });

  const handleImage = (file?: File) => {
    if (!file) return;
    const validationError = validateProductImageFile(file);
    if (validationError) {
      clearStagedImage();
      setImageError(validationError);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setPendingImage(file);
    setPendingImagePreview(previewUrl);
    setImageError('');
    form.clearErrors('imageUrl');
    if (fileInput.current) fileInput.current.value = '';
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
        saveProduct.mutateAsync({ draft: { ...currentDraft, displayOrder: target.display_order } }),
        saveProduct.mutateAsync({ draft: { ...targetDraft, displayOrder: record.display_order } }),
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
      const file = await downloadExistingProductImage(selected);
      handleImage(file);
      setNotice('Current image staged. Save the product to upload it to the image library.');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not migrate this image.');
    } finally {
      setImageBusy(false);
    }
  };

  const imagePreviewSrc = pendingImagePreview
    || (values.imageUrl ? resolveProductImageUrl(values.imageUrl) : '');
  const imageFilename = pendingImage?.name
    || (values.imageUrl ? values.imageUrl.split('/').pop() : 'PNG, JPEG or WebP');
  const previewFragrance = productDraftToFragrance(values, imagePreviewSrc);
  const initialPreviewVariantId = previewFragrance.variants.find((variant) =>
    variant.variantType === 'decant' && variant.sizeMl === 5,
  )?.id ?? previewFragrance.variants[0]?.id ?? '';
  const currentPreviewVariantId = previewFragrance.variants.some((variant) => variant.id === previewVariantId)
    ? previewVariantId
    : initialPreviewVariantId;

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
          <button type="button" className={`na-rail-current ${workspaceTab === 'catalogue' ? 'is-current' : ''}`} onClick={() => setWorkspaceTab('catalogue')}>
            <Package size={16} /><span>Catalogue</span>{workspaceTab === 'catalogue' && <i />}
          </button>
          <button type="button" className={`na-rail-current ${workspaceTab === 'receipts' ? 'is-current' : ''}`} onClick={() => setWorkspaceTab('receipts')}>
            <MailCheck size={16} /><span>Receipt emails</span>{workspaceTab === 'receipts' && <i />}
          </button>
          <div className="na-rail-foot"><span className="na-live-dot" /> COLLECTION SYSTEMS<br /><b>OWNER ACCESS</b></div>
        </aside>

        <section className="na-content" aria-label="NIDOR admin workspace">
          <div className="na-workspace-tabs" role="tablist" aria-label="Admin workspace">
            <button type="button" role="tab" aria-selected={workspaceTab === 'catalogue'} className={workspaceTab === 'catalogue' ? 'is-selected' : ''} onClick={() => setWorkspaceTab('catalogue')} data-testid="tab-admin-catalogue"><Package size={15} /> Catalogue</button>
            <button type="button" role="tab" aria-selected={workspaceTab === 'receipts'} className={workspaceTab === 'receipts' ? 'is-selected' : ''} onClick={() => setWorkspaceTab('receipts')} data-testid="tab-admin-receipts"><MailCheck size={15} /> Receipt emails</button>
          </div>
          {workspaceTab === 'catalogue' ? (
            <>
          <div className="na-heading-row">
            <div>
              <div className="na-eyebrow"><span /> NIDOR / PRODUCT OPERATIONS</div>
              <h1 id="na-title">Catalogue<span>.</span></h1>
              <p className="na-intro">Maintain the editions, their stories, and the details that make each one ready to leave the studio.</p>
            </div>
            <button type="button" className="na-primary-button" onClick={beginNew} data-testid="button-create-product"><Plus size={16} /> Add Perfume</button>
          </div>

          <div className="na-overview">
            <div className="na-stat"><span>Catalogue</span><strong data-testid="value-product-count">{catalog.isLoading ? '—' : String(products.length).padStart(2, '0')}</strong><small>total editions</small></div>
            <div className="na-stat"><span>Published</span><strong data-testid="value-active-count">{catalog.isLoading ? '—' : String(activeCount).padStart(2, '0')}</strong><small>visible on storefront</small></div>
            <div className="na-stat"><span>Price-ready</span><strong data-testid="value-priced-count">{catalog.isLoading ? '—' : String(configuredCount).padStart(2, '0')}</strong><small>with configured price</small></div>
            <div className="na-overview-note"><Sparkles size={15} /><span>Small-batch edits<br />make a lasting impression.</span></div>
          </div>

          <div className="na-toolbar">
            <div className="na-filter-tabs" role="tablist" aria-label="Filter products">
              {(['all', 'active', 'inactive', 'featured'] as FilterMode[]).map((mode) => (
                <button type="button" key={mode} role="tab" aria-selected={filter === mode} className={filter === mode ? 'is-selected' : ''} onClick={() => setFilter(mode)} data-testid={`filter-${mode}`}>
                  {mode === 'all' ? 'All perfumes' : mode === 'active' ? 'Published' : mode === 'inactive' ? 'Unpublished' : 'Featured'}
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
            <div className="na-state na-empty"><div className="na-empty-mark">N</div><strong>{products.length ? 'No perfumes match this view.' : 'A collection begins here.'}</strong><p>{products.length ? 'Try a different filter or search term.' : 'Add the first perfume to the catalogue.'}</p>{!products.length && <button className="na-primary-button" onClick={beginNew} data-testid="button-create-first-product"><Plus size={16} /> Add first perfume</button>}</div>
          )}
          {!catalog.isLoading && !catalog.isError && visibleProducts.length > 0 && (
            <div className="na-table-wrap">
              <table className="na-table">
                <thead><tr><th scope="col">Perfume</th><th scope="col">Variants</th><th scope="col">Stock status</th><th scope="col">Publish status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleProducts.map((product, index) => {
                    const variants = product.product_variants ?? [];
                    const bottle = variants.find((variant) => variant.variant_type === 'full_bottle');
                    return <tr key={product.id} data-testid={`row-product-${product.id}`}>
                      <td><div className="na-product-cell">
                         <div className="na-thumb">{product.image_url ? <img src={resolveProductImageUrl(product.image_url)} alt="" loading="lazy" /> : <FileImage size={19} />}</div>
                        <div className="na-product-info"><strong data-testid={`text-product-name-${product.id}`}>{product.name || 'Untitled perfume'}</strong><span>{product.brand} <i /> {product.fragrance_family || 'Family not set'}</span><small>/{product.slug}</small></div>
                      </div></td>
                      <td><div className="na-variant-summary">{[5, 10].map((size) => {
                        const variant = variants.find((item) => (item.variant_type ?? 'decant') === 'decant' && item.size_ml === size);
                        return <span key={`decant-${size}`} className={!variant?.is_active ? 'is-muted' : ''}><b>{size} ml</b><small>{variant?.is_active ? money(variant.price_lkr) : 'Off'}</small></span>;
                      })}<span className={bottle && !bottle.is_active ? 'is-muted' : ''}><b>Full bottle{bottle ? ` · ${bottle.size_ml} ml` : ''}</b><small>{!bottle ? 'Not set' : bottle.is_active ? money(bottle.price_lkr) : 'Off'}</small></span></div></td>
                      <td><AdminProductStockSummary productId={product.id} variants={variants} /></td>
                      <td><span className={`na-status ${product.is_active ? 'is-live' : ''}`} data-testid={`status-visibility-${product.id}`}>{product.is_active ? 'Published' : 'Unpublished'}</span>{product.is_featured && <span className="na-featured">Featured</span>}</td>
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
            </>
          ) : (
            <AdminReceiptEmailRetries />
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="na-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <section className="na-editor" role="dialog" aria-modal="true" aria-labelledby="na-editor-title">
            <div className="na-editor-head">
              <div><div className="na-eyebrow"><span /> {selected ? 'EDIT EDITION' : 'NEW EDITION'}</div><h2 id="na-editor-title">{selected ? selected.name : 'Compose a product'}</h2></div>
              <div className="na-editor-head-actions">
                <button ref={previewTriggerRef} className="na-preview-trigger" type="button" onClick={() => {
                  setPreviewVariantId(initialPreviewVariantId);
                  setPreviewOpen(true);
                }} data-testid="button-preview-product"><Eye size={15} /> Preview</button>
                <button className="na-close" type="button" onClick={closeEditor} aria-label="Close editor" data-testid="button-close-editor"><X size={19} /></button>
              </div>
            </div>
            <Form {...form}>
              <form onSubmit={submit} className="na-editor-form">
                <div className="na-editor-scroll">
                  <section className="na-form-section">
                    <div className="na-section-heading"><span>01</span><div><h3>Product identity</h3><p>The details customers see first.</p></div></div>
                    <div className="na-form-grid">
                      <label className="na-field na-field-wide">Perfume name *<input {...nameRegistration} onChange={(event) => {
                        void nameRegistration.onChange(event);
                        if (!slugManuallyEdited.current) {
                          form.setValue('slug', normalizeSlug(event.target.value), { shouldDirty: true, shouldValidate: true });
                        }
                      }} placeholder="e.g. In Still Bloom" data-testid="input-product-name" />{form.formState.errors.name && <small className="na-field-error">{form.formState.errors.name.message}</small>}</label>
                      <label className="na-field">URL slug *<input {...slugRegistration} onChange={(event) => {
                        slugManuallyEdited.current = true;
                        void slugRegistration.onChange(event);
                      }} placeholder="in-still-bloom" data-testid="input-product-slug" />{form.formState.errors.slug && <small className="na-field-error">{form.formState.errors.slug.message}</small>}<small className="na-field-help">Suggested from the name; editable before saving.</small></label>
                      <label className="na-field">Brand *<input {...form.register('brand', { required: 'Brand is required.' })} placeholder="NIDOR" data-testid="input-product-brand" />{form.formState.errors.brand && <small className="na-field-error">{form.formState.errors.brand.message}</small>}</label>
                      <label className="na-field na-field-wide">Description<textarea {...form.register('description')} placeholder="A concise description of the fragrance..." rows={3} data-testid="input-product-description" />{form.formState.errors.description && <small className="na-field-error">{form.formState.errors.description.message}</small>}</label>
                      <label className="na-field">Fragrance family<input {...form.register('fragranceFamily')} placeholder="Floral / amber" data-testid="input-fragrance-family" /></label>
                      <label className="na-field">Audience<select {...form.register('gender')} data-testid="input-gender"><option value="">Select audience</option><option value="Men">Men</option><option value="Women">Women</option><option value="Unisex">Unisex</option></select></label>
                      <label className="na-field">Concentration<input {...form.register('concentration')} placeholder="Eau de parfum" data-testid="input-concentration" /></label>
                      <label className="na-field">Display order<input type="number" min="0" step="1" {...form.register('displayOrder', { valueAsNumber: true, min: 0, validate: Number.isInteger })} data-testid="input-display-order" />{form.formState.errors.displayOrder && <small className="na-field-error">Enter a whole number of 0 or greater.</small>}</label>
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
                    <div className="na-section-heading"><span>03</span><div><h3>Image asset</h3><p>Choose a clear product image, up to 10 MB. It uploads when the product is saved.</p></div></div>
                    <div
                      className={`na-image-control na-image-drop${draggingImage ? ' is-dragging' : ''}`}
                      role="group"
                      aria-label="Product image upload area"
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDraggingImage(true);
                      }}
                      onDragLeave={() => setDraggingImage(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDraggingImage(false);
                        handleImage(event.dataTransfer.files?.[0]);
                      }}
                    >
                      {imagePreviewSrc
                        ? <img className="na-image-preview" src={imagePreviewSrc} alt={`Preview of ${values.name || 'product'}`} data-testid="img-product-preview" />
                        : <div className="na-image-empty"><ImagePlus size={21} /><span>No image attached</span></div>}
                      <div className="na-image-actions">
                        <strong>{pendingImage ? 'Image ready to upload' : values.imageUrl ? 'Current image' : 'Product image'}</strong>
                        <span>{imageFilename}</span>
                        <div className="na-inline-buttons">
                          <button type="button" onClick={() => fileInput.current?.click()} disabled={imageBusy || saveProduct.isPending} data-testid="button-upload-image">
                            {imageBusy || saveProduct.isPending ? <LoaderCircle className="na-spin" size={14} /> : <ImagePlus size={14} />}
                            {values.imageUrl || pendingImage ? 'Replace image' : 'Upload image'}
                          </button>
                          {pendingImage && <button type="button" onClick={() => {
                            clearStagedImage();
                            setImageError('');
                          }} disabled={saveProduct.isPending} data-testid="button-clear-staged-image"><X size={14} /> Clear selection</button>}
                          {selected && !/\/storage\/v1\/object\/public\/product-images\//.test(selected.image_url) && <button type="button" onClick={uploadLegacyImage} disabled={imageBusy || saveProduct.isPending} data-testid="button-migrate-image"><Copy size={14} /> Use current image</button>}
                        </div>
                        <span className="na-image-drop-hint">Or drop a PNG, JPEG, or WebP image here. PNG transparency is preserved.</span>
                        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleImage(event.target.files?.[0])} data-testid="input-product-image" />
                        {imageError && <small className="na-field-error" role="alert" data-testid="status-image-error">{imageError}</small>}
                        {form.formState.errors.imageUrl && <small className="na-field-error" role="alert">{form.formState.errors.imageUrl.message}</small>}
                      </div>
                    </div>
                  </section>

                  <section className="na-form-section">
                    <div className="na-section-heading"><span>04</span><div><h3>Variant &amp; inventory</h3><p>Enter verified bottle volume, SKU, prices, and stock for each format.</p></div></div>
                    <div className="na-variants">
                      {form.getValues('variants').map((variant, index) => {
                        const isBottle = variant.variantType === 'full_bottle';
                        const variantId = isBottle ? 'full-bottle' : String(variant.sizeMl);
                        return <div className="na-variant-card" key={`${variant.variantType}-${variant.sizeMl ?? 'unset'}`}>
                        <div className="na-variant-title"><strong>{isBottle ? 'Full bottle' : `${variant.sizeMl} ml`}</strong><span>{isBottle && variant.sizeMl ? `${variant.sizeMl} ml · ` : ''}FORMAT {String(index + 1).padStart(2, '0')}</span><label className="na-switch"><input type="checkbox" checked={variant.isActive} onChange={(event) => updateVariant(index, { isActive: event.target.checked })} data-testid={`toggle-variant-active-${variantId}`} /><i /><span>{variant.isActive ? 'Available' : 'Paused'}</span></label></div>
                        <div className="na-variant-fields">
                          {isBottle && <label className="na-field">Bottle volume (ml)<input type="number" min="1" step="1" value={variant.sizeMl ?? ''} onChange={(event) => updateVariant(index, {
                            sizeMl: event.target.value === '' ? null : Number(event.target.value),
                            originalSizeMl: variant.originalSizeMl ?? variant.sizeMl,
                          })} placeholder="Enter actual volume" data-testid="input-variant-volume-full-bottle" /><span className="na-field-help">Use the volume printed on the product. No default size is assumed.</span></label>}
                          <label className="na-field">SKU<input type="text" maxLength={120} value={variant.sku} onChange={(event) => updateVariant(index, { sku: event.target.value })} placeholder="Generated from slug if left blank" data-testid={`input-variant-sku-${variantId}`} /></label>
                          <label className={`na-field ${variant.priceNeedsConfiguration ? 'na-disabled-field' : ''}`}>Price (LKR)<input type="number" min="0" step="0.01" value={variant.priceLkr ?? ''} disabled={variant.priceNeedsConfiguration} onChange={(event) => updateVariant(index, { priceLkr: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Not configured" data-testid={`input-variant-price-${variantId}`} /><span className="na-check-control"><input type="checkbox" checked={variant.priceNeedsConfiguration} onChange={(event) => updateVariant(index, { priceNeedsConfiguration: event.target.checked, priceLkr: event.target.checked ? null : variant.priceLkr })} data-testid={`toggle-price-unconfigured-${variantId}`} /> Price needs configuration</span></label>
                          <label className={`na-field ${variant.stockNeedsConfiguration ? 'na-disabled-field' : ''}`}>Stock quantity<input type="number" min="0" step="1" value={Number.isFinite(variant.stockQuantity) ? variant.stockQuantity : ''} disabled={variant.stockNeedsConfiguration} onChange={(event) => updateVariant(index, { stockQuantity: event.target.value === '' ? Number.NaN : Number(event.target.value) })} data-testid={`input-variant-stock-${variantId}`} /><span className="na-check-control"><input type="checkbox" checked={variant.stockNeedsConfiguration} onChange={(event) => updateVariant(index, { stockQuantity: event.target.checked ? 0 : variant.stockQuantity, stockNeedsConfiguration: event.target.checked })} data-testid={`toggle-stock-unconfigured-${variantId}`} /> Stock needs verification</span></label>
                          <label className={`na-field ${!variant.isActive ? 'na-disabled-field' : ''}`}>Low-stock threshold<input type="number" min="0" step="1" inputMode="numeric" value={variant.lowStockThreshold ?? ''} disabled={!variant.isActive} onChange={(event) => updateVariant(index, { lowStockThreshold: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Not configured" data-testid={`input-variant-low-stock-threshold-${variantId}`} /><span className="na-field-help">{variant.isActive ? 'Warn when verified stock is at or below this number. Leave blank for no warning.' : 'Enable this format to configure its low-stock warning.'}</span></label>
                        </div>
                      </div>;
                      })}
                    </div>
                  </section>

                  <section className="na-form-section na-publish-section">
                    <div className="na-section-heading"><span>05</span><div><h3>Storefront status</h3><p>Unpublished perfumes stay safely in the catalogue.</p></div></div>
                    <label className="na-status-choice"><span><strong>Publish perfume</strong><small>Make this product visible in the collection.</small></span><input type="checkbox" {...form.register('isActive')} data-testid="toggle-product-active" /><i /></label>
                    <label className="na-status-choice"><span><strong>Feature this perfume</strong><small>Give it featured placement in the collection.</small></span><input type="checkbox" {...form.register('isFeatured')} data-testid="toggle-product-featured" /><i /></label>
                  </section>
                </div>
                <footer className="na-editor-footer">
                  {notice && <span className="na-form-notice" role="alert" data-testid="status-editor">{notice}</span>}
                  <button type="button" className="na-secondary-button" onClick={closeEditor} disabled={saveProduct.isPending || imageBusy} data-testid="button-cancel-edit">Cancel</button>
                  <button type="submit" className="na-primary-button" disabled={saveProduct.isPending || imageBusy} data-testid="button-save-product">{saveProduct.isPending ? <LoaderCircle className="na-spin" size={15} /> : <Check size={15} />}{saveProduct.isPending ? 'Saving' : selected ? 'Save changes' : 'Save perfume'}</button>
                </footer>
              </form>
            </Form>
          </section>
        </div>
      )}
      {editorOpen && previewOpen && (
        <div className="na-preview-backdrop" role="presentation">
          <section
            className="na-preview-scroll"
            ref={previewScrollRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Storefront preview for ${previewFragrance.name || 'untitled perfume'}`}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setPreviewOpen(false);
              }
            }}
            data-testid="dialog-product-preview"
          >
            <header className="na-preview-bar">
              <div><span className="na-preview-kicker">PRIVATE STOREFRONT PREVIEW</span><strong>Unsaved editor values · nothing will be published</strong></div>
              <button type="button" onClick={() => setPreviewOpen(false)} data-testid="button-close-preview"><X size={15} /> Return to editor</button>
            </header>
            <FragranceExperience
              fragrance={previewFragrance}
              previousWorld="#242d40"
              selectedVariantId={currentPreviewVariantId}
              onVariantChange={setPreviewVariantId}
              onAdd={() => {}}
              previewOnly
              scrollContainerRef={previewScrollRef}
            />
          </section>
        </div>
      )}
    </main>
  );
}

export default AdminProductsDashboard;