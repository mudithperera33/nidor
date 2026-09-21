export type FragranceTheme = {
  surface: string;
  deep: string;
  accent: string;
  light: boolean;
};

export type NoteGroup = {
  label: 'Top notes' | 'Heart notes' | 'Base notes';
  notes: string[];
};

export type FragranceVisualConfig = {
  scale: number;
  x: number;
  y: number;
  rotation: number;
};

export type Fragrance = {
  id: string;
  number: string;
  name: string;
  house: string;
  family?: string;
  gender?: string;
  concentration?: string;
  image: string;
  price?: string;
  theme: FragranceTheme;
  description: string;
  story: string;
  notes: NoteGroup[];
  visual: FragranceVisualConfig;
};

// Copy is intentionally marked as placeholder until approved collection data is connected.
export const fragrances: Fragrance[] = [
  {
    id: 'gold-digger',
    number: '01',
    name: 'Hawas Gold Digger',
    house: 'Rasasi · Hawas',
    family: 'Woody Aromatic',
    gender: 'Men',
    image: '/assets/fragrances/hawas-gold-digger.png',
    theme: { surface: '#d9c79f', deep: '#172c53', accent: '#e3bf76', light: true },
    description: 'A woody aromatic composition built around a bright pear, mint, lavender, and bergamot opening.',
    story: 'A BRIGHT STUDY IN CONFIDENCE.',
    visual: { scale: 0.97, x: 0.015, y: 0, rotation: 0 },
    notes: [
      { label: 'Top notes', notes: ['Pear', 'Mint', 'Lavender', 'Bergamot'] },
      { label: 'Heart notes', notes: ['Cinnamon', 'Sage'] },
      { label: 'Base notes', notes: ['Vanilla', 'Amber', 'Cedarwood', 'Patchouli'] },
    ],
  },
  {
    id: 'club-woman',
    number: '02',
    name: 'Club de Nuit Woman',
    house: 'Armaf',
    family: 'Floral',
    gender: 'Women',
    concentration: 'Eau de Parfum',
    image: '/assets/fragrances/armaf-club-de-nuit-woman.png',
    theme: { surface: '#dfc2bc', deep: '#694c55', accent: '#f0d3b0', light: false },
    description: 'An elegant fragrance with a bright fruity opening, floral heart, and warm musky-vanillic base.',
    story: 'A SOFT CONTRAST IN FULL BLOOM.',
    visual: { scale: 1.01, x: 0.012, y: -0.02, rotation: 0 },
    notes: [
      { label: 'Top notes', notes: ['Bergamot', 'Grapefruit', 'Peach', 'Orange'] },
      { label: 'Heart notes', notes: ['Geranium', 'Jasmine', 'Litchi', 'Rose'] },
      { label: 'Base notes', notes: ['Musk', 'Patchouli', 'Vanilla', 'Vetiver'] },
    ],
  },
  {
    id: 'yara',
    number: '03',
    name: 'Yara',
    house: 'Lattafa',
    family: 'Amber Vanilla',
    gender: 'Women',
    image: '/assets/fragrances/lattafa-yara.png',
    theme: { surface: '#edc2c8', deep: '#9c556d', accent: '#f6d4c4', light: false },
    description: 'A soft, sweet, and creamy fragrance with powdery florals, tropical-gourmand facets, and warm vanilla.',
    story: 'A CREAMY CHAPTER IN PINK.',
    visual: { scale: 1.02, x: -0.08, y: -0.02, rotation: 0 },
    notes: [
      { label: 'Top notes', notes: ['Tangerine', 'Heliotrope', 'Orchid'] },
      { label: 'Heart notes', notes: ['Tropical Notes', 'Gourmand'] },
      { label: 'Base notes', notes: ['Vanilla', 'Sandalwood', 'Musk'] },
    ],
  },
  {
    id: 'hawas-chrome',
    number: '04',
    name: 'Hawas Chrome',
    house: 'Rasasi',
    family: 'Fruity / Amber',
    gender: 'Unisex',
    image: '/assets/fragrances/hawas-chrome.png',
    theme: { surface: '#cbd3d5', deep: '#456a78', accent: '#e9edf0', light: false },
    description: 'A fruity amber profile shaped by peach, sweet orange, yellow fruits, and a soft musky base.',
    story: 'A COOL LINE THROUGH BRIGHT AIR.',
    visual: { scale: 1.04, x: 0.024, y: -0.01, rotation: 0 },
    notes: [
      { label: 'Top notes', notes: ['Peach', 'Sweet Orange', 'Yellow Fruits'] },
      { label: 'Heart notes', notes: ['Passion Fruit', 'Fruits', 'Mango', 'Water'] },
      { label: 'Base notes', notes: ['Musk', 'Amber', 'Vanilla'] },
    ],
  },
  {
    id: 'club-intense',
    number: '05',
    name: 'Club de Nuit Intense Man',
    house: 'Armaf',
    family: 'Woody',
    gender: 'Men',
    image: '/assets/fragrances/armaf-club-de-nuit-intense-man.png',
    theme: { surface: '#85888a', deep: '#191a1c', accent: '#d4ae68', light: true },
    description: 'A woody fragrance with a bright fruity-citrus opening, floral-woody heart, and warm musky-ambery base.',
    story: 'A BRIGHT TRACE AFTER DARK.',
    visual: { scale: 1.01, x: -0.005, y: -0.03, rotation: 0 },
    notes: [
      { label: 'Top notes', notes: ['Apple', 'Bergamot', 'Blackcurrant', 'Pineapple', 'Lemon'] },
      { label: 'Heart notes', notes: ['Rose', 'Birch', 'Jasmine'] },
      { label: 'Base notes', notes: ['Musk', 'Ambergris', 'Patchouli', 'Vanilla'] },
    ],
  },
];