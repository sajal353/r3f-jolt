import { Floor } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useTaperedCylinder } from "@/Jolt/useTaperedCylinder";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

const Piece = ({
  position,
  rotation,
  topRadius,
  bottomRadius,
  height,
  color,
}: {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  topRadius: number;
  bottomRadius: number;
  height: number;
  color: string;
}) => {
  const [ref] = useTaperedCylinder({
    position,
    rotation,
    topRadius,
    bottomRadius,
    height,
    motionType: "dynamic",
    mass: 4,
    material: { friction: 0.6 },
  });

  return (
    <mesh ref={ref} castShadow>
      <cylinderGeometry args={[topRadius, bottomRadius, height, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const TaperedCylinder = () => (
  <>
    <Floor />

    <Piece
      position={[-3.5, 2, 0]}
      topRadius={0}
      bottomRadius={0.9}
      height={1.8}
      color="#8e44ad"
    />
    <Piece
      position={[-1.2, 2, 0]}
      topRadius={0.25}
      bottomRadius={0.9}
      height={2.2}
      color="#16a085"
    />
    <Piece
      position={[1.2, 2, 0]}
      topRadius={0.9}
      bottomRadius={0.3}
      height={2.2}
      color="#d35400"
    />

    {/* Leaned past its base circle, so this one goes over. */}
    <Piece
      position={[3.5, 2.2, 0]}
      rotation={tilt([0, 0, 1], 1.2)}
      topRadius={0.2}
      bottomRadius={0.8}
      height={2}
      color="#c0392b"
    />
  </>
);
