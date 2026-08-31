import {
  GRID_IN,
  boundingBox,
  convexPolygonsOverlap,
  distance,
  doorSwingPolygon,
  furniturePolygon,
  pointToSegmentDistance,
  polygonCentroid,
  polygonGap,
  roomAreaSqFt,
  roomDimensions,
  roomPolygon,
  roomWalls,
  snapUpToGrid,
} from './geometry';
import type { Box } from './geometry';
import type { Floorplan, Furniture, Opening, Point, Room, Violation, Wall } from './types';

const BEDROOM_MIN_AREA_SQ_FT = 70;
const BEDROOM_MIN_DIMENSION_IN = 84;
const HALL_MIN_WIDTH_IN = 36;
const DOOR_MIN_WIDTH_IN = 32;
const TOILET_FRONT_CLEARANCE_IN = 21;
const TOILET_SIDE_CLEARANCE_IN = 15;
const KITCHEN_MIN_AISLE_IN = 40;
const KITCHEN_WARN_AISLE_IN = 42;
const WET_WALL_MAX_DISTANCE_IN = 24;
const STRUCTURAL_SHORTENED_IN = 24;
const ADJACENCY_TOLERANCE_IN = 1;

const SQ_IN_PER_SQ_FT = 144;

const plumbingCatalogIds = new Set(['toilet', 'sink', 'shower', 'tub', 'bath', 'vanity', 'dishwasher', 'washer']);

/**
 * `previous` lets the structural rule see edits rather than guess from the
 * current plan alone: a wall that vanished or lost length between the two
 * snapshots is what `LOAD_BEARING_REMOVED` is actually about.
 */
export function validate(plan: Floorplan, previous?: Floorplan): Violation[] {
  const toiletPairs = new Set<string>();

  return [
    ...validateBedroomMinimums(plan),
    ...validateBedroomEgress(plan),
    ...validateHallWidth(plan),
    ...validateDoorWidths(plan),
    ...validateToiletClearance(plan, toiletPairs),
    ...validateKitchenAisles(plan),
    ...validateWetWalls(plan),
    ...validateDoorSwingClashes(plan),
    ...validateFurnitureOverlap(plan, toiletPairs),
    ...validateReachability(plan),
    ...validateStructuralWalls(plan, previous),
  ];
}

function validateBedroomMinimums(plan: Floorplan): Violation[] {
  const violations: Violation[] = [];

  for (const room of plan.rooms.filter((item) => item.type === 'bedroom')) {
    const area = roomAreaSqFt(plan, room);
    const dimensions = roomDimensions(plan, room);

    if (area < BEDROOM_MIN_AREA_SQ_FT) {
      const shortfall = BEDROOM_MIN_AREA_SQ_FT - area;
      violations.push({
        code: 'BEDROOM_MIN_AREA',
        severity: 'error',
        message: `${room.name} is ${formatSqFt(area)}; simplified minimum is ${BEDROOM_MIN_AREA_SQ_FT} sq ft.${growthConsequence(plan, room, shortfall)}`,
        elementIds: [room.id, ...room.wallIds],
        suggestion: `Grow ${room.name} by ${formatSqFt(shortfall)} or re-label it as a non-bedroom space.`,
      });
    }

    if (dimensions.minDimension < BEDROOM_MIN_DIMENSION_IN) {
      const axis = dimensions.width <= dimensions.depth ? 'x' : 'y';
      const needed = BEDROOM_MIN_DIMENSION_IN - dimensions.minDimension;
      violations.push({
        code: 'BEDROOM_MIN_DIM',
        severity: 'error',
        message: `${room.name} is ${formatIn(dimensions.minDimension)} at its narrowest; simplified bedroom minimum is 7 ft.${borrowConsequence(plan, room, axis, needed)}`,
        elementIds: [room.id, ...room.wallIds],
        suggestion: `Move ${room.name}'s short-side wall outward by at least ${formatIn(needed)}.`,
      });
    }
  }

  return violations;
}

