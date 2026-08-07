import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const PIVOT_HEIGHT = 9;

const Pendulum = ({
  x,
  minDistance,
  maxDistance,
  color,
  startX,
}: {
  x: number;
  minDistance: number;
  maxDistance: number;
  color: string;
  startX: number;
}) => {
  const pivot: Vec3Tuple = [x, PIVOT_HEIGHT, 0];
  const [ref, ball] = useSphere({
    radius: 0.6,
    position: [x + startX, PIVOT_HEIGHT - 1, 0],
    motionType: "dynamic",
    mass: 40,
  });

  useDistanceConstraint(null, ball, {
    point1: pivot,
    point2: [x + startX, PIVOT_HEIGHT - 1, 0],
    minDistance,
    maxDistance,
    debug: true,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.6, 24, 24]} />
      <meshStandardMaterial color={color} metalness={0.3} />
    </mesh>
  );
};

const Brick = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useBox({
    size: [0.8, 0.8, 0.8],
    position,
    motionType: "dynamic",
    mass: 3,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

const Wall = ({ x }: { x: number }) => (
  <>
    {[0, 1, 2, 3].map((row) =>
      [-1, 0, 1].map((column) => (
        <Brick
          key={`${row}-${column}`}
          position={[x + column * 0.85, 0.4 + row * 0.85, 0]}
        />
      )),
    )}
  </>
);

export const DistanceConstraintScene = () => (
  <>
    <Floor size={40} />

    {/* A rigid rod: min and max are equal, so the ball cannot fall inward. */}
    <Pendulum
      x={-7}
      minDistance={5}
      maxDistance={5}
      startX={-4}
      color="#3498db"
    />

    {/* A rope: slack until it runs out, so the ball drops before it swings. */}
    <Pendulum
      x={4}
      minDistance={0}
      maxDistance={5}
      startX={-4}
      color="#e74c3c"
    />

    <Wall x={-7} />
    <Wall x={4} />

    <Tag position={[-7, 10, 0]}>min = max · rigid rod</Tag>
    <Tag position={[4, 10, 0]}>min 0, max 5 · rope, falls first</Tag>
  </>
);
