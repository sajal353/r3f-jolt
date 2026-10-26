import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useFixedConstraint } from "@/Jolt/useFixedConstraint";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { ConstraintApi } from "@/Jolt/internal/useConstraint";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

const GRAVITY = 9.81;
const MASS = 10;
const WEIGHT = MASS * GRAVITY;

const held: {
  load: BodyApi<Jolt.BoxShape> | undefined;
  joint: ConstraintApi<Jolt.Constraint> | undefined;
  breaks: number;
  brokeAt: number;
} = { load: undefined, joint: undefined, breaks: 0, brokeAt: 0 };

const countBreak = ({ force, torque }: { force: number; torque: number }) => {
  held.breaks += 1;
  held.brokeAt = Math.max(force, torque);
};

/** 10 kg hanging from the world: the joint carries its weight, 98.1 N. */
const Hanging = ({ breakForce }: { breakForce: number }) => {
  const [, load] = useBox({
    size: [1, 1, 1],
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: MASS,
    linearDamping: 0,
  });

  const [joint] = usePointConstraint(null, load, {
    point: [0, 5, 0],
    breakForce,
    onBreak: countBreak,
  });

  useEffect(() => {
    held.load = load;
    held.joint = joint;
  }, [load, joint]);

  return null;
};

/**
 * A 2 m beam held level by one end on an upright hinge. Its weight acts 1 m
 * out, across the hinge axis, so what holds the axis carries 98.1 N·m.
 */
const Cantilever = ({ breakTorque }: { breakTorque: number }) => {
  const [, beam] = useBox({
    size: [2, 0.2, 0.2],
    position: [1, 5, 0],
    motionType: "dynamic",
    mass: MASS,
  });

  const [joint] = useHingeConstraint(null, beam, {
    point: [0, 5, 0],
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    breakTorque,
    onBreak: countBreak,
  });

  useEffect(() => {
    held.load = beam;
    held.joint = joint;
  }, [beam, joint]);

  return null;
};

const Welded = () => {
  const [, anchor] = useBox({
    size: [1, 1, 1],
    position: [0, 5, 0],
    motionType: "static",
  });
  const [, load] = useBox({
    size: [1, 1, 1],
    position: [0, 4, 0],
    motionType: "dynamic",
  });

  useFixedConstraint(anchor, load, { breakForce: 10 });
  return null;
};

/**
 * A 40 kg crate dropped onto a plank hung from two joints. The impact is
 * resolved over about two steps whatever their length, so a load read off a
 * single step would be twice as high at 120 Hz as at 60.
 */
const DropTest = ({ drop }: { drop: number }) => {
  const [, plank] = useBox({
    size: [3, 0.2, 1],
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: 10,
  });
  useBox({
    size: [0.8, 0.8, 0.8],
    position: [0.6, 4 + drop, 0],
    motionType: "dynamic",
    mass: 40,
  });

  usePointConstraint(null, plank, {
    point: [-1.5, 4, 0],
    breakForce: 5000,
    onBreak: countBreak,
  });
  usePointConstraint(null, plank, {
    point: [1.5, 4, 0],
    breakForce: 5000,
    onBreak: countBreak,
  });

  return null;
};

const breaksAt = async (drop: number, hz: number) => {
  reset();
  const renderer = await renderPhysics(<DropTest drop={drop} />, {
    timeStep: "vary",
  });
  await step(renderer, hz * 2, 1 / hz);
  await unmount(renderer);
  return held.breaks;
};

const reset = () => {
  held.load = undefined;
  held.joint = undefined;
  held.breaks = 0;
  held.brokeAt = 0;
};

const heightOfLoad = () => held.load!.body.GetPosition().GetY();

describe("breakForce and breakTorque", () => {
  it("a joint loaded past its breakForce lets go, once", async () => {
    reset();
    const renderer = await renderPhysics(
      <Hanging breakForce={WEIGHT * 0.8} />,
    );
    await step(renderer, 60);

    expect(held.breaks).toBe(1);
    expect(held.brokeAt).toBeCloseTo(WEIGHT, 0);
    expect(held.joint!.isEnabled()).toBe(false);
    expect(heightOfLoad()).toBeLessThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds a load under its breakForce", async () => {
    reset();
    const renderer = await renderPhysics(
      <Hanging breakForce={WEIGHT * 1.2} />,
    );
    await step(renderer, 120);

    expect(held.breaks).toBe(0);
    expect(held.joint!.isEnabled()).toBe(true);
    expect(heightOfLoad()).toBeCloseTo(4, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("setEnabled(true) mends it, and an overload breaks it again", async () => {
    reset();
    const renderer = await renderPhysics(
      <Hanging breakForce={WEIGHT * 0.8} />,
    );
    await step(renderer, 5);
    expect(held.breaks).toBe(1);

    held.joint!.setEnabled(true);
    expect(held.joint!.isEnabled()).toBe(true);
    await step(renderer, 5);

    expect(held.breaks).toBe(2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("breakTorque counts what holds a hinge's axis", async () => {
    reset();
    const weak = await renderPhysics(
      <Cantilever breakTorque={WEIGHT * 0.8} />,
    );
    await step(weak, 60);

    expect(held.breaks).toBe(1);
    expect(heightOfLoad()).toBeLessThan(4.5);

    await unmount(weak);

    reset();
    const strong = await renderPhysics(
      <Cantilever breakTorque={WEIGHT * 1.2} />,
    );
    await step(strong, 120);

    expect(held.breaks).toBe(0);
    expect(heightOfLoad()).toBeCloseTo(5, 1);

    await unmount(strong);
    expectNoAsserts();
  });

  it("the same impact breaks the same joint at any step rate", async () => {
    for (const hz of [60, 144, 240]) {
      expect(await breaksAt(1, hz)).toBe(0);
      expect(await breaksAt(3, hz)).toBeGreaterThan(0);
    }
    expectNoAsserts();
  });

  it("warns on a fixed constraint, which reports no load to break on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(<Welded />);
    await step(renderer, 2);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("breakForce / breakTorque ignored"),
    );
    warn.mockRestore();

    await unmount(renderer);
    expectNoAsserts();
  });
});
