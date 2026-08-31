import {
  GRID_IN,
  boundingBox,
  coincidentWalls,
  distance,
  furniturePolygon,
  openingsOnWall,
  snapUpToGrid,
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

const MIN_ROOM_DIMENSION_IN = 24;
// Operations reject only geometrically incoherent results. Whether a layout is
// *good* is the constraint engine's call, so a move that merely creates a
// violation must still succeed and be reported by validate().
const MIN_VIABLE_SPAN_IN = 6;
const WALL_AGAINST_CLEARANCE_IN = 2;
// Float slack, so a piece parked flush against a wall is not called outside it.
const FIT_TOLERANCE_IN = 0.001;

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

  // A partition is one wall shared by the rooms on both sides, cut into
  // segments where other rooms meet it. Sliding one segment would leave the
  // rooms it borders L-shaped, so the whole line moves: every room with an edge
  // on it, and every wall endpoint sitting on it.
  const affected = next.rooms.filter((room) => {
    const box = roomBox(next, room);
    const low = axis === 'x' ? box.minX : box.minY;
    const high = axis === 'x' ? box.maxX : box.maxY;
    return Math.abs(low - from) < 0.001 || Math.abs(high - from) < 0.001;
  });

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

  const before = new Map(
    next.walls.map((wall) => [wall.id, { dx: wall.end.x - wall.start.x, dy: wall.end.y - wall.start.y }]),
  );

  const moved: string[] = [];
  for (const wall of next.walls) {
    let touched = false;
    for (const endpoint of [wall.start, wall.end]) {
      if (Math.abs(endpoint[axis] - from) < 0.001) {
        endpoint[axis] = to;
        touched = true;
      }
    }
    if (touched) {
      moved.push(wall.id);
    }
  }

  // A wall that another room meets part-way along has been cut there. Dragging
  // the line past that junction pulls the far segment back through its own
  // start, leaving it inside out and overlapping its neighbour. Re-cutting the
  // line to suit would be the thorough answer; refusing is the honest one.
  for (const wall of next.walls) {
    const was = before.get(wall.id);
    if (!was) {
      continue;
    }

    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;

    if (Math.hypot(dx, dy) < 0.001) {
      return fail(
        `Moving ${source.id} ${distance}in ${input.direction} would shrink ${wall.id} to nothing. Use a smaller distance.`,
      );
    }

    if (was.dx * dx + was.dy * dy < 0) {
      return fail(
        `Moving ${source.id} ${distance}in ${input.direction} would drag the line past where ${wall.id} meets it, folding that wall back on itself. Use a smaller distance.`,
      );
    }
  }

  // Walls meeting the line get shorter as it moves, and one of them may be
  // carrying a door. Nothing downstream can represent an opening hanging off
  // the end of its wall, so refuse rather than leave the plan incoherent.
  // (`distance` is the snapped move above, so measure with hypot here.)
  for (const opening of next.openings) {
    const wall = next.walls.find((candidate) => candidate.id === opening.wallId);
    if (!wall) {
      continue;
    }

    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (opening.offset + opening.width > length + 0.001) {
      return fail(
        `Moving ${source.id} ${distance}in ${input.direction} would shorten ${wall.id} to ${Math.round(length)}in, leaving ${opening.id} hanging off the end of it. Move or remove ${opening.id} first, or use a smaller distance.`,
      );
    }
  }

  const names = affected.map((room) => room.name);
  return {
    ok: true,
    plan: next,
    changed: [...moved, ...affected.map((room) => room.id)],
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

/**
 * The room on the far side of a partition, at the span the opening occupies.
 *
 * Rooms drawn as independent rectangles each carry their own copy of a shared
 * partition, so the neighbour is never an owner of `wall` itself -- it owns a
 * coincident wall on the same line. A partition can also run past several
 * rooms, so only the ones overlapping the opening count, and the largest
 * overlap wins when an opening straddles a corner.
 */
function neighbourRoomAcross(plan: Floorplan, wall: Wall, offset: number, width: number): Room | undefined {
  if (!isVertical(wall) && !isHorizontal(wall)) {
    return undefined;
  }

  const axis: 'x' | 'y' = isVertical(wall) ? 'y' : 'x';
  const from = wall.start[axis];
  // Offsets run from wall.start, which is the far end for a wall drawn backwards.
  const direction = Math.sign(wall.end[axis] - from) || 1;
  const low = Math.min(from + direction * offset, from + direction * (offset + width));
  const high = low + width;

  const ownerIds = new Set(plan.rooms.filter((room) => room.wallIds.includes(wall.id)).map((room) => room.id));

  return coincidentWalls(plan, wall)
    .filter((candidate) => candidate.id !== wall.id)
    .map((candidate) => {
      const candidateLow = Math.min(candidate.start[axis], candidate.end[axis]);
      const candidateHigh = Math.max(candidate.start[axis], candidate.end[axis]);
      const room = plan.rooms.find((item) => item.wallIds.includes(candidate.id) && !ownerIds.has(item.id));
      return { room, overlap: Math.min(high, candidateHigh) - Math.max(low, candidateLow) };
    })
    .filter((entry): entry is { room: Room; overlap: number } => Boolean(entry.room) && entry.overlap > 0.001)
    .sort((first, second) => second.overlap - first.overlap)[0]?.room;
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
  const width = snapUpToGrid(input.widthIn, GRID_IN);

  if (width <= 0) {
    return fail(`An opening needs a positive width; ${input.widthIn}in snaps to ${width}in.`);
  }

  if (offset < 0 || offset + width > span) {
    return fail(
      `A ${width}in opening at offset ${offset}in does not fit on ${wall.id}, which is ${Math.round(span)}in long. Use an offset between 0 and ${Math.round(span - width)}in.`,
    );
  }

  // The partition may already be open here through the other room's copy of it.
  const clash = openingsOnWall(plan, wall).find((existing) => {
    return Math.min(existing.to, offset + width) - Math.max(existing.from, offset) > FIT_TOLERANCE_IN;
  });

  if (clash) {
    return fail(
      `A ${width}in opening at offset ${offset}in would overlap ${clash.opening.id}, which already runs from ${Math.round(clash.from)}in to ${Math.round(clash.to)}in along ${wall.id}. Pick an offset clear of it, or remove ${clash.opening.id} first.`,
    );
  }

  const owners = plan.rooms.filter((room) => room.wallIds.includes(wall.id));
  const primary = owners[0];

  if (!primary) {
    return fail(`Wall ${wall.id} does not belong to any room, so an opening in it would connect nothing.`);
  }

  // A wall the two rooms already share names both sides directly; otherwise the
  // far side has to be found on the neighbour's own copy of the partition.
  const across = wall.exterior
    ? 'EXTERIOR'
    : owners[1]?.id ?? neighbourRoomAcross(plan, wall, offset, width)?.id ?? 'EXTERIOR';

  const connects: [string, string] = [primary.id, across];

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
    summary: width === input.widthIn
      ? `Added a ${width}in ${input.kind} (${id}) to ${wall.id}.`
      : `Added a ${width}in ${input.kind} (${id}) to ${wall.id}; ${input.widthIn}in was rounded up to the ${GRID_IN}in grid.`,
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

  const rotation = input.rotation ?? (input.position ? 0 : auto.rotation);
  const corners = furniturePolygon({
    id: 'probe',
    catalogId: input.catalogId,
    roomId: room.id,
    position,
    rotation,
    footprint: input.footprint,
  });

  // The centre being inside says nothing about the piece: a 80in bed centred
  // 6in from the wall still hangs most of itself into the next room.
  const spans = boundingBox(corners);
  const fits =
    spans.minX >= box.minX - FIT_TOLERANCE_IN &&
    spans.maxX <= box.maxX + FIT_TOLERANCE_IN &&
    spans.minY >= box.minY - FIT_TOLERANCE_IN &&
    spans.maxY <= box.maxY + FIT_TOLERANCE_IN;

  if (!fits) {
    return fail(
      `A ${input.footprint.w}x${input.footprint.d}in ${input.catalogId} at (${position.x}, ${position.y}) rotated ${rotation}deg spans x ${Math.round(spans.minX)}-${Math.round(spans.maxX)} and y ${Math.round(spans.minY)}-${Math.round(spans.maxY)}, which runs outside ${room.name} (x ${box.minX}-${box.maxX}, y ${box.minY}-${box.maxY}). Move it further in, rotate it, or use a smaller footprint.`,
    );
  }

  const id = uniqueId(next, `${input.catalogId}-${room.id}`);
  const item: Furniture = {
    id,
    catalogId: input.catalogId,
    roomId: room.id,
    position,
    rotation,
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

/**
 * Moves or turns a piece of furniture already in the plan. The human's drag
 * and the agent's tool call are this same operation, so the two see identical
 * snapping, identical fit rules, and identical errors.
 *
 * The destination room is inferred from where the piece lands, so a drag
 * across a doorway re-homes it rather than failing for having left the room
 * it started in.
 */
export function moveFurniture(
  plan: Floorplan,
  input: { furnitureId: string; position?: Point; rotation?: number },
): OperationResult {
  const item = plan.furniture.find((candidate) => candidate.id === input.furnitureId);
  if (!item) {
    return fail(`No furniture with id "${input.furnitureId}". Call get_layout to list the current furniture ids.`);
  }

  if (input.position === undefined && input.rotation === undefined) {
    return fail(`move_furniture needs a position or a rotation for ${item.catalogId} ${item.id}.`);
  }

  const position = input.position
    ? { x: snapToGrid(input.position.x, GRID_IN), y: snapToGrid(input.position.y, GRID_IN) }
    : { ...item.position };
  const rotation = input.rotation ?? item.rotation;

  const next = clone(plan);
  const room = next.rooms.find((candidate) => {
    const box = roomBox(next, candidate);
    return position.x >= box.minX && position.x <= box.maxX && position.y >= box.minY && position.y <= box.maxY;
  });

  if (!room) {
    return fail(
      `Position (${position.x}, ${position.y}) is outside every room. Call get_layout for the room bounds.`,
    );
  }

  const box = roomBox(next, room);
  const spans = boundingBox(furniturePolygon({ ...item, position, rotation }));
  const fits =
    spans.minX >= box.minX - FIT_TOLERANCE_IN &&
    spans.maxX <= box.maxX + FIT_TOLERANCE_IN &&
    spans.minY >= box.minY - FIT_TOLERANCE_IN &&
    spans.maxY <= box.maxY + FIT_TOLERANCE_IN;

  if (!fits) {
    return fail(
      `The ${item.catalogId} at (${position.x}, ${position.y}) rotated ${rotation}deg spans x ${Math.round(spans.minX)}-${Math.round(spans.maxX)} and y ${Math.round(spans.minY)}-${Math.round(spans.maxY)}, which runs outside ${room.name} (x ${box.minX}-${box.maxX}, y ${box.minY}-${box.maxY}). Keep it further from the walls or rotate it.`,
    );
  }

  const moved = next.furniture.find((candidate) => candidate.id === item.id)!;
  const previousRoom = moved.roomId;
  moved.position = position;
  moved.rotation = rotation;
  moved.roomId = room.id;

  const rehomed = previousRoom !== room.id;
  return {
    ok: true,
    plan: next,
    changed: [item.id, room.id, ...(rehomed ? [previousRoom] : [])],
    summary: rehomed
      ? `Moved ${item.catalogId} ${item.id} into ${room.name}.`
      : `Moved ${item.catalogId} ${item.id} within ${room.name}.`,
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

    // Every wall is part of some room's outline: a partition is the boundary
    // for the rooms on both sides of it. Taking it away leaves them open shapes
    // with no area, so there is no coherent plan on the other side of this.
    // Merging the two rooms would be the useful thing, but the result is
    // L-shaped and rooms are rectangles everywhere else here.
    const between = plan.rooms.filter((room) => room.wallIds.includes(wall.id));
    const names = between.map((room) => room.name).join(' and ');

    return fail(
      between.length > 1
        ? `Wall ${wall.id} separates ${names}; removing it would leave both without an outline. Use add_opening to pass through it, or remove one of the rooms outright.`
        : `Wall ${wall.id} is part of ${names || 'the plan'}'s outline; removing it would leave the room open. Use add_opening to pass through it, or remove the room outright.`,
    );
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

/** Where a wall sits along its own line: the axis it varies on, and its span. */
function wallSpan(wall: Wall): { axis: 'x' | 'y'; coord: number; from: number; to: number } {
  const vertical = isVertical(wall);
  const axis: 'x' | 'y' = vertical ? 'y' : 'x';
  const coord = vertical ? wall.start.x : wall.start.y;
  const a = wall.start[axis];
  const b = wall.end[axis];

  return { axis, coord, from: Math.min(a, b), to: Math.max(a, b) };
}

/**
 * Cuts `wall` in two at `at` inches along it, so a room meeting only part of a
 * wall can share exactly the part it touches instead of drawing its own copy.
 *
 * Both rooms already referencing the wall pick up both halves, and openings
 * past the cut move to the far half with their offsets rebased. An opening
 * straddling the cut has nowhere to go, so the split is refused rather than
 * silently dropping it.
 */
function splitWall(plan: Floorplan, wall: Wall, at: number): OperationResult | string {
  const span = wallSpan(wall);
  const length = span.to - span.from;

  if (at <= 0.001 || at >= length - 0.001) {
    return wall.id;
  }

  const straddling = plan.openings.find((opening) => {
    return opening.wallId === wall.id && opening.offset < at - 0.001 && opening.offset + opening.width > at + 0.001;
  });

  if (straddling) {
    return fail(
      `Splitting ${wall.id} at ${Math.round(at)}in would cut through ${straddling.id}. Line the new room up with the opening, or remove ${straddling.id} first.`,
    );
  }

  const forward = wall.start[span.axis] <= wall.end[span.axis];
  const cutCoord = forward ? span.from + at : span.to - at;
  const point: Point = span.axis === 'y'
    ? { x: span.coord, y: cutCoord }
    : { x: cutCoord, y: span.coord };

  const secondId = uniqueId(plan, `${wall.id}-2`);
  plan.walls.push({ ...wall, id: secondId, start: { ...point }, end: { ...wall.end } });
  wall.end = { ...point };

  for (const room of plan.rooms) {
    if (room.wallIds.includes(wall.id)) {
      room.wallIds.push(secondId);
    }
  }

  for (const opening of plan.openings) {
    if (opening.wallId === wall.id && opening.offset >= at - 0.001) {
      opening.wallId = secondId;
      opening.offset -= at;
    }
  }

  return secondId;
}

/**
 * The walls covering one edge of a new room, splitting and reusing whatever is
 * already on that line so the edge shares a single wall with each neighbour it
 * meets, and adding walls only where nothing stands yet.
 */
function claimEdge(
  plan: Floorplan,
  roomId: string,
  side: 'N' | 'E' | 'S' | 'W',
  edge: { start: Point; end: Point },
): { ok: true; wallIds: string[]; shared: string[] } | { ok: false; error: string } {
  const probe: Wall = { id: '', start: edge.start, end: edge.end, thickness: 5, exterior: false, loadBearing: false, wet: false };
  const want = wallSpan(probe);

  const onLine = () =>
    plan.walls.filter((candidate) => {
      const candidateSpan = wallSpan(candidate);
      return (
        candidateSpan.axis === want.axis &&
        Math.abs(candidateSpan.coord - want.coord) < 0.001 &&
        Math.min(candidateSpan.to, want.to) - Math.max(candidateSpan.from, want.from) > 0.001
      );
    });

  // Cut the neighbours back to this edge's ends before claiming anything.
  for (const cut of [want.from, want.to]) {
    for (const candidate of onLine()) {
      const candidateSpan = wallSpan(candidate);
      if (cut <= candidateSpan.from + 0.001 || cut >= candidateSpan.to - 0.001) {
        continue;
      }

      const forward = candidate.start[candidateSpan.axis] <= candidate.end[candidateSpan.axis];
      const along = forward ? cut - candidateSpan.from : candidateSpan.to - cut;
      const result = splitWall(plan, candidate, along);

      if (typeof result !== 'string') {
        return { ok: false, error: result.ok ? 'unreachable' : result.error };
      }
    }
  }

  const shared = onLine()
    .filter((candidate) => {
      const candidateSpan = wallSpan(candidate);
      return candidateSpan.from >= want.from - 0.001 && candidateSpan.to <= want.to + 0.001;
    })
    .sort((a, b) => wallSpan(a).from - wallSpan(b).from);

  const wallIds: string[] = [];
  let cursor = want.from;

  const addGap = (from: number, to: number) => {
    if (to - from <= 0.001) {
      return;
    }
    const id = uniqueId(plan, `${roomId}-${side}`);
    plan.walls.push({
      id,
      start: want.axis === 'y' ? { x: want.coord, y: from } : { x: from, y: want.coord },
      end: want.axis === 'y' ? { x: want.coord, y: to } : { x: to, y: want.coord },
      thickness: 5,
      exterior: false,
      loadBearing: false,
      wet: false,
    });
    wallIds.push(id);
  };

  for (const candidate of shared) {
    const candidateSpan = wallSpan(candidate);
    addGap(cursor, candidateSpan.from);
    wallIds.push(candidate.id);
    cursor = candidateSpan.to;
  }
  addGap(cursor, want.to);

  return { ok: true, wallIds, shared: shared.map((candidate) => candidate.id) };
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

  if (input.attachTo) {
    const anchor = next.rooms.find((candidate) => candidate.id === input.attachTo!.roomId);
    if (!anchor) {
      return fail(`No room with id "${input.attachTo.roomId}" to attach to. Call get_layout to list the room ids.`);
    }

    const box = roomBox(next, anchor);
    origin = {
      north: { x: box.minX, y: box.minY - depth },
      south: { x: box.minX, y: box.maxY },
      east: { x: box.maxX, y: box.minY },
      west: { x: box.minX - width, y: box.minY },
    }[input.attachTo.side];
  } else {
    const occupied = next.rooms.flatMap((room) => roomPolygon(next, room));
    const bounds = occupied.length > 0 ? boundingBox(occupied) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    origin = { x: bounds.maxX, y: bounds.minY };
  }

  // Attaching to a side says where to start, not that anything is free there:
  // south of the kitchen is the hallway and a bedroom. Dropping a room on top
  // of them leaves walls claimed by three rooms and rooms inside other rooms.
  const footprint = { minX: origin.x, minY: origin.y, maxX: origin.x + width, maxY: origin.y + depth };
  const blocking = next.rooms.filter((room) => {
    const other = roomBox(next, room);
    return (
      footprint.minX < other.maxX - 0.001 &&
      other.minX < footprint.maxX - 0.001 &&
      footprint.minY < other.maxY - 0.001 &&
      other.minY < footprint.maxY - 0.001
    );
  });

  if (blocking.length > 0) {
    const names = blocking.map((room) => room.name).join(' and ');
    return fail(
      `A ${width}x${depth}in room there would overlap ${names}. Attach it to a side with space free, or make it smaller.`,
    );
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
  const shared: string[] = [];

  for (const edge of edges) {
    const claimed = claimEdge(next, roomId, edge.side, edge);
    if (!claimed.ok) {
      return fail(claimed.error);
    }

    wallIds.push(...claimed.wallIds);
    shared.push(...claimed.shared);
  }

  next.rooms.push({ id: roomId, name: input.name, type: input.type, wallIds });

  // A wall with rooms on both sides is not the outside of the building any
  // more. Left flagged exterior it would keep telling add_opening that a door
  // through it reaches the outside, and satisfy bedroom egress for free. It
  // stays load-bearing: it still carries whatever it carried.
  for (const id of shared) {
    const wall = next.walls.find((candidate) => candidate.id === id);
    const between = next.rooms.filter((room) => room.wallIds.includes(id));

    if (wall && wall.exterior && between.length > 1) {
      wall.exterior = false;
    }
  }

  return {
    ok: true,
    plan: next,
    changed: [roomId, ...wallIds],
    summary: input.attachTo
      ? `Added ${input.name} (${width}x${depth}in) on the ${input.attachTo.side} side of ${input.attachTo.roomId}${
          shared.length > 0
            ? `, sharing ${shared.length === 1 ? 'wall' : 'walls'} ${shared.join(', ')}`
            : ', with its own walls'
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
