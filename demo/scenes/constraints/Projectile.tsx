import { useSphere } from "@/Jolt/useSphere";
import { ballisticVelocity } from "../../shared/helpers";
import type { Vec3Tuple } from "@/Jolt/types";

/**
 * The thing that knocks a joint about, shared by every constraint scene. It is
 * aimed rather than pointed: give it the spot on the target it should strike and
 * it works out the launch velocity, so it arcs in under the same gravity as
 * everything else and drops to the floor once it has done its job.
 */
export const Projectile = ({
  from,
  to,
  seconds = 0.7,
  radius = 0.4,
  mass = 25,
  color = "#e67e22",
}: {
  from: Vec3Tuple;
  to: Vec3Tuple;
  seconds?: number;
  radius?: number;
  mass?: number;
  color?: string;
}) => {
  const [ref] = useSphere({
    radius,
    position: from,
    motionType: "dynamic",
    mass,
    initialVelocity: ballisticVelocity(from, to, seconds),
    linearDamping: 0,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[radius, 20, 20]} />
      <meshStandardMaterial color={color} metalness={0.3} />
    </mesh>
  );
};
