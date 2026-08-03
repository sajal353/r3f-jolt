import { useEffect, useRef, useState } from "react";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";

const PANE_Y = 1.5;

const Pane = ({ z }: { z: number }) => {
  const [ref] = useBox({
    position: [0, PANE_Y, z],
    size: [6, 0.06, 1.6],
    motionType: "static",
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[6, 0.06, 1.6]} />
      <meshStandardMaterial color="#5dade2" transparent opacity={0.5} />
    </mesh>
  );
};

const Bullet = ({
  z,
  motionQuality,
  color,
  onRest,
}: {
  z: number;
  motionQuality: "discrete" | "linearCast";
  color: string;
  onRest: (z: number, y: number) => void;
}) => {
  const [ref, api] = useSphere({
    radius: 0.2,
    position: [0, 9, z],
    motionType: "dynamic",
    mass: 1,
    motionQuality,
    initialVelocity: [0, -70, 0],
  });

  useEffect(() => {
    if (!api) return;
    const timer = setTimeout(
      () => onRest(z, api.body.GetPosition().GetY()),
      1200,
    );
    return () => clearTimeout(timer);
  }, [api, z, onRest]);

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.2, 16, 16]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const MotionQuality = () => {
  const [outcome, setOutcome] = useState<Record<string, string>>({});
  const seen = useRef<Record<number, boolean>>({});

  const record = (z: number, y: number) => {
    if (seen.current[z]) return;
    seen.current[z] = true;

    const label = z < 0 ? "discrete" : "linearCast";
    setOutcome((current) => ({
      ...current,
      [label]: y > PANE_Y ? "stopped on the pane" : "tunnelled through",
    }));
  };

  return (
    <>
      <Floor size={40} />

      {/* Both fired at 70 m/s into a 6 cm pane. At 1/60 s that is 1.2 m of
          travel per step, so a discrete body can be above the pane on one step
          and below it on the next, never testing the gap between. */}
      <Pane z={-2} />
      <Bullet z={-2} motionQuality="discrete" color="#e74c3c" onRest={record} />

      <Pane z={2} />
      <Bullet
        z={2}
        motionQuality="linearCast"
        color="#2ecc71"
        onRest={record}
      />

      <Tag position={[3.5, PANE_Y + 0.6, -2]}>discrete</Tag>
      <Tag position={[3.5, PANE_Y + 0.6, 2]}>linearCast</Tag>

      <Hud position={[0, 7, 0]}>
        <div>discrete: {outcome.discrete ?? "…"}</div>
        <div>linearCast: {outcome.linearCast ?? "…"}</div>
      </Hud>
    </>
  );
};
