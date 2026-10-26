import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import type { ConstraintLoad } from "@/Jolt/internal/useConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const PLANK_SIZE: Vec3Tuple = [3, 0.2, 1];
const CRATE_SIZE: Vec3Tuple = [0.8, 0.8, 0.8];
const HANG_HEIGHT = 4;
const BREAK_FORCE = 5000;

/**
 * A plank hung by its two ends, and a 40 kg crate dropped on it. At rest the
 * pair carries under 500 N; what the joints feel on impact grows with the drop.
 */
const Swing = ({
  x,
  drop,
  breakForce,
  onBreak,
}: {
  x: number;
  drop: number;
  breakForce?: number;
  onBreak: (load: ConstraintLoad) => void;
}) => {
  const [plankRef, plank] = useBox({
    size: PLANK_SIZE,
    position: [x, HANG_HEIGHT, 0],
    motionType: "dynamic",
    mass: 10,
  });
  const [crateRef] = useBox({
    size: CRATE_SIZE,
    position: [x + 0.6, HANG_HEIGHT + drop, 0],
    motionType: "dynamic",
    mass: 40,
  });

  const half = PLANK_SIZE[0] / 2;

  usePointConstraint(null, plank, {
    point: [x - half, HANG_HEIGHT, 0],
    breakForce,
    onBreak,
  });
  usePointConstraint(null, plank, {
    point: [x + half, HANG_HEIGHT, 0],
    breakForce,
    onBreak,
  });

  return (
    <>
      <mesh ref={plankRef} castShadow receiveShadow>
        <boxGeometry args={PLANK_SIZE} />
        <meshStandardMaterial color="#8e6b3e" />
      </mesh>
      <mesh ref={crateRef} castShadow>
        <boxGeometry args={CRATE_SIZE} />
        <meshStandardMaterial color="#e67e22" />
      </mesh>
    </>
  );
};

const SWINGS: { x: number; drop: number; breakForce?: number; label: string }[] = [
  { x: -6, drop: 1, breakForce: BREAK_FORCE, label: "1 m drop · breakForce 5 kN" },
  { x: 0, drop: 3, breakForce: BREAK_FORCE, label: "3 m drop · breakForce 5 kN" },
  { x: 6, drop: 6, label: "6 m drop · unbreakable" },
];

const ROUND_SECONDS = 6;

const formatLoad = ({ force }: ConstraintLoad) =>
  `broke at ${(force / 1000).toFixed(1)} kN`;

export const BreakingJointsScene = () => {
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState<Record<number, string>>({});
  const sinceRound = useRef(0);

  const restart = () => {
    sinceRound.current = 0;
    setStatus({});
    setRound((count) => count + 1);
  };

  const recordBreak = (x: number) => (load: ConstraintLoad) =>
    setStatus((current) =>
      current[x] ? current : { ...current, [x]: formatLoad(load) },
    );

  useFrame((_, delta) => {
    sinceRound.current += delta;
    if (sinceRound.current >= ROUND_SECONDS) restart();
  });

  return (
    <>
      <Floor size={40} />

      {SWINGS.map((swing) => (
        <Swing
          key={`${swing.x}:${round}`}
          x={swing.x}
          drop={swing.drop}
          breakForce={swing.breakForce}
          onBreak={recordBreak(swing.x)}
        />
      ))}

      {SWINGS.map((swing) => (
        <Tag key={swing.label} position={[swing.x, HANG_HEIGHT + 4, 0]}>
          {swing.label}
          <br />
          {status[swing.x] ?? "holding"}
        </Tag>
      ))}

      <Controls position={[0, HANG_HEIGHT + 6, 0]}>
        <button onClick={restart}>drop again</button>
      </Controls>
    </>
  );
};
