import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useBox } from "@/Jolt/useBox";
import { useCar } from "@/Jolt/useCar";
import type { CarApi, UseCarOptions } from "@/Jolt/useCar";
import { isSameState } from "@/Jolt/internal/snapshot";
import type { CarInput } from "@/Jolt/useCar";
import type { TireContact } from "@/Jolt/internal/vehicle";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const held: { api?: CarApi } = {};

const setHeld = (api: CarApi | undefined) => {
  held.api = api;
};

let groundID = 0;

const Ground = () => {
  const [, ground] = useBox({
    stateId: 100,
    size: [800, 1, 800],
    position: [0, -0.5, 0],
    motionType: "static",
    material: { friction: 0.8 },
  });

  useEffect(() => {
    groundID = ground?.body.GetID().GetIndexAndSequenceNumber() ?? 0;
  }, [ground]);

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

const FULL_THROTTLE: CarInput = {
  forward: true,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  modifier: true,
};

const Driver = ({
  input = FULL_THROTTLE,
  ...overrides
}: Partial<UseCarOptions> & { input?: CarInput }) => {
  const [api] = useCar({
    stateId: 1,
    position: [0, 1.2, 0],
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

  useBeforePhysicsStep(function drive() {
    api?.update(input);
  });

  return null;
};

const car = () => {
  if (!held.api) throw new Error("car not ready");
  return held.api;
};

const drive = async (overrides: Parameters<typeof Driver>[0], frames: number) => {
  const renderer = await renderPhysics(
    <>
      <Ground />
      <Driver {...overrides} />
    </>,
  );
  await step(renderer, frames);
  return renderer;
};

const speed = () => car().update(FULL_THROTTLE).velocity.length();

const finalState = async (overrides: Parameters<typeof Driver>[0]) => {
  const renderer = await drive(overrides, 240);
  const bytes = getApi().saveState();
  const moved = speed();
  await unmount(renderer);
  expectNoAsserts();
  return { bytes, moved };
};

describe("useCar telemetry", () => {
  it("reads the drivetrain into one reused object", async () => {
    const renderer = await drive({}, 30);

    const first = car().telemetry();
    expect(car().telemetry()).toBe(first);
    expect(first.rpm).toBeGreaterThan(1000);
    expect(first.gear).toBeGreaterThanOrEqual(1);
    expect(first.ratio).toBeGreaterThan(1);
    expect(first.clutch).toBeGreaterThan(0);
    expect(first.clutch).toBeLessThanOrEqual(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("shifts up under power and reports reverse as a negative gear", async () => {
    const renderer = await drive({}, 600);
    expect(car().telemetry().gear).toBeGreaterThan(1);
    await unmount(renderer);

    const reversing = await drive(
      { input: { ...FULL_THROTTLE, forward: false, backward: true } },
      60,
    );
    expect(car().telemetry().gear).toBeLessThan(0);
    await unmount(reversing);
    expectNoAsserts();
  });
});

describe("useCar torqueCurve", () => {
  it("sets the engine's curve, in order whatever order it is given", async () => {
    const renderer = await drive(
      {
        torqueCurve: [
          [1, 0.25],
          [0, 0.5],
          [0.5, 1],
        ],
      },
      1,
    );

    const controller = getApi().Jolt.castObject(
      car().constraint.GetController(),
      getApi().Jolt.WheeledVehicleController,
    );
    const curve = controller.GetEngine().mNormalizedTorque;
    expect(curve.GetValue(0)).toBeCloseTo(0.5);
    expect(curve.GetValue(0.25)).toBeCloseTo(0.75);
    expect(curve.GetValue(0.5)).toBeCloseTo(1);
    expect(curve.GetValue(1)).toBeCloseTo(0.25);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("is what the engine pulls with", async () => {
    const strong = await finalState({ torqueCurve: [[0, 1]] });
    const weak = await finalState({ torqueCurve: [[0, 0.2]] });
    const none = await finalState({ torqueCurve: [[0, 0]] });

    // Jolt holds the engine at its minimum RPM through the clutch, so even no
    // torque creeps along in first gear, at 1000 RPM's worth of road speed.
    expect(none.moved).toBeLessThan(4.5);
    expect(none.moved).toBeGreaterThan(3);
    expect(weak.moved).toBeGreaterThan(none.moved * 1.2);
    expect(strong.moved).toBeGreaterThan(weak.moved * 1.5);
  });

  it("warns about an empty curve", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await drive({ torqueCurve: [] }, 1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("torqueCurve is empty"));
    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves the default alone without one", async () => {
    const renderer = await drive({}, 1);
    const controller = getApi().Jolt.castObject(
      car().constraint.GetController(),
      getApi().Jolt.WheeledVehicleController,
    );
    expect(controller.GetEngine().mNormalizedTorque.GetValue(0.66)).toBeCloseTo(1);
    expect(controller.GetEngine().mNormalizedTorque.GetValue(0)).toBeCloseTo(0.8);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useCar tireGrip", () => {
  it("changes nothing when it changes nothing", async () => {
    const plain = await finalState({});
    let calls = 0;
    const watched = await finalState({
      tireGrip: () => {
        calls += 1;
      },
    });

    expect(calls).toBeGreaterThan(0);
    expect(isSameState(plain.bytes, watched.bytes)).toBe(true);
  });

  it("reports each grounded tire, and the body it is on", async () => {
    const seen = new Map<number, TireContact>();
    const bodies = new Set<number>();
    let mostLateral = 0;
    const renderer = await drive(
      {
        input: { ...FULL_THROTTLE, right: true },
        tireGrip: (tire) => {
          seen.set(tire.wheel, { ...tire });
          bodies.add(tire.bodyID);
          mostLateral = Math.max(mostLateral, tire.lateralFriction);
        },
      },
      120,
    );

    expect([...seen.keys()].sort()).toEqual([0, 1, 2, 3]);
    expect([...bodies]).toEqual([
      groundID,
    ]);
    expect(mostLateral).toBeGreaterThan(0);

    const front = seen.get(0) as TireContact;
    expect(front.suspensionImpulse).toBeGreaterThan(0);
    expect(front.longitudinalFriction).toBeGreaterThan(0);
    expect(front.deltaTime).toBeCloseTo(1 / 60);
    expect(front.longitudinalImpulse).toBeCloseTo(
      front.longitudinalFriction * front.suspensionImpulse,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("is not called for a wheel in the air", async () => {
    let calls = 0;
    const renderer = await renderPhysics(
      <Driver
        position={[0, 40, 0]}
        tireGrip={() => {
          calls += 1;
        }}
      />,
    );
    await step(renderer, 30);
    expect(calls).toBe(0);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes the grip away: the wheels spin and the car stays", async () => {
    const renderer = await drive(
      {
        tireGrip: (tire) => {
          tire.longitudinalImpulse = 0;
          tire.lateralImpulse = 0;
        },
      },
      120,
    );

    const state = car().update(FULL_THROTTLE);
    expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeLessThan(0.1);
    expect(car().constraint.GetWheel(2).GetAngularVelocity()).toBeGreaterThan(5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("follows the newest render's function", async () => {
    let oldCalls = 0;
    let newCalls = 0;
    const scene = (tireGrip: UseCarOptions["tireGrip"]) => (
      <>
        <Ground />
        <Driver tireGrip={tireGrip} />
      </>
    );
    const renderer = await renderPhysics(
      scene(() => {
        oldCalls += 1;
      }),
    );
    await step(renderer, 60);
    await updatePhysics(
      renderer,
      scene(() => {
        newCalls += 1;
      }),
    );
    const before = oldCalls;
    await step(renderer, 60);
    expect(before).toBeGreaterThan(0);
    expect(oldCalls).toBe(before);
    expect(newCalls).toBeGreaterThan(0);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useCar combineFriction", () => {
  // Jolt combines in float, where this is exact: see defaultCombinedFriction.
  const joltsRule: NonNullable<UseCarOptions["combineFriction"]> = (
    _wheel,
    _direction,
    friction,
    body,
  ) => Math.sqrt(Math.fround(friction * body.GetFriction()));

  it("matches Jolt's own rule to the bit", async () => {
    const plain = await finalState({});
    const combined = await finalState({ combineFriction: joltsRule });
    expect(isSameState(plain.bytes, combined.bytes)).toBe(true);
  });

  it("asks once per direction, per wheel, with the body underneath", async () => {
    const asked = new Set<string>();
    let friction = 0;
    const renderer = await drive(
      {
        combineFriction: (wheel, direction, tireFriction, body) => {
          asked.add(`${wheel} ${direction}`);
          friction = body.GetFriction();
          return tireFriction;
        },
      },
      60,
    );

    expect(asked.size).toBe(8);
    expect(asked.has("3 lateral")).toBe(true);
    expect(asked.has("0 longitudinal")).toBe(true);
    expect(friction).toBeCloseTo(0.8);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("decides the grip: zero friction leaves the car where it is", async () => {
    const stuck = await finalState({ combineFriction: () => 0 });
    expect(stuck.moved).toBeLessThan(0.1);
  });

  it("composes with tireGrip", async () => {
    let grips = 0;
    let combines = 0;
    const both = await finalState({
      tireGrip: () => {
        grips += 1;
      },
      combineFriction: (wheel, direction, friction, body) => {
        combines += 1;
        return joltsRule(wheel, direction, friction, body);
      },
    });
    const plain = await finalState({});

    expect(grips).toBeGreaterThan(0);
    expect(combines).toBeGreaterThan(0);
    expect(isSameState(plain.bytes, both.bytes)).toBe(true);
  });
});

describe("useCar in a snapshot", () => {
  it("replays the same with its callbacks and curve", async () => {
    const renderer = await drive(
      {
        torqueCurve: [
          [0, 0.5],
          [1, 1],
        ],
        tireGrip: (tire) => {
          tire.lateralImpulse *= 0.5;
        },
        combineFriction: (_wheel, direction, friction) =>
          direction === "lateral" ? friction * 0.7 : friction,
      },
      120,
    );

    const saved = getApi().saveState();
    await step(renderer, 90);
    const first = getApi().saveState();

    getApi().restoreState(saved);
    await step(renderer, 90);
    expect(isSameState(first, getApi().saveState())).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });
});
