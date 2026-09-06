import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import { useJolt } from "@/Jolt/useJolt";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { StepCallback } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const Counter = ({
  onBefore,
  onAfter,
}: {
  onBefore?: StepCallback;
  onAfter?: StepCallback;
}) => {
  useBeforePhysicsStep((delta, index) => onBefore?.(delta, index));
  useAfterPhysicsStep((delta, index) => onAfter?.(delta, index));
  return null;
};

const captured: { api: BodyApi<Jolt.BoxShape> | undefined } = {
  api: undefined,
};

const Pushed = ({ phase }: { phase: "before" | "after" }) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 1,
    gravityFactor: 0,
    linearDamping: 0,
  });

  useEffect(() => {
    captured.api = api;
    return () => {
      captured.api = undefined;
    };
  }, [api]);

  const push = () => api?.applyForce([100, 0, 0]);

  useBeforePhysicsStep(() => {
    if (phase === "before") push();
  });

  useAfterPhysicsStep(() => {
    if (phase === "after") push();
  });

  return null;
};

const positionX = () => {
  const api = captured.api;
  if (!api) throw new Error("body api was never published");
  return api.body.GetPosition().GetX();
};

/** Subscribes a second callback from inside the first one's run. */
const LateSubscriber = ({ onLate }: { onLate: () => void }) => {
  const api = useJolt();

  useBeforePhysicsStep(() => {
    api.steps.add("before", () => onLate());
  });

  return null;
};

describe("step callbacks", () => {
  it("runs once per step at a fixed timestep, not once per frame", async () => {
    const before: number[] = [];
    const after: number[] = [];

    const renderer = await renderPhysics(
      <Counter
        onBefore={(_, index) => before.push(index)}
        onAfter={(_, index) => after.push(index)}
      />,
      { timeStep: 1 / 120 },
    );

    // Each 1/60 frame covers two 1/120 steps.
    await step(renderer, 5, 1 / 60);

    expect(before).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(after).toEqual(before);
    expect(getApi().timing.stepCount).toBe(10);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("runs once per frame when the timestep varies", async () => {
    const before: number[] = [];

    const renderer = await renderPhysics(
      <Counter onBefore={(_, index) => before.push(index)} />,
      { timeStep: "vary" },
    );

    await step(renderer, 4);

    expect(before).toEqual([0, 1, 2, 3]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reports the step's own delta and its place in the clock", async () => {
    const deltas: number[] = [];
    const clockDuringBefore: number[] = [];
    const clockDuringAfter: number[] = [];

    const renderer = await renderPhysics(
      <Counter
        onBefore={(delta) => {
          deltas.push(delta);
          clockDuringBefore.push(getApi().timing.stepCount);
        }}
        onAfter={(_, index) => {
          clockDuringAfter.push(getApi().timing.stepCount - index);
        }}
      />,
      { timeStep: 1 / 90 },
    );

    await step(renderer, 3, 1 / 90);

    expect(deltas).toEqual([1 / 90, 1 / 90, 1 / 90]);
    expect(clockDuringBefore).toEqual([0, 1, 2]);
    expect(clockDuringAfter).toEqual([1, 1, 1]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("applies a force in the same step when it runs before", async () => {
    const renderer = await renderPhysics(<Pushed phase="before" />, {
      timeStep: 1 / 60,
    });

    await step(renderer, 1);
    const moved = positionX();

    await unmount(renderer);

    expect(moved).toBeGreaterThan(0);
    expectNoAsserts();
  });

  it("leaves the step untouched when it runs after", async () => {
    const renderer = await renderPhysics(<Pushed phase="after" />, {
      timeStep: 1 / 60,
    });

    await step(renderer, 1);
    const moved = positionX();

    await unmount(renderer);

    expect(moved).toBe(0);
    expectNoAsserts();
  });

  it("stops delivering once the subscriber unmounts", async () => {
    let calls = 0;

    const renderer = await renderPhysics(
      <Counter onBefore={() => (calls += 1)} />,
      { timeStep: 1 / 60 },
    );

    await step(renderer, 3);
    const whileMounted = calls;

    await updatePhysics(renderer, null, { timeStep: 1 / 60 });
    await step(renderer, 3);

    expect(whileMounted).toBe(3);
    expect(calls).toBe(whileMounted);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds a callback subscribed mid-step until the next one", async () => {
    let late = 0;

    const renderer = await renderPhysics(
      <LateSubscriber onLate={() => (late += 1)} />,
      { timeStep: 1 / 60 },
    );

    // Each step subscribes one more callback, and none of them may run in the
    // step that added it: 0 + 1 + 2 = 3 late calls, not 6.
    await step(renderer, 3);

    expect(late).toBe(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * The demo runs in `<StrictMode>`, which mounts every effect twice — setup,
   * cleanup, setup. A subscription that does not come off in the cleanup is
   * therefore doubled for the life of the component, and a force applied from
   * one is applied twice. Found in the browser, as an orbit that spiralled in
   * against a scene that measured perfectly without StrictMode.
   */
  it("subscribes once under StrictMode, not twice", async () => {
    let before = 0;
    let after = 0;

    const renderer = await renderPhysics(
      <Counter onBefore={() => (before += 1)} onAfter={() => (after += 1)} />,
      { timeStep: 1 / 60, strict: true },
    );

    await step(renderer, 10);

    expect(getApi().timing.stepCount).toBe(10);
    expect(before).toBe(10);
    expect(after).toBe(10);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("runs nothing while the world is paused", async () => {
    let calls = 0;

    const renderer = await renderPhysics(
      <Counter onBefore={() => (calls += 1)} />,
      { timeStep: 1 / 60, paused: true },
    );

    await step(renderer, 5);

    expect(calls).toBe(0);

    await unmount(renderer);
    expectNoAsserts();
  });
});
