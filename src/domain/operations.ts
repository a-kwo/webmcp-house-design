import {
  boundingBox,
  distance,
  roomPolygon,
  samePoint,
  snapToGrid,
} from './geometry';
import type { Box } from './geometry';
import type { Floorplan, Furniture, Opening, Point, Room, RoomType, Wall } from './types';

export type Direction = 'north' | 'south' | 'east' | 'west';

export type OperationResult =
  | { ok: true; plan: Floorplan; changed: string[]; summary: string }
  | { ok: false; error: string };

const GRID_IN = 6;
const MIN_ROOM_DIMENSION_IN = 24;
// Operations reject only geometrically incoherent results. Whether a layout is
// *good* is the constraint engine's call, so a move that merely creates a
// violation must still succeed and be reported by validate().
const MIN_VIABLE_SPAN_IN = 6;
const WALL_AGAINST_CLEARANCE_IN = 2;

function clone(plan: Floorplan): Floorplan {
  return JSON.parse(JSON.stringify(plan)) as Floorplan;
}

function fail(error: string): OperationResult {
  return { ok: false, error };
}

function isVertical(wall: Wall): boolean {
  return Math.abs(wall.start.x - wall.end.x) < 0.001;
}

function isHorizontal(wall: Wall): boolean {
  return Math.abs(wall.start.y - wall.end.y) < 0.001;
}

function directionOffset(direction: Direction, magnitude: number): Point {
  switch (direction) {
    case 'north':
      return { x: 0, y: -magnitude };
    case 'south':
      return { x: 0, y: magnitude };
    case 'east':
      return { x: magnitude, y: 0 };
    default:
      return { x: -magnitude, y: 0 };
  }
}

function roomBox(plan: Floorplan, room: Room): Box {
  return boundingBox(roomPolygon(plan, room));
}

