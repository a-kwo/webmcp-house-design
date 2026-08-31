import { RoundedBox } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';

/**
 * Catalog furniture assembled from a handful of primitives, so a queen bed
 * reads as a bed rather than a tan crate. Everything is procedural -- no model
 * files to license, load, or fail on -- and every piece is parameterised by the
 * item's real footprint, so an agent placing a 48in-wide bed gets a 48in bed.
 *
 * Each model lives in a unit space: x and z span [-0.5, 0.5] of the footprint
 * (scaled by w and d), y is inches. The caller wraps it in a group carrying
 * position and rotation, exactly as the plain boxes were placed.
 */

const MATTRESS = '#e8e2d5';
const DUVET = '#b8c2cc';
const PILLOW = '#f2eee6';
const WOOD = '#8a7358';
const DARK_WOOD = '#6b5a45';
const FABRIC = '#a89c84';
const CUSHION = '#b6aa92';
const PORCELAIN = '#e9e7e2';
const STEEL = '#9fa3a7';
const COUNTER = '#d8d2c6';

type ModelProps = {
  w: number;
  d: number;
  h: number;
};

/** A box scaled to the piece's footprint; the shared building block. */
function Part({
  x = 0,
  y,
  z = 0,
  sx,
  sy,
  sz,
  color,
  roughness = 0.85,
}: {
  x?: number;
  y: number;
  z?: number;
  sx: number;
  sy: number;
  sz: number;
  color: string;
  roughness?: number;
}) {
  // Bevelled corners are most of the difference between furniture and
  // packing crates; the radius is capped so thin parts stay slab-shaped.
  const radius = Math.min(1.2, sx / 2, sy / 2, sz / 2) * 0.8;

  return (
    <RoundedBox position={[x, y, z]} args={[sx, sy, sz]} radius={radius} smoothness={3} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} />
    </RoundedBox>
  );
}

function Bed({ w, d, h }: ModelProps) {
  const frame = h * 0.45;
  const mattress = h * 0.35;

  return (
    <>
      <Part y={frame / 2} sx={w} sy={frame} sz={d} color={WOOD} />
      <Part y={frame + mattress / 2} sx={w * 0.96} sy={mattress} sz={d * 0.97} color={MATTRESS} roughness={0.95} />
      {/* Duvet over the foot two-thirds. */}
      <Part
        y={frame + mattress + h * 0.04}
        z={d * 0.17}
        sx={w * 0.98}
        sy={h * 0.1}
        sz={d * 0.66}
        color={DUVET}
        roughness={0.95}
      />
      {/* Headboard at the back (-z is the head; rotation 0 faces plan +y). */}
      <Part z={-d / 2 + 1.5} y={h * 0.8} sx={w} sy={h * 1.6} sz={3} color={DARK_WOOD} />
      <Part x={-w * 0.22} z={-d * 0.36} y={frame + mattress + h * 0.09} sx={w * 0.36} sy={h * 0.14} sz={d * 0.16} color={PILLOW} roughness={0.95} />
      <Part x={w * 0.22} z={-d * 0.36} y={frame + mattress + h * 0.09} sx={w * 0.36} sy={h * 0.14} sz={d * 0.16} color={PILLOW} roughness={0.95} />
    </>
  );
}

function Sofa({ w, d, h }: ModelProps) {
  const seat = h * 0.45;
  const arm = w * 0.12;

  return (
    <>
      <Part y={seat / 2} sx={w} sy={seat} sz={d} color={FABRIC} />
      {/* Back rest along -z; seat cushions face plan +y like the bed. */}
      <Part z={-d / 2 + d * 0.14} y={h * 0.62} sx={w} sy={h * 0.76} sz={d * 0.28} color={FABRIC} />
      <Part x={-w / 2 + arm / 2} y={h * 0.42} sx={arm} sy={h * 0.55} sz={d} color={FABRIC} />
      <Part x={w / 2 - arm / 2} y={h * 0.42} sx={arm} sy={h * 0.55} sz={d} color={FABRIC} />
      <Part x={-w * 0.19} z={d * 0.1} y={seat + h * 0.07} sx={w * 0.34} sy={h * 0.14} sz={d * 0.6} color={CUSHION} roughness={0.95} />
      <Part x={w * 0.19} z={d * 0.1} y={seat + h * 0.07} sx={w * 0.34} sy={h * 0.14} sz={d * 0.6} color={CUSHION} roughness={0.95} />
    </>
  );
}

