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
export const DOLLHOUSE_WALL_HEIGHT_IN = 48;
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
  fridge: 66,
  desk: 30,
  // Low-profile real variants: the 6ft-plus versions towered over the 48in
  // dollhouse cut and read as oversized even though the heights were real.
  bookshelf: 54,
  nightstand: 24,
  dresser: 34,
  wardrobe: 72,
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

/**
 * Where a wall-mounted piece lands when a wall is clicked at `at`: pushed off
 * the wall face into the room on `towards`'s side, clamped along the wall so
 * the panel never overhangs an end, and rotated to face into that room.
 *
 * The offset survives the 6in placement snap: it is chosen so the snapped
 * centre still leaves the panel's whole depth inside the room.
 */
export function wallMountPlacement(
  wall: Wall,
  at: { x: number; y: number },
  towards: { x: number; y: number },
  panelWidth: number,
): { position: { x: number; y: number }; rotation: number } {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const along = { x: dx / length, y: dy / length };
  const normal = { x: along.y, y: -along.x };

  // Clamp the click point to where the panel actually fits on the wall.
  const rawT = (at.x - wall.start.x) * along.x + (at.y - wall.start.y) * along.y;
  const t = Math.min(Math.max(rawT, panelWidth / 2 + 2), Math.max(length - panelWidth / 2 - 2, panelWidth / 2 + 2));
  const onWall = { x: wall.start.x + along.x * t, y: wall.start.y + along.y * t };

  const sideDot = (towards.x - onWall.x) * normal.x + (towards.y - onWall.y) * normal.y;
  const side = sideDot >= 0 ? 1 : -1;
  const facing = { x: normal.x * side, y: normal.y * side };
  const offset = wall.thickness / 2 + 4;

  // rotatePoint maps local (0,1) to (-sin, cos), so the rotation that faces
  // `facing` is atan2(-fx, fy).
  const rotation = ((Math.atan2(-facing.x, facing.y) * 180) / Math.PI + 360) % 360;

  return {
    position: { x: onWall.x + facing.x * offset, y: onWall.y + facing.y * offset },
    rotation,
  };
}

/**
 * The rotation that turns a piece's front toward `point`, for the rotate
 * handle: drag the knob anywhere and the piece faces it. Snapped to 5deg so
 * hand-set angles stay tidy without feeling stepped.
 */
export function rotationTowards(centre: { x: number; y: number }, point: { x: number; y: number }, snap = 5): number {
  const fx = point.x - centre.x;
  const fy = point.y - centre.y;
  if (Math.hypot(fx, fy) < 0.001) {
    return 0;
  }

  // rotatePoint maps local (0,1) to (-sin, cos), so facing (fx, fy) means a
  // rotation of atan2(-fx, fy).
  const degrees = ((Math.atan2(-fx, fy) * 180) / Math.PI + 360) % 360;
  return snap > 0 ? Math.round(degrees / snap) * snap % 360 : degrees;
}

/**
 * Street-view walkthrough math, kept pure so the sign conventions -- the part
 * of camera code that always goes wrong -- are testable without a renderer.
 *
 * The eye stands at `position` looking at `target`. Angles follow three.js
 * Spherical: theta = atan2(x, z) about +Y, phi measured down from +Y, so a
 * level gaze has phi = PI/2. Facing -Z, +X is to the viewer's right.
 */

const LOOK_PITCH_MIN = Math.PI * 0.2;
const LOOK_PITCH_MAX = Math.PI * 0.85;

type Gaze = { position: Vec3; target: Vec3 };

function gazeSpherical(gaze: Gaze) {
  const [px, py, pz] = gaze.position;
  const [tx, ty, tz] = gaze.target;
  const x = tx - px;
  const y = ty - py;
  const z = tz - pz;
  const radius = Math.hypot(x, y, z) || 1;
  return { radius, theta: Math.atan2(x, z), phi: Math.acos(Math.min(1, Math.max(-1, y / radius))) };
}

function gazeTarget(gaze: Gaze, radius: number, theta: number, phi: number): Vec3 {
  return [
    gaze.position[0] + radius * Math.sin(phi) * Math.sin(theta),
    gaze.position[1] + radius * Math.cos(phi),
    gaze.position[2] + radius * Math.sin(phi) * Math.cos(theta),
  ];
}

/**
 * Grab-the-panorama look: drag left, the view sweeps right; drag down, it
 * tilts up. Returns the new look target; the eye never moves. Pitch is
 * clamped short of the poles, where the up vector flips.
 */
export function lookDrag(gaze: Gaze, dx: number, dy: number, speed = 0.0032): Vec3 {
  const { radius, theta, phi } = gazeSpherical(gaze);
  const clamped = Math.min(LOOK_PITCH_MAX, Math.max(LOOK_PITCH_MIN, phi - dy * speed));
  return gazeTarget(gaze, radius, theta + dx * speed, clamped);
}

/**
 * One frame of walking: `move` is +1 forward / -1 back, `turn` +1 right / -1
 * left. Movement follows the gaze but stays on the floor plane -- looking at
 * the ceiling must not fly the eye upward -- and eye height never changes.
 */
export function walkStep(
  gaze: Gaze,
  move: number,
  turn: number,
  dt: number,
  speedIn = 130,
  turnSpeed = 1.7,
): Gaze {
  const { radius, theta, phi } = gazeSpherical(gaze);
  const nextTheta = theta - turn * turnSpeed * dt;

  let position = gaze.position;
  if (move !== 0) {
    const aheadX = Math.sin(phi) * Math.sin(nextTheta);
    const aheadZ = Math.sin(phi) * Math.cos(nextTheta);
    const length = Math.hypot(aheadX, aheadZ);
    if (length > 1e-6) {
      const step = (move * speedIn * dt) / length;
      position = [position[0] + aheadX * step, position[1], position[2] + aheadZ * step];
    }
  }

  return {
    position,
    target: gazeTarget({ position, target: gaze.target }, radius, nextTheta, phi),
  };
}

/**
 * One frame of overhead panning: the maps gesture, for the top and iso views.
 * `strafe` is +1 right / -1 left, `advance` +1 screen-up / -1 screen-down.
 * The camera and its target slide together across the floor plane -- height
 * and view angle never change -- and the rate scales with how far the camera
 * sits from its target, so panning feels the same zoomed out or in close.
 */
export function panStep(gaze: Gaze, strafe: number, advance: number, dt: number): Gaze {
  const [px, py, pz] = gaze.position;
  const [tx, ty, tz] = gaze.target;

  let fx = tx - px;
  let fz = tz - pz;
  const flat = Math.hypot(fx, fz);
  if (flat < 1e-6) {
    // Looking straight down; screen-up defaults to plan north.
    fx = 0;
    fz = -1;
  } else {
    fx /= flat;
    fz /= flat;
  }

  const distance = Math.hypot(tx - px, ty - py, tz - pz);
  const step = Math.max(150, distance * 0.5) * dt;
  // Screen-right on the floor is the forward direction turned a quarter right.
  const ox = (fx * advance - fz * strafe) * step;
  const oz = (fz * advance + fx * strafe) * step;

  return { position: [px + ox, py, pz + oz], target: [tx + ox, ty, tz + oz] };
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