function validateBedroomEgress(plan: Floorplan): Violation[] {
  return plan.rooms
    .filter((room) => room.type === 'bedroom')
    .filter((room) => {
      return !plan.openings.some((opening) => {
        return opening.connects.includes(room.id) && opening.connects.includes('EXTERIOR') && ['door', 'window'].includes(opening.kind);
      });
    })
    .map((room) => {
      const exteriorWalls = roomWalls(plan, room).filter((wall) => wall.exterior);
      return {
        code: 'BEDROOM_EGRESS',
        severity: 'error' as const,
        message: `${room.name} has no exterior door or window; every bedroom needs a simplified egress opening.`,
        elementIds: [room.id, ...room.wallIds],
        suggestion: exteriorWalls.length > 0
          ? `Add a window to ${exteriorWalls.map((wall) => wall.id).join(' or ')}, which already face the exterior.`
          : `${room.name} touches no exterior wall, so it cannot take an egress window where it sits; move the room to the perimeter.`,
      };
    });
}

function validateHallWidth(plan: Floorplan): Violation[] {
  return plan.rooms
    .filter((room) => room.type === 'hallway')
    .flatMap((room) => {
      const dimensions = roomDimensions(plan, room);
      const width = dimensions.minDimension;
      if (width >= HALL_MIN_WIDTH_IN) {
        return [];
      }

      const axis = dimensions.width <= dimensions.depth ? 'x' : 'y';
      const needed = HALL_MIN_WIDTH_IN - width;

      return [{
        code: 'HALL_MIN_WIDTH',
        severity: 'error' as const,
        message: `${room.name} is ${formatIn(width)} clear; simplified minimum is ${HALL_MIN_WIDTH_IN}in.${borrowConsequence(plan, room, axis, needed)}`,
        elementIds: [room.id, ...room.wallIds],
        suggestion: `Widen ${room.name} by at least ${formatIn(needed)}.`,
      }];
    });
}

function validateDoorWidths(plan: Floorplan): Violation[] {
  return plan.openings
    .filter((opening) => opening.kind === 'door' && opening.width < DOOR_MIN_WIDTH_IN)
    .map((opening) => ({
      code: 'DOOR_MIN_WIDTH',
      severity: 'error' as const,
      message: `Door ${opening.id} is ${formatIn(opening.width)} clear between ${describeConnects(plan, opening)}; simplified minimum is ${DOOR_MIN_WIDTH_IN}in.`,
      elementIds: [opening.id, opening.wallId],
      // Name a width the grid can actually produce. Advising "widen by 2in"
      // sends you to 32in, which snaps to the next step anyway -- and before
      // openings rounded up, straight back to 30in and this same violation.
      suggestion: `Widen ${opening.id} to ${snapUpToGrid(DOOR_MIN_WIDTH_IN, GRID_IN)}in, the next size the ${GRID_IN}in grid allows, or make it an archway if the room needs no privacy.`,
    }));
}

