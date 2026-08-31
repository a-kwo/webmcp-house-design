import { buildTemplate } from './templates';
import type { Furniture } from './types';

/**
 * The canonical TEST FIXTURE: the two-bedroom template with a full set of
 * furniture in known positions, which the clearance, swing and overlap rules
 * need something to bite on.
 *
 * The app itself no longer starts here -- templates ship unfurnished, because
 * furnishing the shell is the work the human and the agent do together. Only
 * the test suite wants a pre-furnished house with stable ids.
 */
const furniture: Furniture[] = [
  { id: 'sofa-1', catalogId: 'sofa', roomId: 'living', position: { x: 72, y: 72 }, rotation: 0, footprint: { w: 84, d: 36 }, clearanceFront: 24 },
  { id: 'island-1', catalogId: 'kitchen-island', roomId: 'kitchen', position: { x: 264, y: 78 }, rotation: 0, footprint: { w: 72, d: 36 }, clearanceFront: 42 },
  { id: 'range-1', catalogId: 'range', roomId: 'kitchen', position: { x: 360, y: 54 }, rotation: 90, footprint: { w: 30, d: 30 }, clearanceFront: 40 },
  { id: 'toilet-1', catalogId: 'toilet', roomId: 'bath', position: { x: 192, y: 198 }, rotation: 90, footprint: { w: 18, d: 28 }, clearanceFront: 21 },
  { id: 'sink-1', catalogId: 'sink', roomId: 'bath', position: { x: 192, y: 274 }, rotation: 90, footprint: { w: 24, d: 20 } },
  { id: 'bed-1', catalogId: 'queen-bed', roomId: 'bed1', position: { x: 60, y: 252 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
  { id: 'bed-2', catalogId: 'queen-bed', roomId: 'bed2', position: { x: 324, y: 220 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
];

export const sampleFloorplan = { ...buildTemplate('two-bed'), furniture };
