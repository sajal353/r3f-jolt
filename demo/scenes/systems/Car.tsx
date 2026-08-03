import { useRef } from "react";
import { Group } from "three";
import { useFrame } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useCar } from "@/Jolt/useCar";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "handbrake", keys: ["Space"] },
  { name: "boost", keys: ["ShiftLeft", "ShiftRight"] },
];

const Track = () => {
  const [floorRef] = useBox({
    position: [0, -0.5, 0],
    size: [120, 1, 120],
    motionType: "static",
    material: { friction: 1 },
  });

  const [rampRef] = useBox({
    position: [0, 0.5, -18],
    size: [14, 0.5, 8],
    rotation: [Math.sin(0.1), 0, 0, Math.cos(0.1)],
    motionType: "static",
  });

  return (
    <>
      <mesh ref={floorRef} receiveShadow>
        <boxGeometry args={[120, 1, 120]} />
        <meshStandardMaterial color="#242424" />
      </mesh>
      <mesh ref={rampRef} receiveShadow>
        <boxGeometry args={[14, 0.5, 8]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>
    </>
  );
};

const Vehicle = () => {
  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);

  const [api] = useCar({
    position: [0, 2, 0],
    debug: true,
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

  useFrame(() => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;
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
    <Track />
    <Vehicle />
  </KeyboardControls>
);
