import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { useBox } from "@/Jolt/useBox";
import { useAllHitsRaycaster } from "@/Jolt/useAllHitsRaycaster";
import type { AllHitsRaycasterApi } from "@/Jolt/useAllHitsRaycaster";
import { useAnyHitRaycaster } from "@/Jolt/useAnyHitRaycaster";
import type { AnyHitRaycasterApi } from "@/Jolt/useAnyHitRaycaster";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";
import type { ClosestHitRaycasterApi } from "@/Jolt/useClosestHitRaycaster";
import {
  expectNoAsserts,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const held: {
  all?: AllHitsRaycasterApi;
  any?: AnyHitRaycasterApi;
  closest?: ClosestHitRaycasterApi;
} = {};

// Three slabs the ray must pass through, at y = 6, 3 and 0. A downward ray from
// y = 10 meets them in that order, so "sorted" is checkable against a known
// answer rather than against itself.
const SLAB_HEIGHTS = [6, 3, 0];

const Stack = () => {
  useBox({
    size: [4, 0.5, 4],
    position: [0, SLAB_HEIGHTS[0], 0],
    motionType: "static",
  });
  useBox({
    size: [4, 0.5, 4],
    position: [0, SLAB_HEIGHTS[1], 0],
    motionType: "static",
  });
  useBox({
    size: [4, 0.5, 4],
    position: [0, SLAB_HEIGHTS[2], 0],
    motionType: "static",
  });

  // Default layer: LAYER_MOVING masks both groups, so the ray sees the static
  // slabs as well as anything dynamic.
  const [all] = useAllHitsRaycaster();
  const [any] = useAnyHitRaycaster();
  const [closest] = useClosestHitRaycaster();

  useEffect(() => {
    held.all = all;
    held.any = any;
    held.closest = closest;
    return () => {
      held.all = undefined;
      held.any = undefined;
      held.closest = undefined;
    };
  }, [all, any, closest]);

  return null;
};

const from = new Vector3(0, 10, 0);
const down = new Vector3(0, -20, 0);
const away = new Vector3(100, 10, 100);

const scene = () => renderPhysics(<Stack />, { gravity: [0, 0, 0] });

describe("useAllHitsRaycaster", () => {
  it("returns every slab along the ray, nearest first", async () => {
    const renderer = await scene();
    await step(renderer, 2);

    const hits = held.all!.cast(from, down);

    expect(hits).toHaveLength(3);

    const fractions = hits.map((hit) => hit.fraction);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);

    // Nearest slab first: the ray starts above, so it meets y = 6 before y = 0.
    expect(hits[0].point.y).toBeCloseTo(SLAB_HEIGHTS[0] + 0.25, 1);
    expect(hits[2].point.y).toBeCloseTo(SLAB_HEIGHTS[2] + 0.25, 1);

    expect(new Set(hits.map((hit) => hit.bodyID)).size).toBe(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("returns an empty array on a miss, and recovers afterwards", async () => {
    const renderer = await scene();
    await step(renderer, 2);

    expect(held.all!.cast(from, down)).toHaveLength(3);
    expect(held.all!.cast(away, down)).toHaveLength(0);
    expect(held.all!.cast(from, down)).toHaveLength(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("casts repeatedly without growing the WASM heap", async () => {
    const module = await loadDebugModule();
    const renderer = await scene();
    await step(renderer, 2);

    for (let i = 0; i < 50; i += 1) held.all!.cast(from, down);
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 500; i += 1) held.all!.cast(from, down);

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);
    expect(held.all!.cast(from, down)).toHaveLength(3);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useAnyHitRaycaster", () => {
  it("reports a hit on one of the slabs", async () => {
    const renderer = await scene();
    await step(renderer, 2);

    const hit = held.any!.cast(from, down);

    expect(hit.hit).toBe(true);
    expect(hit.bodyID).not.toBe(0);

    const allIDs = held.all!.cast(from, down).map((entry) => entry.bodyID);
    expect(allIDs).toContain(hit.bodyID);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reports a miss cleanly", async () => {
    const renderer = await scene();
    await step(renderer, 2);

    expect(held.any!.cast(from, down).hit).toBe(true);

    const miss = held.any!.cast(away, down);
    expect(miss.hit).toBe(false);
    expect(miss.bodyID).toBe(0);
    expect(miss.fraction).toBe(0);

    expect(held.any!.cast(from, down).hit).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("the three raycasters agree", () => {
  it("closest matches the first of all-hits", async () => {
    const renderer = await scene();
    await step(renderer, 2);

    const nearest = held.all!.cast(from, down)[0];
    const closest = held.closest!.cast(from, down);

    expect(closest.bodyID).toBe(nearest.bodyID);
    expect(closest.fraction).toBeCloseTo(nearest.fraction, 6);
    expect(closest.point.y).toBeCloseTo(nearest.point.y, 6);

    await unmount(renderer);
    expectNoAsserts();
  });
});
