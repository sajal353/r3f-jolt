import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { useBox } from "@/Jolt/useBox";
import { useCar } from "@/Jolt/useCar";
import type { CarApi, UseCarOptions } from "@/Jolt/useCar";
import { expectNoAsserts, getApi, renderPhysics, unmount } from "./harness";

const held: { api?: CarApi } = {};

const setHeld = (api: CarApi | undefined) => {
  held.api = api;
};

const Ground = () => {
  useBox({ size: [80, 1, 80], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const Vehicle = (overrides: Partial<UseCarOptions>) => {
  const [api] = useCar({
    position: [0, 2, 0],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.35,
      width: 0.28,
      offsetForward: 1.4,
      offsetDown: 0.3,
    },
    ...overrides,
  });

  useEffect(() => {
    setHeld(api);
  }, [api]);

  return null;
};

// GetWheel returns the Wheel base class, whose GetSettings is typed as the
// base WheelSettings; the brake torques live on the WV subclass.
const wheelTorques = () => {
  const api = held.api;
  if (!api) throw new Error("car not ready");

  return [0, 1, 2, 3].map((index) => {
    const wheel = getApi().Jolt.castObject(
      api.constraint.GetWheel(index),
      getApi().Jolt.WheelWV,
    );
    const settings = wheel.GetSettings();
    return {
      brake: settings.mMaxBrakeTorque,
      handBrake: settings.mMaxHandBrakeTorque,
    };
  });
};

describe("useCar braking", () => {
  it("applies the handbrake to the rear axle only", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Vehicle />
      </>,
    );

    const [fl, fr, bl, br] = wheelTorques();

    expect(fl.handBrake).toBe(0);
    expect(fr.handBrake).toBe(0);
    expect(bl.handBrake).toBeGreaterThan(0);
    expect(br.handBrake).toBe(bl.handBrake);
    expect(bl.handBrake + br.handBrake).toBeCloseTo(8000, 5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("splits the service brake 80/20 front to rear by default", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Vehicle />
      </>,
    );

    const [fl, fr, bl, br] = wheelTorques();
    const front = fl.brake + fr.brake;
    const rear = bl.brake + br.brake;

    expect(front + rear).toBeCloseTo(6000, 5);
    expect(front / (front + rear)).toBeCloseTo(0.8, 5);
    expect(fl.brake).toBe(fr.brake);
    expect(bl.brake).toBe(br.brake);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("honours a custom bias and totals", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Vehicle brakeTorque={4000} brakeBias={0.5} handBrakeTorque={2000} />
      </>,
    );

    const [fl, , bl] = wheelTorques();

    expect(fl.brake).toBeCloseTo(1000, 5);
    expect(bl.brake).toBeCloseTo(1000, 5);
    expect(bl.handBrake).toBeCloseTo(1000, 5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps braking independent of driveType", async () => {
    for (const driveType of ["rwd", "fwd", "awd"] as const) {
      const renderer = await renderPhysics(
        <>
          <Ground />
          <Vehicle driveType={driveType} />
        </>,
      );

      const [fl, , bl] = wheelTorques();

      expect(fl.brake).toBeCloseTo(2400, 5);
      expect(bl.brake).toBeCloseTo(600, 5);
      expect(fl.handBrake).toBe(0);
      expect(bl.handBrake).toBeCloseTo(4000, 5);

      await unmount(renderer);
      expectNoAsserts();
    }
  });
});