function validateToiletClearance(plan: Floorplan, reportedPairs: Set<string>): Violation[] {
  const violations: Violation[] = [];

  for (const toilet of plan.furniture.filter((item) => item.catalogId === 'toilet')) {
    const room = plan.rooms.find((item) => item.id === toilet.roomId);
    if (!room) {
      continue;
    }

    const approach = furniturePolygon({ ...toilet, clearanceFront: TOILET_FRONT_CLEARANCE_IN }, true);
    const clashes = plan.furniture.filter((item) => {
      return item.id !== toilet.id && item.roomId === toilet.roomId && convexPolygonsOverlap(approach, furniturePolygon(item));
    });

    if (clashes.length > 0) {
      for (const clash of clashes) {
        reportedPairs.add(pairKey(toilet.id, clash.id));
      }

      violations.push({
        code: 'TOILET_CLEARANCE',
        severity: 'error',
        message: `The toilet in ${room.name} needs ${TOILET_FRONT_CLEARANCE_IN}in clear in front but ${listNames(clashes)} sits in that approach zone.`,
        elementIds: [toilet.id, ...clashes.map((item) => item.id)],
        suggestion: `Slide the toilet along its wall or move ${listNames(clashes)} clear of the ${TOILET_FRONT_CLEARANCE_IN}in approach.`,
      });
    }

    const wallDistance = nearestWallDistanceIn(plan, room, toilet.position);
    const fixture = nearestFixture(plan, toilet);
    const sideDistance = Math.min(wallDistance, fixture?.gap ?? Infinity);

    if (sideDistance < TOILET_SIDE_CLEARANCE_IN) {
      const blocker = fixture && fixture.gap < wallDistance ? `the ${fixture.item.catalogId}` : 'the nearest wall';
      violations.push({
        code: 'TOILET_CLEARANCE',
        severity: 'error',
        message: `The toilet in ${room.name} sits ${formatIn(sideDistance)} from ${blocker}; simplified minimum from the centerline is ${TOILET_SIDE_CLEARANCE_IN}in.`,
        elementIds: [toilet.id, ...(fixture && fixture.gap < wallDistance ? [fixture.item.id] : room.wallIds)],
        suggestion: `Shift the toilet ${formatIn(TOILET_SIDE_CLEARANCE_IN - sideDistance)} further from ${blocker}.`,
      });
    }
  }

  return violations;
}

function validateKitchenAisles(plan: Floorplan): Violation[] {
  const violations: Violation[] = [];

  for (const kitchen of plan.rooms.filter((room) => room.type === 'kitchen')) {
    const kitchenFurniture = plan.furniture.filter((item) => item.roomId === kitchen.id);
    const aisles = pairwise(kitchenFurniture)
      .map(([a, b]) => ({ a, b, gap: polygonGap(furniturePolygon(a), furniturePolygon(b)) }))
      .filter((aisle) => aisle.gap > 0)
      .sort((first, second) => first.gap - second.gap);

    const tightest = aisles[0];
    if (!tightest) {
      continue;
    }

    if (tightest.gap < KITCHEN_MIN_AISLE_IN) {
      violations.push({
        code: 'KITCHEN_AISLE',
        severity: 'error',
        message: `${kitchen.name}'s tightest work aisle is ${formatIn(tightest.gap)}, between the ${tightest.a.catalogId} and the ${tightest.b.catalogId}; simplified minimum is ${KITCHEN_MIN_AISLE_IN}in.`,
        elementIds: [kitchen.id, tightest.a.id, tightest.b.id],
        suggestion: `Move the ${tightest.a.catalogId} or ${tightest.b.catalogId} apart by ${formatIn(KITCHEN_MIN_AISLE_IN - tightest.gap)}, or narrow one of them.`,
      });
    } else if (tightest.gap < KITCHEN_WARN_AISLE_IN) {
      violations.push({
        code: 'KITCHEN_AISLE',
        severity: 'warning',
        message: `${kitchen.name}'s tightest work aisle is ${formatIn(tightest.gap)}, between the ${tightest.a.catalogId} and the ${tightest.b.catalogId}; that clears the ${KITCHEN_MIN_AISLE_IN}in minimum but is under the ${KITCHEN_WARN_AISLE_IN}in two-cook target.`,
        elementIds: [kitchen.id, tightest.a.id, tightest.b.id],
        suggestion: `Open the aisle by ${formatIn(KITCHEN_WARN_AISLE_IN - tightest.gap)} if two people will cook here.`,
      });
    }
  }

  return violations;
}

