import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from "three";
import { Controls, Floor, Tag } from "../../shared/Stage";
import { useSetpoint } from "../../shared/useSetpoint";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";

const FIRM = { frequency: 4, damping: 1 };

/** The hook's cable, from one body's position to the other's. */
const Cable = ({
  from,
  to,
}: {
  from: BodyApi<Jolt.Shape> | undefined;
  to: BodyApi<Jolt.Shape> | undefined;
}) => {
  const [line] = useState(() => {
    const cable = new Line(
      new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: "#ddd" }),
    );
    cable.frustumCulled = false;
    return cable;
  });
  const [ends] = useState(() => [new Vector3(), new Vector3()]);

  useFrame(function followBodies() {
    if (!from || !to) return;

    // One at a time: every body's getter hands back the same shared vector.
    const start = from.body.GetPosition();
    ends[0].set(start.GetX(), start.GetY(), start.GetZ());
    const end = to.body.GetPosition();
    ends[1].set(end.GetX(), end.GetY(), end.GetZ());
    line.geometry.setFromPoints(ends);
  });

  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );

  return <primitive object={line} />;
};

/**
 * Three joints stacked: the jib slews on a hinge, the trolley runs along it on a
 * slider, and the hook hangs from the trolley on a distance joint.
 */
const Crane = () => {
  // Left and right as from the cab, looking along the jib.
  const TOP: Vec3Tuple = [0, 6.5, 0];
  const [hookLength, setHookLength] = useState(3);
  const [reach, setReach] = useState(0);

  const [jibRef, jib] = useBox({
    size: [6, 0.3, 0.3],
    position: [2, 6.5, 0],
    motionType: "dynamic",
    mass: 80,
    allowSleeping: false,
  });
  const [trolleyRef, trolley] = useBox({
    size: [0.6, 0.3, 0.6],
    position: [2, 6.2, 0],
    motionType: "dynamic",
    mass: 20,
    allowSleeping: false,
  });
  const [hookRef, hook] = useSphere({
    radius: 0.35,
    position: [2, 3.2, 0],
    motionType: "dynamic",
    mass: 40,
    allowSleeping: false,
  });

  const [slew] = useHingeConstraint(null, jib, {
    point: TOP,
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    motor: {
      state: "velocity",
      targetAngularVelocity: 0,
      maxTorqueLimit: 8000,
      minTorqueLimit: -8000,
    },
  });
  const [run] = useSliderConstraint(jib, trolley, {
    point: [2, 6.2, 0],
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
    limits: { min: -1, max: 2.7 },
    motor: { state: "position", targetPosition: 0, spring: FIRM },
  });
  const [cable] = useDistanceConstraint(trolley, hook, {
    point1: [2, 6.2, 0],
    point2: [2, 3.2, 0],
    minDistance: 0,
    maxDistance: 3,
  });

  useSetpoint(reach, 1.2, run?.setTargetPosition);
  // A shorter cable all at once would snatch the hook, and the jib with it.
  useSetpoint(hookLength, 1, (length) => cable?.setDistance(0, length));

  return (
    <>
      <mesh position={[TOP[0], TOP[1] / 2, 0]} castShadow>
        <boxGeometry args={[0.5, TOP[1], 0.5]} />
        <meshStandardMaterial color="#555" />
      </mesh>
      <mesh ref={jibRef} castShadow>
        <boxGeometry args={[6, 0.3, 0.3]} />
        <meshStandardMaterial color="#f1c40f" />
      </mesh>
      <mesh ref={trolleyRef} castShadow>
        <boxGeometry args={[0.6, 0.3, 0.6]} />
        <meshStandardMaterial color="#aaa" />
      </mesh>
      <Cable from={trolley} to={hook} />
      <mesh ref={hookRef} castShadow>
        <sphereGeometry args={[0.35, 16, 12]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      <Tag position={[TOP[0], -0.6, 2]}>crane</Tag>
      <Controls position={[TOP[0], -2.2, 2]}>
        <button type="button" onClick={() => slew?.setTargetAngularVelocity(0.5)}>
          slew left
        </button>
        <button type="button" onClick={() => slew?.setTargetAngularVelocity(0)}>
          stop
        </button>
        <button type="button" onClick={() => slew?.setTargetAngularVelocity(-0.5)}>
          slew right
        </button>
        <button type="button" onClick={() => setReach(-0.8)}>
          in
        </button>
        <button type="button" onClick={() => setReach(2.5)}>
          out
        </button>
        <button
          type="button"
          onClick={() => setHookLength(hookLength === 3 ? 5 : 3)}
        >
          {hookLength === 3 ? "hook down" : "hook up"}
        </button>
      </Controls>
    </>
  );
};

/**
 * A hinge on a hinge. Each position motor is pointed at the target every frame,
 * and the angles it is given are relative to where the joint started.
 */
const Turret = () => {
  const BASE: Vec3Tuple = [8, 1.2, 0];

  const [baseRef, base] = useBox({
    size: [1.6, 0.4, 1.6],
    position: BASE,
    motionType: "dynamic",
    mass: 60,
    allowSleeping: false,
  });
  const [barrelRef, barrel] = useBox({
    size: [0.25, 0.25, 2.4],
    position: [BASE[0], BASE[1] + 0.5, BASE[2] + 1],
    motionType: "dynamic",
    mass: 10,
    allowSleeping: false,
  });
  const [targetRef, target] = useSphere({
    radius: 0.3,
    position: [BASE[0], 3, 4],
    motionType: "kinematic",
  });

  const [yaw] = useHingeConstraint(null, base, {
    point: BASE,
    hingeAxis: [0, 1, 0],
    normalAxis: [0, 0, 1],
    motor: { state: "position", spring: FIRM },
  });
  const [pitch] = useHingeConstraint(base, barrel, {
    point: [BASE[0], BASE[1] + 0.5, BASE[2]],
    hingeAxis: [-1, 0, 0],
    normalAxis: [0, 0, 1],
    motor: { state: "position", spring: FIRM },
  });

  const time = useRef(0);

  useFrame(function trackTarget(_, delta) {
    if (!target || !yaw || !pitch) return;

    time.current += Math.min(delta, 1 / 30);
    const sweep = 0.8 * Math.sin(time.current * 0.5);
    const x = BASE[0] + 4 * Math.sin(sweep);
    const z = BASE[2] + 4 * Math.cos(sweep);
    const y = 3 + 1.6 * Math.sin(time.current * 0.9);

    target.moveKinematic([x, y, z], [0, 0, 0, 1], 1 / 60);

    yaw.setTargetAngle(Math.atan2(x - BASE[0], z - BASE[2]));
    pitch.setTargetAngle(
      Math.atan2(y - (BASE[1] + 0.5), Math.hypot(x - BASE[0], z - BASE[2])),
    );
  });

  return (
    <>
      <mesh ref={baseRef} castShadow>
        <boxGeometry args={[1.6, 0.4, 1.6]} />
        <meshStandardMaterial color="#34495e" />
      </mesh>
      <mesh ref={barrelRef} castShadow>
        <boxGeometry args={[0.25, 0.25, 2.4]} />
        <meshStandardMaterial color="#7f8c8d" />
      </mesh>
      <mesh ref={targetRef}>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshStandardMaterial color="#e74c3c" emissive="#e74c3c" />
      </mesh>
      <Tag position={[BASE[0], -0.6, 2]}>turret</Tag>
    </>
  );
};

/** Hinged at the bank, with limits for the two rest positions. */
const Drawbridge = () => {
  const HINGE: Vec3Tuple = [-12, 1, 0];
  const [up, setUp] = useState(false);

  const [ref, deck] = useBox({
    size: [5, 0.3, 3],
    position: [HINGE[0] + 2.5, HINGE[1], 0],
    motionType: "dynamic",
    mass: 200,
    allowSleeping: false,
  });
  const [crateRef] = useBox({
    size: [0.8, 0.8, 0.8],
    position: [HINGE[0] + 3, 1.6, 0],
    motionType: "dynamic",
    mass: 5,
  });

  const [hinge] = useHingeConstraint(null, deck, {
    point: HINGE,
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    limits: { min: 0, max: 1 },
    motor: {
      state: "position",
      targetAngle: 0,
      spring: { frequency: 6, damping: 1 },
    },
  });

  useSetpoint(up ? 0.9 : 0, 0.5, hinge?.setTargetAngle);

  return (
    <>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[5, 0.3, 3]} />
        <meshStandardMaterial color="#a0522d" />
      </mesh>
      <mesh ref={crateRef} castShadow>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial color="#2ecc71" />
      </mesh>
      <Tag position={[HINGE[0] + 2.5, -0.6, 2]}>drawbridge</Tag>
      <Controls position={[HINGE[0] + 2.5, -2.2, 2]}>
        <button
          type="button"
          aria-pressed={up}
          onClick={() => setUp(!up)}
        >
          {up ? "lower" : "raise"}
        </button>
      </Controls>
    </>
  );
};

export const MotorisedScene = () => (
  <>
    <Floor size={40} />
    <Crane />
    <Turret />
    <Drawbridge />
  </>
);
