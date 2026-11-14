import { useSphere } from "@/Jolt/useSphere";
import type { Shot } from "./shots";

const SHOT_RADIUS = 0.3;

export const Ball = ({ shot }: { shot: Shot }) => {
  const [ref] = useSphere({
    radius: SHOT_RADIUS,
    position: shot.position,
    initialVelocity: shot.velocity,
    motionType: "dynamic",
    mass: 3,
    motionQuality: "linearCast",
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[SHOT_RADIUS, 16, 16]} />
      <meshStandardMaterial color="#d0d3d4" metalness={0.5} roughness={0.3} />
    </mesh>
  );
};
