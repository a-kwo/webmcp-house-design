import type { Floorplan, Opening, Point, Room, RoomType, Wall } from './types';

type Side = 'N' | 'E' | 'S' | 'W';

type RectRoomSpec = {
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
 * the geometry, so moving a room boundary cannot leave a door pointing at a
 * wall that no longer exists there.
 */
type OpeningSpec = {
  id: string;
  kind: Opening['kind'];
  /** Centre of the opening, on the wall line it sits in. */
  at: Point;
  width: number;
  height?: number;
  sillHeight?: number;
  swing?: Opening['swing'];
};

const PLAN_BOUNDS = { minX: 0, minY: 0, maxX: 384, maxY: 300 };
const EPSILON = 0.001;

const rooms: RectRoomSpec[] = [
  { id: 'living', name: 'Living Room', type: 'living', x: 0, y: 0, w: 216, d: 180 },
  { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 216, y: 0, w: 168, d: 144, wetWalls: ['E'] },
  { id: 'hall', name: 'Hallway', type: 'hallway', x: 216, y: 144, w: 42, d: 156 },
  { id: 'bed1', name: 'Bedroom 1', type: 'bedroom', x: 0, y: 180, w: 132, d: 120 },
  { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 132, y: 180, w: 84, d: 120, wetWalls: ['E'] },
  { id: 'bed2', name: 'Bedroom 2', type: 'bedroom', x: 258, y: 144, w: 126, d: 156 },
];

const openingSpecs: OpeningSpec[] = [
  { id: 'entry', kind: 'door', at: { x: 0, y: 108 }, width: 36, swing: 'in-left' },
  { id: 'living-kitchen', kind: 'archway', at: { x: 216, y: 78 }, width: 60, height: 84, swing: 'none' },
  { id: 'living-bed1', kind: 'door', at: { x: 64, y: 180 }, width: 32, swing: 'in-right' },
  // On the hallway's side wall, not across its end: a door spanning the end
  // wall leaves the hallway unable to narrow at all without the door running
  // off the wall it sits in.
  { id: 'living-hall', kind: 'door', at: { x: 216, y: 162 }, width: 32, swing: 'in-left' },
  { id: 'hall-bath', kind: 'door', at: { x: 216, y: 237 }, width: 30, swing: 'in-left' },
  { id: 'hall-bed2', kind: 'door', at: { x: 258, y: 236 }, width: 32, swing: 'in-right' },
  { id: 'bed1-window', kind: 'window', at: { x: 0, y: 246 }, width: 36 },
  { id: 'bed2-window', kind: 'window', at: { x: 384, y: 216 }, width: 36 },
];

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

function isExterior(axis: 'h' | 'v', coord: number): boolean {
  return axis === 'h'
    ? coord === PLAN_BOUNDS.minY || coord === PLAN_BOUNDS.maxY
    : coord === PLAN_BOUNDS.minX || coord === PLAN_BOUNDS.maxX;
}

/**
 * Cuts every room edge down to the segments that rooms actually share, so one
 * physical partition is one wall referenced by the rooms on both sides of it.
 *
 * Rooms drawn as independent rectangles produce a wall per room per side, which
 * leaves a partition existing twice. Everything downstream then has to remember
 * to look for the twin -- to cut a doorway through both, to say which rooms a
 * wall separates, to work out what an opening connects. Cutting the edges here
 * removes the question instead of answering it repeatedly.
 *
 * Walls run in a consistent direction -- west to east, north to south -- rather
 * than winding around each room, so an offset along a wall means the same thing
 * to both rooms that share it.
 */
function buildWalls(): { walls: Wall[]; wallIdsByRoom: string[][] } {
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

const { walls, wallIdsByRoom } = buildWalls();

const builtRooms: Room[] = rooms.map((room, index) => ({
  id: room.id,
  name: room.name,
  type: room.type,
  wallIds: wallIdsByRoom[index],
}));

/** The wall whose line and span contain the whole opening. */
function wallUnder(spec: OpeningSpec): Wall {
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

function buildOpening(spec: OpeningSpec): Opening {
  const wall = wallUnder(spec);
  const horizontal = Math.abs(wall.start.y - wall.end.y) < EPSILON;
  const centre = horizontal ? spec.at.x - wall.start.x : spec.at.y - wall.start.y;

  // Both sides come from the wall itself, so an opening cannot claim to connect
  // rooms that do not actually meet there.
  const touching = builtRooms.filter((room) => room.wallIds.includes(wall.id));
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

export const sampleFloorplan: Floorplan = {
  units: 'in',
  ceilingHeight: 96,
  walls,
  rooms: builtRooms,
  openings: openingSpecs.map(buildOpening),
  furniture: [
    { id: 'sofa-1', catalogId: 'sofa', roomId: 'living', position: { x: 72, y: 72 }, rotation: 0, footprint: { w: 84, d: 36 }, clearanceFront: 24 },
    { id: 'island-1', catalogId: 'kitchen-island', roomId: 'kitchen', position: { x: 264, y: 78 }, rotation: 0, footprint: { w: 72, d: 36 }, clearanceFront: 42 },
    { id: 'range-1', catalogId: 'range', roomId: 'kitchen', position: { x: 360, y: 54 }, rotation: 90, footprint: { w: 30, d: 30 }, clearanceFront: 40 },
    { id: 'toilet-1', catalogId: 'toilet', roomId: 'bath', position: { x: 192, y: 198 }, rotation: 90, footprint: { w: 18, d: 28 }, clearanceFront: 21 },
    { id: 'sink-1', catalogId: 'sink', roomId: 'bath', position: { x: 192, y: 274 }, rotation: 90, footprint: { w: 24, d: 20 } },
    { id: 'bed-1', catalogId: 'queen-bed', roomId: 'bed1', position: { x: 60, y: 252 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
    { id: 'bed-2', catalogId: 'queen-bed', roomId: 'bed2', position: { x: 324, y: 220 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
  ],
};
