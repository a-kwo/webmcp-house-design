import { RoundedBox } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';

/**
 * Catalog furniture assembled from primitives, so a queen bed reads as a bed
 * rather than a tan crate. Everything is procedural -- no model files to
 * license, load, or fail on -- and every piece is parameterised by the item's
 * real footprint, so an agent placing a 48in-wide bed gets a 48in bed.
 *
 * The realism budget goes where the eye goes: legs that lift bodies off the
 * floor, cushions plumper than their frames, hardware (knobs, bar handles,
 * faucets) in polished metal, glossy screens with bezels, books on the
 * shelves. Silhouette and material contrast carry a piece; micro-geometry
 * that would never survive room scale is skipped.
 *
 * Each model lives in a footprint frame: x and z are centred inches (spanning
 * w and d), y is inches up from the floor. The caller wraps it in a group
 * carrying position and rotation. +z is the piece's front.
 */

const MATTRESS = '#ede8dd';
const DUVET = '#b8c2cc';
const PILLOW = '#f4f0e8';
const WOOD = '#8a7358';
const DARK_WOOD = '#5d4d3b';
const FABRIC = '#a89c84';
const CUSHION = '#b6aa92';
const PORCELAIN = '#eceae5';
const STEEL = '#9fa3a7';
const CHROME = '#c9cdd1';
const COUNTER = '#d8d2c6';
const SCREEN = '#0e1013';
const BEZEL = '#1c1e21';
const GLASS = '#b9d2dd';

type ModelProps = {
  w: number;
  d: number;
  h: number;
  /** Finish for the piece's primary surfaces; unset means the default look. */
  tint?: string;
};

type Vec3 = [number, number, number];

/** A rounded box scaled to the piece's footprint; the shared building block. */
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
  radius,
  rotation,
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
  /** Corner radius override; upholstery wants plumper corners than casework. */
  radius?: number;
  rotation?: Vec3;
}) {
  // Bevelled corners are most of the difference between furniture and
  // packing crates; the radius is capped so thin parts stay slab-shaped.
  const r = Math.min(radius ?? 1.2, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01);

  return (
    <RoundedBox
      position={[x, y, z]}
      rotation={rotation ?? [0, 0, 0]}
      args={[sx, sy, sz]}
      radius={Math.max(r, 0.01)}
      smoothness={3}
      castShadow
      receiveShadow
    >
      {/* Brushed steel lives on its reflections; matte surfaces mostly on
          their shading. Scaling environment pickup with metalness keeps one
          material doing both without hand-tuning every part. */}
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        envMapIntensity={0.4 + metalness * 0.9}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissive ? 0.55 : 0}
      />
    </RoundedBox>
  );
}

