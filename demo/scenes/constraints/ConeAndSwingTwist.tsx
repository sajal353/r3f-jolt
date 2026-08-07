import { Floor, Tag } from "../../shared/Stage";
import { useCapsule } from "@/Jolt/useCapsule";
import { useSphere } from "@/Jolt/useSphere";
import { useConeConstraint } from "@/Jolt/useConeConstraint";
import { useSwingTwistConstraint } from "@/Jolt/useSwingTwistConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const REED_HEIGHT = 2.4;
const REED_RADIUS = 0.18;

const useReedBody = (position: Vec3Tuple) =>
  useCapsule({
    height: REED_HEIGHT,
    radius: REED_RADIUS,
    position,
    motionType: "dynamic",
    mass: 6,
  });

const ReedMesh = ({
  reedRef,
  color,
}: {
  reedRef: ReturnType<typeof useReedBody>[0];
  color: string;
}) => (
  <mesh ref={reedRef} castShadow>
    <capsuleGeometry args={[REED_RADIUS, REED_HEIGHT, 8, 16]} />
    <meshStandardMaterial color={color} />
  </mesh>
);

const ConeReed = ({
  x,
  halfConeAngle,
  color,
}: {
  x: number;
  halfConeAngle: number;
  color: string;
}) => {
  const base: Vec3Tuple = [x, 0, 0];
  const [ref, reed] = useReedBody([x, REED_HEIGHT / 2 + REED_RADIUS, 0]);

  useConeConstraint(null, reed, {
    point: base,
    twistAxis: [0, 1, 0],
    halfConeAngle,
    debug: true,
  });

  return <ReedMesh reedRef={ref} color={color} />;
};

/**
 * The same lean limit as the cone beside it, but the twist about the reed's own
 * axis is bounded too — which is the whole difference between the two hooks.
 */
const SwingTwistReed = ({
  x,
  swingAngle,
  twist,
  color,
}: {
  x: number;
  swingAngle: number;
  twist: number;
  color: string;
}) => {
  const base: Vec3Tuple = [x, 0, 0];
  const [ref, reed] = useReedBody([x, REED_HEIGHT / 2 + REED_RADIUS, 0]);

  useSwingTwistConstraint(null, reed, {
    position: base,
    twistAxis: [0, 1, 0],
    planeAxis: [1, 0, 0],
    normalHalfConeAngle: swingAngle,
    planeHalfConeAngle: swingAngle,
    twistMinAngle: -twist,
    twistMaxAngle: twist,
    debug: true,
  });

  return <ReedMesh reedRef={ref} color={color} />;
};

const Pellet = ({ x, z }: { x: number; z: number }) => {
  const [ref] = useSphere({
    radius: 0.3,
    position: [x, 1.8, z],
    motionType: "dynamic",
    mass: 12,
    initialVelocity: [0, 0, -z * 2],
    gravityFactor: 0,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshStandardMaterial color="#e67e22" />
    </mesh>
  );
};

export const ConeAndSwingTwistScene = () => (
  <>
    <Floor size={40} />

    <ConeReed x={-7} halfConeAngle={0.15} color="#3498db" />
    <ConeReed x={-4} halfConeAngle={0.5} color="#5dade2" />
    <ConeReed x={-1} halfConeAngle={1.1} color="#85c1e9" />

    <SwingTwistReed x={3} swingAngle={0.5} twist={0} color="#2ecc71" />
    <SwingTwistReed x={6} swingAngle={0.5} twist={Math.PI} color="#82e0aa" />

    <Pellet x={-7} z={4} />
    <Pellet x={-4} z={4} />
    <Pellet x={-1} z={4} />
    <Pellet x={3} z={4} />
    <Pellet x={6} z={4} />

    <Tag position={[-4, 4.5, 0]}>useConeConstraint · lean limits 0.15 / 0.5 / 1.1 rad</Tag>
    <Tag position={[4.5, 4.5, 0]}>useSwingTwistConstraint · twist locked / free</Tag>
  </>
);
