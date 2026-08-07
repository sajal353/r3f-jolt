import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import type { LimitOptions } from "@/Jolt/internal/constraintSettings";
import type { Vec3Tuple } from "@/Jolt/types";

const DOOR_SIZE: Vec3Tuple = [2, 3, 0.2];
const HINGE_HEIGHT = 2;

const Door = ({
  x,
  limits,
  color,
}: {
  x: number;
  limits?: LimitOptions;
  color: string;
}) => {
  const hinge: Vec3Tuple = [x, HINGE_HEIGHT, 0];
  const [ref, door] = useBox({
    size: DOOR_SIZE,
    position: [x + DOOR_SIZE[0] / 2 + 0.3, HINGE_HEIGHT, 0],
    motionType: "dynamic",
    mass: 20,
  });

  useHingeConstraint(null, door, {
    point: hinge,
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits,
    debug: true,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={DOOR_SIZE} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Knocker = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.4,
    position: [x + 1, HINGE_HEIGHT, -5],
    motionType: "dynamic",
    mass: 25,
    initialVelocity: [0, 0, 7],
    gravityFactor: 0,
    linearDamping: 0,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 20, 20]} />
      <meshStandardMaterial color="#e67e22" />
    </mesh>
  );
};

export const HingeConstraintScene = () => (
  <>
    <Floor size={40} />

    <Door x={-6} color="#3498db" />
    <Door x={0} limits={{ min: -Math.PI / 4, max: Math.PI / 4 }} color="#2ecc71" />
    <Door x={6} limits={{ min: 0, max: 0 }} color="#95a5a6" />

    <Knocker x={-6} />
    <Knocker x={0} />
    <Knocker x={6} />

    <Tag position={[-6, 5, 0]}>no limits · swings right through</Tag>
    <Tag position={[0, 5, 0]}>limits ±45°</Tag>
    <Tag position={[6, 5, 0]}>limits 0…0 · held shut</Tag>
  </>
);
