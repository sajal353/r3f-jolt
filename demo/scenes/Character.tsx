import { useRef } from "react";
import { Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useCharacter } from "@/Jolt/useCharacter";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "crouch", keys: ["ShiftLeft", "ShiftRight"] },
];

const Level = () => {
  const [floorRef] = useBox({
    position: [0, -0.5, 0],
    size: [60, 1, 60],
    motionType: "static",
    material: { friction: 1 },
  });

  const [rampRef] = useBox({
    position: [8, 0.6, 0],
    size: [8, 0.4, 6],
    rotation: [0, 0, Math.sin(-0.16), Math.cos(-0.16)],
    motionType: "static",
  });

  const steps = [0.2, 0.4, 0.6, 0.8];

  return (
    <>
      <mesh ref={floorRef} receiveShadow>
        <boxGeometry args={[60, 1, 60]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh ref={rampRef} receiveShadow>
        <boxGeometry args={[8, 0.4, 6]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>
      {steps.map((height, index) => (
        <Step key={height} height={height} index={index} />
      ))}
    </>
  );
};

const Step = ({ height, index }: { height: number; index: number }) => {
  const [ref] = useBox({
    position: [-6 - index * 1.2, height / 2, 0],
    size: [1.2, height, 4],
    motionType: "static",
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[1.2, height, 4]} />
      <meshStandardMaterial color="#454545" />
    </mesh>
  );
};

const Player = () => {
  const [api] = useCharacter({
    position: [0, 4, 0],
    debug: true,
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
      moveSpeed: 6,
      jumpSpeed: 7,
    },
  });

  const [, getKeys] = useKeyboardControls();
  const camera = useThree((state) => state.camera);

  const scratch = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(0, 1, 0),
  });

  useFrame((_, delta) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;
    const { direction, forward, right, up } = scratch.current;

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up).normalize();

    direction.set(0, 0, 0);
    if (keys.forward) direction.add(forward);
    if (keys.backward) direction.sub(forward);
    if (keys.right) direction.add(right);
    if (keys.left) direction.sub(right);
    if (direction.lengthSq() > 0) direction.normalize();

    api.update(direction, keys.jump, keys.crouch, Math.min(delta, 1 / 30));
  });

  return null;
};

export const Character = () => (
  <KeyboardControls map={controls}>
    <Level />
    <Player />
  </KeyboardControls>
);
