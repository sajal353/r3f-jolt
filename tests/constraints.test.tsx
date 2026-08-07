import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useFixedConstraint } from "@/Jolt/useFixedConstraint";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import type { HingeConstraintApi } from "@/Jolt/useHingeConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { LimitOptions } from "@/Jolt/internal/constraintSettings";
import type { Vec3Tuple } from "@/Jolt/types";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

type Box = BodyApi<Jolt.BoxShape>;

const ANCHOR: Vec3Tuple = [0, 6, 0];

const positionOf = (api: Box) => {
  const position = api.body.GetPosition();
  return {
    x: position.GetX(),
    y: position.GetY(),
    z: position.GetZ(),
  };
};

const distanceBetween = (first: Box, second: Box) => {
  const a = positionOf(first);
  const b = positionOf(second);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
};

const useAnchor = (position: Vec3Tuple = ANCHOR) =>
  useBox({ size: [1, 1, 1], position, motionType: "static" });

const useHanging = (position: Vec3Tuple) =>
  useBox({ size: [1, 1, 1], position, motionType: "dynamic", mass: 5 });

interface JointProbe {
  onReady?: (bodies: { anchor: Box; hanging: Box }) => void;
}

const report = (
  onReady: JointProbe["onReady"],
  anchor: Box | undefined,
  hanging: Box | undefined,
) => {
  if (anchor && hanging && onReady) onReady({ anchor, hanging });
};

const PointJoint = ({ onReady }: JointProbe) => {
  const [, anchor] = useAnchor();
  const [, hanging] = useHanging([0, 4, 0]);

  usePointConstraint(anchor, hanging, { point: [0, 5, 0] });
  report(onReady, anchor, hanging);

  return null;
};

const WorldJoint = ({ onReady }: { onReady?: (body: Box) => void }) => {
  const [, hanging] = useHanging([0, 4, 0]);

  usePointConstraint(null, hanging, { point: [0, 5, 0] });
  if (hanging && onReady) onReady(hanging);

  return null;
};

const FixedJoint = ({ onReady }: JointProbe) => {
  const [, anchor] = useAnchor();
  const [, hanging] = useHanging([0, 4, 0]);

  useFixedConstraint(anchor, hanging);
  report(onReady, anchor, hanging);

  return null;
};

const HingeArm = ({
  limits,
  onReady,
}: {
  limits?: LimitOptions;
  onReady?: (joint: HingeConstraintApi) => void;
}) => {
  // The arm has to clear the anchor: two overlapping colliders push each other
  // apart hard enough to hold the joint at its rest angle.
  const [, anchor] = useBox({
    size: [0.4, 0.4, 0.4],
    position: ANCHOR,
    motionType: "static",
  });
  const [, arm] = useBox({
    size: [2, 0.2, 0.2],
    position: [1.3, 6, 0],
    motionType: "dynamic",
    mass: 5,
  });

  const [joint] = useHingeConstraint(anchor, arm, {
    point: ANCHOR,
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    limits,
  });

  if (joint && onReady) onReady(joint);

  return null;
};

const SliderCarriage = ({ onReady }: JointProbe) => {
  const [, anchor] = useAnchor();
  const [, carriage] = useHanging([0, 6, 0]);

  useSliderConstraint(anchor, carriage, {
    point: ANCHOR,
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
  });
  report(onReady, anchor, carriage);

  return null;
};

const RopeJoint = ({ onReady }: JointProbe) => {
  const [, anchor] = useAnchor();
  const [, load] = useHanging([0, 5, 0]);

  useDistanceConstraint(anchor, load, {
    point1: ANCHOR,
    point2: [0, 5, 0],
    minDistance: 0,
    maxDistance: 2,
  });
  report(onReady, anchor, load);

  return null;
};

describe("constraints", () => {
  it("a point constraint holds the bodies at their original separation", async () => {
    let bodies: { anchor: Box; hanging: Box } | undefined;

    const renderer = await renderPhysics(
      <PointJoint onReady={(value) => (bodies = value)} />,
    );

    const before = distanceBetween(bodies!.anchor, bodies!.hanging);
    await step(renderer, 120);
    const after = distanceBetween(bodies!.anchor, bodies!.hanging);

    expect(after).toBeCloseTo(before, 1);
    expect(positionOf(bodies!.hanging).y).toBeGreaterThan(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("hangs a body from the world when one side is null", async () => {
    let body: Box | undefined;

    const renderer = await renderPhysics(
      <WorldJoint onReady={(value) => (body = value)} />,
    );

    await step(renderer, 120);

    expect(positionOf(body!).y).toBeGreaterThan(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a fixed constraint welds a body in place", async () => {
    let bodies: { anchor: Box; hanging: Box } | undefined;

    const renderer = await renderPhysics(
      <FixedJoint onReady={(value) => (bodies = value)} />,
    );

    const before = positionOf(bodies!.hanging);
    await step(renderer, 120);
    const after = positionOf(bodies!.hanging);

    expect(after.y).toBeCloseTo(before.y, 1);
    expect(after.x).toBeCloseTo(before.x, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a hinge stays inside its limits, and swings past them without", async () => {
    let limited: HingeConstraintApi | undefined;

    const limitedRenderer = await renderPhysics(
      <HingeArm
        limits={{ min: -0.1, max: 0.1 }}
        onReady={(value) => (limited = value)}
      />,
    );

    await step(limitedRenderer, 120);
    const limitedAngle = limited!.getCurrentAngle();

    await unmount(limitedRenderer);
    expectNoAsserts();

    let free: HingeConstraintApi | undefined;

    const freeRenderer = await renderPhysics(
      <HingeArm onReady={(value) => (free = value)} />,
    );

    await step(freeRenderer, 120);
    const freeAngle = free!.getCurrentAngle();

    expect(Math.abs(limitedAngle)).toBeLessThan(0.15);
    expect(Math.abs(freeAngle)).toBeGreaterThan(0.5);

    await unmount(freeRenderer);
    expectNoAsserts();
  });

  it("a slider does not let gravity move the carriage off its axis", async () => {
    let bodies: { anchor: Box; hanging: Box } | undefined;

    const renderer = await renderPhysics(
      <SliderCarriage onReady={(value) => (bodies = value)} />,
    );

    await step(renderer, 120);
    const carriage = positionOf(bodies!.hanging);

    expect(carriage.y).toBeCloseTo(6, 1);
    expect(Math.abs(carriage.z)).toBeLessThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a distance constraint stops the load past its maximum", async () => {
    let bodies: { anchor: Box; hanging: Box } | undefined;

    const renderer = await renderPhysics(
      <RopeJoint onReady={(value) => (bodies = value)} />,
    );

    await step(renderer, 180);

    expect(distanceBetween(bodies!.anchor, bodies!.hanging)).toBeLessThan(2.2);

    await unmount(renderer);
    expectNoAsserts();
  });
});
