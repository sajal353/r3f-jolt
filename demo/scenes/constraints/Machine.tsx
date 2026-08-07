import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCapsule } from "@/Jolt/useCapsule";
import { useFixedConstraint } from "@/Jolt/useFixedConstraint";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import { useConeConstraint } from "@/Jolt/useConeConstraint";
import { useSwingTwistConstraint } from "@/Jolt/useSwingTwistConstraint";
import { useSixDOFConstraint } from "@/Jolt/useSixDOFConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";

const STIFF = { frequency: 20, damping: 1 };
const HOPPER = -9;
const LIFT_X = -4.5;
const TABLE_X = 0;
const RAMP_X = 4.5;
const BALL_RADIUS = 0.35;

type Box = BodyApi<Jolt.BoxShape>;

/**
 * The hopper drops a ball onto the lift; the lift raises it onto the turntable;
 * the turntable sweeps it into the swinging gate; the gate knocks it down the
 * ramp into the skittles. Eight constraint hooks, one loop.
 */
const Feeder = ({ generation }: { generation: number }) => {
  const [ref, ball] = useSphere({
    radius: BALL_RADIUS,
    position: [HOPPER, 8, 0],
    motionType: "dynamic",
    mass: 4,
    material: { restitution: 0.1 },
  });

  useEffect(() => {
    ball?.setPositionAndRotation([HOPPER, 8, 0], [0, 0, 0, 1], true);
    ball?.setVelocities([2.5, 0, 0], [0, 0, 0]);
  }, [ball, generation]);

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
      <meshStandardMaterial color="#f1c40f" />
    </mesh>
  );
};

const Chute = () => {
  const home: Vec3Tuple = [HOPPER + 1.6, 6.4, 0];
  const [ref, chute] = useBox({
    size: [3.4, 0.2, 1.6],
    position: home,
    motionType: "dynamic",
    mass: 20,
  });

  // Locked completely: a six-DOF joint with every axis fixed is a rigid mount
  // you can later unlock one axis at a time.
  useSixDOFConstraint(null, chute, {
    position: home,
    axes: {
      translationX: { limits: "fixed" },
      translationY: { limits: "fixed" },
      translationZ: { limits: "fixed" },
      rotationX: { limits: { min: -0.25, max: -0.25 } },
      rotationY: { limits: "fixed" },
      rotationZ: { limits: { min: -0.18, max: -0.18 } },
    },
    debug: true,
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[3.4, 0.2, 1.6]} />
      <meshStandardMaterial color="#7f8c8d" />
    </mesh>
  );
};

const Lift = ({ raised }: { raised: boolean }) => {
  const home: Vec3Tuple = [LIFT_X, 1.2, 0];
  const [ref, platform] = useBox({
    size: [2.2, 0.3, 2.2],
    position: home,
    motionType: "dynamic",
    mass: 40,
  });

  const [joint] = useSliderConstraint(null, platform, {
    point: home,
    sliderAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: 0, max: 2.6 },
    motor: {
      state: "position",
      targetPosition: 0,
      maxForceLimit: 30000,
      spring: STIFF,
    },
    debug: true,
  });

  useEffect(() => {
    joint?.setTargetPosition(raised ? 2.6 : 0);
  }, [joint, raised]);

  // Rails welded to the platform so they ride with it, which is the fixed joint
  // doing the one thing it is for.
  return (
    <>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.3, 2.2]} />
        <meshStandardMaterial color="#3498db" />
      </mesh>
      <LiftRail platform={platform} offset={-1.05} />
      <LiftRail platform={platform} offset={1.05} />
    </>
  );
};

const LiftRail = ({
  platform,
  offset,
}: {
  platform: Box | undefined;
  offset: number;
}) => {
  const [ref, rail] = useBox({
    size: [0.12, 0.7, 2.2],
    position: [LIFT_X + offset, 1.65, 0],
    motionType: "dynamic",
    mass: 3,
  });

  useFixedConstraint(platform, rail);

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.12, 0.7, 2.2]} />
      <meshStandardMaterial color="#2980b9" />
    </mesh>
  );
};

const Turntable = ({ spinning }: { spinning: boolean }) => {
  const centre: Vec3Tuple = [TABLE_X, 3.9, 0];
  const [ref, table] = useBox({
    size: [4.2, 0.3, 4.2],
    position: centre,
    motionType: "dynamic",
    mass: 35,
    material: { friction: 1 },
  });

  const [joint] = useHingeConstraint(null, table, {
    point: centre,
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    motor: {
      state: "velocity",
      targetAngularVelocity: 1.2,
      maxTorqueLimit: 6000,
    },
    debug: true,
  });

  useEffect(() => {
    joint?.setTargetAngularVelocity(spinning ? 1.2 : 0);
  }, [joint, spinning]);

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[4.2, 0.3, 4.2]} />
      <meshStandardMaterial color="#8e44ad" />
    </mesh>
  );
};

const Gate = () => {
  const pivot: Vec3Tuple = [TABLE_X + 2.6, 6.6, 0];
  const [ref, gate] = useBox({
    size: [0.3, 2.4, 1.6],
    position: [TABLE_X + 2.6, 5.4, 0],
    motionType: "dynamic",
    mass: 14,
  });

  usePointConstraint(null, gate, { point: pivot, debug: true });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.3, 2.4, 1.6]} />
      <meshStandardMaterial color="#16a085" />
    </mesh>
  );
};

