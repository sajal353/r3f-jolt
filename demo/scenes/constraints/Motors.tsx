import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const DOOR_SIZE: Vec3Tuple = [2.4, 3, 0.2];
const STIFF = { frequency: 20, damping: 1 };

/** Radians per second for the door, metres per second for the lift. */
const DOOR_SPEED = 2.4;
const LIFT_SPEED = 5;

/**
 * A position motor takes a setpoint, not a speed. Hand it a distant target and
 * it closes the gap as fast as its force limit allows, so the same door slams
 * open and drifts shut the moment anything — a limit, gravity — helps one
 * direction and not the other, and a target set right on a limit overshoots
 * hard enough to punch through it before the limit catches up.
 *
 * Walking the setpoint at a fixed rate instead makes every direction take the
 * same time by construction, and is how a real powered door or lift is driven:
 * the motor is always chasing a target a few millimetres away.
 */
const useSetpoint = (
  target: number,
  rate: number,
  drive: ((value: number) => void) | undefined,
) => {
  const setpoint = useRef(target);

  useFrame((_, delta) => {
    const gap = target - setpoint.current;
    if (gap === 0) return;

    // A tab left in the background hands back one enormous delta; without the
    // clamp the setpoint jumps the whole way and the slam is back.
    const travel = rate * Math.min(delta, 1 / 30);

    setpoint.current =
      Math.abs(gap) <= travel
        ? target
        : setpoint.current + Math.sign(gap) * travel;

    drive?.(setpoint.current);
  });
};

const PoweredDoor = ({ open }: { open: boolean }) => {
  const hinge: Vec3Tuple = [-6, 2, 0];
  const [ref, door] = useBox({
    size: DOOR_SIZE,
    position: [-6 + DOOR_SIZE[0] / 2 + 0.3, 2, 0],
    motionType: "dynamic",
    mass: 25,
  });

  const [joint] = useHingeConstraint(null, door, {
    point: hinge,
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: -Math.PI / 2, max: 0 },
    motor: {
      state: "position",
      targetAngle: 0,
      maxTorqueLimit: 4000,
      spring: STIFF,
    },
  });

  useSetpoint(open ? -Math.PI / 2 : 0, DOOR_SPEED, joint?.setTargetAngle);

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={DOOR_SIZE} />
      <meshStandardMaterial color={open ? "#2ecc71" : "#c0392b"} />
    </mesh>
  );
};

/**
 * A position motor holds the platform wherever it is told, carrying whatever is
 * riding on it — the motor supplies the force gravity would otherwise win.
 */
const PoweredLift = ({ raised }: { raised: boolean }) => {
  const home: Vec3Tuple = [0, 1, 0];
  const [ref, platform] = useBox({
    size: [3, 0.3, 3],
    position: home,
    motionType: "dynamic",
    mass: 40,
  });

  const [joint] = useSliderConstraint(null, platform, {
    point: home,
    sliderAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: 0, max: 5 },
    motor: {
      state: "position",
      targetPosition: 0,
      maxForceLimit: 20000,
      spring: STIFF,
    },
  });

  useSetpoint(raised ? 5 : 0, LIFT_SPEED, joint?.setTargetPosition);

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[3, 0.3, 3]} />
      <meshStandardMaterial color="#3498db" />
    </mesh>
  );
};

const Passenger = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.4,
    position: [x, 3, 0],
    motionType: "dynamic",
    mass: 5,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 20, 20]} />
      <meshStandardMaterial color="#f1c40f" />
    </mesh>
  );
};

const Turntable = ({ speed }: { speed: number }) => {
  const centre: Vec3Tuple = [6, 1, 0];
  const [ref, table] = useBox({
    size: [3.5, 0.4, 3.5],
    position: centre,
    motionType: "dynamic",
    mass: 30,
  });

  const [joint] = useHingeConstraint(null, table, {
    point: centre,
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    motor: {
      state: "velocity",
      targetAngularVelocity: speed,
      maxTorqueLimit: 3000,
    },
  });

  // No ramp here: a velocity motor is commanded in the units it runs in, so
  // it is already symmetric — which is half of why the two kinds exist.
  useEffect(() => {
    joint?.setTargetAngularVelocity(speed);
  }, [joint, speed]);

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[3.5, 0.4, 3.5]} />
      <meshStandardMaterial color="#8e44ad" />
    </mesh>
  );
};

export const MotorsScene = () => {
  const [open, setOpen] = useState(false);
  const [raised, setRaised] = useState(false);
  const [speed, setSpeed] = useState(2);

  return (
    <>
      <Floor size={40} />

      <PoweredDoor open={open} />
      <PoweredLift raised={raised} />
      <Passenger x={0} />
      <Turntable speed={speed} />
      <Passenger x={6.8} />

      <Controls position={[0, 8, 0]}>
        <button aria-pressed={open} onClick={() => setOpen((value) => !value)}>
          {open ? "close door" : "open door"}
        </button>
        <button
          aria-pressed={raised}
          onClick={() => setRaised((value) => !value)}
        >
          {raised ? "lower lift" : "raise lift"}
        </button>
        <button
          aria-pressed={speed !== 0}
          onClick={() => setSpeed((value) => (value === 0 ? 2 : 0))}
        >
          {speed === 0 ? "spin table" : "stop table"}
        </button>
        <button onClick={() => setSpeed((value) => -value)}>reverse</button>
      </Controls>

      <Tag position={[-6, 5, 0]}>hinge · position motor</Tag>
      <Tag position={[0, 7, 0]}>slider · position motor</Tag>
      <Tag position={[6, 4, 0]}>hinge · velocity motor</Tag>

      <Hud position={[0, 10, 0]}>
        position motors walk to their target · same speed both ways
      </Hud>
    </>
  );
};
