import { describe, expect, it, vi } from "vitest";
import { useBox } from "@/Jolt/useBox";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const Block = ({ x }: { x: number }) => {
  useBox({
    size: [0.5, 0.5, 0.5],
    position: [x, 5, 0],
    motionType: "dynamic",
    mass: 1,
  });
  return null;
};

const Blocks = ({ count }: { count: number }) => (
  <>
    {Array.from({ length: count }, (_, index) => (
      <Block key={index} x={index * 2} />
    ))}
  </>
);

const solverSteps = () => {
  const settings = getApi().physicsSystem.GetPhysicsSettings();
  return {
    velocity: settings.mNumVelocitySteps,
    position: settings.mNumPositionSteps,
  };
};

describe("world configuration", () => {
  it("sizes the body pool from maxBodies", async () => {
    const renderer = await renderPhysics(<Blocks count={3} />, {
      maxBodies: 8,
    });

    expect(getApi().physicsSystem.GetMaxBodies()).toBe(8);
    expect(getApi().physicsSystem.GetNumBodies()).toBe(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses the body that would overflow the pool, in words", async () => {
    // React logs the thrown error on its way out; the test is about the throw.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      renderPhysics(<Blocks count={3} />, { maxBodies: 2 }),
    ).rejects.toThrow(/maxBodies/);

    consoleError.mockRestore();

    // The guard runs before Jolt is asked for anything, so the debug build has
    // nothing to complain about — which is the whole point of checking first.
    expectNoAsserts();
  });

  it("applies solver settings over the defaults", async () => {
    const renderer = await renderPhysics(<Blocks count={1} />, {
      physicsSettings: { numVelocitySteps: 17, numPositionSteps: 5 },
    });

    expect(solverSteps()).toEqual({ velocity: 17, position: 5 });

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves unnamed settings at Jolt's defaults", async () => {
    const renderer = await renderPhysics(<Blocks count={1} />, {
      physicsSettings: { numVelocitySteps: 17 },
    });

    expect(solverSteps().velocity).toBe(17);
    expect(solverSteps().position).toBe(2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("changes solver settings on a running world without rebuilding it", async () => {
    const renderer = await renderPhysics(<Blocks count={1} />, {
      physicsSettings: { numVelocitySteps: 4 },
    });

    await step(renderer, 10);

    const before = getApi();
    const bodies = before.physicsSystem.GetNumBodies();

    await updatePhysics(renderer, <Blocks count={1} />, {
      physicsSettings: { numVelocitySteps: 12 },
    });

    expect(solverSteps().velocity).toBe(12);
    expect(getApi().physicsSystem).toBe(before.physicsSystem);
    expect(getApi().physicsSystem.GetNumBodies()).toBe(bodies);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets settingsOverride win over the props", async () => {
    const renderer = await renderPhysics(<Blocks count={1} />, {
      maxBodies: 16,
      settingsOverride: (settings) => {
        settings.mMaxBodies = 64;
      },
    });

    expect(getApi().physicsSystem.GetMaxBodies()).toBe(64);

    await unmount(renderer);
    expectNoAsserts();
  });
});
