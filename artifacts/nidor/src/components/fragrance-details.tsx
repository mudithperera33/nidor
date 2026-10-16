import type { CSSProperties } from 'react';
import type { Fragrance } from '@/data/fragrances';

type FragranceDetailsProps = {
  fragrance: Pick<Fragrance, 'slug' | 'family' | 'gender' | 'concentration'>;
  style?: CSSProperties;
};

export function FragranceDetails({ fragrance, style }: FragranceDetailsProps) {
  const details = [
    { label: 'Family', value: fragrance.family },
    { label: 'Audience', value: fragrance.gender },
    { label: 'Concentration', value: fragrance.concentration },
  ].flatMap(({ label, value }) => {
    const normalizedValue = value?.trim();
    return normalizedValue ? [{ label, value: normalizedValue }] : [];
  });

  if (details.length === 0) return null;

  return (
    <dl className="sf-fragrance-details" data-testid={`fragrance-details-${fragrance.slug}`} style={style}>
      {details.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
