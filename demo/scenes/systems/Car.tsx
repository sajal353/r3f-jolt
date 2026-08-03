import { useRef } from "react";
import { Group } from "three";
import { useFrame } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCylinder } from "@/Jolt/useCylinder";
import { useTaperedCapsule } from "@/Jolt/useTaperedCapsule";
import { useCar } from "@/Jolt/useCar";
import { useJolt } from "@/Jolt/useJolt";
import type { Vec3Tuple } from "@/Jolt/types";
import { Floor, Hud, Ramp, Wall } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "handbrake", keys: ["Space"] },
  { name: "boost", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "reset", keys: ["KeyR"] },
];

const ARENA = 120;
const SPAWN: Vec3Tuple = [0, 2, 34];

/** A car at identity drives towards +z, and the course runs the other way. */
const FACING = tilt([0, 1, 0], Math.PI);

const Course = () => (
  <>
    <Floor size={ARENA} color="#242424" friction={1} />

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
  const { bodyInterface, temps } = useJolt();

  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);

  const [api] = useCar({
    position: SPAWN,
    rotation: FACING,
    driveType: "awd",
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.35,
      width: 0.28,
      offsetForward: 1.4,
      offsetDown: 0.3,
    },
  });

  const [, getKeys] = useKeyboardControls();
  const resetHeld = useRef(false);

  useFrame(() => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;

    if (keys.reset && !resetHeld.current) {
      bodyInterface.SetPositionRotationAndVelocity(
        api.carBody.GetID(),
        temps.rvec3(SPAWN),
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
  <KeyboardControls map={controls}>
    <Course />
    <Props />
    <Vehicle />
    <Hud position={[0, 6, 38]}>
      <b>R</b> resets the car
    </Hud>
  </KeyboardControls>
);
