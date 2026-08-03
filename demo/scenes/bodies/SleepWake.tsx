import { useState } from "react";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";

const Sleeper = ({
  x,
  allowSleeping,
  label,
  onEvent,
}: {
  x: number;
  allowSleeping?: boolean;
  label: string;
  onEvent: (line: string) => void;
}) => {
  const [asleep, setAsleep] = useState(false);

  const [ref, api] = useBox({
    position: [x, 5, 0],
    size: [1.2, 1.2, 1.2],
    motionType: "dynamic",
    mass: 4,
    allowSleeping,
    material: { restitution: 0.3 },
    onSleep: () => {
      setAsleep(true);
      onEvent(`${label} → sleep`);
    },
    onWake: () => {
      setAsleep(false);
      onEvent(`${label} → wake`);
    },
  });

  return (
    <mesh ref={ref} castShadow onClick={() => api?.applyImpulse([0, 12, 0])}>
      <boxGeometry args={[1.2, 1.2, 1.2]} />
      <meshStandardMaterial color={asleep ? "#34495e" : "#e67e22"} />
    </mesh>
  );
};

export const SleepWake = () => {
  const [log, setLog] = useState<string[]>([]);

  const push = (line: string) =>
    setLog((current) => [...current.slice(-4), line]);

  return (
    <>
      <Floor size={40} />

      {/* Click a box to punch it awake. The left one is allowed to sleep and
          goes dark when it does; the right one never sleeps. */}
      <Sleeper x={-2} label="sleepy" onEvent={push} />
      <Sleeper x={2} label="insomniac" allowSleeping={false} onEvent={push} />

      <Tag position={[-2, 7, 0]}>allowSleeping (default)</Tag>
      <Tag position={[2, 7, 0]}>allowSleeping: false</Tag>

      <Hud position={[0, 9, 0]}>
        click a box to wake it
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </Hud>
    </>
  );
};
