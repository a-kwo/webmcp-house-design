import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, Environment, Html, Lightformer, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { catalogItem } from '../domain/catalog';
import { moveFurniture, placeFurniture, removeElement, resizeFurniture, updateOpening } from '../domain/operations';
import { boundingBox, facingVector, roomPolygon } from '../domain/geometry';
import { FurnitureModel } from './FurnitureModel';
import { TEXTURE_SPAN_IN, surfaceTextures } from './textures';
import { validate } from '../domain/validate';
import type { Floorplan, Furniture, Opening, Room, RoomType, Wall } from '../domain/types';
import { describeCamera } from '../mcp/tools';
import { useFloorplanStore } from '../state/floorplanStore';
import type { Camera, CameraMode, Variant } from '../state/floorplanStore';
import {
  DOLLHOUSE_WALL_HEIGHT_IN,
  cameraPose,
  lookDrag,
  panStep,
  planBounds,
  proposedWalls,
  furniturePlacement,
  rotationTowards,
  openingPlacement,
  walkStep,
  wallMountPlacement,
  wallPanelRects,
  wallPlacement,
} from './sceneGeometry';

type Vec3Tuple = [number, number, number];

const SELECTED = '#6ea8fe';
const WALL_COLOR = '#cfc9bd';
const GHOST = '#d8a657';
const CEILING_COLOR = '#b3ada1';
const TRIM_COLOR = '#efe9dd';

const FLOOR_COLORS: Record<RoomType, string> = {
  bedroom: '#3a4152',
  bathroom: '#33474a',
  kitchen: '#4a4033',
  living: '#3d4340',
  dining: '#443a44',
  hallway: '#2f3335',
  closet: '#35353a',
  utility: '#333a33',
  garage: '#31312f',
};

/** Wet and work rooms read as tiled; everything else as boarded. */
const TILED: Set<RoomType> = new Set(['bathroom', 'kitchen', 'utility', 'garage']);

/** A faint per-room tint over the shared floor texture, so rooms stay told apart. */
const FLOOR_TINTS: Record<RoomType, string> = {
  bedroom: '#dfe4f2',
  bathroom: '#ffffff',
  kitchen: '#fff3e4',
  living: '#f2ede2',
  dining: '#f4e8ee',
  hallway: '#e8e4da',
  closet: '#e2dfd8',
  utility: '#e4ece4',
  garage: '#dcdcda',
};

function useSelected(id: string): boolean {
  return useFloorplanStore((state) => state.selection.elementIds.includes(id));
}

/**
 * Selecting from the scene is the whole point of the WebMCP demo: it is what
 * `get_selection` reports back to the agent. Propagation stops so the click
 * lands on the nearest thing rather than every mesh behind it. Clicking the
 * selected thing again puts it down -- a toggle needs no second gesture to
 * learn, and empty floor is not always in reach to click instead.
 */
function useSelect(id: string) {
  const select = useFloorplanStore((state) => state.select);
  const clearSelection = useFloorplanStore((state) => state.clearSelection);
  const selected = useSelected(id);

  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (selected) {
      clearSelection();
    } else {
      select([id]);
    }
  };
}

