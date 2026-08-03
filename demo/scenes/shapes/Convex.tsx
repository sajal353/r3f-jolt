import { Floor, Tag } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useConvex } from "@/Jolt/useConvex";
import type { QuatTuple } from "@/Jolt/types";

const tetrahedron = [
  [0, 1, 0],
  [-1, -0.6, 1],
  [1, -0.6, 1],
  [0, -0.6, -1.2],
];

const gem = [
  [0, 1.2, 0],
  [-0.8, 0, -0.8],
  [0.8, 0, -0.8],
  [0.8, 0, 0.8],
  [-0.8, 0, 0.8],
  [0, -1.2, 0],
];

// Deliberately concave input: the hull spans the outer points and the dent is
// filled in, which is the thing to know about convex hulls.
const dented = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
  [0, 0, 0],
];

const Hull = ({
  position,
  rotation,
  vertices,
  color,
}: {
  position: [number, number, number];
  rotation: QuatTuple;
  vertices: number[][];
  color: string;
}) => {
  const [ref, api] = useConvex({
    position,
    rotation,
    vertices,
    motionType: "dynamic",
    mass: 3,
    material: { friction: 0.5 },
  });

  return api ? (
    <mesh ref={ref} geometry={api.geometry} castShadow>
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  ) : null;
};

export const Convex = () => (
  <>
    <Floor />

    {/* Dropped on a tilt so each lands on a face it has to topple off — a hull
        balanced on its own axis of symmetry just settles and tells you nothing
        about its collider. */}
    <Hull
      position={[-3.5, 6, 0]}
      rotation={tilt([0.6, 0.2, 1], 0.7)}
      vertices={tetrahedron}
      color="#8e44ad"
    />
    <Hull
      position={[0, 6, 0]}
      rotation={tilt([1, 0.3, 0.4], 0.9)}
      vertices={gem}
      color="#16a085"
    />
    <Hull
      position={[3.5, 6, 0]}
      rotation={tilt([0.4, 1, 0.6], 0.6)}
      vertices={dented}
      color="#d35400"
    />

    <Tag position={[3.5, 9, 0]}>
      a centre vertex was passed too — a hull cannot be concave, so it is
      ignored
    </Tag>
  </>
);
