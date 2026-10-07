import { useEffect, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Mesh } from "three";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { MotionType } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const held: {
  ref: RefObject<Mesh | null> | null;
  api: BodyApi<Jolt.BoxShape> | undefined;
} = { ref: null, api: undefined };

// A physics step four times slower than the frame rate, so most frames land
// between steps. That is exactly the case interpolation exists for, and the case
// where its absence is visible as judder.
const SLOW_STEP = 1 / 15;
const FRAME = 1 / 60;

const Falling = ({ motionType = "dynamic" }: { motionType?: MotionType }) => {
  const [ref, api] = useBox({
    size: [1, 1, 1],
    position: [0, 10, 0],
    motionType,
    mass: 1,
    linearDamping: 0,
  });

  useEffect(() => {
    held.ref = ref;
    held.api = api;
    return () => {
      held.ref = null;
      held.api = undefined;
    };
  }, [ref, api]);

  return <mesh ref={ref} />;
};

const Floor = () => {
  useBox({ size: [20, 1, 20], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const meshY = () => {
  const mesh = held.ref?.current;
  if (!mesh) throw new Error("mesh was never attached");
  return mesh.position.y;
};

/**
 * Discards the frames before the first step lands. Until then the body has
 * genuinely not moved, so holding position is correct rather than a stall, and
 * counting those frames would penalise interpolation for being honest.
 */
const WARMUP_FRAMES = Math.ceil(SLOW_STEP / FRAME);

const sampleY = async (
  renderer: Awaited<ReturnType<typeof renderPhysics>>,
  frames: number,
) => {
  await step(renderer, WARMUP_FRAMES, FRAME);

  const samples: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    await step(renderer, 1, FRAME);
    samples.push(meshY());
  }
  return samples;
};

const stalledFrames = (samples: number[]) =>
  samples.filter((value, index) => index > 0 && value === samples[index - 1])
    .length;

describe("interpolation", () => {
  it("moves the mesh on every frame, not only on stepping ones", async () => {
    const renderer = await renderPhysics(<Falling />, {
      timeStep: SLOW_STEP,
    });

    const samples = await sampleY(renderer, 16);

    expect(stalledFrames(samples)).toBe(0);
    expect(samples.at(-1)!).toBeLessThan(samples[0]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("without it, the mesh visibly stalls between steps", async () => {
    const renderer = await renderPhysics(<Falling />, {
      timeStep: SLOW_STEP,
      interpolate: false,
    });

    const samples = await sampleY(renderer, 16);

    // Three of every four frames do not step, so the mesh holds its position.
    expect(stalledFrames(samples)).toBeGreaterThan(8);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lags the body by up to one step, which is the cost of it", async () => {
    const renderer = await renderPhysics(<Falling />, {
      timeStep: SLOW_STEP,
    });

    await step(renderer, 8, FRAME);

    const body = held.api!.body;
    const bodyY = body.GetPosition().GetY();

    // Behind the simulation, but by less than a step's worth of fall.
    expect(meshY()).toBeGreaterThan(bodyY);
    expect(meshY() - bodyY).toBeLessThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps alpha inside one step", async () => {
    const renderer = await renderPhysics(<Falling />, {
      timeStep: SLOW_STEP,
    });

    for (let frame = 0; frame < 20; frame += 1) {
      await step(renderer, 1, FRAME);
      const { alpha } = getApi().timing;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("snaps on a teleport instead of sliding in from the old position", async () => {
    const renderer = await renderPhysics(<Falling />, {
      timeStep: SLOW_STEP,
    });

    await step(renderer, 8, FRAME);
    expect(meshY()).toBeLessThan(10);

    held.api!.setPositionAndRotation([0, 50, 0], [0, 0, 0, 1]);
    await step(renderer, 1, FRAME);

    // Blending from the pre-teleport transform would land it far short of 50.
    expect(meshY()).toBeCloseTo(50, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves a static body exactly where it was put", async () => {
    const renderer = await renderPhysics(<Falling motionType="static" />, {
      timeStep: SLOW_STEP,
    });

    const samples = await sampleY(renderer, 8);

    expect(samples.every((value) => value === 10)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("is off for a varying timestep, which already steps every frame", async () => {
    const renderer = await renderPhysics(<Falling />, { timeStep: "vary" });

    await step(renderer, 4, FRAME);

    expect(getApi().timing.interpolate).toBe(false);
    expect(getApi().timing.alpha).toBe(0);
    expect(meshY()).toBeCloseTo(held.api!.body.GetPosition().GetY(), 6);

    await unmount(renderer);
    expectNoAsserts();
  });
  /**
   * A settled body is read once and then left alone. Stopping at the last
   * interpolated frame instead would leave the mesh a fraction of a step short
   * of where the body actually came to rest.
   */
  it("lands a body that falls asleep exactly on its resting pose", async () => {
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Falling />
      </>,
    );

    for (let frame = 0; frame < 600 && held.api!.body.IsActive(); frame += 1) {
      await step(renderer, 1, FRAME);
    }
    expect(held.api!.body.IsActive()).toBe(false);

    await step(renderer, 1, FRAME);
    expect(meshY()).toBe(held.api!.body.GetPosition().GetY());

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stops reading a sleeping body's transform out of Jolt", async () => {
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Falling />
      </>,
    );

    for (let frame = 0; frame < 600 && held.api!.body.IsActive(); frame += 1) {
      await step(renderer, 1, FRAME);
    }
    await step(renderer, 1, FRAME);

    const reads = vi.spyOn(held.api!.body, "GetPosition");
    await step(renderer, 20, FRAME);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("redraws a sleeping body teleported without waking it", async () => {
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Falling />
      </>,
    );

    for (let frame = 0; frame < 600 && held.api!.body.IsActive(); frame += 1) {
      await step(renderer, 1, FRAME);
    }

    held.api!.setPositionAndRotation([0, 7, 0], [0, 0, 0, 1], false);
    await step(renderer, 2, FRAME);

    expect(held.api!.body.IsActive()).toBe(false);
    expect(meshY()).toBeCloseTo(7, 5);

    await unmount(renderer);
    expectNoAsserts();
  });
});
