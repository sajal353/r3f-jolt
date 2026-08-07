import { Floor, Tag } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type Jolt from "jolt-physics";

const LINK_RADIUS = 0.25;
const LINK_SPACING = 0.7;
const TOP = 8;

type Link = BodyApi<Jolt.SphereShape>;

/**
 * `null` means "join to the world", `undefined` means "that body has not been
 * created yet" and the joint waits — so the two cannot be collapsed together.
 */
const ChainLink = ({
  x,
  y,
  above,
  remaining,
  color,
}: {
  x: number;
  y: number;
  above: Link | null | undefined;
  remaining: number;
  color: string;
}) => {
  const [ref, api] = useSphere({
    radius: LINK_RADIUS,
    position: [x, y, 0],
    motionType: "dynamic",
    mass: 2,
  });

  usePointConstraint(above, api, {
    point: [x, y + LINK_SPACING / 2, 0],
    debug: true,
  });

  return (
    <>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[LINK_RADIUS, 16, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {remaining > 0 && (
        <ChainLink
          x={x}
          y={y - LINK_SPACING}
          above={api}
          remaining={remaining - 1}
          color={color}
        />
      )}
    </>
  );
};

const Chain = ({
  x,
  links,
  color,
}: {
  x: number;
  links: number;
  color: string;
}) => (
  <ChainLink x={x} y={TOP} above={null} remaining={links - 1} color={color} />
);

const Wrecker = () => {
  const [ref] = useSphere({
    radius: 0.8,
    position: [-7, 7, 0],
    motionType: "dynamic",
    mass: 60,
    initialVelocity: [9, 0, 0],
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.8, 24, 24]} />
      <meshStandardMaterial color="#c0392b" metalness={0.4} />
    </mesh>
  );
};

export const PointConstraintScene = () => (
  <>
    <Floor size={40} />

    <Chain x={-2} links={6} color="#3498db" />
    <Chain x={1} links={6} color="#2ecc71" />
    <Chain x={4} links={10} color="#f1c40f" />

    <Wrecker />

    <Tag position={[-2, 9, 0]}>top link joined to the world</Tag>
    <Tag position={[4, 9, 0]}>10 links</Tag>
  </>
);
