import { describe, expect, it } from 'vitest';
import { sampleFloorplan } from './sampleFloorplan';
import type { Floorplan, Violation } from './types';
import { validate } from './validate';

type Edge = 'N' | 'E' | 'S' | 'W';

function clonePlan(plan: Floorplan): Floorplan {
  return JSON.parse(JSON.stringify(plan)) as Floorplan;
}

/**
 * Sample rooms are rectangles whose four walls are named `<roomId>-<edge>`, so
 * moving one edge means updating the edge wall plus the two walls it meets.
 */
function setEdge(plan: Floorplan, roomId: string, edge: Edge, value: number): void {
  const wallFor = (side: Edge) => plan.walls.find((wall) => wall.id === `${roomId}-${side}`)!;

  if (edge === 'E') {
    wallFor('E').start.x = value;
    wallFor('E').end.x = value;
    wallFor('N').end.x = value;
    wallFor('S').start.x = value;
    return;
  }

  if (edge === 'W') {
    wallFor('W').start.x = value;
    wallFor('W').end.x = value;
    wallFor('N').start.x = value;
    wallFor('S').end.x = value;
    return;
  }

  if (edge === 'N') {
    wallFor('N').start.y = value;
    wallFor('N').end.y = value;
    wallFor('E').start.y = value;
    wallFor('W').end.y = value;
    return;
  }

  wallFor('S').start.y = value;
  wallFor('S').end.y = value;
  wallFor('E').end.y = value;
  wallFor('W').start.y = value;
}

function codes(plan: Floorplan, previous?: Floorplan): string[] {
  return validate(plan, previous).map((violation) => violation.code);
}

function find(plan: Floorplan, code: string, previous?: Floorplan): Violation | undefined {
  return validate(plan, previous).find((violation) => violation.code === code);
}

/** The sample kitchen with the island slid east to squeeze the work aisle. */
function tightKitchen(islandX: number): Floorplan {
  const plan = clonePlan(sampleFloorplan);
  plan.furniture.find((item) => item.id === 'island-1')!.position = { x: islandX, y: 78 };
  return plan;
}

function findAll(plan: Floorplan, code: string): Violation[] {
  return validate(plan).filter((violation) => violation.code === code);
}

describe('the sample floorplan baseline', () => {
  it('opens with exactly one deliberate problem for the demo to fix', () => {
    // The sample is demo data: it carries one legible violation on purpose and
    // nothing accidental. Rules are exercised by explicit fixtures below, not
    // by leaving the sample broken.
    const violations = validate(sampleFloorplan);
    expect(violations.map((violation) => violation.code)).toEqual(['DOOR_MIN_WIDTH']);
  });

  it('gives every violation a human message, a suggestion, and element ids to highlight', () => {
    for (const violation of validate(sampleFloorplan)) {
      expect(violation.message).not.toMatch(/^[A-Z_]+$/);
      expect(violation.message.length).toBeGreaterThan(20);
      expect(violation.suggestion).toBeTruthy();
      expect(violation.elementIds.length).toBeGreaterThan(0);
    }
  });

  it('does not flag the toilet against the sink, which only rotation makes clear', () => {
    // Both fixtures are rotated 90deg against the same wet wall. Treating them
    // as unrotated boxes used to overlap them and fire two false violations.
    const pair = validate(sampleFloorplan).filter((violation) => {
      return violation.elementIds.includes('toilet-1') && violation.elementIds.includes('sink-1');
    });

    expect(pair).toEqual([]);
  });
});

describe('bedroom rules', () => {
  it('flags a bedroom below the minimum area and names what the space costs', () => {
    const plan = clonePlan(sampleFloorplan);
    setEdge(plan, 'bed1', 'E', 72);

    const violation = find(plan, 'BEDROOM_MIN_AREA');
    expect(violation?.message).toContain('Bedroom 1');
    expect(violation?.message).toContain('60 sq ft');
    expect(violation?.elementIds).toContain('bed1');
    expect(violation?.suggestion).toContain('10 sq ft');
  });

  it('flags a bedroom that is wide enough by area but too narrow', () => {
    const plan = clonePlan(sampleFloorplan);
    setEdge(plan, 'bed1', 'S', 340);
    setEdge(plan, 'bed1', 'E', 78);

    const foundCodes = codes(plan);
    expect(foundCodes).toContain('BEDROOM_MIN_DIM');
    expect(foundCodes).not.toContain('BEDROOM_MIN_AREA');
    expect(find(plan, 'BEDROOM_MIN_DIM')?.message).toContain('78in');
  });

  it('flags a bedroom with no exterior opening and points at its exterior walls', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.openings = plan.openings.filter((opening) => opening.id !== 'bed2-window');

    const violation = find(plan, 'BEDROOM_EGRESS');
    expect(violation?.message).toContain('Bedroom 2');
    expect(violation?.suggestion).toContain('bed2-E');
  });

  it('says so plainly when a windowless bedroom has no exterior wall to use', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.openings = plan.openings.filter((opening) => opening.id !== 'bed1-window');
    for (const wall of plan.walls.filter((candidate) => candidate.id.startsWith('bed1-'))) {
      wall.exterior = false;
    }

    expect(find(plan, 'BEDROOM_EGRESS')?.suggestion).toContain('no exterior wall');
  });
});

