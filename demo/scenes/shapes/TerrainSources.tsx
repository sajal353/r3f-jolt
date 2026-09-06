import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { Group, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Controls, Hud, Wall } from "../../shared/Stage";
import { useHeightmap } from "../../shared/heightmap";
import { tilt } from "../../shared/helpers";
import { useHeightField } from "@/Jolt/useHeightField";
import { useSphere } from "@/Jolt/useSphere";
import { useCar } from "@/Jolt/useCar";
import { useJolt } from "@/Jolt/useJolt";
import type { HeightFieldSamples } from "@/Jolt/useHeightField";
import type { Vec3Tuple } from "@/Jolt/types";

const keyMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "handbrake", keys: ["Space"] },
  { name: "boost", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "reset", keys: ["KeyR"] },
];

const GRID = 128;

/* 1 — a function. Nothing is stored: it is called once per sample while Jolt's
 * buffer is filled, and `null` is a hole. */

const ridged = (x: number, z: number) => {
  const u = x * 0.055;
  const v = z * 0.055;

  const base =
    5 * Math.sin(u) * Math.cos(v) +
    2 * Math.sin(u * 2.3 + 1.1) * Math.cos(v * 1.9) +
    0.8 * Math.sin(u * 5.1) * Math.cos(v * 4.7);

  // Folding the absolute value gives crests sharp enough to launch a car off.
  return 6 - Math.abs(base);
};

const generated = (x: number, z: number) => {
  const dx = x - GRID * 0.72;
  const dz = z - GRID * 0.3;

  if (Math.hypot(dx, dz) < 7) return null;

  return ridged(x, z);
};

/* 2 — an array. Row-major, `sampleCount²` long, `NaN` for a hole — the shape a
 * `.raw` heightfield or a server payload arrives in. */

const buildBasin = () => {
  const samples = new Float32Array(GRID * GRID);
  const centre = (GRID - 1) / 2;

  for (let z = 0; z < GRID; z += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const radius = Math.hypot(x - centre, z - centre) / centre;

      const rim = 14 * Math.exp(-(((radius - 0.62) / 0.13) ** 2));
      const floor = radius < 0.45 ? -3 : 0;
      const terrace = Math.round(Math.sin(radius * 14) * 1.5);

      samples[z * GRID + x] = rim + floor + terrace;
    }
  }

  // Rounded: `centre` is a half-integer on an even grid, and a fractional index
  // into a typed array is discarded silently rather than throwing.
  const pitRow = Math.round(centre);

  for (const [px, pz] of [
    [pitRow - 18, pitRow],
    [pitRow + 18, pitRow],
  ]) {
    for (let z = -5; z <= 5; z += 1) {
      for (let x = -5; x <= 5; x += 1) {
        if (Math.hypot(x, z) > 5) continue;
        samples[(pz + z) * GRID + (px + x)] = NaN;
      }
    }
  }

  return samples;
};

const basin = buildBasin();

type Source =
  | { kind: "function"; heights: HeightFieldSamples }
  | { kind: "array"; heights: HeightFieldSamples }
  | { kind: "image"; url: string; heightRange: [number, number] };

interface Level {
  name: string;
  source: Source;
  /** Samples per side. Must be a multiple of `blockSize`. */
  samples: number;
  blockSize: number;
  /** World units between samples. */
  spacing: number;
  /** Storable span, wider than the terrain so `setHeights` has headroom. */
  range: [number, number];
  color: string;
  note: string;
}

const LEVELS: Level[] = [
  {
    name: "Function",
    source: { kind: "function", heights: generated },
    samples: GRID,
    blockSize: 4,
    spacing: 1,
    range: [-12, 24],
    color: "#4a6741",
    note: "(x, z) => number | null — ridged noise, evaluated once per sample. The shaft is a null.",
  },
  {
    name: "Array",
    source: { kind: "array", heights: basin },
    samples: GRID,
    blockSize: 4,
    spacing: 1,
    range: [-14, 26],
    color: "#7d6b52",
    note: "Float32Array, row-major, 16 384 long — a crater with two NaN pits in its floor.",
  },
  {
    name: "Image",
    source: { kind: "image", url: "/heightmaps/hills.png", heightRange: [0, 16] },
    samples: GRID,
    blockSize: 4,
    spacing: 1,
    range: [-6, 28],
    color: "#5a7a4a",
    note: "257² greyscale PNG, resampled to 128² and handed over as ImageData.",
  },
];

const spanOf = (level: Level) => (level.samples - 1) * level.spacing;

const Prop = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useSphere({
    position,
    radius: 1.1,
    motionType: "dynamic",
    mass: 8,
    material: { friction: 0.5, restitution: 0.35 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[1.1, 24, 18]} />
      <meshStandardMaterial color="#e67e22" />
    </mesh>
  );
};

/** A height field is finite, so the edge needs something to stop a car at. */
const Fence = ({ span }: { span: number }) => {
  const half = span / 2;
  const thickness = 2;
  const height = 14;
  const outer = span + thickness * 2;

  return (
    <>
      <Wall
        position={[0, height / 2, -half - thickness / 2]}
        size={[outer, height, thickness]}
        color="#1e1e1e"
      />
      <Wall
        position={[0, height / 2, half + thickness / 2]}
        size={[outer, height, thickness]}
        color="#1e1e1e"
      />
      <Wall
        position={[-half - thickness / 2, height / 2, 0]}
        size={[thickness, height, outer]}
        color="#1e1e1e"
      />
      <Wall
        position={[half + thickness / 2, height / 2, 0]}
        size={[thickness, height, outer]}
        color="#1e1e1e"
      />
    </>
  );
};

