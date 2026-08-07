import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useFixedConstraint } from "@/Jolt/useFixedConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type Jolt from "jolt-physics";

const BLOCK = 0.9;
const BLOCKS = 5;

type Block = BodyApi<Jolt.BoxShape>;

/**
 * Each block welds itself to the one below. `autoDetectPoint` is on by default,
 * so the joint locks them exactly where they were placed and needs no anchors.
 */
const TowerBlock = ({
  x,
  index,
  below,
  welded,
  color,
}: {
  x: number;
  index: number;
  below: Block | null | undefined;
  welded: boolean;
  color: string;
}) => {
  const [ref, api] = useBox({
    size: [BLOCK, BLOCK, BLOCK],
    position: [x, BLOCK / 2 + index * BLOCK, 0],
    motionType: "dynamic",
    mass: 4,
  });

  // An undefined body means "no joint yet", so the unwelded tower simply never
  // gets one and the bottom block never joins to anything.
  useFixedConstraint(welded ? below : undefined, api);

  return (
    <>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[BLOCK, BLOCK, BLOCK]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {index + 1 < BLOCKS && (
        <TowerBlock
          x={x}
          index={index + 1}
          below={api}
          welded={welded}
          color={color}
        />
      )}
    </>
  );
};

const Tower = ({
  x,
  welded,
  color,
}: {
  x: number;
  welded: boolean;
  color: string;
}) => (
  // The bottom block has nothing below it, and welding it to the world would
  // pin the whole tower down — so only the joints between blocks exist.
  <TowerBlock x={x} index={0} below={undefined} welded={welded} color={color} />
);

const Cannonball = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.6,
    position: [x, 2.5, -8],
    motionType: "dynamic",
    mass: 40,
    initialVelocity: [0, 0, 12],
    gravityFactor: 0,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.6, 24, 24]} />
      <meshStandardMaterial color="#c0392b" metalness={0.4} />
    </mesh>
  );
};

export const FixedConstraintScene = () => (
  <>
    <Floor size={40} />

    <Tower x={-3} welded color="#2ecc71" />
    <Tower x={3} welded={false} color="#e67e22" />

    <Cannonball x={-3} />
    <Cannonball x={3} />

    <Tag position={[-3, 6, 0]}>welded · topples as one piece</Tag>
    <Tag position={[3, 6, 0]}>stacked · scatters</Tag>
  </>
);
