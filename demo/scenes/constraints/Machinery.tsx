import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from "three";
import { Controls, Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useGearConstraint } from "@/Jolt/useGearConstraint";
import { useRackAndPinionConstraint } from "@/Jolt/useRackAndPinionConstraint";
import { usePulleyConstraint } from "@/Jolt/usePulleyConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";

const AXLE = {
  hingeAxis: [0, 0, 1] as Vec3Tuple,
  normalAxis: [1, 0, 0] as Vec3Tuple,
};
const HUB: Vec3Tuple = [0.3, 0.3, 0.3];
const GEAR_Y = 2.3;

/**
 * A wheel you can see turn. The body is only a small hub, so neighbouring wheels
 * never collide: it is the joint that drives one from the other, not contact.
 */
const useWheel = (position: Vec3Tuple) =>
  useBox({
    size: HUB,
    position,
    motionType: "dynamic",
    mass: 5,
    allowSleeping: false,
  });

const WheelMesh = ({
  meshRef,
  radius,
  color,
  stripe = 1,
}: {
  meshRef: ReturnType<typeof useWheel>[0];
  radius: number;
  color: string;
  /** Which side the stripe starts on, along X. Meshed stripes meet head on. */
  stripe?: 1 | -1;
}) => (
  <mesh ref={meshRef}>
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[radius, radius, 0.3, 32]} />
      <meshStandardMaterial color={color} />
    </mesh>
    <mesh position={[stripe * radius * 0.6, 0, 0.17]}>
      <boxGeometry args={[radius * 0.8, 0.14, 0.04]} />
      <meshStandardMaterial color="#eee" />
    </mesh>
  </mesh>
);

/**
 * Ten teeth driving twenty, driving ten: half the speed, then back up. The
 * stripes start where the wheels would mesh, and meet there every time round.
 */
const GearTrain = () => {
  const [driveRef, drive] = useWheel([-10, GEAR_Y, 0]);
  const [largeRef, large] = useWheel([-7, GEAR_Y, 0]);
  const [lastRef, last] = useWheel([-4, GEAR_Y, 0]);

  const [driveHinge] = useHingeConstraint(null, drive, {
    ...AXLE,
    point: [-10, GEAR_Y, 0],
    motor: { state: "velocity", targetAngularVelocity: 2 },
  });
  const [largeHinge] = useHingeConstraint(null, large, {
    ...AXLE,
    point: [-7, GEAR_Y, 0],
  });
  const [lastHinge] = useHingeConstraint(null, last, {
    ...AXLE,
    point: [-4, GEAR_Y, 0],
  });

  useGearConstraint(drive, large, {
    hingeAxis: [0, 0, 1],
    teeth: [10, 20],
    hinges: [driveHinge, largeHinge],
  });
  useGearConstraint(large, last, {
    hingeAxis: [0, 0, 1],
    teeth: [20, 10],
    hinges: [largeHinge, lastHinge],
  });

  return (
    <>
      <WheelMesh meshRef={driveRef} radius={1} color="#e74c3c" />
      <WheelMesh meshRef={largeRef} radius={2} color="#3498db" />
      <WheelMesh meshRef={lastRef} radius={1} color="#2ecc71" stripe={-1} />
      <Tag position={[-7, -0.6, 2]}>gears</Tag>
    </>
  );
};

const PINION: Vec3Tuple = [2, 3.2, 0];
const RACK_Y = PINION[1] - 1.15;

const RackAndPinion = () => {
  const [pinionRef, pinion] = useWheel(PINION);
  const [rackRef, rack] = useBox({
    size: [5, 0.3, 0.3],
    position: [PINION[0], RACK_Y, 0],
    motionType: "dynamic",
    mass: 8,
    allowSleeping: false,
  });

  const [hinge] = useHingeConstraint(null, pinion, {
    ...AXLE,
    point: PINION,
    motor: { state: "velocity", targetAngularVelocity: -1.5 },
  });
  const [slider] = useSliderConstraint(null, rack, {
    point: [PINION[0], RACK_Y, 0],
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
    limits: { min: -1.5, max: 1.5 },
  });

  // Radius 1 turns 1 radian per metre of rack, as if the teeth really met.
  useRackAndPinionConstraint(pinion, rack, {
    hingeAxis: [0, 0, 1],
    sliderAxis: [1, 0, 0],
    ratio: 1,
    hinge,
    slider,
  });

  const direction = useRef(-1);

  useFrame(function reverseAtTheEnds() {
    if (!hinge || !slider) return;

    const travel = slider.getCurrentPosition();
    if (Math.abs(travel) < 1.3 || Math.sign(travel) !== direction.current) return;

    direction.current = -direction.current;
    hinge.setTargetAngularVelocity(direction.current * 1.5);
  });

  return (
    <>
      <WheelMesh meshRef={pinionRef} radius={1} color="#e67e22" />
      <mesh ref={rackRef} castShadow>
        <boxGeometry args={[5, 0.3, 0.3]} />
        <meshStandardMaterial color="#95a5a6" />
      </mesh>
      <Tag position={[PINION[0], -0.6, 2]}>rack and pinion</Tag>
    </>
  );
};

