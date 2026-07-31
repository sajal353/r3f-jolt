import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import type { BodyApi } from "@/Jolt/internal/useBody";
import { expectNoAsserts, getApi, renderPhysics, step, unmount } from "./harness";

const captured: { current?: BodyApi<Jolt.BoxShape> } = {};

const Killable = ({ enabled = true }: { enabled?: boolean }) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 5, 0],
    motionType: "dynamic",
    enabled,
  });

  useEffect(() => {
    captured.current = api;
  }, [api]);

  return null;
};

// `GetNumBodies()` counts everything the BodyManager knows about, including
// bodies that were created but never added, so `IsAdded` is the question here.
const resetCapture = () => {
  captured.current = undefined;
};

const body = () => {
  if (!captured.current) throw new Error("body api not captured");
  return captured.current;
};

const isInSimulation = () => {
  if (!captured.current) throw new Error("body api not captured");
  return getApi().bodyInterface.IsAdded(captured.current.body.GetID());
};

describe("enabled / kill", () => {
  it("does not add a body created with enabled: false", async () => {
    resetCapture();
    const renderer = await renderPhysics(<Killable enabled={false} />);

    expect(isInSimulation()).toBe(false);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("kill() removes the body and later unmount stays clean", async () => {
    resetCapture();
    const renderer = await renderPhysics(<Killable />);

    expect(isInSimulation()).toBe(true);

    body().kill();
    expect(isInSimulation()).toBe(false);

    await step(renderer, 10);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("kill() is idempotent and revive() puts the body back", async () => {
    resetCapture();
    const renderer = await renderPhysics(<Killable />);

    body().kill();
    body().kill();
    expect(isInSimulation()).toBe(false);

    body().revive();
    expect(isInSimulation()).toBe(true);

    body().revive();
    expect(isInSimulation()).toBe(true);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps simulating other bodies after one is killed", async () => {
    resetCapture();
    const renderer = await renderPhysics(
      <>
        <Killable />
        <Killable />
      </>,
    );

    body().kill();
    await step(renderer, 30);
    await unmount(renderer);
    expectNoAsserts();
  });
});
