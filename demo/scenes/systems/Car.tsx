import { useRef } from "react";
import { Group } from "three";
import { useFrame } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCylinder } from "@/Jolt/useCylinder";
import { useTaperedCapsule } from "@/Jolt/useTaperedCapsule";
import { useCar } from "@/Jolt/useCar";
import type { TireContact, TireFrictionDirection } from "@/Jolt/internal/vehicle";
import type { Vec3Tuple } from "@/Jolt/types";
import { Floor, Ramp, Tag, Wall } from "../../shared/Stage";
import {
  useDashboard,
  useFollowCamera,
  useResetKey,
  VEHICLE_KEYS,
} from "../../shared/vehicleHud";
import { tilt } from "../../shared/helpers";

const ARENA = 120;
const SPAWN: Vec3Tuple = [0, 2, 34];

/** A car at identity drives towards +z, and the course runs the other way. */
const FACING = tilt([0, 1, 0], Math.PI);

const CAMERA_OFFSET: Vec3Tuple = [0, 11, 17];
const ICE = 900;
const GRAVEL = 901;
const SURFACE_NAMES = new Map([
  [ICE, "ice"],
  [GRAVEL, "gravel"],
]);

const ICE_GRIP = 0.12;
const GRAVEL_GRIP = { longitudinal: 0.75, lateral: 0.45 };
const MAX_RPM = 6000;

/** A petrol engine's hump: weak off idle, strongest high up, fading at the redline. */
const TORQUE_CURVE: [number, number][] = [
  [0, 0.5],
  [0.4, 0.85],
  [0.7, 1],
  [1, 0.65],
];

const iceGrip = (tire: TireContact) => {
  if (tire.bodyID !== ICE) return;
  tire.longitudinalImpulse *= ICE_GRIP;
  tire.lateralImpulse *= ICE_GRIP;
};

const gravelFriction = (
  _wheel: number,
  direction: TireFrictionDirection,
  friction: number,
  body: Jolt.Body,
) => {
  const combined = Math.sqrt(friction * body.GetFriction());
  return body.GetID().GetIndexAndSequenceNumber() === GRAVEL
    ? combined * GRAVEL_GRIP[direction]
    : combined;
};

/**
 * A `stateId` puts the body on a known Jolt id, which is all a surface needs to
 * be told apart from inside a tire callback.
 */
const Patch = ({
  stateId,
  x,
  color,
}: {
  stateId: number;
  x: number;
  color: string;
}) => {
  const size: Vec3Tuple = [26, 0.04, 34];
  const position: Vec3Tuple = [x, 0.02, 38];
  const [ref] = useBox({
    stateId,
    position,
    size,
    motionType: "static",
    material: { friction: 1 },
  });

  return (
    <>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Tag position={[x, 1.5, 30]}>{SURFACE_NAMES.get(stateId)}</Tag>
    </>
  );
};

const Course = () => (
  <>
    <Floor size={ARENA} color="#242424" friction={1} />

    <Patch stateId={ICE} x={-20} color="#7fb2cc" />
    <Patch stateId={GRAVEL} x={20} color="#6b5d4a" />

    <Wall position={[0, 1.5, -ARENA / 2]} size={[ARENA, 3, 2]} />
    <Wall position={[0, 1.5, ARENA / 2]} size={[ARENA, 3, 2]} />
    <Wall position={[-ARENA / 2, 1.5, 0]} size={[2, 3, ARENA]} />
    <Wall position={[ARENA / 2, 1.5, 0]} size={[2, 3, ARENA]} />

    {/* The main jump: launch, a gap with something in it to punish coming up
        short, and a ramp angled to receive you rather than stop you dead. */}
    <Ramp degrees={17} foot={20} length={11} width={14} color="#4a4a4a" />
    <Ramp degrees={13} foot={-14} length={13} width={18} mirror color="#4a4a4a" />

    {/* Steeper and narrower — trades distance for air. */}
    <Ramp degrees={28} foot={8} length={7} width={9} x={-28} color="#4a4a4a" />

    {/* Table top: up, along the flat, and off the far end. */}
    <Ramp degrees={15} foot={16} length={8} width={10} x={30} color="#4a4a4a" />
    <Wall position={[30, 1.87, 2]} size={[10, 0.4, 12.6]} color="#4a4a4a" />
    <Ramp
      degrees={15}
      foot={-12}
      length={8}
      width={10}
      x={30}
      mirror
      color="#4a4a4a"
    />
  </>
);

