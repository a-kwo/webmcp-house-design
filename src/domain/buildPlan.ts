import type { Floorplan, Furniture, Opening, Point, Room, RoomType, Wall } from './types';

export type Side = 'N' | 'E' | 'S' | 'W';

export type RectRoomSpec = {
  id: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  d: number;
  wetWalls?: Side[];
};

/**
 * An opening placed by where it physically sits, rather than by naming a wall
 * and an offset along it. Which wall carries it and how far along falls out of
 * the geometry, so a template author cannot point a door at a wall that does
 * not exist there.
 */
export type OpeningSpec = {
  id: string;
  kind: Opening['kind'];
  /** Centre of the opening, on the wall line it sits in. */
  at: Point;
  width: number;
  height?: number;
  sillHeight?: number;
  swing?: Opening['swing'];
};

export type PlanSpec = {
  ceilingHeight?: number;
  rooms: RectRoomSpec[];
  openings: OpeningSpec[];
  furniture: Furniture[];
};

const EPSILON = 0.001;

/** One room's edge, before it is cut down to the segments it shares. */
type Edge = { roomIndex: number; side: Side; axis: 'h' | 'v'; coord: number; from: number; to: number };

function edgesOf(room: RectRoomSpec, roomIndex: number): Edge[] {
  return [
    { roomIndex, side: 'N', axis: 'h', coord: room.y, from: room.x, to: room.x + room.w },
    { roomIndex, side: 'S', axis: 'h', coord: room.y + room.d, from: room.x, to: room.x + room.w },
    { roomIndex, side: 'W', axis: 'v', coord: room.x, from: room.y, to: room.y + room.d },
    { roomIndex, side: 'E', axis: 'v', coord: room.x + room.w, from: room.y, to: room.y + room.d },
  ];
}

/**
 * Cuts every room edge down to the segments that rooms actually share, so one
 * physical partition is one wall referenced by the rooms on both sides of it.
 *
 * Rooms drawn as independent rectangles would produce a wall per room per
 * side, leaving a partition existing twice; everything downstream would then
 * have to remember to look for the twin. Cutting the edges here removes the
 * question instead of answering it repeatedly.
 *
 * Walls run in a consistent direction -- west to east, north to south -- so an
 * offset along a wall means the same thing to both rooms that share it. A wall
 * is exterior when it lies on the plan's outer bounding box, which is computed
 * from the rooms rather than declared, so templates of any size work.
 */
