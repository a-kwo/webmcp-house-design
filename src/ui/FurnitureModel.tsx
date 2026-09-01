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
const SCREEN = '#1c1e22';
const GLASS = '#b9d2dd';

type ModelProps = {
  w: number;
  d: number;
  h: number;
  /** Finish for the piece's primary surfaces; unset means the default look. */
  tint?: string;
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
  metalness = 0,
  emissive,
}: {
  x?: number;
  y: number;
  z?: number;
  sx: number;
  sy: number;
  sz: number;
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
}) {
  // Bevelled corners are most of the difference between furniture and
  // packing crates; the radius is capped so thin parts stay slab-shaped.
  const radius = Math.min(1.2, sx / 2, sy / 2, sz / 2) * 0.8;

  return (
    <RoundedBox position={[x, y, z]} args={[sx, sy, sz]} radius={radius} smoothness={3} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissive ? 0.55 : 0}
      />
    </RoundedBox>
  );
}

function Bed({ w, d, h, tint }: ModelProps) {
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
        color={tint ?? DUVET}
        roughness={0.95}
      />
      {/* Headboard at the back (-z is the head; rotation 0 faces plan +y). */}
      <Part z={-d / 2 + 1.5} y={h * 0.8} sx={w} sy={h * 1.6} sz={3} color={DARK_WOOD} />
      <Part x={-w * 0.22} z={-d * 0.36} y={frame + mattress + h * 0.09} sx={w * 0.36} sy={h * 0.14} sz={d * 0.16} color={PILLOW} roughness={0.95} />
      <Part x={w * 0.22} z={-d * 0.36} y={frame + mattress + h * 0.09} sx={w * 0.36} sy={h * 0.14} sz={d * 0.16} color={PILLOW} roughness={0.95} />
    </>
  );
}

function Sofa({ w, d, h, tint }: ModelProps) {
  const seat = h * 0.45;
  const arm = w * 0.12;

  return (
    <>
      <Part y={seat / 2} sx={w} sy={seat} sz={d} color={tint ?? FABRIC} />
      {/* Back rest along -z; seat cushions face plan +y like the bed. */}
      <Part z={-d / 2 + d * 0.14} y={h * 0.62} sx={w} sy={h * 0.76} sz={d * 0.28} color={tint ?? FABRIC} />
      <Part x={-w / 2 + arm / 2} y={h * 0.42} sx={arm} sy={h * 0.55} sz={d} color={tint ?? FABRIC} />
      <Part x={w / 2 - arm / 2} y={h * 0.42} sx={arm} sy={h * 0.55} sz={d} color={tint ?? FABRIC} />
      <Part x={-w * 0.19} z={d * 0.1} y={seat + h * 0.07} sx={w * 0.34} sy={h * 0.14} sz={d * 0.6} color={tint ?? CUSHION} roughness={0.95} />
      <Part x={w * 0.19} z={d * 0.1} y={seat + h * 0.07} sx={w * 0.34} sy={h * 0.14} sz={d * 0.6} color={tint ?? CUSHION} roughness={0.95} />
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
      <Part z={-d * 0.3} y={h * 1.05} sx={w * 0.08} sy={h * 0.24} sz={d * 0.12} color={STEEL} roughness={0.22} metalness={0.85} />
    </>
  );
}

function Island({ w, d, h, tint }: ModelProps) {
  return (
    <>
      {/* Freestanding: the slab overhangs an inset base on every side, with a
          toe kick and seat rail -- nothing touches a wall. */}
      <Part y={(h - 3) / 2 + 2} sx={w * 0.88} sy={h - 7} sz={d * 0.8} color={tint ?? WOOD} />
      <Part y={1.5} sx={w * 0.82} sy={3} sz={d * 0.74} color={DARK_WOOD} />
      <Part y={h - 1.5} sx={w} sy={3} sz={d} color={COUNTER} roughness={0.35} />
      <Part z={d * 0.4} y={h - 4.5} sx={w * 0.88} sy={1.2} sz={1.2} color={DARK_WOOD} />
    </>
  );
}

