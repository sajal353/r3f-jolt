import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import type { BodyApi, BodyOptions } from "@/Jolt/internal/useBody";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const held: { api?: BodyApi<Jolt.Shape> } = {};

const publish = (api: BodyApi<Jolt.Shape> | undefined) => {
  held.api = api;
};

const Box = (options: Partial<BodyOptions>) => {
  const [, api] = useBox({
    size: [2, 2, 2],
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 8,
    ...options,
  });

  useEffect(() => {
    publish(api);
    return () => publish(undefined);
  }, [api]);

  return null;
};

const Sphere = () => {
  const [, api] = useSphere({
    radius: 1,
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 1,
  });

  useEffect(() => {
    publish(api);
    return () => publish(undefined);
  }, [api]);

  return null;
};

const ready = () => {
  if (!held.api) throw new Error("body api was never published");
  return held.api;
};

/** Width of the collider Jolt is actually using, not of the base shape. */
const colliderWidth = () => {
  const api = ready();
  const { bodyInterface } = getApi();
  const bounds = bodyInterface.GetShape(api.body.GetID()).GetLocalBounds();
  return bounds.mMax.GetX() - bounds.mMin.GetX();
};

const zeroG = { gravity: [0, 0, 0] as [number, number, number] };

describe("setScale", () => {
  it("resizes the collider and the world keeps stepping", async () => {
    const renderer = await renderPhysics(<Box />, zeroG);

    const before = colliderWidth();
    expect(before).toBeCloseTo(2, 5);

    ready().setScale([3, 3, 3]);
    await step(renderer, 5);

    expect(colliderWidth()).toBeCloseTo(before * 3, 4);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("rebuilds from the base shape, so calls do not compound", async () => {
    const renderer = await renderPhysics(<Box />, zeroG);
    const api = ready();

    api.setScale([2, 2, 2]);
    await step(renderer, 1);
    expect(colliderWidth()).toBeCloseTo(4, 4);

    api.setScale([2, 2, 2]);
    await step(renderer, 1);

    // Scaling the already-scaled shape would give 8.
    expect(colliderWidth()).toBeCloseTo(4, 4);

    api.setScale([1, 1, 1]);
    await step(renderer, 1);
    expect(colliderWidth()).toBeCloseTo(2, 4);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("accepts non-uniform scale on a box", async () => {
    const renderer = await renderPhysics(<Box />, zeroG);

    ready().setScale([4, 1, 1]);
    await step(renderer, 1);

    expect(colliderWidth()).toBeCloseTo(8, 4);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses non-uniform scale on a sphere and says what would work", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(<Sphere />, zeroG);

    const before = colliderWidth();
    ready().setScale([2, 1, 1]);
    await step(renderer, 1);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("MakeScaleValid"),
    );
    expect(colliderWidth()).toBeCloseTo(before, 5);

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps an explicit mass across a rescale", async () => {
    const renderer = await renderPhysics(<Box mass={8} />, zeroG);
    const api = ready();

    const massBefore = 1 / api.body.GetMotionProperties().GetInverseMass();
    expect(massBefore).toBeCloseTo(8, 4);

    api.setScale([2, 2, 2]);
    await step(renderer, 1);

    // Without the reapply, SetShape recomputes from density × the new volume
    // and this would be 8× larger.
    expect(1 / api.body.GetMotionProperties().GetInverseMass()).toBeCloseTo(
      8,
      4,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  // The two assertions above and below both land on 8, so on their own they
  // cannot show the reapply is doing anything. This goes through the raw
  // interface to show what setScale is protecting against.
  it("SetShape really does discard an explicit mass, which is why we reapply", async () => {
    const renderer = await renderPhysics(<Box mass={8} />, zeroG);
    const api = ready();
    const { Jolt, bodyInterface } = getApi();

    const scale = new Jolt.Vec3(2, 2, 2);
    const scaled = new Jolt.ScaledShape(api.shape, scale);
    scaled.AddRef();
    Jolt.destroy(scale);

    bodyInterface.SetShape(
      api.body.GetID(),
      scaled,
      true,
      Jolt.EActivation_Activate,
    );

    const recomputed = 1 / api.body.GetMotionProperties().GetInverseMass();
    expect(recomputed).toBeGreaterThan(8);

    scaled.Release();
    await step(renderer, 1);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves mass alone when told not to update mass properties", async () => {
    const renderer = await renderPhysics(<Box mass={8} />, zeroG);
    const api = ready();

    api.setScale([2, 2, 2], false);
    await step(renderer, 1);

    expect(1 / api.body.GetMotionProperties().GetInverseMass()).toBeCloseTo(
      8,
      4,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("releases the previous ScaledShape on every call", async () => {
    const module = await loadDebugModule();
    const renderer = await renderPhysics(<Box />, zeroG);
    const api = ready();

    for (let i = 0; i < 20; i += 1) api.setScale([1 + (i % 4), 1, 1]);
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 200; i += 1) api.setScale([1 + (i % 4), 1, 1]);

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);

    await step(renderer, 2);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves the heap flat across mount cycles that rescale", async () => {
    const module = await loadDebugModule();

    const run = async () => {
      const renderer = await renderPhysics(<Box />, zeroG);
      ready().setScale([2, 2, 2]);
      await step(renderer, 5);
      await unmount(renderer);
    };

    await run();
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 3; i += 1) await run();

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);
    expectNoAsserts();
  });

  it("mirrors the scale onto the debug wireframe", async () => {
    const renderer = await renderPhysics(<Box debug />, zeroG);
    const api = ready();

    expect(api.debugMesh).not.toBeNull();
    expect(api.debugMesh!.scale.x).toBe(1);

    api.setScale([3, 1, 2]);
    await step(renderer, 1);

    expect(api.debugMesh!.scale.toArray()).toEqual([3, 1, 2]);

    await unmount(renderer);
    expectNoAsserts();
  });
});