function RoomFloor({
  plan,
  room,
  ceiling,
}: {
  plan: Floorplan;
  room: Room;
  ceiling?: number;
}) {
  const selected = useSelected(room.id);
  const selectRoom = useSelect(room.id);
  const armed = useFloorplanStore((state) => state.armed);
  const armCatalog = useFloorplanStore((state) => state.armCatalog);
  const applyOperation = useFloorplanStore((state) => state.applyOperation);
  const select = useFloorplanStore((state) => state.select);

  // An armed palette item turns the next floor click into a placement -- the
  // click's world point becomes the piece's centre, through the same operation
  // the agent's place_furniture uses, carrying whatever finish was chosen.
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    const item = armed ? catalogItem(armed.catalogId) : undefined;
    if (!item) {
      if (!selectSuppressed()) {
        selectRoom(event);
      }
      return;
    }

    event.stopPropagation();
    const result = applyOperation((current) =>
      placeFurniture(current, {
        roomId: room.id,
        catalogId: item.id,
        footprint: { w: item.w, d: item.d },
        position: { x: event.point.x, y: event.point.z },
        ...(item.clearanceFront === undefined ? {} : { clearanceFrontIn: item.clearanceFront }),
        ...(armed?.color === undefined ? {} : { color: armed.color }),
      }),
    );

    armCatalog(null);
    if (result.ok) {
      select([result.changed[0]]);
    }
  };

  const geometry = useMemo(() => {
    const points = roomPolygon(plan, room);
    if (points.length < 3) {
      return null;
    }

    const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.y)));
    return new THREE.ShapeGeometry(shape);
  }, [plan, room]);

  if (!geometry) {
    return null;
  }

  // Textured when a 2D canvas exists to draw one; the flat colour otherwise.
  const tiled = TILED.has(room.type);
  const surfaces = surfaceTextures();
  const map = selected
    ? null
    : ceiling !== undefined
      ? surfaces.plaster
      : tiled
        ? surfaces.tile
        : surfaces.wood;

  const color = ceiling !== undefined
    ? CEILING_COLOR
    : selected
      ? SELECTED
      : map
        ? FLOOR_TINTS[room.type]
        : FLOOR_COLORS[room.type];

  return (
    <mesh
      geometry={geometry}
      position={[0, ceiling ?? 0, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      onClick={ceiling === undefined ? onClick : undefined}
      receiveShadow
    >
      {/* The shape's normal points down once laid flat, so light both faces.
          Physical material for the finish coat: honed tile and sealed boards
          both carry a clear layer whose tight reflections are most of what
          separates a photo of a floor from a diagram of one. Bump relief
          (seams, grout, grain) gives the raking light something to catch. */}
      <meshPhysicalMaterial
        color={color}
        map={map}
        roughnessMap={map ? (ceiling !== undefined ? surfaces.plasterRough : tiled ? surfaces.tileRough : surfaces.woodRough) : null}
        bumpMap={map ? (ceiling !== undefined ? surfaces.plasterBump : tiled ? surfaces.tileBump : surfaces.woodBump) : null}
        bumpScale={tiled ? 0.6 : 0.35}
        clearcoat={ceiling !== undefined || map === null ? 0 : tiled ? 0.55 : 0.3}
        clearcoatRoughness={tiled ? 0.25 : 0.5}
        envMapIntensity={ceiling !== undefined ? 0.2 : 0.55}
        {...(ceiling !== undefined
          // Faces straight down, which the hemisphere light ignores and the sun
          // never reaches: a whisper of self-light stands in for floor bounce,
          // without which the ceiling reads as a black lid on every room.
          ? { emissive: '#a49d8f' as unknown as THREE.Color, emissiveIntensity: 0.55 }
          : {})}
        side={THREE.DoubleSide}
        roughness={map ? 1 : tiled ? 0.55 : 0.9}
      />
    </mesh>
  );
}

function WallPanel({ plan, wall, wallHeight }: { plan: Floorplan; wall: Wall; wallHeight: number }) {
  const selected = useSelected(wall.id);
  const selectWall = useSelect(wall.id);
  const armed = useFloorplanStore((state) => state.armed);
  const armCatalog = useFloorplanStore((state) => state.armCatalog);
  const applyOperation = useFloorplanStore((state) => state.applyOperation);
  const select = useFloorplanStore((state) => state.select);
  const placement = wallPlacement(wall);

  // An armed TV mounts on the wall that was clicked: hung on the clicked face,
  // facing into the room the viewer is looking from. Every other armed item
  // stands on floors, so walls keep their select behaviour.
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (armed?.catalogId !== 'tv-stand') {
      if (!selectSuppressed()) {
        selectWall(event);
      }
      return;
    }

    event.stopPropagation();
    const at = { x: event.point.x, y: event.point.z };
    const towards = { x: at.x - event.ray.direction.x, y: at.y - event.ray.direction.z };
    const mount = wallMountPlacement(wall, at, towards, 60);

    const room = plan.rooms.find((candidate) => {
      const box = boundingBox(roomPolygon(plan, candidate));
      return (
        mount.position.x >= box.minX && mount.position.x <= box.maxX &&
        mount.position.y >= box.minY && mount.position.y <= box.maxY
      );
    });

    if (!room) {
      return;
    }

    const result = applyOperation((current) =>
      placeFurniture(current, {
        roomId: room.id,
        catalogId: 'tv-wall',
        footprint: { w: 60, d: 4 },
        position: mount.position,
        rotation: mount.rotation,
        clearanceFrontIn: 60,
        ...(armed.color === undefined ? {} : { color: armed.color }),
      }),
    );

    armCatalog(null);
    if (result.ok) {
      select([result.changed[0]]);
    }
  };

  const geometry = useMemo(() => {
    const { outline, holes } = wallPanelRects(plan, wall, wallHeight);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(outline.w, 0);
    shape.lineTo(outline.w, outline.h);
    shape.lineTo(0, outline.h);
    shape.closePath();

    shape.holes = holes.map((hole) => {
      const path = new THREE.Path();
      path.moveTo(hole.x, hole.y);
      path.lineTo(hole.x + hole.w, hole.y);
      path.lineTo(hole.x + hole.w, hole.y + hole.h);
      path.lineTo(hole.x, hole.y + hole.h);
      path.closePath();
      return path;
    });

    return new THREE.ExtrudeGeometry(shape, { depth: wall.thickness, bevelEnabled: false });
  }, [plan, wall, wallHeight]);

  // Baseboard runs: the wall's length minus every floor-level opening.
  const skirtRuns = useMemo(() => {
    const doorSpans = wallPanelRects(plan, wall, wallHeight)
      .holes.filter((hole) => hole.y < 4)
      .sort((a, b) => a.x - b.x);

    const runs: { from: number; to: number }[] = [];
    let cursor = 0;
    for (const span of doorSpans) {
      if (span.x - cursor > 2) {
        runs.push({ from: cursor, to: span.x });
      }
      cursor = Math.max(cursor, span.x + span.w);
    }
    if (placement.length - cursor > 2) {
      runs.push({ from: cursor, to: placement.length });
    }
    return runs;
  }, [plan, wall, wallHeight, placement.length]);

  return (
    <group position={placement.position} rotation={[0, placement.rotationY, 0]}>
      {skirtRuns.map((run) =>
        [wall.thickness / 2 + 0.7, -wall.thickness / 2 - 0.7].map((z) => (
          <mesh key={`${run.from}-${z}`} position={[(run.from + run.to) / 2, 2, z]} receiveShadow>
            <boxGeometry args={[run.to - run.from, 4, 1.4]} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
          </mesh>
        )),
      )}
      {/* Extrusion runs along local +z, so back it off to straddle the line. */}
      <mesh geometry={geometry} position={[0, 0, -wall.thickness / 2]} onClick={onClick} castShadow receiveShadow>
        {/* Both rooms draw a shared partition, so the two panels are coplanar.
            Nudging the selected one forward keeps the highlight from flickering
            against its twin. */}
        <meshStandardMaterial
          color={selected ? SELECTED : WALL_COLOR}
          map={selected ? null : surfaceTextures().plaster}
          roughnessMap={selected ? null : surfaceTextures().plasterRough}
          bumpMap={selected ? null : surfaceTextures().plasterBump}
          bumpScale={0.25}
          envMapIntensity={0.25}
          roughness={selected ? 0.85 : 1}
          side={THREE.DoubleSide}
          polygonOffset={selected}
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
    </group>
  );
}