function Counter({ w, d, h, tint }: ModelProps) {
  const cabinet = tint ?? '#9b8c74';

  return (
    <>
      {/* A wall run: full-width cabinets on a toe kick, seamed doors on the
          front, and a backsplash standing up the wall side (-z). */}
      <Part y={(h - 3) / 2 + 2} sx={w} sy={h - 7} sz={d * 0.94} color={cabinet} />
      <Part y={1.5} z={-d * 0.03} sx={w * 0.94} sy={3} sz={d * 0.8} color={DARK_WOOD} />
      <Part y={h - 1.5} sx={w} sy={3} sz={d} color={COUNTER} roughness={0.35} />
      <Part z={-d / 2 + 0.8} y={h + 3} sx={w} sy={6} sz={1.6} color={COUNTER} roughness={0.4} />
      {[-0.25, 0, 0.25].map((seam) => (
        <Part key={seam} x={seam * w} z={d / 2 - 0.2} y={(h - 4) / 2 + 1} sx={0.6} sy={h - 10} sz={0.6} color={DARK_WOOD} />
      ))}
      <Part x={-w * 0.12} z={d / 2 + 0.6} y={h * 0.62} sx={w * 0.14} sy={1.1} sz={1.1} color={STEEL} roughness={0.22} metalness={0.85} />
      <Part x={w * 0.13} z={d / 2 + 0.6} y={h * 0.62} sx={w * 0.14} sy={1.1} sz={1.1} color={STEEL} roughness={0.22} metalness={0.85} />
    </>
  );
}

function DiningTable({ w, d, h, tint }: ModelProps) {
  const wood = tint ?? WOOD;

  return (
    <>
      <Part y={h - 1.2} sx={w} sy={2.4} sz={d} color={wood} roughness={0.5} />
      {[-1, 1].flatMap((lx) =>
        [-1, 1].map((lz) => (
          <Part key={`${lx}${lz}`} x={lx * (w / 2 - 2.5)} z={lz * (d / 2 - 2.5)} y={(h - 2.4) / 2} sx={2.2} sy={h - 2.4} sz={2.2} color={DARK_WOOD} />
        )),
      )}
    </>
  );
}

function Range({ w, d, h, tint }: ModelProps) {
  const body = tint ?? STEEL;

  return (
    <>
      <Part y={h / 2 - 1} sx={w} sy={h - 2} sz={d} color={body} roughness={0.4} metalness={0.7} />
      {/* Cooktop with four burners. */}
      <Part y={h - 0.8} sx={w * 0.94} sy={1.6} sz={d * 0.94} color="#2e2e2e" roughness={0.6} />
      {[-1, 1].flatMap((bx) =>
        [-1, 1].map((bz) => (
          <mesh key={`${bx}${bz}`} position={[bx * w * 0.22, h + 0.4, bz * d * 0.2]} castShadow>
            <cylinderGeometry args={[w * 0.13, w * 0.13, 0.8, 20]} />
            <meshStandardMaterial color="#1b1b1b" roughness={0.7} />
          </mesh>
        )),
      )}
      {/* Control ledge at the back with knobs. */}
      <Part z={-d / 2 + 1.2} y={h + 2.5} sx={w} sy={5} sz={2.4} color={body} roughness={0.35} metalness={0.7} />
      {[-0.3, -0.1, 0.1, 0.3].map((kx) => (
        <mesh key={kx} position={[kx * w, h + 2.5, -d / 2 + 2.6]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[1.1, 1.1, 0.8, 12]} />
          <meshStandardMaterial color="#1f1f1f" roughness={0.5} />
        </mesh>
      ))}
      {/* Oven door: window, and a bar handle. */}
      <Part z={d / 2 - 0.6} y={h * 0.35} sx={w * 0.88} sy={h * 0.42} sz={1} color="#3a3a3a" roughness={0.35} />
      <Part z={d / 2 + 0.1} y={h * 0.38} sx={w * 0.6} sy={h * 0.22} sz={0.6} color="#141414" roughness={0.15} />
      <Part z={d / 2 + 1.4} y={h * 0.62} sx={w * 0.8} sy={1.6} sz={1.6} color={STEEL} roughness={0.22} metalness={0.85} />
    </>
  );
}

