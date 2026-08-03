import { Floor, Tag } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useCylinder } from "@/Jolt/useCylinder";

const Drum = ({
  position,
  rotation,
  height,
  radius,
  color,
}: {
  position: [number, number, number];
  rotation?: [number, number, number, number];
  height: number;
  radius: number;
  color: string;
}) => {
  const [ref] = useCylinder({
    position,
    rotation,
    height,
    radius,
    motionType: "dynamic",
    mass: 4,
    material: { friction: 0.3 },
  });

  return (
    <mesh ref={ref} castShadow>
      <cylinderGeometry args={[radius, radius, height, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

// Quarter turn about z, so the cylinder lands on its side and rolls.
const ON_ITS_SIDE = tilt([0, 0, 1], Math.PI / 2);

export const Cylinder = () => (
  <>
    <Floor />

    {/* A flat end is something to land on, so the tall one has to be leaned far
        enough that its centre of mass clears the rim — otherwise it just rights
        itself. The squat one is stable at the same angle and stays put. */}
    <Drum
      position={[-3, 6, 0]}
      rotation={tilt([0.2, 0, 1], 0.7)}
      height={1.5}
      radius={0.6}
      color="#8e44ad"
    />
    <Drum
      position={[0, 6, 0]}
      rotation={tilt([0.2, 0, 1], 0.7)}
      height={0.4}
      radius={1.2}
      color="#16a085"
    />
    <Drum
      position={[4, 6, 0]}
      rotation={ON_ITS_SIDE}
      height={2}
      radius={0.5}
      color="#d35400"
    />

    <Tag position={[-3, 8.5, 0]}>topples</Tag>
    <Tag position={[0.2, 8.5, 0]}>settles flat</Tag>
    <Tag position={[4, 8.5, 0]}>rotated onto its side — it rolls</Tag>
  </>
);
