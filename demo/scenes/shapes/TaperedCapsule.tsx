import { Floor, Tag } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useTaperedCapsule } from "@/Jolt/useTaperedCapsule";
import type { QuatTuple } from "@/Jolt/types";

const Cone = ({
  position,
  rotation,
  topRadius,
  bottomRadius,
  height,
  color,
}: {
  position: [number, number, number];
  rotation: QuatTuple;
  topRadius: number;
  bottomRadius: number;
  height: number;
  color: string;
}) => {
  const [ref, api] = useTaperedCapsule({
    position,
    rotation,
    topRadius,
    bottomRadius,
    height,
    motionType: "dynamic",
    mass: 3,
    material: { friction: 0.5 },
  });

  // The generated geometry is the collider's own triangulation, so it always
  // matches exactly — there is no primitive in three for this shape.
  return api ? (
    <mesh ref={ref} geometry={api.geometry} castShadow>
      <meshStandardMaterial color={color} />
    </mesh>
  ) : null;
};

export const TaperedCapsule = () => (
  <>
    <Floor />

    {/* Dropped leaning: every end of a tapered capsule is a sphere cap, so like
        a plain capsule it has nothing flat to balance on and rolls to rest. */}
    <Cone
      position={[-3, 6, 0]}
      rotation={tilt([0, 0, 1], 0.4)}
      topRadius={0.15}
      bottomRadius={0.7}
      height={1.4}
      color="#8e44ad"
    />
    <Cone
      position={[0, 6, 0]}
      rotation={tilt([0.3, 0, 1], 0.7)}
      topRadius={0.7}
      bottomRadius={0.15}
      height={1.4}
      color="#16a085"
    />
    <Cone
      position={[3, 6, 0]}
      rotation={tilt([1, 0, 0.2], Math.PI / 2)}
      topRadius={0.5}
      bottomRadius={0.5}
      height={1}
      color="#d35400"
    />

    <Tag position={[0, 9, 0]}>
      no equivalent in rapier or cannon · equal radii is just a capsule
    </Tag>
  </>
);
