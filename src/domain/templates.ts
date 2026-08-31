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
 * Templates are deliberately unfurnished: furnishing the shell is the work
 * the human and the agent do together, so shipping it done would hand the
 * demo's second act to the template. The two-bedroom keeps one deliberate
 * violation (a 30in bathroom door) so there is something legible to fix.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'studio',
    name: 'Studio',
    description: 'One open room with a full bath and laundry. 450 sq ft.',
    spec: {
      rooms: [
        { id: 'main', name: 'Studio', type: 'living', x: 0, y: 0, w: 216, d: 216 },
        // A 7ft column: a real full bath up top, laundry and storage below.
        { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 216, y: 0, w: 84, d: 96, wetWalls: ['W'] },
        { id: 'closet', name: 'Laundry', type: 'utility', x: 216, y: 96, w: 84, d: 120, wetWalls: ['W'] },
      ],
      openings: [
        { id: 'entry', kind: 'door', at: { x: 0, y: 108 }, width: 36, swing: 'in-left' },
        { id: 'main-bath', kind: 'door', at: { x: 216, y: 48 }, width: 32, swing: 'out-right' },
        { id: 'main-closet', kind: 'door', at: { x: 216, y: 156 }, width: 32, swing: 'out-left' },
        { id: 'main-window', kind: 'window', at: { x: 108, y: 0 }, width: 48 },
        { id: 'main-window-2', kind: 'window', at: { x: 0, y: 180 }, width: 36 },
      ],
      furniture: [],
    },
  },
  {
    id: 'one-bed',
    name: 'One Bedroom',
    description: 'Living room, kitchen, bedroom, ensuite bath and laundry. 588 sq ft.',
    spec: {
      rooms: [
        { id: 'living', name: 'Living Room', type: 'living', x: 0, y: 0, w: 216, d: 144 },
        { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 216, y: 0, w: 120, d: 144 },
        // A 9ft-deep lower row: a queen bed wants 3ft of walkway, not 16in.
        { id: 'bed1', name: 'Bedroom', type: 'bedroom', x: 0, y: 144, w: 168, d: 108 },
        { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 168, y: 144, w: 84, d: 108, wetWalls: ['W'] },
        { id: 'laundry', name: 'Laundry', type: 'utility', x: 252, y: 144, w: 84, d: 108, wetWalls: ['W'] },
      ],
      openings: [
        { id: 'entry', kind: 'door', at: { x: 0, y: 72 }, width: 36, swing: 'in-left' },
        { id: 'living-kitchen', kind: 'archway', at: { x: 216, y: 72 }, width: 60, height: 84, swing: 'none' },
        { id: 'living-bed1', kind: 'door', at: { x: 60, y: 144 }, width: 32, swing: 'in-right' },
        // The bath is an ensuite off the bedroom; laundry hangs off the kitchen.
        { id: 'bed1-bath', kind: 'door', at: { x: 168, y: 198 }, width: 32, swing: 'in-left' },
        { id: 'kitchen-laundry', kind: 'door', at: { x: 294, y: 144 }, width: 32, swing: 'in-left' },
        { id: 'bed1-window', kind: 'window', at: { x: 0, y: 198 }, width: 36 },
        { id: 'living-window', kind: 'window', at: { x: 108, y: 0 }, width: 48 },
      ],
      furniture: [],
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
      furniture: [],
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
