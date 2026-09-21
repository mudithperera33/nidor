import { useEffect, useState } from 'react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { FragranceExperience } from '@/components/fragrance-experience';
import { LandingExperience } from '@/components/landing-experience';
import { type Fragrance, fragrances } from '@/data/fragrances';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function Header({ menuOpen, setMenuOpen, cartCount, light }: {
  menuOpen: boolean;
  setMenuOpen: (value: boolean) => void;
  cartCount: number;
  light: boolean;
}) {
  const navigate = (id: string) => {
    setMenuOpen(false);
    scrollToId(id);
  };

  return (
    <header className={`nav-shell ${light ? 'is-light' : ''}`}>
      <a href="#top" className="nav-wordmark" data-testid="link-home">NIDOR</a>
      <nav className="nav-links" aria-label="Main navigation">
        <button className="nav-link" onClick={() => navigate('collection')} data-testid="link-collection">Collection</button>
        <button className="nav-link" onClick={() => navigate('worlds')} data-testid="link-worlds">The worlds</button>
        <button className="nav-link" onClick={() => navigate('ritual')} data-testid="link-ritual">The ritual</button>
        <button className="cart-button" onClick={() => navigate('collection')} data-testid="button-cart" aria-label={`Cart, ${cartCount} editions`}>
          Cart <span className="cart-count" aria-live="polite">({cartCount})</span>
        </button>
      </nav>
      <button className="mobile-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} data-testid="button-mobile-menu">
        {menuOpen ? 'Close' : 'Menu'}
      </button>
      <nav className="mobile-drawer" hidden={!menuOpen} aria-label="Mobile navigation">
        <button className="nav-menu-link" onClick={() => navigate('collection')} data-testid="mobile-link-collection">Collection</button>
        <button className="nav-menu-link" onClick={() => navigate('worlds')} data-testid="mobile-link-worlds">The worlds</button>
        <button className="nav-menu-link" onClick={() => navigate('ritual')} data-testid="mobile-link-ritual">The ritual</button>
        <button className="nav-menu-link" onClick={() => navigate('collection')} data-testid="mobile-link-cart">Cart ({cartCount})</button>
      </nav>
    </header>
  );
}

function MasterHero() {
  return (
    <section className="master-hero" id="top">
      <div className="master-copy">
        <div className="eyebrow">NIDOR / Fragrance, in edition</div>
        <h1>Meet your<br /><em>next</em> world.</h1>
        <p className="master-lede">
          Five fragrance worlds, composed for the curious. Begin with a small bottle and let the story change as you move through it.
        </p>
        <button className="scroll-cue" onClick={() => scrollToId('collection')} data-testid="button-hero-explore">
          Enter the collection <span>↓</span>
        </button>
        <div className="master-microcopy">5 ml / 10 ml · Scents · Stories · You</div>
      </div>
      <div className="master-visual">
        <img className="master-logo" src="/assets/brand/nidor-landscape.jpeg" alt="NIDOR — by scientists — scents, stories, you" />
      </div>
    </section>
  );
}

function BrandIntro() {
  return (
    <section className="brand-intro" id="collection">
      <div className="eyebrow">A point of view</div>
      <div>
        <h2>There is more than one <em>you.</em></h2>
        <p>
          NIDOR leaves room for curiosity. Scroll slowly through the collection: each edition opens with an image, moves through its notes, and ends with a choice you can make your own.
        </p>
        <div className="intro-index">
          <div><strong>05</strong><span>Scent worlds</span></div>
          <div><strong>02</strong><span>Ways in</span></div>
          <div><strong>∞</strong><span>Possibilities</span></div>
        </div>
      </div>
    </section>
  );
}

