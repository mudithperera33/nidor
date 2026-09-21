import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { type Fragrance, fragrances } from '@/data/fragrances';

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

function sceneOpacity(progress: number, start: number, end: number) {
  const span = Math.max(.001, end - start);
  const enter = smoothstep(clamp((progress - start) / (span * .18)));
  const exit = 1 - smoothstep(clamp((progress - (end - span * .14)) / (span * .14)));
  return enter * exit;
}

function sequenceSceneStyle(progress: number, start: number, end: number, lift = 22): CSSProperties {
  const opacity = sceneOpacity(progress, start, end);
  return {
    opacity,
    visibility: opacity > .001 ? 'visible' : 'hidden',
    pointerEvents: opacity > .2 ? 'auto' : 'none',
    transform: `translate3d(0, ${(1 - opacity) * lift}px, 0)`,
  };
}

function useLandingProgress(ref: RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
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
  }, [ref]);

  return progress;
}

function scrollToWorld(id: string) {
  document.getElementById(`world-${id}`)?.scrollIntoView({ behavior: 'smooth' });
}

function fragranceMeta(fragrance: Fragrance) {
  return [fragrance.house, fragrance.family, fragrance.gender, fragrance.concentration].filter(Boolean).join(' · ');
}

export function LandingExperience() {
  const landingRef = useRef<HTMLElement>(null);
  const progress = useLandingProgress(landingRef);
  const collectionProgress = clamp((progress - .62) / .28);
  const activeIndex = Math.min(fragrances.length - 1, Math.floor(collectionProgress * fragrances.length));
  const activeFragrance = fragrances[activeIndex];
  const activeTheme = progress < .58 ? { surface: '#f1eadc', deep: '#d7c09b', accent: '#b8894a' } : activeFragrance.theme;

  const logoStyle = useMemo(() => ({
    opacity: 1 - smoothstep(clamp(progress / .27)),
    visibility: progress < .16 ? 'visible' : 'hidden',
    pointerEvents: 'none',
    transform: `translate3d(0, ${progress * -12}vh, 0) scale(${(1 - smoothstep(clamp(progress / .3)) * .34).toFixed(3)})`,
  }) as CSSProperties, [progress]);

  const landscapeStyle = useMemo(() => {
    const reveal = sceneOpacity(progress, .18, .31);
    return {
      ...sequenceSceneStyle(progress, .18, .31),
      opacity: reveal,
      clipPath: `inset(0 ${(1 - reveal) * 28}% 0 ${(1 - reveal) * 28}% round ${Math.max(0, (1 - reveal) * 16)}px)`,
      transform: `translate3d(${(1 - reveal) * 2}%, ${Math.sin(progress * Math.PI) * -1.5}%, 0) scale(${(1.05 - reveal * .05).toFixed(3)})`,
    };
  }, [progress]);

  const backdropStyle = useMemo(() => ({
    '--landing-surface': activeTheme.surface,
    '--landing-deep': activeTheme.deep,
    '--landing-accent': activeTheme.accent,
    background: `linear-gradient(145deg, color-mix(in srgb, ${activeTheme.surface} 82%, #f1eadc) 0%, ${activeTheme.surface} 52%, color-mix(in srgb, ${activeTheme.deep} 35%, ${activeTheme.surface}) 100%)`,
  }) as CSSProperties, [activeTheme]);

  const philosophyWords = [
    { word: 'SCENTS', className: 'is-left' },
    { word: 'STORIES', className: 'is-right' },
    { word: 'YOU', className: 'is-center' },
  ];

  return (
    <section
      ref={landingRef}
      id="collection"
      className="landing-experience"
      style={backdropStyle}
      data-testid="landing-experience"
    >
      <div className="landing-sticky">
        <div className="landing-atmosphere" />
        <div className="landing-orbit landing-orbit-one" />
        <div className="landing-orbit landing-orbit-two" />
        <div className="landing-progress" aria-hidden="true"><span style={{ height: `${progress * 100}%` }} /></div>

        <div className="landing-logo-scene" style={logoStyle}>
          <div className="landing-eyebrow">NIDOR / By scientists</div>
          <img className="landing-official-logo" src="/assets/brand/nidor-landscape.jpeg" alt="NIDOR — by scientists — scents, stories, you" />
          <div className="landing-tagline" style={{ opacity: sceneOpacity(progress, .1, .29) }}>
            SCENTS <span>✦</span> STORIES <span>✦</span> YOU
          </div>
          <div className="landing-scroll-cue" style={{ opacity: 1 - smoothstep(clamp(progress / .12)) }}>
            Scroll to enter <span>↓</span>
          </div>
        </div>

        <div className="landing-landscape-scene" style={landscapeStyle}>
          <img src="/assets/brand/nidor-logo.png" alt="NIDOR logo mark on a transparent background" />
          <div className="landing-landscape-caption">A fragrance collection / composed in light</div>
        </div>

        <div
          className="landing-philosophy"
          id="worlds"
          aria-label="NIDOR philosophy"
          style={sequenceSceneStyle(progress, .34, .47)}
        >
          <div className="landing-eyebrow">The NIDOR point of view</div>
          {philosophyWords.map(({ word, className }) => (
            <div className={`landing-philosophy-word ${className}`} key={word}>
              {word}
            </div>
          ))}
          <p className="landing-philosophy-note">
            Five editions. Five ways into the same question: who are you becoming?
          </p>
        </div>

        <div className="landing-find-scene" style={sequenceSceneStyle(progress, .50, .59)}>
          <div className="landing-eyebrow">The collection</div>
          <h1>Find your<br /><em>scent.</em></h1>
          <p>Five fragrances. Five different worlds. One collection by NIDOR.</p>
        </div>

        <div className="landing-collection-scene" style={sequenceSceneStyle(progress, .62, .94)}>
          <div className="landing-collection-heading">
            <div className="landing-eyebrow">The five fragrance worlds</div>
            <span>Scroll through the edit</span>
          </div>
          <div className="landing-bottle-stage" aria-hidden="true">
            {fragrances.map((fragrance, index) => {
              const distance = index - activeIndex;
              const emphasis = index === activeIndex ? 1 : Math.max(.2, 1 - Math.abs(distance) * .25);
              return (
                <img
                  key={fragrance.id}
                  className={`landing-bottle ${index === activeIndex ? 'is-active' : ''}`}
                  src={fragrance.image}
                  alt=""
                  style={{
                    '--bottle-shift': `${distance * 14}vw`,
                    '--bottle-y': `${Math.abs(distance) * 8 + (index % 2) * 5}px`,
                    '--bottle-scale': (emphasis * (index === activeIndex ? 1.18 : .8)).toFixed(3),
                    '--bottle-opacity': emphasis.toFixed(3),
                  } as CSSProperties}
                />
              );
            })}
          </div>
          <div className="landing-collection-list" role="list" aria-label="Fragrance collection">
            {fragrances.map((fragrance, index) => (
              <button
                type="button"
                className={`landing-collection-item ${index === activeIndex ? 'is-active' : ''}`}
                key={fragrance.id}
                onClick={() => scrollToWorld(fragrance.id)}
                aria-label={`Enter ${fragrance.name}`}
              >
                <span>{fragrance.number}</span>
                <strong>{fragrance.name}</strong>
                <small>{fragrance.house}</small>
              </button>
            ))}
          </div>
          <div className="landing-collection-detail">
            <div className="landing-detail-number">{activeFragrance.number} / 05</div>
            <h2>{activeFragrance.name}</h2>
            <p>{activeFragrance.description}</p>
            <div className="landing-detail-meta">{fragranceMeta(activeFragrance)}</div>
            <div className="landing-note-summary">
              {activeFragrance.notes.map((group) => (
                <div key={group.label}>
                  <span>{group.label.replace(' notes', '')}</span>
                  <strong>{group.notes.join(' · ')}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="landing-handoff" style={sequenceSceneStyle(progress, .95, 1, 0)}>
          <span>01</span>
          <strong>Hawas Gold Digger</strong>
          <em>Enter the first world ↓</em>
        </div>
      </div>
    </section>
  );
}