function uniqueId(plan: Floorplan, base: string): string {
  const taken = new Set<string>([
    ...plan.walls.map((wall) => wall.id),
    ...plan.rooms.map((room) => room.id),
    ...plan.openings.map((opening) => opening.id),
    ...plan.furniture.map((item) => item.id),
  ]);

  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

/**
 * Walls lying on the same line as `wall` whose spans genuinely overlap, which
 * is how a partition drawn once per room is recognised as one physical wall.
 * Segments meeting end to end at a single point are not included.
 */
function coincidentWalls(plan: Floorplan, wall: Wall): Wall[] {
  const vertical = isVertical(wall);

  return plan.walls.filter((candidate) => {
    if (candidate.id === wall.id) {
      return true;
    }

    if (vertical) {
      if (!isVertical(candidate) || Math.abs(candidate.start.x - wall.start.x) > 0.001) {
        return false;
      }
      const a = [Math.min(wall.start.y, wall.end.y), Math.max(wall.start.y, wall.end.y)];
      const b = [Math.min(candidate.start.y, candidate.end.y), Math.max(candidate.start.y, candidate.end.y)];
      return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.001;
    }

    if (!isHorizontal(candidate) || Math.abs(candidate.start.y - wall.start.y) > 0.001) {
      return false;
    }
    const a = [Math.min(wall.start.x, wall.end.x), Math.max(wall.start.x, wall.end.x)];
    const b = [Math.min(candidate.start.x, candidate.end.x), Math.max(candidate.start.x, candidate.end.x)];
    return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.001;
  });
}

/**
 * Rooms are rectangles, so moving a wall means setting one edge of every room
 * that shares it. Every endpoint of that room sitting on the old edge moves to
 * the new coordinate, which keeps the rectangle closed.
 */
function setRoomEdge(plan: Floorplan, room: Room, axis: 'x' | 'y', from: number, to: number): void {
  const wallIds = new Set(room.wallIds);

  for (const wall of plan.walls.filter((candidate) => wallIds.has(candidate.id))) {
    for (const endpoint of [wall.start, wall.end]) {
      if (Math.abs(endpoint[axis] - from) < 0.001) {
        endpoint[axis] = to;
      }
    }
  }
}

export function moveWall(
  plan: Floorplan,
  input: { wallId: string; distanceIn: number; direction: Direction },
): OperationResult {
  const source = plan.walls.find((wall) => wall.id === input.wallId);
  if (!source) {
    return fail(`No wall with id "${input.wallId}". Call get_layout to list the current wall ids.`);
  }

  if (!isVertical(source) && !isHorizontal(source)) {
    return fail(`Wall ${source.id} is not axis-aligned; only horizontal and vertical walls can be moved.`);
  }

  const vertical = isVertical(source);
  const wantsHorizontalMove = input.direction === 'east' || input.direction === 'west';

  if (vertical !== wantsHorizontalMove) {
    const valid = vertical ? 'east or west' : 'north or south';
    return fail(`Wall ${source.id} runs ${vertical ? 'north-south' : 'east-west'}, so it can only move ${valid}.`);
  }

  const distance = snapToGrid(Math.abs(input.distanceIn), GRID_IN);
  if (distance === 0) {
    return fail(`A move of ${input.distanceIn}in snaps to 0 on the ${GRID_IN}in grid; use at least ${GRID_IN / 2 + 1}in.`);
  }

  const axis: 'x' | 'y' = vertical ? 'x' : 'y';
  const offset = directionOffset(input.direction, distance);
  const from = source.start[axis];
  const to = from + offset[axis];

  const next = clone(plan);
  const group = coincidentWalls(next, next.walls.find((wall) => wall.id === source.id)!);
  const groupIds = new Set(group.map((wall) => wall.id));
  const affected = next.rooms.filter((room) => room.wallIds.some((id) => groupIds.has(id)));

  // Reject before mutating anything if the move would collapse a room.
  for (const room of affected) {
    const box = roomBox(next, room);
    const low = axis === 'x' ? box.minX : box.minY;
    const high = axis === 'x' ? box.maxX : box.maxY;
    const movingLowEdge = Math.abs(low - from) < 0.001;
    const span = movingLowEdge ? high - to : to - low;

    if (span < MIN_VIABLE_SPAN_IN) {
      return fail(
        `Moving ${source.id} ${distance}in ${input.direction} would collapse ${room.name} to ${Math.round(span)}in across. Use a smaller distance.`,
      );
    }
  }

  for (const room of affected) {
    setRoomEdge(next, room, axis, from, to);
  }

  const names = affected.map((room) => room.name);
  return {
    ok: true,
    plan: next,
    changed: [...groupIds, ...affected.map((room) => room.id)],
    summary: `Moved ${source.id} ${distance}in ${input.direction}, resizing ${names.join(' and ')}.`,
  };
}

export function resizeRoom(
  plan: Floorplan,
  input: { roomId: string; widthIn?: number; depthIn?: number },
): OperationResult {
  const room = plan.rooms.find((candidate) => candidate.id === input.roomId);
  if (!room) {
    return fail(`No room with id "${input.roomId}". Call get_layout to list the current room ids.`);
  }

  if (input.widthIn === undefined && input.depthIn === undefined) {
    return fail(`resize_room needs a widthIn or a depthIn for ${room.name}.`);
  }

  let working = plan;
  const changed = new Set<string>();
  const parts: string[] = [];

  for (const [axis, target] of [
    ['x', input.widthIn],
    ['y', input.depthIn],
  ] as const) {
    if (target === undefined) {
      continue;
    }

    const current = working.rooms.find((candidate) => candidate.id === room.id)!;
    const box = roomBox(working, current);
    const span = axis === 'x' ? box.maxX - box.minX : box.maxY - box.minY;
    const delta = snapToGrid(target, GRID_IN) - span;

    if (Math.abs(delta) < 0.001) {
      continue;
    }

    // Move the far edge so the room's origin corner stays put.
    const edgeCoord = axis === 'x' ? box.maxX : box.maxY;
    const wall = working.walls.find((candidate) => {
      if (!current.wallIds.includes(candidate.id)) {
        return false;
      }
      const aligned = axis === 'x' ? isVertical(candidate) : isHorizontal(candidate);
      return aligned && Math.abs(candidate.start[axis] - edgeCoord) < 0.001;
    });

    if (!wall) {
      return fail(`Could not find ${room.name}'s ${axis === 'x' ? 'east' : 'south'} wall to resize against.`);
    }

    const direction: Direction = axis === 'x' ? (delta > 0 ? 'east' : 'west') : delta > 0 ? 'south' : 'north';
    const result = moveWall(working, { wallId: wall.id, distanceIn: Math.abs(delta), direction });
    if (!result.ok) {
      return result;
    }

    working = result.plan;
    for (const id of result.changed) {
      changed.add(id);
    }
    parts.push(`${axis === 'x' ? 'width' : 'depth'} to ${snapToGrid(target, GRID_IN)}in`);
  }

  if (parts.length === 0) {
    return fail(`${room.name} is already at the requested size once snapped to the ${GRID_IN}in grid.`);
  }

  return {
    ok: true,
    plan: working,
    changed: [...changed],
    summary: `Resized ${room.name}: ${parts.join(' and ')}.`,
  };
}

export function addOpening(
  plan: Floorplan,
  input: {
    wallId: string;
    kind: Opening['kind'];
    offsetIn: number;
    widthIn: number;
    heightIn?: number;
    sillHeightIn?: number;
    swing?: Opening['swing'];
  },
): OperationResult {
  const wall = plan.walls.find((candidate) => candidate.id === input.wallId);
  if (!wall) {
    return fail(`No wall with id "${input.wallId}". Call get_layout to list the current wall ids.`);
  }

  const span = distance(wall.start, wall.end);
  const offset = snapToGrid(input.offsetIn, GRID_IN);
  const width = snapToGrid(input.widthIn, GRID_IN);

  if (width <= 0) {
    return fail(`An opening needs a positive width; ${input.widthIn}in snaps to ${width}in.`);
  }

  if (offset < 0 || offset + width > span) {
    return fail(
      `A ${width}in opening at offset ${offset}in does not fit on ${wall.id}, which is ${Math.round(span)}in long. Use an offset between 0 and ${Math.round(span - width)}in.`,
    );
  }

  const rooms = plan.rooms.filter((room) => room.wallIds.includes(wall.id));
  const connects: [string, string] = wall.exterior
    ? [rooms[0]?.id ?? 'EXTERIOR', 'EXTERIOR']
    : [rooms[0]?.id ?? 'EXTERIOR', rooms[1]?.id ?? 'EXTERIOR'];

  if (connects[0] === 'EXTERIOR') {
    return fail(`Wall ${wall.id} does not belong to any room, so an opening in it would connect nothing.`);
  }

  const next = clone(plan);
  const id = uniqueId(next, `${input.kind}-${wall.id}`);

  next.openings.push({
    id,
    wallId: wall.id,
    kind: input.kind,
    offset,
    width,
    height: input.heightIn ?? (input.kind === 'window' ? 48 : 80),
    sillHeight: input.sillHeightIn ?? (input.kind === 'window' ? 30 : 0),
    swing: input.swing ?? (input.kind === 'door' ? 'in-left' : 'none'),
    connects,
  });

  return {
    ok: true,
    plan: next,
    changed: [id, wall.id],
    summary: `Added a ${width}in ${input.kind} (${id}) to ${wall.id}.`,
  };
}

/** Places against the longest wall, backed up to it and facing into the room. */
function autoPlacement(plan: Floorplan, room: Room, footprint: { w: number; d: number }): { position: Point; rotation: number } {
  const box = roomBox(plan, room);
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const width = box.maxX - box.minX;

  // Back against the north wall in a wide room, the west wall in a tall one.
  if (width >= box.maxY - box.minY) {
    return {
      position: { x: centre.x, y: box.minY + footprint.d / 2 + WALL_AGAINST_CLEARANCE_IN },
      rotation: 0,
    };
  }

  return {
    position: { x: box.minX + footprint.d / 2 + WALL_AGAINST_CLEARANCE_IN, y: centre.y },
    rotation: 270,
  };
}

export function placeFurniture(
  plan: Floorplan,
  input: {
    roomId: string;
    catalogId: string;
    footprint: { w: number; d: number };
    position?: Point;
    rotation?: number;
    clearanceFrontIn?: number;
  },
): OperationResult {
  const room = plan.rooms.find((candidate) => candidate.id === input.roomId);
  if (!room) {
    return fail(`No room with id "${input.roomId}". Call get_layout to list the current room ids.`);
  }

  const next = clone(plan);
  const target = next.rooms.find((candidate) => candidate.id === room.id)!;
  const auto = autoPlacement(next, target, input.footprint);
  const position = input.position
    ? { x: snapToGrid(input.position.x, GRID_IN), y: snapToGrid(input.position.y, GRID_IN) }
    : auto.position;

  const box = roomBox(next, target);
  const inside = position.x >= box.minX && position.x <= box.maxX && position.y >= box.minY && position.y <= box.maxY;
  if (!inside) {
    return fail(
      `Position (${position.x}, ${position.y}) is outside ${room.name}, which spans x ${box.minX}-${box.maxX} and y ${box.minY}-${box.maxY}. Omit position to auto-place against a wall.`,
    );
  }

  const id = uniqueId(next, `${input.catalogId}-${room.id}`);
  const item: Furniture = {
    id,
    catalogId: input.catalogId,
    roomId: room.id,
    position,
    rotation: input.rotation ?? (input.position ? 0 : auto.rotation),
    footprint: input.footprint,
    ...(input.clearanceFrontIn === undefined ? {} : { clearanceFront: input.clearanceFrontIn }),
  };

  next.furniture.push(item);

  return {
    ok: true,
    plan: next,
    changed: [id, room.id],
    summary: input.position
      ? `Placed ${input.catalogId} (${id}) in ${room.name}.`
      : `Placed ${input.catalogId} (${id}) against a wall in ${room.name}.`,
  };
}

export function removeElement(plan: Floorplan, elementId: string): OperationResult {
  const wall = plan.walls.find((candidate) => candidate.id === elementId);
  if (wall) {
    if (wall.exterior || wall.loadBearing) {
      const label = wall.exterior ? 'exterior' : 'load-bearing';
      return fail(
        `Wall ${wall.id} is ${label}; use add_opening to create a passage through it instead of removing it.`,
      );
    }

    const next = clone(plan);
    const droppedOpenings = next.openings.filter((opening) => opening.wallId === wall.id).map((opening) => opening.id);

    next.walls = next.walls.filter((candidate) => candidate.id !== wall.id);
    next.openings = next.openings.filter((opening) => opening.wallId !== wall.id);
    next.rooms = next.rooms.map((room) => ({ ...room, wallIds: room.wallIds.filter((id) => id !== wall.id) }));

    return {
      ok: true,
      plan: next,
      changed: [wall.id, ...droppedOpenings],
      summary: droppedOpenings.length > 0
        ? `Removed wall ${wall.id} and the ${droppedOpenings.length} opening(s) it carried.`
        : `Removed wall ${wall.id}.`,
    };
  }

  const opening = plan.openings.find((candidate) => candidate.id === elementId);
  if (opening) {
    const next = clone(plan);
    next.openings = next.openings.filter((candidate) => candidate.id !== opening.id);
    return { ok: true, plan: next, changed: [opening.id], summary: `Removed ${opening.kind} ${opening.id}.` };
  }

  const item = plan.furniture.find((candidate) => candidate.id === elementId);
  if (item) {
    const next = clone(plan);
    next.furniture = next.furniture.filter((candidate) => candidate.id !== item.id);
    return { ok: true, plan: next, changed: [item.id], summary: `Removed ${item.catalogId} ${item.id}.` };
  }

  const room = plan.rooms.find((candidate) => candidate.id === elementId);
  if (room) {
    const next = clone(plan);
    const others = next.rooms.filter((candidate) => candidate.id !== room.id);
    const stillUsed = new Set(others.flatMap((candidate) => candidate.wallIds));
    const droppedWalls = room.wallIds.filter((id) => !stillUsed.has(id));

    next.rooms = others;
    next.walls = next.walls.filter((candidate) => !droppedWalls.includes(candidate.id));
    next.openings = next.openings.filter((candidate) => {
      return !droppedWalls.includes(candidate.wallId) && !candidate.connects.includes(room.id);
    });
    next.furniture = next.furniture.filter((candidate) => candidate.roomId !== room.id);

    return {
      ok: true,
      plan: next,
      changed: [room.id, ...droppedWalls],
      summary: `Removed ${room.name} along with its walls, openings, and furniture.`,
    };
  }

  return fail(`No element with id "${elementId}". Call get_layout to list the ids currently in the plan.`);
}

export function addRoom(
  plan: Floorplan,
  input: {
    name: string;
    type: RoomType;
    widthIn: number;
    depthIn: number;
    attachTo?: { roomId: string; side: Direction };
  },
): OperationResult {
  const width = snapToGrid(input.widthIn, GRID_IN);
  const depth = snapToGrid(input.depthIn, GRID_IN);

  if (width < MIN_ROOM_DIMENSION_IN || depth < MIN_ROOM_DIMENSION_IN) {
    return fail(`A room must be at least ${MIN_ROOM_DIMENSION_IN}in on each side; got ${width}in by ${depth}in.`);
  }

  const next = clone(plan);
  const roomId = uniqueId(next, input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room');

  let origin: Point;
  let sharedWall: Wall | undefined;

  if (input.attachTo) {
    const anchor = next.rooms.find((candidate) => candidate.id === input.attachTo!.roomId);
    if (!anchor) {
      return fail(`No room with id "${input.attachTo.roomId}" to attach to. Call get_layout to list the room ids.`);
    }

    const box = roomBox(next, anchor);
    const side = input.attachTo.side;

    origin = {
      north: { x: box.minX, y: box.minY - depth },
      south: { x: box.minX, y: box.maxY },
      east: { x: box.maxX, y: box.minY },
      west: { x: box.minX - width, y: box.minY },
    }[side];

    // Reuse the anchor's wall on that side so the two rooms share one partition.
    const axis: 'x' | 'y' = side === 'east' || side === 'west' ? 'x' : 'y';
    const edge = { north: box.minY, south: box.maxY, east: box.maxX, west: box.minX }[side];

    sharedWall = next.walls.find((candidate) => {
      if (!anchor.wallIds.includes(candidate.id)) {
        return false;
      }
      const aligned = axis === 'x' ? isVertical(candidate) : isHorizontal(candidate);
      return aligned && Math.abs(candidate.start[axis] - edge) < 0.001;
    });
  } else {
    const occupied = next.rooms.flatMap((room) => roomPolygon(next, room));
    const bounds = occupied.length > 0 ? boundingBox(occupied) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    origin = { x: bounds.maxX, y: bounds.minY };
  }

  const corners = {
    nw: { x: origin.x, y: origin.y },
    ne: { x: origin.x + width, y: origin.y },
    se: { x: origin.x + width, y: origin.y + depth },
    sw: { x: origin.x, y: origin.y + depth },
  };

  const edges: { side: 'N' | 'E' | 'S' | 'W'; start: Point; end: Point }[] = [
    { side: 'N', start: corners.nw, end: corners.ne },
    { side: 'E', start: corners.ne, end: corners.se },
    { side: 'S', start: corners.se, end: corners.sw },
    { side: 'W', start: corners.sw, end: corners.nw },
  ];

  const wallIds: string[] = [];
  let reusedWallId: string | undefined;

  for (const edge of edges) {
    // Reference the existing partition only when the two rooms line up exactly;
    // a shorter room abuts the same line but needs its own wall segment.
    if (sharedWall && samePointPair(edge, sharedWall)) {
      wallIds.push(sharedWall.id);
      reusedWallId = sharedWall.id;
      continue;
    }

    const id = uniqueId(next, `${roomId}-${edge.side}`);
    next.walls.push({
      id,
      start: edge.start,
      end: edge.end,
      thickness: 5,
      exterior: false,
      loadBearing: false,
      wet: false,
    });
    wallIds.push(id);
  }

  next.rooms.push({ id: roomId, name: input.name, type: input.type, wallIds });

  return {
    ok: true,
    plan: next,
    changed: [roomId, ...wallIds],
    summary: input.attachTo
      ? `Added ${input.name} (${width}x${depth}in) on the ${input.attachTo.side} side of ${input.attachTo.roomId}${
          reusedWallId
            ? `, sharing wall ${reusedWallId}`
            : ', with its own wall on that side because the two rooms are different lengths'
        }.`
      : `Added ${input.name} (${width}x${depth}in).`,
  };
}

function samePointPair(edge: { start: Point; end: Point }, wall: Wall): boolean {
  return (
    (samePoint(edge.start, wall.start) && samePoint(edge.end, wall.end)) ||
    (samePoint(edge.start, wall.end) && samePoint(edge.end, wall.start))
  );
}
