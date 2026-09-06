import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import type { HingeConstraintApi } from "@/Jolt/useHingeConstraint";
import type { SliderConstraintApi } from "@/Jolt/useSliderConstraint";
import type { AngularMotorOptions } from "@/Jolt/internal/constraintSettings";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

const HINGE_POINT: Vec3Tuple = [0, 6, 0];

const PoweredArm = ({
  motor,
  onReady,
  onArmReady,
}: {
  motor: AngularMotorOptions;
  onReady?: (joint: HingeConstraintApi) => void;
  onArmReady?: (arm: BodyApi<Jolt.BoxShape>) => void;
}) => {
  const [, anchor] = useBox({
    size: [0.4, 0.4, 0.4],
    position: HINGE_POINT,
    motionType: "static",
  });
  const [, arm] = useBox({
    size: [2, 0.2, 0.2],
    position: [1.3, 6, 0],
    motionType: "dynamic",
    mass: 5,
  });

  const [joint] = useHingeConstraint(anchor, arm, {
    point: HINGE_POINT,
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    motor,
  });

  if (joint && onReady) onReady(joint);
  if (arm && onArmReady) onArmReady(arm);

  return null;
};

const PoweredCarriage = ({
  onReady,
}: {
  onReady?: (joint: SliderConstraintApi) => void;
}) => {
  const [, rail] = useBox({
    size: [0.4, 0.4, 0.4],
    position: HINGE_POINT,
    motionType: "static",
  });
  const [, carriage] = useBox({
    size: [0.5, 0.5, 0.5],
    position: HINGE_POINT,
    motionType: "dynamic",
    mass: 5,
  });

  const [joint] = useSliderConstraint(rail, carriage, {
    point: HINGE_POINT,
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
    motor: { state: "position", targetPosition: 1.5, maxForceLimit: 10000 },
  });

  if (joint && onReady) onReady(joint);

  return null;
};

describe("constraint motors", () => {
  it("drives a hinge to its target angle against gravity", async () => {
    let joint: HingeConstraintApi | undefined;

    const renderer = await renderPhysics(
      <PoweredArm
        motor={{
          state: "position",
          targetAngle: 0.8,
          maxTorqueLimit: 10000,
          spring: { frequency: 20, damping: 1 },
        }}
        onReady={(value) => (joint = value)}
      />,
    );

    await step(renderer, 180);

    expect(joint!.getCurrentAngle()).toBeCloseTo(0.8, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets the arm hang once the motor is switched off", async () => {
    let joint: HingeConstraintApi | undefined;
    let arm: BodyApi<Jolt.BoxShape> | undefined;

    const renderer = await renderPhysics(
      <PoweredArm
        motor={{
          state: "position",
          targetAngle: 0.8,
          maxTorqueLimit: 10000,
          spring: { frequency: 20, damping: 1 },
        }}
        onReady={(value) => (joint = value)}
        onArmReady={(value) => (arm = value)}
      />,
    );

    await step(renderer, 180);
    const heldAngle = joint!.getCurrentAngle();
    const heldHeight = arm!.body.GetPosition().GetY();

    // Both bodies are asleep by now, which is the point: switching the motor
    // off has to wake them or the arm stays where the motor left it.
    joint!.setMotorState("off");
    await step(renderer, 600);

    expect(heldAngle).toBeCloseTo(0.8, 1);
    expect(heldHeight).toBeGreaterThan(4.5);
    expect(arm!.body.GetPosition().GetY()).toBeLessThan(5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("turns a hinge at the commanded angular velocity", async () => {
    let joint: HingeConstraintApi | undefined;

    const renderer = await renderPhysics(
      <PoweredArm
        motor={{
          state: "velocity",
          targetAngularVelocity: 1.5,
          maxTorqueLimit: 10000,
        }}
        onReady={(value) => (joint = value)}
      />,
    );

    await step(renderer, 30);

    expect(joint!.getCurrentAngle()).toBeGreaterThan(0.5);
    expect(joint!.getCurrentAngle()).toBeLessThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("drives a slider carriage to its target position", async () => {
    let joint: SliderConstraintApi | undefined;

    const renderer = await renderPhysics(
      <PoweredCarriage onReady={(value) => (joint = value)} />,
    );

    await step(renderer, 180);

    expect(joint!.getCurrentPosition()).toBeCloseTo(1.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});
