import type { Ref } from "react";
import type { MeshStandardMaterial } from "three";

/** A capsule with a visor, since a capsule alone does not show which way it faces. */
export const Figure = ({
  height,
  radius,
  color,
  material,
}: {
  height: number;
  radius: number;
  color: string;
  material?: Ref<MeshStandardMaterial>;
}) => (
  <group position={[0, height / 2 + radius, 0]}>
    <mesh castShadow>
      <capsuleGeometry args={[radius, height, 8, 20]} />
      <meshStandardMaterial ref={material} color={color} roughness={0.45} />
    </mesh>
    <mesh position={[0, height / 2 + radius * 0.3, radius * 0.9]} castShadow>
      <boxGeometry args={[radius * 1.1, radius * 0.34, radius * 0.5]} />
      <meshStandardMaterial color="#101010" roughness={0.3} />
    </mesh>
  </group>
);
