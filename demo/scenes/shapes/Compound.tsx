import { Floor } from "../../shared/Stage";
import { tilt } from "../../shared/helpers";
import { useCompound } from "@/Jolt/useCompound";
import type { CompoundChild } from "@/Jolt/useCompound";
import type { QuatTuple } from "@/Jolt/types";

// A dumbbell: one bar, two weights. A compound is the way to build a body whose
// collider is not one primitive — it stays a single rigid body.
const dumbbell: CompoundChild[] = [
  { type: "cylinder", position: [0, 0, 0], height: 2.4, radius: 0.12 },
  { type: "sphere", position: [0, 1.2, 0], radius: 0.45 },
  { type: "sphere", position: [0, -1.2, 0], radius: 0.45 },
];

const chair: CompoundChild[] = [
  { type: "box", position: [0, 0, 0], size: [1.4, 0.15, 1.4] },
  { type: "box", position: [0, 0.75, -0.62], size: [1.4, 1.5, 0.15] },
  { type: "box", position: [-0.6, -0.5, -0.6], size: [0.12, 1, 0.12] },
  { type: "box", position: [0.6, -0.5, -0.6], size: [0.12, 1, 0.12] },
  { type: "box", position: [-0.6, -0.5, 0.6], size: [0.12, 1, 0.12] },
  { type: "box", position: [0.6, -0.5, 0.6], size: [0.12, 1, 0.12] },
];

// One child is invalid on purpose. It is skipped with a console error and the
// rest of the compound still builds, rather than Jolt rejecting the whole shape
// and taking the body with it.
const withBadChild: CompoundChild[] = [
  { type: "box", position: [0, 0, 0], size: [1.8, 0.4, 0.4] },
  { type: "box", position: [0, 0, 0], size: [0.4, 1.8, 0.4] },
  { type: "sphere", position: [0, 0.9, 0], radius: -1 },
];

const Assembly = ({
  position,
  rotation,
  shapes,
  color,
}: {
  position: [number, number, number];
  rotation: QuatTuple;
  shapes: CompoundChild[];
  color: string;
}) => {
  const [ref, api] = useCompound({
    position,
    rotation,
    shapes,
    motionType: "dynamic",
    mass: 6,
    material: { friction: 0.6 },
  });

  return api ? (
    <mesh ref={ref} geometry={api.geometry} castShadow>
      <meshStandardMaterial color={color} />
    </mesh>
  ) : null;
};

export const Compound = () => (
  <>
    <Floor />

    <Assembly
      position={[-3.5, 6, 0]}
      rotation={tilt([0.3, 0, 1], 0.9)}
      shapes={dumbbell}
      color="#8e44ad"
    />
    <Assembly
      position={[0, 6, 0]}
      rotation={tilt([1, 0.4, 0.5], 0.8)}
      shapes={chair}
      color="#16a085"
    />
    <Assembly
      position={[3.5, 6, 0]}
      rotation={tilt([0.5, 0, 1], 0.6)}
      shapes={withBadChild}
      color="#d35400"
    />
  </>
);
