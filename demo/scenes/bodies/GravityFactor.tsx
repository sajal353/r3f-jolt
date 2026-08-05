import { Floor, Tag } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";

const Balloon = ({
  x,
  gravityFactor,
  color,
}: {
  x: number;
  gravityFactor: number;
  color: string;
}) => {
  const [ref] = useSphere({
    radius: 0.5,
    position: [x, 4, 0],
    motionType: "dynamic",
    mass: 1,
    gravityFactor,
    linearDamping: 0.3,
    material: { restitution: 0.4 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.5, 24, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const GravityFactor = () => (
  <>
    <Floor size={50} />

    {/* Per-body gravity scaling. Negative floats, zero hangs, values above one
        fall harder — all without touching world gravity. */}
    <Balloon x={-6} gravityFactor={-0.4} color="#e74c3c" />
    <Balloon x={-3} gravityFactor={0} color="#f1c40f" />
    <Balloon x={0} gravityFactor={0.25} color="#2ecc71" />
    <Balloon x={3} gravityFactor={1} color="#3498db" />
    <Balloon x={6} gravityFactor={3} color="#8e44ad" />

    <Tag position={[-6, 6, 0]}>−0.4 · floats up</Tag>
    <Tag position={[-3, 6, 0]}>0</Tag>
    <Tag position={[0, 6, 0]}>0.25</Tag>
    <Tag position={[3, 6, 0]}>1</Tag>
    <Tag position={[6, 6, 0]}>3</Tag>
  </>
);
