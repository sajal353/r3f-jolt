import { Floor } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";

const Ball = ({
  position,
  radius,
  restitution,
  color,
}: {
  position: [number, number, number];
  radius: number;
  restitution: number;
  color: string;
}) => {
  const [ref] = useSphere({
    position,
    radius,
    motionType: "dynamic",
    mass: 2,
    material: { restitution, friction: 0.4 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[radius, 28, 28]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const Sphere = () => (
  <>
    <Floor restitution={0.5} />

    {/* Same drop height, different restitution: the left ball barely bounces,
        the right one comes most of the way back. */}
    <Ball position={[-4, 8, 0]} radius={0.6} restitution={0} color="#2c3e50" />
    <Ball
      position={[-1.5, 8, 0]}
      radius={0.6}
      restitution={0.4}
      color="#2980b9"
    />
    <Ball
      position={[1.5, 8, 0]}
      radius={0.6}
      restitution={0.8}
      color="#27ae60"
    />
    <Ball position={[4, 8, 0]} radius={0.6} restitution={1} color="#f1c40f" />
  </>
);
