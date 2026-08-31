import { buildPlan } from './buildPlan';
import type { PlanSpec } from './buildPlan';
import type { Floorplan } from './types';

export type Template = {
  id: string;
  name: string;
  /** One line the picker card and the agent both show. */
  description: string;
  spec: PlanSpec;
};

/**
 * The starting shells a design begins from. Each is a data description run
 * through the same generator, so a template is a handful of rectangles and
 * where its doors sit -- not a second way of building plans.
 *
 * Two of the three open clean. The two-bedroom keeps one deliberate violation
 * (a 30in bathroom door) so there is something legible to fix in a demo.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'studio',
    name: 'Studio',
    description: 'One open room with a bathroom and a closet. 432 sq ft.',
    spec: {
      rooms: [
        { id: 'main', name: 'Studio', type: 'living', x: 0, y: 0, w: 216, d: 216 },
        { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 216, y: 0, w: 72, d: 108, wetWalls: ['W'] },
        { id: 'closet', name: 'Closet', type: 'closet', x: 216, y: 108, w: 72, d: 108 },
      ],
      openings: [
        { id: 'entry', kind: 'door', at: { x: 0, y: 108 }, width: 36, swing: 'in-left' },
        { id: 'main-bath', kind: 'door', at: { x: 216, y: 54 }, width: 32, swing: 'out-right' },
        { id: 'main-closet', kind: 'door', at: { x: 216, y: 162 }, width: 32, swing: 'out-left' },
        { id: 'main-window', kind: 'window', at: { x: 108, y: 0 }, width: 48 },
        { id: 'main-window-2', kind: 'window', at: { x: 0, y: 180 }, width: 36 },
      ],
      furniture: [
        { id: 'bed-1', catalogId: 'queen-bed', roomId: 'main', position: { x: 54, y: 168 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
        { id: 'sofa-1', catalogId: 'sofa', roomId: 'main', position: { x: 126, y: 48 }, rotation: 0, footprint: { w: 84, d: 36 }, clearanceFront: 24 },
        { id: 'toilet-1', catalogId: 'toilet', roomId: 'bath', position: { x: 234, y: 30 }, rotation: 90, footprint: { w: 18, d: 28 }, clearanceFront: 21 },
        { id: 'sink-1', catalogId: 'sink', roomId: 'bath', position: { x: 234, y: 84 }, rotation: 90, footprint: { w: 24, d: 20 } },
      ],
    },
  },
  {
    id: 'one-bed',
    name: 'One Bedroom',
    description: 'Living room, kitchen, bedroom and bath. 560 sq ft.',
    spec: {
      rooms: [
        { id: 'living', name: 'Living Room', type: 'living', x: 0, y: 0, w: 216, d: 144 },
        { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 216, y: 0, w: 120, d: 144 },
        { id: 'bed1', name: 'Bedroom', type: 'bedroom', x: 0, y: 144, w: 192, d: 96 },
        { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 192, y: 144, w: 144, d: 96, wetWalls: ['W'] },
      ],
      openings: [
        { id: 'entry', kind: 'door', at: { x: 0, y: 72 }, width: 36, swing: 'in-left' },
        { id: 'living-kitchen', kind: 'archway', at: { x: 216, y: 72 }, width: 60, height: 84, swing: 'none' },
        { id: 'living-bed1', kind: 'door', at: { x: 60, y: 144 }, width: 32, swing: 'in-right' },
        { id: 'kitchen-bath', kind: 'door', at: { x: 264, y: 144 }, width: 32, swing: 'in-left' },
        { id: 'bed1-window', kind: 'window', at: { x: 0, y: 192 }, width: 36 },
        { id: 'living-window', kind: 'window', at: { x: 108, y: 0 }, width: 48 },
      ],
      furniture: [
        { id: 'sofa-1', catalogId: 'sofa', roomId: 'living', position: { x: 108, y: 96 }, rotation: 180, footprint: { w: 84, d: 36 }, clearanceFront: 24 },
        { id: 'range-1', catalogId: 'range', roomId: 'kitchen', position: { x: 246, y: 21 }, rotation: 0, footprint: { w: 30, d: 30 }, clearanceFront: 40 },
        { id: 'counter-1', catalogId: 'counter', roomId: 'kitchen', position: { x: 291, y: 18 }, rotation: 0, footprint: { w: 60, d: 24 } },
        { id: 'bed-1', catalogId: 'queen-bed', roomId: 'bed1', position: { x: 126, y: 192 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
        { id: 'toilet-1', catalogId: 'toilet', roomId: 'bath', position: { x: 210, y: 165 }, rotation: 90, footprint: { w: 18, d: 28 }, clearanceFront: 21 },
        { id: 'sink-1', catalogId: 'sink', roomId: 'bath', position: { x: 210, y: 219 }, rotation: 90, footprint: { w: 24, d: 20 } },
      ],
    },
  },
  {
    id: 'two-bed',
    name: 'Two Bedroom',
    description: 'Two bedrooms off a hallway, one door already too narrow. 800 sq ft.',
    spec: {
      rooms: [
        { id: 'living', name: 'Living Room', type: 'living', x: 0, y: 0, w: 216, d: 180 },
        { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 216, y: 0, w: 168, d: 144, wetWalls: ['E'] },
        { id: 'hall', name: 'Hallway', type: 'hallway', x: 216, y: 144, w: 42, d: 156 },
        { id: 'bed1', name: 'Bedroom 1', type: 'bedroom', x: 0, y: 180, w: 132, d: 120 },
        { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 132, y: 180, w: 84, d: 120, wetWalls: ['E'] },
        { id: 'bed2', name: 'Bedroom 2', type: 'bedroom', x: 258, y: 144, w: 126, d: 156 },
      ],
      openings: [
        { id: 'entry', kind: 'door', at: { x: 0, y: 108 }, width: 36, swing: 'in-left' },
        { id: 'living-kitchen', kind: 'archway', at: { x: 216, y: 78 }, width: 60, height: 84, swing: 'none' },
        { id: 'living-bed1', kind: 'door', at: { x: 64, y: 180 }, width: 32, swing: 'in-right' },
        // On the hallway's side wall, not across its end: a door spanning the
        // end wall leaves the hallway unable to narrow at all without the door
        // running off the wall it sits in.
        { id: 'living-hall', kind: 'door', at: { x: 216, y: 162 }, width: 32, swing: 'in-left' },
        { id: 'hall-bath', kind: 'door', at: { x: 216, y: 237 }, width: 30, swing: 'in-left' },
        { id: 'hall-bed2', kind: 'door', at: { x: 258, y: 236 }, width: 32, swing: 'in-right' },
        { id: 'bed1-window', kind: 'window', at: { x: 0, y: 246 }, width: 36 },
        { id: 'bed2-window', kind: 'window', at: { x: 384, y: 216 }, width: 36 },
      ],
      furniture: [
        { id: 'sofa-1', catalogId: 'sofa', roomId: 'living', position: { x: 72, y: 72 }, rotation: 0, footprint: { w: 84, d: 36 }, clearanceFront: 24 },
        { id: 'island-1', catalogId: 'kitchen-island', roomId: 'kitchen', position: { x: 264, y: 78 }, rotation: 0, footprint: { w: 72, d: 36 }, clearanceFront: 42 },
        { id: 'range-1', catalogId: 'range', roomId: 'kitchen', position: { x: 360, y: 54 }, rotation: 90, footprint: { w: 30, d: 30 }, clearanceFront: 40 },
        { id: 'toilet-1', catalogId: 'toilet', roomId: 'bath', position: { x: 192, y: 198 }, rotation: 90, footprint: { w: 18, d: 28 }, clearanceFront: 21 },
        { id: 'sink-1', catalogId: 'sink', roomId: 'bath', position: { x: 192, y: 274 }, rotation: 90, footprint: { w: 24, d: 20 } },
        { id: 'bed-1', catalogId: 'queen-bed', roomId: 'bed1', position: { x: 60, y: 252 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
        { id: 'bed-2', catalogId: 'queen-bed', roomId: 'bed2', position: { x: 324, y: 220 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
      ],
    },
  },
];

export const DEFAULT_TEMPLATE_ID = 'two-bed';

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** A fresh plan every call, so one design never mutates a template. */
export function buildTemplate(id: string): Floorplan {
  const template = templateById(id);
  if (!template) {
    throw new Error(`No template "${id}".`);
  }
  // Deep-copy the furniture: buildPlan passes the array through by reference.
  return buildPlan({ ...template.spec, furniture: template.spec.furniture.map((item) => ({ ...item, position: { ...item.position }, footprint: { ...item.footprint } })) });
}