describe('circulation rules', () => {
  it('flags a narrow hallway and reports which neighbour can give up the space', () => {
    const plan = clonePlan(sampleFloorplan);
    setEdge(plan, 'hall', 'W', 228);

    const violation = find(plan, 'HALL_MIN_WIDTH');
    expect(violation?.message).toContain('30in clear');
    expect(violation?.message).toContain('Bedroom 2');
    expect(violation?.message).toContain('margin');
    expect(violation?.suggestion).toContain('6in');
  });

  it('says when no single neighbour has enough margin to donate', () => {
    const plan = clonePlan(sampleFloorplan);
    setEdge(plan, 'hall', 'W', 228);
    // Leave Bedroom 2 only 2in of width to spare above its own 84in minimum.
    setEdge(plan, 'bed2', 'E', 344);

    expect(find(plan, 'HALL_MIN_WIDTH')?.message).toContain('cannot come from one side alone');
  });

  it('flags a narrow door and names the rooms it joins', () => {
    const violation = find(sampleFloorplan, 'DOOR_MIN_WIDTH');
    expect(violation?.message).toContain('Hallway');
    expect(violation?.message).toContain('Bathroom');
    expect(violation?.elementIds).toContain('hall-bath');
  });

  it('flags a room cut off from the entry and names a reachable neighbour', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.openings = plan.openings.filter((opening) => opening.id !== 'hall-bed2');

    const violation = find(plan, 'ROOM_UNREACHABLE');
    expect(violation?.message).toContain('Bedroom 2');
    expect(violation?.suggestion).toMatch(/Hallway|Kitchen/);
  });

  it('flags a plan with no exterior entry at all', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.openings = plan.openings.filter((opening) => !opening.connects.includes('EXTERIOR'));

    expect(find(plan, 'ROOM_UNREACHABLE')?.message).toContain('no exterior entry door');
  });
});

describe('fixture and clearance rules', () => {
  it('flags something parked in the toilet approach', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.find((item) => item.id === 'sink-1')!.position = { x: 165, y: 198 };

    const violation = find(plan, 'TOILET_CLEARANCE');
    expect(violation?.message).toContain('21in clear in front');
    expect(violation?.message).toContain('sink');
    expect(violation?.elementIds).toEqual(expect.arrayContaining(['toilet-1', 'sink-1']));
  });

  it('flags a toilet crowded against a wall', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.find((item) => item.id === 'toilet-1')!.position = { x: 206, y: 230 };

    expect(find(plan, 'TOILET_CLEARANCE')?.message).toContain('from the nearest wall');
  });

  it('flags a tight kitchen aisle as an error and a merely snug one as a warning', () => {
    // Island back east to 288 leaves a 21in aisle against the range.
    const tight = tightKitchen(288);
    expect(find(tight, 'KITCHEN_AISLE')?.severity).toBe('error');
    expect(find(tight, 'KITCHEN_AISLE')?.message).toContain('21in');

    // 268 leaves 41in: clears the 40in minimum, under the 42in two-cook target.
    const snug = tightKitchen(268);
    const violation = find(snug, 'KITCHEN_AISLE');
    expect(violation?.severity).toBe('warning');
    expect(violation?.message).toContain('two-cook');
  });

  it('clears a kitchen whose aisles are comfortable', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.find((item) => item.id === 'range-1')!.position = { x: 420, y: 54 };

    expect(codes(plan)).not.toContain('KITCHEN_AISLE');
  });

  it('flags plumbing that has drifted away from a wet wall', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.find((item) => item.id === 'sink-1')!.position = { x: 142, y: 274 };

    const violation = find(plan, 'WET_WALL');
    expect(violation?.message).toContain('sink');
    expect(violation?.suggestion).toContain('wet');
  });

  it('does not treat a range as a plumbing fixture', () => {
    const wetViolations = findAll(sampleFloorplan, 'WET_WALL');
    expect(wetViolations.some((violation) => violation.elementIds.includes('range-1'))).toBe(false);
  });

  it('separates a hard furniture overlap from a clearance-only one', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.push({
      id: 'chair-1',
      catalogId: 'chair',
      roomId: 'living',
      position: { x: 72, y: 72 },
      rotation: 0,
      footprint: { w: 24, d: 24 },
    });

    const hard = findAll(plan, 'FURNITURE_OVERLAP').find((violation) => violation.elementIds.includes('chair-1'));
    expect(hard?.severity).toBe('error');

    // The island and range footprints clear each other; only their approach
    // zones collide, which is a warning rather than an error.
    const clearanceOnly = findAll(tightKitchen(288), 'FURNITURE_OVERLAP')[0];
    expect(clearanceOnly.severity).toBe('warning');
    expect(clearanceOnly.message).toContain('approach zones overlap');
  });
});

