import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, MeshStandardMaterial } from "three";
import { Controls, Floor, Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useShapeOverlap } from "@/Jolt/useShapeOverlap";
import { useBroadphaseQuery } from "@/Jolt/useBroadphaseQuery";
import type { Vec3Tuple } from "@/Jolt/types";

const RADIUS = 2.4;
const SWEEP = 5.5;

/**
 * Which bodies each query reported, this frame. The boxes read it themselves
 * rather than being handed it as props: colouring thirty meshes through React
 * state would re-render the scene sixty times a second to change a material.
 */
const reported = { exact: new Set<number>(), broad: new Set<number>() };

// Rewritten every frame and handed straight to the query, so it lives outside
// React: a value a hook gave back is not ours to mutate.
const centre: Vec3Tuple = [0, 1, 0];

const EXACT = "#2ecc71";
const BROAD_ONLY = "#e67e22";
const IDLE = "#4a4a4a";

const Crate = ({ position }: { position: Vec3Tuple }) => {
  const size: Vec3Tuple = [1, 1, 1];
  const [ref, api] = useBox({ size, position, motionType: "static" });
  const mesh = useRef<Mesh>(null);

  useFrame(() => {
    if (!api || !mesh.current) return;

    const id = api.body.GetID().GetIndexAndSequenceNumber();
    const material = mesh.current.material as MeshStandardMaterial;

    material.color.set(
      reported.exact.has(id)
        ? EXACT
        : reported.broad.has(id)
          ? BROAD_ONLY
          : IDLE,
    );
  });

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
      <meshStandardMaterial color={IDLE} />
    </mesh>
  );
};

/**
 * The region itself: a sphere that is never added to the world. `useShapeOverlap`
 * asks what it *would* be touching, so nothing is pushed and nothing wakes up.
 */
const Region = ({ showBroad }: { showBroad: boolean }) => {
  const [, api] = useSphere({
    radius: RADIUS,
    position: [0, -40, 0],
    motionType: "static",
  });

  const [probe] = useShapeOverlap({ shape: api?.shape, mode: "all" });
  const [broad] = useBroadphaseQuery();

  const bubble = useRef<Mesh>(null);
  const [counts, setCounts] = useState({ exact: 0, broad: 0 });

  useEffect(
    () => () => {
      reported.exact.clear();
      reported.broad.clear();
    },
    [],
  );

  useFrame((state) => {
    if (!probe) return;

    centre[0] = Math.sin(state.clock.elapsedTime * 0.5) * SWEEP;
    bubble.current?.position.set(centre[0], centre[1], centre[2]);

    reported.exact.clear();
    for (const hit of probe.overlap(centre)) reported.exact.add(hit.bodyID);

    reported.broad.clear();
    if (showBroad && broad) {
      for (const id of broad.collideSphere(centre, RADIUS)) {
        if (!reported.exact.has(id)) reported.broad.add(id);
      }
    }

    setCounts({ exact: reported.exact.size, broad: reported.broad.size });
  });

  return (
    <>
      <mesh ref={bubble}>
        <sphereGeometry args={[RADIUS, 24, 24]} />
        <meshStandardMaterial color="#3498db" transparent opacity={0.18} />
      </mesh>

      <Hud position={[0, 6.4, 0]}>
        touching <b>{counts.exact}</b>
        {showBroad ? (
          <>
            {" "}
            · near enough for the broadphase to name <b>{counts.broad}</b> more
          </>
        ) : null}
      </Hud>
    </>
  );
};

const COLUMNS = [-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6];

export const ShapeOverlap = () => {
  const [showBroad, setShowBroad] = useState(true);

  return (
    <>
      <Floor size={40} />

      {COLUMNS.map((x) =>
        [0.5, 1.6, 2.7].map((y) => (
          <Crate key={`${x}-${y}`} position={[x, y, 0]} />
        )),
      )}

      <Region showBroad={showBroad} />

      <Controls position={[0, 7.6, 0]}>
        <button
          aria-pressed={showBroad}
          onClick={() => setShowBroad((value) => !value)}
        >
          {showBroad ? "hide broadphase" : "show broadphase"}
        </button>
      </Controls>
    </>
  );
};
