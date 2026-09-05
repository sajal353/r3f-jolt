import { useState } from "react";
import { Controls, Floor, Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useSensor } from "@/Jolt/useSensor";
import type { Vec3Tuple } from "@/Jolt/types";

const VOLUME: Vec3Tuple = [6, 4, 6];

const DROPS: Vec3Tuple[] = [
  [-1.4, 8, -1.2],
  [1.2, 10, 0.8],
  [0.2, 12, -0.6],
  [-5.4, 9, 1.4],
  [5.6, 11, -1.6],
];

const Ball = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useSphere({
    position,
    radius: 0.5,
    motionType: "dynamic",
    mass: 2,
    material: { friction: 0.7, restitution: 0.1 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.5, 20, 14]} />
      <meshStandardMaterial color="#e67e22" />
    </mesh>
  );
};

export const SensorVolumes = () => {
  const [generation, setGeneration] = useState(0);

  const [, api] = useBox({
    position: [0, VOLUME[1] / 2, 0],
    size: VOLUME,
    motionType: "static",
    sensor: true,
  });

  const [inside] = useSensor(api?.body);

  return (
    <>
      <Floor size={40} />

      <mesh position={[0, VOLUME[1] / 2, 0]}>
        <boxGeometry args={VOLUME} />
        <meshStandardMaterial
          color={inside.length > 0 ? "#f1c40f" : "#27ae60"}
          transparent
          opacity={0.16}
        />
      </mesh>

      {DROPS.map((position, index) => (
        <Ball key={`${generation}-${index}`} position={position} />
      ))}

      <Hud position={[0, VOLUME[1] + 1.6, 0]}>
        <b>{inside.length}</b> of {DROPS.length} inside
      </Hud>

      <Controls position={[0, VOLUME[1] + 3, 0]}>
        <button onClick={() => setGeneration((n) => n + 1)}>drop again</button>
      </Controls>
    </>
  );
};
