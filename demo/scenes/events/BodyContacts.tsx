import { useCallback, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useContactListener } from "@/Jolt/useContactListener";

const FLOOR = 1;
const HAZARD = 2;

const Floor = () => {
  const [ref] = useBox({
    position: [0, -0.5, 0],
    size: [40, 1, 40],
    motionType: "static",
    userData: FLOOR,
    material: { friction: 0.6, restitution: 0.3 },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[40, 1, 40]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  );
};

const Hazard = () => {
  const [ref] = useBox({
    position: [3, 0.25, 0],
    size: [4, 0.5, 4],
    motionType: "static",
    userData: HAZARD,
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[4, 0.5, 4]} />
      <meshStandardMaterial color="#8e2b2b" />
    </mesh>
  );
};

const Ball = ({
  id,
  position,
  onLanded,
}: {
  id: number;
  position: [number, number, number];
  onLanded: (id: number, hitHazard: boolean) => void;
}) => {
  const [ref, api] = useSphere({
    radius: 0.4,
    position,
    motionType: "dynamic",
    mass: 5,
    userData: 100 + id,
    material: { restitution: 0.5 },
  });

  const [touched, setTouched] = useState(false);

  useBodyContacts(api?.body, {
    onEnter: (contact) => {
      setTouched(true);
      if (contact.userData === HAZARD) {
        onLanded(id, true);
        api?.kill();
      }
    },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 24, 24]} />
      <meshStandardMaterial color={touched ? "#27ae60" : "#3498db"} />
    </mesh>
  );
};

const SAMPLE_SECONDS = 0.25;

/**
 * The raw listener fires inside the step, far more often than a frame — it counts
 * into a ref and this publishes a snapshot a few times a second.
 */
const Sampler = ({
  count,
  onSample,
}: {
  count: { current: number };
  onSample: (value: number) => void;
}) => {
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < SAMPLE_SECONDS) return;

    elapsed.current = 0;
    onSample(count.current);
  });

  return null;
};

export const BodyContacts = () => {
  const [balls, setBalls] = useState(() =>
    Array.from({ length: 8 }, (_, index) => ({
      id: index,
      position: [-4 + index * 1.1, 6 + index * 0.4, Math.sin(index) * 1.5] as [
        number,
        number,
        number,
      ],
    })),
  );

  const [rawContacts, setRawContacts] = useState(0);
  const rawCount = useRef(0);

  useContactListener({
    onContactAdded: () => {
      rawCount.current += 1;
    },
  });

  const handleLanded = useCallback((id: number) => {
    setBalls((current) => current.filter((ball) => ball.id !== id));
  }, []);

  return (
    <>
      <Floor />
      <Hazard />
      {balls.map((ball) => (
        <Ball
          key={ball.id}
          id={ball.id}
          position={ball.position}
          onLanded={handleLanded}
        />
      ))}
      <Sampler count={rawCount} onSample={setRawContacts} />

      <Hud position={[0, 8, 0]}>
        {balls.length} balls left · {rawContacts} raw contacts
      </Hud>
    </>
  );
};
