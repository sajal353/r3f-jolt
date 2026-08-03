import { useEffect } from "react";
import { Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { BodyOptions } from "@/Jolt/internal/useBody";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

type BoxApi = BodyApi<Jolt.BoxShape>;

const captured: { api: BoxApi | undefined } = { api: undefined };

const Subject = (options: Partial<BodyOptions>) => {
  // Damping off so an impulse maps to a velocity exactly. Jolt defaults to 0.05
  // linear, which is a 0.08% bite per step — enough to fail a tight assertion
  // about the api while saying nothing about the api.
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 1,
    linearDamping: 0,
    angularDamping: 0,
    ...options,
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

const velocity = (api: BoxApi) => {
  const { bodyInterface } = getApi();
  const v = bodyInterface.GetLinearVelocity(api.body.GetID());
  return new Vector3(v.GetX(), v.GetY(), v.GetZ());
};

const angularVelocity = (api: BoxApi) => {
  const { bodyInterface } = getApi();
  const v = bodyInterface.GetAngularVelocity(api.body.GetID());
  return new Vector3(v.GetX(), v.GetY(), v.GetZ());
};

const position = (api: BoxApi) => {
  const { bodyInterface } = getApi();
  const p = bodyInterface.GetPosition(api.body.GetID());
  return new Vector3(p.GetX(), p.GetY(), p.GetZ());
};

const zeroG = { gravity: [0, 0, 0] as [number, number, number] };

describe("imperative body api", () => {
  it("applyImpulse changes linear velocity by impulse / mass", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.applyImpulse([5, 0, 0]);
    await step(renderer, 1);

    expect(velocity(api).x).toBeCloseTo(5, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("accepts a three Vector3 as readily as a tuple", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.applyImpulse(new Vector3(0, 0, 4));
    await step(renderer, 1);

    expect(velocity(api).z).toBeCloseTo(4, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("applyForce accumulates over the step it is applied in", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.applyForce([60, 0, 0]);
    await step(renderer, 1);

    // 60 N on 1 kg for one 1/60 s step ≈ 1 m/s.
    expect(velocity(api).x).toBeCloseTo(1, 2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("applyAngularImpulse and applyTorque spin the body", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.applyAngularImpulse([0, 1, 0]);
    await step(renderer, 1);
    const spun = angularVelocity(api).y;
    expect(spun).toBeGreaterThan(0);

    api.applyTorque([0, 60, 0]);
    await step(renderer, 1);
    expect(angularVelocity(api).y).toBeGreaterThan(spun);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("sets velocities directly", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.setLinearVelocity([1, 2, 3]);
    api.setAngularVelocity([0, 4, 0]);
    await step(renderer, 1);

    expect(velocity(api).x).toBeCloseTo(1, 3);
    expect(angularVelocity(api).y).toBeCloseTo(4, 3);

    api.setVelocities([7, 0, 0], [0, 0, 2]);
    await step(renderer, 1);

    expect(velocity(api).x).toBeCloseTo(7, 3);
    expect(angularVelocity(api).z).toBeCloseTo(2, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("setPositionAndRotation teleports without implying velocity", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.setPositionAndRotation([4, 5, 6], [0, 0, 0, 1]);
    await step(renderer, 1);

    expect(position(api).toArray()).toEqual([4, 5, 6]);
    expect(velocity(api).length()).toBeCloseTo(0, 5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("setGravityFactor takes effect", async () => {
    const renderer = await renderPhysics(<Subject />);
    const api = ready();

    api.setGravityFactor(0);
    await step(renderer, 30);

    expect(velocity(api).y).toBeCloseTo(0, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("sleep and wake toggle activation", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();
    const { bodyInterface } = getApi();

    api.sleep();
    expect(bodyInterface.IsActive(api.body.GetID())).toBe(false);

    api.wake();
    expect(bodyInterface.IsActive(api.body.GetID())).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("setLayer moves the body between layers", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();
    const { bodyInterface, layers } = getApi();

    api.setLayer(layers.LAYER_NON_MOVING);
    expect(bodyInterface.GetObjectLayer(api.body.GetID())).toBe(
      layers.LAYER_NON_MOVING,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("setEnabled removes and re-adds the body", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();
    const { bodyInterface, physicsSystem } = getApi();

    api.setEnabled(false);
    expect(bodyInterface.IsAdded(api.body.GetID())).toBe(false);

    api.setEnabled(true);
    expect(bodyInterface.IsAdded(api.body.GetID())).toBe(true);
    expect(physicsSystem.GetNumBodies()).toBe(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("no-ops once the body is killed", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    api.setLinearVelocity([3, 0, 0]);
    await step(renderer, 2);
    api.kill();

    const parked = position(api);

    // Each of these would assert inside Jolt if it reached the interface with
    // the body out of the world.
    api.applyImpulse([100, 0, 0]);
    api.applyTorque([0, 100, 0]);
    api.sleep();
    api.wake();
    api.setPositionAndRotation([9, 9, 9], [0, 0, 0, 1]);

    expect(position(api).toArray()).toEqual(parked.toArray());

    await step(renderer, 1);
    api.revive();
    await step(renderer, 1);

    // The 100 N·s impulse never landed. Removal zeroes velocity, so the body
    // resumes at rest rather than carrying anything across the gap.
    expect(velocity(api).length()).toBeLessThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("setMotionType", () => {
  it("refuses to promote a static body created without the flag", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(
      <Subject motionType="static" mass={undefined} />,
      zeroG,
    );
    const api = ready();
    const { bodyInterface, Jolt } = getApi();

    api.setMotionType("dynamic");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("allowDynamicOrKinematic"),
    );
    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Static,
    );

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("promotes a static body created with the flag", async () => {
    const renderer = await renderPhysics(
      <Subject motionType="static" mass={undefined} allowDynamicOrKinematic />,
      zeroG,
    );
    const api = ready();
    const { bodyInterface, Jolt } = getApi();

    api.setMotionType("dynamic");

    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Dynamic,
    );

    api.applyImpulse([2, 0, 0]);
    await step(renderer, 1);
    expect(velocity(api).x).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("moves a dynamic body to kinematic without any flag", async () => {
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();
    const { bodyInterface, Jolt } = getApi();

    api.setMotionType("kinematic");

    expect(bodyInterface.GetMotionType(api.body.GetID())).toBe(
      Jolt.EMotionType_Kinematic,
    );

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("imperative api allocation", () => {
  it("allocates no WASM memory across many calls", async () => {
    const module = await loadDebugModule();
    const renderer = await renderPhysics(<Subject />, zeroG);
    const api = ready();

    const call = () => {
      api.applyForce([1, 0, 0], [0, 0.1, 0]);
      api.applyTorque([0, 1, 0]);
      api.applyForceAndTorque([1, 0, 0], [0, 1, 0]);
      api.applyImpulse([0.01, 0, 0], [0, 0.1, 0]);
      api.applyAngularImpulse([0, 0.01, 0]);
      api.setVelocities([0, 0, 0], [0, 0, 0]);
      api.setPositionAndRotation([0, 0, 0], [0, 0, 0, 1], false);
      api.moveKinematic([0, 0, 0], [0, 0, 0, 1]);
      api.setGravityFactor(1);
      api.resetSleepTimer();
    };

    for (let i = 0; i < 20; i += 1) call();
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 200; i += 1) call();

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);

    await unmount(renderer);
    expectNoAsserts();
  });
});
