import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createOrder,
  recoverOrderReceipt,
  type CreateOrderRequest,
  type CreatedOrderReceipt,
  type OrderReceiptLookup,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { FragranceExperience } from '@/components/fragrance-experience';
import { FragranceDetails } from '@/components/fragrance-details';
import { isVariantConfigured, type Fragrance, type FragranceVariant, variantDisplayName } from '@/data/fragrances';
import { CartProvider, useCart } from '@/hooks/use-cart';
import { useCartValidation } from '@/hooks/use-cart-validation';
import { publicCatalogQueryKey, usePublicCatalog } from '@/hooks/use-catalog';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminProductsPage from '@/pages/admin-products';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import './storefront.css';

const queryClient = new QueryClient();
const logo = '/assets/brand/nidor-logo.png';
const ORDER_RECEIPT_STORAGE_KEY = 'nidor-order-receipt-v1';
const ORDER_ATTEMPT_STORAGE_KEY = 'nidor-order-attempt-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CheckoutAttempt = { fingerprint: string; idempotencyKey: string };
const formatLkr = (value: number) => new Intl.NumberFormat('en-LK', {
  style: 'currency', currency: 'LKR', maximumFractionDigits: 2,
}).format(value);

function readStoredCheckoutAttempt(): CheckoutAttempt | null {
  try {
    const stored = sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== 'object') return null;
    const attempt = value as Record<string, unknown>;
    return typeof attempt.fingerprint === 'string'
      && typeof attempt.idempotencyKey === 'string'
      && UUID_PATTERN.test(attempt.idempotencyKey)
      ? { fingerprint: attempt.fingerprint, idempotencyKey: attempt.idempotencyKey }
      : null;
  } catch {
    return null;
  }
}

async function fingerprintCheckout(request: CreateOrderRequest): Promise<string> {
  const canonicalRequest = {
    ...request,
    lines: [...request.lines].sort((left, right) => left.variantId.localeCompare(right.variantId)),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalRequest));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readStoredOrderReceipt(): CreatedOrderReceipt | null {
  try {
    const stored = sessionStorage.getItem(ORDER_RECEIPT_STORAGE_KEY);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== 'object') return null;
    const receipt = value as Record<string, unknown>;
    if (
      typeof receipt.orderId !== 'string'
      || receipt.status !== 'pending_payment'
      || typeof receipt.subtotalLkr !== 'number'
      || !Array.isArray(receipt.lines)
    ) return null;
    const validLines = receipt.lines.every((line) => {
      if (!line || typeof line !== 'object') return false;
      const item = line as Record<string, unknown>;
      return typeof item.variantId === 'string'
        && typeof item.productName === 'string'
        && typeof item.brand === 'string'
        && (item.variantType === 'decant' || item.variantType === 'full_bottle')
        && typeof item.sizeMl === 'number'
        && typeof item.quantity === 'number'
        && typeof item.unitPriceLkr === 'number'
        && typeof item.lineTotalLkr === 'number';
    });
    return validLines ? value as CreatedOrderReceipt : null;
  } catch {
    return null;
  }
}

function getOrderErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = 'data' in error ? error.data : null;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error
    ? error.message
    : 'Your order could not be saved. Please try again.';
}

