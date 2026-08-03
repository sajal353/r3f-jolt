import { Floor, Tag } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useBox } from "@/Jolt/useBox";

const Crate = ({
  position,
  size,
  convexRadius,
  color,
}: {
  position: [number, number, number];
  size: [number, number, number];
  convexRadius?: number;
  color: string;
}) => {
  const [ref] = useBox({
    position,
    // Dropped square-on a box lands square-on and sits there. A tilt makes it
    // land on a corner and tumble, which is when the collider shape matters.
    rotation: tilt([0.4, 1, 0.7], 0.5),
    size,
    convexRadius,
    motionType: "dynamic",
    mass: 5,
    material: { friction: 0.5 },
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const Box = () => (
  <>
    <Floor />

    <Crate position={[-3, 6, 0]} size={[1, 1, 1]} color="#8e44ad" />
    <Crate position={[0, 6, 0]} size={[2, 0.5, 1]} color="#16a085" />
    <Crate position={[3, 6, 0]} size={[0.6, 2, 0.6]} color="#d35400" />

    {/* A large convex radius rounds the collider noticeably — the box will not
        sit flush and rolls on its edges. Default is derived from the size. */}
    <Crate
      position={[6, 6, 0]}
      size={[1, 1, 1]}
      convexRadius={0.4}
      color="#c0392b"
    />

    <Tag position={[6, 8, 0]}>
      convexRadius 0.4 — turn on <b>debug</b> to see the collider it really has
    </Tag>
  </>
);
