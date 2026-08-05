import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import type { BodyApi } from "@/Jolt/internal/useBody";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const captured: { api: BodyApi<Jolt.BoxShape> | undefined } = {
  api: undefined,
};

const Ground = () => {
  useBox({ size: [20, 1, 20], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const Sleeper = ({
  onWake,
  onSleep,
}: {
  onWake?: () => void;
  onSleep?: () => void;
}) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 0.5, 0],
    motionType: "dynamic",
    mass: 1,
    onWake,
    onSleep,
  });

  useEffect(() => {
    captured.api = api;
    return () => {
      captured.api = undefined;
    };
  }, [api]);

  return null;
};

const ready = () => {
  if (!captured.api) throw new Error("body api was never published");
  return captured.api;
};

describe("sleep and wake events", () => {
  it("fires onSleep when a resting body settles", async () => {
    const onSleep = vi.fn();
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Sleeper onSleep={onSleep} />
      </>,
    );

    const api = ready();
    expect(api.isSleeping()).toBe(false);

    await step(renderer, 120);

    expect(onSleep).toHaveBeenCalled();
    expect(api.isSleeping()).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("fires onWake when the body is disturbed again", async () => {
    const onWake = vi.fn();
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Sleeper onWake={onWake} />
      </>,
    );

    const api = ready();
    await step(renderer, 120);
    expect(api.isSleeping()).toBe(true);

    onWake.mockClear();
    api.applyImpulse([0, 6, 0]);
    await step(renderer, 2);

    expect(onWake).toHaveBeenCalled();
    expect(api.isSleeping()).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("delivers events after the step, not from inside it", async () => {
    const stepping: boolean[] = [];
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Sleeper
          onSleep={() => {
            // Reaching into the world from inside Step() would deadlock on the
            // body lock or trip an assert; from the flush it is simply legal.
            const { physicsSystem } = getApi();
            stepping.push(physicsSystem.GetNumBodies() > 0);
          }}
        />
      </>,
    );

    await step(renderer, 120);

    expect(stepping.length).toBeGreaterThan(0);
    expect(stepping.every(Boolean)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("installs no listener when no body asks for events", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Sleeper />
      </>,
    );
    const { physicsSystem, Jolt } = getApi();

    expect(Jolt.getPointer(physicsSystem.GetBodyActivationListener())).toBe(0);

    await step(renderer, 120);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves the heap flat across mount cycles", async () => {
    const { Jolt } = getApi();

    const run = async () => {
      const renderer = await renderPhysics(
        <>
          <Ground />
          <Sleeper onSleep={() => {}} onWake={() => {}} />
        </>,
      );
      await step(renderer, 90);
      await unmount(renderer);
    };

    await run();
    const baseline = Jolt.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 3; i += 1) await run();

    expect(Jolt.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);
    expectNoAsserts();
  });
});
