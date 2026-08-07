import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import type { SpringOptions } from "@/Jolt/internal/constraintSettings";
import type { Vec3Tuple } from "@/Jolt/types";

const BOB_SIZE: Vec3Tuple = [1.2, 1.2, 1.2];
const DROP_HEIGHT = 7;
const REST_HEIGHT = 3;

/**
 * The spring lives on the slider's *limits*, so the bob falls freely until it
 * reaches the bottom stop and the spring then decides how it settles there.
 */
const SprungBob = ({
  x,
  spring,
  color,
  generation,
}: {
  x: number;
  spring: SpringOptions;
  color: string;
  generation: number;
}) => {
  const home: Vec3Tuple = [x, REST_HEIGHT, 0];
  const [ref, bob] = useBox({
    size: BOB_SIZE,
    position: home,
    motionType: "dynamic",
    mass: 15,
  });

  useSliderConstraint(null, bob, {
    point: home,
    sliderAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: 0, max: DROP_HEIGHT - REST_HEIGHT },
    limitsSpring: spring,
    debug: true,
  });

  useEffect(() => {
    bob?.setPositionAndRotation(
      [x, DROP_HEIGHT, 0],
      [0, 0, 0, 1],
      // Waking it matters: after the first drop the bob is asleep, and a
      // teleport alone would leave it hanging at the top.
      true,
    );
    bob?.setLinearVelocity([0, 0, 0]);
  }, [bob, x, generation]);

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={BOB_SIZE} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const SETTINGS: { spring: SpringOptions; label: string; color: string }[] = [
  { spring: { frequency: 1, damping: 0.1 }, label: "1 Hz · damping 0.1", color: "#e74c3c" },
  { spring: { frequency: 2, damping: 0.3 }, label: "2 Hz · damping 0.3", color: "#e67e22" },
  { spring: { frequency: 4, damping: 0.5 }, label: "4 Hz · damping 0.5", color: "#f1c40f" },
  { spring: { frequency: 8, damping: 1 }, label: "8 Hz · damping 1", color: "#2ecc71" },
  { spring: { stiffness: 4000, damping: 0.6 }, label: "stiffness 4000", color: "#3498db" },
];

const SPACING = 3;
const RELEASE_INTERVAL = 6;

export const SpringsScene = () => {
  const [generation, setGeneration] = useState(0);
  const sinceRelease = useRef(0);

  useFrame((_, delta) => {
    sinceRelease.current += delta;
    if (sinceRelease.current < RELEASE_INTERVAL) return;

    sinceRelease.current = 0;
    setGeneration((count) => count + 1);
  });

  const left = -((SETTINGS.length - 1) * SPACING) / 2;

  return (
    <>
      <Floor size={40} />

      {SETTINGS.map((entry, index) => (
        <SprungBob
          key={entry.label}
          x={left + index * SPACING}
          spring={entry.spring}
          color={entry.color}
          generation={generation}
        />
      ))}

      {SETTINGS.map((entry, index) => (
        <Tag key={entry.label} position={[left + index * SPACING, 9, 0]}>
          {entry.label}
        </Tag>
      ))}

      <Controls position={[0, 10.5, 0]}>
        <button onClick={() => setGeneration((count) => count + 1)}>
          drop again
        </button>
      </Controls>
    </>
  );
};
