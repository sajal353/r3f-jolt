import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";

const UPRIGHT: [number, number, number, number] = [0, 0, 0, 1];

/**
 * The wrong way to move something continuously. A teleport lands the body
 * somewhere with **zero** velocity, so it never sweeps through the space in
 * between and imparts nothing to what it touches.
 */
const Teleported = () => {
  const [ref, api] = useBox({
    position: [-4, 1, -3],
    size: [1.5, 2, 1.5],
    motionType: "kinematic",
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;
    elapsed.current += delta;
    api.setPositionAndRotation(
      [-4 + Math.sin(elapsed.current) * 3, 1, -3],
      UPRIGHT,
    );
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1.5, 2, 1.5]} />
      <meshStandardMaterial color="#c0392b" />
    </mesh>
  );
};

/** The right way: the same path, driven so Jolt knows the velocity. */
const Driven = () => {
  const [ref, api] = useBox({
    position: [-4, 1, 3],
    size: [1.5, 2, 1.5],
    motionType: "kinematic",
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;
    elapsed.current += delta;
    api.moveKinematic([-4 + Math.sin(elapsed.current) * 3, 1, 3], UPRIGHT);
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1.5, 2, 1.5]} />
      <meshStandardMaterial color="#27ae60" />
    </mesh>
  );
};

const Skittle = ({ z }: { z: number }) => {
  const [ref] = useSphere({
    radius: 0.4,
    position: [0, 0.4, z],
    motionType: "dynamic",
    mass: 1,
    material: { friction: 0.3 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 20, 20]} />
      <meshStandardMaterial color="#ecf0f1" />
    </mesh>
  );
};

/** A genuine teleport: one-shot relocation, which is what the call is for. */
const Respawner = () => {
  const [ref, api] = useSphere({
    radius: 0.5,
    position: [6, 6, 0],
    motionType: "dynamic",
    mass: 2,
  });

  return (
    <mesh
      ref={ref}
      castShadow
      onClick={() => api?.setPositionAndRotation([6, 6, 0], UPRIGHT)}
    >
      <sphereGeometry args={[0.5, 24, 24]} />
      <meshStandardMaterial color="#f1c40f" />
    </mesh>
  );
};

export const Teleport = () => (
  <>
    <Floor size={50} />

    <Teleported />
    <Skittle z={-3} />
    <Tag position={[-4, 3.5, -3]}>setPositionAndRotation · passes through</Tag>

    <Driven />
    <Skittle z={3} />
    <Tag position={[-4, 3.5, 3]}>moveKinematic · pushes the ball</Tag>

    <Respawner />
    <Tag position={[6, 7.5, 0]}>click to teleport home</Tag>

    <Hud position={[0, 9, 0]}>
      same path, same speed — only the green one carries velocity
    </Hud>
  </>
);
