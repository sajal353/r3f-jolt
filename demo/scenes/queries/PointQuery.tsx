import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, MeshStandardMaterial, Plane, Vector3 } from "three";
import { Floor, Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useCylinder } from "@/Jolt/useCylinder";
import { useSphere } from "@/Jolt/useSphere";
import { usePointQuery } from "@/Jolt/usePointQuery";
import type { Vec3Tuple } from "@/Jolt/types";

/** The body the point is currently inside, if any. Read by every shape. */
const found = { bodyID: 0 };

const HIT = "#f1c40f";

const useHighlight = (
  mesh: React.RefObject<Mesh | null>,
  bodyID: number | undefined,
  idle: string,
) => {
  useFrame(() => {
    if (!mesh.current || bodyID === undefined) return;

    const material = mesh.current.material as MeshStandardMaterial;
    material.color.set(found.bodyID === bodyID ? HIT : idle);
  });
};

const idOf = (
  api:
    | { body: { GetID: () => { GetIndexAndSequenceNumber: () => number } } }
    | undefined,
) => api?.body.GetID().GetIndexAndSequenceNumber();

const Slab = ({ position, color }: { position: Vec3Tuple; color: string }) => {
  const size: Vec3Tuple = [2.4, 2.4, 2.4];
  const [ref, api] = useBox({ size, position, motionType: "static" });
  const mesh = useRef<Mesh>(null);

  useHighlight(mesh, idOf(api), color);

  return (
    <mesh
      ref={(node) => {
        mesh.current = node;
        ref.current = node;
      }}
      castShadow
      receiveShadow
    >
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Orb = ({ position, color }: { position: Vec3Tuple; color: string }) => {
  const [ref, api] = useSphere({
    radius: 1.4,
    position,
    motionType: "static",
  });
  const mesh = useRef<Mesh>(null);

  useHighlight(mesh, idOf(api), color);

  return (
    <mesh
      ref={(node) => {
        mesh.current = node;
        ref.current = node;
      }}
      castShadow
      receiveShadow
    >
      <sphereGeometry args={[1.4, 32, 32]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Drum = ({ position, color }: { position: Vec3Tuple; color: string }) => {
  const [ref, api] = useCylinder({
    radius: 1.3,
    height: 2.6,
    position,
    motionType: "static",
  });
  const mesh = useRef<Mesh>(null);

  useHighlight(mesh, idOf(api), color);

  return (
    <mesh
      ref={(node) => {
        mesh.current = node;
        ref.current = node;
      }}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[1.3, 1.3, 2.6, 32]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

/**
 * Follows the pointer across the z = 0 plane and asks what is at that point.
 * A very short ray is the usual substitute for this, and it answers a different
 * question: a ray has to *enter* a body, so one starting inside reports nothing.
 */
const Probe = () => {
  const raycaster = useThree((state) => state.raycaster);
  const [query] = usePointQuery();

  const marker = useRef<Mesh>(null);
  const point = useMemo(() => new Vector3(), []);
  const plane = useMemo(() => new Plane(new Vector3(0, 0, 1), 0), []);
  const [inside, setInside] = useState(false);

  useFrame(() => {
    if (!query) return;
    if (!raycaster.ray.intersectPlane(plane, point)) return;

    marker.current?.position.copy(point);

    const hit = query.query(point);
    found.bodyID = hit.hit ? hit.bodyID : 0;
    setInside(hit.hit);
  });

  return (
    <>
      <mesh ref={marker}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color={inside ? HIT : "#ffffff"} />
      </mesh>

      <Hud position={[0, 6.6, 0]}>
        {inside
          ? "the point is inside a body"
          : "move the pointer over a shape"}
      </Hud>
    </>
  );
};

export const PointQuery = () => (
  <>
    <Floor size={40} />

    <Slab position={[-5, 1.2, 0]} color="#3498db" />
    <Orb position={[0, 1.4, 0]} color="#9b59b6" />
    <Drum position={[5, 1.3, 0]} color="#16a085" />

    <Probe />
  </>
);