function CollectionPreview() {
  return (
    <section className="collection-preview" aria-labelledby="collection-preview-title">
      <div className="collection-preview-heading">
        <div className="eyebrow">The five editions</div>
        <h2 id="collection-preview-title">See the worlds<br /><em>before you enter.</em></h2>
      </div>
      <div className="collection-preview-grid">
        {fragrances.map((fragrance) => (
          <a className="collection-preview-item" href={`#world-${fragrance.id}`} key={fragrance.id}>
            <div className="collection-preview-image">
              <img src={fragrance.image} alt={`${fragrance.name} bottle`} loading="lazy" />
              <span>{fragrance.number}</span>
            </div>
            <div className="collection-preview-meta">
              <strong>{fragrance.name}</strong>
              <span>{fragrance.house}</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function WorldsHeading() {
  return (
    <section className="worlds-heading" id="worlds">
      <div className="eyebrow">The current edit / scroll to explore</div>
      <h2>Five ways<br />to feel <em>seen.</em></h2>
      <p>Every edition is a doorway. The format stays small so the choice can stay expansive. Let the bottle lead.</p>
    </section>
  );
}

function Ritual() {
  return (
    <section className="ritual" id="ritual">
      <div className="ritual-copy">
        <div className="eyebrow">The NIDOR ritual</div>
        <h2>Wear the<br />question.</h2>
        <p>Start with a small spray. Give it time. Notice what arrives after the opening — and what stays when the room has changed.</p>
      </div>
      <div className="ritual-steps">
        <div className="ritual-step"><b>01</b><div><h3>Choose a mood</h3><p>Follow the image, the name, or a feeling you cannot quite place.</p></div></div>
        <div className="ritual-step"><b>02</b><div><h3>Make it yours</h3><p>Try 5 ml for a first conversation, or 10 ml when you know the world you want to revisit.</p></div></div>
        <div className="ritual-step"><b>03</b><div><h3>Let it linger</h3><p>Keep notes. Change your mind. Scent is not a label — it is a story still moving.</p></div></div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <div className="footer-brand">NIDOR</div>
        <div className="footer-tagline">By scientists · Scents · Stories · You</div>
      </div>
      <div className="footer-col">
        <p>Explore</p>
        <a href="#collection" data-testid="footer-link-collection">Collection</a>
        <a href="#worlds" data-testid="footer-link-worlds">The worlds</a>
        <a href="#ritual" data-testid="footer-link-ritual">The ritual</a>
      </div>
      <div className="footer-col">
        <p>Small print</p>
        <span>Descriptions, notes, and prices are placeholders while the collection is being prepared.</span>
      </div>
      <div className="footer-bottom"><span>© 2025 NIDOR</span><span>Made for the curious</span><span>5 ml / 10 ml editions</span></div>
    </footer>
  );
}

function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navLight, setNavLight] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [status, setStatus] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>(
    Object.fromEntries(fragrances.map((item) => [item.id, '5 ml'])),
  );

  useEffect(() => {
    document.title = 'NIDOR — Scents, Stories, You';
    const sections = Array.from(document.querySelectorAll<HTMLElement>('.fragrance-experience'));
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const item = fragrances.find((fragrance) => `world-${fragrance.id}` === entry.target.id);
          if (item) setNavLight(item.theme.light);
        }
      });
    }, { threshold: 0.18 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const setSize = (id: string, size: string) => {
    setSelectedSizes((previous) => ({ ...previous, [id]: size }));
  };

  const addEdition = (fragrance: Fragrance, size: string, quantity: number) => {
    setCartCount((count) => count + quantity);
    setStatus(`${quantity} × ${fragrance.name} · ${size} added to your edit. Pricing is placeholder content for now.`);
    window.setTimeout(() => setStatus(''), 4800);
  };

  return (
    <div className="nidor-page grain">
      <Header menuOpen={menuOpen} setMenuOpen={setMenuOpen} cartCount={cartCount} light={navLight} />
      <main>
        <LandingExperience />
        {fragrances.map((fragrance, index) => (
          <FragranceExperience
            key={fragrance.id}
            fragrance={fragrance}
            previousWorld={index === 0 ? '#242d40' : fragrances[index - 1].theme.deep}
            selectedSize={selectedSizes[fragrance.id]}
            onSizeChange={(size) => setSize(fragrance.id, size)}
            onAdd={addEdition}
          />
        ))}
        <div className="selection-status" aria-live="polite" data-testid="status-cart">
          {status || 'Select a size inside any world to keep an edition in your edit.'}
        </div>
        <Ritual />
      </main>
      <Footer />
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;