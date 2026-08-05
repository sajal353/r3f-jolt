import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";

const Static = () => {
  const [ref] = useBox({
    position: [-4, 1, 0],
    size: [2, 2, 2],
    motionType: "static",
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#2e8b57" />
    </mesh>
  );
};

const Kinematic = () => {
  const [ref, api] = useBox({
    position: [0, 1, 0],
    size: [2, 2, 2],
    motionType: "kinematic",
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;
    elapsed.current += delta;
    api.moveKinematic(
      [0, 1 + Math.sin(elapsed.current) * 1.4, 0],
      [0, 0, 0, 1],
    );
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#1e90ff" />
    </mesh>
  );
};

const Dynamic = () => {
  const [ref] = useBox({
    position: [4, 6, 0],
    size: [2, 2, 2],
    motionType: "dynamic",
    mass: 10,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#ee82ee" />
    </mesh>
  );
};

export const MotionTypes = () => (
  <>
    <Floor />
    <Static />
    <Kinematic />
    <Dynamic />

    <Tag position={[-4, 3, 0]}>static · never moves</Tag>
    <Tag position={[0, 4, 0]}>kinematic · you move it</Tag>
    <Tag position={[4, 9, 0]}>dynamic · forces move it</Tag>

    {/* These are the same colours <PhysicsDebug /> uses for each motion type. */}
  </>
);
