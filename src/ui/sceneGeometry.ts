import {
  boundingBox,
  openingsOnWall,
  polygonCentroid,
  roomAdjacency,
  roomPolygon,
  samePoint,
} from '../domain/geometry';
import type { Camera } from '../state/floorplanStore';
import type { Floorplan, Furniture, Room, Wall } from '../domain/types';

/**
 * Plan space is 2D inches with +y running south (down the page). World space is
 * three.js Y-up, so a plan point (x, y) becomes (x, height, y): plan +y maps to
 * world +z, and the floor sits at y = 0.
 *
 * That mapping flips handedness, which is why every rotation below is negated
 * on its way from plan degrees to a world rotation about Y.
 */

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Height the walls are cut to in the overhead views, so you can see in. */
export const DOLLHOUSE_WALL_HEIGHT_IN = 42;
/** Strip of wall left above an opening so the panel stays simply connected. */
const LINTEL_IN = 2;
/** Keeps a hole off the panel edge, where a coincident vertex breaks meshing. */
const EDGE_EPSILON_IN = 0.01;

const EYE_HEIGHT_IN = 60;
const FIRST_PERSON_FOCUS_IN = 60;
/** How far the eye stops short of the wall it backs up against. */
const BACK_WALL_CLEARANCE_IN = 12;

export type Vec3 = [number, number, number];
export type Rect = { x: number; y: number; w: number; h: number };
export type Hole = Rect & { openingId: string };

export type Placement = { position: Vec3; rotationY: number };

export type CameraPose = { position: Vec3; target: Vec3 };

export const FURNITURE_HEIGHT_IN: Record<string, number> = {
  'queen-bed': 24,
  sofa: 32,
  chair: 32,
  toilet: 30,
  sink: 34,
  vanity: 34,
  shower: 78,
  tub: 22,
  'kitchen-island': 36,
  range: 36,
  dishwasher: 34,
  table: 30,
  'tv-stand': 44,
  fridge: 70,
  desk: 30,
  bookshelf: 72,
  nightstand: 24,
  dresser: 34,
  wardrobe: 78,
  washer: 38,
  counter: 36,
  // Mounted panel: its model hangs the screen high on the wall, so the height
  // is the top of the panel, not a box sitting on the floor.
  'tv-wall': 74,
};

const DEFAULT_FURNITURE_HEIGHT_IN = 30;

export function furnitureHeight(catalogId: string): number {
  return FURNITURE_HEIGHT_IN[catalogId] ?? DEFAULT_FURNITURE_HEIGHT_IN;
}

/**
 * Where a wall's extruded panel sits. The panel is built in its own frame --
 * local x running from wall.start toward wall.end, local y up, extruded along
 * local z -- so the group only has to carry the start point and one Y rotation.
 */
export function wallPlacement(wall: Wall): Placement & { length: number } {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;

  return {
    position: [wall.start.x, 0, wall.start.y],
    rotationY: -Math.atan2(dy, dx),
    length: Math.hypot(dx, dy),
  };
}

/**
 * The wall panel as a rectangle with rectangular holes, in the wall's local
 * frame.
 *
 * Holes come from every wall coincident with this one, not just the one the
 * opening is recorded against: rooms each draw their own copy of a shared
 * partition, so a door cut only into its own leaf would be bricked up by the
 * neighbour's copy standing in the same place.
 *
 * Holes are inset from the panel edges and capped below a lintel: a hole
 * touching two opposite edges would split the outline in two and fail to mesh.
 * Openings entirely above the cut in the dollhouse views drop out.
 */
export function wallPanelRects(
  plan: Floorplan,
  wall: Wall,
  wallHeightIn: number,
): { outline: Rect; holes: Hole[] } {
  const { length } = wallPlacement(wall);
  const ceiling = Math.max(wallHeightIn, LINTEL_IN + EDGE_EPSILON_IN * 2);
  const maxTop = ceiling - LINTEL_IN;

  const holes = openingsOnWall(plan, wall)
    .flatMap(({ opening, from, to }) => {
      const left = Math.max(from, EDGE_EPSILON_IN);
      const right = Math.min(to, length - EDGE_EPSILON_IN);
      const bottom = Math.max(opening.sillHeight, EDGE_EPSILON_IN);
      const top = Math.min(opening.sillHeight + opening.height, maxTop);

      if (right - left <= EDGE_EPSILON_IN || top - bottom <= EDGE_EPSILON_IN) {
        return [];
      }

      return [{ openingId: opening.id, x: left, y: bottom, w: right - left, h: top - bottom }];
    });

  return { outline: { x: 0, y: 0, w: length, h: ceiling }, holes };
}

/** The hole an opening leaves, as a world-space pane to render and click. */
export function openingPlacement(
  wall: Wall,
  hole: Rect,
): Placement & { width: number; height: number } {
  const placement = wallPlacement(wall);
  const centre = hole.x + hole.w / 2;
  const unit = placement.length === 0 ? 0 : centre / placement.length;

  return {
    position: [
      wall.start.x + (wall.end.x - wall.start.x) * unit,
      hole.y + hole.h / 2,
      wall.start.y + (wall.end.y - wall.start.y) * unit,
    ],
    rotationY: placement.rotationY,
    width: hole.w,
    height: hole.h,
  };
}

