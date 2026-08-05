import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useJolt } from "@/Jolt/useJolt";

const UPRIGHT: [number, number, number, number] = [0, 0, 0, 1];

/**
 * Two views of the same body. The mesh follows the hook's interpolated
 * transform; the marker is positioned straight from Jolt every frame, so it
 * shows where the simulation actually is.
 */
const Runner = () => {
  const [ref, api] = useBox({
    position: [0, 1, 0],
    size: [1.2, 1.2, 1.2],
    motionType: "kinematic",
  });

  const marker = useRef<import("three").Mesh>(null);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    api.moveKinematic([Math.sin(elapsed.current * 1.2) * 6, 1, 0], UPRIGHT);

    if (marker.current) {
      const raw = api.body.GetPosition();
      marker.current.position.set(raw.GetX(), 2.6, raw.GetZ());
    }
  });

  return (
    <>
      <mesh ref={ref} castShadow>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshStandardMaterial color="#2ecc71" />
      </mesh>
      <mesh ref={marker}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#e74c3c" />
      </mesh>
    </>
  );
};

const Readout = () => {
  const { timing } = useJolt();
  const [sample, setSample] = useState({ alpha: 0, step: 0, on: false });

  useFrame(() => {
    setSample({
      alpha: Number(timing.alpha.toFixed(2)),
      step: Number(timing.stepDelta.toFixed(4)),
      on: timing.interpolate,
    });
  });

  return (
    <Hud position={[0, 6, 0]}>
      interpolate: {String(sample.on)} · alpha {sample.alpha} · step{" "}
      {sample.step}s
    </Hud>
  );
};

export const Interpolation = () => (
  <>
    <Floor size={50} />
    <Runner />
    <Readout />

    <Tag position={[0, 4, 0]}>
      green mesh = interpolated · red dot = raw simulation position
    </Tag>
    <Tag position={[0, 7.4, 0]}>
      set timeStep to 1/15 in the toolbar and watch the gap appear
    </Tag>
  </>
);
