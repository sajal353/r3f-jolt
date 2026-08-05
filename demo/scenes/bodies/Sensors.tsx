import { useEffect, useRef, useState } from "react";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useBodyContacts } from "@/Jolt/useBodyContacts";

const Gate = ({
  x,
  label,
  collideKinematicVsNonDynamic,
  onCount,
}: {
  x: number;
  label: string;
  collideKinematicVsNonDynamic?: boolean;
  onCount: (label: string, n: number) => void;
}) => {
  const [ref, api] = useBox({
    position: [x, 2.5, 0],
    size: [3, 3, 3],
    motionType: "static",
    sensor: true,
    collideKinematicVsNonDynamic,
  });

  const [inside, setInside] = useState(0);
  const total = useRef(0);

  useBodyContacts(api?.body, {
    onEnter: () => {
      total.current += 1;
      onCount(label, total.current);
      setInside((n) => n + 1);
    },
    onExit: () => setInside((n) => Math.max(0, n - 1)),
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[3, 3, 3]} />
      <meshStandardMaterial
        color={inside > 0 ? "#f1c40f" : "#27ae60"}
        transparent
        opacity={0.2}
      />
    </mesh>
  );
};

const Rain = ({ x }: { x: number }) => {
  const [drops, setDrops] = useState<number[]>([]);
  const next = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      next.current += 1;
      setDrops((current) => [...current.slice(-4), next.current]);
    }, 700);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {drops.map((id) => (
        <Drop key={id} x={x} />
      ))}
    </>
  );
};

const Drop = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.3,
    position: [x, 8, 0],
    motionType: "dynamic",
    mass: 1,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.3, 18, 18]} />
      <meshStandardMaterial color="#ecf0f1" />
    </mesh>
  );
};

export const Sensors = () => {
  const [counts, setCounts] = useState<Record<string, number>>({});

  return (
    <>
      <Floor size={50} />

      {/* A sensor still needs a layer that collides — it is the *impulse* that
          is skipped, not the collision test. The balls fall straight through. */}
      <Gate
        x={-4}
        label="plain"
        onCount={(label, n) => setCounts((c) => ({ ...c, [label]: n }))}
      />
      <Rain x={-4} />

      <Gate
        x={4}
        label="kinematic-aware"
        collideKinematicVsNonDynamic
        onCount={(label, n) => setCounts((c) => ({ ...c, [label]: n }))}
      />
      <Rain x={4} />

      <Tag position={[-4, 5, 0]}>sensor</Tag>
      <Tag position={[4, 5, 0]}>+ collideKinematicVsNonDynamic</Tag>

      <Hud position={[0, 8, 0]}>
        entries — plain: {counts.plain ?? 0} · kinematic-aware:{" "}
        {counts["kinematic-aware"] ?? 0}
      </Hud>
    </>
  );
};
