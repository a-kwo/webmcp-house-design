import { buildPlan } from './buildPlan';
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

// The fixture's own frozen geometry: a copy of the two-bedroom shell as it
// stood when these tests were written, plus the deliberately narrow 30in
// bathroom door the rule tests bite on. Deliberately NOT built from the
// shipping templates -- those are free to grow and reshape without every
// coordinate-pinned test below needing to move with them.
export const sampleFloorplan = {
  ...buildPlan({
    rooms: [
      { id: 'living', name: 'Living Room', type: 'living', x: 0, y: 0, w: 216, d: 180 },
      { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 216, y: 0, w: 168, d: 120, wetWalls: ['E'] },
      { id: 'hall', name: 'Hallway', type: 'hallway', x: 216, y: 120, w: 42, d: 180 },
      { id: 'bed1', name: 'Bedroom 1', type: 'bedroom', x: 0, y: 180, w: 132, d: 120 },
      { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 132, y: 180, w: 84, d: 120, wetWalls: ['E'] },
      { id: 'bed2', name: 'Bedroom 2', type: 'bedroom', x: 258, y: 120, w: 126, d: 180 },
    ],
    openings: [
      { id: 'entry', kind: 'door', at: { x: 0, y: 108 }, width: 36, swing: 'in-left' },
      { id: 'living-kitchen', kind: 'archway', at: { x: 216, y: 78 }, width: 42, height: 84, swing: 'none' },
      { id: 'living-bed1', kind: 'door', at: { x: 64, y: 180 }, width: 32, swing: 'in-right' },
      { id: 'living-hall', kind: 'door', at: { x: 216, y: 150 }, width: 32, swing: 'in-left' },
      { id: 'hall-bath', kind: 'door', at: { x: 216, y: 237 }, width: 30, swing: 'in-left' },
      { id: 'hall-bed2', kind: 'door', at: { x: 258, y: 236 }, width: 32, swing: 'in-right' },
      { id: 'bed1-window', kind: 'window', at: { x: 0, y: 246 }, width: 36 },
      { id: 'bed2-window', kind: 'window', at: { x: 384, y: 216 }, width: 36 },
    ],
    furniture: [],
  }),
  furniture,
};