function Television({ w, d, h, tint }: ModelProps) {
  const cabinet = h * 0.42;

  return (
    <>
      <Part y={cabinet / 2} sx={w} sy={cabinet} sz={d} color={tint ?? DARK_WOOD} />
      {/* Panel leans against the back edge; the screen faces +z, the front. */}
      <Part z={-d * 0.15} y={cabinet + h * 0.28} sx={w * 0.82} sy={h * 0.52} sz={2} color={SCREEN} roughness={0.2} emissive="#1a2733" />
      <Part z={-d * 0.15} y={cabinet + h * 0.04} sx={w * 0.2} sy={h * 0.06} sz={d * 0.4} color={STEEL} />
    </>
  );
}

function Fridge({ w, d, h, tint }: ModelProps) {
  const split = h * 0.68;

  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={tint ?? STEEL} roughness={0.3} metalness={0.75} />
      {/* Freezer seam and two door handles on the +z face. */}
      <Part z={d / 2 + 0.2} y={split} sx={w * 0.96} sy={1} sz={0.8} color="#7d8184" />
      <Part x={w * 0.32} z={d / 2 + 1.2} y={split + h * 0.12} sx={1.5} sy={h * 0.2} sz={1.5} color="#c9cccf" roughness={0.22} metalness={0.85} />
      <Part x={w * 0.32} z={d / 2 + 1.2} y={split - h * 0.16} sx={1.5} sy={h * 0.24} sz={1.5} color="#c9cccf" roughness={0.22} metalness={0.85} />
    </>
  );
}

function Desk({ w, d, h, tint }: ModelProps) {
  return (
    <>
      <Part y={h - 1} sx={w} sy={2} sz={d} color={tint ?? WOOD} roughness={0.6} />
      <Part x={-w / 2 + 1.5} y={(h - 2) / 2} sx={3} sy={h - 2} sz={d * 0.9} color={DARK_WOOD} />
      <Part x={w / 2 - 1.5} y={(h - 2) / 2} sx={3} sy={h - 2} sz={d * 0.9} color={DARK_WOOD} />
    </>
  );
}

function Chair({ w, d, h, tint }: ModelProps) {
  const seat = h * 0.55;

  return (
    <>
      <Part y={seat} sx={w} sy={2.5} sz={d} color={tint ?? WOOD} />
      <Part z={-d / 2 + 1} y={seat + h * 0.28} sx={w} sy={h * 0.5} sz={2} color={tint ?? WOOD} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <Part key={`${sx}${sz}`} x={sx * (w / 2 - 1.2)} z={sz * (d / 2 - 1.2)} y={seat / 2} sx={2} sy={seat} sz={2} color={DARK_WOOD} />
        )),
      )}
    </>
  );
}

function Bookshelf({ w, d, h, tint }: ModelProps) {
  const shelves = 4;

  return (
    <>
      <Part z={-d / 2 + 0.6} y={h / 2} sx={w} sy={h} sz={1.2} color={DARK_WOOD} />
      <Part x={-w / 2 + 1} y={h / 2} sx={2} sy={h} sz={d} color={tint ?? WOOD} />
      <Part x={w / 2 - 1} y={h / 2} sx={2} sy={h} sz={d} color={tint ?? WOOD} />
      <Part y={h - 1} sx={w} sy={2} sz={d} color={tint ?? WOOD} />
      {Array.from({ length: shelves }, (_, index) => (
        <Part key={index} y={((index + 0.5) / shelves) * (h - 2)} sx={w - 4} sy={1.5} sz={d - 1} color={tint ?? WOOD} />
      ))}
    </>
  );
}

function Nightstand({ w, d, h, tint }: ModelProps) {
  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={tint ?? WOOD} />
      <Part z={d / 2 + 0.3} y={h * 0.68} sx={w * 0.8} sy={h * 0.28} sz={0.8} color={DARK_WOOD} />
      <Part z={d / 2 + 1} y={h * 0.68} sx={w * 0.3} sy={1.2} sz={1.2} color={STEEL} roughness={0.25} metalness={0.85} />
    </>
  );
}

