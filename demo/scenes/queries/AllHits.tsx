import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3, type Mesh } from "three";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBeam } from "../../shared/helpers";
import { useAllHitsRaycaster } from "@/Jolt/useAllHitsRaycaster";
import { useBox } from "@/Jolt/useBox";

const ORIGIN = new Vector3(-10, 2.5, 0);
const SPAN = 22;
const PANES = [-5, -2, 1, 4, 7];

const Pane = ({ x, userData }: { x: number; userData: number }) => {
  const [ref] = useBox({
    position: [x, 2.5, 0],
    size: [0.2, 3, 3],
    motionType: "static",
    userData,
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[0.2, 3, 3]} />
      <meshStandardMaterial color="#5dade2" transparent opacity={0.35} />
    </mesh>
  );
};

const Beam = ({ onHits }: { onHits: (hits: number[]) => void }) => {
  const [raycaster] = useAllHitsRaycaster();
  const beam = useBeam("#f1c40f");
  const direction = useRef(new Vector3());
  const end = useRef(new Vector3());
  const elapsed = useRef(0);

  // One marker per pane the ray could possibly cross, parked out of sight until
  // a cast needs it — allocating meshes inside the frame loop is the one thing
  // a query demo should not model.
  const markers = useRef<(Mesh | null)[]>([]);

  useFrame((_, delta) => {
    if (!raycaster) return;

    elapsed.current += delta;
    direction.current.set(SPAN, Math.sin(elapsed.current) * 2.2, 0);
    beam.set(ORIGIN, end.current.copy(ORIGIN).add(direction.current));

    const hits = raycaster.cast(ORIGIN, direction.current);

    markers.current.forEach((marker, index) => {
      if (!marker) return;

      marker.visible = index < hits.length;
      if (index < hits.length) marker.position.copy(hits[index].point);
    });

    // Nearest first, so the distances come out ascending. The array and the
    // hits in it are reused between casts — copy anything you keep.
    onHits(hits.map((hit) => Number(hit.distance.toFixed(2))));
  });

  return (
    <>
      <primitive object={beam.object} />
      {PANES.map((x, index) => (
        <mesh
          key={x}
          ref={(mesh) => {
            markers.current[index] = mesh;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshBasicMaterial color="#f1c40f" />
        </mesh>
      ))}
    </>
  );
};

export const AllHits = () => {
  const [distances, setDistances] = useState<number[]>([]);

  return (
    <>
      <Floor size={50} />

      {/* Five panes in a row: a closest-hit cast would only ever report the
          first, and any-hit would report an arbitrary one. */}
      {PANES.map((x, index) => (
        <Pane key={x} x={x} userData={index + 1} />
      ))}

      <Beam onHits={setDistances} />

      <mesh position={ORIGIN.toArray()}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color="#f1c40f" emissive="#4a3c00" />
      </mesh>

      <Tag position={[-10, 4, 0]}>emitter · sweeping up and down</Tag>

      <Hud position={[0, 7, 0]}>
        {distances.length} hits · distances{" "}
        {distances.length ? distances.join(" · ") : "—"}
      </Hud>
    </>
  );
};