const LEFT_WHEEL: Vec3Tuple = [8, 6.5, 0];
const RIGHT_WHEEL: Vec3Tuple = [11, 6.5, 0];
const HEAVY = 1.3;
const LIGHT = 0.9;
const HEAVY_START: Vec3Tuple = [8, 4, 0];
const LIGHT_START: Vec3Tuple = [11, 1, 0];

/** One rope: down to each body's top, and across over both wheels. */
const Rope = ({
  heavy,
  light,
}: {
  heavy: BodyApi<Jolt.Shape> | undefined;
  light: BodyApi<Jolt.Shape> | undefined;
}) => {
  const [line] = useState(() => {
    const rope = new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(),
        new Vector3(),
        new Vector3(),
        new Vector3(),
      ]),
      new LineBasicMaterial({ color: "#ddd" }),
    );
    rope.frustumCulled = false;
    return rope;
  });
  const [ends] = useState(() => [
    new Vector3(...HEAVY_START),
    new Vector3(...LEFT_WHEEL),
    new Vector3(...RIGHT_WHEEL),
    new Vector3(...LIGHT_START),
  ]);

  useFrame(function followBodies() {
    if (!heavy || !light) return;

    // One at a time: every body's getter hands back the same shared vector.
    const heavyAt = heavy.body.GetPosition();
    ends[0].set(heavyAt.GetX(), heavyAt.GetY() + HEAVY / 2, heavyAt.GetZ());
    const lightAt = light.body.GetPosition();
    ends[3].set(lightAt.GetX(), lightAt.GetY() + LIGHT / 2, lightAt.GetZ());
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
 * The heavy block drops and the light one rises by as much. Nothing stops a body
 * at a wheel, and the light one coasts on when the heavy one lands, so the two
 * are close in weight and the drop leaves it room.
 */
const Pulley = () => {
  const [heavyRef, heavy] = useBox({
    size: [HEAVY, HEAVY, HEAVY],
    position: HEAVY_START,
    motionType: "dynamic",
    mass: 30,
    allowSleeping: false,
    lockRotations: true,
  });
  const [lightRef, light] = useBox({
    size: [LIGHT, LIGHT, LIGHT],
    position: LIGHT_START,
    motionType: "dynamic",
    mass: 20,
    allowSleeping: false,
    lockRotations: true,
  });

  usePulleyConstraint(heavy, light, {
    bodyPoint1: [HEAVY_START[0], HEAVY_START[1] + HEAVY / 2, 0],
    bodyPoint2: [LIGHT_START[0], LIGHT_START[1] + LIGHT / 2, 0],
    fixedPoint1: LEFT_WHEEL,
    fixedPoint2: RIGHT_WHEEL,
  });

  return (
    <>
      {[LEFT_WHEEL, RIGHT_WHEEL].map((wheel) => (
        <mesh key={wheel[0]} position={wheel} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.15, 20]} />
          <meshStandardMaterial color="#777" />
        </mesh>
      ))}
      <mesh position={[9.5, 6.9, 0]}>
        <boxGeometry args={[3.8, 0.12, 0.12]} />
        <meshStandardMaterial color="#555" />
      </mesh>
      <mesh ref={heavyRef} castShadow>
        <boxGeometry args={[HEAVY, HEAVY, HEAVY]} />
        <meshStandardMaterial color="#8e44ad" />
      </mesh>
      <mesh ref={lightRef} castShadow>
        <boxGeometry args={[LIGHT, LIGHT, LIGHT]} />
        <meshStandardMaterial color="#16a085" />
      </mesh>
      <Rope heavy={heavy} light={light} />
      <Tag position={[9.5, -0.6, 2]}>pulley: 30 kg and 20 kg</Tag>
      <Controls position={[9.5, -2.2, 2]}>
        <button
          type="button"
          onClick={() => {
            // Only from low down, so it cannot be thrown up through the wheel.
            if (heavy && heavy.body.GetPosition().GetY() < 2) {
              heavy.applyImpulse([0, 150, 0]);
            }
          }}
        >
          heave
        </button>
      </Controls>
    </>
  );
};

export const MachineryScene = () => (
  <>
    <Floor size={40} />
    <GearTrain />
    <RackAndPinion />
    <Pulley />
  </>
);