function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | NIDOR`;
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.append(description);
    }
    description.content = `${title}. Explore NIDOR fragrance editions and their cinematic scent stories.`;
  }, [title]);
}

function Header({ worldAccent }: { worldAccent?: string }) {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const close = () => setOpen(false);
  const activePath = location.startsWith('/worlds') ? '/worlds' : location;
  const navClass = (path: string) => activePath === path ? 'is-active' : undefined;
  const headerStyle = worldAccent ? { '--sf-world-accent': worldAccent } as CSSProperties : undefined;
  return (
    <header className="sf-header" style={headerStyle} data-testid="storefront-header">
      <Link href="/" aria-label="NIDOR home" onClick={close}><img className="sf-logo" src={logo} alt="NIDOR by scientists" /></Link>
      <button className="sf-mobile-menu" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="sf-navigation">{open ? 'Close' : 'Menu'}</button>
      <nav className={`sf-nav ${open ? 'is-open' : ''}`} id="sf-navigation" aria-label="Main navigation" data-testid="storefront-navigation">
        <Link href="/" className={navClass('/')} aria-current={activePath === '/' ? 'page' : undefined} onClick={close}>Home</Link>
        <Link href="/shop" className={navClass('/shop')} aria-current={activePath === '/shop' ? 'page' : undefined} onClick={close}>Shop</Link>
        <Link href="/worlds" className={navClass('/worlds')} aria-current={activePath === '/worlds' ? 'page' : undefined} onClick={close}>Fragrance Worlds</Link>
        <Link href="/#about" onClick={close}>About NIDOR</Link>
        <Link className={`sf-cart-link ${navClass('/cart') ?? ''}`} href="/cart" aria-current={activePath === '/cart' ? 'page' : undefined} onClick={close}>Cart <span aria-live="polite">({count})</span></Link>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="sf-footer">
      <Link href="/" aria-label="NIDOR home"><img className="sf-footer-logo" src={logo} alt="NIDOR by scientists" /></Link>
      <nav className="sf-footer-nav" aria-label="Footer navigation">
        <Link href="/">Home</Link><Link href="/shop">Shop</Link><Link href="/worlds">Fragrance Worlds</Link><Link href="/cart">Cart</Link><Link href="/#about">About NIDOR</Link>
      </nav>
      <div className="sf-footer-note">By scientists · Scents · Stories · You</div>
    </footer>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="storefront"><Header /><main className="sf-main">{children}</main><Footer /></div>;
}

function CatalogState({ loading, error, retry, emptyText }: { loading: boolean; error: unknown; retry: () => void; emptyText?: string }) {
  if (loading) return <section className="sf-page-state" aria-live="polite"><span className="sf-kicker">NIDOR / Collection</span><h1>Opening the edit.</h1><p className="sf-subtle">Live fragrance details are on their way.</p><div className="sf-skeleton" /></section>;
  if (error) return <section className="sf-page-state" role="alert"><span className="sf-kicker">NIDOR / Collection</span><h1>The collection is unavailable.</h1><p className="sf-subtle">{error instanceof Error ? error.message : 'Product data could not be loaded.'}</p><button className="sf-button" type="button" onClick={retry}>Try again</button></section>;
  if (emptyText) return <section className="sf-page-state"><span className="sf-kicker">NIDOR / Collection</span><h1>{emptyText}</h1><p className="sf-subtle">Check back when new editions are published.</p></section>;
  return null;
}

function canAdd(variant: FragranceVariant | undefined, quantity = 1) {
  return !!variant && isVariantConfigured(variant)
    && variant.stockQuantity > 0 && Number.isInteger(quantity) && quantity > 0 && quantity <= variant.stockQuantity;
}

function ProductCard({ fragrance, onAdded }: { fragrance: Fragrance; onAdded?: (message: string) => void }) {
  const { add, lines } = useCart();
  const variants = fragrance.variants.filter(isVariantConfigured);
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? '');
  const chosen = variants.find((variant) => variant.id === selectedId) ?? variants[0];
  const selectedVariantId = chosen?.id ?? '';
  const lineQty = lines.find((line) => line.variantId === selectedVariantId)?.quantity ?? 0;
  const enabled = canAdd(chosen, lineQty + 1);
  const availability = !chosen ? 'No configured variants' : chosen.stockQuantity <= 0 ? 'Currently out of stock' : `${chosen.stockQuantity} available`;
  const actionLabel = enabled ? 'Add to cart' : !chosen ? 'Options unavailable'
    : chosen.stockQuantity <= lineQty ? 'Stock limit reached' : 'Out of stock';
  return (
    <article className="sf-card" data-testid={`product-card-${fragrance.slug}`}>
      <Link href={`/worlds/${encodeURIComponent(fragrance.slug)}`} className="sf-card-image" aria-label={`View ${fragrance.name} fragrance world`}>
        <img src={fragrance.image} alt={`${fragrance.name} by ${fragrance.brand}, fragrance bottle`} loading="lazy" />
      </Link>
      <div className="sf-card-meta">
        <div><h3>{fragrance.name}</h3><p className="sf-brand">{fragrance.brand}</p></div>
        <div className="sf-price">{chosen
          ? <><strong>{formatLkr(chosen.priceLkr as number)}</strong><small>{variantDisplayName(chosen)}</small></>
          : <span>Price not configured</span>}</div>
      </div>
      <FragranceDetails fragrance={fragrance} />
      <p className="sf-subtle">{availability}</p>
      <div className="sf-card-controls">
        <label className="sr-only" htmlFor={`size-${fragrance.slug}`}>Variant for {fragrance.name}</label>
        <select className="sf-select" id={`size-${fragrance.slug}`} data-testid={`product-size-${fragrance.slug}`} value={selectedVariantId} onChange={(event) => setSelectedId(event.target.value)}>
          {!variants.length && <option value="">No configured variants</option>}
          {variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stockQuantity === 0}>{variantDisplayName(variant)} — {formatLkr(variant.priceLkr as number)}{variant.stockQuantity === 0 ? ' · Out of stock' : ''}</option>)}
        </select>
        <button className="sf-button" type="button" data-testid={`add-to-cart-${fragrance.slug}`} disabled={!enabled} onClick={() => {
          if (!chosen || !canAdd(chosen, lineQty + 1)) return;
          add(chosen.id, 1);
          onAdded?.(`${fragrance.name} · ${variantDisplayName(chosen)} added to your cart.`);
        }}>{actionLabel}</button>
      </div>
      <Link className="sf-inline-link" href={`/worlds/${encodeURIComponent(fragrance.slug)}`}>View fragrance world</Link>
    </article>
  );
}

function Home() {
  const catalog = usePublicCatalog();
  usePageTitle('Scents, Stories, You');
  useEffect(() => {
    if (window.location.hash === '#about') document.getElementById('about')?.scrollIntoView({ block: 'start' });
  }, [catalog.data]);
  const products = catalog.data ?? [];
  const selected = products.filter((item) => item.isFeatured);
  const featured = (selected.length ? selected : products).slice(0, 3);
  return (
    <Shell>
      <section className="sf-hero" data-testid="home-hero">
        <div className="sf-hero-copy">
          <span className="sf-kicker">NIDOR / By scientists</span>
          <img className="sf-hero-logo" src={logo} alt="NIDOR by scientists" />
          <h1>Small editions.<br /><em>Entire worlds.</em></h1>
          <p>Explore each fragrance in the decant or full-bottle formats configured for that scent.</p>
          <div className="sf-actions"><Link className="sf-button" href="/shop">Shop all fragrances</Link><Link className="sf-inline-link" href="/worlds">Explore fragrance worlds</Link></div>
        </div>
        <div className="sf-hero-art" aria-label="NIDOR signature mark"><span>SCENTS · STORIES · YOU</span></div>
      </section>
      <section className="sf-section" aria-labelledby="featured-heading" data-testid="home-featured">
        <div className="sf-section-heading"><div><span className="sf-kicker">The current edit</span><h2 id="featured-heading">A first impression.</h2></div><Link className="sf-inline-link" href="/shop">Browse the full catalogue</Link></div>
        {catalog.isLoading || catalog.isError || !products.length
          ? <div className="sf-featured-state"><CatalogState loading={catalog.isLoading} error={catalog.error} retry={() => { void catalog.refetch(); }} emptyText={!catalog.isLoading && !catalog.isError && !products.length ? 'No editions are published.' : undefined} /></div>
          : <div className="sf-grid">{featured.map((fragrance) => <ProductCard key={fragrance.slug} fragrance={fragrance} />)}</div>}
      </section>
      <section className="sf-about" id="about">
        <div><span className="sf-kicker">About NIDOR</span><h2>Scents, stories,<br /><em>and the space between.</em></h2></div>
        <p>Explore each fragrance through its notes, story, configured formats, and cinematic world.</p>
      </section>
      <section className="sf-home-cta"><span className="sf-kicker">Find your next edition</span><h2>Let curiosity<br />lead the way.</h2><Link className="sf-button secondary" href="/shop">Shop fragrances</Link></section>
    </Shell>
  );
}

function Shop() {
  const catalog = usePublicCatalog();
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('all');
  const [brand, setBrand] = useState('all');
  const [sort, setSort] = useState('featured');
  const [notice, setNotice] = useState('');
  usePageTitle('Shop Fragrances');
  const products = catalog.data ?? [];
  const genders = useMemo(() => [...new Set(products.map((item) => item.gender?.trim()).filter((value): value is string => !!value))].sort(), [products]);
  const brands = useMemo(() => [...new Set(products.map((item) => item.brand.trim()).filter(Boolean))].sort(), [products]);
  const shown = useMemo(() => {
    const filtered = products.filter((item) => {
      const term = query.trim().toLocaleLowerCase();
      return (!term || `${item.name} ${item.brand}`.toLocaleLowerCase().includes(term))
        && (gender === 'all' || item.gender?.trim() === gender) && (brand === 'all' || item.brand.trim() === brand);
    });
    const value = (item: Fragrance) => {
      const configured = item.variants.filter(isVariantConfigured).map((variant) => variant.priceLkr as number);
      return configured.length ? Math.min(...configured) : null;
    };
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'price-low' || sort === 'price-high') {
        const left = value(a); const right = value(b);
        if (left === null) return right === null ? a.name.localeCompare(b.name) : 1;
        if (right === null) return -1;
        return (sort === 'price-low' ? left - right : right - left);
      }
      // Keep the database's display order within each featured group.
      return Number(b.isFeatured) - Number(a.isFeatured);
    });
  }, [products, query, gender, brand, sort]);
  if (catalog.isLoading || catalog.isError) return <Shell><CatalogState loading={catalog.isLoading} error={catalog.error} retry={() => { void catalog.refetch(); }} /></Shell>;
  if (!products.length) return <Shell><CatalogState loading={false} error={null} retry={() => { void catalog.refetch(); }} emptyText="No editions are published." /></Shell>;
  return (
    <Shell>
      <section className="sf-shop">
        <div className="sf-heading"><div><span className="sf-kicker">The NIDOR catalogue</span><h1>Shop <em>fragrances.</em></h1></div><p className="sf-subtle">Small editions, selected at your pace.</p></div>
        <div className="sf-toolbar">
          <label className="sr-only" htmlFor="catalog-search">Search fragrances by name or brand</label><input id="catalog-search" data-testid="shop-search" className="sf-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or brand" />
          {genders.length > 0 && <><label className="sr-only" htmlFor="gender-filter">Filter by gender</label><select id="gender-filter" data-testid="gender-filter" className="sf-filter-select" value={gender} onChange={(event) => setGender(event.target.value)}><option value="all">All fragrances</option>{genders.map((value) => <option key={value} value={value}>{value}</option>)}</select></>}
          {brands.length > 1 && <><label className="sr-only" htmlFor="brand-filter">Filter by brand</label><select id="brand-filter" data-testid="brand-filter" className="sf-filter-select" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="all">All brands</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></>}
          <label className="sr-only" htmlFor="catalog-sort">Sort fragrances</label><select id="catalog-sort" data-testid="catalog-sort" className="sf-filter-select" value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Curated order</option><option value="name">Name, A–Z</option><option value="price-low">Price, low to high</option><option value="price-high">Price, high to low</option></select>
        </div>
        <p className="sf-count" aria-live="polite" data-testid="catalog-count">{shown.length} {shown.length === 1 ? 'edition' : 'editions'}</p>
        {shown.length ? <div className="sf-grid" data-testid="catalog-grid">{shown.map((fragrance) => <ProductCard key={fragrance.slug} fragrance={fragrance} onAdded={setNotice} />)}</div> : <div className="sf-empty"><span className="sf-kicker">No match in this edit</span><h2>Try another search.</h2><p>Adjust your search or clear the filters to see more editions.</p><button className="sf-button secondary" type="button" onClick={() => { setQuery(''); setGender('all'); setBrand('all'); setSort('featured'); }}>Clear filters</button></div>}
        <p className="sf-notice" role="status" aria-live="polite">{notice}</p>
      </section>
    </Shell>
  );
}

function Worlds() {
  const catalog = usePublicCatalog();
  const { add, lines } = useCart();
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  usePageTitle('Fragrance Worlds');
  if (catalog.isLoading || catalog.isError || !catalog.data?.length) return <Shell><CatalogState loading={catalog.isLoading} error={catalog.error} retry={() => { void catalog.refetch(); }} emptyText={!catalog.isLoading && !catalog.isError && !catalog.data?.length ? 'No fragrance worlds are active.' : undefined} /></Shell>;
  return (
    <div className="storefront sf-world-experience sf-world-collection" data-testid="worlds-page">
      <Header />
      <main>
        <section className="sf-world-sequence-intro">
          <span className="sf-kicker">The NIDOR point of view</span>
          <h1 className="sf-page-title">Fragrance <em>worlds.</em></h1>
          <p className="sf-subtle">Scroll down to experience each fragrance world, one by one.</p>
          <span className="sf-world-scroll-cue" aria-hidden="true">Scroll to enter ↓</span>
        </section>
        <div data-testid="worlds-list">
          {catalog.data.map((item, index) => {
            const initialVariantId = item.variants.find(isVariantConfigured)?.id ?? '';
            const previousWorld = index > 0 ? catalog.data[index - 1]?.theme.deep ?? '#242d40' : '#242d40';
            return <FragranceExperience
              key={item.slug}
              fragrance={item}
              previousWorld={previousWorld}
              selectedVariantId={selectedVariants[item.slug] ?? initialVariantId}
              onVariantChange={(variantId) => setSelectedVariants((current) => ({ ...current, [item.slug]: variantId }))}
              onAdd={(fragrance, variantId, quantity) => {
                const variant = fragrance.variants.find((entry) => entry.id === variantId);
                const existingQuantity = lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
                if (!canAdd(variant, existingQuantity + quantity)) { setNotice('This format is unavailable at the selected quantity.'); return; }
                add(variantId, quantity);
                setNotice(`${quantity} × ${fragrance.name} · ${variantDisplayName(variant!)} added to your cart.`);
              }}
            />;
          })}
        </div>
        <div className="sf-world-status" role="status" aria-live="polite">{notice}</div>
      </main>
      <Footer />
    </div>
  );
}

function WorldDetail() {
  const { slug } = useParams<{ slug: string }>();
  const catalog = usePublicCatalog();
  const { add, lines } = useCart();
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const fragrance = catalog.data?.find((item) => item.slug === slug);
  usePageTitle(fragrance?.name ?? 'Fragrance World');
  if (catalog.isLoading || catalog.isError) return <Shell><CatalogState loading={catalog.isLoading} error={catalog.error} retry={() => { void catalog.refetch(); }} /></Shell>;
  if (!fragrance) return <Shell><CatalogState loading={false} error={null} retry={() => { void catalog.refetch(); }} emptyText="This fragrance world is not active." /></Shell>;
  const initialVariantId = fragrance.variants.find(isVariantConfigured)?.id ?? '';
  const worldIndex = catalog.data?.findIndex((item) => item.slug === fragrance.slug) ?? 0;
  const previousWorld = worldIndex > 0 ? catalog.data?.[worldIndex - 1].theme.deep ?? '#242d40' : '#242d40';
  return <div className="storefront sf-world-experience" data-testid="fragrance-world-detail"><Header worldAccent={fragrance.theme.accent} /><main><nav className="sf-world-back" aria-label="Breadcrumb"><Link href="/worlds">← All fragrance worlds</Link><Link href="/shop">Shop editions</Link></nav>
    <FragranceExperience fragrance={fragrance} previousWorld={previousWorld} selectedVariantId={selectedVariants[fragrance.slug] ?? initialVariantId}
      onVariantChange={(variantId) => setSelectedVariants((current) => ({ ...current, [fragrance.slug]: variantId }))}
      onAdd={(item, variantId, quantity) => {
        const variant = item.variants.find((entry) => entry.id === variantId);
        const existingQuantity = lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
        if (!canAdd(variant, existingQuantity + quantity)) { setNotice('This format is unavailable at the selected quantity.'); return; }
        add(variantId, quantity);
        setNotice(`${quantity} × ${item.name} · ${variantDisplayName(variant!)} added to your cart.`);
      }} />
    <div className="sf-world-status" role="status" aria-live="polite">{notice}</div>
  </main><Footer /></div>;
}

function Cart() {
  const catalog = usePublicCatalog();
  const { lines, count, legacyLines, migrationNotice, migrateLegacy, setQuantity, remove, clear } = useCart();
  const validation = useCartValidation(lines);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [receipt, setReceipt] = useState<CreatedOrderReceipt | null>(readStoredOrderReceipt);
  const [checkoutAttempt, setCheckoutAttempt] = useState<CheckoutAttempt | null>(readStoredCheckoutAttempt);
  const [recoveryOrderId, setRecoveryOrderId] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [isRecoveringReceipt, setIsRecoveringReceipt] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  usePageTitle('Your Cart');
  useEffect(() => {
    if (!catalog.data || legacyLines.length === 0) return;
    const resolved = legacyLines.flatMap((legacyLine) => {
      const product = catalog.data?.find((item) => item.slug === legacyLine.slug);
      const variant = product?.variants.find((entry) =>
        entry.variantType === 'decant' && entry.sizeMl === legacyLine.sizeMl,
      );
      return variant ? [{ variantId: variant.id, quantity: legacyLine.quantity }] : [];
    });
    migrateLegacy(resolved, legacyLines.length - resolved.length);
  }, [catalog.data, legacyLines, migrateLegacy]);
  useEffect(() => {
    if (!receipt || lines.length === 0) return;
    setReceipt(null);
    try {
      sessionStorage.removeItem(ORDER_RECEIPT_STORAGE_KEY);
    } catch {
      // A stored receipt is optional; the order itself is already persisted.
    }
  }, [receipt, lines.length]);

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      isSubmitting
      || !lines.length
      || validation.isLoading
      || validation.error
      || !validation.data
      || validation.data.lines.length !== lines.length
      || validation.data.lines.some((line) => !line.canPurchase)
    ) return;

    setCheckoutError('');
    setIsSubmitting(true);
    try {
      const orderRequest: CreateOrderRequest = {
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        deliveryAddress: deliveryAddress.trim(),
        lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
      };
      const fingerprint = await fingerprintCheckout(orderRequest);
      const attempt = checkoutAttempt?.fingerprint === fingerprint
        ? checkoutAttempt
        : { fingerprint, idempotencyKey: crypto.randomUUID() };
      setCheckoutAttempt(attempt);
      try {
        sessionStorage.setItem(ORDER_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
      } catch {
        // Keep the key in component state when browser storage is unavailable.
      }
      const placedOrder = await createOrder(orderRequest, {
        headers: { 'Idempotency-Key': attempt.idempotencyKey },
      });
      setReceipt(placedOrder);
      if (placedOrder.receiptEmailStatus === 'failed') {
        setRecoveryOrderId(placedOrder.orderId);
        setRecoveryEmail(orderRequest.customerEmail);
      }
      setCheckoutAttempt(null);
      try {
        sessionStorage.setItem(ORDER_RECEIPT_STORAGE_KEY, JSON.stringify(placedOrder));
        sessionStorage.removeItem(ORDER_ATTEMPT_STORAGE_KEY);
      } catch {
        // Keep the live success state even when browser storage is unavailable.
      }
      clear();
      void queryClient.invalidateQueries({ queryKey: publicCatalogQueryKey });
    } catch (error) {
      setCheckoutError(getOrderErrorMessage(error));
      validation.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const recoverReceipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isRecoveringReceipt) return;

    setRecoveryError('');
    setIsRecoveringReceipt(true);
    try {
      const lookup: OrderReceiptLookup = {
        orderId: recoveryOrderId.trim(),
        customerEmail: recoveryEmail.trim(),
      };
      const recoveredReceipt = await recoverOrderReceipt(lookup);
      setReceipt(recoveredReceipt);
      try {
        sessionStorage.setItem(ORDER_RECEIPT_STORAGE_KEY, JSON.stringify(recoveredReceipt));
      } catch {
        // The recovered receipt remains visible for this visit if storage is unavailable.
      }
    } catch (error) {
      setRecoveryError(getOrderErrorMessage(error));
    } finally {
      setIsRecoveringReceipt(false);
    }
  };

  const receiptRecoveryPanel = <section className="sf-order-recovery" aria-labelledby="order-recovery-title">
    <h2 id="order-recovery-title">Find a saved order</h2>
    <p>Enter the order reference and the email used at checkout. Only the receipt is shown; contact and delivery details stay private.</p>
    {recoveryError && <p className="sf-validation-error" role="alert">{recoveryError}</p>}
    <form className="sf-checkout-form" onSubmit={recoverReceipt} data-testid="order-recovery-form">
      <label htmlFor="recovery-order-id">Order reference</label>
      <input id="recovery-order-id" name="orderId" autoComplete="off" required value={recoveryOrderId} onChange={(event) => setRecoveryOrderId(event.target.value)} />
      <label htmlFor="recovery-customer-email">Checkout email</label>
      <input id="recovery-customer-email" name="customerEmail" type="email" autoComplete="email" maxLength={320} required value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} />
      <button className="sf-button" type="submit" disabled={isRecoveringReceipt}>
        {isRecoveringReceipt ? 'Finding receipt…' : 'Recover receipt'}
      </button>
    </form>
  </section>;

  if (receipt) return <Shell><section className="sf-cart sf-order-success" data-testid="order-success" role="status">
    <span className="sf-kicker">Order received / Payment pending</span>
    <h1 className="sf-page-title">Your order is <em>saved.</em></h1>
    <p className="sf-subtle">Order reference: <strong>{receipt.orderId}</strong></p>
    <p className="sf-order-payment-note">Payment has not been collected online. This order is saved as pending payment; the business must confirm payment separately before dispatch.</p>
    {receipt.receiptEmailStatus === 'failed'
      ? <p className="sf-subtle" role="alert">Your order is still saved and the receipt is shown below, but we couldn’t send the receipt email. If you need to retrieve it later, use the recovery form below with your order reference and checkout email.</p>
      : receipt.receiptEmailStatus === 'accepted'
        ? <p className="sf-subtle">The receipt email was accepted for delivery. If it doesn’t arrive, use the recovery form below.</p>
        : <p className="sf-subtle">If you need to retrieve this receipt later, use the recovery form below.</p>}
    <div className="sf-order-receipt-lines">{receipt.lines.map((line) => <div key={line.variantId}>
      <span>{line.quantity} × {line.productName} · {variantDisplayName({ variantType: line.variantType, sizeMl: line.sizeMl })}</span>
      <strong>{formatLkr(line.lineTotalLkr)}</strong>
    </div>)}</div>
    <div className="sf-summary-total"><span>Verified order total</span><strong>{formatLkr(receipt.subtotalLkr)}</strong></div>
    <div className="sf-actions"><Link className="sf-button" href="/shop">Continue shopping</Link><button className="sf-button secondary" type="button" onClick={() => {
      setReceipt(null);
      try {
        sessionStorage.removeItem(ORDER_RECEIPT_STORAGE_KEY);
      } catch {
        // The visible confirmation can still be dismissed if storage is unavailable.
      }
    }}>Close confirmation</button></div>
  </section>{receiptRecoveryPanel}</Shell>;

  if (catalog.isLoading || catalog.isError) return <Shell>
    <CatalogState loading={catalog.isLoading} error={catalog.error} retry={() => { void catalog.refetch(); }} />
    {receiptRecoveryPanel}
  </Shell>;
  const validationById = new Map((validation.data?.lines ?? []).map((line) => [line.variantId, line]));
  const details = lines.map((line) => {
    const checked = validationById.get(line.variantId);
    const localProduct = checked?.product
      ? catalog.data?.find((item) => item.slug === checked.product?.slug)
      : undefined;
    return { line, checked, localProduct };
  });
  const total = details.reduce((sum, entry) => {
    const variant = entry.checked?.variant;
    return variant && !variant.priceNeedsConfiguration && variant.priceLkr !== null
      ? sum + variant.priceLkr * entry.line.quantity
      : sum;
  }, 0);
  const hasUnknownPrice = details.some(({ checked }) =>
    !checked?.variant || checked.variant.priceNeedsConfiguration || checked.variant.priceLkr === null,
  );
  const hasAvailabilityIssue = details.some(({ checked }) => !checked?.canPurchase)
    || validation.isLoading || !!validation.error;
  const statusText = (checked: NonNullable<(typeof details)[number]['checked']>, quantity: number) => {
    if (checked.status === 'price_unconfigured') return 'Price to be confirmed.';
    if (checked.status === 'stock_unconfigured') return 'Stock needs verification.';
    if (checked.status === 'out_of_stock') return 'Currently out of stock.';
    if (checked.status === 'insufficient_stock') return `Only ${checked.variant?.stockQuantity ?? 0} available; reduce quantity.`;
    if (checked.status === 'unavailable') return 'This variant is no longer active.';
    return `${checked.variant?.stockQuantity ?? quantity} available`;
  };
  return <Shell><section className="sf-cart" data-testid="cart-page"><span className="sf-kicker">Your edit / {count} items</span><h1 className="sf-page-title">The <em>cart.</em></h1>
    {migrationNotice && <p className="sf-notice" role="status">{migrationNotice}</p>}
    {validation.error && <p className="sf-validation-error" role="alert">Could not verify the current prices and stock. {validation.error}</p>}
    {!lines.length ? <div className="sf-empty"><h2>Your cart is waiting.</h2><p>Browse the current fragrance editions to begin.</p><Link className="sf-button" href="/shop">Shop fragrances</Link></div> :
      <div className="sf-cart-layout"><div>{details.map(({ line, checked, localProduct }) => {
        const product = checked?.product;
        const variant = checked?.variant;
        const itemName = product?.name ?? 'Edition unavailable';
        const lineTotal = variant && !variant.priceNeedsConfiguration && variant.priceLkr !== null
          ? formatLkr(variant.priceLkr * line.quantity)
          : 'Price to be confirmed';
        return <article className="sf-cart-line" key={line.variantId}>
          {localProduct?.image ? <img src={localProduct.image} alt={`${itemName} fragrance bottle`} /> : <div className="sf-cart-image-placeholder" aria-hidden="true" />}
          <div><h2>{itemName}</h2><p className="sf-brand">{product?.brand ?? 'Current catalog details unavailable'}{variant ? ` · ${variantDisplayName(variant)}` : ''}</p>
            <p className="sf-subtle">{checked ? statusText(checked, line.quantity) : validation.isLoading ? 'Checking current availability…' : 'Could not validate this variant.'}</p>
            <div className="sf-line-qty"><button type="button" aria-label={`Decrease ${itemName} quantity`} disabled={line.quantity <= 1} onClick={() => setQuantity(line.variantId, line.quantity - 1)}>−</button><span aria-live="polite">{line.quantity}</span><button type="button" aria-label={`Increase ${itemName} quantity`} disabled={!checked?.canPurchase || !variant || line.quantity >= variant.stockQuantity} onClick={() => setQuantity(line.variantId, line.quantity + 1)}>+</button></div>
            <button className="sf-remove" type="button" onClick={() => remove(line.variantId)}>Remove</button>
          </div><strong>{lineTotal}</strong>
        </article>;
      })}</div>
      <aside className="sf-cart-summary"><h2>Order summary</h2><p>Prices and availability are checked against the current server catalog.</p><div className="sf-summary-total"><span>Verified subtotal</span><strong>{formatLkr(total)}</strong></div>{validation.isLoading && <p>Verifying current prices and stock…</p>}{hasUnknownPrice && <p>Items without a configured price are excluded from this subtotal.</p>}{hasAvailabilityIssue && <p>Some items need availability confirmation or a quantity adjustment.</p>}
        {(validation.error || details.some(({ checked }) => !checked?.canPurchase)) && <button className="sf-inline-link" type="button" onClick={validation.refresh}>Recheck prices and availability</button>}
        {checkoutError && <p className="sf-validation-error" role="alert">{checkoutError}</p>}
        <p className="sf-order-payment-note">No online payment is collected yet. Orders are saved as pending payment, and payment must be confirmed before dispatch.</p>
        <form className="sf-checkout-form" onSubmit={submitOrder} data-testid="order-form">
          <label htmlFor="order-customer-name">Full name</label>
          <input id="order-customer-name" name="customerName" autoComplete="name" minLength={2} maxLength={120} required value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          <label htmlFor="order-customer-email">Email</label>
          <input id="order-customer-email" name="customerEmail" type="email" autoComplete="email" maxLength={320} required value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
          <label htmlFor="order-customer-phone">Phone</label>
          <input id="order-customer-phone" name="customerPhone" type="tel" autoComplete="tel" minLength={7} maxLength={40} required value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
          <label htmlFor="order-delivery-address">Delivery address</label>
          <textarea id="order-delivery-address" name="deliveryAddress" autoComplete="street-address" minLength={8} maxLength={800} required value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} />
          <button className="sf-button" type="submit" data-testid="submit-order" disabled={
            isSubmitting || validation.isLoading || !!validation.error || hasAvailabilityIssue
            || !validation.data || validation.data.lines.length !== lines.length
          }>{isSubmitting ? 'Saving order…' : 'Place order'}</button>
        </form>
        <Link className="sf-button secondary" href="/shop">Continue shopping</Link></aside></div>}
    {receiptRecoveryPanel}
  </section></Shell>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  const [location] = useLocation();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [location]);
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Home} />
    <Route path="/shop" component={Shop} />
    <Route path="/worlds" component={Worlds} />
    <Route path="/worlds/:slug" component={WorldDetail} />
    <Route path="/cart" component={Cart} />
    <Route path="/admin/products" component={AdminProductsPage} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><CartProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoutes /></WouterRouter></CartProvider><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
