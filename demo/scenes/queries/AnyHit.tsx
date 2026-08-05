import { useCallback, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshStandardMaterial, Vector3, type Mesh } from "three";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBeam } from "../../shared/helpers";
import { useAnyHitRaycaster } from "@/Jolt/useAnyHitRaycaster";
import { useBox } from "@/Jolt/useBox";
import type { QuatTuple } from "@/Jolt/types";

const EYE = new Vector3(-9, 2.5, 0);
const TARGETS = [
  new Vector3(9, 2.5, -4),
  new Vector3(9, 2.5, 0),
  new Vector3(9, 2.5, 4),
];

const CLEAR = "#2ecc71";
const BLOCKED = "#e74c3c";
const UPRIGHT: QuatTuple = [0, 0, 0, 1];

/** Pillars sliding across the sight lines, so each one is cut and restored. */
const Patroller = ({ x, phase }: { x: number; phase: number }) => {
  const [ref, api] = useBox({
    position: [x, 1.6, 0],
    size: [1.2, 3.2, 1.2],
    motionType: "kinematic",
  });

  const elapsed = useRef(phase);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta * 0.8;
    api.moveKinematic([x, 1.6, Math.sin(elapsed.current) * 5], UPRIGHT);
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1.2, 3.2, 1.2]} />
      <meshStandardMaterial color="#8e44ad" />
    </mesh>
  );
};

/**
 * Line of sight is the any-hit question: not *what* is in the way or how far,
 * only whether anything is. Jolt returns as soon as it meets a hit instead of
 * comparing distances, which is what makes this the cheapest cast — and why the
 * hit it finds is not necessarily the nearest one.
 */
const Sightline = ({
  target,
  onChange,
}: {
  target: Vector3;
  onChange: (blocked: boolean) => void;
}) => {
  const [raycaster] = useAnyHitRaycaster();
  const beam = useBeam(CLEAR);
  const marker = useRef<Mesh>(null);
  const direction = useRef(new Vector3());
  const wasBlocked = useRef(false);

  useFrame(() => {
    if (!raycaster) return;

    direction.current.copy(target).sub(EYE);
    const blocked = raycaster.cast(EYE, direction.current).hit;

    beam.set(EYE, target);
    beam.setColor(blocked ? BLOCKED : CLEAR);

    const material = marker.current?.material;
    if (material instanceof MeshStandardMaterial) {
      material.color.set(blocked ? BLOCKED : CLEAR);
    }

    if (blocked === wasBlocked.current) return;

    wasBlocked.current = blocked;
    onChange(blocked);
  });

  return (
    <>
      <primitive object={beam.object} />
      <mesh ref={marker} position={target.toArray()}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color={CLEAR} />
      </mesh>
    </>
  );
};

export const AnyHit = () => {
  const [blocked, setBlocked] = useState(0);

  const onChange = useCallback(
    (isBlocked: boolean) => setBlocked((count) => count + (isBlocked ? 1 : -1)),
    [],
  );

  return (
    <>
      <Floor size={50} />

      <Patroller x={-1} phase={0} />
      <Patroller x={4} phase={2.1} />

      {TARGETS.map((target) => (
        <Sightline key={target.z} target={target} onChange={onChange} />
      ))}

      <mesh position={EYE.toArray()}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial color="#f1c40f" emissive="#4a3c00" />
      </mesh>

      <Tag position={[-9, 4, 0]}>observer</Tag>

      <Hud position={[0, 7, 0]}>
        {TARGETS.length - blocked} of {TARGETS.length} targets visible — three
        boolean casts a frame, no distances compared and no body reported
      </Hud>
    </>
  );
};