const Terrain = ({
  level,
  heights,
}: {
  level: Level;
  heights: HeightFieldSamples;
}) => {
  const span = spanOf(level);

  const [ref, api] = useHeightField({
    heights,
    sampleCount: level.samples,
    blockSize: level.blockSize,
    sampleScale: [level.spacing, 1, level.spacing],
    // Centred on the origin, so the car spawns in the middle of the map.
    offset: [-span / 2, 0, -span / 2],
    range: level.range,
    position: [0, 0, 0],
    material: { friction: 0.9 },
  });

  return api ? (
    <mesh ref={ref} geometry={api.geometry} receiveShadow castShadow>
      <meshStandardMaterial color={level.color} flatShading />
    </mesh>
  ) : null;
};

/** A car at identity drives towards +z; facing it −z puts more map on screen. */
const FACING = tilt([0, 1, 0], Math.PI);

const Vehicle = ({ spawn }: { spawn: Vec3Tuple }) => {
  const { bodyInterface, temps } = useJolt();
  const orbit = useThree(
    (state) => state.controls as OrbitControlsImpl | null,
  );

  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);

  const [api] = useCar({
    position: spawn,
    rotation: FACING,
    driveType: "awd",
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.35,
      width: 0.28,
      offsetForward: 1.4,
      offsetDown: 0.3,
    },
    // The stock torque runs out of legs on the steeper slopes here.
    maxTorque: 900,
  });

  const [, getKeys] = useKeyboardControls();
  const resetHeld = useRef(false);
  const followed = useRef(new Vector3(...spawn));

  useFrame(({ camera }) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;

    if (keys.reset && !resetHeld.current) {
      bodyInterface.SetPositionRotationAndVelocity(
        api.carBody.GetID(),
        temps.rvec3(spawn),
        temps.quat(FACING),
        temps.vec3([0, 0, 0]),
        temps.vec3([0, 0, 0]),
      );
    }
    resetHeld.current = keys.reset;

    const state = api.update({
      forward: keys.forward,
      backward: keys.backward,
      left: keys.left,
      right: keys.right,
      handbrake: keys.handbrake,
      modifier: keys.boost,
    });

    if (bodyRef.current) {
      bodyRef.current.position.copy(state.position);
      bodyRef.current.quaternion.copy(state.rotation);
    }

    state.wheels.forEach((wheel, index) => {
      const group = wheelRefs.current[index];
      if (!group) return;
      group.position.copy(wheel.position);
      group.quaternion.copy(wheel.rotation);
    });

    // The camera follows by translation only: moving the orbit target and the
    // camera by the same delta keeps the car centred while leaving whatever
    // angle and distance the viewer dragged to alone.
    if (orbit) {
      const delta = state.position.clone().sub(followed.current);
      orbit.target.add(delta);
      camera.position.add(delta);
      followed.current.copy(state.position);
    }
  });

  return (
    <group ref={bodyRef}>
      <mesh castShadow>
        <boxGeometry args={[1.8, 1, 4]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      {[0, 1, 2, 3].map((index) => (
        <group
          key={index}
          ref={(node) => {
            wheelRefs.current[index] = node;
          }}
        >
          <mesh castShadow>
            <cylinderGeometry args={[0.35, 0.35, 0.28, 20]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/** Remounted whole on a level change: `useHeightField` is init-once like every
 *  body hook, so a new terrain is a `key` rebuild. */
const World = ({
  level,
  heights,
}: {
  level: Level;
  heights: HeightFieldSamples;
}) => {
  const span = spanOf(level);
  const spawn: Vec3Tuple = [0, level.range[1] + 4, 0];

  return (
    <>
      <Terrain level={level} heights={heights} />
      <Fence span={span} />
      <Vehicle spawn={spawn} />

      {/* Above the highest ground the field can hold, so they land on the
          terrain rather than inside it. */}
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2;
        const radius = span * 0.24;

        return (
          <Prop
            key={index}
            position={[
              Math.cos(angle) * radius,
              level.range[1] + 6 + index * 0.5,
              Math.sin(angle) * radius,
            ]}
          />
        );
      })}
    </>
  );
};

/** The three shapes `heights` accepts, side by side. */
export const TerrainSources = () => {
  const [index, setIndex] = useState(0);
  const level = LEVELS[index];
  const { source } = level;
  const url = source.kind === "image" ? source.url : null;

  const { data, loading, error } = useHeightmap(url, level.samples);

  // `data` is only ever the image for *this* level: the loader reports nothing
  // until the resolved key matches the requested one, so a 128-wide decode from
  // the level before never reaches a 384-sample field.
  const heights: HeightFieldSamples | null =
    source.kind === "image"
      ? data && { data, heightRange: source.heightRange }
      : source.heights;

  return (
    <KeyboardControls map={keyMap}>
      {heights && (
        <World key={`${level.name}`} level={level} heights={heights} />
      )}

      <Controls position={[0, 36, 0]}>
        {LEVELS.map((entry, entryIndex) => (
          <button
            key={entry.name}
            onClick={() => setIndex(entryIndex)}
            disabled={entryIndex === index}
          >
            {entry.name}
          </button>
        ))}
      </Controls>

      <Hud position={[0, 32, 0]}>
        {error ? (
          <>failed to load: {error}</>
        ) : loading ? (
          <>decoding {url}…</>
        ) : (
          <>
            {level.note} · <b>WASD</b> to drive, <b>R</b> to reset
          </>
        )}
      </Hud>
    </KeyboardControls>
  );
};
