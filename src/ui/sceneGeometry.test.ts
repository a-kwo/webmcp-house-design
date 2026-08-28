import { describe, expect, it } from 'vitest';
import { moveWall } from '../domain/operations';
import type { OperationResult } from '../domain/operations';
import { sampleFloorplan } from '../domain/sampleFloorplan';
import type { Floorplan, Wall } from '../domain/types';
import {
  DOLLHOUSE_WALL_HEIGHT_IN,
  cameraPose,
  changedWalls,
  furnitureHeight,
  furniturePlacement,
  openingPlacement,
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

  it('follows a wall drawn backwards rather than its neighbour', () => {
    // bath-W is the same physical wall as bed1-E, drawn in reverse.
    const forward = wallPlacement(wall('bed1-E'));
    const backward = wallPlacement(wall('bath-W'));

    expect(alongAxis(forward.rotationY).z).toBeCloseTo(1);
    expect(alongAxis(backward.rotationY).z).toBeCloseTo(-1);
    expect(backward.position).toEqual([132, 0, 300]);
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

describe('shared partitions', () => {
  it('cuts a doorway into both rooms\' copies of the same wall', () => {
    // hall-bed2 is recorded against bed2-W. hall-E is the same physical wall,
    // drawn by the hallway in the opposite direction, and must open too --
    // otherwise the neighbour's copy bricks up the doorway.
    const owner = wallPanelRects(sampleFloorplan, wall('bed2-W'), 96).holes;
    const neighbour = wallPanelRects(sampleFloorplan, wall('hall-E'), 96).holes;

    expect(owner.map((hole) => hole.openingId)).toContain('hall-bed2');
    expect(neighbour.map((hole) => hole.openingId)).toContain('hall-bed2');
  });

  it('maps the offset through the reversed wall rather than copying it', () => {
    const [owner] = wallPanelRects(sampleFloorplan, wall('bed2-W'), 96).holes;
    const [neighbour] = wallPanelRects(sampleFloorplan, wall('hall-E'), 96).holes;

    // Both walls span y 144-300; the door sits 48in from bed2-W's start at
    // y = 300, so it is 156 - 80 = 76in from hall-E's start at y = 144.
    expect(owner.x).toBeCloseTo(48, 1);
    expect(neighbour.x).toBeCloseTo(76, 1);
    expect(owner.w).toBeCloseTo(neighbour.w, 1);
  });

  it('always cuts an opening into the wall that records it', () => {
    for (const opening of sampleFloorplan.openings) {
      const owner = sampleFloorplan.walls.find((w) => w.id === opening.wallId)!;
      const holes = wallPanelRects(sampleFloorplan, owner, 96).holes;

      expect(holes.map((hole) => hole.openingId)).toContain(opening.id);
    }
  });

  it('opens only the coincident walls that actually span the opening', () => {
    // living-E carries the living-kitchen archway at y 48-108. kitchen-W is
    // coincident there and has to open too. hall-W shares the same x = 216 line
    // and overlaps living-E further south, but never reaches the archway, so it
    // stays solid -- coincidence alone is not enough.
    const kitchenSide = wallPanelRects(sampleFloorplan, wall('kitchen-W'), 96).holes;
    const hallSide = wallPanelRects(sampleFloorplan, wall('hall-W'), 96).holes;

    expect(kitchenSide.map((hole) => hole.openingId)).toContain('living-kitchen');
    expect(hallSide.map((hole) => hole.openingId)).not.toContain('living-kitchen');
  });

  it('leaves a wall on another line untouched', () => {
    const holes = wallPanelRects(sampleFloorplan, wall('bed1-S'), 96).holes;

    expect(holes).toHaveLength(0);
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

    // living-E and the copies of it the kitchen and hallway draw all move.
    expect(moved).toContain('living-E');
    expect(moved).toContain('kitchen-W');
    expect(moved.length).toBeGreaterThan(0);
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