function buildWalls(rooms: RectRoomSpec[]): { walls: Wall[]; wallIdsByRoom: string[][] } {
  const bounds = {
    minX: Math.min(...rooms.map((room) => room.x)),
    minY: Math.min(...rooms.map((room) => room.y)),
    maxX: Math.max(...rooms.map((room) => room.x + room.w)),
    maxY: Math.max(...rooms.map((room) => room.y + room.d)),
  };

  const isExterior = (axis: 'h' | 'v', coord: number): boolean =>
    axis === 'h'
      ? coord === bounds.minY || coord === bounds.maxY
      : coord === bounds.minX || coord === bounds.maxX;

  const allEdges = rooms.flatMap((room, index) => edgesOf(room, index));
  const groups = new Map<string, Edge[]>();

  for (const edge of allEdges) {
    const key = `${edge.axis}:${edge.coord}`;
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const walls: Wall[] = [];
  const wallIdsByRoom: string[][] = rooms.map(() => []);
  const taken = new Set<string>();

  for (const [key, edges] of [...groups.entries()].sort()) {
    const [axis, rawCoord] = key.split(':');
    const coord = Number(rawCoord);
    const cuts = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort((a, b) => a - b);

    for (let index = 0; index < cuts.length - 1; index += 1) {
      const from = cuts[index];
      const to = cuts[index + 1];
      const covering = edges.filter((edge) => edge.from <= from + EPSILON && edge.to >= to - EPSILON);

      if (covering.length === 0) {
        continue;
      }

      // Named for the first room that declared it, so the ids stay readable.
      const owner = covering.slice().sort((a, b) => a.roomIndex - b.roomIndex)[0];
      let id = `${rooms[owner.roomIndex].id}-${owner.side}`;
      let suffix = 2;
      while (taken.has(id)) {
        id = `${rooms[owner.roomIndex].id}-${owner.side}-${suffix}`;
        suffix += 1;
      }
      taken.add(id);

      const exterior = isExterior(axis as 'h' | 'v', coord);
      walls.push({
        id,
        start: axis === 'h' ? { x: from, y: coord } : { x: coord, y: from },
        end: axis === 'h' ? { x: to, y: coord } : { x: coord, y: to },
        thickness: exterior ? 6 : 5,
        exterior,
        loadBearing: exterior,
        wet: covering.some((edge) => rooms[edge.roomIndex].wetWalls?.includes(edge.side) ?? false),
      });

      for (const edge of covering) {
        wallIdsByRoom[edge.roomIndex].push(id);
      }
    }
  }

  return { walls, wallIdsByRoom };
}

/** The wall whose line and span contain the whole opening. */
function wallUnder(walls: Wall[], spec: OpeningSpec): Wall {
  const half = spec.width / 2;

  const found = walls.find((wall) => {
    const horizontal = Math.abs(wall.start.y - wall.end.y) < EPSILON;

    if (horizontal) {
      if (Math.abs(wall.start.y - spec.at.y) > EPSILON) {
        return false;
      }
      const low = Math.min(wall.start.x, wall.end.x);
      const high = Math.max(wall.start.x, wall.end.x);
      return spec.at.x - half >= low - EPSILON && spec.at.x + half <= high + EPSILON;
    }

    if (Math.abs(wall.start.x - spec.at.x) > EPSILON) {
      return false;
    }
    const low = Math.min(wall.start.y, wall.end.y);
    const high = Math.max(wall.start.y, wall.end.y);
    return spec.at.y - half >= low - EPSILON && spec.at.y + half <= high + EPSILON;
  });

  if (!found) {
    throw new Error(`Opening "${spec.id}" at (${spec.at.x}, ${spec.at.y}) does not fall on any wall.`);
  }

  return found;
}

function buildOpening(walls: Wall[], rooms: Room[], spec: OpeningSpec): Opening {
  const wall = wallUnder(walls, spec);
  const horizontal = Math.abs(wall.start.y - wall.end.y) < EPSILON;
  const centre = horizontal ? spec.at.x - wall.start.x : spec.at.y - wall.start.y;

  // Both sides come from the wall itself, so an opening cannot claim to connect
  // rooms that do not actually meet there.
  const touching = rooms.filter((room) => room.wallIds.includes(wall.id));
  const connects: [string, string] = wall.exterior
    ? [touching[0].id, 'EXTERIOR']
    : [touching[0].id, touching[1]?.id ?? 'EXTERIOR'];

  return {
    id: spec.id,
    wallId: wall.id,
    kind: spec.kind,
    offset: centre - spec.width / 2,
    width: spec.width,
    height: spec.height ?? (spec.kind === 'window' ? 48 : 80),
    sillHeight: spec.sillHeight ?? (spec.kind === 'window' ? 30 : 0),
    swing: spec.swing ?? (spec.kind === 'door' ? 'in-left' : 'none'),
    connects,
  };
}

export function buildPlan(spec: PlanSpec): Floorplan {
  const { walls, wallIdsByRoom } = buildWalls(spec.rooms);

  const rooms: Room[] = spec.rooms.map((room, index) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    wallIds: wallIdsByRoom[index],
  }));

  return {
    units: 'in',
    ceilingHeight: spec.ceilingHeight ?? 108,
    walls,
    rooms,
    openings: spec.openings.map((opening) => buildOpening(walls, rooms, opening)),
    furniture: spec.furniture,
  };
}