function OpeningPane({
  plan,
  opening,
  wall,
  wallHeight,
}: {
  plan: Floorplan;
  opening: Opening;
  wall: Wall;
  wallHeight: number;
}) {
  const selected = useSelected(opening.id);
  const onClick = useSelect(opening.id);

  // Reuse the hole the wall actually cut, so the pane cannot drift out of it.
  const hole = wallPanelRects(plan, wall, wallHeight).holes.find(
    (candidate) => candidate.openingId === opening.id,
  );

  if (!hole) {
    return null;
  }

  const placement = openingPlacement(wall, hole);
  const glazed = opening.kind === 'window';
  const trim = 2;
  const jambDepth = wall.thickness + 1.5;
  // Every frame piece bites this far INTO the hole. Casings that stop exactly
  // at the hole edge share a plane with the wall's cut face, and two coplanar
  // faces flicker as the depth buffer picks a different winner every frame.
  // Overlapping the joint by a hair means one face is always simply in front.
  const bite = 0.4;

  return (
    <group position={placement.position} rotation={[0, placement.rotationY, 0]}>
      <mesh onClick={onClick}>
        {/* Inset from the hole on every side: a pane cut exactly hole-sized
            leaves its edges coplanar with the wall's cut faces and flashing. */}
        <boxGeometry args={[placement.width - bite * 2, placement.height - bite * 2, wall.thickness * 0.35]} />
        {/* Doors and archways read as voids, so their pane is only a click
            target with the faintest tint; windows get actual glass -- near
            zero roughness and a strong environment pickup, so panes catch
            the sky the way real glazing does. */}
        <meshPhysicalMaterial
          color={selected ? SELECTED : glazed ? '#b8d4e4' : '#6f6a60'}
          transparent
          opacity={selected ? 0.75 : glazed ? 0.3 : 0.12}
          roughness={glazed ? 0.04 : 0.1}
          metalness={0}
          envMapIntensity={glazed ? 2.2 : 0.3}
        />
      </mesh>
      {glazed ? <WindowSash width={placement.width - bite * 2} height={placement.height - bite * 2} depth={wall.thickness * 0.35 + 0.8} /> : null}
      {/* Casing: jambs up the sides, a head across the top, and a sill under a
          window. Small geometry, but it is what makes a hole read as a doorway
          rather than a missing texture. */}
      <mesh position={[-placement.width / 2 - trim / 2 + bite, 0, 0]} castShadow>
        <boxGeometry args={[trim, placement.height + (glazed ? trim * 2 : trim), jambDepth]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[placement.width / 2 + trim / 2 - bite, 0, 0]} castShadow>
        <boxGeometry args={[trim, placement.height + (glazed ? trim * 2 : trim), jambDepth]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[0, placement.height / 2 + trim / 2 - bite, 0]} castShadow>
        <boxGeometry args={[placement.width + trim, trim, jambDepth]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
      </mesh>
      {glazed ? (
        <mesh position={[0, -placement.height / 2 - trim / 2 + bite, 0]} castShadow>
          <boxGeometry args={[placement.width + trim * 2, trim, jambDepth + 1.5]} />
          <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
        </mesh>
      ) : null}
      <DoorLeaf opening={opening} width={placement.width} height={placement.height} />
    </group>
  );
}

/**
 * A double-hung sash inside a window's glass: a frame around the perimeter,
 * a thicker meeting rail where the two sashes overlap, and muntin bars
 * dividing each sash into lites. One sheet of blue glass reads as a hole
 * with a tint; the grid is what reads as a window.
 */
function WindowSash({ width, height, depth }: { width: number; height: number; depth: number }) {
  const frame = 1.4;
  const muntin = 0.8;
  // Sparingly divided: every window is a one-over-one double-hung, and only
  // a wide one earns a single centre muntin. Busy grids read as cottage
  // kitsch at this scale. The overhead views cut walls short and truncate
  // window holes with them -- cramming the rail and bars into that short
  // strip read as a vent, so a shortened window keeps only its frame.
  const tallEnough = height >= 30;
  const verticals = tallEnough && width >= 44 ? [0] : [];
  const wood = <meshStandardMaterial color={TRIM_COLOR} roughness={0.55} />;

  return (
    <group>
      <mesh position={[0, height / 2 - frame / 2, 0]} castShadow>
        <boxGeometry args={[width, frame, depth]} />
        {wood}
      </mesh>
      <mesh position={[0, -height / 2 + frame / 2, 0]} castShadow>
        <boxGeometry args={[width, frame, depth]} />
        {wood}
      </mesh>
      <mesh position={[-width / 2 + frame / 2, 0, 0]} castShadow>
        <boxGeometry args={[frame, height, depth]} />
        {wood}
      </mesh>
      <mesh position={[width / 2 - frame / 2, 0, 0]} castShadow>
        <boxGeometry args={[frame, height, depth]} />
        {wood}
      </mesh>
      {/* Meeting rail: where the lower sash overlaps the upper. */}
      {tallEnough ? (
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[width, 1.8, depth + 0.4]} />
          {wood}
        </mesh>
      ) : null}
      {verticals.map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[muntin, height, depth]} />
          {wood}
        </mesh>
      ))}
    </group>
  );
}

/**
 * The door itself, standing ajar on its hinge. The swing data already says
 * which jamb it hangs from and which way it opens, so the leaf is pure
 * decoration derived from state the constraint engine uses anyway. Sliding
 * and fixed openings have no leaf to show.
 *
 * Built as a two-panel shaker door rather than a flat slab: recessed panels
 * on both faces, a knob at hand height on the latch edge, and hinges on the
 * hinge line. The details are what read as "door" instead of "plank".
 */
function DoorLeaf({ opening, width, height }: { opening: Opening; width: number; height: number }) {
  const swing = opening.swing;
  if (opening.kind !== 'door' || !swing || swing === 'sliding' || swing === 'none') {
    return null;
  }

  const hingedLeft = swing.endsWith('left');
  const inward = swing.startsWith('in');
  const hingeX = hingedLeft ? -width / 2 : width / 2;
  // Ajar at ~55deg: open enough to read as a door, closed enough not to fill
  // the room. Sign chosen so the leaf sweeps toward the side the arc sweeps.
  const angle = (hingedLeft ? 1 : -1) * (inward ? 1 : -1) * 0.95;
  const direction = hingedLeft ? 1 : -1;
  return <DoorLeafSwing openingId={opening.id} hingeX={hingeX} direction={direction} ajarAngle={angle} width={width} height={height} />;
}

/**
 * The hung leaf itself. Clicking it swings it shut on its hinge -- and open
 * again -- eased over a few frames like a door with actual weight. Purely
 * scene dressing: the plan's data never changes, so selection, validation and
 * the agent all see the same design either way. Selecting the opening stays
 * on the pane and casing.
 */
