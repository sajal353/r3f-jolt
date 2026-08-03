import { describe, expect, it } from "vitest";
import { useBox } from "@/Jolt/useBox";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const StaticBoxWithMass = () => {
  useBox({
    size: [10, 1, 10],
    position: [0, 0, 0],
    motionType: "static",
    mass: 1000,
  });
  return null;
};

const StaticAndDynamic = () => {
  useBox({ size: [10, 1, 10], position: [0, 0, 0], motionType: "static" });
  useBox({
    size: [1, 1, 1],
    position: [0, 6, 0],
    motionType: "dynamic",
    mass: 10,
  });
  return null;
};

describe("static bodies", () => {
  // A static body has no MotionProperties — `GetMotionProperties()` returns a
  // null pointer and trips a Jolt assertion. 0.1.x called it unconditionally to
  // apply `mass`, so the guard is what this asserts: the debug build must stay
  // silent for the whole mount/step/unmount.
  it("accepts a mass prop without touching a static body's MotionProperties", async () => {
    const renderer = await renderPhysics(<StaticBoxWithMass />);
    const { physicsSystem } = getApi();

    expect(physicsSystem.GetNumBodies()).toBe(1);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets a dynamic body come to rest on a static one", async () => {
    const renderer = await renderPhysics(<StaticAndDynamic />);
    const { physicsSystem, Jolt } = getApi();

    await step(renderer, 180);

    const bodies = new Jolt.BodyIDVector();
    physicsSystem.GetBodies(bodies);
    const bodyInterface = physicsSystem.GetBodyInterface();

    let restingY = Number.NaN;
    for (let i = 0; i < bodies.size(); i += 1) {
      const id = bodies.at(i);
      if (bodyInterface.GetMotionType(id) === Jolt.EMotionType_Dynamic) {
        restingY = bodyInterface.GetPosition(id).GetY();
      }
    }
    Jolt.destroy(bodies);

    expect(restingY).toBeGreaterThan(0.9);
    expect(restingY).toBeLessThan(1.2);

    await unmount(renderer);
    expectNoAsserts();
  });
});
