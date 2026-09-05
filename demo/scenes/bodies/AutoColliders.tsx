import { useMemo } from "react";
import { BoxGeometry, TorusKnotGeometry, type BufferGeometry } from "three";
import { Floor, Tag } from "../../shared/Stage";
import { useAutoCollider } from "@/Jolt/useAutoCollider";
import type { AutoColliderKind } from "@/Jolt/useAutoCollider";
import type { Vec3Tuple } from "@/Jolt/types";

/** Modelled with its feet at the origin, as a great many meshes arrive. */
const footedBox = () => {
  const geometry = new BoxGeometry(1.2, 2.4, 1.2);
  geometry.translate(0, 1.2, 0);
  return geometry;
};

const Dropped = ({
  x,
  collider,
  color,
  scale = [1, 1, 1],
  geometry,
}: {
  x: number;
  collider: AutoColliderKind;
  color: string;
  scale?: Vec3Tuple;
  geometry: () => BufferGeometry;
}) => {
  const shape = useMemo(() => geometry(), [geometry]);

  const [ref] = useAutoCollider({
    collider,
    position: [x, 7, 0],
    motionType: "dynamic",
    material: { restitution: 0.2 },
  });

  return (
    <mesh ref={ref} scale={scale} geometry={shape} castShadow>
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const knot = () => new TorusKnotGeometry(0.5, 0.2, 48, 8);
const cube = () => new BoxGeometry(1.4, 1.4, 1.4);

export const AutoColliders = () => (
  <>
    <Floor size={26} />

    <Dropped x={-6} collider="box" color="#8e44ad" geometry={cube} />
    <Tag position={[-6, 1.6, 0]}>box</Tag>

    <Dropped
      x={-2}
      collider="sphere"
      color="#2980b9"
      geometry={knot}
      scale={[1.4, 1.4, 1.4]}
    />
    <Tag position={[-2, 1.6, 0]}>sphere</Tag>

    <Dropped x={2} collider="hull" color="#16a085" geometry={knot} />
    <Tag position={[2, 1.6, 0]}>hull</Tag>

    <Dropped x={6} collider="box" color="#d35400" geometry={footedBox} />
  </>
);
