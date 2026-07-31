import { useRef, useState } from "react";
import { ArrowHelper, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";

const Scenery = () => {
  const [floorRef] = useBox({
    position: [0, -0.5, 0],
    size: [40, 1, 40],
    motionType: "static",
  });

  const [wallRef] = useBox({
    position: [0, 2, -6],
    size: [10, 4, 0.5],
    motionType: "static",
  });

  const [ballRef] = useSphere({
    radius: 1,
    position: [2, 1, 0],
    motionType: "dynamic",
    mass: 50,
  });

  return (
    <>
      <mesh ref={floorRef} receiveShadow>
        <boxGeometry args={[40, 1, 40]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh ref={wallRef} receiveShadow>
        <boxGeometry args={[10, 4, 0.5]} />
        <meshStandardMaterial color="#404040" />
      </mesh>
      <mesh ref={ballRef} castShadow>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial color="#e67e22" />
      </mesh>
    </>
  );
};

const Sweeper = () => {
  const [raycaster] = useClosestHitRaycaster();
  const arrowRef = useRef<ArrowHelper>(null);
  const markerRef = useRef<import("three").Mesh>(null);
  const [readout, setReadout] = useState("no hit");

  const origin = useRef(new Vector3(0, 4, 8));
  const direction = useRef(new Vector3());
  const lastUpdate = useRef(0);

  useFrame(({ clock }) => {
    if (!raycaster) return;

    const time = clock.getElapsedTime();
    direction.current
      .set(Math.sin(time * 0.6) * 0.9, -0.35, -1)
      .normalize()
      .multiplyScalar(30);

    const hit = raycaster.cast(origin.current, direction.current);

    if (arrowRef.current) {
      arrowRef.current.position.copy(origin.current);
      arrowRef.current.setDirection(
        direction.current.clone().normalize(),
      );
      arrowRef.current.setLength(hit.hit ? hit.distance : 30, 0.6, 0.3);
      arrowRef.current.setColor(hit.hit ? 0x2ecc71 : 0x777777);
    }

    if (markerRef.current) {
      markerRef.current.visible = hit.hit;
      if (hit.hit) markerRef.current.position.copy(hit.point);
    }

    if (time - lastUpdate.current > 0.1) {
      lastUpdate.current = time;
      setReadout(
        hit.hit
          ? `hit body ${hit.bodyID} · distance ${hit.distance.toFixed(2)} · ` +
              `fraction ${hit.fraction.toFixed(3)} · normal ${hit.normal
                .toArray()
                .map((value) => value.toFixed(2))
                .join(", ")}`
          : "no hit",
      );
    }
  });

  return (
    <>
      <arrowHelper ref={arrowRef} />
      <mesh ref={markerRef} visible={false}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color="#2ecc71" />
      </mesh>
      <Html position={[0, 7, 0]} center>
        <div
          style={{
            font: "12px ui-monospace, monospace",
            color: "#ddd",
            background: "rgba(0,0,0,.65)",
            padding: "4px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
          }}
        >
          {readout}
        </div>
      </Html>
    </>
  );
};

export const Raycast = () => (
  <>
    <Scenery />
    <Sweeper />
  </>
);