function DoorLeafSwing({
  openingId,
  hingeX,
  direction,
  ajarAngle,
  width,
  height,
}: {
  openingId: string;
  hingeX: number;
  direction: number;
  ajarAngle: number;
  width: number;
  height: number;
}) {
  const closed = useFloorplanStore((state) => state.closedDoors.includes(openingId));
  const toggleDoor = useFloorplanStore((state) => state.toggleDoor);
  const swingRef = useRef<THREE.Group>(null);
  const target = closed ? 0 : ajarAngle;

  useFrame((_, delta) => {
    const pivot = swingRef.current;
    if (!pivot) {
      return;
    }
    const gap = target - pivot.rotation.y;
    if (Math.abs(gap) < 0.002) {
      pivot.rotation.y = target;
      return;
    }
    pivot.rotation.y += gap * Math.min(1, delta * 7);
  });

  const panelW = width - 8;
  // Local y = 0 is the middle of the leaf; the knob sits at hand height off
  // the floor, which is the leaf's bottom edge.
  const knobY = -height / 2 + Math.min(37, height * 0.47);
  const chrome = <meshStandardMaterial color="#c9cdd1" metalness={0.85} roughness={0.2} envMapIntensity={1.3} />;

  const panels = [
    { y: height * 0.16, h: height * 0.44 },
    { y: -height * 0.28, h: height * 0.3 },
  ];

  return (
    <group
      position={[hingeX, 0, 0]}
      ref={swingRef}
      onClick={(event) => {
        event.stopPropagation();
        toggleDoor(openingId);
      }}
    >
      {/* Hinges on the hinge line: a leaf plate with a knuckle barrel, the
          detail that says "hung", not "glued". */}
      {[height * 0.36, 0, -height * 0.36].map((y) => (
        <group key={y} position={[direction * 0.3, y, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.4, 3.4, 1.7]} />
            {chrome}
          </mesh>
          <mesh position={[-direction * 0.3, 0, 0]} castShadow>
            <cylinderGeometry args={[0.35, 0.35, 3.7, 10]} />
            {chrome}
          </mesh>
        </group>
      ))}
      <group position={[direction * (width / 2), 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[width, height, 1.6]} />
          <meshStandardMaterial color="#d7d1c3" roughness={0.55} />
        </mesh>
        {/* Latch bolt plate on the leading edge. */}
        <mesh position={[direction * (width / 2), knobY, 0]} castShadow>
          <boxGeometry args={[0.35, 4.5, 1.1]} />
          {chrome}
        </mesh>
        {/* Recessed shaker panels on both faces, in three steps: a dark
            reveal, a bevel ring, and the field standing proud of both --
            the middle step is what catches light like routed timber. */}
        {[1, -1].flatMap((face) =>
          panels.map((panel) => (
            <group key={`${face}-${panel.y}`}>
              <mesh position={[0, panel.y, face * 0.82]}>
                <boxGeometry args={[panelW + 2.4, panel.h + 2.4, 0.08]} />
                <meshStandardMaterial color="#aaa294" roughness={0.68} />
              </mesh>
              <mesh position={[0, panel.y, face * 0.87]}>
                <boxGeometry args={[panelW + 1.2, panel.h + 1.2, 0.1]} />
                <meshStandardMaterial color="#bfb8a9" roughness={0.62} />
              </mesh>
              <mesh position={[0, panel.y, face * 0.94]} castShadow>
                <boxGeometry args={[panelW, panel.h, 0.2]} />
                <meshStandardMaterial color="#d2cbbc" roughness={0.58} />
              </mesh>
            </group>
          )),
        )}
        {/* Knob, rosette and stem on both faces of the latch edge. */}
        {[1, -1].map((face) => (
          <group key={face} position={[direction * (width / 2 - 2.8), knobY, 0]}>
            <mesh position={[0, 0, face * 0.95]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[1.3, 1.3, 0.4, 16]} />
              {chrome}
            </mesh>
            <mesh position={[0, 0, face * 1.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.5, 0.5, 0.9, 10]} />
              {chrome}
            </mesh>
            <mesh position={[0, 0, face * 1.95]} castShadow>
              <sphereGeometry args={[1.15, 14, 12]} />
              {chrome}
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * The click that follows a drag or a ring-turn lands on whatever is under the
 * released pointer -- usually a floor -- and would steal the selection from
 * the piece that was just manipulated. Gestures push this deadline forward on
 * release; select-clicks inside it are the gesture's echo, not an intent.
 */
let suppressSelectUntil = 0;

export function suppressNextSelect(): void {
  suppressSelectUntil = Date.now() + 250;
}

function selectSuppressed(): boolean {
  return Date.now() < suppressSelectUntil;
}

/** Where a pointer ray meets the floor plane, in plan inches. */
function floorPoint(event: ThreeEvent<PointerEvent>): { x: number; y: number } | null {
  const { origin, direction } = event.ray;
  if (Math.abs(direction.y) < 1e-6) {
    return null;
  }
  const t = -origin.y / direction.y;
  return t > 0 ? { x: origin.x + direction.x * t, y: origin.z + direction.z * t } : null;
}

function FurniturePiece({ item, wallHeight }: { item: Furniture; wallHeight: number }) {
  const selected = useSelected(item.id);
  const onClick = useSelect(item.id);
  const applyOperation = useFloorplanStore((state) => state.applyOperation);
  const clearSelection = useFloorplanStore((state) => state.clearSelection);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const placement = furniturePlacement(item);

  // Dragging previews locally and commits one move_furniture on release, so
  // the human's drag and the agent's tool call are the same operation -- same
  // grid snap, same fit rules, same violations in the rail afterwards.
  //
  // Only the grab itself goes through r3f; the rest of the gesture listens on
  // the window and unprojects the mouse against the floor plane directly.
  // Pointer capture inside the scene graph proved unreliable, and a drag must
  // survive the cursor crossing walls, other furniture, or leaving the canvas.
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [rotationPreview, setRotationPreview] = useState<number | null>(null);
  const drag = useRef({ active: false, moved: false, offset: { x: 0, y: 0 }, at: { x: 0, y: 0 } });

  const mouseToFloor = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    if (Math.abs(direction.y) < 1e-6) {
      return null;
    }
    const t = -origin.y / direction.y;
    return t > 0 ? { x: origin.x + direction.x * t, y: origin.z + direction.z * t } : null;
  };

  const cameraMode = useFloorplanStore((state) => state.camera.mode);

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    // Eye-level rays graze the floor plane, so in the walkthrough a small
    // mouse move unprojects to a jump of several feet; selection still works,
    // manipulation needs an overhead view.
    if (cameraMode === 'firstPerson') {
      return;
    }
    const at = floorPoint(event);
    if (!at) {
      return;
    }

    event.stopPropagation();
    drag.current = {
      active: true,
      moved: false,
      offset: { x: item.position.x - at.x, y: item.position.y - at.y },
      at: { ...item.position },
    };
    setDragPosition({ ...item.position });
    if (controls) {
      controls.enabled = false;
    }

    const onWindowMove = (move: PointerEvent) => {
      if (!drag.current.active) {
        return;
      }
      const here = mouseToFloor(move.clientX, move.clientY);
      if (!here) {
        return;
      }
      const next = { x: here.x + drag.current.offset.x, y: here.y + drag.current.offset.y };
      if (Math.hypot(next.x - item.position.x, next.y - item.position.y) > 2) {
        drag.current.moved = true;
      }
      drag.current.at = next;
      setDragPosition(next);
    };

    const onWindowUp = () => {
      window.removeEventListener('pointermove', onWindowMove);
      if (!drag.current.active) {
        return;
      }

      drag.current.active = false;
      if (controls) {
        controls.enabled = true;
      }

      if (drag.current.moved) {
        // A rejected landing spot leaves the store untouched, so clearing the
        // preview snaps the piece back to where it really is.
        applyOperation((plan) => moveFurniture(plan, { furnitureId: item.id, position: drag.current.at }));
        suppressNextSelect();
      }
      setDragPosition(null);
    };

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp, { once: true });
  };

  const shown: [number, number, number] = dragPosition
    ? [dragPosition.x, placement.position[1], dragPosition.y]
    : placement.position;

  // Overhead views are a dollhouse: walls are cut to 48in, and any piece drawn
  // at its true height pokes above the cut and reads as oversized. One rule
  // for every piece -- fit under the cut in the overhead views, true height in
  // the walkthrough, where wallHeight is the real ceiling. Special-casing only
  // the wall TV made it the one piece that behaved differently, which read as
  // a bug rather than a convention.
  const height = Math.min(placement.size[1], wallHeight - 2);

  return (
    <>
      <FurnitureModel
        catalogId={item.catalogId}
        position={shown}
        rotationY={rotationPreview !== null ? (-rotationPreview * Math.PI) / 180 : placement.rotationY}
        w={placement.size[0]}
        h={height}
        d={placement.size[2]}
        selected={selected || dragPosition !== null}
        tint={item.color}
        onClick={onClick}
        onPointerDown={onPointerDown}
      />
      {selected && dragPosition === null ? (
        // The delete lives on the piece itself: a toolbar across the screen is
        // where controls go to be missed. Screen-space, so it stays finger-
        // sized at any zoom.
        <Html
          position={[shown[0], height + 14, shown[2]]}
          center
          zIndexRange={[20, 10]}
        >
          <button
            type="button"
            className="delete-float"
            aria-label={`Remove ${item.catalogId}`}
            onClick={(event) => {
              event.stopPropagation();
              applyOperation((plan) => removeElement(plan, item.id));
              clearSelection();
            }}
          >
            &#10005;
          </button>
        </Html>
      ) : null}
      {selected && dragPosition === null && item.catalogId !== 'tv-wall' && cameraMode !== 'firstPerson' ? (
        <RotateHandle
          item={item}
          height={height}
          preview={rotationPreview}
          onPreview={setRotationPreview}
          onCommit={(rotation) =>
            applyOperation((plan) => moveFurniture(plan, { furnitureId: item.id, rotation }))
          }
          controls={controls}
          mouseToFloor={mouseToFloor}
        />
      ) : null}
    </>
  );
}

/**
 * A ring around the selected piece with a knob at its front. Dragging the knob
 * turns the piece to face the pointer -- any angle, snapped to 5deg -- and
 * commits one move_furniture on release, the same call an agent would make.
 * The quarter-turn button stays for the common case; this is for the rest.
 */
function RotateHandle({
  item,
  height,
  preview,
  onPreview,
  onCommit,
  controls,
  mouseToFloor,
}: {
  item: Furniture;
  /** The piece's rendered height in the current view, not its true height. */
  height: number;
  preview: number | null;
  onPreview: (rotation: number | null) => void;
  onCommit: (rotation: number) => void;
  controls: { enabled: boolean } | null;
  mouseToFloor: (clientX: number, clientY: number) => { x: number; y: number } | null;
}) {
  const radius = Math.hypot(item.footprint.w, item.footprint.d) / 2 + 9;
  const shownRotation = preview ?? item.rotation;
  const front = facingVector(shownRotation);
  // The knob floats above the piece's own height: at floor level its pixels
  // sit behind the body from most angles, and grabbing it grabbed the piece.
  const knob: [number, number, number] = [
    item.position.x + front.x * radius,
    height + 6,
    item.position.y + front.y * radius,
  ];

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (controls) {
      controls.enabled = false;
    }
    onPreview(item.rotation);
    let latest = item.rotation;

    const onMove = (move: PointerEvent) => {
      const at = mouseToFloor(move.clientX, move.clientY);
      if (!at) {
        return;
      }
      latest = rotationTowards(item.position, at);
      onPreview(latest);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      if (controls) {
        controls.enabled = true;
      }
      if (latest !== item.rotation) {
        onCommit(latest);
      }
      onPreview(null);
      suppressNextSelect();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <group>
      <mesh position={[item.position.x, 1, item.position.y]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.7, 8, 48]} />
        <meshBasicMaterial color="#6ea8fe" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh position={knob} onPointerDown={onPointerDown} renderOrder={10}>
        <sphereGeometry args={[4.5, 16, 16]} />
        <meshBasicMaterial color="#9cc2ff" depthTest={false} />
      </mesh>
    </group>
  );
}

/** Inches walked per second when a movement key is held. */
const WALK_SPEED_IN = 130;
/** Radians turned per second on the left/right arrows. */
const TURN_SPEED = 1.7;
/** Radians of view swing per pixel of look-drag. */
const LOOK_SPEED = 0.0032;

/**
 * Eases the camera to whatever pose the store asks for, then hands control back
 * to the orbit controls. Tracking the pose in a ref rather than an effect
 * dependency means a re-render mid-flight does not restart the move.
 *
 * The walkthrough gets street-view controls instead of the orbit gesture:
 * dragging grabs the panorama (drag left, the view sweeps right), the arrow
 * keys or WASD walk and turn, and eye height never changes. Orbit's own
 * rotate/zoom/pan are disabled there -- orbiting around a target 60in in
 * front of your nose is what made the walkthrough feel broken.
 */
function CameraRig({ plan, camera }: { plan: Floorplan; camera: Camera }) {
  const controls = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const { camera: three, gl } = useThree();
  const walking = camera.mode === 'firstPerson';

  const pose = useMemo(() => cameraPose(plan, camera), [plan, camera]);
  const from = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3() });
  const progress = useRef(1);
  const keys = useRef(new Set<string>());

  // Re-fly only when the camera *request* changes -- a view button click or
  // an agent's set_camera. Keying on the computed pose fired on every plan
  // edit too (the pose derives from the plan), so rotating a chair re-framed
  // the scene and threw away whatever zoom and pan the human had settled on.
  useEffect(() => {
    from.current.position.copy(three.position);
    from.current.target.copy(controls.current?.target ?? new THREE.Vector3());
    progress.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, three]);

  // A standing eye wants a wide lens: 50deg is right for surveying the plan
  // from outside, but inside a 12ft room it reads as a telephoto crop and the
  // room feels smaller than its measurements. ~72deg is what map walkthroughs
  // use, and it is what makes the dimensions feel true at eye height.
  useEffect(() => {
    const lens = three as THREE.PerspectiveCamera;
    lens.fov = walking ? 72 : 50;
    lens.updateProjectionMatrix();
  }, [walking, three]);

  // Movement keys, live in every view: the walkthrough walks, the overhead
  // views pan. Held state lives in a ref and is consumed per-frame, so
  // movement is smooth rather than stepping at the key-repeat rate.
  useEffect(() => {
    const handled = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']);
    const held = keys.current;

    const onDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!handled.has(key) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      // Without this the arrows also scroll the page behind the canvas.
      event.preventDefault();
      held.add(key);
    };
    const onUp = (event: KeyboardEvent) => held.delete(event.key.toLowerCase());

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      held.clear();
    };
  }, []);

  // Look-drag: rotate the view direction around the standing eye, never the
  // eye around the view. Spherical angles are re-derived from the live target
  // each event, so the drag composes with walking and with the eased fly-in.
  useEffect(() => {
    if (!walking) {
      return undefined;
    }

    const element = gl.domElement;
    let last: { x: number; y: number } | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.button === 0) {
        last = { x: event.clientX, y: event.clientY };
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!last || !controls.current) {
        return;
      }
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };

      const next = lookDrag(
        { position: three.position.toArray() as Vec3Tuple, target: controls.current.target.toArray() as Vec3Tuple },
        dx,
        dy,
        LOOK_SPEED,
      );
      controls.current.target.set(...next);
      controls.current.update();
    };
    const onUp = () => {
      last = null;
    };

    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [walking, gl, three]);

  useFrame((_, delta) => {
    if (!controls.current) {
      return;
    }

    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + delta * 1.6);
      // Smoothstep, so the move settles instead of stopping dead.
      const t = progress.current * progress.current * (3 - 2 * progress.current);

      three.position.lerpVectors(from.current.position, new THREE.Vector3(...pose.position), t);
      controls.current.target.lerpVectors(from.current.target, new THREE.Vector3(...pose.target), t);
      controls.current.update();
      return;
    }

    if (keys.current.size === 0) {
      return;
    }

    const held = keys.current;
    const move =
      (held.has('arrowup') || held.has('w') ? 1 : 0) - (held.has('arrowdown') || held.has('s') ? 1 : 0);
    const side =
      (held.has('arrowright') || held.has('d') ? 1 : 0) - (held.has('arrowleft') || held.has('a') ? 1 : 0);
    if (move === 0 && side === 0) {
      return;
    }

    const gaze = {
      position: three.position.toArray() as Vec3Tuple,
      target: controls.current.target.toArray() as Vec3Tuple,
    };
    // Left/right turns the walker but strafes the overhead camera: on foot
    // you steer, over a map you slide it.
    const next = walking
      ? walkStep(gaze, move, side, delta, WALK_SPEED_IN, TURN_SPEED)
      : panStep(gaze, side, move, delta);
    three.position.set(...next.position);
    controls.current.target.set(...next.target);
    controls.current.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.1}
      enableRotate={!walking}
      enableZoom={!walking}
      enablePan={!walking}
    />
  );
}