/** A cylinder part: legs, knobs, faucets, burners. */
function Cyl({
  x = 0,
  y,
  z = 0,
  rTop,
  rBottom,
  height,
  color,
  roughness = 0.5,
  metalness = 0,
  segments = 20,
  rotation,
}: {
  x?: number;
  y: number;
  z?: number;
  rTop: number;
  rBottom?: number;
  height: number;
  color: string;
  roughness?: number;
  metalness?: number;
  segments?: number;
  rotation?: Vec3;
}) {
  return (
    <mesh position={[x, y, z]} rotation={rotation ?? [0, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[rTop, rBottom ?? rTop, height, segments]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        envMapIntensity={0.4 + metalness * 0.9}
      />
    </mesh>
  );
}

/** Four tapered wooden legs under a body's corners. */
function Legs({ w, d, height, inset = 3, color = DARK_WOOD }: { w: number; d: number; height: number; inset?: number; color?: string }) {
  return (
    <>
      {[-1, 1].flatMap((lx) =>
        [-1, 1].map((lz) => (
          <Cyl
            key={`${lx}${lz}`}
            x={lx * (w / 2 - inset)}
            z={lz * (d / 2 - inset)}
            y={height / 2}
            rTop={1.3}
            rBottom={0.8}
            height={height}
            color={color}
            roughness={0.55}
          />
        )),
      )}
    </>
  );
}

/** A glossy display panel with a thin bezel, screen facing +z. */
function ScreenPanel({ x = 0, y, z = 0, sw, sh }: { x?: number; y: number; z?: number; sw: number; sh: number }) {
  return (
    <>
      <Part x={x} y={y} z={z} sx={sw} sy={sh} sz={1.6} color={BEZEL} roughness={0.4} radius={0.6} />
      {/* The lit pane sits proud of the bezel by a hair; near-mirror
          roughness so it reflects the room like switched-off glass. */}
      <mesh position={[x, y, z + 0.85]} castShadow>
        <boxGeometry args={[sw - 1.6, sh - 1.6, 0.2]} />
        <meshStandardMaterial
          color={SCREEN}
          roughness={0.04}
          metalness={0.4}
          envMapIntensity={1.6}
          emissive="#141d28"
          emissiveIntensity={0.35}
        />
      </mesh>
    </>
  );
}

function Bed({ w, d, h, tint }: ModelProps) {
  const legs = 5;
  const frame = h * 0.3;
  const mattress = h * 0.4;
  const mattressTop = legs + frame + mattress;

  return (
    <>
      <Legs w={w} d={d} height={legs} />
      <Part y={legs + frame / 2} sx={w} sy={frame} sz={d} color={WOOD} roughness={0.6} />
      <Part y={legs + frame + mattress / 2} sx={w * 0.97} sy={mattress} sz={d * 0.98} color={MATTRESS} roughness={0.95} radius={2.4} />
      {/* Duvet over the foot two-thirds, draping past the mattress sides,
          with a rolled fold line at its head edge. */}
      <Part y={mattressTop - mattress * 0.1} z={d * 0.19} sx={w * 1.02} sy={mattress * 0.42} sz={d * 0.62} color={tint ?? DUVET} roughness={0.95} radius={2.2} />
      <Part y={mattressTop + mattress * 0.12} z={-d * 0.115} sx={w * 1.02} sy={2.2} sz={5} color={tint ?? DUVET} roughness={0.95} radius={1} />
      {/* Headboard: a tall rounded panel behind the pillows. */}
      <Part z={-d / 2 + 1.5} y={h * 0.62} sx={w + 2} sy={h * 1.25} sz={3} color={DARK_WOOD} roughness={0.6} radius={1.4} />
      {/* Pillows, each lounging at its own slight angle. */}
      <Part x={-w * 0.22} z={-d * 0.37} y={mattressTop + 2.2} sx={w * 0.36} sy={5} sz={d * 0.17} color={PILLOW} roughness={0.95} radius={2.2} rotation={[0.14, 0.05, 0]} />
      <Part x={w * 0.22} z={-d * 0.37} y={mattressTop + 2.2} sx={w * 0.36} sy={5} sz={d * 0.17} color={PILLOW} roughness={0.95} radius={2.2} rotation={[0.12, -0.04, 0]} />
    </>
  );
}

function Sofa({ w, d, h, tint }: ModelProps) {
  const legs = 4;
  const base = h * 0.28;
  const seatTop = legs + base + h * 0.16;
  const arm = w * 0.11;
  const body = tint ?? FABRIC;
  const cushions = w > 70 ? 3 : 2;
  const cushionW = (w - arm * 2 - 2) / cushions;

  return (
    <>
      <Legs w={w} d={d} height={legs} inset={2.5} />
      {/* Frame, then plump seat and back cushions overhanging it. */}
      <Part y={legs + base / 2} sx={w} sy={base} sz={d} color={body} roughness={0.95} radius={1.6} />
      <Part z={-d / 2 + d * 0.12} y={legs + h * 0.52} sx={w} sy={h * 0.72} sz={d * 0.24} color={body} roughness={0.95} radius={2.2} />
      <Part x={-w / 2 + arm / 2} y={legs + h * 0.36} sx={arm} sy={h * 0.58} sz={d} color={body} roughness={0.95} radius={2.6} />
      <Part x={w / 2 - arm / 2} y={legs + h * 0.36} sx={arm} sy={h * 0.58} sz={d} color={body} roughness={0.95} radius={2.6} />
      {Array.from({ length: cushions }, (_, index) => {
        const x = -w / 2 + arm + 1 + cushionW * (index + 0.5);
        return (
          <group key={index}>
            <Part x={x} z={d * 0.08} y={seatTop - h * 0.08} sx={cushionW - 1.2} sy={h * 0.16} sz={d * 0.62} color={CUSHION} roughness={0.95} radius={2.8} />
            <Part x={x} z={-d / 2 + d * 0.16} y={legs + h * 0.56} sx={cushionW - 1.2} sy={h * 0.5} sz={d * 0.16} color={CUSHION} roughness={0.95} radius={2.8} rotation={[-0.08, 0, 0]} />
          </group>
        );
      })}
      {/* Throw pillows propped into the corners. */}
      <Part x={-w / 2 + arm + 5} z={-d * 0.14} y={seatTop + 3} sx={13} sy={13} sz={4.5} color={tint ? CUSHION : '#8a6f55'} roughness={0.95} radius={2.4} rotation={[-0.2, 0.35, 0.1]} />
      <Part x={w / 2 - arm - 5} z={-d * 0.14} y={seatTop + 3} sx={13} sy={13} sz={4.5} color={tint ? CUSHION : '#5f6b5c'} roughness={0.95} radius={2.4} rotation={[-0.2, -0.3, -0.08]} />
    </>
  );
}

function Toilet({ w, d, h }: ModelProps) {
  const bowlTop = h * 0.55;

  return (
    <>
      {/* Pedestal, elliptical bowl, seat ring and a lid standing off the
          tank; porcelain runs slightly glossy. */}
      <Cyl z={d * 0.1} y={bowlTop * 0.35} rTop={w * 0.28} rBottom={w * 0.2} height={bowlTop * 0.7} color={PORCELAIN} roughness={0.25} segments={24} />
      <mesh position={[0, bowlTop - 2.5, d * 0.12]} scale={[1, 1, 1.25]} castShadow receiveShadow>
        <cylinderGeometry args={[w * 0.36, w * 0.3, 5, 24]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.25} envMapIntensity={0.7} />
      </mesh>
      <mesh position={[0, bowlTop + 0.4, d * 0.12]} scale={[1, 1, 1.25]} castShadow>
        <cylinderGeometry args={[w * 0.37, w * 0.37, 1, 24]} />
        <meshStandardMaterial color="#f6f4ef" roughness={0.3} envMapIntensity={0.7} />
      </mesh>
      {/* Tank with its lid and flush button. */}
      <Part z={-d / 2 + d * 0.14} y={h * 0.55} sx={w * 0.92} sy={h * 0.66} sz={d * 0.26} color={PORCELAIN} roughness={0.25} radius={1.6} />
      <Part z={-d / 2 + d * 0.14} y={h * 0.9} sx={w * 0.98} sy={h * 0.08} sz={d * 0.3} color={PORCELAIN} roughness={0.25} radius={1} />
      <Cyl z={-d / 2 + d * 0.14} y={h * 0.95} rTop={1.6} height={0.8} color={CHROME} metalness={0.85} roughness={0.2} />
    </>
  );
}

function Sink({ w, d, h }: ModelProps) {
  return (
    <>
      {/* Pedestal column and a basin bowl; chrome gooseneck faucet. */}
      <Cyl y={h * 0.42} rTop={w * 0.13} rBottom={w * 0.19} height={h * 0.84} color={PORCELAIN} roughness={0.25} segments={24} />
      <mesh position={[0, h * 0.88, 0]} scale={[1, 1, d / w]} castShadow receiveShadow>
        <cylinderGeometry args={[w * 0.5, w * 0.34, h * 0.14, 28]} />
        <meshStandardMaterial color={PORCELAIN} roughness={0.22} envMapIntensity={0.8} />
      </mesh>
      <Cyl z={-d * 0.3} y={h * 0.98} rTop={0.8} height={h * 0.14} color={CHROME} metalness={0.9} roughness={0.15} />
      <Cyl z={-d * 0.24} y={h * 1.05} rTop={0.6} height={d * 0.16} color={CHROME} metalness={0.9} roughness={0.15} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl x={-w * 0.14} z={-d * 0.3} y={h * 0.93} rTop={1} height={1.2} color={CHROME} metalness={0.9} roughness={0.15} />
      <Cyl x={w * 0.14} z={-d * 0.3} y={h * 0.93} rTop={1} height={1.2} color={CHROME} metalness={0.9} roughness={0.15} />
    </>
  );
}

function Island({ w, d, h, tint }: ModelProps) {
  return (
    <>
      {/* Freestanding: the slab overhangs an inset base on every side, with a
          toe kick and seat rail -- nothing touches a wall. */}
      <Part y={(h - 3) / 2 + 2} sx={w * 0.88} sy={h - 7} sz={d * 0.8} color={tint ?? WOOD} roughness={0.7} />
      <Part y={1.5} sx={w * 0.82} sy={3} sz={d * 0.74} color={DARK_WOOD} />
      <Part y={h - 1.5} sx={w} sy={3} sz={d} color={COUNTER} roughness={0.25} radius={0.8} />
      <Part z={d * 0.4} y={h - 4.5} sx={w * 0.88} sy={1.2} sz={1.2} color={DARK_WOOD} />
      {/* Service side: two door fronts and a drawer with bar pulls. */}
      {[-0.22, 0.22].map((seam) => (
        <Part key={seam} x={seam * w} z={-d * 0.4 - 0.4} y={(h - 10) / 2 + 2} sx={w * 0.38} sy={h - 14} sz={0.8} color={tint ?? WOOD} roughness={0.65} radius={0.4} />
      ))}
      {[-0.22, 0.22].map((seam) => (
        <Cyl key={seam} x={seam * w} z={-d * 0.4 - 1.4} y={h - 8} rTop={0.5} height={w * 0.16} color={CHROME} metalness={0.85} roughness={0.2} rotation={[0, 0, Math.PI / 2]} />
      ))}
    </>
  );
}

function Counter({ w, d, h, tint }: ModelProps) {
  const cabinet = tint ?? '#9b8c74';

  return (
    <>
      {/* A wall run: full-width cabinets on a toe kick, seamed doors on the
          front, and a backsplash standing up the wall side (-z). */}
      <Part y={(h - 3) / 2 + 2} sx={w} sy={h - 7} sz={d * 0.94} color={cabinet} roughness={0.7} />
      <Part y={1.5} z={-d * 0.03} sx={w * 0.94} sy={3} sz={d * 0.8} color={DARK_WOOD} />
      <Part y={h - 1.5} sx={w} sy={3} sz={d} color={COUNTER} roughness={0.25} radius={0.8} />
      <Part z={-d / 2 + 0.8} y={h + 3} sx={w} sy={6} sz={1.6} color={COUNTER} roughness={0.3} />
      {[-0.25, 0, 0.25].map((seam) => (
        <Part key={seam} x={seam * w} z={d / 2 - 0.2} y={(h - 4) / 2 + 1} sx={0.6} sy={h - 10} sz={0.6} color={DARK_WOOD} />
      ))}
      {[-0.12, 0.13].map((pull) => (
        <Cyl key={pull} x={pull * w} z={d / 2 + 0.6} y={h * 0.62} rTop={0.5} height={w * 0.12} color={CHROME} metalness={0.85} roughness={0.2} rotation={[0, 0, Math.PI / 2]} />
      ))}
    </>
  );
}

function DiningTable({ w, d, h, tint }: ModelProps) {
  const wood = tint ?? WOOD;

  return (
    <>
      {/* A slab top with a soft edge over an apron, on tapered round legs. */}
      <Part y={h - 1.2} sx={w} sy={2.4} sz={d} color={wood} roughness={0.45} radius={0.9} />
      <Part y={h - 4} sx={w - 7} sy={3} sz={d - 7} color={wood} roughness={0.55} />
      {[-1, 1].flatMap((lx) =>
        [-1, 1].map((lz) => (
          <Cyl
            key={`${lx}${lz}`}
            x={lx * (w / 2 - 4)}
            z={lz * (d / 2 - 4)}
            y={(h - 2.4) / 2}
            rTop={1.6}
            rBottom={1}
            height={h - 2.4}
            color={DARK_WOOD}
            roughness={0.55}
          />
        )),
      )}
    </>
  );
}

function Range({ w, d, h, tint }: ModelProps) {
  const body = tint ?? STEEL;

  return (
    <>
      <Part y={h / 2 - 1} sx={w} sy={h - 2} sz={d} color={body} roughness={0.35} metalness={0.7} />
      {/* Cooktop: four burners, each with a grate ring. */}
      <Part y={h - 0.8} sx={w * 0.94} sy={1.6} sz={d * 0.94} color="#26262a" roughness={0.5} />
      {[-1, 1].flatMap((bx) =>
        [-1, 1].map((bz) => (
          <group key={`${bx}${bz}`}>
            <Cyl x={bx * w * 0.22} y={h + 0.3} z={bz * d * 0.2} rTop={w * 0.12} height={0.6} color="#141416" roughness={0.6} />
            <mesh position={[bx * w * 0.22, h + 0.7, bz * d * 0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[w * 0.1, 0.5, 8, 24]} />
              <meshStandardMaterial color="#3a3a3e" roughness={0.5} metalness={0.5} envMapIntensity={0.8} />
            </mesh>
          </group>
        )),
      )}
      {/* Control ledge at the back with knobs. */}
      <Part z={-d / 2 + 1.2} y={h + 2.5} sx={w} sy={5} sz={2.4} color={body} roughness={0.3} metalness={0.7} />
      {[-0.3, -0.1, 0.1, 0.3].map((kx) => (
        <Cyl key={kx} x={kx * w} y={h + 2.5} z={-d / 2 + 2.6} rTop={1.1} height={0.8} color="#1f1f1f" roughness={0.45} rotation={[Math.PI / 2, 0, 0]} />
      ))}
      {/* Oven door: brushed front, glossy window, chrome bar handle. */}
      <Part z={d / 2 - 0.6} y={h * 0.35} sx={w * 0.88} sy={h * 0.42} sz={1} color="#3a3a3e" roughness={0.35} metalness={0.5} />
      <Part z={d / 2 + 0.1} y={h * 0.38} sx={w * 0.6} sy={h * 0.22} sz={0.6} color={SCREEN} roughness={0.06} metalness={0.3} />
      <Cyl z={d / 2 + 1.6} y={h * 0.62} rTop={0.8} height={w * 0.8} color={CHROME} metalness={0.85} roughness={0.18} rotation={[0, 0, Math.PI / 2]} />
    </>
  );
}

function Television({ w, d, h, tint }: ModelProps) {
  const cabinet = h * 0.4;
  const legH = 3;

  return (
    <>
      {/* Media console on angled legs: two door fronts with a shadow gap. */}
      <Legs w={w} d={d} height={legH} inset={2.5} />
      <Part y={legH + (cabinet - legH) / 2} sx={w} sy={cabinet - legH} sz={d} color={tint ?? DARK_WOOD} roughness={0.55} radius={0.9} />
      {[-0.24, 0.24].map((door) => (
        <Part key={door} x={door * w} z={d / 2 + 0.15} y={legH + (cabinet - legH) / 2} sx={w * 0.44} sy={cabinet - legH - 3} sz={0.5} color={tint ?? WOOD} roughness={0.6} radius={0.4} />
      ))}
      {/* The panel on its centre column and foot. */}
      <Cyl y={cabinet + h * 0.06} rTop={1.4} height={h * 0.12} color={BEZEL} roughness={0.4} metalness={0.5} />
      <Part y={cabinet + 0.8} sx={w * 0.28} sy={1.2} sz={d * 0.5} color={BEZEL} roughness={0.4} metalness={0.5} radius={0.5} />
      <ScreenPanel y={cabinet + h * 0.12 + h * 0.26} z={0.4} sw={w * 0.86} sh={h * 0.52} />
    </>
  );
}

function Fridge({ w, d, h, tint }: ModelProps) {
  const split = h * 0.66;
  const body = tint ?? STEEL;

  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={body} roughness={0.3} metalness={0.75} />
      {/* Door fronts sit a hair proud so their shadow line reads. */}
      <Part z={d / 2 + 0.25} y={split + (h - split) / 2 - 1} sx={w - 1.6} sy={h - split - 2.4} sz={0.5} color={body} roughness={0.28} metalness={0.75} radius={0.6} />
      <Part z={d / 2 + 0.25} y={split / 2 + 0.6} sx={w - 1.6} sy={split - 2.8} sz={0.5} color={body} roughness={0.28} metalness={0.75} radius={0.6} />
      {/* Recessed water dispenser in the upper door. */}
      <Part x={-w * 0.18} z={d / 2 + 0.45} y={split + (h - split) * 0.42} sx={w * 0.26} sy={(h - split) * 0.5} sz={0.4} color="#2c2e30" roughness={0.6} />
      {/* Long bar handles. */}
      <Cyl x={w * 0.34} z={d / 2 + 1.6} y={split + (h - split) * 0.5} rTop={0.7} height={(h - split) * 0.66} color={CHROME} metalness={0.85} roughness={0.18} />
      <Cyl x={w * 0.34} z={d / 2 + 1.6} y={split * 0.68} rTop={0.7} height={split * 0.5} color={CHROME} metalness={0.85} roughness={0.18} />
      <Part y={1.2} z={d / 2 - 0.5} sx={w - 2} sy={2.4} sz={1} color="#242527" roughness={0.7} />
    </>
  );
}

function Desk({ w, d, h, tint }: ModelProps) {
  const wood = tint ?? WOOD;

  return (
    <>
      <Part y={h - 1} sx={w} sy={2} sz={d} color={wood} roughness={0.5} radius={0.8} />
      {/* Drawer pedestal on the right, slim steel legs on the left. */}
      <Part x={w / 2 - w * 0.16} y={(h - 2) / 2} sx={w * 0.3} sy={h - 2.5} sz={d * 0.92} color={wood} roughness={0.6} />
      {[0.3, 0.62].map((row) => (
        <group key={row}>
          <Part x={w / 2 - w * 0.16} z={d / 2 - 0.4} y={(h - 2.5) * row} sx={w * 0.26} sy={(h - 2.5) * 0.26} sz={0.5} color={DARK_WOOD} roughness={0.55} radius={0.4} />
          <Cyl x={w / 2 - w * 0.16} z={d / 2 + 0.4} y={(h - 2.5) * row} rTop={0.45} height={w * 0.1} color={CHROME} metalness={0.85} roughness={0.2} rotation={[0, 0, Math.PI / 2]} />
        </group>
      ))}
      <Cyl x={-w / 2 + 2} z={d / 2 - 2} y={(h - 2) / 2} rTop={0.9} height={h - 2} color="#4a4c4e" metalness={0.6} roughness={0.35} />
      <Cyl x={-w / 2 + 2} z={-d / 2 + 2} y={(h - 2) / 2} rTop={0.9} height={h - 2} color="#4a4c4e" metalness={0.6} roughness={0.35} />
      <Part x={-w / 2 + 2} y={1} sx={2.4} sy={1.4} sz={d - 3} color="#4a4c4e" metalness={0.6} roughness={0.35} />
    </>
  );
}

function Chair({ w, d, h, tint }: ModelProps) {
  const seat = h * 0.52;
  const wood = tint ?? WOOD;

  return (
    <>
      {[-1, 1].flatMap((lx) =>
        [-1, 1].map((lz) => (
          <Cyl key={`${lx}${lz}`} x={lx * (w / 2 - 1.6)} z={lz * (d / 2 - 1.6)} y={seat / 2} rTop={1} rBottom={0.7} height={seat} color={DARK_WOOD} roughness={0.55} />
        )),
      )}
      <Part y={seat} sx={w} sy={2.2} sz={d} color={wood} roughness={0.55} radius={1} />
      <Part y={seat + 1.8} sx={w * 0.88} sy={1.6} sz={d * 0.88} color={CUSHION} roughness={0.95} radius={0.8} />
      {/* Back rest leans a few degrees, with two horizontal slats. */}
      <group position={[0, 0, -d / 2 + 1]} rotation={[-0.09, 0, 0]}>
        <Cyl x={-w / 2 + 1.6} y={seat + h * 0.24} rTop={0.9} rBottom={1} height={h * 0.48} color={wood} roughness={0.55} />
        <Cyl x={w / 2 - 1.6} y={seat + h * 0.24} rTop={0.9} rBottom={1} height={h * 0.48} color={wood} roughness={0.55} />
        <Part y={seat + h * 0.42} sx={w - 2} sy={h * 0.12} sz={1.6} color={wood} roughness={0.55} radius={0.7} />
        <Part y={seat + h * 0.26} sx={w - 2} sy={h * 0.06} sz={1.4} color={wood} roughness={0.55} radius={0.6} />
      </group>
    </>
  );
}

/** Deterministic small random, so shelves fill the same way every render. */
function pseudo(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const BOOK_COLORS = ['#7d4a3a', '#4a5a6e', '#5f6b52', '#8a774a', '#6e4a5e', '#3f4a44', '#9a8468', '#54423a'];

function Bookshelf({ w, d, h, tint }: ModelProps) {
  const shelves = 3;
  const wood = tint ?? WOOD;
  const bay = (h - 4) / shelves;

  return (
    <>
      <Part z={-d / 2 + 0.6} y={h / 2} sx={w} sy={h} sz={1.2} color={DARK_WOOD} roughness={0.65} />
      <Part x={-w / 2 + 1} y={h / 2} sx={2} sy={h} sz={d} color={wood} roughness={0.6} />
      <Part x={w / 2 - 1} y={h / 2} sx={2} sy={h} sz={d} color={wood} roughness={0.6} />
      <Part y={h - 1} sx={w} sy={2} sz={d} color={wood} roughness={0.6} />
      <Part y={1} sx={w} sy={2} sz={d} color={wood} roughness={0.6} />
      {Array.from({ length: shelves }, (_, index) => (
        <Part key={index} y={2 + bay * index + 0.75} sx={w - 4} sy={1.5} sz={d - 1} color={wood} roughness={0.6} />
      ))}
      {/* Books: rows of spines in varied heights and colours, with the odd
          horizontal stack. This is what makes it a bookshelf and not a crate
          with slots. */}
      {Array.from({ length: shelves }, (_, shelf) => {
        const rand = pseudo(17 + shelf * 7);
        const base = 2 + bay * shelf + 1.5;
        const spines: JSX.Element[] = [];
        let x = -w / 2 + 2.6;

        if (shelf === 1) {
          // A flat stack breaks the rhythm on the middle shelf.
          spines.push(
            <Part key="stack1" x={w / 2 - 7} y={base + 0.8} sx={7} sy={1.6} sz={d - 3.5} color={BOOK_COLORS[2]} roughness={0.8} radius={0.3} />,
            <Part key="stack2" x={w / 2 - 7.4} y={base + 2.3} sx={6.2} sy={1.4} sz={d - 4} color={BOOK_COLORS[6]} roughness={0.8} radius={0.3} />,
          );
        }
        const limit = shelf === 1 ? w / 2 - 11 : w / 2 - 3.2;

        while (x < limit) {
          const thickness = 0.9 + rand() * 1.3;
          const height = bay * (0.5 + rand() * 0.3);
          if (rand() > 0.88) {
            x += 2.5 + rand() * 3; // a gap, with a leaning book at its edge
            continue;
          }
          spines.push(
            <Part
              key={x}
              x={x + thickness / 2}
              y={base + height / 2}
              z={-0.4}
              sx={thickness}
              sy={height}
              sz={d - 3}
              color={BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]}
              roughness={0.85}
              radius={0.25}
            />,
          );
          x += thickness + 0.25;
        }
        return <group key={shelf}>{spines}</group>;
      })}
    </>
  );
}

function Nightstand({ w, d, h, tint }: ModelProps) {
  const legH = 4;
  const wood = tint ?? WOOD;

  return (
    <>
      <Legs w={w} d={d} height={legH} inset={2} />
      <Part y={legH + (h - legH) / 2} sx={w} sy={h - legH} sz={d} color={wood} roughness={0.6} radius={0.9} />
      <Part z={d / 2 + 0.2} y={legH + (h - legH) * 0.68} sx={w * 0.84} sy={(h - legH) * 0.3} sz={0.5} color={DARK_WOOD} roughness={0.55} radius={0.4} />
      <Part z={d / 2 + 0.2} y={legH + (h - legH) * 0.3} sx={w * 0.84} sy={(h - legH) * 0.3} sz={0.5} color={DARK_WOOD} roughness={0.55} radius={0.4} />
      <mesh position={[0, legH + (h - legH) * 0.68, d / 2 + 0.9]} castShadow>
        <sphereGeometry args={[0.9, 14, 14]} />
        <meshStandardMaterial color={CHROME} metalness={0.85} roughness={0.2} envMapIntensity={1.2} />
      </mesh>
      <mesh position={[0, legH + (h - legH) * 0.3, d / 2 + 0.9]} castShadow>
        <sphereGeometry args={[0.9, 14, 14]} />
        <meshStandardMaterial color={CHROME} metalness={0.85} roughness={0.2} envMapIntensity={1.2} />
      </mesh>
    </>
  );
}

function Dresser({ w, d, h, tint }: ModelProps) {
  const legH = 4;
  const wood = tint ?? WOOD;
  const rows = 3;
  const rowH = (h - legH - 3) / rows;

  return (
    <>
      <Legs w={w} d={d} height={legH} inset={2.5} />
      <Part y={legH + (h - legH) / 2} sx={w} sy={h - legH} sz={d} color={wood} roughness={0.6} radius={0.9} />
      {Array.from({ length: rows }, (_, row) => {
        const y = legH + 2 + rowH * (row + 0.5);
        return (
          <group key={row}>
            <Part z={d / 2 + 0.2} y={y} sx={w - 4} sy={rowH - 1.4} sz={0.5} color={DARK_WOOD} roughness={0.55} radius={0.4} />
            <Cyl x={-w * 0.18} z={d / 2 + 0.9} y={y} rTop={0.7} height={0.9} color={CHROME} metalness={0.85} roughness={0.2} rotation={[Math.PI / 2, 0, 0]} />
            <Cyl x={w * 0.18} z={d / 2 + 0.9} y={y} rTop={0.7} height={0.9} color={CHROME} metalness={0.85} roughness={0.2} rotation={[Math.PI / 2, 0, 0]} />
          </group>
        );
      })}
    </>
  );
}

function Wardrobe({ w, d, h, tint }: ModelProps) {
  const wood = tint ?? WOOD;

  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={wood} roughness={0.6} radius={0.9} />
      {/* Crown, plinth, two proud door panels and long bar handles. */}
      <Part y={h - 1} sx={w + 1.6} sy={2} sz={d + 1.2} color={DARK_WOOD} roughness={0.55} radius={0.6} />
      <Part y={1.2} sx={w + 1} sy={2.4} sz={d + 0.8} color={DARK_WOOD} roughness={0.55} />
      {[-1, 1].map((side) => (
        <Part key={side} x={side * w * 0.24} z={d / 2 + 0.25} y={h * 0.5} sx={w * 0.44} sy={h * 0.88} sz={0.5} color={wood} roughness={0.55} radius={0.5} />
      ))}
      <Cyl x={-w * 0.05} z={d / 2 + 1} y={h * 0.5} rTop={0.6} height={h * 0.22} color={CHROME} metalness={0.85} roughness={0.2} />
      <Cyl x={w * 0.05} z={d / 2 + 1} y={h * 0.5} rTop={0.6} height={h * 0.22} color={CHROME} metalness={0.85} roughness={0.2} />
    </>
  );
}

function Tub({ w, d, h }: ModelProps) {
  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={PORCELAIN} roughness={0.25} radius={2.6} />
      {/* Rolled rim over a darker basin inset. */}
      <Part y={h - 1.6} sx={w - 5} sy={2} sz={d - 5} color="#cfccc4" roughness={0.3} radius={1.6} />
      <Part y={h - 0.5} sx={w} sy={1.2} sz={d} color={PORCELAIN} roughness={0.2} radius={2.6} />
      {/* Chrome filler and spout at one end. */}
      <Cyl x={-w / 2 + 4} y={h + 2.5} rTop={0.7} height={5} color={CHROME} metalness={0.9} roughness={0.15} />
      <Cyl x={-w / 2 + 5.5} y={h + 4.6} rTop={0.6} height={4} color={CHROME} metalness={0.9} roughness={0.15} rotation={[0, 0, Math.PI / 2]} />
    </>
  );
}

