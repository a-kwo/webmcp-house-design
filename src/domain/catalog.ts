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
  { id: 'queen-bed', label: 'Queen bed', w: 60, d: 80, clearanceFront: 24 },
  { id: 'sofa', label: 'Sofa', w: 84, d: 36, clearanceFront: 24 },
  { id: 'table', label: 'Table', w: 48, d: 30, clearanceFront: 30 },
  { id: 'dresser', label: 'Dresser', w: 36, d: 20, clearanceFront: 30 },
  { id: 'kitchen-island', label: 'Island', w: 72, d: 36, clearanceFront: 42 },
  { id: 'counter', label: 'Counter', w: 60, d: 24 },
  { id: 'range', label: 'Range', w: 30, d: 30, clearanceFront: 40 },
  { id: 'sink', label: 'Sink', w: 24, d: 20 },
  { id: 'toilet', label: 'Toilet', w: 18, d: 28, clearanceFront: 21 },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
