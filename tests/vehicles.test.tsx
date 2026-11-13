import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { useBox } from "@/Jolt/useBox";
import { useCylinder } from "@/Jolt/useCylinder";
import { useCar, type CarApi } from "@/Jolt/useCar";
import {
  useTank,
  type TankApi,
  type TankInput,
  type UseTankOptions,
} from "@/Jolt/useTank";
import {
  useMotorcycle,
  type MotorcycleApi,
  type MotorcycleInput,
  type UseMotorcycleOptions,
} from "@/Jolt/useMotorcycle";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { isSameState } from "@/Jolt/internal/snapshot";
import {
  expectNoAsserts,
  getApi,
  Refused,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const Ground = () => {
  useBox({
    stateId: 100,
    size: [1000, 1, 1000],
    position: [0, -0.5, 0],
    motionType: "static",
    material: { friction: 1 },
  });
  return null;
};

const STOPPED: TankInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
};

const held: { tank?: TankApi; bike?: MotorcycleApi; car?: CarApi } = {};

const hold = (update: Partial<typeof held>) => {
  Object.assign(held, update);
};

const Tank = ({
  input = STOPPED,
  ...overrides
}: Partial<UseTankOptions> & { input?: TankInput }) => {
  const [api] = useTank({
    stateId: 1,
    position: [0, 1.5, 0],
    vehicleSize: { length: 6.4, width: 3.4, height: 1 },
    wheelSettings: { radius: 0.3, width: 0.3, span: 5.7, offsetDown: 0.3 },
    ...overrides,
  });

  useEffect(() => {
    hold({ tank: api });
  }, [api]);

  useBeforePhysicsStep(function driveTank() {
    api?.update(input);
  });

  return null;
};

const IDLE: MotorcycleInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  modifier: true,
};

const Bike = ({
  input = IDLE,
  inputAt,
  ...overrides
}: Partial<UseMotorcycleOptions> & {
  input?: MotorcycleInput;
  inputAt?: (index: number) => MotorcycleInput;
}) => {
  const [api] = useMotorcycle({
    stateId: 1,
    position: [0, 1.2, 0],
    vehicleSize: { length: 0.8, width: 0.4, height: 0.6 },
    wheelSettings: {
      radius: 0.31,
      width: 0.05,
      offsetForward: 0.75,
      offsetDown: 0.27,
    },
    ...overrides,
  });

  useEffect(() => {
    hold({ bike: api });
  }, [api]);

  useBeforePhysicsStep(function driveBike(_, index) {
    api?.update(inputAt?.(index) ?? input);
  });

  return null;
};

const Car = () => {
  const [api] = useCar({
    stateId: 1,
    position: [0, 1.5, 0],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.35,
      width: 0.28,
      offsetForward: 1.4,
      offsetDown: 0.3,
    },
  });

  useEffect(() => {
    hold({ car: api });
  }, [api]);

  return null;
};

const tank = () => {
  if (!held.tank) throw new Error("tank not ready");
  return held.tank;
};

const bike = () => {
  if (!held.bike) throw new Error("bike not ready");
  return held.bike;
};

const WORLD_UP = new Vector3(0, 1, 0);
const bikeRotation = new Quaternion();
const bikeUp = new Vector3();
const bikeForward = new Vector3();
const bikeRight = new Vector3();

/** Sideways tilt, in degrees, positive leaning to the bike's right. */
const roll = () => {
  const rotation = bike().body.GetRotation();
  bikeRotation.set(
    rotation.GetX(),
    rotation.GetY(),
    rotation.GetZ(),
    rotation.GetW(),
  );
  bikeUp.copy(WORLD_UP).applyQuaternion(bikeRotation);
  bikeForward.set(0, 0, 1).applyQuaternion(bikeRotation);
  // A bike at identity faces +z, so its right is -x.
  bikeRight.crossVectors(bikeForward, WORLD_UP).normalize();
  return (Math.asin(bikeUp.dot(bikeRight)) * 180) / Math.PI;
};

const yawRate = (body: { GetAngularVelocity: () => { GetY: () => number } }) =>
  body.GetAngularVelocity().GetY();

const stateOf = (input: TankInput = STOPPED) => tank().update(input);

