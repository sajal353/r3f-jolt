import { Suspense, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, type Mesh } from "three";
import { Floor, Tag } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";
import { useTrimesh } from "@/Jolt/useTrimesh";

const SUZANNE = "/models/suzanne/Suzanne.gltf";

/** A hand-built ridged strip, to show `useTrimesh` takes raw arrays too. */
const ridges = () => {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= 20; i += 1) {
    const x = -10 + i;
    const y = i % 2 === 0 ? 0 : 0.35;
    positions.push(x, y, -3, x, y, 3);
  }

  for (let i = 0; i < 20; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const Ridges = () => {
  const geometry = useMemo(() => ridges(), []);

  // Position is where the mesh's own origin goes; the geometry already spans x.
  const [ref] = useTrimesh({ mesh: geometry, position: [0, 1.2, 0] });

  return (
    <mesh ref={ref} geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#3c6e8f" flatShading />
    </mesh>
  );
};

const Suzanne = () => {
  const gltf = useGLTF(SUZANNE);
  const geometry = (gltf.nodes.Suzanne as Mesh).geometry;

  // A glTF `BufferGeometry` goes straight in; a non-indexed one has its index
  // derived automatically.
  const [ref] = useTrimesh({ mesh: geometry, position: [6, 2, 0] });

  return (
    <mesh ref={ref} geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#8e7cc3" flatShading />
    </mesh>
  );
};

const Dropper = () =>
  Array.from({ length: 10 }, (_, i) => <Pellet key={i} index={i} />);

const Pellet = ({ index }: { index: number }) => {
  const [ref] = useSphere({
    radius: 0.22,
    position: [-8 + index * 1.5, 8 + index * 0.3, 0.4],
    motionType: "dynamic",
    mass: 1,
    material: { restitution: 0.3 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.22, 16, 16]} />
      <meshStandardMaterial color="#ecf0f1" />
    </mesh>
  );
};

export const Trimesh = () => (
  <>
    <Floor size={60} />
    <Ridges />
    <Suspense fallback={null}>
      <Suzanne />
    </Suspense>
    <Dropper />

    <Tag position={[0, 5, 0]}>
      trimesh bodies are always static — Jolt mesh shapes cannot be dynamic
    </Tag>
  </>
);

useGLTF.preload(SUZANNE);
