import { Floor, Tag, Wall } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useCapsule } from "@/Jolt/useCapsule";
import type { QuatTuple } from "@/Jolt/types";

const Pill = ({
  position,
  rotation,
  height,
  radius,
  color,
}: {
  position: [number, number, number];
  rotation: QuatTuple;
  height: number;
  radius: number;
  color: string;
}) => {
  const [ref] = useCapsule({
    position,
    rotation,
    height,
    radius,
    motionType: "dynamic",
    mass: 3,
    material: { friction: 0.4 },
  });

  return (
    <mesh ref={ref} castShadow>
      <capsuleGeometry args={[radius, height, 8, 20]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

// A shallow slope running downhill towards −x, and a capsule laid across it so
// its axis is the axle it rolls on.
const SLOPE = tilt([0, 0, 1], 0.25);
const ON_ITS_SIDE = tilt([1, 0, 0], Math.PI / 2);

export const Capsule = () => (
  <>
    <Floor />

    {/* `height` is the cylindrical middle, not the total — a capsule is
        height + 2 × radius tall overall. Each is dropped leaning, because a
        capsule has no flat end to stand on and always settles on its side. */}
    <Pill
      position={[-3, 6, 0]}
      rotation={tilt([0, 0, 1], 0.3)}
      height={1}
      radius={0.3}
      color="#8e44ad"
    />
    <Pill
      position={[0, 6, 0]}
      rotation={tilt([0, 0, 1], 0.15)}
      height={2}
      radius={0.3}
      color="#2980b9"
    />
    <Pill
      position={[3, 6, 0]}
      rotation={tilt([0.4, 0, 1], 0.6)}
      height={0.5}
      radius={0.7}
      color="#16a085"
    />

    <Tag position={[0, 9, 0]}>height 2 + radius 0.3 → 2.6 tall</Tag>

    {/* Capsules are the shape of choice for anything that should not catch on
        seams: this one rolls down the slab and off the end rather than tipping
        over the lip. */}
    <Wall position={[8, 1.4, 0]} size={[5, 0.4, 4]} rotation={SLOPE} />
    <Pill
      position={[10, 3.5, 0]}
      rotation={ON_ITS_SIDE}
      height={1.2}
      radius={0.35}
      color="#f1c40f"
    />
  </>
);
