/**
 * The furniture catalog: what the palette offers a human and what the agent's
 * place_furniture docs point at. One list, so the two can never drift.
 * Footprints are typical retail sizes in inches.
 *
 * `tintable: false` marks porcelain and glass pieces whose look is the
 * material itself; everything else accepts a colour, and no colour means the
 * default finish.
 */
export type CatalogItem = {
  id: string;
  label: string;
  category: string;
  w: number;
  d: number;
  clearanceFront?: number;
  tintable?: boolean;
};

export const CATALOG_CATEGORIES = ['Living', 'Bedroom', 'Kitchen', 'Bath & Utility'] as const;

/** Finishes offered in the palette; agents may pass any CSS colour. */
export const FINISHES: { label: string; value: string }[] = [
  { label: 'Charcoal', value: '#3a3d42' },
  { label: 'Cream', value: '#e8e2d5' },
  { label: 'Sage', value: '#7d8b74' },
  { label: 'Navy', value: '#46536b' },
  { label: 'Rust', value: '#a05a44' },
  { label: 'Walnut', value: '#6b5138' },
];

export const CATALOG: CatalogItem[] = [
  { id: 'sofa', label: 'Sofa', category: 'Living', w: 84, d: 36, clearanceFront: 24 },
  { id: 'tv-stand', label: 'TV', category: 'Living', w: 60, d: 18, clearanceFront: 60 },
  { id: 'table', label: 'Table', category: 'Living', w: 48, d: 30, clearanceFront: 30 },
  { id: 'bookshelf', label: 'Bookshelf', category: 'Living', w: 36, d: 12, clearanceFront: 24 },
  { id: 'chair', label: 'Chair', category: 'Living', w: 22, d: 22 },
  { id: 'queen-bed', label: 'Queen bed', category: 'Bedroom', w: 60, d: 80, clearanceFront: 24 },
  { id: 'nightstand', label: 'Nightstand', category: 'Bedroom', w: 20, d: 16 },
  { id: 'dresser', label: 'Dresser', category: 'Bedroom', w: 36, d: 20, clearanceFront: 30 },
  { id: 'wardrobe', label: 'Wardrobe', category: 'Bedroom', w: 48, d: 24, clearanceFront: 30 },
  { id: 'desk', label: 'Desk', category: 'Bedroom', w: 48, d: 24, clearanceFront: 30 },
  { id: 'kitchen-island', label: 'Island', category: 'Kitchen', w: 72, d: 36, clearanceFront: 42 },
  { id: 'counter', label: 'Counter', category: 'Kitchen', w: 60, d: 24 },
  // A range is the stove-plus-oven unit; the label says stove because that is
  // the word people actually reach for.
  { id: 'range', label: 'Stove', category: 'Kitchen', w: 30, d: 30, clearanceFront: 40 },
  { id: 'fridge', label: 'Fridge', category: 'Kitchen', w: 36, d: 30, clearanceFront: 36 },
  { id: 'toilet', label: 'Toilet', category: 'Bath & Utility', w: 18, d: 28, clearanceFront: 21, tintable: false },
  { id: 'sink', label: 'Sink', category: 'Bath & Utility', w: 24, d: 20, tintable: false },
  { id: 'tub', label: 'Bathtub', category: 'Bath & Utility', w: 60, d: 30, clearanceFront: 21, tintable: false },
  { id: 'shower', label: 'Shower', category: 'Bath & Utility', w: 36, d: 36, clearanceFront: 24, tintable: false },
  { id: 'washer', label: 'Washer', category: 'Bath & Utility', w: 27, d: 28, clearanceFront: 36 },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