function validateWetWalls(plan: Floorplan): Violation[] {
  return plan.furniture
    .filter((item) => plumbingCatalogIds.has(item.catalogId))
    .flatMap((item) => {
      const room = plan.rooms.find((candidate) => candidate.id === item.roomId);
      if (!room) {
        return [];
      }

      const walls = roomWalls(plan, room);
      const nearestWet = walls
        .filter((wall) => wall.wet)
        .map((wall) => pointToSegmentDistance(item.position, wall.start, wall.end))
        .sort((a, b) => a - b)[0];

      if (nearestWet !== undefined && nearestWet <= WET_WALL_MAX_DISTANCE_IN) {
        return [];
      }

      const closestWall = [...walls].sort((a, b) => {
        return pointToSegmentDistance(item.position, a.start, a.end) - pointToSegmentDistance(item.position, b.start, b.end);
      })[0];

      return [{
        code: 'WET_WALL',
        severity: 'warning' as const,
        message: nearestWet === undefined
          ? `The ${item.catalogId} in ${room.name} needs plumbing, but no wall in the room is flagged wet.`
          : `The ${item.catalogId} in ${room.name} is ${formatIn(nearestWet)} from the nearest wet wall; plumbing runs should stay within ${WET_WALL_MAX_DISTANCE_IN}in.`,
        elementIds: [item.id, room.id],
        suggestion: closestWall
          ? `Move the ${item.catalogId} against a wet wall, or flag ${closestWall.id} as wet if a supply run can reach it.`
          : `Move the ${item.catalogId} against a wet wall.`,
      }];
    });
}

function validateDoorSwingClashes(plan: Floorplan): Violation[] {
  const violations: Violation[] = [];
  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const reportedDoorPairs = new Set<string>();

  const swings = plan.openings
    .map((door) => {
      const wall = wallsById.get(door.wallId);
      const polygon = wall ? doorSwingPolygon(wall, door, swingTargetPoint(plan, door)) : null;
      return polygon ? { door, polygon } : null;
    })
    .filter((entry): entry is { door: Opening; polygon: ReturnType<typeof furniturePolygon> } => entry !== null);

  for (const { door, polygon } of swings) {
    // A door only sweeps the rooms it opens between, so ignore furniture elsewhere.
    const reachableRooms = new Set(door.connects.filter((id) => id !== 'EXTERIOR'));
    const furnitureClashes = plan.furniture.filter((item) => {
      return reachableRooms.has(item.roomId) && convexPolygonsOverlap(polygon, furniturePolygon(item));
    });
    // Two doors sweeping into each other are one problem, so report the pair once.
    const doorClashes = swings
      .filter((other) => other.door.id !== door.id && sharesRoom(other.door, door))
      .filter((other) => convexPolygonsOverlap(polygon, other.polygon))
      .map((other) => other.door)
      .filter((other) => !reportedDoorPairs.has(pairKey(door.id, other.id)));

    for (const other of doorClashes) {
      reportedDoorPairs.add(pairKey(door.id, other.id));
    }

    if (furnitureClashes.length === 0 && doorClashes.length === 0) {
      continue;
    }

    const blockers = [...furnitureClashes.map((item) => `the ${item.catalogId}`), ...doorClashes.map((item) => `door ${item.id}`)];

    violations.push({
      code: 'DOOR_SWING_CLASH',
      severity: 'warning',
      message: `Door ${door.id}'s swing arc hits ${joinList(blockers)}.`,
      elementIds: [door.id, ...furnitureClashes.map((item) => item.id), ...doorClashes.map((item) => item.id)],
      suggestion: `Flip ${door.id}'s hinge to the other jamb, swing it the other way, or make it sliding.`,
    });
  }

  return violations;
}

