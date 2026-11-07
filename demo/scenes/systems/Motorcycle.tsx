import { useRef, useState } from "react";
import { Group, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useCylinder } from "@/Jolt/useCylinder";
import { useMotorcycle } from "@/Jolt/useMotorcycle";
import type { Vec3Tuple } from "@/Jolt/types";
import { Controls, Floor, Ramp, Wall } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import {
  useDashboard,
  useFollowCamera,
  useResetKey,
  VEHICLE_KEYS,
} from "../../shared/vehicleHud";

const ARENA = 160;
const SPAWN: Vec3Tuple = [0, 1.2, 60];
const CAMERA_OFFSET: Vec3Tuple = [0, 5, 10];
const MAX_RPM = 10000;

/** A bike at identity rides towards +z, and the course runs the other way. */
const FACING = tilt([0, 1, 0], Math.PI);

const FRAME = { length: 0.8, width: 0.4, height: 0.6 };
const WHEEL = { radius: 0.31, width: 0.05, offsetForward: 0.75, offsetDown: 0.27 };

const CONE_COUNT = 10;
const CONE_SPACING = 11;
const WORLD_UP = new Vector3(0, 1, 0);

const Cone = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useCylinder({
    position,
    radius: 0.2,
    height: 0.8,
    motionType: "dynamic",
    mass: 2,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <cylinderGeometry args={[0.04, 0.2, 0.8, 14]} />
      <meshStandardMaterial color="#e06a1f" />
    </mesh>
  );
};

const Course = () => (
  <>
    <Floor size={ARENA} color="#242424" friction={1} />

    <Wall position={[0, 1.5, -ARENA / 2]} size={[ARENA, 3, 2]} />
    <Wall position={[0, 1.5, ARENA / 2]} size={[ARENA, 3, 2]} />
    <Wall position={[-ARENA / 2, 1.5, 0]} size={[2, 3, ARENA]} />
    <Wall position={[ARENA / 2, 1.5, 0]} size={[2, 3, ARENA]} />

    {Array.from({ length: CONE_COUNT }, (_, index) => (
      <Cone
        key={index}
        position={[index % 2 === 0 ? 2 : -2, 0.4, 44 - index * CONE_SPACING]}
      />
    ))}

    <Ramp degrees={14} foot={-58} length={8} width={8} x={0} color="#4a4a4a" friction={1} />
    <Ramp degrees={14} foot={-58} length={8} width={8} x={-30} color="#4a4a4a" friction={1} />
    <Ramp degrees={14} foot={-58} length={8} width={8} x={30} color="#4a4a4a" friction={1} />
  </>
);

const leanRight = new Vector3();
const leanUp = new Vector3();
const leanForward = new Vector3();

const Vehicle = () => {
  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);
  const [leanOn, setLeanOn] = useState(true);

  const [api] = useMotorcycle({
    position: SPAWN,
    rotation: FACING,
    vehicleSize: FRAME,
    wheelSettings: WHEEL,
    lean: { springConstant: 2500, springDamping: 500 },
  });

  const [, getKeys] = useKeyboardControls();
  const { show, dashboard } = useDashboard(MAX_RPM, 1.75);
  const follow = useFollowCamera(SPAWN, CAMERA_OFFSET);
  const reset = useResetKey(SPAWN, FACING);

  const toggleLean = () => {
    api?.setLeanController(!leanOn);
    setLeanOn(!leanOn);
  };

  useFrame((_, delta) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;

    reset(keys.reset, api.body);

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

    leanUp.copy(WORLD_UP).applyQuaternion(state.rotation);
    leanForward.set(0, 0, 1).applyQuaternion(state.rotation);
    leanRight.crossVectors(leanForward, WORLD_UP).normalize();
    const lean = (Math.asin(leanUp.dot(leanRight)) * 180) / Math.PI;

    show(api.telemetry(), `lean ${Math.round(lean)}°`);
    follow(state.position, delta);
  });

  return (
    <group ref={bodyRef}>
      {dashboard}
      <Controls position={[0, 1.05, 0]}>
        <button type="button" aria-pressed={leanOn} onClick={toggleLean}>
          lean controller {leanOn ? "on" : "off"}
        </button>
      </Controls>
      <mesh castShadow>
        <boxGeometry args={[FRAME.width, FRAME.height, FRAME.length]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      <mesh castShadow position={[0, 0.45, -0.15]}>
        <boxGeometry args={[0.3, 0.35, 0.5]} />
        <meshStandardMaterial color="#2c3e50" />
      </mesh>
      {[0, 1].map((index) => (
        <group
          key={index}
          ref={(node) => {
            wheelRefs.current[index] = node;
          }}
        >
          <mesh castShadow>
            <cylinderGeometry args={[WHEEL.radius, WHEEL.radius, 0.1, 24]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export const Motorcycle = () => (
  <KeyboardControls map={VEHICLE_KEYS}>
    <Course />
    <Vehicle />
  </KeyboardControls>
);
