export type Point = { x: number; y: number };

export type Wall = {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  exterior: boolean;
  loadBearing: boolean;
  wet: boolean;
};

export type RoomType =
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'living'
  | 'dining'
  | 'hallway'
  | 'closet'
  | 'utility'
  | 'garage';

export type Room = {
  id: string;
  name: string;
  type: RoomType;
  wallIds: string[];
};

export type Opening = {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'archway';
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  swing?: 'in-left' | 'in-right' | 'out-left' | 'out-right' | 'sliding' | 'none';
  connects: [string, string];
};

export type Furniture = {
  id: string;
  catalogId: string;
  roomId: string;
  position: Point;
  rotation: number;
  footprint: { w: number; d: number };
  clearanceFront?: number;
  /** Tint for the piece's primary surfaces; unset means the default look. */
  color?: string;
};

export type Floorplan = {
  units: 'in';
  ceilingHeight: number;
  walls: Wall[];
  rooms: Room[];
  openings: Opening[];
  furniture: Furniture[];
};

export type Violation = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  elementIds: string[];
  suggestion?: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  type: RoomType;
  areaSqFt: number;
  minDimensionIn: number;
  marginAboveMinimumSqFt: number | null;
  adjacentRoomIds: string[];
};
