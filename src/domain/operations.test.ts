import { describe, expect, it } from 'vitest';
import { computeRoomSummaries, roomDimensions } from './geometry';
import { addOpening, addRoom, moveWall, placeFurniture, removeElement, resizeRoom } from './operations';
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
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'bed1-N', kind: 'door', offsetIn: 12, widthIn: 36 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.connects).toEqual(['bed1', 'living']);
    expect(opening.width).toBe(36);
    expect(opening.height).toBe(80);
  });

  it('names the room across a partition rather than the exterior', () => {
    // bed1-E and bath-W are one physical wall drawn twice, once per room, so
    // the far room is only reachable through the coincident copy.
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'bed1-E', kind: 'door', offsetIn: 12, widthIn: 32 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.connects).toEqual(['bed1', 'bath']);
  });

  it('picks the room facing the opening when a wall runs past several', () => {
    // living-E spans y 0-180: the kitchen sits against its northern half and
    // the hallway against its southern, so the offset decides the answer.
    const north = expectOk(addOpening(sampleFloorplan, { wallId: 'living-E', kind: 'door', offsetIn: 12, widthIn: 36 }));
    const south = expectOk(addOpening(sampleFloorplan, { wallId: 'living-E', kind: 'door', offsetIn: 144, widthIn: 30 }));

    const northDoor = north.plan.openings.find((candidate) => candidate.id === north.changed[0])!;
    const southDoor = south.plan.openings.find((candidate) => candidate.id === south.changed[0])!;

    expect(northDoor.connects).toEqual(['living', 'kitchen']);
    expect(southDoor.connects).toEqual(['living', 'hall']);
  });

  it('does not let an interior door satisfy bedroom egress', () => {
    const plan = JSON.parse(JSON.stringify(sampleFloorplan)) as Floorplan;
    plan.openings = plan.openings.filter((opening) => opening.id !== 'bed2-window');

    // bed2-W is interior; a door there reaches the hallway, not the outside.
    const result = expectOk(addOpening(plan, { wallId: 'bed2-W', kind: 'door', offsetIn: 12, widthIn: 32 }));

    const door = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(door.connects).toEqual(['bed2', 'hall']);
    expect(validate(result.plan).some((violation) => violation.code === 'BEDROOM_EGRESS')).toBe(true);
  });

  it('marks an opening on an exterior wall as reaching the outside', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'bed2-E', kind: 'window', offsetIn: 12, widthIn: 36 }));
    const opening = result.plan.openings.find((candidate) => candidate.id === result.changed[0])!;

    expect(opening.connects).toEqual(['bed2', 'EXTERIOR']);
    expect(opening.sillHeight).toBe(30);
  });

  it('rejects an opening that runs off the end of the wall', () => {
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'bed1-N', kind: 'door', offsetIn: 120, widthIn: 36 }));
    expect(error).toContain('does not fit');
    expect(error).toMatch(/offset between 0 and \d+in/);
  });

  it('resolves an egress violation once a window is added', () => {
    const plan = JSON.parse(JSON.stringify(sampleFloorplan)) as Floorplan;
    plan.openings = plan.openings.filter((opening) => opening.id !== 'bed2-window');
    expect(validate(plan).some((violation) => violation.code === 'BEDROOM_EGRESS')).toBe(true);

    const result = expectOk(addOpening(plan, { wallId: 'bed2-E', kind: 'window', offsetIn: 12, widthIn: 36 }));
    expect(validate(result.plan).some((violation) => violation.code === 'BEDROOM_EGRESS')).toBe(false);
  });

  it('refuses an opening that lands on one already there', () => {
    // living-bed1 runs 48-80in along bed1-N.
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'bed1-N', kind: 'door', offsetIn: 60, widthIn: 32 }));

    expect(error).toContain('would overlap living-bed1');
    expect(error).toMatch(/48in to 80in/);
  });

  it('sees an opening through the neighbour copy of the same partition', () => {
    // hall-bed2 is recorded against bed2-W; hall-E is the hallway's copy of that
    // wall, so the doorway is physically in the way from that side too.
    const error = expectFail(addOpening(sampleFloorplan, { wallId: 'hall-E', kind: 'door', offsetIn: 84, widthIn: 30 }));

    expect(error).toContain('would overlap hall-bed2');
  });

  it('allows an opening that only touches the edge of another', () => {
    const result = expectOk(addOpening(sampleFloorplan, { wallId: 'bed1-N', kind: 'door', offsetIn: 12, widthIn: 36 }));

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

    expect(error).toContain('runs outside Bedroom 1');
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

describe('removeElement', () => {
  it('removes a partition wall and cascades to its openings', () => {
    const result = expectOk(removeElement(sampleFloorplan, 'bath-E'));

    expect(result.plan.walls.some((wall) => wall.id === 'bath-E')).toBe(false);
    expect(result.plan.openings.some((opening) => opening.id === 'hall-bath')).toBe(false);
    expect(result.changed).toContain('hall-bath');
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

  it('gives a shorter attached room its own wall and says so', () => {
    const result = expectOk(addRoom(sampleFloorplan, {
      name: 'Office',
      type: 'utility',
      widthIn: 96,
      depthIn: 120,
      attachTo: { roomId: 'bed1', side: 'south' },
    }));

    const office = result.plan.rooms.find((room) => room.name === 'Office')!;
    const bed1 = result.plan.rooms.find((room) => room.id === 'bed1')!;

    expect(office.wallIds.filter((id) => bed1.wallIds.includes(id))).toEqual([]);
    expect(result.summary).toContain('different lengths');
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
