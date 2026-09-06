import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh } from "three";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useCapsule } from "@/Jolt/useCapsule";
import { useShapeCaster } from "@/Jolt/useShapeCaster";
import type { Vec3Tuple } from "@/Jolt/types";

const CAPSULE_HEIGHT = 1.2;
const CAPSULE_RADIUS = 0.45;
const CAPSULE_WIDTH = CAPSULE_RADIUS * 2;

const RIDE_HEIGHT = 1.4;
const START_Z = 7;
const REACH = 14;
const SWING = 6.6;

const WALL_HALF = 9;
const WALL_HEIGHT = 3;
const WALL_DEPTH = 1.2;

const GAPS = [
  { x: -4.4, width: 1.6 },
  { x: 0, width: 1 },
  { x: 4.4, width: 0.6 },
];

/** The wall as the spans between the gaps, so the gaps are what is described. */
const spans = () => {
  const edges = [-WALL_HALF];

  for (const gap of GAPS) {
    edges.push(gap.x - gap.width / 2, gap.x + gap.width / 2);
  }

  edges.push(WALL_HALF);

  const built: { centre: number; width: number }[] = [];

  for (let i = 0; i < edges.length; i += 2) {
    const width = edges[i + 1] - edges[i];
    if (width > 0.01) built.push({ centre: edges[i] + width / 2, width });
  }

  return built;
};

const Span = ({ centre, width }: { centre: number; width: number }) => {
  const size: Vec3Tuple = [width, WALL_HEIGHT, WALL_DEPTH];

  const [ref] = useBox({
    size,
    position: [centre, WALL_HEIGHT / 2, 0],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#4a4a4a" />
    </mesh>
  );
};

/**
 * The capsule slides along the wall and sweeps at it from a fixed distance.
 * It is never added to the world in front of the wall — the body it borrows its
 * shape from is parked out of sight, and only the cast moves.
 */
const Sweep = () => {
  const [, api] = useCapsule({
    height: CAPSULE_HEIGHT,
    radius: CAPSULE_RADIUS,
    position: [0, -30, 0],
    motionType: "static",
  });

  const [caster] = useShapeCaster({
    shape: api?.shape,
    direction: [0, 0, -REACH],
  });

  const start = useRef<Mesh>(null);
  const stop = useRef<Mesh>(null);
  const path = useRef<Mesh>(null);
  const [blocked, setBlocked] = useState(true);

  useFrame((state) => {
    if (!caster || !start.current || !stop.current || !path.current) return;

    const x = Math.sin(state.clock.elapsedTime * 0.5) * SWING;
    const hit = caster.cast([x, RIDE_HEIGHT, START_Z]);
    const travel = hit.hit ? hit.fraction * REACH : REACH;

    start.current.position.set(x, RIDE_HEIGHT, START_Z);
    stop.current.position.set(x, RIDE_HEIGHT, START_Z - travel);

    path.current.position.set(x, RIDE_HEIGHT, START_Z - travel / 2);
    path.current.scale.set(1, travel, 1);

    setBlocked(hit.hit);
  });

  const colour = blocked ? "#e74c3c" : "#2ecc71";

  return (
    <>
      <mesh ref={start}>
        <capsuleGeometry args={[CAPSULE_RADIUS, CAPSULE_HEIGHT, 8, 20]} />
        <meshStandardMaterial color={colour} transparent opacity={0.25} />
      </mesh>

      <mesh ref={path} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1, 8]} />
        <meshBasicMaterial color={colour} />
      </mesh>

      <mesh ref={stop} castShadow>
        <capsuleGeometry args={[CAPSULE_RADIUS, CAPSULE_HEIGHT, 8, 20]} />
        <meshStandardMaterial color={colour} />
      </mesh>

      <Hud position={[0, 6.4, 0]}>
        capsule {CAPSULE_WIDTH.toFixed(1)} wide ·{" "}
        {blocked ? "stopped by the wall" : "through the gap"}
      </Hud>
    </>
  );
};

export const ShapeCast = () => (
  <>
    <Floor size={40} />

    {spans().map((span) => (
      <Span key={span.centre} centre={span.centre} width={span.width} />
    ))}

    {GAPS.map((gap) => (
      <Tag key={gap.x} position={[gap.x, 3.6, 0]}>
        {gap.width.toFixed(1)}
      </Tag>
    ))}

    <Sweep />
  </>
);
