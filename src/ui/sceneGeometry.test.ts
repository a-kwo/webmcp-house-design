import { describe, expect, it } from 'vitest';
import { moveWall } from '../domain/operations';
import type { OperationResult } from '../domain/operations';
import { sampleFloorplan } from '../domain/sampleFloorplan';
import type { Floorplan, Wall } from '../domain/types';
import { CATALOG } from '../domain/catalog';
import {
  DOLLHOUSE_WALL_HEIGHT_IN,
  FURNITURE_HEIGHT_IN,
  cameraPose,
  changedWalls,
  proposedWalls,
  rotationTowards,
  furnitureHeight,
  furniturePlacement,
  openingPlacement,
  wallMountPlacement,
  wallPanelRects,
  wallPlacement,
} from './sceneGeometry';

function clonePlan(): Floorplan {
  return JSON.parse(JSON.stringify(sampleFloorplan)) as Floorplan;
}

function expectOk(result: OperationResult): Extract<OperationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected an ok result, got: ${result.error}`);
  }
  return result;
}

function wall(id: string, plan: Floorplan = sampleFloorplan): Wall {
  return plan.walls.find((candidate) => candidate.id === id)!;
}

/** Where a wall's local +x axis points once the group rotation is applied. */
function alongAxis(rotationY: number) {
  return { x: Math.cos(rotationY), z: -Math.sin(rotationY) };
}

describe('wallPlacement', () => {
  it('leaves an eastward wall unrotated', () => {
    const placement = wallPlacement(wall('living-N'));

    expect(placement.position).toEqual([0, 0, 0]);
    expect(placement.rotationY).toBeCloseTo(0);
    expect(placement.length).toBeCloseTo(216);
  });

  it('points local +x down the wall for a southward wall', () => {
    const placement = wallPlacement(wall('living-E'));
    const along = alongAxis(placement.rotationY);

    // living-E runs from (216, 0) to (216, 180), so plan +y, which is world +z.
    expect(along.x).toBeCloseTo(0);
    expect(along.z).toBeCloseTo(1);
  });

  it('runs every wall the same way, west to east and north to south', () => {
    // One wall per partition means no second copy pointing the other way, so an
    // offset along a wall means the same thing to both rooms sharing it.
    for (const candidate of sampleFloorplan.walls) {
      const along = alongAxis(wallPlacement(candidate).rotationY);
      expect(along.x).toBeGreaterThanOrEqual(-0.001);
      expect(along.z).toBeGreaterThanOrEqual(-0.001);
    }
  });
});

describe('wallPanelRects', () => {
  it('punches a hole for each opening on the wall', () => {
    const { outline, holes } = wallPanelRects(sampleFloorplan, wall('living-W'), 96);

    expect(outline).toEqual({ x: 0, y: 0, w: 180, h: 96 });
    expect(holes).toHaveLength(1);
    expect(holes[0].w).toBeCloseTo(36);
    // Just under the door's 80in: the bottom is inset off the panel edge below.
    expect(holes[0].h).toBeCloseTo(80, 1);
  });

  it('keeps a floor-level door off the panel edge', () => {
    const [hole] = wallPanelRects(sampleFloorplan, wall('living-W'), 96).holes;

    // A hole touching the outline leaves a coincident vertex that will not mesh.
    expect(hole.y).toBeGreaterThan(0);
    expect(hole.y).toBeLessThan(0.1);
  });

  it('caps an opening below a lintel when the walls are cut for the dollhouse view', () => {
    const [hole] = wallPanelRects(sampleFloorplan, wall('living-W'), DOLLHOUSE_WALL_HEIGHT_IN).holes;

    expect(hole.y + hole.h).toBeLessThan(DOLLHOUSE_WALL_HEIGHT_IN);
    expect(hole.y + hole.h).toBeCloseTo(DOLLHOUSE_WALL_HEIGHT_IN - 2);
  });

  it('drops an opening that sits entirely above the cut', () => {
    const plan = clonePlan();
    plan.openings = plan.openings.filter((opening) => opening.id === 'bed1-window');
    plan.openings[0].sillHeight = 60;

    expect(wallPanelRects(plan, wall('bed1-W', plan), DOLLHOUSE_WALL_HEIGHT_IN).holes).toHaveLength(0);
    expect(wallPanelRects(plan, wall('bed1-W', plan), 96).holes).toHaveLength(1);
  });

  it('clips an opening that overruns the end of its wall', () => {
    const plan = clonePlan();
    plan.openings = plan.openings.filter((opening) => opening.id === 'entry');
    plan.openings[0].offset = 170;

    const [hole] = wallPanelRects(plan, wall('living-W', plan), 96).holes;

    expect(hole.x + hole.w).toBeLessThanOrEqual(180);
  });
});

describe('one wall per partition', () => {
  it('cuts a doorway once, into the wall both rooms reference', () => {
    const shared = wall('hall-E');
    const holes = wallPanelRects(sampleFloorplan, shared, 96).holes;

    expect(holes.map((hole) => hole.openingId)).toEqual(['hall-bed2']);

    const rooms = sampleFloorplan.rooms.filter((room) => room.wallIds.includes('hall-E'));
    expect(rooms.map((room) => room.id).sort()).toEqual(['bed2', 'hall']);
  });

  it('always cuts an opening into the wall that records it', () => {
    for (const opening of sampleFloorplan.openings) {
      const owner = sampleFloorplan.walls.find((w) => w.id === opening.wallId)!;
      const holes = wallPanelRects(sampleFloorplan, owner, 96).holes;

      expect(holes.map((hole) => hole.openingId)).toContain(opening.id);
    }
  });

  it('leaves a wall on another line untouched', () => {
    expect(wallPanelRects(sampleFloorplan, wall('bed1-S'), 96).holes).toHaveLength(0);
  });
});

describe('openingPlacement', () => {
  it('centres the pane on the opening, in world space', () => {
    const target = wall('living-W');
    const [hole] = wallPanelRects(sampleFloorplan, target, 96).holes;
    const placement = openingPlacement(target, hole);

    // living-W runs from (0, 180) to (0, 0); the entry door sits 54in along it.
    expect(placement.position[0]).toBeCloseTo(0);
    expect(placement.position[2]).toBeCloseTo(180 - (54 + 36 / 2));
    expect(placement.position[1]).toBeCloseTo(hole.h / 2 + hole.y);
  });
});

describe('changedWalls', () => {
  it('reports nothing when a variant is the plan itself', () => {
    expect(changedWalls(sampleFloorplan, clonePlan())).toHaveLength(0);
  });

  it('picks out only the walls a wall move actually shifted', () => {
    const variant = expectOk(moveWall(sampleFloorplan, { wallId: 'living-E', distanceIn: 24, direction: 'east' }));
    const moved = changedWalls(sampleFloorplan, variant.plan).map((wall) => wall.id).sort();

    // The whole x = 216 line slides, along with every wall ending on it.
    expect(moved).toContain('living-E');
    expect(moved).toContain('living-E-2');
    expect(moved).toContain('hall-W');
    expect(moved.length).toBeLessThan(sampleFloorplan.walls.length);
  });

  it('counts a wall the variant adds', () => {
    const plan = clonePlan();
    plan.walls.push({
      id: 'brand-new',
      start: { x: 0, y: 0 },
      end: { x: 48, y: 0 },
      thickness: 5,
      exterior: false,
      loadBearing: false,
      wet: false,
    });

    expect(changedWalls(sampleFloorplan, plan).map((wall) => wall.id)).toEqual(['brand-new']);
  });
});

describe('proposedWalls', () => {
  it('ghosts the wall that relocated, not the ones it stretched', () => {
    const variant = expectOk(moveWall(sampleFloorplan, { wallId: 'hall-E', distanceIn: 12, direction: 'east' }));
    const proposed = proposedWalls(sampleFloorplan, variant.plan).map((wall) => wall.id).sort();
    const changed = changedWalls(sampleFloorplan, variant.plan).map((wall) => wall.id).sort();

    // hall-E moves to x = 270. The walls meeting it only change length, and two
    // of those sit on the plan's south edge, right in front of the iso camera.
    expect(proposed).toEqual(['hall-E']);
    expect(changed).toContain('hall-S');
    expect(proposed).not.toContain('hall-S');
    expect(proposed).not.toContain('bed2-S');
  });

  it('falls back to every changed wall when nothing relocated', () => {
    const plan = clonePlan();
    const stretched = plan.walls.find((wall) => wall.id === 'living-N')!;
    stretched.end = { x: stretched.end.x + 24, y: stretched.end.y };

    // The line is unchanged, so there is no relocation to show on its own.
    expect(proposedWalls(sampleFloorplan, plan).map((wall) => wall.id)).toEqual(['living-N']);
  });
});

describe('furniturePlacement', () => {
  it('stands a piece on the floor at its plan position', () => {
    const bed = sampleFloorplan.furniture.find((item) => item.id === 'bed-1')!;
    const placement = furniturePlacement(bed);

    expect(placement.position[0]).toBe(60);
    expect(placement.position[2]).toBe(252);
    expect(placement.position[1]).toBeCloseTo(furnitureHeight('queen-bed') / 2);
    expect(placement.size).toEqual([60, 24, 80]);
  });

  it('negates the plan rotation, because plan +y maps to world +z', () => {
    const range = sampleFloorplan.furniture.find((item) => item.id === 'range-1')!;

    expect(range.rotation).toBe(90);
    expect(furniturePlacement(range).rotationY).toBeCloseTo(-Math.PI / 2);
  });

  it('falls back to a default height for an unknown catalog id', () => {
    expect(furnitureHeight('grand-piano')).toBe(30);
  });

  it('gives every palette item an explicit height', () => {
    // A new catalog entry without a height renders at the 30in fallback --
    // a 30in-tall fridge -- and nothing else would catch it.
    for (const item of CATALOG) {
      expect(FURNITURE_HEIGHT_IN[item.id], item.id).toBeDefined();
    }
  });
});

describe('rotationTowards', () => {
  it('faces the four compass points', () => {
    const centre = { x: 100, y: 100 };
    expect(rotationTowards(centre, { x: 100, y: 160 })).toBe(0);
    expect(rotationTowards(centre, { x: 40, y: 100 })).toBe(90);
    expect(rotationTowards(centre, { x: 100, y: 40 })).toBe(180);
    expect(rotationTowards(centre, { x: 160, y: 100 })).toBe(270);
  });

  it('snaps to 5 degrees so hand-set angles stay tidy', () => {
    const centre = { x: 0, y: 0 };
    const loose = rotationTowards(centre, { x: -3, y: 60 });
    expect(loose % 5).toBe(0);
  });

  it('holds still on a degenerate point', () => {
    expect(rotationTowards({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
});

describe('wallMountPlacement', () => {
  it('hangs the panel off the clicked face, facing into that room', () => {
    // living-E runs north-south at x = 216. A viewer in the living room is
    // west of it, so the panel lands west of the wall and faces west.
    const wall = sampleFloorplan.walls.find((candidate) => candidate.id === 'living-E')!;
    const mount = wallMountPlacement(wall, { x: 216, y: 72 }, { x: 200, y: 72 }, 60);

    expect(mount.position.x).toBeLessThan(216);
    expect(mount.position.x).toBeGreaterThan(216 - 12);
    expect(mount.position.y).toBeCloseTo(72);
    expect(mount.rotation).toBe(90);
  });

  it('mounts on the other face for a viewer on the other side', () => {
    const wall = sampleFloorplan.walls.find((candidate) => candidate.id === 'living-E')!;
    const mount = wallMountPlacement(wall, { x: 216, y: 72 }, { x: 240, y: 72 }, 60);

    expect(mount.position.x).toBeGreaterThan(216);
    expect(mount.rotation).toBe(270);
  });

  it('clamps a click near a wall end so the panel stays on the wall', () => {
    // living-N runs x 0-216 at y = 0; a click at x = 10 cannot centre a 60in
    // panel without overhanging the corner.
    const wall = sampleFloorplan.walls.find((candidate) => candidate.id === 'living-N')!;
    const mount = wallMountPlacement(wall, { x: 10, y: 0 }, { x: 10, y: 40 }, 60);

    expect(mount.position.x).toBeGreaterThanOrEqual(32);
    expect(mount.rotation).toBe(0);
  });

  it('survives the placement snap with the panel depth inside the room', () => {
    const wall = sampleFloorplan.walls.find((candidate) => candidate.id === 'living-E')!;
    const mount = wallMountPlacement(wall, { x: 216, y: 72 }, { x: 200, y: 72 }, 60);
    const snapped = Math.round(mount.position.x / 6) * 6;

    // Panel is 4in deep; its whole depth must sit west of the wall line.
    expect(snapped + 2).toBeLessThanOrEqual(216);
  });
});

describe('cameraPose', () => {
  it('looks straight down from above the plan in top mode', () => {
    const pose = cameraPose(sampleFloorplan, { mode: 'top', targetRoomId: null, description: '' });

    expect(pose.position[0]).toBeCloseTo(192);
    expect(pose.position[2]).toBeCloseTo(150, 0);
    expect(pose.position[1]).toBeGreaterThan(384);
    expect(pose.target).toEqual([192, 0, 150]);
  });

  it('pulls back to the south-east in iso mode', () => {
    const pose = cameraPose(sampleFloorplan, { mode: 'iso', targetRoomId: null, description: '' });

    expect(pose.position[0]).toBeGreaterThan(pose.target[0]);
    expect(pose.position[2]).toBeGreaterThan(pose.target[2]);
    expect(pose.position[1]).toBeGreaterThan(0);
  });

  it('centres on a target room when one is given', () => {
    const pose = cameraPose(sampleFloorplan, { mode: 'iso', targetRoomId: 'bath', description: '' });

    expect(pose.target[0]).toBeCloseTo(174);
    expect(pose.target[2]).toBeCloseTo(240);
  });

  it('stands at eye height in the room and faces one it opens onto', () => {
    const pose = cameraPose(sampleFloorplan, { mode: 'firstPerson', targetRoomId: 'bed2', description: '' });

    expect(pose.position[1]).toBe(60);
    expect(pose.target[1]).toBe(60);
    // bed2 opens onto the hallway, which is west of it.
    expect(pose.target[0]).toBeLessThan(pose.position[0]);
  });

  it('backs up against the wall behind so the doorway is not point blank', () => {
    const pose = cameraPose(sampleFloorplan, { mode: 'firstPerson', targetRoomId: 'bed2', description: '' });

    // bed2 spans x 258-384 and opens west; standing on the centroid at x = 321
    // would leave 63in of room ahead, which fills the frame with wall.
    expect(pose.position[0]).toBeCloseTo(372);
    expect(pose.position[0]).toBeLessThan(384);
    expect(pose.position[2]).toBeCloseTo(222);
  });

  it('falls back to the first room when the target is unknown', () => {
    const pose = cameraPose(sampleFloorplan, { mode: 'firstPerson', targetRoomId: 'nowhere', description: '' });

    expect(pose.position[1]).toBe(60);
    // Backed up against the living room's west end, looking east at the kitchen.
    expect(pose.position[0]).toBeLessThan(108);
    expect(pose.target[0]).toBeGreaterThan(pose.position[0]);
  });
});