/**
 * The walls a proposed variant would move, drawn over the live plan so the
 * human can see the alternative in place before committing to it. Only the
 * relocated walls are ghosted; everything else is already on screen.
 */
function VariantGhost({ plan, variant, wallHeight }: { plan: Floorplan; variant: Variant; wallHeight: number }) {
  const walls = proposedWalls(plan, variant.plan);

  return (
    <group>
      {walls.map((wall) => {
        const placement = wallPlacement(wall);
        const { outline } = wallPanelRects(variant.plan, wall, wallHeight);

        return (
          <group key={wall.id} position={placement.position} rotation={[0, placement.rotationY, 0]}>
            <mesh position={[outline.w / 2, outline.h / 2, 0]}>
              <boxGeometry args={[outline.w, outline.h, wall.thickness]} />
              {/* Faint unlit fill with a crisp outline: several ghosts overlap in
                  one proposal, and solid slabs pile up into an unreadable blob.
                  depthWrite off so they never occlude each other or the plan. */}
              <meshBasicMaterial color={GHOST} transparent opacity={0.16} depthWrite={false} />
              <Edges color={GHOST} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function VariantBar({
  previewId,
  onPreview,
}: {
  previewId: string | null;
  onPreview: (id: string) => void;
}) {
  const variants = useFloorplanStore((state) => state.variants);
  const applyVariant = useFloorplanStore((state) => state.applyVariant);
  const setVariants = useFloorplanStore((state) => state.setVariants);

  if (variants.length === 0) {
    return null;
  }

  // A compact strip under the camera bar: the goal, one numbered chip per
  // alternative (its summary lives in the tooltip), Apply for whichever is
  // previewed, and a dismiss. The full-card bottom bar covered the plan the
  // variants were about.
  return (
    <div className="variant-bar">
      <span className="variant-goal" title={variants[0].goal}>{variants[0].goal}</span>
      {variants.map((variant, index) => {
        const issues = validate(variant.plan).length;

        return (
          <button
            key={variant.id}
            type="button"
            className={variant.id === previewId ? 'variant-chip active' : 'variant-chip'}
            title={issues === 0 ? variant.summary : `${variant.summary} (${issues} issue${issues === 1 ? '' : 's'})`}
            onMouseEnter={() => onPreview(variant.id)}
            onClick={() => onPreview(variant.id)}
          >
            {index + 1}
            {issues > 0 ? <span className="variant-issues">{issues}</span> : null}
          </button>
        );
      })}
      <button
        type="button"
        className="variant-apply"
        onClick={() => {
          if (previewId) {
            applyVariant(previewId);
          }
        }}
      >
        Apply
      </button>
      <button type="button" className="variant-dismiss" aria-label="Dismiss variants" onClick={() => setVariants([])}>
        &#10005;
      </button>
    </div>
  );
}

/**
 * A large soft ground under the building, so the plan sits somewhere rather
 * than floating in a void, and the sun has something to throw the house's
 * shadow onto. Clicking it is clicking empty space.
 */
function Ground({ plan, onClear }: { plan: Floorplan; onClear: () => void }) {
  const bounds = planBounds(plan);
  const centre = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minY + bounds.maxY) / 2 };

  return (
    <mesh
      position={[centre.x, -0.4, centre.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onClick={(event) => {
        event.stopPropagation();
        if (!selectSuppressed()) {
          onClear();
        }
      }}
    >
      <planeGeometry args={[6000, 6000]} />
      <meshStandardMaterial
        color="#e8e8e0"
        map={surfaceTextures().ground}
        roughness={1}
        envMapIntensity={0.1}
      />
    </mesh>
  );
}

/**
 * Late-morning daylight: one shadow-casting sun from the south-east, a cool
 * sky/warm ground hemisphere for ambient, and a faint warm bounce from the
 * north-west so shadowed faces are lifted rather than black. Everything is
 * local -- no HDRI fetch that could fail on a judge's machine and leave the
 * scene dark.
 *
 * The sun's orthographic shadow camera is fitted to the plan each render, so
 * shadows stay sharp instead of spreading one fixed-size map over however
 * large the plan has grown.
 */
function Daylight({ plan }: { plan: Floorplan }) {
  const bounds = planBounds(plan);
  const centre = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minY + bounds.maxY) / 2 };
  const reach = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.75 + 60;

  return (
    <>
      {/* Hemisphere light ignores surfaces facing straight down, so ceiling
          undersides went black in the walkthrough; a whisper of flat ambient
          keeps them readable without flattening the shadows. */}
      <ambientLight intensity={0.1} color="#d8d2c4" />
      <hemisphereLight args={['#cfd8e6', '#5a5248', 0.55]} />
      <directionalLight
        position={[centre.x + reach * 0.8, reach * 1.4, centre.z + reach * 0.6]}
        target-position={[centre.x, 0, centre.z]}
        intensity={2.2}
        color="#fff3e0"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.15}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={10}
        shadow-camera-far={reach * 4}
      />
      <directionalLight
        position={[centre.x - reach, reach * 0.5, centre.z - reach]}
        intensity={0.55}
        color="#e6d8c3"
      />
    </>
  );
}

/**
 * Actions on whatever furniture is selected. Rotation goes through the same
 * move_furniture operation the agent uses, so a quarter turn that no longer
 * fits the room is refused with the same message either would see.
 */
export function SelectionActions() {
  const plan = useFloorplanStore((state) => state.plan);
  const selection = useFloorplanStore((state) => state.selection);
  const applyOperation = useFloorplanStore((state) => state.applyOperation);
  const clearSelection = useFloorplanStore((state) => state.clearSelection);
  const [error, setError] = useState<string | null>(null);

  const item = selection.kind === 'furniture'
    ? plan.furniture.find((candidate) => candidate.id === selection.elementIds[0])
    : undefined;
  const opening = selection.kind === 'opening'
    ? plan.openings.find((candidate) => candidate.id === selection.elementIds[0])
    : undefined;

  const change = (input: { widthIn?: number; kind?: 'door' | 'archway'; swing?: 'in-left' | 'in-right' }) => {
    if (!opening) {
      return;
    }
    const result = applyOperation((current) => updateOpening(current, { openingId: opening.id, ...input }));
    setError(result.ok ? null : result.error);
  };

  const removeOpening = () => {
    if (!opening) {
      return;
    }
    applyOperation((current) => removeElement(current, opening.id));
    clearSelection();
    setError(null);
  };

  const resize = (dims: { widthIn?: number; depthIn?: number }) => {
    if (!item) {
      return;
    }
    const result = applyOperation((current) => resizeFurniture(current, { furnitureId: item.id, ...dims }));
    setError(result.ok ? null : result.error);
  };

  const rotate = () => {
    if (!item) {
      return;
    }
    const result = applyOperation((current) =>
      moveFurniture(current, { furnitureId: item.id, rotation: (item.rotation + 90) % 360 }),
    );
    setError(result.ok ? null : result.error);
  };

  const remove = () => {
    if (!item) {
      return;
    }
    // removeElement never fails for furniture, and it is one undo away.
    applyOperation((current) => removeElement(current, item.id));
    clearSelection();
    setError(null);
  };

  // R turns the selected piece, Delete removes it; buttons are the
  // discoverable versions of both.
  useEffect(() => {
    if (!item) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'r' || event.key === 'R') {
        rotate();
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        remove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.rotation]);

  if (opening) {
    // The rail's suggestions name these exact moves; a human should be able
    // to take them without an agent in the room.
    const door = opening.kind === 'door';
    const flipped = opening.swing === 'in-left' || opening.swing === 'out-left' ? 'in-right' : 'in-left';

    return (
      <div className="selection-actions">
        <span className="selection-name">{opening.kind} {opening.width}in</span>
        <button type="button" onClick={() => change({ widthIn: opening.width + 6 })}>Wider +6</button>
        <button type="button" onClick={() => change({ widthIn: opening.width - 6 })}>Narrower &minus;6</button>
        {door ? <button type="button" onClick={() => change({ kind: 'archway' })}>Make archway</button> : null}
        {!door && opening.kind === 'archway' ? <button type="button" onClick={() => change({ kind: 'door' })}>Make door</button> : null}
        {door && opening.swing !== 'sliding' && opening.swing !== 'none' ? (
          <button type="button" onClick={() => change({ swing: flipped })}>Flip hinge</button>
        ) : null}
        <button type="button" className="delete" aria-label={`Remove ${opening.kind}`} onClick={removeOpening}>
          &#10005;
        </button>
        {error ? <span className="selection-error">{error}</span> : null}
      </div>
    );
  }

  if (!item) {
    return null;
  }

  return (
    <div className="selection-actions">
      <span className="selection-name">{item.catalogId} {item.footprint.w}&times;{item.footprint.d}in</span>
      {/* Footprint steppers, mirroring the opening toolbar's Wider/Narrower:
          the same resize_furniture operation the agent calls, so a size that
          would run into a wall is refused with the same message. */}
      <button type="button" title="Wider" onClick={() => resize({ widthIn: item.footprint.w + 6 })}>W+6</button>
      <button type="button" title="Narrower" onClick={() => resize({ widthIn: item.footprint.w - 6 })}>W&minus;6</button>
      <button type="button" title="Deeper" onClick={() => resize({ depthIn: item.footprint.d + 6 })}>D+6</button>
      <button type="button" title="Shallower" onClick={() => resize({ depthIn: item.footprint.d - 6 })}>D&minus;6</button>
      <button type="button" onClick={rotate}>Rotate 90&deg;</button>
      <kbd>R</kbd>
      <button type="button" className="delete" aria-label={`Remove ${item.catalogId}`} onClick={remove}>
        &#10005;
      </button>
      {error ? <span className="selection-error">{error}</span> : null}
    </div>
  );
}

export function CameraBar() {
  const plan = useFloorplanStore((state) => state.plan);
  const camera = useFloorplanStore((state) => state.camera);
  const selection = useFloorplanStore((state) => state.selection);
  const setCamera = useFloorplanStore((state) => state.setCamera);

  const modes: { mode: CameraMode; label: string }[] = [
    { mode: 'top', label: 'Top' },
    { mode: 'iso', label: 'Iso' },
    { mode: 'firstPerson', label: 'Walk through' },
  ];

  return (
    <div className="camera-bar">
      {modes.map(({ mode, label }) => {
        // Walking through follows whatever room the human has selected.
        const targetRoomId =
          selection.kind === 'room' ? selection.elementIds[0] : camera.targetRoomId;

        return (
          <button
            key={mode}
            type="button"
            className={camera.mode === mode ? 'active' : undefined}
            onClick={() =>
              setCamera({
                mode,
                targetRoomId: targetRoomId ?? null,
                description: describeCamera(plan, mode, targetRoomId ?? undefined),
              })
            }
          >
            {label}
          </button>
        );
      })}
      <span className="camera-note">{camera.description}</span>
      <span className="camera-hint">
        {camera.mode === 'firstPerson'
          ? 'Arrows/WASD walk · drag to look'
          : 'Arrows/WASD pan'}
      </span>
    </div>
  );
}

export function Scene() {
  const plan = useFloorplanStore((state) => state.plan);
  const camera = useFloorplanStore((state) => state.camera);
  const variants = useFloorplanStore((state) => state.variants);
  const clearSelection = useFloorplanStore((state) => state.clearSelection);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Always show one proposal rather than making the human hunt for the hover
  // that reveals them. Clears itself when the variants are applied or dropped.
  useEffect(() => {
    setPreviewId(variants[0]?.id ?? null);
  }, [variants]);

  const preview = variants.find((variant) => variant.id === previewId);

  // Overhead views cut the walls down so the rooms are visible from outside;
  // walking through needs them full height.
  const wallHeight =
    camera.mode === 'firstPerson'
      ? plan.ceilingHeight
      : Math.min(plan.ceilingHeight, DOLLHOUSE_WALL_HEIGHT_IN);

  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  // Standing inside a room with open sky overhead reads as a model, not a room.
  const walkingThrough = camera.mode === 'firstPerson';

  return (
    <div className="viewport">
      <div className="viewport-canvas">
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        camera={{ fov: 50, near: 1, far: 5000, position: [500, 400, 500] }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
        onPointerMissed={() => {
          // A gesture's release often mismatches its press target, which r3f
          // reports as a miss; that echo must not clear the selection.
          if (!selectSuppressed()) {
            clearSelection();
          }
        }}
      >
        <color attach="background" args={['#171818']} />
        {/* Distance fade folds the ground's edge into the background instead
            of ending it at a visible horizon line. */}
        <fog attach="fog" args={['#171818', 1400, 4200]} />
        <Daylight plan={plan} />
        <Ground plan={plan} onClear={clearSelection} />

        {plan.rooms.map((room) => (
          <RoomFloor key={room.id} plan={plan} room={room} />
        ))}

        {walkingThrough
          ? plan.rooms.map((room) => (
              <RoomFloor key={`${room.id}-ceiling`} plan={plan} room={room} ceiling={plan.ceilingHeight} />
            ))
          : null}

        {plan.walls.map((wall) => (
          <WallPanel key={wall.id} plan={plan} wall={wall} wallHeight={wallHeight} />
        ))}

        {plan.openings.map((opening) => {
          const wall = wallsById.get(opening.wallId);
          return wall ? (
            <OpeningPane
              key={opening.id}
              plan={plan}
              opening={opening}
              wall={wall}
              wallHeight={wallHeight}
            />
          ) : null;
        })}

        {plan.furniture.map((item) => (
          <FurniturePiece key={item.id} item={item} wallHeight={wallHeight} />
        ))}

        {preview ? <VariantGhost plan={plan} variant={preview} wallHeight={wallHeight} /> : null}

        <CameraRig plan={plan} camera={camera} />

        {/* A procedural environment map: a bright soft ceiling, a warm window
            wall and a cool fill. This is what steel, porcelain and glass
            reflect. Built from Lightformers so nothing is fetched -- a CDN
            HDRI that fails to load would leave the scene flat again. */}
        <Environment resolution={256} frames={1} environmentIntensity={0.55}>
          <color attach="background" args={['#20232a']} />
          <Lightformer form="rect" intensity={3} position={[0, 400, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[600, 600, 1]} color="#f4efe4" />
          <Lightformer form="rect" intensity={2} position={[500, 120, 100]} rotation={[0, -Math.PI / 2, 0]} scale={[500, 180, 1]} color="#ffe8c8" />
          <Lightformer form="rect" intensity={1.2} position={[-500, 100, -100]} rotation={[0, Math.PI / 2, 0]} scale={[400, 150, 1]} color="#c9d6e8" />
        </Environment>

        {/* Ambient occlusion is the last mile: contact darkening where walls
            meet floors and under every piece. SMAA replaces MSAA (off below),
            and a light vignette settles the frame. */}
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={20} intensity={4} distanceFalloff={1} halfRes />
          {/* Only genuinely hot pixels bloom -- sun glints off steel, glass
              and counter clearcoat -- a soft halo, not a glow filter. */}
          <Bloom mipmapBlur luminanceThreshold={0.95} intensity={0.3} />
          <SMAA />
          <Vignette offset={0.28} darkness={0.5} />
        </EffectComposer>
      </Canvas>
      <CameraBar />
      <VariantBar previewId={previewId} onPreview={setPreviewId} />
      <SelectionActions />
      </div>
    </div>
  );
}
