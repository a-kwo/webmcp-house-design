import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  convexPolygonsOverlap,
  doorSwingPolygon,
  facingVector,
  furniturePolygon,
  polygonGap,
  rotatePoint,
  snapToGrid,
} from './geometry';
import type { Furniture, Opening, Wall } from './types';

function furniture(overrides: Partial<Furniture> = {}): Furniture {
  return {
    id: 'item',
    catalogId: 'desk',
    roomId: 'room',
    position: { x: 0, y: 0 },
    rotation: 0,
    footprint: { w: 20, d: 10 },
    ...overrides,
  };
}

const wall: Wall = {
  id: 'w',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  thickness: 5,
  exterior: false,
  loadBearing: false,
  wet: false,
};

function door(overrides: Partial<Opening> = {}): Opening {
  return {
    id: 'd',
    wallId: 'w',
    kind: 'door',
    offset: 10,
    width: 30,
    height: 80,
    sillHeight: 0,
    swing: 'in-left',
    connects: ['a', 'b'],
    ...overrides,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

describe('snapToGrid', () => {
  it('snaps to the nearest 6in increment by default', () => {
    expect(snapToGrid(14)).toBe(12);
    expect(snapToGrid(15)).toBe(18);
  });
});

describe('rotation', () => {
  it('faces +Y at 0deg and -X at 90deg', () => {
    expect(facingVector(0)).toEqual({ x: 0, y: 1 });

    const ninety = facingVector(90);
    expect(round(ninety.x)).toBe(-1);
    expect(round(ninety.y)).toBe(0);
  });

  it('rotates a point about the origin', () => {
    const rotated = rotatePoint({ x: 1, y: 0 }, 90);
    expect(round(rotated.x)).toBe(0);
    expect(round(rotated.y)).toBe(1);
  });

  it('swaps footprint extents when a piece is turned 90deg', () => {
    const upright = boundingBox(furniturePolygon(furniture()));
    expect(upright.maxX - upright.minX).toBe(20);
    expect(upright.maxY - upright.minY).toBe(10);

    const turned = boundingBox(furniturePolygon(furniture({ rotation: 90 })));
    expect(round(turned.maxX - turned.minX)).toBe(10);
    expect(round(turned.maxY - turned.minY)).toBe(20);
  });

  it('extends approach clearance along the facing direction, not always +Y', () => {
    const forward = boundingBox(furniturePolygon(furniture({ clearanceFront: 15 }), true));
    expect(forward.maxY).toBe(20);
    expect(forward.minY).toBe(-5);

    const flipped = boundingBox(furniturePolygon(furniture({ rotation: 180, clearanceFront: 15 }), true));
    expect(round(flipped.minY)).toBe(-20);
    expect(round(flipped.maxY)).toBe(5);
  });
});

describe('doorSwingPolygon', () => {
  it('returns null for sliding and fixed openings', () => {
    expect(doorSwingPolygon(wall, door({ swing: 'sliding' }))).toBeNull();
    expect(doorSwingPolygon(wall, door({ swing: 'none' }))).toBeNull();
    expect(doorSwingPolygon(wall, door({ kind: 'window', swing: undefined }))).toBeNull();
  });

  it('sweeps a quarter disc from the near jamb for a *-left swing', () => {
    const polygon = doorSwingPolygon(wall, door({ swing: 'in-left' }))!;
    const box = boundingBox(polygon);

    // Hinge at x=10, leaf reaching x=40 when closed and y=-30 when fully open.
    expect(polygon[0]).toEqual({ x: 10, y: 0 });
    expect(round(box.minX)).toBe(10);
    expect(round(box.maxX)).toBe(40);
    expect(round(box.minY)).toBe(-30);
    expect(round(box.maxY)).toBe(0);
  });

  it('hinges on the far jamb for a *-right swing', () => {
    const polygon = doorSwingPolygon(wall, door({ swing: 'in-right' }))!;
    expect(polygon[0]).toEqual({ x: 40, y: 0 });
    expect(round(boundingBox(polygon).minX)).toBe(10);
  });

  it('puts an out-* swing on the opposite side of the wall from in-*', () => {
    const inward = boundingBox(doorSwingPolygon(wall, door({ swing: 'in-left' }))!);
    const outward = boundingBox(doorSwingPolygon(wall, door({ swing: 'out-left' }))!);

    expect(round(inward.minY)).toBe(-30);
    expect(round(outward.maxY)).toBe(30);
  });

  it('swings toward the room it serves when one is given', () => {
    // The wall runs along y=0; a room centred below it pulls the swing to +Y,
    // the opposite side from the bare wall-direction fallback.
    const inward = boundingBox(doorSwingPolygon(wall, door({ swing: 'in-left' }), { x: 50, y: 40 })!);
    expect(round(inward.maxY)).toBe(30);
    expect(round(inward.minY)).toBe(0);

    const outward = boundingBox(doorSwingPolygon(wall, door({ swing: 'out-left' }), { x: 50, y: 40 })!);
    expect(round(outward.minY)).toBe(-30);
  });

  it('falls back to the wall direction when no room point is given', () => {
    const fallback = boundingBox(doorSwingPolygon(wall, door({ swing: 'in-left' }))!);
    expect(round(fallback.minY)).toBe(-30);
  });

  it('scales the arc radius with the door width', () => {
    const wide = boundingBox(doorSwingPolygon(wall, door({ width: 36 }))!);
    expect(round(wide.minY)).toBe(-36);
  });
});

describe('convexPolygonsOverlap', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('detects overlap and separation', () => {
    const overlapping = square.map((point) => ({ x: point.x + 5, y: point.y + 5 }));
    const separate = square.map((point) => ({ x: point.x + 20, y: point.y }));

    expect(convexPolygonsOverlap(square, overlapping)).toBe(true);
    expect(convexPolygonsOverlap(square, separate)).toBe(false);
  });

  it('treats touching edges as not overlapping', () => {
    const touching = square.map((point) => ({ x: point.x + 10, y: point.y }));
    expect(convexPolygonsOverlap(square, touching)).toBe(false);
  });

  it('separates rotated rectangles that their bounding boxes would not', () => {
    const diamond = furniturePolygon(furniture({ position: { x: 18, y: 18 }, rotation: 45, footprint: { w: 10, d: 10 } }));
    expect(convexPolygonsOverlap(square, diamond)).toBe(false);
  });
});

describe('polygonGap', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('measures the shortest distance between separated shapes', () => {
    const shifted = square.map((point) => ({ x: point.x + 25, y: point.y }));
    expect(polygonGap(square, shifted)).toBe(15);
  });

  it('reports zero when shapes overlap', () => {
    const overlapping = square.map((point) => ({ x: point.x + 5, y: point.y }));
    expect(polygonGap(square, overlapping)).toBe(0);
  });
});
