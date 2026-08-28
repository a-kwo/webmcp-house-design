import type { Floorplan, Point, RoomType, Wall } from './types';

type RectRoomSpec = {
  id: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  d: number;
  wetWalls?: string[];
};

const PLAN_BOUNDS = { minX: 0, minY: 0, maxX: 384, maxY: 300 };

/**
 * Walls sitting on the plan's outer boundary are exterior and carry load; the
 * interior partitions between rooms do not.
 */
function rectWalls(roomId: string, x: number, y: number, w: number, d: number, wetWalls: string[] = []): Wall[] {
  const corners: Record<string, Point> = {
    nw: { x, y },
    ne: { x: x + w, y },
    se: { x: x + w, y: y + d },
    sw: { x, y: y + d },
  };

  const onBoundary = {
    N: y === PLAN_BOUNDS.minY,
    S: y + d === PLAN_BOUNDS.maxY,
    W: x === PLAN_BOUNDS.minX,
    E: x + w === PLAN_BOUNDS.maxX,
  };

  const edges: { side: 'N' | 'E' | 'S' | 'W'; start: Point; end: Point }[] = [
    { side: 'N', start: corners.nw, end: corners.ne },
    { side: 'E', start: corners.ne, end: corners.se },
    { side: 'S', start: corners.se, end: corners.sw },
    { side: 'W', start: corners.sw, end: corners.nw },
  ];

  return edges.map(({ side, start, end }) => ({
    id: `${roomId}-${side}`,
    start,
    end,
    thickness: onBoundary[side] ? 6 : 5,
    exterior: onBoundary[side],
    loadBearing: onBoundary[side],
    wet: wetWalls.includes(side),
  }));
}

const rooms: RectRoomSpec[] = [
  { id: 'living', name: 'Living Room', type: 'living', x: 0, y: 0, w: 216, d: 180 },
  { id: 'kitchen', name: 'Kitchen', type: 'kitchen', x: 216, y: 0, w: 168, d: 144, wetWalls: ['E'] },
  { id: 'hall', name: 'Hallway', type: 'hallway', x: 216, y: 144, w: 42, d: 156 },
  { id: 'bed1', name: 'Bedroom 1', type: 'bedroom', x: 0, y: 180, w: 132, d: 120 },
  { id: 'bath', name: 'Bathroom', type: 'bathroom', x: 132, y: 180, w: 84, d: 120, wetWalls: ['E'] },
  { id: 'bed2', name: 'Bedroom 2', type: 'bedroom', x: 258, y: 144, w: 126, d: 156 },
];

export const sampleFloorplan: Floorplan = {
  units: 'in',
  ceilingHeight: 96,
  walls: rooms.flatMap((room) => rectWalls(room.id, room.x, room.y, room.w, room.d, room.wetWalls)),
  rooms: rooms.map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    wallIds: [`${room.id}-N`, `${room.id}-E`, `${room.id}-S`, `${room.id}-W`],
  })),
  openings: [
    { id: 'entry', wallId: 'living-W', kind: 'door', offset: 54, width: 36, height: 80, sillHeight: 0, swing: 'in-left', connects: ['living', 'EXTERIOR'] },
    { id: 'living-kitchen', wallId: 'living-E', kind: 'archway', offset: 48, width: 60, height: 84, sillHeight: 0, swing: 'none', connects: ['living', 'kitchen'] },
    { id: 'living-bed1', wallId: 'bed1-N', kind: 'door', offset: 48, width: 32, height: 80, sillHeight: 0, swing: 'in-right', connects: ['living', 'bed1'] },
    { id: 'kitchen-hall', wallId: 'hall-N', kind: 'door', offset: 6, width: 32, height: 80, sillHeight: 0, swing: 'in-left', connects: ['kitchen', 'hall'] },
    { id: 'hall-bath', wallId: 'bath-E', kind: 'door', offset: 42, width: 30, height: 80, sillHeight: 0, swing: 'in-left', connects: ['hall', 'bath'] },
    { id: 'hall-bed2', wallId: 'bed2-W', kind: 'door', offset: 48, width: 32, height: 80, sillHeight: 0, swing: 'in-right', connects: ['hall', 'bed2'] },
    { id: 'bed1-window', wallId: 'bed1-W', kind: 'window', offset: 36, width: 36, height: 48, sillHeight: 30, connects: ['bed1', 'EXTERIOR'] },
    { id: 'bed2-window', wallId: 'bed2-E', kind: 'window', offset: 54, width: 36, height: 48, sillHeight: 30, connects: ['bed2', 'EXTERIOR'] },
  ],
  furniture: [
    { id: 'sofa-1', catalogId: 'sofa', roomId: 'living', position: { x: 72, y: 72 }, rotation: 0, footprint: { w: 84, d: 36 }, clearanceFront: 24 },
    { id: 'island-1', catalogId: 'kitchen-island', roomId: 'kitchen', position: { x: 288, y: 78 }, rotation: 0, footprint: { w: 72, d: 36 }, clearanceFront: 42 },
    { id: 'range-1', catalogId: 'range', roomId: 'kitchen', position: { x: 360, y: 54 }, rotation: 90, footprint: { w: 30, d: 30 }, clearanceFront: 40 },
    { id: 'toilet-1', catalogId: 'toilet', roomId: 'bath', position: { x: 192, y: 230 }, rotation: 90, footprint: { w: 18, d: 28 }, clearanceFront: 21 },
    { id: 'sink-1', catalogId: 'sink', roomId: 'bath', position: { x: 192, y: 274 }, rotation: 90, footprint: { w: 24, d: 20 } },
    { id: 'bed-1', catalogId: 'queen-bed', roomId: 'bed1', position: { x: 60, y: 240 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
    { id: 'bed-2', catalogId: 'queen-bed', roomId: 'bed2', position: { x: 318, y: 220 }, rotation: 0, footprint: { w: 60, d: 80 }, clearanceFront: 24 },
  ],
};
