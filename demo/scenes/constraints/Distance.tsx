import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, Vector3 } from "three";
import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";

const PIVOT_HEIGHT = 6.5;
/** Anchor to ball, the same on both rigs so they swing the same arc. */
const REACH = 4;
const BALL_RADIUS = 0.6;
const BALL_MASS = 25;
const BRICK = 0.8;

const ROPE_LINKS = 10;
const LINK_SPACING = 0.34;
const LINK_MASS = 3;
/** Long enough to clear the weight, so the last link never sits inside it. */
const BALL_DROP = 1.1;
const ROPE_LENGTH = ROPE_LINKS * LINK_SPACING + BALL_DROP;
/** Lays the rope out short of its own length, so it starts gathered and droops. */
const ROPE_GATHER = REACH / ROPE_LENGTH;
/**
 * A chain is solved a link at a time, so a correction at one end needs a pass
 * per link to reach the other. Jolt's defaults leave a rope this long visibly
 * stretchy under the weight on the end of it; the extra passes are cheap here
 * because they are asked for per joint rather than raised world-wide.
 */
const ROPE_POSITION_STEPS = 8;
const ROPE_VELOCITY_STEPS = 20;

type Link = BodyApi<Jolt.SphereShape>;
type TubeEnd = Vec3Tuple | Link | null | undefined;

const UP = new Vector3(0, 1, 0);
// Shared scratch: a rope of a dozen tubes cannot afford three fresh vectors each.
const tubeFrom = new Vector3();
const tubeTo = new Vector3();
const tubeAxis = new Vector3();

const readTubeEnd = (end: TubeEnd, into: Vector3) => {
  if (!end) return false;

  if (Array.isArray(end)) {
    into.set(end[0], end[1], end[2]);
    return true;
  }

  const position = end.body.GetPosition();
  into.set(position.GetX(), position.GetY(), position.GetZ());
  return true;
};

/**
 * The joint itself, drawn: physics knows where the rope is but renders nothing,
 * and a ball swinging on empty air reads as a bug. One unit cylinder re-aimed
 * every frame costs far less than rebuilding a curve through React would, so
 * this is deliberately imperative — the same bargain `useBeam` makes.
 */
const Tube = ({
  from,
  to,
  radius,
  color,
}: {
  from: TubeEnd;
  to: TubeEnd;
  radius: number;
  color: string;
}) => {
  const tube = useRef<Mesh>(null);

  useFrame(() => {
    const mesh = tube.current;
    if (!mesh) return;

    if (!readTubeEnd(from, tubeFrom) || !readTubeEnd(to, tubeTo)) {
      mesh.visible = false;
      return;
    }

    tubeAxis.subVectors(tubeTo, tubeFrom);
    const length = tubeAxis.length();

    mesh.visible = length > 1e-4;
    if (!mesh.visible) return;

    mesh.position.addVectors(tubeFrom, tubeTo).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, tubeAxis.divideScalar(length));
    mesh.scale.set(1, length, 1);
  });

  return (
    <mesh ref={tube} castShadow>
      <cylinderGeometry args={[radius, radius, 1, 10]} />
      <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} />
    </mesh>
  );
};