const Ramp = () => {
  const home: Vec3Tuple = [RAMP_X, 2.6, 0];
  const [ref, ramp] = useBox({
    size: [5, 0.25, 2.4],
    position: home,
    motionType: "dynamic",
    mass: 30,
  });

  useSixDOFConstraint(null, ramp, {
    position: home,
    axes: {
      translationX: { limits: "fixed" },
      translationY: { limits: "fixed" },
      translationZ: { limits: "fixed" },
      rotationX: { limits: "fixed" },
      rotationY: { limits: "fixed" },
      rotationZ: { limits: { min: -0.35, max: -0.35 } },
    },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[5, 0.25, 2.4]} />
      <meshStandardMaterial color="#7f8c8d" />
    </mesh>
  );
};

const Skittle = ({ x, z }: { x: number; z: number }) => {
  const base: Vec3Tuple = [x, 0, z];
  const [ref, skittle] = useCapsule({
    height: 1.2,
    radius: 0.16,
    position: [x, 0.76, z],
    motionType: "dynamic",
    mass: 2,
  });

  useSwingTwistConstraint(null, skittle, {
    position: base,
    twistAxis: [0, 1, 0],
    planeAxis: [1, 0, 0],
    normalHalfConeAngle: 1.4,
    planeHalfConeAngle: 1.4,
    twistMinAngle: -0.2,
    twistMaxAngle: 0.2,
  });

  return (
    <mesh ref={ref} castShadow>
      <capsuleGeometry args={[0.16, 1.2, 6, 12]} />
      <meshStandardMaterial color="#ecf0f1" />
    </mesh>
  );
};

const Pendulum = () => {
  const pivot: Vec3Tuple = [RAMP_X + 3.2, 7.5, 0];
  const [ref, bob] = useSphere({
    radius: 0.55,
    position: [RAMP_X + 3.2, 4.5, -1.6],
    motionType: "dynamic",
    mass: 30,
  });

  useDistanceConstraint(null, bob, {
    point1: pivot,
    point2: [RAMP_X + 3.2, 4.5, -1.6],
    minDistance: 3.4,
    maxDistance: 3.4,
    debug: true,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.55, 20, 20]} />
      <meshStandardMaterial color="#c0392b" metalness={0.4} />
    </mesh>
  );
};

const Flag = () => {
  const base: Vec3Tuple = [TABLE_X, 4.2, 0];
  const [ref, pole] = useCapsule({
    height: 1.6,
    radius: 0.1,
    position: [TABLE_X, 5.1, 0],
    motionType: "dynamic",
    mass: 1.5,
  });

  useConeConstraint(null, pole, {
    point: base,
    twistAxis: [0, 1, 0],
    halfConeAngle: 0.35,
  });

  return (
    <mesh ref={ref} castShadow>
      <capsuleGeometry args={[0.1, 1.6, 6, 12]} />
      <meshStandardMaterial color="#e67e22" />
    </mesh>
  );
};

const CYCLE_SECONDS = 4;

export const MachineScene = () => {
  const [generation, setGeneration] = useState(0);
  const [raised, setRaised] = useState(false);
  const [spinning, setSpinning] = useState(true);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < CYCLE_SECONDS) return;

    elapsed.current = 0;
    setRaised((value) => !value);
    setGeneration((count) => count + 1);
  });

  return (
    <>
      <Floor size={44} />

      <Chute />
      <Feeder generation={generation} />
      <Lift raised={raised} />
      <Turntable spinning={spinning} />
      <Flag />
      <Gate />
      <Ramp />
      <Pendulum />

      {[-0.7, 0, 0.7].map((z, index) => (
        <Skittle key={z} x={RAMP_X + 4.2 + index * 0.1} z={z} />
      ))}

      <Controls position={[0, 11, 0]}>
        <button
          aria-pressed={spinning}
          onClick={() => setSpinning((value) => !value)}
        >
          {spinning ? "stop table" : "spin table"}
        </button>
        <button onClick={() => setGeneration((count) => count + 1)}>
          drop a ball
        </button>
      </Controls>

      <Tag position={[HOPPER + 1.6, 7.6, 0]}>six-DOF · fixed chute</Tag>
      <Tag position={[LIFT_X, 0.4, 0]}>slider motor + fixed rails</Tag>
      <Tag position={[TABLE_X, 2.6, 0]}>hinge motor</Tag>
      <Tag position={[TABLE_X, 6.4, 0]}>cone flag</Tag>
      <Tag position={[TABLE_X + 2.6, 7.4, 0]}>point gate</Tag>
      <Tag position={[RAMP_X + 3.2, 8.2, 0]}>distance pendulum</Tag>
      <Tag position={[RAMP_X + 4.2, 2.2, 0]}>swing-twist skittles</Tag>

      <Hud position={[0, 12.4, 0]}>
        all eight constraint hooks in one machine · lift cycles every 4s
      </Hud>
    </>
  );
};
