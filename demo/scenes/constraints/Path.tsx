import { useMemo, useState } from "react";
import { CatmullRomCurve3, TubeGeometry } from "three";
import { Controls, Floor, Tag } from "../../shared/Stage";
import { useSetpoint } from "../../shared/useSetpoint";
import { useBox } from "@/Jolt/useBox";
import { usePathConstraint } from "@/Jolt/usePathConstraint";
import { samplePath, type PathPoint } from "@/Jolt/internal/constraintPath";
import type { Vec3Tuple } from "@/Jolt/types";

const FLOORS = [0.25, 3.5, 6.75];
const SHAFT_X = 9.8;

const LIFT_PATH: PathPoint[] = FLOORS.map((y) => ({
  position: [SHAFT_X, y, 0],
}));

/** A circuit with a hill and two banked bends. The normals are the banking. */
const CIRCUIT: PathPoint[] = [
  { position: [-3.5, 1, 4.5], normal: [0, 1, 0] },
  { position: [0, 3, 4.5], normal: [0, 1, 0] },
  { position: [3.5, 1, 4.5], normal: [0, 1, 0] },
  { position: [7, 2, 0], normal: [-0.6, 0.8, 0] },
  { position: [3.5, 1.5, -4.5], normal: [0, 1, 0] },
  { position: [0, 3.5, -4.5], normal: [0, 1, 0] },
  { position: [-3.5, 1.5, -4.5], normal: [0, 1, 0] },
  { position: [-7, 2, 0], normal: [0.6, 0.8, 0] },
];

/** Draws what the joint follows; the rail itself is nothing to the physics. */
const Rail = () => {
  const geometry = useMemo(() => {
    const line = samplePath({ points: CIRCUIT, looping: true }, 12);
    line.pop();
    return new TubeGeometry(new CatmullRomCurve3(line, true), 200, 0.08, 6, true);
  }, []);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#888" />
    </mesh>
  );
};

const Coaster = () => {
  const [running, setRunning] = useState(true);
  const [ref, car] = useBox({
    size: [1.2, 0.5, 0.8],
    position: CIRCUIT[0].position,
    motionType: "dynamic",
    mass: 80,
    allowSleeping: false,
  });

  // A hill needs a motor with some push, which a coaster's chain lift has.
  const [path] = usePathConstraint(null, car, {
    points: CIRCUIT,
    looping: true,
    rotation: "path",
    motor: {
      state: "velocity",
      targetVelocity: 7,
      maxForceLimit: 2500,
      minForceLimit: -2500,
    },
  });

  return (
    <>
      <Rail />
      <mesh ref={ref} castShadow>
        <boxGeometry args={[1.2, 0.5, 0.8]} />
        <meshStandardMaterial color="#e74c3c" />
      </mesh>
      <Controls position={[0, -2.2, 6]}>
        <button
          type="button"
          aria-pressed={running}
          onClick={() => {
            path?.setMotorState(running ? "off" : "velocity");
            setRunning(!running);
          }}
        >
          {running ? "chain on" : "coasting"}
        </button>
      </Controls>
    </>
  );
};

const Rider = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useBox({
    size: [0.8, 0.8, 0.8],
    position,
    motionType: "dynamic",
    mass: 10,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color="#c9a227" />
    </mesh>
  );
};

const Lift = () => {
  const [floor, setFloor] = useState(0);
  const [ref, platform] = useBox({
    size: [2.4, 0.25, 2.4],
    position: LIFT_PATH[0].position,
    motionType: "dynamic",
    mass: 60,
    allowSleeping: false,
  });

  // "fixed" so the deck stays level under a load.
  const [path] = usePathConstraint(null, platform, {
    points: LIFT_PATH,
    rotation: "fixed",
    motor: {
      state: "position",
      targetFraction: 0,
      spring: { frequency: 4, damping: 1 },
    },
  });

  // Fractions per second. A motor's target is in fractions, so a stiff spring
  // and a target several metres off would fling the rider.
  useSetpoint(floor, 0.35, path?.setTargetFraction);

  return (
    <>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.25, 2.4]} />
        <meshStandardMaterial color="#3498db" />
      </mesh>
      <Rider position={[SHAFT_X, 1, 0]} />
      <Tag position={[SHAFT_X, -0.6, 2]}>lift</Tag>
      <Controls position={[SHAFT_X, -2.2, 2]}>
        {FLOORS.map((_, index) => (
          <button
            key={index}
            type="button"
            aria-pressed={floor === index}
            onClick={() => setFloor(index)}
          >
            {index}
          </button>
        ))}
      </Controls>
    </>
  );
};

export const PathScene = () => (
  <>
    <Floor size={40} />
    <Coaster />
    <Lift />
  </>
);
