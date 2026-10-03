import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FragranceNotes } from '@/components/fragrance-notes';
import { type Fragrance } from '@/data/fragrances';
import { sceneChoreography, sceneVisibility } from '@/data/scene-choreography';

type FragranceExperienceProps = {
  fragrance: Fragrance;
  previousWorld: string;
  selectedSize: number;
  onSizeChange: (size: number) => void;
  onAdd: (fragrance: Fragrance, size: number, quantity: number) => void;
};

function formatLkr(value: number): string {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(value);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReduced = () => setReduced(media.matches);
    updateReduced();
    media.addEventListener('change', updateReduced);
    return () => media.removeEventListener('change', updateReduced);
  }, []);

  useEffect(() => {
    if (reduced) {
      setProgress(0.95);
      return;
    }
    let frame = 0;
    const update = () => {
      const element = ref.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const scrollable = Math.max(1, element.offsetHeight - window.innerHeight);
      setProgress(clamp(-rect.top / scrollable));
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reduced, ref]);

  return progress;
}

export function FragranceExperience({ fragrance, previousWorld, selectedSize, onSizeChange, onAdd }: FragranceExperienceProps) {
  const experienceRef = useRef<HTMLElement>(null);
  const progress = useScrollProgress(experienceRef);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const { theme, visual } = fragrance;
  const selectedVariant = fragrance.variants.find((variant) => variant.sizeMl === selectedSize);
  const priceIsReady = !!selectedVariant
    && !selectedVariant.priceNeedsConfiguration
    && selectedVariant.priceLkr !== null;
  const stockIsReady = !!selectedVariant && !selectedVariant.stockNeedsConfiguration;
  const canAdd = !!selectedVariant
    && selectedVariant.isActive
    && priceIsReady
    && stockIsReady
    && selectedVariant.stockQuantity > 0
    && quantity <= selectedVariant.stockQuantity;
  const maxQuantityReached = stockIsReady
    && (selectedVariant?.stockQuantity ?? 0) > 0
    && quantity >= (selectedVariant?.stockQuantity ?? 0);

  useEffect(() => {
    setQuantity(1);
  }, [fragrance.id, selectedSize]);

  const bottleStyle = useMemo(() => {
    const reveal = smoothstep(clamp((progress - 0.05) / 0.24));
    const orderBlur = smoothstep(clamp((progress - sceneChoreography.order.enter[0]) / (1 - sceneChoreography.order.enter[0])));
    const x = Math.sin(progress * Math.PI * 2.1) * 36;
    const y = 55 - reveal * 105 + Math.sin(progress * Math.PI) * 18;
    const scale = 0.68 + reveal * 0.25 + smoothstep(clamp((progress - 0.56) / 0.36)) * 0.13;
    const rotate = -7 + progress * 14 + Math.sin(progress * Math.PI * 1.5) * 2;
    const shadow = clamp((progress - 0.12) / 0.28) * 0.9;
    return {
      '--product-x': `${x}px`,
      '--product-y': `${y}px`,
      '--product-scale': scale.toFixed(3),
      '--product-rotate': `${rotate.toFixed(2)}deg`,
      '--product-opacity': isImageLoaded ? Math.max(.16, reveal * (1 - orderBlur * .34)).toFixed(3) : '0',
      '--product-blur': `${(orderBlur * 10).toFixed(2)}px`,
      '--shadow-scale': (0.7 + shadow * .3).toFixed(3),
      '--shadow-opacity': shadow.toFixed(3),
    } as CSSProperties;
  }, [isImageLoaded, progress]);

  const visualStyle = useMemo(() => ({
    '--visual-x': `${visual.x * 100}%`,
    '--visual-y': `${visual.y * 100}%`,
    '--visual-scale': visual.scale.toFixed(3),
    '--visual-rotation': `${visual.rotation}deg`,
  }) as CSSProperties, [visual]);

  const scene = useMemo(() => ({
    intro: sceneVisibility(progress, sceneChoreography.intro),
    reveal: sceneVisibility(progress, sceneChoreography.bottleReveal),
    story: sceneVisibility(progress, sceneChoreography.story),
    finalProduct: sceneVisibility(progress, sceneChoreography.finalProduct),
    order: sceneVisibility(progress, sceneChoreography.order),
  }), [progress]);

  const revealStyle = (fraction: number) => {
    const orderStart = sceneChoreography.order.enter[0];
    const orderSpan = sceneChoreography.order.exit[1] - orderStart;
    const start = orderStart + orderSpan * fraction * .24;
    const reveal = smoothstep(clamp((progress - start) / Math.max(.01, orderSpan * .08)));
    return {
      opacity: reveal,
      transform: `translate3d(0, ${(1 - reveal) * 16}px, 0) scale(${(.98 + reveal * .02).toFixed(3)})`,
    };
  };

  return (
    <section
      ref={experienceRef}
      className="fragrance-experience"
      id={`world-${fragrance.id}`}
      style={{
        '--world-surface': theme.surface,
        '--world-deep': theme.deep,
        '--world-accent': theme.accent,
        '--world-previous': previousWorld,
        '--world-foreground': theme.light ? 'var(--ivory)' : '#201b17',
      } as CSSProperties}
      data-testid={`experience-${fragrance.id}`}
    >
      <div className="experience-progress" aria-hidden="true"><span style={{ height: `${progress * 100}%` }} /></div>
      <div className="experience-sticky">
        <div className="scene-wash" />
        <div className="scene-rule" style={{ transform: `translateX(-50%) rotate(${progress * 22 - 11}deg) translateY(${progress * -4}%)` }} />
        <div className="scene-word" style={{ transform: `translate3d(${progress * -6}%, ${progress * 10 - 5}%, 0)` }}>{fragrance.name.split(' ')[0]}</div>
        <div className="scene-stage">
          <div className="product-shadow" style={bottleStyle} />
          <div className="product-position-wrapper" style={visualStyle}>
            <div className="product-frame" style={bottleStyle}>
              <img
                className="product-image"
                src={fragrance.image}
                alt={`${fragrance.name} bottle and packaging`}
                loading="lazy"
                onLoad={() => setIsImageLoaded(true)}
              />
            </div>
          </div>
        </div>

        <div className="scene-copy" style={{ opacity: scene.intro, transform: `translate3d(${(1 - scene.intro) * -24}px, 0, 0)` }}>
          <h3>{fragrance.name}</h3>
          <p>{fragrance.description}</p>
        </div>
        <div className="scene-copy" style={{ opacity: scene.reveal, transform: `translate3d(0, ${(1 - scene.reveal) * 26}px, 0)` }}>
          <h3>Let the<br /><em>world</em> arrive.</h3>
        </div>

        {fragrance.notes.map((group, index) => (
          <FragranceNotes
            key={group.label}
            group={group}
            groupIndex={index}
            progress={progress}
            timing={[sceneChoreography.topNotes, sceneChoreography.heartNotes, sceneChoreography.baseNotes][index]}
          />
        ))}

        <div className="scene-copy is-story" style={{ opacity: scene.story, transform: `translate3d(${(1 - scene.story) * 30}px, 0, 0)` }}>
          <h3 className="story-title">{fragrance.story}</h3>
          <p>{fragrance.description}</p>
        </div>

        <div className="scene-copy is-final-product" style={{ opacity: scene.finalProduct, transform: `translate3d(0, ${(1 - scene.finalProduct) * 22}px, 0)` }}>
          <h3>Make it<br /><em>yours.</em></h3>
          <p>Stay with the world a little longer, then choose the edition that belongs in your ritual.</p>
        </div>

        <div className="product-selector order-reveal" style={{ opacity: scene.order, transform: `translate3d(-50%, ${(1 - scene.order) * 28}px, 0)` }}>
          <div className="order-reveal-inner">
            <h4 style={revealStyle(.12)}>{fragrance.name}</h4>
            <p className="order-description" style={revealStyle(.22)}>{fragrance.description}</p>
            <div className="size-row" style={revealStyle(.36)} aria-label={`Select size for ${fragrance.name}`}>
              {([5, 10] as const).map((size) => {
                const variant = fragrance.variants.find((item) => item.sizeMl === size);
                return (
                <button
                  key={`${size}-ml`}
                  type="button"
                  className={`size-button ${selectedSize === size ? 'is-selected' : ''}`}
                  onClick={() => onSizeChange(size)}
                  aria-pressed={selectedSize === size}
                  aria-label={`${size} ml${variant?.isActive ? '' : ', unavailable'}`}
                  title={variant?.isActive ? `${size} ml` : 'This size is not available'}
                  disabled={!variant?.isActive}
                  data-testid={`button-size-${fragrance.id}-${size}-ml`}
                >
                  {size} ml
                </button>
                );
              })}
            </div>
            <div className="order-controls">
              <div className="order-price" style={revealStyle(.54)}>
                <span>Price</span>
                <strong>{priceIsReady ? formatLkr(selectedVariant.priceLkr!) : 'To be confirmed'}</strong>
                {selectedVariant?.priceNeedsConfiguration && <small className="order-availability">Price needs configuration</small>}
                {!selectedVariant && <small className="order-availability">Size unavailable</small>}
              </div>
              <div className="quantity-control" style={revealStyle(.7)} aria-label={`Quantity for ${fragrance.name}`}>
                <span>Quantity</span>
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" disabled={quantity <= 1}>−</button>
                <strong aria-live="polite">{quantity}</strong>
                <button type="button" onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity" disabled={!stockIsReady || selectedVariant?.stockQuantity === 0 || maxQuantityReached}>+</button>
              </div>
            </div>
            <div className="order-availability" role="status" aria-live="polite">
              {!selectedVariant || !selectedVariant.isActive
                ? 'This size is unavailable.'
                : selectedVariant.stockNeedsConfiguration
                  ? 'Availability to be confirmed.'
                  : selectedVariant.stockQuantity === 0
                    ? 'Currently out of stock.'
                    : !priceIsReady
                      ? 'Price to be confirmed.'
                      : `${selectedVariant.stockQuantity} available`}
            </div>
            <button
              className="add-button"
              style={revealStyle(.86)}
              onClick={() => onAdd(fragrance, selectedSize, quantity)}
              disabled={!canAdd}
              data-testid={`button-add-${fragrance.id}`}
            >
              {canAdd
                ? 'Add to cart'
                : !selectedVariant || !selectedVariant.isActive
                  ? 'Unavailable'
                  : selectedVariant.stockNeedsConfiguration
                    ? 'Stock to be confirmed'
                    : selectedVariant.stockQuantity === 0
                      ? 'Out of stock'
                      : 'Price to be confirmed'}
            </button>
          </div>
        </div>
        <div className="experience-transition" style={{ opacity: smoothstep(clamp((progress - .99) / .01)) }}>Continue into the next world ↓</div>
      </div>
    </section>
  );
}