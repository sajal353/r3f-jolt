import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useCar } from "@/Jolt/useCar";
import { useCharacter } from "@/Jolt/useCharacter";
import { useBox } from "@/Jolt/useBox";
import { useConveyor } from "@/Jolt/useConveyor";
import { useFixedConstraint } from "@/Jolt/useFixedConstraint";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import { useConeConstraint } from "@/Jolt/useConeConstraint";
import { useSwingTwistConstraint } from "@/Jolt/useSwingTwistConstraint";
import { useSixDOFConstraint } from "@/Jolt/useSixDOFConstraint";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const Ground = () => {
  useBox({ size: [50, 1, 50], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const direction = new Vector3(1, 0, 0);

const Character = () => {
  const [api] = useCharacter({
    position: [0, 3, 0],
    options: { height: { standing: 1.8, crouching: 0.9 } },
  });

  useFrame((_, delta) => {
    api?.update(direction, false, false, delta);
  });

  return null;
};

const CrouchingCharacter = () => {
  const [api] = useCharacter({ position: [0, 3, 0] });
  const frame = useRef(0);

  useFrame((_, delta) => {
    frame.current += 1;
    const n = frame.current;
    api?.update(direction, n % 30 === 0, n % 20 < 10, delta);
  });

  return null;
};

const Car = () => {
  const [api] = useCar({
    position: [0, 2, 0],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.3,
      width: 0.2,
      offsetForward: 1.2,
      offsetDown: 0.3,
    },
  });

  useFrame(() => {
    api?.update({
      forward: true,
      backward: false,
      left: false,
      right: true,
      handbrake: false,
      modifier: true,
    });
  });

  return null;
};

const Conveyor = () => {
  const [, api] = useBox({
    size: [10, 1, 10],
    position: [0, 0.5, 0],
    motionType: "static",
    material: { friction: 1 },
  });

  const conveyor = useConveyor(api, { linear: [3, 0, 0] });
  const frame = useRef(0);

  useFrame(() => {
    frame.current += 1;
    conveyor?.setLinear([frame.current % 2 === 0 ? 3 : -3, 0, 0]);
  });

  useBox({
    size: [1, 1, 1],
    position: [0, 2, 0],
    motionType: "dynamic",
    mass: 5,
    material: { friction: 1 },
  });

  return null;
};

const useJointedPair = () => {
  const [, anchor] = useBox({
    size: [0.4, 0.4, 0.4],
    position: [0, 6, 0],
    motionType: "static",
  });
  const [, hanging] = useBox({
    size: [1, 1, 1],
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: 5,
  });

  return { anchor, hanging };
};

/**
 * `AddConstraint` takes the only reference, so a missing `Release` — or a
 * `destroy` where a `Release` belongs — shows up here and nowhere else: there is
 * no `GetNumConstraints` to count against.
 */
const Joints = () => {
  const { anchor, hanging } = useJointedPair();
  const point: Vec3Tuple = [0, 5, 0];

  useFixedConstraint(anchor, hanging);
  usePointConstraint(anchor, hanging, { point });
  useHingeConstraint(anchor, hanging, {
    point,
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    limits: { min: -0.5, max: 0.5 },
    limitsSpring: { frequency: 5, damping: 0.5 },
    motor: { state: "velocity", targetAngularVelocity: 1, maxTorqueLimit: 500 },
  });
  useSliderConstraint(anchor, hanging, {
    point,
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
    limits: { min: -1, max: 1 },
    motor: { state: "position", targetPosition: 0.5 },
  });
  useDistanceConstraint(anchor, hanging, { point, maxDistance: 3 });
  useConeConstraint(anchor, hanging, {
    point,
    twistAxis: [0, 1, 0],
    halfConeAngle: 0.4,
  });
  useSwingTwistConstraint(anchor, hanging, {
    position: point,
    twistAxis: [0, 1, 0],
    planeAxis: [1, 0, 0],
    normalHalfConeAngle: 0.3,
    swingMotor: { state: "velocity", maxTorqueLimit: 100 },
    targetAngularVelocity: [0, 1, 0],
  });
  useSixDOFConstraint(anchor, hanging, {
    position: point,
    axes: {
      translationX: { limits: { min: -1, max: 1 }, maxFriction: 2 },
      translationY: { limits: "fixed" },
      rotationZ: {
        limits: "free",
        motor: { state: "velocity", maxTorqueLimit: 50 },
      },
    },
    targetAngularVelocity: [0, 0, 1],
  });

  return null;
};

const DebuggedJoint = () => {
  const { anchor, hanging } = useJointedPair();

  useHingeConstraint(anchor, hanging, {
    point: [0, 5, 0],
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    debug: true,
  });

  return null;
};

const cycles = async (element: React.ReactElement, frames: number) => {
  const module = await loadDebugModule();

  const run = async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        {element}
      </>,
    );
    await step(renderer, frames);
    await unmount(renderer);
  };

  await run();
  const baseline = module.JoltInterface.prototype.sGetFreeMemory();

  for (let i = 0; i < 4; i += 1) await run();

  return {
    baseline,
    after: module.JoltInterface.prototype.sGetFreeMemory(),
  };
};

describe("mount/unmount leak checks", () => {
  it("useCharacter leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Character />, 30);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useCharacter crouch toggling does not leak", async () => {
    const { baseline, after } = await cycles(<CrouchingCharacter />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useCar leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Car />, 30);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useConveyor leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Conveyor />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("all eight constraint hooks leave the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Joints />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("a debug-drawn constraint leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<DebuggedJoint />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("a driven character actually moves", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Character />
      </>,
    );

    await step(renderer, 90);
    await unmount(renderer);
    expectNoAsserts();
  });
});
