import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import type { AxisTriple } from "@/Jolt/types";

const Tumbler = ({
  x,
  color,
  lockRotations,
  lockTranslations,
  enabledRotations,
  enabledTranslations,
}: {
  x: number;
  color: string;
  lockRotations?: boolean;
  lockTranslations?: boolean;
  enabledRotations?: AxisTriple;
  enabledTranslations?: AxisTriple;
}) => {
  const [ref] = useBox({
    position: [x, 5, 0],
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 2,
    lockRotations,
    lockTranslations,
    enabledRotations,
    enabledTranslations,
    initialVelocity: [0, 0, 1.5],
    initialAngularVelocity: [4, 4, 4],
    material: { friction: 0.3, restitution: 0.2 },
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const DofLocks = () => (
  <>
    <Floor size={50} />

    {/* All four start with the same spin and the same sideways velocity. */}
    <Tumbler x={-6} color="#95a5a6" />
    <Tumbler x={-2} color="#3498db" lockRotations />
    <Tumbler x={2} color="#2ecc71" enabledRotations={[false, true, false]} />
    <Tumbler x={6} color="#e67e22" enabledTranslations={[true, true, false]} />

    <Tag position={[-6, 7, 0]}>free</Tag>
    <Tag position={[-2, 7, 0]}>lockRotations</Tag>
    <Tag position={[2, 7, 0]}>only Y spin</Tag>
    <Tag position={[6, 7, 0]}>no Z travel</Tag>

    <Tag position={[0, 9, 0]}>
      locks are WORLD-space — "rotation X" is the world X axis, whatever way the
      body is facing
    </Tag>
  </>
);
