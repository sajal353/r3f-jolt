import { useRef, useState } from "react";
import { Group } from "three";
import { useFrame } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useCylinder } from "@/Jolt/useCylinder";
import { useTank } from "@/Jolt/useTank";
import type { Vec3Tuple } from "@/Jolt/types";
import { Floor, Ramp, Wall } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import {
  useDashboard,
  useFollowCamera,
  VEHICLE_KEYS,
} from "../../shared/vehicleHud";

const ARENA = 120;
const SPAWN: Vec3Tuple = [0, 2, 34];
const CAMERA_OFFSET: Vec3Tuple = [0, 13, 20];
const MAX_RPM = 4000;

/** A tank at identity drives towards +z, and the course runs the other way. */
const FACING = tilt([0, 1, 0], Math.PI);
const ACROSS = tilt([0, 0, 1], Math.PI / 2);

const HULL = { length: 6.4, width: 3.4, height: 1 };
const WHEEL = { radius: 0.3, width: 0.3, span: 5.7, offsetDown: 0.5 };
const WHEELS_PER_TRACK = 9;

const Log = ({ z }: { z: number }) => {
  const [ref] = useCylinder({
    position: [0, 0.2, z],
    rotation: ACROSS,
    radius: 0.2,
    height: 18,
    motionType: "static",
    material: { friction: 1 },
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <cylinderGeometry args={[0.2, 0.2, 18, 16]} />
      <meshStandardMaterial color="#6b4a2f" />
    </mesh>
  );
};

const Crate = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useBox({
    position,
    size: [1.2, 1.2, 1.2],
    motionType: "dynamic",
    mass: 60,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[1.2, 1.2, 1.2]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

const CrateWall = ({ z }: { z: number }) => (
  <>
    {[0, 1, 2].map((row) =>
      Array.from({ length: 9 }, (_, column) => (
        <Crate
          key={`${row}-${column}`}
          position={[(column - 4) * 1.25, 0.6 + row * 1.22, z]}
        />
      )),
    )}
  </>
);

const Course = () => (
  <>
    <Floor size={ARENA} color="#2b2a26" friction={1} />

    <Wall position={[0, 1.5, -ARENA / 2]} size={[ARENA, 3, 2]} />
    <Wall position={[0, 1.5, ARENA / 2]} size={[ARENA, 3, 2]} />
    <Wall position={[-ARENA / 2, 1.5, 0]} size={[2, 3, ARENA]} />
    <Wall position={[ARENA / 2, 1.5, 0]} size={[2, 3, ARENA]} />

    <Log z={22} />
    <Log z={19} />
    <Log z={16} />

    <Wall position={[0, 0.2, 7]} size={[18, 0.4, 8]} color="#4a4a4a" friction={1} />

    <CrateWall z={-6} />

    <Ramp degrees={15} foot={-16} length={14} width={12} x={-24} color="#4a4a4a" friction={1} />
    <Wall position={[-24, 1.72, -29.5]} size={[12, 0.4, 14]} color="#4a4a4a" friction={1} />
  </>
);

const TrackWheel = ({
  index,
  setRef,
}: {
  index: number;
  setRef: (index: number, node: Group | null) => void;
}) => (
  <group
    ref={(node) => {
      setRef(index, node);
    }}
  >
    <mesh castShadow>
      <cylinderGeometry args={[WHEEL.radius, WHEEL.radius, WHEEL.width, 16]} />
      <meshStandardMaterial color="#1a1a1a" />
    </mesh>
  </group>
);

const Vehicle = () => {
  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);

  const [api] = useTank({
    position: SPAWN,
    rotation: FACING,
    vehicleSize: HULL,
    wheelSettings: { ...WHEEL, count: WHEELS_PER_TRACK },
    mass: 8000,
    maxTorque: 1200,
    brakeTorque: 30000,
    trackInertia: 400,
    trackDamping: 0.0125,
  });

  const [, getKeys] = useKeyboardControls();
  const { show, dashboard } = useDashboard(MAX_RPM, 2.6);
  const follow = useFollowCamera(SPAWN, CAMERA_OFFSET);

  const setWheelRef = (index: number, node: Group | null) => {
    wheelRefs.current[index] = node;
  };

  useFrame((_, delta) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;

    const state = api.update({
      forward: keys.forward,
      backward: keys.backward,
      left: keys.left,
      right: keys.right,
      brake: keys.handbrake,
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

    show(api.telemetry(), `${state.velocity.length().toFixed(1)} m/s`);
    follow(state.position, delta);
  });

  return (
    <group ref={bodyRef}>
      {dashboard}
      <mesh castShadow>
        <boxGeometry args={[HULL.width, HULL.height, HULL.length]} />
        <meshStandardMaterial color="#5a6b3a" />
      </mesh>
      <mesh castShadow position={[0, 0.85, -0.3]}>
        <boxGeometry args={[2, 0.7, 2.6]} />
        <meshStandardMaterial color="#4c5c30" />
      </mesh>
      <mesh castShadow position={[0, 0.9, 2.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 3, 12]} />
        <meshStandardMaterial color="#3a4626" />
      </mesh>
      {Array.from({ length: WHEELS_PER_TRACK * 2 }, (_, index) => (
        <TrackWheel key={index} index={index} setRef={setWheelRef} />
      ))}
    </group>
  );
};

export const Tank = () => {
  const [spawn, setSpawn] = useState(0);

  // Moving the hull back would leave its heavy tracks spinning, and they would
  // drive it off again, so a reset builds a new tank.
  const respawn = (name: string, pressed: boolean) => {
    if (name === "reset" && pressed) setSpawn((count) => count + 1);
  };

  return (
    <KeyboardControls map={VEHICLE_KEYS} onChange={respawn}>
      <Course />
      <Vehicle key={spawn} />
    </KeyboardControls>
  );
};
