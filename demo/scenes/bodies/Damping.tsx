import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Tag } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

const START_X = -12;
const LAUNCH: Vec3Tuple = [5, 0, 0];
const UPRIGHT: QuatTuple = [0, 0, 0, 1];
const LAP_SECONDS = 5;

/** Puts every glider back on the line at once, so each lap is a fair race. */
const Lap = ({ onLap }: { onLap: () => void }) => {
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < LAP_SECONDS) return;

    elapsed.current = 0;
    onLap();
  });

  return null;
};

/**
 * `gravityFactor: 0` is why nothing here falls — these are coasting at the
 * height they were placed, not resting on the floor, and one that runs past the
 * edge carries straight on rather than dropping. With gravity and friction both
 * out of the way, damping is the only thing left acting on them.
 */
const Glider = ({
  z,
  lap,
  linearDamping,
  color,
}: {
  z: number;
  lap: number;
  linearDamping: number;
  color: string;
}) => {
  const [ref, api] = useSphere({
    radius: 0.4,
    position: [START_X, 0.4, z],
    motionType: "dynamic",
    mass: 1,
    linearDamping,
    gravityFactor: 0,
    initialVelocity: LAUNCH,
    material: { friction: 0 },
  });

  useEffect(() => {
    if (!api) return;

    api.setPositionAndRotation([START_X, 0.4, z], UPRIGHT);
    api.setLinearVelocity(LAUNCH);
  }, [api, lap, z]);

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 20, 20]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Spinner = ({
  x,
  angularDamping,
  color,
}: {
  x: number;
  angularDamping: number;
  color: string;
}) => {
  const [ref] = useSphere({
    radius: 0.6,
    position: [x, 0.6, 6],
    motionType: "dynamic",
    mass: 1,
    angularDamping,
    gravityFactor: 0,
    initialAngularVelocity: [0, 8, 0],
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.6, 16, 12]} />
      <meshStandardMaterial color={color} wireframe />
    </mesh>
  );
};

export const Damping = () => {
  const [lap, setLap] = useState(0);

  return (
    <>
      <Floor size={60} />
      <Lap onLap={() => setLap((current) => current + 1)} />

      <Glider z={-4} lap={lap} linearDamping={0} color="#e74c3c" />
      <Glider z={-2} lap={lap} linearDamping={0.05} color="#e67e22" />
      <Glider z={0} lap={lap} linearDamping={0.5} color="#f1c40f" />
      <Glider z={2} lap={lap} linearDamping={2} color="#2ecc71" />

      <Tag position={[START_X, 2.5, -1]}>
        linearDamping 0 · 0.05 (default) · 0.5 · 2 — launched together every{" "}
        {LAP_SECONDS}s
      </Tag>
      <Tag position={[0, 3.5, -6]}>
        gravityFactor 0 and friction 0, so nothing falls and nothing rubs —
        damping is the only force acting
      </Tag>

      <Spinner x={-4} angularDamping={0} color="#9b59b6" />
      <Spinner x={0} angularDamping={0.5} color="#8e44ad" />
      <Spinner x={4} angularDamping={3} color="#6c3483" />

      <Tag position={[0, 2.5, 6]}>angularDamping 0 · 0.5 · 3</Tag>
    </>
  );
};