function Toilet({ w, d, h }: ModelProps) {
  return (
    <>
      {/* Tank against -z, bowl forward of it. */}
      <Part z={-d / 2 + d * 0.14} y={h * 0.55} sx={w * 0.9} sy={h * 0.9} sz={d * 0.28} color={PORCELAIN} roughness={0.4} />
      <Part z={d * 0.12} y={h * 0.28} sx={w * 0.72} sy={h * 0.55} sz={d * 0.6} color={PORCELAIN} roughness={0.4} />
      <Part z={d * 0.12} y={h * 0.58} sx={w * 0.8} sy={h * 0.06} sz={d * 0.66} color={PORCELAIN} roughness={0.3} />
    </>
  );
}

function Sink({ w, d, h }: ModelProps) {
  return (
    <>
      <Part y={h * 0.45} sx={w * 0.24} sy={h * 0.9} sz={d * 0.24} color={PORCELAIN} roughness={0.4} />
      <Part y={h * 0.93} sx={w} sy={h * 0.14} sz={d} color={PORCELAIN} roughness={0.35} />
      <Part z={-d * 0.3} y={h * 1.05} sx={w * 0.08} sy={h * 0.24} sz={d * 0.12} color={STEEL} roughness={0.25} />
    </>
  );
}

function Island({ w, d, h }: ModelProps) {
  return (
    <>
      {/* Base inset for a toe kick, slab overhanging it. */}
      <Part y={(h - 3) / 2} sx={w * 0.92} sy={h - 3} sz={d * 0.88} color={WOOD} />
      <Part y={h - 1.5} sx={w} sy={3} sz={d} color={COUNTER} roughness={0.5} />
    </>
  );
}

function Range({ w, d, h }: ModelProps) {
  return (
    <>
      <Part y={h / 2 - 1} sx={w} sy={h - 2} sz={d} color={STEEL} roughness={0.45} />
      <Part y={h - 0.8} sx={w * 0.94} sy={1.6} sz={d * 0.94} color="#3a3a3a" roughness={0.6} />
      {/* Oven door face on +z, the front. */}
      <Part z={d / 2 - 0.6} y={h * 0.38} sx={w * 0.84} sy={h * 0.5} sz={1} color="#4a4a4a" roughness={0.35} />
    </>
  );
}

function Generic({ w, d, h }: ModelProps) {
  return <Part y={h / 2} sx={w} sy={h} sz={d} color={FABRIC} />;
}

const MODELS: Record<string, (props: ModelProps) => JSX.Element> = {
  'queen-bed': Bed,
  bed: Bed,
  sofa: Sofa,
  couch: Sofa,
  toilet: Toilet,
  sink: Sink,
  vanity: Sink,
  'kitchen-island': Island,
  table: Island,
  counter: Island,
  range: Range,
  dishwasher: Range,
};

/**
 * The world-space wrapper: position and Y-rotation come from the same
 * placement math the plain boxes used, so nothing about picking or layout
 * changes -- only what is drawn inside the group.
 */
export function FurnitureModel({
  catalogId,
  position,
  rotationY,
  w,
  d,
  h,
  selected,
  onClick,
  onPointerDown,
}: {
  catalogId: string;
  position: [number, number, number];
  rotationY: number;
  w: number;
  d: number;
  h: number;
  selected: boolean;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const Model = MODELS[catalogId] ?? Generic;

  return (
    // The group's y is the floor; models build upward from 0.
    <group
      position={[position[0], 0, position[2]]}
      rotation={[0, rotationY, 0]}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      <Model w={w} d={d} h={h} />
      {selected ? (
        // A translucent envelope over the whole piece, so selection reads the
        // same on a multi-part bed as it did on a single box.
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w + 2, h + 2, d + 2]} />
          <meshBasicMaterial color="#6ea8fe" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}
