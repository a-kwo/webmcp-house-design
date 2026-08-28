import type { Floorplan, Furniture, Opening, Point, Room, RoomSummary, Wall } from './types';

const SQ_IN_PER_SQ_FT = 144;
const DEGREES_TO_RADIANS = Math.PI / 180;
const SWING_ARC_SEGMENTS = 8;

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function snapToGrid(value: number, grid = 6): number {
  return Math.round(value / grid) * grid;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return distance(point, start);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

/**
 * Rotation convention: degrees, applied about the element's own position.
 * Local +Y is the front of a piece of furniture, so rotation 0 faces the bottom
 * of the plan (+Y), 90 faces plan-left (-X), 180 faces up, 270 faces plan-right.
 */
export function rotatePoint(point: Point, rotationDeg: number): Point {
  const radians = rotationDeg * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function facingVector(rotationDeg: number): Point {
  return rotatePoint({ x: 0, y: 1 }, rotationDeg);
}

/**
 * Footprint corners in plan space, honouring rotation. When `includeClearance`
 * is set the rectangle is extended forward by `clearanceFront` along the facing
 * direction, so approach space rotates with the piece instead of always
 * pointing at +Y.
 */
export function furniturePolygon(item: Furniture, includeClearance = false): Point[] {
  const halfW = item.footprint.w / 2;
  const halfD = item.footprint.d / 2;
  const front = includeClearance ? item.clearanceFront ?? 0 : 0;

  const local: Point[] = [
    { x: -halfW, y: -halfD },
    { x: halfW, y: -halfD },
    { x: halfW, y: halfD + front },
    { x: -halfW, y: halfD + front },
  ];

  return local.map((corner) => {
    const rotated = rotatePoint(corner, item.rotation);
    return { x: item.position.x + rotated.x, y: item.position.y + rotated.y };
  });
}

/**
 * Quarter-disc swept by a hinged door leaf, or null for sliding/fixed openings.
 * `*-left` hinges on the jamb nearest the wall start, `*-right` on the far jamb.
 *
 * `swingToward` is a point inside the room the door opens into, which is what
 * `in-*` means: the leaf sweeps that room and `out-*` sweeps the other side.
 * Without it the side falls back to the left of the wall's start->end direction.
 * The arc is sampled as a convex polygon so it can be tested against furniture
 * with the same overlap routine.
 */
export function doorSwingPolygon(wall: Wall, door: Opening, swingToward?: Point): Point[] | null {
  if (door.kind !== 'door' || !door.swing || door.swing === 'sliding' || door.swing === 'none') {
    return null;
  }

  const wallLength = distance(wall.start, wall.end);
  if (wallLength === 0) {
    return null;
  }

  const along = {
    x: (wall.end.x - wall.start.x) / wallLength,
    y: (wall.end.y - wall.start.y) / wallLength,
  };
  const normal = { x: along.y, y: -along.x };

  const hingesAtStart = door.swing.endsWith('left');
  const hingeOffset = hingesAtStart ? door.offset : door.offset + door.width;
  const sweep = hingesAtStart ? 1 : -1;

  const hinge = {
    x: wall.start.x + along.x * hingeOffset,
    y: wall.start.y + along.y * hingeOffset,
  };

  let interiorSide = 1;
  if (swingToward) {
    const towardInterior = (swingToward.x - hinge.x) * normal.x + (swingToward.y - hinge.y) * normal.y;
    if (towardInterior !== 0) {
      interiorSide = Math.sign(towardInterior);
    }
  }
  const side = door.swing.startsWith('in') ? interiorSide : -interiorSide;
  const radius = door.width;

  const points: Point[] = [hinge];
  for (let step = 0; step <= SWING_ARC_SEGMENTS; step += 1) {
    const angle = (step / SWING_ARC_SEGMENTS) * (Math.PI / 2);
    const alongComponent = Math.cos(angle) * radius * sweep;
    const normalComponent = Math.sin(angle) * radius * side;

    points.push({
      x: hinge.x + along.x * alongComponent + normal.x * normalComponent,
      y: hinge.y + along.y * alongComponent + normal.y * normalComponent,
    });
  }

  return points;
}

function projectPolygon(points: Point[], axis: Point) {
  const values = points.map((point) => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Separating-axis test. Touching edges do not count as overlapping. */
export function convexPolygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const axis = { x: -(next.y - current.y), y: next.x - current.x };

      if (axis.x === 0 && axis.y === 0) {
        continue;
      }

      const aRange = projectPolygon(a, axis);
      const bRange = projectPolygon(b, axis);

      if (aRange.max <= bRange.min || bRange.max <= aRange.min) {
        return false;
      }
    }
  }

  return true;
}

/** Shortest gap between two convex polygons; 0 when they touch or overlap. */
export function polygonGap(a: Point[], b: Point[]): number {
  if (convexPolygonsOverlap(a, b)) {
    return 0;
  }

  let shortest = Infinity;
  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const point of from) {
      for (let index = 0; index < to.length; index += 1) {
        const start = to[index];
        const end = to[(index + 1) % to.length];
        shortest = Math.min(shortest, pointToSegmentDistance(point, start, end));
      }
    }
  }

  return shortest;
}

export function roomWalls(plan: Floorplan, room: Room): Wall[] {
  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  return room.wallIds.map((id) => wallsById.get(id)).filter((wall): wall is Wall => Boolean(wall));
}

export function roomPolygon(plan: Floorplan, room: Room): Point[] {
  return roomWalls(plan, room).map((wall) => wall.start);
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function polygonAreaSqIn(points: Point[]): number {
  if (points.length < 3) {
    return 0;
  }

  const twiceArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);

  return Math.abs(twiceArea) / 2;
}

export function roomAreaSqFt(plan: Floorplan, room: Room): number {
  return polygonAreaSqIn(roomPolygon(plan, room)) / SQ_IN_PER_SQ_FT;
}

export function boundingBox(points: Point[]): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function roomDimensions(plan: Floorplan, room: Room) {
  const box = boundingBox(roomPolygon(plan, room));
  return {
    width: box.maxX - box.minX,
    depth: box.maxY - box.minY,
    minDimension: Math.min(box.maxX - box.minX, box.maxY - box.minY),
  };
}

export function furnitureBox(item: Furniture, includeClearance = false): Box {
  return boundingBox(furniturePolygon(item, includeClearance));
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function roomAdjacency(plan: Floorplan): Map<string, Set<string>> {
  const adjacency = new Map(plan.rooms.map((room) => [room.id, new Set<string>()]));

  for (const opening of plan.openings) {
    const [a, b] = opening.connects;
    if (a !== 'EXTERIOR' && b !== 'EXTERIOR') {
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    }
  }

  return adjacency;
}

export function computeRoomSummaries(plan: Floorplan): RoomSummary[] {
  const adjacency = roomAdjacency(plan);

  return plan.rooms.map((room) => {
    const areaSqFt = roomAreaSqFt(plan, room);
    const dimensions = roomDimensions(plan, room);
    const minArea = room.type === 'bedroom' ? 70 : null;

    return {
      id: room.id,
      name: room.name,
      type: room.type,
      areaSqFt,
      minDimensionIn: dimensions.minDimension,
      marginAboveMinimumSqFt: minArea === null ? null : areaSqFt - minArea,
      adjacentRoomIds: [...(adjacency.get(room.id) ?? [])],
    };
  });
}
