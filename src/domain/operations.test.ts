import { describe, expect, it } from 'vitest';
import { computeRoomSummaries, roomDimensions } from './geometry';
import { addOpening, addRoom, moveFurniture, moveWall, placeFurniture, removeElement, resizeFurniture, resizeRoom, updateOpening } from './operations';
import type { OperationResult } from './operations';
import { sampleFloorplan } from './sampleFloorplan';
import type { Floorplan } from './types';
import { validate } from './validate';

function expectOk(result: OperationResult): Extract<OperationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error}`);
  }
  return result;
}

function expectFail(result: OperationResult): string {
  if (result.ok) {
    throw new Error('expected failure, got success');
  }
  return result.error;
}

function areaOf(plan: Floorplan, roomId: string): number {
  return computeRoomSummaries(plan).find((room) => room.id === roomId)!.areaSqFt;
}

function widthOf(plan: Floorplan, roomId: string): number {
  const room = plan.rooms.find((candidate) => candidate.id === roomId)!;
  return roomDimensions(plan, room).width;
}

describe('moveWall', () => {
  it('grows one room and shrinks the room sharing the wall', () => {
    const before = areaOf(sampleFloorplan, 'living');
    const result = expectOk(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 12, direction: 'east' }));

    expect(areaOf(result.plan, 'living')).toBeGreaterThan(before);
    expect(areaOf(result.plan, 'kitchen')).toBeLessThan(areaOf(sampleFloorplan, 'kitchen'));
    expect(result.summary).toContain('Living Room');
  });

  it('leaves the original plan untouched', () => {
    const snapshot = JSON.stringify(sampleFloorplan);
    moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 12, direction: 'east' });

    expect(JSON.stringify(sampleFloorplan)).toBe(snapshot);
  });

  it('snaps the distance to the 6in grid', () => {
    const result = expectOk(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 14, direction: 'east' }));
    expect(widthOf(result.plan, 'living')).toBe(228);
    expect(result.summary).toContain('12in');
  });

  it('rejects a move along the wall instead of across it', () => {
    const error = expectFail(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 12, direction: 'north' }));
    expect(error).toContain('north-south');
    expect(error).toContain('east or west');
  });

  it('rejects an unknown wall with a recovery hint', () => {
    const error = expectFail(moveWall(sampleFloorplan, { wallId: 'nope', distanceIn: 12, direction: 'east' }));
    expect(error).toContain('get_layout');
  });

  it('rejects a distance that snaps away to nothing', () => {
    const error = expectFail(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 2, direction: 'east' }));
    expect(error).toContain('snaps to 0');
  });

  it('refuses to collapse a room but allows a move that merely breaks a rule', () => {
    // 48in east would leave the 42in hallway with a negative span.
    expect(expectFail(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 48, direction: 'east' }))).toContain('collapse');

    // 12in east leaves it viable but too narrow, which is the engine's call.
    const result = expectOk(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 12, direction: 'east' }));
    expect(result.ok).toBe(true);
  });

  it('refuses to drag a line past a wall that was cut to meet it', () => {
    // A room attached south of the hallway runs to x = 372, cutting bed2's
    // south wall there. Pulling bed2's east edge in to x = 354 would drag the
    // 372-384 offcut back through its own start.
    const withRoom = expectOk(addRoom(sampleFloorplan, {
      name: 'Utility', type: 'utility', widthIn: 156, depthIn: 72,
      attachTo: { roomId: 'hall', side: 'south' },
    }));

    const error = expectFail(resizeRoom(withRoom.plan, { roomId: 'bed2', widthIn: 96 }));

    expect(error).toContain('folding that wall back on itself');
  });

  it('refuses a move that would leave a door hanging off a shortened wall', () => {
    // Pulling y = 180 north 36in shortens living-E-2, the living/hallway
    // wall, from 60in to 24in -- but the living-hall door runs to 46in of it.
    const error = expectFail(moveWall(sampleFloorplan, { wallId: 'living-S', distanceIn: 36, direction: 'north' }));

    expect(error).toContain('living-hall');
    expect(error).toContain('hanging off the end');
  });

  it('supports the demo interaction: widen a room and hear what it cost', () => {
    const result = expectOk(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 12, direction: 'east' }));
    const violations = validate(result.plan, sampleFloorplan);
    const hallway = violations.find((violation) => violation.code === 'HALL_MIN_WIDTH');

    expect(areaOf(result.plan, 'living')).toBeCloseTo(285, 0);
    expect(hallway?.message).toContain('30in clear');
  });
});

describe('resizeRoom', () => {
  it('sets an explicit width', () => {
    const result = expectOk(resizeRoom(sampleFloorplan, { roomId: 'bed1', widthIn: 96 }));
    expect(widthOf(result.plan, 'bed1')).toBe(96);
    expect(result.summary).toContain('width to 96in');
  });

  it('sets width and depth together', () => {
    const result = expectOk(resizeRoom(sampleFloorplan, { roomId: 'bed1', widthIn: 120, depthIn: 108 }));
    const room = result.plan.rooms.find((candidate) => candidate.id === 'bed1')!;

    expect(roomDimensions(result.plan, room).width).toBe(120);
    expect(roomDimensions(result.plan, room).depth).toBe(108);
  });

  it('requires at least one dimension', () => {
    expect(expectFail(resizeRoom(sampleFloorplan, { roomId: 'bed1' }))).toContain('widthIn or a depthIn');
  });

  it('reports when the room is already that size', () => {
    expect(expectFail(resizeRoom(sampleFloorplan, { roomId: 'bed1', widthIn: 132 }))).toContain('already at the requested size');
  });
});

describe('addOpening', () => {
  it('adds a door and infers the rooms it connects', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 12, widthIn: 36 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.connects).toEqual(['living', 'bed1']);
    expect(opening.width).toBe(36);
    expect(opening.height).toBe(80);
  });

  it('names both rooms a partition separates, never the exterior', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'bed1-E', kind: 'door', offsetIn: 12, widthIn: 32 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.connects).toEqual(['bed1', 'bath']);
  });

  it('has no wall that runs past a room it does not border', () => {
    // Edges are cut where rooms meet, so which rooms a wall separates never
    // depends on where along it you look. x = 216 is three separate walls.
    for (const wall of sampleFloorplan.walls) {
      const touching = sampleFloorplan.rooms.filter((room) => room.wallIds.includes(wall.id));
      expect(touching.length).toBeLessThanOrEqual(2);
      expect(touching.length).toBeGreaterThan(0);
      if (!wall.exterior) {
        expect(touching).toHaveLength(2);
      }
    }
  });

  it('does not let an interior door satisfy bedroom egress', () => {
    const plan = JSON.parse(JSON.stringify(sampleFloorplan)) as Floorplan;
    plan.openings = plan.openings.filter((opening) => opening.id !== 'bed2-window');

    // hall-E is the hall/bed2 partition; a door there reaches the hallway.
    const result = expectOk(addOpening(plan, { wallId: 'hall-E', kind: 'door', offsetIn: 12, widthIn: 32 }));

    const door = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(door.connects).toEqual(['hall', 'bed2']);
    expect(validate(result.plan).some((violation) => violation.code === 'BEDROOM_EGRESS')).toBe(true);
  });

  it('rounds an opening width up, never down past the rule it has to clear', () => {
    // 32in is the door minimum. Snapping to the nearest 6in step would land on
    // 30in and leave the very violation the caller was trying to fix.
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'hall-E', kind: 'door', offsetIn: 12, widthIn: 32 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.width).toBe(36);
    expect(result.summary).toContain('rounded up');
  });

  it('says nothing about rounding when the width was already on the grid', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'hall-E', kind: 'door', offsetIn: 12, widthIn: 36 }));

    expect(result.summary).not.toContain('rounded up');
  });

  it('lets the door-width violation be fixed by following its own advice', () => {
    const before = validate(sampleFloorplan).find((v) => v.code === 'DOOR_MIN_WIDTH')!;
    const target = Number(before.suggestion!.match(/to (\d+)in/)![1]);

    const stripped = expectOk(removeElement(sampleFloorplan, 'hall-bath'));
    const widened = expectOk(addOpening(stripped.plan, { wallId: 'hall-W', kind: 'door', offsetIn: 42, widthIn: target }));

    expect(validate(widened.plan).some((v) => v.code === 'DOOR_MIN_WIDTH')).toBe(false);
  });

  it('marks an opening on an exterior wall as reaching the outside', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'bed2-E', kind: 'window', offsetIn: 12, widthIn: 36 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.connects).toEqual(['bed2', 'EXTERIOR']);
    expect(opening.sillHeight).toBe(30);
  });

  it('rejects an opening that runs off the end of the wall', () => {
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 120, widthIn: 36 }));
    expect(error).toContain('does not fit');
    expect(error).toMatch(/offset between 4 and \d+in/);
  });

  it('resolves an egress violation once a window is added', () => {
    const plan = JSON.parse(JSON.stringify(sampleFloorplan)) as Floorplan;
    plan.openings = plan.openings.filter((opening) => opening.id !== 'bed2-window');
    expect(validate(plan).some((violation) => violation.code === 'BEDROOM_EGRESS')).toBe(true);

    const result = expectOk(addOpening(plan, { wallId: 'bed2-E', kind: 'window', offsetIn: 12, widthIn: 36 }));
    expect(validate(result.plan).some((violation) => violation.code === 'BEDROOM_EGRESS')).toBe(false);
  });

  it('refuses an opening that lands on one already there', () => {
    // living-bed1 runs 48-80in along living-S.
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 60, widthIn: 32 }));

    expect(error).toContain('would overlap living-bed1');
    expect(error).toMatch(/48in to 80in/);
  });

  it('reports the overlap in the offsets of the wall being cut', () => {
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'hall-E', kind: 'door', offsetIn: 96, widthIn: 30 }));

    expect(error).toContain('would overlap hall-bed2');
    expect(error).toMatch(/100in to 132in/);
  });

  it('keeps an opening frame margin at the wall ends', () => {
    // living-S over bed1 runs 132in; a 36in door at offset 2 leaves no wall
    // beside the frame, at offset 4 it just fits.
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 2, widthIn: 36 }));
    expect(error).toContain('frame');

    expectOk(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 4, widthIn: 36 }));
  });

  it('allows an opening that only touches the edge of another', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 12, widthIn: 36 }));

    expect(result.plan.openings).toHaveLength(sampleFloorplan.openings.length + 1);
  });
});

describe('placeFurniture', () => {
  it('auto-places against a wall when no position is given', () => {
    const result = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed2',
      catalogId: 'dresser',
      footprint: { w: 36, d: 20 },
    }));

    const item = result.plan.furniture.find((candidate) => candidate.id === result.changed[0])!;
    expect(item.roomId).toBe('bed2');
    expect(result.summary).toContain('against a wall');
  });

  it('honours an explicit position, snapped to the grid', () => {
    const result = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed2',
      catalogId: 'dresser',
      footprint: { w: 36, d: 20 },
      position: { x: 301, y: 161 },
    }));

    const item = result.plan.furniture.find((candidate) => candidate.id === result.changed[0])!;
    expect(item.position).toEqual({ x: 300, y: 162 });
  });

  it('rejects a position outside the room and says where the room is', () => {
    const error = expectFail(placeFurniture(sampleFloorplan, {
      roomId: 'bed2',
      catalogId: 'dresser',
      footprint: { w: 36, d: 20 },
      position: { x: 12, y: 12 },
    }));

    expect(error).toContain('outside Bedroom 2');
    expect(error).toContain('Omit position');
  });

  it('refuses a piece whose footprint hangs out of the room', () => {
    // The centre is inside Bedroom 1, but an 80in-deep bed centred 6in from the
    // north wall puts most of itself in the living room.
    const error = expectFail(placeFurniture(sampleFloorplan, {
      roomId: 'bed1',
      catalogId: 'queen-bed',
      footprint: { w: 60, d: 80 },
      position: { x: 60, y: 186 },
    }));

    expect(error).toContain('runs into the walls of Bedroom 1');
    expect(error).toMatch(/spans x \d+-\d+ and y \d+-\d+/);
  });

  it('measures the footprint after rotation, not before', () => {
    // 100x24 lies along the room's 132in width, but turned 90deg it needs 100in
    // of the 120in depth and no longer fits where it sits.
    const flat = placeFurniture(sampleFloorplan, {
      roomId: 'bed1', catalogId: 'bench', footprint: { w: 100, d: 24 },
      position: { x: 66, y: 210 }, rotation: 0,
    });
    const turned = placeFurniture(sampleFloorplan, {
      roomId: 'bed1', catalogId: 'bench', footprint: { w: 100, d: 24 },
      position: { x: 66, y: 210 }, rotation: 90,
    });

    expect(flat.ok).toBe(true);
    expect(turned.ok).toBe(false);
  });
});

describe('updateOpening', () => {
  it('widens the demo door in place, keeping its id', () => {
    // hall-bath is the sample's deliberate violation: 30in where 32 is the
    // minimum. Asking for 32 rounds up to 36, centred where the door was.
    const result = expectOk(updateOpening(sampleFloorplan, { openingId: 'hall-bath', widthIn: 32 }));
    const door = result.plan.openings.find((candidate) => candidate.id === 'hall-bath')!;

    expect(door.width).toBe(36);
    expect(result.summary).toContain('rounded up');
    expect(validate(result.plan).some((violation) => violation.code === 'DOOR_MIN_WIDTH')).toBe(false);
  });

  it('turns a door into an archway, dropping its swing', () => {
    const result = expectOk(updateOpening(sampleFloorplan, { openingId: 'hall-bath', kind: 'archway' }));
    const arch = result.plan.openings.find((candidate) => candidate.id === 'hall-bath')!;

    expect(arch.kind).toBe('archway');
    expect(arch.swing).toBe('none');
  });

  it('flips a hinge in one call', () => {
    const result = expectOk(updateOpening(sampleFloorplan, { openingId: 'hall-bed2', swing: 'in-left' }));
    expect(result.plan.openings.find((candidate) => candidate.id === 'hall-bed2')!.swing).toBe('in-left');
  });

  it('refuses to widen into a neighbouring opening', () => {
    // living-bed1 (x48-80) and a widened neighbour would collide if grown far
    // enough; manufacture one next to it.
    const withDoor = expectOk(addOpening(sampleFloorplan, { wallId: 'living-S', kind: 'door', offsetIn: 90, widthIn: 32 }));
    const error = expectFail(updateOpening(withDoor.plan, { openingId: 'living-bed1', widthIn: 60 }));

    expect(error).toContain('would overlap');
  });

  it('refuses swings on things that do not swing', () => {
    const error = expectFail(updateOpening(sampleFloorplan, { openingId: 'bed1-window', swing: 'in-left' }));
    expect(error).toContain('Only doors swing');
  });

  it('rejects an unknown id with a recovery hint', () => {
    expect(expectFail(updateOpening(sampleFloorplan, { openingId: 'ghost', widthIn: 36 }))).toContain('get_layout');
  });
});

describe('moveFurniture', () => {
  it('moves a piece within its room, snapped to the grid', () => {
    const result = expectOk(moveFurniture(sampleFloorplan, { furnitureId: 'sofa-1', position: { x: 101, y: 98 } }));
    const sofa = result.plan.furniture.find((item) => item.id === 'sofa-1')!;

    expect(sofa.position).toEqual({ x: 102, y: 96 });
    expect(sofa.roomId).toBe('living');
    expect(result.summary).toContain('within Living Room');
    // The landed position rides in the summary: the snap can shift a request,
    // and the caller must see where the piece really is.
    expect(result.summary).toContain('(102, 96)');
  });

  it('re-homes a piece dropped in a different room', () => {
    // The dresser-sized dresser fits anywhere; carry the sofa to Bedroom 2.
    const result = expectOk(moveFurniture(sampleFloorplan, { furnitureId: 'sofa-1', position: { x: 320, y: 180 } }));
    const sofa = result.plan.furniture.find((item) => item.id === 'sofa-1')!;

    expect(sofa.roomId).toBe('bed2');
    expect(result.changed).toContain('living');
    expect(result.changed).toContain('bed2');
    expect(result.summary).toContain('into Bedroom 2');
  });

  it('turns a piece in place', () => {
    const result = expectOk(moveFurniture(sampleFloorplan, { furnitureId: 'bed-2', rotation: 90 }));
    const bed = result.plan.furniture.find((item) => item.id === 'bed-2')!;

    expect(bed.rotation).toBe(90);
    expect(bed.position).toEqual(sampleFloorplan.furniture.find((item) => item.id === 'bed-2')!.position);
  });

  it('keeps furniture off the wall faces, not just off the centrelines', () => {
    // Room polygons run along wall centrelines; a 60in bed centred at x = 30
    // spans exactly to the polygon edge and used to sit 3in deep in the wall.
    const error = expectFail(placeFurniture(sampleFloorplan, {
      roomId: 'bed1', catalogId: 'queen-bed', footprint: { w: 60, d: 80 }, position: { x: 30, y: 240 },
    }));
    expect(error).toContain('runs into the walls');

    // Nudged one grid step in, it clears the face and lands.
    expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed1', catalogId: 'queen-bed', footprint: { w: 60, d: 80 }, position: { x: 36, y: 240 },
    }));
  });

  it('refuses a landing spot whose footprint runs out of the room', () => {
    // Centre inside the bathroom, but the 80in-deep bed pokes past its north wall.
    const error = expectFail(moveFurniture(sampleFloorplan, { furnitureId: 'bed-1', position: { x: 174, y: 210 } }));

    expect(error).toContain('runs into the walls of Bathroom');
  });

  it('refuses a position outside every room', () => {
    const error = expectFail(moveFurniture(sampleFloorplan, { furnitureId: 'sofa-1', position: { x: -60, y: -60 } }));
    expect(error).toContain('outside every room');
  });

  it('requires something to change', () => {
    const error = expectFail(moveFurniture(sampleFloorplan, { furnitureId: 'sofa-1' }));
    expect(error).toContain('needs a position or a rotation');
  });

  it('rejects an unknown id with a recovery hint', () => {
    const error = expectFail(moveFurniture(sampleFloorplan, { furnitureId: 'ghost', position: { x: 60, y: 60 } }));
    expect(error).toContain('get_layout');
  });
});

describe('removeElement', () => {
  it('refuses to remove a partition and names both rooms it would open up', () => {
    const error = expectFail(removeElement(sampleFloorplan, 'hall-W'));

    expect(error).toContain('separates Hallway and Bathroom');
    expect(error).toContain('add_opening');
  });

  it('refuses to remove a structural wall and names the alternative', () => {
    const error = expectFail(removeElement(sampleFloorplan, 'living-W'));
    expect(error).toContain('exterior');
    expect(error).toContain('add_opening');
  });

  it('removes furniture', () => {
    const result = expectOk(removeElement(sampleFloorplan, 'sofa-1'));
    expect(result.plan.furniture.some((item) => item.id === 'sofa-1')).toBe(false);
  });

  it('removes a room with its walls, openings, and furniture', () => {
    const result = expectOk(removeElement(sampleFloorplan, 'bed2'));

    expect(result.plan.rooms.some((room) => room.id === 'bed2')).toBe(false);
    expect(result.plan.furniture.some((item) => item.roomId === 'bed2')).toBe(false);
    expect(result.plan.openings.some((opening) => opening.connects.includes('bed2'))).toBe(false);
  });

  it('rejects an unknown id with a recovery hint', () => {
    expect(expectFail(removeElement(sampleFloorplan, 'ghost'))).toContain('get_layout');
  });
});

describe('addRoom', () => {
  it('shares the partition wall when the two rooms line up exactly', () => {
    // Bedroom 1 is 132in wide, so a 132in room below it shares one wall.
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Office',
      type: 'utility',
      widthIn: 132,
      depthIn: 120,
      attachTo: { roomId: 'bed1', side: 'south' },
    }));

    const office = result.plan.rooms.find((room) => room.name === 'Office')!;
    const bed1 = result.plan.rooms.find((room) => room.id === 'bed1')!;
    const shared = office.wallIds.filter((id) => bed1.wallIds.includes(id));

    expect(shared).toEqual(['bed1-S']);
    expect(result.summary).toContain('sharing wall bed1-S');
    expect(result.plan.walls).toHaveLength(sampleFloorplan.walls.length + 3);
  });

  it('splits the wall a shorter attached room only partly meets', () => {
    // Office is 96in wide against Bedroom 1's 132in south wall, so that wall is
    // cut in two and the rooms share exactly the 96in they have in common
    // rather than each drawing its own copy of the overlap.
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Office',
      type: 'utility',
      widthIn: 96,
      depthIn: 120,
      attachTo: { roomId: 'bed1', side: 'south' },
    }));

    const office = result.plan.rooms.find((room) => room.name === 'Office')!;
    const bed1 = result.plan.rooms.find((room) => room.id === 'bed1')!;
    const common = office.wallIds.filter((id) => bed1.wallIds.includes(id));

    expect(common).toHaveLength(1);
    expect(result.summary).toContain('sharing wall');

    const shared = result.plan.walls.find((wall) => wall.id === common[0])!;
    expect(Math.hypot(shared.end.x - shared.start.x, shared.end.y - shared.start.y)).toBeCloseTo(96);

    // Bedroom 1 keeps its full 132in width: the leftover 36in is still its wall.
    expect(roomDimensions(result.plan, bed1).width).toBeCloseTo(132);
  });

  it('leaves every partition referenced by exactly the rooms it separates', () => {
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Office', type: 'utility', widthIn: 96, depthIn: 120,
      attachTo: { roomId: 'bed1', side: 'south' },
    }));

    for (const wall of result.plan.walls) {
      const touching = result.plan.rooms.filter((room) => room.wallIds.includes(wall.id));
      expect(touching.length).toBeGreaterThan(0);
      expect(touching.length).toBeLessThanOrEqual(2);
    }
  });

  it('computes a correct area for a room built on a shared wall', () => {
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Office',
      type: 'utility',
      widthIn: 132,
      depthIn: 120,
      attachTo: { roomId: 'bed1', side: 'south' },
    }));

    // The shared wall runs the opposite way for the new room, which naive
    // polygon building would fold into a zero-area shape.
    expect(areaOf(result.plan, 'office')).toBeCloseTo(110, 0);
  });

  it('adds a standalone room when nothing is attached', () => {
    const result = expectOk(addRoom(sampleFloorplan, { name: 'Shed', type: 'utility', widthIn: 96, depthIn: 96 }));
    expect(areaOf(result.plan, 'shed')).toBeCloseTo(64, 0);
  });

  it('refuses to drop a room on top of the ones already there', () => {
    // South of the kitchen is the hallway and Bedroom 2, not free space.
    const error = expectFail(addRoom(sampleFloorplan, {
      name: 'Pantry', type: 'utility', widthIn: 72, depthIn: 72,
      attachTo: { roomId: 'kitchen', side: 'south' },
    }));

    expect(error).toContain('would overlap');
    expect(error).toContain('Hallway');
  });

  it('still attaches where the space really is free', () => {
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Porch', type: 'utility', widthIn: 216, depthIn: 72,
      attachTo: { roomId: 'living', side: 'north' },
    }));

    expect(result.plan.rooms).toHaveLength(sampleFloorplan.rooms.length + 1);
    expect(result.summary).toContain('sharing wall living-N');
  });

  it('stops calling a wall exterior once a room is built against it', () => {
    // living-N was the outside of the building. With a room on both sides it is
    // a partition, and a door through it no longer reaches the outside.
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Porch', type: 'utility', widthIn: 216, depthIn: 72,
      attachTo: { roomId: 'living', side: 'north' },
    }));

    const wall = result.plan.walls.find((candidate) => candidate.id === 'living-N')!;
    expect(wall.exterior).toBe(false);
    expect(wall.loadBearing).toBe(true);

    const opened = expectOk(addOpening(result.plan, { wallId: 'living-N', kind: 'door', offsetIn: 12, widthIn: 32 }));
    const door = opened.plan.openings.find((o) => o.id === opened.changed[0])!;
    expect(door.connects).not.toContain('EXTERIOR');
  });

  it('refuses to split a wall where the cut would land on an opening', () => {
    const error = expectFail(addRoom(sampleFloorplan, {
      name: 'Porch', type: 'utility', widthIn: 72, depthIn: 108,
      attachTo: { roomId: 'bed2', side: 'east' },
    }));

    expect(error).toContain('would cut through bed2-window');
  });

  it('rejects a room that is too small to use', () => {
    const error = expectFail(addRoom(sampleFloorplan, { name: 'Nook', type: 'closet', widthIn: 12, depthIn: 12 }));
    expect(error).toContain('at least 24in');
  });

  it('rejects an unknown anchor room', () => {
    const error = expectFail(addRoom(sampleFloorplan, {
      name: 'Office',
      type: 'utility',
      widthIn: 96,
      depthIn: 96,
      attachTo: { roomId: 'nowhere', side: 'north' },
    }));

    expect(error).toContain('get_layout');
  });
});

describe('resizeFurniture', () => {
  it('changes the footprint in place and echoes the standing position', () => {
    const result = expectOk(resizeFurniture(sampleFloorplan, { furnitureId: 'sofa-1', widthIn: 72, depthIn: 30 }));

    const sofa = result.plan.furniture.find((item) => item.id === 'sofa-1')!;
    expect(sofa.footprint).toEqual({ w: 72, d: 30 });
    expect(sofa.position).toEqual({ x: 72, y: 72 });
    expect(result.summary).toContain('72x30in');
  });

  it('keeps the unspecified dimension', () => {
    const result = expectOk(resizeFurniture(sampleFloorplan, { furnitureId: 'sofa-1', depthIn: 42 }));
    expect(result.plan.furniture.find((item) => item.id === 'sofa-1')!.footprint).toEqual({ w: 84, d: 42 });
  });

  it('refuses a size that would run into the walls', () => {
    // The sofa sits at x 72; growing it to 160in wide would cross the west wall face.
    const error = expectFail(resizeFurniture(sampleFloorplan, { furnitureId: 'sofa-1', widthIn: 160 }));
    expect(error).toContain('runs into the walls of Living Room');
  });

  it('needs at least one dimension and a real piece', () => {
    expect(expectFail(resizeFurniture(sampleFloorplan, { furnitureId: 'sofa-1' }))).toContain('widthIn or a depthIn');
    expect(expectFail(resizeFurniture(sampleFloorplan, { furnitureId: 'ghost', widthIn: 40 }))).toContain('No furniture');
  });
});

describe('placement facing', () => {
  it('faces a piece into the room from the wall it is placed against', () => {
    // Wardrobe backed to bed1's south wall: front should turn north.
    const south = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed2', catalogId: 'wardrobe', footprint: { w: 48, d: 24 }, position: { x: 324, y: 282 },
    }));
    expect(south.plan.furniture.slice(-1)[0]!.rotation).toBe(180);

    const west = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed2', catalogId: 'dresser', footprint: { w: 36, d: 20 }, position: { x: 274, y: 200 },
    }));
    expect(west.plan.furniture.slice(-1)[0]!.rotation).toBe(270);
  });

  it('keeps the plain south default in open floor', () => {
    const result = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'living', catalogId: 'table', footprint: { w: 48, d: 30 }, position: { x: 108, y: 90 },
    }));
    expect(result.plan.furniture.slice(-1)[0]!.rotation).toBe(0);
  });

  it('falls back to south when the turned footprint cannot fit', () => {
    // A queen bed beside the west wall: turned east it would be 80in wide and
    // poke through the wall, so it stays at 0 rather than failing.
    const result = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed1', catalogId: 'queen-bed', footprint: { w: 60, d: 80 }, position: { x: 36, y: 240 },
    }));
    expect(result.plan.furniture.slice(-1)[0]!.rotation).toBe(0);
  });

  it('an explicit rotation is always honoured', () => {
    const result = expectOk(placeFurniture(sampleFloorplan, {
      roomId: 'bed2', catalogId: 'wardrobe', footprint: { w: 48, d: 24 }, position: { x: 324, y: 282 }, rotation: 0,
    }));
    expect(result.plan.furniture.slice(-1)[0]!.rotation).toBe(0);
  });
});
