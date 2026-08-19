import { useState } from "react";
import { Controls, Tag } from "../../shared/Stage";
import { usePlane } from "@/Jolt/usePlane";
import { useSphere } from "@/Jolt/useSphere";
import type { Vec3Tuple } from "@/Jolt/types";

const RENDER_SIZE = 20;
const HALF_EXTENT = 60;

const Ground = () => {
  const [ref, api] = usePlane({
    position: [0, 0, 0],
    motionType: "static",
    halfExtent: HALF_EXTENT,
    renderSize: RENDER_SIZE,
    material: { friction: 0.1 },
  });

  return api ? (
    <mesh ref={ref} geometry={api.geometry} receiveShadow>
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  ) : null;
};

const Ball = ({
  start,
  velocity,
  color,
}: {
  start: Vec3Tuple;
  velocity: Vec3Tuple;
  color: string;
}) => {
  const [ref] = useSphere({
    radius: 0.4,
    position: start,
    motionType: "dynamic",
    mass: 2,
    initialVelocity: velocity,
    material: { friction: 0.05, restitution: 0.1 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 20, 20]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const ROLLERS: { velocity: Vec3Tuple; color: string }[] = [
  { velocity: [9, 0, 0], color: "#e74c3c" },
  { velocity: [-9, 0, 0], color: "#3498db" },
  { velocity: [0, 0, 9], color: "#f1c40f" },
  { velocity: [0, 0, -9], color: "#2ecc71" },
  { velocity: [6.5, 0, 6.5], color: "#9b59b6" },
];

export const Plane = () => {
  const [generation, setGeneration] = useState(0);

  return (
    <>
      <Ground />

      <Tag position={[0, 0.6, RENDER_SIZE / 2]}>mesh ends here</Tag>

      {ROLLERS.map(({ velocity, color }, index) => (
        <Ball
          key={`${generation}-${index}`}
          start={[0, 0.5, 0]}
          velocity={velocity}
          color={color}
        />
      ))}

      <Controls position={[0, 5, 0]}>
        <button onClick={() => setGeneration((n) => n + 1)}>roll again</button>
      </Controls>
    </>
  );
};