function Wardrobe({ w, d, h, tint }: ModelProps) {
  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={tint ?? WOOD} />
      {/* Centre seam and a handle either side of it. */}
      <Part z={d / 2 + 0.2} y={h / 2} sx={0.8} sy={h * 0.96} sz={0.8} color={DARK_WOOD} />
      <Part x={-w * 0.06} z={d / 2 + 1} y={h * 0.52} sx={1.2} sy={h * 0.16} sz={1.2} color={STEEL} roughness={0.25} metalness={0.85} />
      <Part x={w * 0.06} z={d / 2 + 1} y={h * 0.52} sx={1.2} sy={h * 0.16} sz={1.2} color={STEEL} roughness={0.25} metalness={0.85} />
    </>
  );
}

function Tub({ w, d, h }: ModelProps) {
  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={PORCELAIN} roughness={0.35} />
      {/* The basin: a darker inset below the rim. */}
      <Part y={h - 1} sx={w - 6} sy={1.4} sz={d - 6} color="#cfccc4" roughness={0.3} />
      <Part y={h - 0.4} sx={w} sy={1} sz={d} color={PORCELAIN} roughness={0.3} />
    </>
  );
}

function Shower({ w, d, h }: ModelProps) {
  return (
    <>
      <Part y={2} sx={w} sy={4} sz={d} color={PORCELAIN} roughness={0.4} />
      {/* Glass on the two open sides; the back corner is against the walls. */}
      <mesh position={[0, h / 2 + 2, d / 2 - 0.5]} castShadow>
        <boxGeometry args={[w, h - 4, 1]} />
        <meshStandardMaterial color={GLASS} transparent opacity={0.25} roughness={0.05} />
      </mesh>
      <mesh position={[w / 2 - 0.5, h / 2 + 2, 0]} castShadow>
        <boxGeometry args={[1, h - 4, d]} />
        <meshStandardMaterial color={GLASS} transparent opacity={0.25} roughness={0.05} />
      </mesh>
      <Part z={-d / 2 + 2} y={h * 0.9} sx={2} sy={2} sz={8} color={STEEL} roughness={0.22} metalness={0.85} />
    </>
  );
}

function Washer({ w, d, h, tint }: ModelProps) {
  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={tint ?? '#e3e1dc'} roughness={0.4} />
      {/* Porthole door on the front. */}
      <mesh position={[0, h * 0.48, d / 2 + 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[w * 0.3, w * 0.3, 1.2, 24]} />
        <meshStandardMaterial color={SCREEN} roughness={0.2} />
      </mesh>
      <Part y={h - 2} z={d / 2 + 0.2} sx={w * 0.9} sy={3} sz={0.8} color="#b9b6b0" />
    </>
  );
}

/**
 * A wall-mounted screen: no cabinet, hung high with a bracket behind it. The
 * panel occupies the top 30in of the item's height, so h = 74 puts the screen
 * from 44in to 74in -- eye height from a sofa.
 */
function WallTelevision({ w, h }: ModelProps) {
  const panel = 30;

  return (
    <>
      <Part z={-1} y={h - panel / 2} sx={w} sy={panel} sz={2} color={SCREEN} roughness={0.2} emissive="#1a2733" />
      <Part z={-2.2} y={h - panel / 2} sx={w * 0.2} sy={panel * 0.4} sz={2} color={STEEL} />
    </>
  );
}

function Generic({ w, d, h, tint }: ModelProps) {
  return <Part y={h / 2} sx={w} sy={h} sz={d} color={tint ?? FABRIC} />;
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
  table: DiningTable,
  counter: Counter,
  range: Range,
  dishwasher: Range,
  'tv-stand': Television,
  tv: Television,
  'tv-wall': WallTelevision,
  fridge: Fridge,
  refrigerator: Fridge,
  desk: Desk,
  chair: Chair,
  bookshelf: Bookshelf,
  nightstand: Nightstand,
  dresser: Nightstand,
  wardrobe: Wardrobe,
  closet: Wardrobe,
  tub: Tub,
  bath: Tub,
  bathtub: Tub,
  shower: Shower,
  washer: Washer,
  dryer: Washer,
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
  tint,
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
  tint?: string;
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
      <Model w={w} d={d} h={h} tint={tint} />
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