describe('door swing rules', () => {
  it('sweeps the room the door opens into, not an arbitrary side of the wall', () => {
    // hall-bath hangs on the bathroom's east wall and opens into the bathroom.
    // Put the toilet back in that arc and it must be caught; if the swing were
    // taken from the wall's direction instead, it would sweep the hallway.
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.find((item) => item.id === 'toilet-1')!.position = { x: 192, y: 230 };

    const clash = findAll(plan, 'DOOR_SWING_CLASH').find((violation) => violation.elementIds.includes('hall-bath'));

    expect(clash?.message).toContain('toilet');
    expect(clash?.elementIds).toContain('toilet-1');
  });

  it('swings an exterior door into the building, not outside it', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.furniture.push({
      id: 'console-1',
      catalogId: 'console-table',
      roomId: 'living',
      position: { x: 18, y: 108 },
      rotation: 0,
      footprint: { w: 36, d: 16 },
    });

    const clash = findAll(plan, 'DOOR_SWING_CLASH').find((violation) => violation.elementIds.includes('console-1'));
    expect(clash?.elementIds).toContain('entry');
  });

  it('exempts sliding and fixed openings', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.openings.find((opening) => opening.id === 'hall-bath')!.swing = 'sliding';

    const clashes = findAll(plan, 'DOOR_SWING_CLASH');
    expect(clashes.some((violation) => violation.elementIds.includes('hall-bath'))).toBe(false);
  });

  it('flips the swept side when a door is changed from in to out', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.openings.find((opening) => opening.id === 'hall-bath')!.swing = 'out-left';

    const clashes = findAll(plan, 'DOOR_SWING_CLASH');
    expect(clashes.some((violation) => violation.elementIds.includes('toilet-1'))).toBe(false);
  });

  it('ignores furniture in rooms the door does not open into', () => {
    const plan = clonePlan(sampleFloorplan);
    // A bed pushed against the far side of the wall the entry door hangs on.
    plan.furniture.push({
      id: 'bed-3',
      catalogId: 'queen-bed',
      roomId: 'bed1',
      position: { x: 12, y: 126 },
      rotation: 0,
      footprint: { w: 60, d: 80 },
    });

    const clashes = findAll(plan, 'DOOR_SWING_CLASH');
    expect(clashes.some((violation) => violation.elementIds.includes('bed-3'))).toBe(false);
  });

  it('reports a pair of clashing doors once, not once from each side', () => {
    const plan = clonePlan(sampleFloorplan);
    // A second door sweeping the same corner of the hallway as kitchen-hall.
    plan.openings.push({
      id: 'hall-side',
      wallId: 'hall-W',
      kind: 'door',
      offset: 100,
      width: 32,
      height: 80,
      sillHeight: 0,
      swing: 'in-left',
      connects: ['bath', 'hall'],
    });

    const clashes = findAll(plan, 'DOOR_SWING_CLASH').filter((violation) => {
      return violation.elementIds.includes('hall-side') && violation.elementIds.includes('kitchen-hall');
    });

    expect(clashes).toHaveLength(1);
  });
});

describe('structural rules', () => {
  it('stays silent without a previous plan to compare against', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.walls = plan.walls.filter((wall) => wall.id !== 'living-W');

    expect(codes(plan)).not.toContain('LOAD_BEARING_REMOVED');
  });

  it('flags a deleted structural wall as an error', () => {
    const plan = clonePlan(sampleFloorplan);
    plan.walls = plan.walls.filter((wall) => wall.id !== 'living-W');

    const violation = find(plan, 'LOAD_BEARING_REMOVED', sampleFloorplan);
    expect(violation?.severity).toBe('error');
    expect(violation?.message).toContain('living-W');
    expect(violation?.message).toContain('removed');
  });

  it('warns when a structural wall is shortened past the threshold', () => {
    const plan = clonePlan(sampleFloorplan);
    const wall = plan.walls.find((item) => item.id === 'living-W')!;
    wall.end = { x: wall.start.x, y: wall.start.y - 24 };

    const violation = find(plan, 'LOAD_BEARING_REMOVED', sampleFloorplan);
    expect(violation?.severity).toBe('warning');
    expect(violation?.suggestion).toContain('add_opening');
  });

  it('ignores a trimmed partition wall and a small structural nudge', () => {
    const plan = clonePlan(sampleFloorplan);
    const partition = plan.walls.find((item) => item.id === 'bath-N')!;
    partition.end = { x: partition.start.x + 12, y: partition.start.y };

    const structural = plan.walls.find((item) => item.id === 'living-N')!;
    structural.end = { x: structural.end.x - 12, y: structural.end.y };

    expect(codes(plan, sampleFloorplan)).not.toContain('LOAD_BEARING_REMOVED');
  });
});
