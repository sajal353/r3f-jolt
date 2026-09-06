import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { usePlane } from "@/Jolt/usePlane";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import type { BodyApi } from "@/Jolt/internal/useBody";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const published: Record<string, unknown> = {};

const usePublished = <T,>(name: string, value: T | undefined) => {
  useEffect(() => {
    if (value) published[name] = value;
  }, [name, value]);
};

const taken = <T,>(name: string) => {
  const value = published[name];
  if (!value) throw new Error(`${name} was never published`);
  return value as T;
};

const phases: string[] = [];

beforeEach(() => {
  for (const key of Object.keys(published)) delete published[key];
  phases.length = 0;
});

const Ground = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 40 });
  return null;
};

const Faller = () => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 20, 0],
    motionType: "dynamic",
  });

  usePublished("faller", api);
  return null;
};

const Phases = () => {
  useBeforePhysicsStep(() => phases.push("before"));
  useAfterPhysicsStep(() => phases.push("after"));
  return null;
};

const heightOf = (api: BodyApi<Jolt.BoxShape>) => api.body.GetPosition().GetY();

describe("updateLoop", () => {
  it("does not step on a frame when independent", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller />
        <Phases />
      </>,
      { updateLoop: "independent", timeStep: 1 / 60 },
    );

    const api = getApi();
    const faller = taken<BodyApi<Jolt.BoxShape>>("faller");
    const before = heightOf(faller);

    await step(renderer, 30);

    expect(api.timing.stepCount).toBe(0);
    expect(phases).toHaveLength(0);
    expect(heightOf(faller)).toBe(before);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("advances exactly one step per api.step()", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller />
        <Phases />
      </>,
      { updateLoop: "independent", timeStep: 1 / 60 },
    );

    const api = getApi();

    api.step();
    expect(api.timing.stepCount).toBe(1);
    expect(phases).toEqual(["before", "after"]);

    for (let i = 0; i < 9; i += 1) api.step();
    expect(api.timing.stepCount).toBe(10);
    expect(phases.filter((phase) => phase === "before")).toHaveLength(10);

    // Ten steps of free fall from 20 m: ½ · 9.81 · (10/60)² ≈ 0.14 m.
    const faller = taken<BodyApi<Jolt.BoxShape>>("faller");
    expect(20 - heightOf(faller)).toBeGreaterThan(0.1);
    expect(20 - heightOf(faller)).toBeLessThan(0.25);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("runs a whole delta's worth of steps when given one", async () => {
    const renderer = await renderPhysics(<Ground />, {
      updateLoop: "independent",
      timeStep: 1 / 60,
    });

    const api = getApi();
    api.step(4 / 60);
    expect(api.timing.stepCount).toBe(4);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("delivers contact events from a manual step", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller />
      </>,
      { updateLoop: "independent", timeStep: 1 / 60 },
    );

    const api = getApi();
    const faller = taken<BodyApi<Jolt.BoxShape>>("faller");

    for (let i = 0; i < 400; i += 1) api.step();

    expect(heightOf(faller)).toBeCloseTo(0.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("still steps from the frame loop by default", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller />
      </>,
      { timeStep: 1 / 60 },
    );

    const api = getApi();
    await step(renderer, 20);
    expect(api.timing.stepCount).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("does nothing on api.step() while paused", async () => {
    const renderer = await renderPhysics(<Ground />, {
      updateLoop: "independent",
      paused: true,
    });

    const api = getApi();
    api.step();
    expect(api.timing.stepCount).toBe(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("warns that a positive updatePriority stops R3F rendering", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const renderer = await renderPhysics(<Ground />, { updatePriority: 2 });

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("updatePriority={2}"),
      ),
    ).toBe(true);

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("steps normally at a negative updatePriority", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller />
      </>,
      { updatePriority: -5, timeStep: 1 / 60 },
    );

    const api = getApi();
    await step(renderer, 20);
    expect(api.timing.stepCount).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });
});
