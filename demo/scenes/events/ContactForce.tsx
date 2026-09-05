import { useState } from "react";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import type { Vec3Tuple } from "@/Jolt/types";

const REST = 4.5;
const PLATE: Vec3Tuple = [2.6, 0.3, 2.6];
const DROP = 4;

const WEIGHTS = [2, 6, 14, 30];

const Rig = ({ x, mass }: { x: number; mass: number }) => {
  const [hit, setHit] = useState<{ speed: number; impulse: number } | null>(
    null,
  );

  const [pillarRef, pillar] = useBox({
    position: [x, 1, 0],
    size: [0.7, 2, 0.7],
    motionType: "static",
  });

  const [plateRef, plate] = useBox({
    position: [x, REST, 0],
    size: PLATE,
    motionType: "dynamic",
    mass: 6,
    material: { friction: 0.9, restitution: 0 },
  });

  useSliderConstraint(pillar, plate, {
    point: [x, REST, 0],
    sliderAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: 0, max: 0 },
    limitsSpring: { frequency: 2, damping: 0.2 },
  });

  const size = 0.5 + mass / 42;

  const [weightRef, weight] = useBox({
    position: [x, REST + PLATE[1] / 2 + size / 2 + DROP, 0],
    size: [size, size, size],
    motionType: "dynamic",
    mass,
    material: { friction: 0.9, restitution: 0 },
  });

  useBodyContacts(
    weight?.body,
    {
      onEnter: (contact) =>
        setHit((current) =>
          current ?? { speed: contact.impactSpeed, impulse: contact.impulse },
        ),
    },
    { contactForce: true },
  );

  return (
    <>
      <mesh ref={pillarRef} receiveShadow>
        <boxGeometry args={[0.7, 2, 0.7]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>

      <mesh ref={plateRef} castShadow receiveShadow>
        <boxGeometry args={PLATE} />
        <meshStandardMaterial color="#5dade2" />
      </mesh>

      <mesh ref={weightRef} castShadow>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color="#e67e22" />
      </mesh>

      <Tag position={[x, REST + DROP + 1.6, 0]}>{mass} kg</Tag>

      <Tag position={[x, 2.6, 0]}>
        {hit ? (
          <>
            {hit.speed.toFixed(1)} m/s
            <br />
            <b>{hit.impulse.toFixed(0)}</b> kg·m/s
          </>
        ) : (
          "—"
        )}
      </Tag>
    </>
  );
};

export const ContactForce = () => {
  const [generation, setGeneration] = useState(0);

  return (
    <>
      <Floor size={40} />

      {WEIGHTS.map((mass, index) => (
        <Rig key={`${generation}-${mass}`} x={index * 5 - 7.5} mass={mass} />
      ))}

      <Hud position={[0, REST + DROP + 3.4, 0]}>
        Same drop, four weights. They land at the same speed — the impulse and
        the sink are what differ.
      </Hud>

      <Controls position={[0, REST + DROP + 2.6, 0]}>
        <button onClick={() => setGeneration((n) => n + 1)}>drop again</button>
      </Controls>
    </>
  );
};