function Shower({ w, d, h }: ModelProps) {
  return (
    <>
      {/* Tray with a lip, chrome-framed glass on the two open sides. */}
      <Part y={2} sx={w} sy={4} sz={d} color={PORCELAIN} roughness={0.35} radius={1.2} />
      <Part y={4.4} sx={w - 3} sy={1} sz={d - 3} color="#dcd9d2" roughness={0.3} />
      <mesh position={[0, h / 2 + 2, d / 2 - 0.5]} castShadow>
        <boxGeometry args={[w, h - 4, 0.8]} />
        <meshStandardMaterial color={GLASS} transparent opacity={0.18} roughness={0.03} envMapIntensity={1.8} />
      </mesh>
      <mesh position={[w / 2 - 0.5, h / 2 + 2, 0]} castShadow>
        <boxGeometry args={[0.8, h - 4, d]} />
        <meshStandardMaterial color={GLASS} transparent opacity={0.18} roughness={0.03} envMapIntensity={1.8} />
      </mesh>
      <Cyl y={h - 0.6} z={d / 2 - 0.5} x={0} rTop={0.8} height={w} color={CHROME} metalness={0.85} roughness={0.2} rotation={[0, 0, Math.PI / 2]} />
      <Cyl y={h - 0.6} x={w / 2 - 0.5} rTop={0.8} height={d} color={CHROME} metalness={0.85} roughness={0.2} rotation={[Math.PI / 2, 0, 0]} />
      {/* Shower arm and head in the walled corner. */}
      <Cyl z={-d / 2 + 3} y={h * 0.86} rTop={0.6} height={6} color={CHROME} metalness={0.9} roughness={0.15} rotation={[Math.PI / 2.6, 0, 0]} />
      <Cyl z={-d / 2 + 5.5} y={h * 0.83} rTop={2.4} rBottom={2.4} height={0.8} color={CHROME} metalness={0.9} roughness={0.15} rotation={[0.4, 0, 0]} />
      <Cyl z={-d / 2 + 1.2} y={h * 0.45} rTop={1.4} height={1.2} color={CHROME} metalness={0.9} roughness={0.15} rotation={[Math.PI / 2, 0, 0]} />
    </>
  );
}

