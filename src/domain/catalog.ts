/**
 * The furniture catalog: what the palette offers a human and what the agent's
 * place_furniture docs point at. One list, so the two can never drift.
 * Footprints are typical retail sizes in inches.
 */
export type CatalogItem = {
  id: string;
  label: string;
  w: number;
  d: number;
  clearanceFront?: number;
};

export const CATALOG: CatalogItem[] = [
  // Living
  { id: 'sofa', label: 'Sofa', w: 84, d: 36, clearanceFront: 24 },
  { id: 'tv-stand', label: 'TV', w: 60, d: 18, clearanceFront: 60 },
  { id: 'table', label: 'Table', w: 48, d: 30, clearanceFront: 30 },
  { id: 'bookshelf', label: 'Bookshelf', w: 36, d: 12, clearanceFront: 24 },
  { id: 'chair', label: 'Chair', w: 22, d: 22 },
  // Bedroom
  { id: 'queen-bed', label: 'Queen bed', w: 60, d: 80, clearanceFront: 24 },
  { id: 'nightstand', label: 'Nightstand', w: 20, d: 16 },
  { id: 'dresser', label: 'Dresser', w: 36, d: 20, clearanceFront: 30 },
  { id: 'wardrobe', label: 'Wardrobe', w: 48, d: 24, clearanceFront: 30 },
  { id: 'desk', label: 'Desk', w: 48, d: 24, clearanceFront: 30 },
  // Kitchen
  { id: 'kitchen-island', label: 'Island', w: 72, d: 36, clearanceFront: 42 },
  { id: 'counter', label: 'Counter', w: 60, d: 24 },
  // A range is the stove-plus-oven unit; the label says stove because that is
  // the word people actually reach for.
  { id: 'range', label: 'Stove', w: 30, d: 30, clearanceFront: 40 },
  { id: 'fridge', label: 'Fridge', w: 36, d: 30, clearanceFront: 36 },
  // Bath and utility
  { id: 'toilet', label: 'Toilet', w: 18, d: 28, clearanceFront: 21 },
  { id: 'sink', label: 'Sink', w: 24, d: 20 },
  { id: 'tub', label: 'Bathtub', w: 60, d: 30, clearanceFront: 21 },
  { id: 'shower', label: 'Shower', w: 36, d: 36, clearanceFront: 24 },
  { id: 'washer', label: 'Washer', w: 27, d: 28, clearanceFront: 36 },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