/**
 * The walls a variant would actually move, which is all the ghost overlay needs
 * to draw. Ghosting a whole alternative plan on top of the current one buries
 * the proposal in geometry that did not change.
 */
export function changedWalls(current: Floorplan, variant: Floorplan): Wall[] {
  const before = new Map(current.walls.map((wall) => [wall.id, wall]));

  return variant.walls.filter((wall) => {
    const previous = before.get(wall.id);
    if (!previous) {
      return true;
    }

    return !samePoint(previous.start, wall.start) || !samePoint(previous.end, wall.end);
  });
}

/**
 * The walls a variant actually relocates: the proposal itself, as opposed to
 * the perpendicular walls that merely got longer or shorter because of it.
 *
 * Moving one partition changes the endpoints of every wall meeting it, and
 * ghosting all of them buries the proposal -- worse, the ones on the near edge
 * of the plan sit between the camera and everything else and swamp the frame.
 * A wall counts as relocated when its old start no longer lies on its new line.
 * Falls back to every changed wall when a variant only resizes.
 */
export function proposedWalls(current: Floorplan, variant: Floorplan): Wall[] {
  const before = new Map(current.walls.map((wall) => [wall.id, wall]));

  const relocated = variant.walls.filter((wall) => {
    const previous = before.get(wall.id);
    if (!previous) {
      return true;
    }

    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return false;
    }

    const offLine =
      Math.abs((previous.start.x - wall.start.x) * dy - (previous.start.y - wall.start.y) * dx) / length;

    return offLine > 0.001;
  });

  return relocated.length > 0 ? relocated : changedWalls(current, variant);
}

export function furniturePlacement(item: Furniture): Placement & { size: Vec3 } {
  const height = furnitureHeight(item.catalogId);

  return {
    position: [item.position.x, height / 2, item.position.y],
    rotationY: -item.rotation * DEGREES_TO_RADIANS,
    size: [item.footprint.w, height, item.footprint.d],
  };
}

/** The plan's extent in world space, for fitting a shadow camera to it. */
export function planBounds(plan: Floorplan) {
  const points = plan.rooms.flatMap((room) => roomPolygon(plan, room));

  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 120, maxY: 120 };
  }

  return boundingBox(points);
}

function roomCentre(plan: Floorplan, room: Room) {
  return polygonCentroid(roomPolygon(plan, room));
}

/**
 * Where the camera goes for each mode. `top` looks straight down, `iso` pulls
 * back to the south-east (plan +x, +y), and `firstPerson` stands at eye height
 * in the target room facing a room it opens onto.
 */
export function cameraPose(plan: Floorplan, camera: Camera): CameraPose {
  const bounds = planBounds(plan);
  const centre: Vec3 = [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minY + bounds.maxY) / 2];
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  if (camera.mode === 'firstPerson') {
    const room = plan.rooms.find((candidate) => candidate.id === camera.targetRoomId) ?? plan.rooms[0];

    if (room) {
      const middle = roomCentre(plan, room);
      const neighbourId = [...(roomAdjacency(plan).get(room.id) ?? [])][0];
      const neighbour = plan.rooms.find((candidate) => candidate.id === neighbourId);
      const toward = neighbour ? roomCentre(plan, neighbour) : { x: centre[0], y: centre[2] };

      const dx = toward.x - middle.x;
      const dy = toward.y - middle.y;
      const length = Math.hypot(dx, dy) || 1;
      const unit = { x: dx / length, y: dy / length };

      // Standing on the centroid puts the near wall a few feet from the lens and
      // fills the frame with it. Back up toward the wall behind instead, so the
      // shot looks across the room at the door being described.
      const box = boundingBox(roomPolygon(plan, room));
      const halfDepth =
        Math.abs(unit.x) >= Math.abs(unit.y)
          ? (box.maxX - box.minX) / 2
          : (box.maxY - box.minY) / 2;
      const back = Math.max(0, halfDepth - BACK_WALL_CLEARANCE_IN);

      const eye = { x: middle.x - unit.x * back, y: middle.y - unit.y * back };

      return {
        position: [eye.x, EYE_HEIGHT_IN, eye.y],
        target: [
          eye.x + unit.x * FIRST_PERSON_FOCUS_IN,
          EYE_HEIGHT_IN,
          eye.y + unit.y * FIRST_PERSON_FOCUS_IN,
        ],
      };
    }
  }

  const focus = plan.rooms.find((candidate) => candidate.id === camera.targetRoomId);
  const target: Vec3 = focus
    ? [roomCentre(plan, focus).x, 0, roomCentre(plan, focus).y]
    : centre;

  if (camera.mode === 'top') {
    // A hair of southward offset keeps the up vector from flipping when the
    // camera sits exactly on the target's vertical axis.
    return { position: [target[0], span * 1.3, target[2] + 0.01], target };
  }

  const pull = span * 0.75;
  return { position: [target[0] + pull, span * 0.85, target[2] + pull], target };
}