function validateFurnitureOverlap(plan: Floorplan, reportedPairs: Set<string>): Violation[] {
  return pairwise(plan.furniture)
    .filter(([a, b]) => a.roomId === b.roomId && !reportedPairs.has(pairKey(a.id, b.id)))
    .flatMap(([a, b]) => {
      const footprintsCollide = convexPolygonsOverlap(furniturePolygon(a), furniturePolygon(b));
      const clearanceCollides = convexPolygonsOverlap(furniturePolygon(a, true), furniturePolygon(b, true));

      if (!footprintsCollide && !clearanceCollides) {
        return [];
      }

      return [{
        code: 'FURNITURE_OVERLAP',
        severity: footprintsCollide ? ('error' as const) : ('warning' as const),
        message: footprintsCollide
          ? `The ${a.catalogId} and the ${b.catalogId} overlap in ${roomName(plan, a.roomId)}.`
          : `The ${a.catalogId} and the ${b.catalogId} clear each other in ${roomName(plan, a.roomId)}, but their approach zones overlap.`,
        elementIds: [a.id, b.id],
        suggestion: `Move one of them, or drop the approach clearance if the pieces are not used at the same time.`,
      }];
    });
}

function validateReachability(plan: Floorplan): Violation[] {
  const entryOpening = plan.openings.find((opening) => opening.connects.includes('EXTERIOR') && ['door', 'archway'].includes(opening.kind));
  if (!entryOpening) {
    return [{
      code: 'ROOM_UNREACHABLE',
      severity: 'error',
      message: `The plan has no exterior entry door, so no room can be reached from outside.`,
      elementIds: plan.rooms.map((room) => room.id),
      suggestion: `Add an exterior door to the living room or another public space.`,
    }];
  }

  const entryRoomId = entryOpening.connects.find((id) => id !== 'EXTERIOR');
  if (!entryRoomId) {
    return [];
  }

  const reachable = new Set<string>([entryRoomId]);
  const queue = [entryRoomId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const opening of plan.openings.filter((item) => ['door', 'archway'].includes(item.kind) && item.connects.includes(current))) {
      const next = opening.connects.find((id) => id !== current && id !== 'EXTERIOR');
      if (next && !reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  return plan.rooms
    .filter((room) => !reachable.has(room.id))
    .map((room) => {
      const neighbours = adjacentRooms(plan, room).filter((neighbour) => reachable.has(neighbour.id));
      return {
        code: 'ROOM_UNREACHABLE',
        severity: 'error' as const,
        message: `${room.name} cannot be reached from the entry through any door or archway.`,
        elementIds: [room.id, ...room.wallIds],
        suggestion: neighbours.length > 0
          ? `Add a door between ${room.name} and ${joinList(neighbours.map((neighbour) => neighbour.name))}, which ${neighbours.length === 1 ? 'is' : 'are'} already reachable and share${neighbours.length === 1 ? 's' : ''} a wall.`
          : `Add a door connecting ${room.name} to a reachable room.`,
      };
    });
}

function validateStructuralWalls(plan: Floorplan, previous?: Floorplan): Violation[] {
  if (!previous) {
    return [];
  }

  const currentById = new Map(plan.walls.map((wall) => [wall.id, wall]));

  return previous.walls
    .filter((wall) => wall.exterior || wall.loadBearing)
    .flatMap((before): Violation[] => {
      const after = currentById.get(before.id);
      const label = before.exterior ? 'exterior' : 'load-bearing';

      if (!after) {
        return [{
          code: 'LOAD_BEARING_REMOVED',
          severity: 'error' as const,
          message: `Wall ${before.id} was ${label} and has been removed; the structure above it is now unsupported.`,
          elementIds: [before.id],
          suggestion: `Restore ${before.id}, or add a beam and posts to carry the span before removing it.`,
        }];
      }

      // A wall that a new room met part-way along was cut in two, not
      // shortened: the remainder is still standing under a new id. Counting
      // only `after` reports the offcut as lost structure.
      const lostLength =
        distance(before.start, before.end) - distance(after.start, after.end) - offcutLength(plan, previous, after);

      if (lostLength <= STRUCTURAL_SHORTENED_IN) {
        return [];
      }

      return [{
        code: 'LOAD_BEARING_REMOVED',
        severity: 'warning' as const,
        message: `Wall ${after.id} is ${label} and lost ${formatIn(lostLength)} of length in this edit.`,
        elementIds: [after.id],
        suggestion: `Use add_opening to pass through ${after.id} instead of shortening it, or head off the opening with a beam.`,
      }];
    });
}

/**
 * How much of `wall` is carried by pieces that did not exist before it: the
 * far half of a split, lying on the same line and continuing past its end.
 */
function offcutLength(plan: Floorplan, previous: Floorplan, wall: Wall): number {
  const previousIds = new Set(previous.walls.map((candidate) => candidate.id));
  const vertical = Math.abs(wall.start.x - wall.end.x) < ADJACENCY_TOLERANCE_IN / 2;
  const axis: 'x' | 'y' = vertical ? 'y' : 'x';
  const line = vertical ? wall.start.x : wall.start.y;

  return plan.walls
    .filter((candidate) => {
      if (previousIds.has(candidate.id) || candidate.id === wall.id) {
        return false;
      }

      const candidateVertical = Math.abs(candidate.start.x - candidate.end.x) < ADJACENCY_TOLERANCE_IN / 2;
      if (candidateVertical !== vertical) {
        return false;
      }

      const candidateLine = candidateVertical ? candidate.start.x : candidate.start.y;
      return Math.abs(candidateLine - line) < ADJACENCY_TOLERANCE_IN / 2;
    })
    .reduce((total, candidate) => total + Math.abs(candidate.end[axis] - candidate.start[axis]), 0);
}

/**
 * The room an `in-*` door sweeps: the room being entered, or the interior room
 * when the door faces the exterior.
 */
function swingTargetPoint(plan: Floorplan, door: Opening): Point | undefined {
  const [from, to] = door.connects;
  const targetId = to === 'EXTERIOR' ? from : to;
  const room = plan.rooms.find((candidate) => candidate.id === targetId);

  return room ? polygonCentroid(roomPolygon(plan, room)) : undefined;
}

function roomBox(plan: Floorplan, room: Room): Box {
  return boundingBox(roomPolygon(plan, room));
}

/** Rectangular rooms whose bounding boxes share an edge and overlap along it. */
function adjacentRooms(plan: Floorplan, room: Room): Room[] {
  const box = roomBox(plan, room);

  return plan.rooms.filter((candidate) => {
    if (candidate.id === room.id) {
      return false;
    }

    const other = roomBox(plan, candidate);
    const touchesVertically = Math.abs(box.maxX - other.minX) <= ADJACENCY_TOLERANCE_IN || Math.abs(other.maxX - box.minX) <= ADJACENCY_TOLERANCE_IN;
    const touchesHorizontally = Math.abs(box.maxY - other.minY) <= ADJACENCY_TOLERANCE_IN || Math.abs(other.maxY - box.minY) <= ADJACENCY_TOLERANCE_IN;
    const overlapsY = box.minY < other.maxY && other.minY < box.maxY;
    const overlapsX = box.minX < other.maxX && other.minX < box.maxX;

    return (touchesVertically && overlapsY) || (touchesHorizontally && overlapsX);
  });
}

/**
 * How many inches a room can give up along an axis before it breaks its own
 * minimums. Null when the room type has no dimensional minimum to trade against.
 */
function shrinkSlackIn(plan: Floorplan, room: Room, axis: 'x' | 'y'): number | null {
  const dimensions = roomDimensions(plan, room);
  const along = axis === 'x' ? dimensions.width : dimensions.depth;
  const across = axis === 'x' ? dimensions.depth : dimensions.width;

  const minDimension = room.type === 'bedroom' ? BEDROOM_MIN_DIMENSION_IN : room.type === 'hallway' ? HALL_MIN_WIDTH_IN : null;
  const minArea = room.type === 'bedroom' ? BEDROOM_MIN_AREA_SQ_FT : null;

  if (minDimension === null && minArea === null) {
    return null;
  }

  const limits: number[] = [];
  if (minDimension !== null) {
    limits.push(along - minDimension);
  }
  if (minArea !== null && across > 0) {
    limits.push(along - (minArea * SQ_IN_PER_SQ_FT) / across);
  }

  return Math.max(0, Math.min(...limits));
}

/**
 * The second sentence of a violation message: growing this room has to take
 * space from a neighbour, so name the neighbour and how much slack it has.
 */
function borrowConsequence(plan: Floorplan, room: Room, axis: 'x' | 'y', neededIn: number): string {
  const neighbours = adjacentRooms(plan, room).map((neighbour) => ({
    neighbour,
    slack: shrinkSlackIn(plan, neighbour, axis),
  }));

  if (neighbours.length === 0) {
    return '';
  }

  // Prefer a neighbour whose own minimums make the trade quantifiable; only
  // fall back to naming an unconstrained room when no such neighbour exists.
  const constrained = neighbours
    .filter((entry): entry is { neighbour: Room; slack: number } => entry.slack !== null)
    .sort((first, second) => second.slack - first.slack);

  const best = constrained[0];
  if (!best) {
    const donor = neighbours[0].neighbour;
    return ` The ${formatIn(neededIn)} would come out of ${donor.name}, which has no minimum of its own under these simplified rules.`;
  }

  if (best.slack >= neededIn) {
    return ` Taking the ${formatIn(neededIn)} from ${best.neighbour.name} works: it has ${formatIn(best.slack)} of margin above its own minimum.`;
  }

  return ` ${best.neighbour.name} has the most to give of any neighbour and it only has ${formatIn(best.slack)} of margin, so ${formatIn(neededIn)} cannot come from one side alone.`;
}

function growthConsequence(plan: Floorplan, room: Room, shortfallSqFt: number): string {
  const dimensions = roomDimensions(plan, room);
  if (dimensions.width <= 0 || dimensions.depth <= 0) {
    return '';
  }

  const axis = dimensions.width <= dimensions.depth ? 'x' : 'y';
  const across = axis === 'x' ? dimensions.depth : dimensions.width;
  const neededIn = (shortfallSqFt * SQ_IN_PER_SQ_FT) / across;

  return borrowConsequence(plan, room, axis, neededIn);
}

function nearestFixture(plan: Floorplan, item: Furniture): { item: Furniture; gap: number } | null {
  const candidates = plan.furniture
    .filter((other) => other.id !== item.id && other.roomId === item.roomId)
    .map((other) => ({ item: other, gap: polygonGap([item.position], furniturePolygon(other)) }))
    .sort((first, second) => first.gap - second.gap);

  return candidates[0] ?? null;
}

function nearestWallDistanceIn(plan: Floorplan, room: Room, point: { x: number; y: number }): number {
  const walls = roomWalls(plan, room);
  if (walls.length === 0) {
    return Infinity;
  }

  return Math.min(...walls.map((wall) => pointToSegmentDistance(point, wall.start, wall.end)));
}

function sharesRoom(a: Opening, b: Opening): boolean {
  return a.connects.some((id) => id !== 'EXTERIOR' && b.connects.includes(id));
}

function describeConnects(plan: Floorplan, opening: Opening): string {
  return joinList(opening.connects.map((id) => (id === 'EXTERIOR' ? 'the exterior' : roomName(plan, id))));
}

function roomName(plan: Floorplan, roomId: string): string {
  return plan.rooms.find((room) => room.id === roomId)?.name ?? roomId;
}

function listNames(items: Furniture[]): string {
  return joinList(items.map((item) => `the ${item.catalogId}`));
}

function joinList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

function pairwise<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

function formatSqFt(value: number): string {
  return `${Math.round(value)} sq ft`;
}

function formatIn(value: number): string {
  return `${Math.round(value)}in`;
}