/** Anchoring to the world draws nothing, so both rigs would hang from thin air. */
const Anchor = ({ x }: { x: number }) => {
  const size: Vec3Tuple = [0.6, 0.4, 0.6];
  const [ref] = useBox({
    size,
    position: [x, PIVOT_HEIGHT, 0],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#4a4a4a" />
    </mesh>
  );
};

const Weight = ({
  weightRef,
  color,
}: {
  weightRef: React.Ref<Mesh>;
  color: string;
}) => (
  <mesh ref={weightRef} castShadow>
    <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
    <meshStandardMaterial color={color} metalness={0.3} />
  </mesh>
);

const pivotOf = (x: number): Vec3Tuple => [x, PIVOT_HEIGHT, 0];
/** Both rigs start held out level with their pivot, so the quarter circle they
 *  fall through carries them into the wall's upper courses. */
const restOf = (x: number): Vec3Tuple => [x - REACH, PIVOT_HEIGHT, 0];

const Rod = ({ x }: { x: number }) => {
  const pivot = pivotOf(x);
  const start = restOf(x);
  const [ref, ball] = useSphere({
    radius: BALL_RADIUS,
    position: start,
    motionType: "dynamic",
    mass: BALL_MASS,
  });

  useDistanceConstraint(null, ball, {
    point1: pivot,
    point2: start,
    minDistance: REACH,
    maxDistance: REACH,
  });

  return (
    <>
      <Anchor x={x} />
      <Tube from={pivot} to={ball} radius={0.09} color="#7f8c8d" />
      <Weight weightRef={ref} color="#3498db" />
    </>
  );
};

const linkPosition = (x: number, index: number): Vec3Tuple => [
  x - index * LINK_SPACING * ROPE_GATHER,
  PIVOT_HEIGHT,
  0,
];

const RopeWeight = ({ x, above }: { x: number; above: Link | undefined }) => {
  const anchor = linkPosition(x, ROPE_LINKS);
  const start = restOf(x);
  const [ref, ball] = useSphere({
    radius: BALL_RADIUS,
    position: start,
    motionType: "dynamic",
    mass: BALL_MASS,
  });

  useDistanceConstraint(above, ball, {
    point1: anchor,
    point2: start,
    minDistance: BALL_DROP,
    maxDistance: BALL_DROP,
    numPositionStepsOverride: ROPE_POSITION_STEPS,
    numVelocityStepsOverride: ROPE_VELOCITY_STEPS,
  });

  return (
    <>
      <Tube from={above ?? anchor} to={ball} radius={0.06} color="#c0392b" />
      <Weight weightRef={ref} color="#e74c3c" />
    </>
  );
};

/**
 * Each link needs the body before it, which only exists once that link has
 * mounted, so this recurses rather than looping over an array. The link bodies
 * themselves are never drawn: the tubes between them are the rope.
 */
const RopeLink = ({
  x,
  index,
  above,
}: {
  x: number;
  index: number;
  above: Link | null | undefined;
}) => {
  const start = linkPosition(x, index + 1);
  const [, link] = useSphere({
    radius: 0.06,
    position: start,
    motionType: "dynamic",
    mass: LINK_MASS,
  });

  useDistanceConstraint(above, link, {
    point1: linkPosition(x, index),
    point2: start,
    minDistance: LINK_SPACING,
    maxDistance: LINK_SPACING,
    numPositionStepsOverride: ROPE_POSITION_STEPS,
    numVelocityStepsOverride: ROPE_VELOCITY_STEPS,
  });

  return (
    <>
      <Tube
        from={above ?? linkPosition(x, index)}
        to={link}
        radius={0.06}
        color="#c0392b"
      />

      {index + 1 < ROPE_LINKS ? (
        <RopeLink x={x} index={index + 1} above={link} />
      ) : (
        <RopeWeight x={x} above={link} />
      )}
    </>
  );
};

const Rope = ({ x }: { x: number }) => (
  <>
    <Anchor x={x} />
    <RopeLink x={x} index={0} above={null} />
  </>
);

const Brick = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useBox({
    size: [BRICK, BRICK, BRICK],
    position,
    motionType: "dynamic",
    mass: 3,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[BRICK, BRICK, BRICK]} />
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
          position={[
            x + column * (BRICK + 0.05),
            BRICK / 2 + row * (BRICK + 0.05),
            0,
          ]}
        />
      )),
    )}
  </>
);

export const DistanceConstraintScene = () => (
  <>
    <Floor size={40} />

    <Rod x={-4} />
    <Wall x={-4} />

    <Rope x={6} />
    <Wall x={6} />

    <Tag position={[-4, 8, 0]}>one joint, min = max · a rigid rod</Tag>
    <Tag position={[6, 8, 0]}>
      {ROPE_LINKS + 1} joints, min = max each · a rope
    </Tag>
  </>
);