function Washer({ w, d, h, tint }: ModelProps) {
  return (
    <>
      <Part y={h / 2} sx={w} sy={h} sz={d} color={tint ?? '#e3e1dc'} roughness={0.35} />
      {/* Porthole: chrome ring around a domed glass door. */}
      <mesh position={[0, h * 0.45, d / 2 + 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[w * 0.28, 1.2, 12, 32]} />
        <meshStandardMaterial color={CHROME} metalness={0.85} roughness={0.2} envMapIntensity={1.2} />
      </mesh>
      <mesh position={[0, h * 0.45, d / 2 + 0.5]} scale={[1, 1, 0.35]} castShadow>
        <sphereGeometry args={[w * 0.26, 20, 16]} />
        <meshStandardMaterial color="#14161a" roughness={0.05} metalness={0.3} envMapIntensity={1.6} />
      </mesh>
      {/* Control fascia: dial, buttons, detergent drawer. */}
      <Part y={h - 2.5} z={d / 2 + 0.2} sx={w - 2} sy={4} sz={0.8} color="#c9c6c0" roughness={0.4} />
      <Cyl x={w * 0.28} z={d / 2 + 0.8} y={h - 2.5} rTop={1.6} height={1} color="#3f4144" roughness={0.4} metalness={0.4} rotation={[Math.PI / 2, 0, 0]} />
      <Part x={-w * 0.3} y={h - 2.5} z={d / 2 + 0.5} sx={w * 0.22} sy={2.2} sz={0.5} color="#b3b0aa" roughness={0.45} radius={0.3} />
    </>
  );
}

/**
 * A wall-mounted screen: no cabinet, hung high with a bracket behind it. The
 * panel occupies the top 30in of the item's height, so h = 74 puts the screen
 * from 44in to 74in -- eye height from a sofa.
 */
function WallTelevision({ w, h }: ModelProps) {
  const panel = Math.min(30, h - 2);

  return (
    <>
      <ScreenPanel z={-1} y={h - panel / 2} sw={w} sh={panel} />
      <Part z={-2.2} y={h - panel / 2} sx={w * 0.2} sy={panel * 0.4} sz={1.2} color={STEEL} metalness={0.6} roughness={0.4} />
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
  dresser: Dresser,
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