const Crate = ({
  position,
  size = 1.1,
}: {
  position: Vec3Tuple;
  size?: number;
}) => {
  const [ref] = useBox({
    position,
    size: [size, size, size],
    motionType: "dynamic",
    mass: 12,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[size, size, size]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

const Barrel = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useCylinder({
    position,
    radius: 0.5,
    height: 1.3,
    motionType: "dynamic",
    mass: 20,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <cylinderGeometry args={[0.5, 0.5, 1.3, 20]} />
      <meshStandardMaterial color="#2f7d63" metalness={0.3} roughness={0.6} />
    </mesh>
  );
};

const Pin = ({ position }: { position: Vec3Tuple }) => {
  const [ref, api] = useTaperedCapsule({
    position,
    topRadius: 0.16,
    bottomRadius: 0.34,
    height: 0.9,
    motionType: "dynamic",
    mass: 4,
  });

  // No primitive in three matches a tapered capsule, so the mesh borrows the
  // collider's own triangulation.
  return api ? (
    <mesh ref={ref} geometry={api.geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#e8e8e8" />
    </mesh>
  ) : null;
};

const Ball = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useSphere({
    position,
    radius: 0.55,
    motionType: "dynamic",
    mass: 3,
    material: { restitution: 0.5 },
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <sphereGeometry args={[0.55, 24, 16]} />
      <meshStandardMaterial color="#c0392b" />
    </mesh>
  );
};

/** Sitting in the landing gap, so a jump that comes up short still pays off. */
const Pyramid = () => (
  <>
    {[0, 1, 2, 3].map((row) =>
      Array.from({ length: 4 - row }, (_, column) => (
        <Crate
          key={`${row}-${column}`}
          position={[
            (column - (3 - row) / 2) * 1.2,
            0.55 + row * 1.15,
            4 + row * 0.05,
          ]}
        />
      )),
    )}
  </>
);

const Tower = ({ x, z }: { x: number; z: number }) => (
  <>
    {[0, 1, 2, 3].map((level) => (
      <Crate key={level} position={[x, 0.55 + level * 1.15, z]} />
    ))}
  </>
);

const Props = () => (
  <>
    <Pyramid />
    <Tower x={-16} z={-24} />
    <Tower x={16} z={-24} />

    {Array.from({ length: 8 }, (_, index) => (
      <Barrel
        key={index}
        position={[-22 + (index % 4) * 1.3, 0.65, -2 + Math.floor(index / 4) * 1.4]}
      />
    ))}

    {[0, 1, 2, 3].map((row) =>
      Array.from({ length: row + 1 }, (_, column) => (
        <Pin
          key={`${row}-${column}`}
          position={[20 + (column - row / 2) * 1, 0.8, -26 - row * 0.9]}
        />
      )),
    )}

    {Array.from({ length: 8 }, (_, index) => (
      <Ball key={index} position={[-6 + index * 1.7, 0.55, -34]} />
    ))}
  </>
);

const Vehicle = () => {
  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);

  const [api] = useCar({
    position: SPAWN,
    rotation: FACING,
    driveType: "awd",
    torqueCurve: TORQUE_CURVE,
    tireGrip: iceGrip,
    combineFriction: gravelFriction,
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.35,
      width: 0.28,
      offsetForward: 1.4,
      offsetDown: 0.3,
    },
  });

  const [, getKeys] = useKeyboardControls();
  const { show, dashboard } = useDashboard(MAX_RPM, 1.9);
  const follow = useFollowCamera(SPAWN, CAMERA_OFFSET);
  const reset = useResetKey(SPAWN, FACING);

  useFrame((_, delta) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;

    reset(keys.reset, api.carBody);

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

    const rearWheel = api.constraint.GetWheel(2);
    show(
      api.telemetry(),
      rearWheel.HasContact()
        ? (SURFACE_NAMES.get(
            rearWheel.GetContactBodyID().GetIndexAndSequenceNumber(),
          ) ?? "tarmac")
        : "air",
    );
    follow(state.position, delta);
  });

  return (
    <group ref={bodyRef}>
      {dashboard}
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
          {/* No rotation of our own: `useCar` asks Jolt for the wheel transform
              with the model's axle along +Y, which is where a three cylinder
              already has it. Turning the mesh as well rotates it twice. */}
          <mesh castShadow>
            <cylinderGeometry args={[0.35, 0.35, 0.28, 20]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export const Car = () => (
  <KeyboardControls map={VEHICLE_KEYS}>
    <Course />
    <Props />
    <Vehicle />
  </KeyboardControls>
);
