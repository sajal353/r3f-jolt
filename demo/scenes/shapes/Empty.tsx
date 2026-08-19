import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { Floor, Tag } from "../../shared/Stage";
import { useEmpty } from "@/Jolt/useEmpty";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";

const HEIGHT = 7;
const SWEEP = 4;
const REACH = 3.5;

type Anchor = BodyApi<Jolt.EmptyShape>;

const Weight = ({ anchor }: { anchor: Anchor }) => {
  const [ref, api] = useSphere({
    radius: 0.5,
    position: [0, HEIGHT - REACH, 0],
    motionType: "dynamic",
    mass: 20,
  });

  useDistanceConstraint(anchor, api, {
    point1: [0, HEIGHT, 0],
    point2: [0, HEIGHT - REACH, 0],
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.5, 24, 24]} />
      <meshStandardMaterial color="#c0392b" />
    </mesh>
  );
};

const Crate = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useBox({
    size: [0.8, 0.8, 0.8],
    position,
    motionType: "dynamic",
    mass: 3,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color="#3498db" />
    </mesh>
  );
};

/**
 * A one-sided constraint (`null` for one body) bolts to the world and cannot
 * move. An empty body is what you reach for when the anchor has to travel.
 */
export const Empty = () => {
  const [, anchor] = useEmpty({
    position: [0, HEIGHT, 0],
    motionType: "kinematic",
  });

  // An empty shape has no geometry for the hook to hand back.
  const marker = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    if (!anchor) return;

    anchor.moveKinematic(
      [Math.sin(clock.elapsedTime * 0.8) * SWEEP, HEIGHT, 0],
      [0, 0, 0, 1],
    );

    if (marker.current) {
      const position = anchor.body.GetPosition();
      marker.current.position.set(
        position.GetX(),
        position.GetY(),
        position.GetZ(),
      );
    }
  });

  return (
    <>
      <Floor />

      <mesh ref={marker}>
        <octahedronGeometry args={[0.35]} />
        <meshStandardMaterial color="#f1c40f" wireframe />
      </mesh>

      {anchor && <Weight anchor={anchor} />}

      <Tag position={[0, HEIGHT + 1.6, 0]}>no collider, still a body</Tag>

      <Crate position={[-1.5, 11, 0]} />
      <Crate position={[0.6, 13, 0]} />
      <Crate position={[2.2, 15, 0]} />
    </>
  );
};
