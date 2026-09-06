import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Vector3,
} from "three";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import type { Vec3Tuple } from "@/Jolt/types";

const ORBITERS = 3;
const ORBIT_RADIUS = 3;
const BALL_RADIUS = 0.28;
/** Tuned for a ~6s orbit, which is slow enough to survive a 1/15 timestep. */
const PULL = 30;
const TRAIL_POINTS = 140;

type Driver = "step" | "frame";

const pullDirection = new Vector3();

const createTrail = (start: Vec3Tuple, color: string) => {
  const positions = new Float32Array(TRAIL_POINTS * 3);

  for (let point = 0; point < TRAIL_POINTS; point += 1) {
    positions.set(start, point * 3);
  }

  const attribute = new BufferAttribute(positions, 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", attribute);

  const line = new Line(geometry, new LineBasicMaterial({ color }));
  // The buffer is rewritten every step and its bounds never recomputed.
  line.frustumCulled = false;

  return { positions, attribute, line };
};

type Trail = ReturnType<typeof createTrail>;

/**
 * One body held in orbit by a force nothing in the library applies for it —
 * `gravityFactor: 0`, so the pull towards the centre is the only thing acting.
 * Whether that pull arrives once per step or once per frame is the whole scene.
 */
const Orbiter = ({
  centre,
  index,
  driver,
  color,
}: {
  centre: Vec3Tuple;
  index: number;
  driver: Driver;
  color: string;
}) => {
  const angle = (index / ORBITERS) * Math.PI * 2;
  const speed = Math.sqrt(PULL / ORBIT_RADIUS);

  const start = useMemo<Vec3Tuple>(
    () => [
      centre[0] + Math.cos(angle) * ORBIT_RADIUS,
      centre[1] + Math.sin(angle) * ORBIT_RADIUS,
      centre[2],
    ],
    [centre, angle],
  );

  const [ref, api] = useSphere({
    radius: BALL_RADIUS,
    position: start,
    motionType: "dynamic",
    mass: 1,
    gravityFactor: 0,
    linearDamping: 0,
    allowSleeping: false,
    initialVelocity: [
      -Math.sin(angle) * speed,
      Math.cos(angle) * speed,
      0,
    ] as Vec3Tuple,
  });

  // The trail lives in a ref and is added to the scene by hand: its buffer is
  // rewritten every step, and a value React hands back is not ours to mutate.
  const trailRef = useRef<Trail | null>(null);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const trail = createTrail(start, color);
    scene.add(trail.line);
    trailRef.current = trail;

    return () => {
      trailRef.current = null;
      scene.remove(trail.line);
      trail.line.geometry.dispose();
      trail.line.material.dispose();
    };
  }, [scene, start, color]);

  const pull = () => {
    if (!api) return;

    const position = api.body.GetPosition();
    pullDirection.set(
      centre[0] - position.GetX(),
      centre[1] - position.GetY(),
      centre[2] - position.GetZ(),
    );

    const distance = pullDirection.length();
    if (distance < BALL_RADIUS) return;

    // Cubed rather than squared: the extra division normalizes the direction.
    api.applyForce(
      pullDirection.multiplyScalar(PULL / (distance * distance * distance)),
    );
  };

  useBeforePhysicsStep(() => {
    if (driver === "step") pull();
  });

  useFrame(() => {
    if (driver === "frame") pull();
  });

  // Sampled per step rather than per frame, which is the other half of why
  // these hooks exist: a trail taken in `useFrame` misses whatever happened in
  // the rest of the steps that frame.
  useAfterPhysicsStep(() => {
    const trail = trailRef.current;
    if (!api || !trail) return;

    const position = api.body.GetPosition();
    const { positions, attribute } = trail;
    const last = positions.length - 3;

    positions.copyWithin(0, 3);
    positions[last] = position.GetX();
    positions[last + 1] = position.GetY();
    positions[last + 2] = position.GetZ();

    attribute.needsUpdate = true;
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[BALL_RADIUS, 20, 20]} />
      <meshStandardMaterial color={color} metalness={0.3} />
    </mesh>
  );
};

/**
 * The orbit the bodies are meant to be on, drawn. Without it the only way to
 * judge a ring is against the other one on the far side of the screen, and two
 * circles seen from one camera are two different ellipses — which is not a
 * comparison a viewer can make.
 */
const Guide = ({ centre }: { centre: Vec3Tuple }) => (
  <mesh position={centre}>
    <torusGeometry args={[ORBIT_RADIUS, 0.015, 6, 96]} />
    <meshBasicMaterial color="#6b6b6b" />
  </mesh>
);

/** Where the pull points. Not a body — nothing is meant to hit it. */
const Attractor = ({ centre }: { centre: Vec3Tuple }) => (
  <mesh position={centre}>
    <sphereGeometry args={[0.5, 24, 24]} />
    <meshStandardMaterial color="#f1c40f" emissive="#7d5f00" />
  </mesh>
);

const Ring = ({
  centre,
  driver,
  color,
}: {
  centre: Vec3Tuple;
  driver: Driver;
  color: string;
}) => (
  <>
    <Guide centre={centre} />
    <Attractor centre={centre} />
    {Array.from({ length: ORBITERS }, (_, index) => (
      <Orbiter
        key={index}
        centre={centre}
        index={index}
        driver={driver}
        color={color}
      />
    ))}
  </>
);

const LEFT: Vec3Tuple = [-6, 4, 0];
const RIGHT: Vec3Tuple = [6, 4, 0];

export const StepCallbacks = () => {
  const [generation, setGeneration] = useState(0);

  return (
    <>
      <Floor size={40} />

      <Ring
        key={`step-${generation}`}
        centre={LEFT}
        driver="step"
        color="#2ecc71"
      />
      <Ring
        key={`frame-${generation}`}
        centre={RIGHT}
        driver="frame"
        color="#e67e22"
      />

      <Tag position={[-6, 8, 0]}>useBeforePhysicsStep · once per step</Tag>
      <Tag position={[6, 8, 0]}>useFrame · once per frame</Tag>

      <Controls position={[0, 9.4, 0]}>
        <button onClick={() => setGeneration((value) => value + 1)}>
          restart orbits
        </button>
      </Controls>

      <Hud position={[0, 10.6, 0]}>
        each ring should trace its own grey circle · a fixed step is not a frame
      </Hud>
    </>
  );
};