describe.each([
  ["useCar", <Car key="car" />],
  ["useTank", <Tank key="tank" />],
  ["useMotorcycle", <Bike key="bike" />],
])("%s teardown", (_, vehicle) => {
  it("takes its body and constraint with it, strict or not", async () => {
    for (const strict of [false, true]) {
      const renderer = await renderPhysics(
        <>
          <Ground />
          {vehicle}
        </>,
        { strict },
      );
      const { physicsSystem, constraints } = getApi();
      await step(renderer, 30);

      expect(physicsSystem.GetNumBodies()).toBe(2);
      expect(constraints.attached()).toHaveLength(1);
      expect(() => getApi().saveState()).not.toThrow();

      await unmount(renderer);
      expectNoAsserts();
    }
  });

  it("leaves the rest of the world running without it", async () => {
    const scene = (on: boolean) => (
      <>
        <Ground />
        {on ? vehicle : null}
      </>
    );
    const renderer = await renderPhysics(scene(true));
    await step(renderer, 30);
    await updatePhysics(renderer, scene(false));

    const { physicsSystem, constraints } = getApi();
    expect(physicsSystem.GetNumBodies()).toBe(1);
    expect(constraints.attached()).toHaveLength(0);

    await step(renderer, 30);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useTank", () => {
  it("has two tracks of the wheels asked for, rear wheel driven", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank />
      </>,
    );
    await step(renderer, 1);

    const state = stateOf();
    expect(state.wheels).toHaveLength(18);

    // Left is +x for a hull facing +z, and the first wheel of each is the front.
    expect(state.wheels[0].position.x).toBeGreaterThan(0);
    expect(state.wheels[0].position.z).toBeGreaterThan(state.wheels[8].position.z);
    expect(state.wheels[9].position.x).toBeLessThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("settles on its road wheels, ends clear of the ground", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank />
      </>,
    );
    await step(renderer, 180);

    const { constraint } = tank();
    expect(constraint.GetWheel(4).HasContact()).toBe(true);
    expect(constraint.GetWheel(13).HasContact()).toBe(true);
    expect(constraint.GetWheel(0).HasContact()).toBe(false);
    expect(constraint.GetWheel(8).HasContact()).toBe(false);
    expect(Math.abs(stateOf().position.x)).toBeLessThan(0.01);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("drives straight forwards", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank input={{ ...STOPPED, forward: true }} />
      </>,
    );
    await step(renderer, 300);

    const state = stateOf({ ...STOPPED, forward: true });
    expect(state.position.z).toBeGreaterThan(5);
    expect(Math.abs(state.position.x)).toBeLessThan(0.2);
    expect(tank().telemetry().rpm).toBeGreaterThan(500);
    expect(tank().telemetry().gear).toBeGreaterThanOrEqual(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("pulls away without spinning its tracks, at a long step too", async () => {
    const scene = (input: TankInput) => (
      <>
        <Ground />
        <Tank input={input} />
      </>
    );
    const renderer = await renderPhysics(scene(STOPPED), { timeStep: 1 / 30 });
    await step(renderer, 30, 1 / 30);
    await updatePhysics(renderer, scene({ ...STOPPED, forward: true }));

    let worstSlip = 0;
    for (let frame = 0; frame < 45; frame += 1) {
      await step(renderer, 1, 1 / 30);
      const { body, constraint } = tank();
      const trackSpeed = Math.abs(constraint.GetWheel(17).GetAngularVelocity()) * 0.3;
      worstSlip = Math.max(worstSlip, trackSpeed - body.GetLinearVelocity().Length());
    }
    expect(worstSlip).toBeLessThan(1.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("brakes before it reverses, then reverses", async () => {
    const backward = { ...STOPPED, backward: true };
    let goingBack = false;

    const Reverser = () => {
      const [api] = useTank({
        position: [0, 1.5, 0],
        vehicleSize: { length: 6.4, width: 3.4, height: 1 },
        wheelSettings: { radius: 0.3, width: 0.3, span: 5.7, offsetDown: 0.3 },
      });
      useEffect(() => {
        hold({ tank: api });
      }, [api]);
      useBeforePhysicsStep(function drive(_, index) {
        goingBack = index > 240;
        api?.update(goingBack ? backward : { ...STOPPED, forward: true });
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Reverser />
      </>,
    );
    await step(renderer, 240);
    const peak = tank().body.GetPosition().GetZ();
    expect(peak).toBeGreaterThan(3);

    await step(renderer, 600);
    expect(tank().body.GetPosition().GetZ()).toBeLessThan(peak);
    expect(tank().telemetry().gear).toBeLessThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it.each([
    ["left", 1],
    ["right", -1],
  ] as const)("spins %s on the spot", async (side, sign) => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank input={{ ...STOPPED, [side]: true }} />
      </>,
    );
    await step(renderer, 240);

    const state = stateOf({ ...STOPPED, [side]: true });
    expect(yawRate(tank().body) * sign).toBeGreaterThan(0.1);
    expect(Math.hypot(state.position.x, state.position.z)).toBeLessThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("curves when turning under power, towards the side asked", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank input={{ ...STOPPED, forward: true, left: true }} />
      </>,
    );
    await step(renderer, 90);

    const state = stateOf({ ...STOPPED, forward: true, left: true });
    expect(state.position.z).toBeGreaterThan(2);
    expect(state.position.x).toBeGreaterThan(0.2);
    expect(yawRate(tank().body)).toBeGreaterThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stops on the brake", async () => {
    const Braking = () => {
      const [api] = useTank({
        position: [0, 1.5, 0],
        vehicleSize: { length: 6.4, width: 3.4, height: 1 },
        wheelSettings: { radius: 0.3, width: 0.3, span: 5.7, offsetDown: 0.3 },
      });
      useEffect(() => {
        hold({ tank: api });
      }, [api]);
      useBeforePhysicsStep(function drive(_, index) {
        api?.update(
          index < 300
            ? { ...STOPPED, forward: true }
            : { ...STOPPED, brake: true },
        );
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Braking />
      </>,
    );
    await step(renderer, 300);
    expect(tank().body.GetLinearVelocity().Length()).toBeGreaterThan(1);

    await step(renderer, 180);
    expect(tank().body.GetLinearVelocity().Length()).toBeLessThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("gets its friction from combineFriction", async () => {
    const seen = new Set<string>();
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank
          input={{ ...STOPPED, forward: true }}
          combineFriction={(wheel, direction) => {
            seen.add(`${wheel} ${direction}`);
            return 0;
          }}
        />
      </>,
    );
    await step(renderer, 180);

    expect(seen.has("4 lateral")).toBe(true);
    expect(seen.has("13 longitudinal")).toBe(true);
    const { x, z } = stateOf({ ...STOPPED, forward: true }).velocity;
    expect(Math.hypot(x, z)).toBeLessThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("crosses a log it could not cross on a ray", async () => {
    const LOG_ROTATION = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const Log = () => {
      useCylinder({
        position: [0, 0.2, 6],
        rotation: [...LOG_ROTATION],
        radius: 0.2,
        height: 18,
        motionType: "static",
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Log />
        <Tank
          maxTorque={900}
          wheelSettings={{ radius: 0.3, width: 0.3, span: 5.7, offsetDown: 0.5 }}
          input={{ ...STOPPED, forward: true }}
        />
      </>,
    );
    await step(renderer, 480);
    expect(tank().body.GetPosition().GetZ()).toBeGreaterThan(12);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes each cast type", async () => {
    for (const castType of ["cylinder", "sphere", "ray"] as const) {
      const renderer = await renderPhysics(
        <>
          <Ground />
          <Tank castType={castType} input={{ ...STOPPED, forward: true }} />
        </>,
      );
      await step(renderer, 180);
      expect(stateOf({ ...STOPPED, forward: true }).position.z).toBeGreaterThan(1);
      await unmount(renderer);
      expectNoAsserts();
    }
  });

  it("refuses a track of one wheel, leaving no chassis behind", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const refusals: unknown[] = [];
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Refused onError={(refusal) => refusals.push(refusal)}>
          <Tank
            wheelSettings={{
              radius: 0.3,
              width: 0.3,
              span: 5,
              offsetDown: 0.3,
              count: 1,
            }}
          />
        </Refused>
      </>,
    );

    expect(String(refusals[0])).toContain("at least 2 wheels");
    expect(getApi().physicsSystem.GetNumBodies()).toBe(1);

    error.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("replays the same from a snapshot", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Tank input={{ ...STOPPED, forward: true, left: true }} />
      </>,
    );
    await step(renderer, 120);

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

const leanWarnings = (warn: { mock: { calls: unknown[][] } }) =>
  warn.mock.calls.filter(([message]) =>
    String(message).includes("lean.springDamping"),
  );

describe("useMotorcycle", () => {
  it("stands up on two wheels", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike />
      </>,
    );
    await step(renderer, 240);

    expect(bike().update(IDLE).wheels).toHaveLength(2);
    expect(Math.abs(roll())).toBeLessThan(1);
    expect(bike().constraint.GetWheel(0).HasContact()).toBe(true);
    expect(bike().constraint.GetWheel(1).HasContact()).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("drives on the rear wheel and goes through the gears", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike input={{ ...IDLE, forward: true }} />
      </>,
    );
    await step(renderer, 600);

    const state = bike().update({ ...IDLE, forward: true });
    expect(state.velocity.z).toBeGreaterThan(10);
    expect(bike().telemetry().gear).toBeGreaterThan(1);
    expect(Math.abs(roll())).toBeLessThan(2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leans into a turn, no further than maxAngle", async () => {
    const lean: number[] = [];
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike
          lean={{ maxAngle: 30 }}
          inputAt={(index) => ({
            ...IDLE,
            forward: true,
            right: index > 240,
          })}
        />
      </>,
    );
    await step(renderer, 240);
    expect(Math.abs(roll())).toBeLessThan(2);

    for (let frame = 0; frame < 120; frame += 1) {
      await step(renderer, 1);
      lean.push(roll());
    }

    expect(Math.max(...lean)).toBeGreaterThan(5);
    expect(Math.max(...lean)).toBeLessThan(35);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("settles upright again when the bars straighten", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike
          inputAt={(index) => ({
            ...IDLE,
            forward: index < 480,
            right: index > 240 && index < 360,
          })}
        />
      </>,
    );
    await step(renderer, 359);
    expect(Math.abs(roll())).toBeGreaterThan(5);

    await step(renderer, 300);
    expect(Math.abs(roll())).toBeLessThan(1.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("falls over without the lean controller", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike rotation={[0, 0, Math.sin(Math.PI / 72), Math.cos(Math.PI / 72)]} />
      </>,
    );
    await step(renderer, 1);
    bike().setLeanController(false);
    await step(renderer, 240);
    expect(Math.abs(roll())).toBeGreaterThan(30);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("turns the bars at steerRate, per step whatever calls update", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike steerRate={2} input={{ ...IDLE, forward: true, right: true }} />
      </>,
    );
    await step(renderer, 3);

    const { Jolt: jolt } = getApi();
    const controller = jolt.castObject(
      bike().constraint.GetController(),
      jolt.MotorcycleController,
    );
    const early = controller.GetRightInput();
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.25);

    await step(renderer, 60);
    expect(controller.GetRightInput()).toBeCloseTo(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("warns once of a step too long for the lean spring, which then throws it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike />
      </>,
      { timeStep: 1 / 30 },
    );
    await step(renderer, 90, 1 / 30);

    expect(leanWarnings(warn)).toHaveLength(1);
    expect(Math.abs(roll())).toBeGreaterThan(30);

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds at that step with the softer spring it suggests, and does not warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike lean={{ springConstant: 2500, springDamping: 500 }} />
      </>,
      { timeStep: 1 / 30 },
    );
    await step(renderer, 90, 1 / 30);

    expect(leanWarnings(warn)).toHaveLength(0);
    expect(Math.abs(roll())).toBeLessThan(2);

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("rides out the odd slow frame", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike />
      </>,
      { timeStep: "vary" },
    );
    await step(renderer, 60);
    for (let hitch = 0; hitch < 6; hitch += 1) {
      await step(renderer, 1, 1 / 20);
      await step(renderer, 30);
    }

    expect(leanWarnings(warn)).toHaveLength(1);
    expect(Math.abs(roll())).toBeLessThan(2);

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds the tire callbacks", async () => {
    const wheels = new Set<number>();
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike
          input={{ ...IDLE, forward: true }}
          tireGrip={(tire) => {
            wheels.add(tire.wheel);
            tire.longitudinalImpulse = 0;
            tire.lateralImpulse *= 1;
          }}
        />
      </>,
    );
    await step(renderer, 120);

    expect([...wheels].sort()).toEqual([0, 1]);
    expect(Math.abs(bike().update({ ...IDLE, forward: true }).velocity.z)).toBeLessThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("replays the same from a snapshot, bars and all", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Bike
          inputAt={(index) => ({
            ...IDLE,
            forward: true,
            left: index % 60 < 30,
            right: index % 60 >= 30,
          })}
        />
      </>,
    );
    await step(renderer, 140);

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
