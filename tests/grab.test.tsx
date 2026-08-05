import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import type { BodyApi, BodyOptions } from "@/Jolt/internal/useBody";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

type BoxApi = BodyApi<Jolt.BoxShape>;

const held: { grabbed?: BoxApi; target?: BoxApi } = {};

const STEP_DISTANCE = 0.02;

const Grabbable = (options: Partial<BodyOptions>) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 1,
    linearDamping: 0,
    ...options,
  });

  useEffect(() => {
    held.grabbed = api;
    return () => {
      held.grabbed = undefined;
    };
  }, [api]);

  return null;
};

const Target = () => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [3, 0, 0],
    motionType: "dynamic",
    mass: 1,
    linearDamping: 0,
  });

  useEffect(() => {
    held.target = api;
    return () => {
      held.target = undefined;
    };
  }, [api]);

  return null;
};

const grabbed = () => {
  if (!held.grabbed) throw new Error("grabbable body was never published");
  return held.grabbed;
};

const zeroG = { gravity: [0, 0, 0] as [number, number, number] };

/** Carries the body along +x, one step's worth of travel per frame. */
const carry = async (
  renderer: Awaited<ReturnType<typeof renderPhysics>>,
  frames: number,
) => {
  const api = grabbed();
  let travelled = api.body.GetPosition().GetX();

  for (let frame = 0; frame < frames; frame += 1) {
    travelled += STEP_DISTANCE;
    api.moveTo([travelled, 0, 0], [0, 0, 0, 1]);
    await step(renderer, 1);
  }
};

describe("grab, carry and release", () => {
  it("switches to kinematic and back, and the carry becomes the throw", async () => {
    const renderer = await renderPhysics(<Grabbable />, zeroG);
    const api = grabbed();
    const { bodyInterface, Jolt } = getApi();

    expect(api.isGrabbed()).toBe(false);

    api.grab();
    expect(api.isGrabbed()).toBe(true);
    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Kinematic,
    );

    await carry(renderer, 10);
    expect(api.body.GetPosition().GetX()).toBeGreaterThan(0.1);

    api.release();

    expect(api.isGrabbed()).toBe(false);
    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Dynamic,
    );

    // Nothing was applied by hand: the velocity MoveKinematic implied survives
    // the switch back, which is the throw.
    expect(
      bodyInterface.GetLinearVelocity(api.body.GetID()).GetX(),
    ).toBeCloseTo(STEP_DISTANCE * 60, 1);

    await step(renderer, 10);
    expect(api.body.GetPosition().GetX()).toBeGreaterThan(0.3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("remembers a kinematic body was kinematic", async () => {
    const renderer = await renderPhysics(
      <Grabbable motionType="kinematic" mass={undefined} />,
      zeroG,
    );
    const api = grabbed();
    const { bodyInterface, Jolt } = getApi();

    api.grab();
    api.release();

    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Kinematic,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("pushes a dynamic body it is carried into", async () => {
    const renderer = await renderPhysics(
      <>
        <Grabbable />
        <Target />
      </>,
      zeroG,
    );

    grabbed().grab();
    await carry(renderer, 130);

    expect(held.target!.body.GetPosition().GetX()).toBeGreaterThan(3.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses to grab a static body created without the flag", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(
      <Grabbable motionType="static" mass={undefined} />,
      zeroG,
    );
    const api = grabbed();
    const { bodyInterface, Jolt } = getApi();

    api.grab();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("allowDynamicOrKinematic"),
    );
    expect(api.isGrabbed()).toBe(false);
    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Static,
    );

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("grabs a static body that was created with the flag", async () => {
    const renderer = await renderPhysics(
      <Grabbable
        motionType="static"
        mass={undefined}
        allowDynamicOrKinematic
      />,
      zeroG,
    );
    const api = grabbed();
    const { bodyInterface, Jolt } = getApi();

    api.grab();
    expect(api.isGrabbed()).toBe(true);

    await carry(renderer, 5);
    api.release();

    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Static,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("ignores a second grab and a release that never grabbed", async () => {
    const renderer = await renderPhysics(<Grabbable />, zeroG);
    const api = grabbed();
    const { bodyInterface, Jolt } = getApi();

    api.release();
    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Dynamic,
    );

    api.grab();
    api.grab();
    api.release();

    // A second grab recording "kinematic" as the previous type would strand the
    // body kinematic for good.
    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Dynamic,
    );

    await unmount(renderer);
    expectNoAsserts();
  });
});
