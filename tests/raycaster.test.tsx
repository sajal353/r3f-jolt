import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { useBox } from "@/Jolt/useBox";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";
import type { ClosestHitRaycasterApi, RaycastHit } from "@/Jolt/useClosestHitRaycaster";
import {
  expectNoAsserts,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const held: { raycaster?: ClosestHitRaycasterApi } = {};

const hold = (value: ClosestHitRaycasterApi | undefined) => {
  held.raycaster = value;
};

const Scene = () => {
  useBox({
    size: [4, 1, 4],
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 1000,
  });

  const [api] = useClosestHitRaycaster();

  useEffect(() => {
    hold(api);
  }, [api]);

  return null;
};

const cast = (from: Vector3, direction: Vector3): RaycastHit => {
  if (!held.raycaster) throw new Error("raycaster not ready");
  return held.raycaster.cast(from, direction);
};

describe("useClosestHitRaycaster", () => {
  it("reports hit, fraction, distance, point, normal and bodyID", async () => {
    const renderer = await renderPhysics(<Scene />, { gravity: [0, 0, 0] });
    await step(renderer, 2);

    const hit = cast(new Vector3(0, 10, 0), new Vector3(0, -20, 0));

    expect(hit.hit).toBe(true);
    expect(hit.bodyID).not.toBe(0);
    expect(hit.fraction).toBeGreaterThan(0);
    expect(hit.fraction).toBeLessThan(1);
    expect(hit.distance).toBeCloseTo(hit.fraction * 20, 5);
    expect(hit.point.y).toBeCloseTo(0.5, 1);
    expect(hit.normal.y).toBeGreaterThan(0.9);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reports a miss without leaking state from the previous hit", async () => {
    const renderer = await renderPhysics(<Scene />, { gravity: [0, 0, 0] });
    await step(renderer, 2);

    expect(cast(new Vector3(0, 10, 0), new Vector3(0, -20, 0)).hit).toBe(true);

    const miss = cast(new Vector3(100, 10, 100), new Vector3(0, -20, 0));
    expect(miss.hit).toBe(false);
    expect(miss.fraction).toBe(0);
    expect(miss.distance).toBe(0);
    expect(miss.bodyID).toBe(0);

    // Reset-before-cast, not reset-after: a second identical cast must hit.
    expect(cast(new Vector3(0, 10, 0), new Vector3(0, -20, 0)).hit).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("casts repeatedly without growing the WASM heap", async () => {
    const module = await loadDebugModule();
    const renderer = await renderPhysics(<Scene />, { gravity: [0, 0, 0] });
    await step(renderer, 2);

    const origin = new Vector3(0, 10, 0);
    const direction = new Vector3(0, -20, 0);

    for (let i = 0; i < 50; i += 1) cast(origin, direction);
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 1000; i += 1) cast(origin, direction);

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);
    expect(cast(origin, direction).hit).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });
});
