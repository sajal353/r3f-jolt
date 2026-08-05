import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3 } from "three";
import { Floor, Tag, Wall } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

const ROW_Z = 4;
const LANE = 2.2;

const Block = ({
  x,
  mass,
  color,
}: {
  x: number;
  mass?: number;
  color: string;
}) => {
  const [ref] = useBox({
    position: [x, 0.5, ROW_Z],
    size: [1, 1, 1],
    motionType: "dynamic",
    mass,
    material: { friction: 0.4 },
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const SWEEP_FROM = -8;
const SWEEP_TO = 8;
const SWEEP_SECONDS = 5;
const UPRIGHT: QuatTuple = [0, 0, 0, 1];

/**
 * A kinematic body has no mass at all as far as the solver is concerned, so it
 * never yields: it arrives at wherever it is told to be. What the masses decide
 * is what happens *behind* it — the light block is shoved into the heavy one and
 * stops there, and the heavy one hardly notices.
 */
const Wrecker = () => {
  const [ref, api] = useSphere({
    radius: 0.9,
    position: [SWEEP_FROM, 0.9, ROW_Z],
    motionType: "kinematic",
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;

    // A triangle wave, so it sweeps the row in one direction and then back.
    const phase = (elapsed.current / SWEEP_SECONDS) % 2;
    const travel = phase < 1 ? phase : 2 - phase;

    api.moveKinematic(
      [SWEEP_FROM + (SWEEP_TO - SWEEP_FROM) * travel, 0.9, ROW_Z],
      UPRIGHT,
    );
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.9, 28, 28]} />
      <meshStandardMaterial color="#7f8c8d" metalness={0.6} roughness={0.3} />
    </mesh>
  );
};

const RAMP_POSITION: Vec3Tuple = [0, 3.5, -5];
const RAMP_SIZE: Vec3Tuple = [8, 0.4, 5];

// Steep enough that friction 0.5 still creeps down it and friction 1.5 does not
// move at all: Jolt combines the two materials as √(f₁ × f₂), and a block slides
// once that combined value drops below the tangent of the slope.
const RAMP_ANGLE = -0.55;
const RAMP_ROTATION = tilt([0, 0, 1], RAMP_ANGLE);
const RAMP_FRICTION = 0.5;

/** A point sitting `clearance` above the ramp's top face, `along` its slope. */
const onRamp = (along: number, z: number, clearance: number): Vec3Tuple => {
  const offset = new Vector3(along, RAMP_SIZE[1] * 0.5 + clearance, z);
  offset.applyQuaternion(new Quaternion(...RAMP_ROTATION));

  return [
    RAMP_POSITION[0] + offset.x,
    RAMP_POSITION[1] + offset.y,
    RAMP_POSITION[2] + offset.z,
  ];
};

const Slider = ({
  z,
  friction,
  color,
}: {
  z: number;
  friction: number;
  color: string;
}) => {
  const [ref] = useBox({
    // Released high on the slope, lying flush with it, so all three start the
    // run identically and only the friction differs.
    position: onRamp(-3.2, z, 0.42),
    rotation: RAMP_ROTATION,
    size: [0.8, 0.8, 0.8],
    motionType: "dynamic",
    mass: 2,
    material: { friction },
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const MassAndMaterial = () => (
  <>
    <Floor size={50} />

    {/* Ordered light to heavy along the sweep, so each block is driven into the
        next one up. mass omitted on the last: Jolt derives it from volume. */}
    <Block x={-2.4} mass={1} color="#3498db" />
    <Block x={-1.1} mass={10} color="#2980b9" />
    <Block x={0.2} mass={100} color="#1f4e79" />
    <Block x={1.5} color="#95a5a6" />
    <Wrecker />

    {/* Kerbs, so a knocked block stays in the lane instead of leaving the scene. */}
    <Wall position={[0, 0.15, ROW_Z - LANE]} size={[20, 0.3, 0.3]} />
    <Wall position={[0, 0.15, ROW_Z + LANE]} size={[20, 0.3, 0.3]} />

    <Tag position={[-0.5, 2.6, ROW_Z]}>mass 1 · 10 · 100 · derived</Tag>

    <Wall
      position={RAMP_POSITION}
      size={RAMP_SIZE}
      rotation={RAMP_ROTATION}
      friction={RAMP_FRICTION}
      color="#333"
    />
    <Slider z={-1.6} friction={0} color="#e74c3c" />
    <Slider z={0} friction={0.5} color="#e67e22" />
    <Slider z={1.6} friction={1.5} color="#f1c40f" />

    <Tag position={onRamp(-3.2, 0, 1.6)}>friction 0 · 0.5 · 1.5</Tag>
  </>
);
