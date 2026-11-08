import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Line, Quaternion, Vector3, type Object3D } from "three";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useHingeConstraint, type HingeConstraintApi } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint, type SliderConstraintApi } from "@/Jolt/useSliderConstraint";
import {
  usePathConstraint,
  type PathConstraintApi,
  type UsePathConstraintOptions,
} from "@/Jolt/usePathConstraint";
import { samplePath, type PathPoint } from "@/Jolt/internal/constraintPath";
import { useGearConstraint, type GearConstraintApi } from "@/Jolt/useGearConstraint";
import { useRackAndPinionConstraint } from "@/Jolt/useRackAndPinionConstraint";
import {
  usePulleyConstraint,
  type PulleyConstraintApi,
  type UsePulleyConstraintOptions,
} from "@/Jolt/usePulleyConstraint";
import { useRollback, type RollbackApi } from "@/Jolt/useRollback";
import { PhysicsDebug } from "@/Jolt/PhysicsDebug";
import { useThree } from "@react-three/fiber";
import { isSameState } from "@/Jolt/internal/snapshot";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const STEP = 1 / 60;
const fixed = { updateLoop: "independent", timeStep: STEP } as const;

const held: {
  cart?: BodyApi<Jolt.Shape>;
  path?: PathConstraintApi;
  gear?: GearConstraintApi;
  hinge1?: HingeConstraintApi;
  hinge2?: HingeConstraintApi;
  wheel1?: BodyApi<Jolt.Shape>;
  wheel2?: BodyApi<Jolt.Shape>;
  rackBody?: BodyApi<Jolt.Shape>;
  slider?: SliderConstraintApi;
  pulley?: PulleyConstraintApi;
  left?: BodyApi<Jolt.Shape>;
  right?: BodyApi<Jolt.Shape>;
  rollback?: RollbackApi;
} = {};

const usePublish = <K extends keyof typeof held>(
  key: K,
  value: (typeof held)[K],
) => {
  useEffect(() => {
    held[key] = value;
  }, [key, value]);
};

const need = <K extends keyof typeof held>(key: K) => {
  const value = held[key];
  if (!value) throw new Error(`${key} was never published`);
  return value as NonNullable<(typeof held)[K]>;
};

const run = (steps: number) => {
  const api = getApi();
  for (let step = 0; step < steps; step += 1) api.step();
};

const position = (body: BodyApi<Jolt.Shape>) => {
  const at = body.body.GetPosition();
  return new Vector3(at.GetX(), at.GetY(), at.GetZ());
};

const Cart = ({
  options,
  start = [0, 0, 0],
  stateId,
}: {
  options: UsePathConstraintOptions;
  start?: Vec3Tuple;
  stateId?: number;
}) => {
  const [, cart] = useBox({
    stateId,
    size: [0.6, 0.4, 0.6],
    position: start,
    motionType: "dynamic",
    mass: 20,
    linearDamping: 0,
    angularDamping: 0,
    allowSleeping: false,
  });
  const [path] = usePathConstraint(null, cart, options);

  usePublish("cart", cart);
  usePublish("path", path);
  return null;
};

/** A straight line along X, ten metres in five spans. */
const LINE: PathPoint[] = [0, 2, 4, 6, 8, 10].map((x) => ({
  position: [x, 5, 0],
}));

/** A flat ring of radius 5 in the XZ plane, walked by rising fraction. */
const RING: PathPoint[] = Array.from({ length: 8 }, (_, index) => {
  const angle = (index / 8) * Math.PI * 2;
  return { position: [5 * Math.cos(angle), 5, 5 * Math.sin(angle)] };
});

beforeEach(() => {
  for (const key of Object.keys(held)) delete held[key as keyof typeof held];
});

describe("usePathConstraint", () => {
  it("keeps a falling body on a curve and lets it run down", async () => {
    const dip: PathPoint[] = [
      { position: [-6, 6, 0] },
      { position: [-3, 2, 0] },
      { position: [0, 1, 0] },
      { position: [3, 2, 0] },
      { position: [6, 6, 0] },
    ];
    const line = samplePath({ points: dip }, 64);
    const renderer = await renderPhysics(
      <Cart options={{ points: dip }} start={[-6, 6, 0]} />,
      fixed,
    );

    let furthest = 0;
    let worst = 0;
    for (let step = 0; step < 240; step += 1) {
      run(1);
      const at = position(need("cart"));
      worst = Math.max(worst, Math.min(...line.map((point) => point.distanceTo(at))));
      furthest = Math.max(furthest, need("path").getPathFraction());
    }

    // Gravity carries it through the dip and most of the way up the far side.
    expect(furthest).toBeGreaterThan(2.5);
    expect(worst).toBeLessThan(0.15);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a velocity motor travels at its speed in metres per second", async () => {
    const renderer = await renderPhysics(
      <Cart
        options={{
          points: LINE,
          motor: { state: "velocity", targetVelocity: 3 },
        }}
        start={[0, 5, 0]}
      />,
      fixed,
    );

    run(60);
    const start = position(need("cart")).x;
    run(60);
    expect(position(need("cart")).x - start).toBeCloseTo(3, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a position motor drives to a fraction and holds", async () => {
    const renderer = await renderPhysics(
      <Cart
        options={{
          points: LINE,
          motor: {
            state: "position",
            targetFraction: 3,
            spring: { frequency: 2, damping: 1 },
          },
        }}
        start={[0, 5, 0]}
      />,
      fixed,
    );

    run(600);
    expect(need("path").getPathFraction()).toBeCloseTo(3, 1);
    expect(position(need("cart")).x).toBeCloseTo(6, 0);

    need("path").setTargetFraction(1);
    run(600);
    expect(need("path").getPathFraction()).toBeCloseTo(1, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stops at the ends of an open path", async () => {
    const renderer = await renderPhysics(
      <Cart
        options={{
          points: LINE,
          motor: { state: "velocity", targetVelocity: 8 },
        }}
        start={[0, 5, 0]}
      />,
      fixed,
    );

    run(240);
    expect(need("path").getPathFraction()).toBe(5);
    expect(position(need("cart")).x).toBeCloseTo(10, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stops at the start of one too, driven backwards", async () => {
    const renderer = await renderPhysics(
      <Cart
        options={{
          points: LINE,
          pathFraction: 2,
          motor: { state: "velocity", targetVelocity: -8 },
        }}
        start={[4, 5, 0]}
      />,
      fixed,
    );

    run(120);
    expect(need("path").getPathFraction()).toBe(0);
    expect(position(need("cart")).x).toBeCloseTo(0, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("goes round a loop, past fraction zero, without a seam", async () => {
    const renderer = await renderPhysics(
      <Cart
        options={{
          points: RING,
          looping: true,
          motor: { state: "velocity", targetVelocity: 6 },
        }}
        start={[5, 5, 0]}
      />,
      { ...fixed, gravity: [0, 0, 0] },
    );

    let wraps = 0;
    let last = 0;
    for (let step = 0; step < 600; step += 1) {
      run(1);
      const fraction = need("path").getPathFraction();
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThan(8);
      if (fraction < last - 4) wraps += 1;
      last = fraction;

      const at = position(need("cart"));
      expect(Math.hypot(at.x, at.z)).toBeCloseTo(5, 0);
    }

    // Ten seconds at 6 m/s round a ring of about 31 m is nearly two laps.
    expect(wraps).toBe(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stays on its own track where a path crosses itself", async () => {
    // A figure eight, flat, crossing itself at the origin at fraction 2 and 6.
    const eight: PathPoint[] = Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2 + Math.PI / 2;
      return {
        position: [6 * Math.cos(angle), 5, 3 * Math.sin(2 * angle)],
      };
    });

    const renderer = await renderPhysics(
      <Cart
        options={{
          points: eight,
          looping: true,
          motor: { state: "velocity", targetVelocity: 5 },
        }}
        start={[0, 5, 0]}
      />,
      { ...fixed, gravity: [0, 0, 0] },
    );

    let last = 0;
    let biggestJump = 0;
    for (let step = 0; step < 900; step += 1) {
      run(1);
      const fraction = need("path").getPathFraction();
      const moved = Math.abs(fraction - last);
      biggestJump = Math.max(biggestJump, Math.min(moved, 8 - moved));
      last = fraction;
    }

    expect(biggestJump).toBeLessThan(0.3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it('"path" turns the body with the path, "fixed" keeps it as it was', async () => {
    const heading = (body: BodyApi<Jolt.Shape>) => {
      const turn = body.body.GetRotation();
      return new Vector3(1, 0, 0).applyQuaternion(
        new Quaternion(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW()),
      );
    };

    const ride = async (rotation: "path" | "fixed") => {
      const renderer = await renderPhysics(
        <Cart
          options={{
            points: RING,
            looping: true,
            rotation,
            pathFraction: 0,
            motor: { state: "velocity", targetVelocity: 6 },
          }}
          start={[5, 5, 0]}
        />,
        { ...fixed, gravity: [0, 0, 0] },
      );

      run(60);
      const result = heading(need("cart"));
      await unmount(renderer);
      expectNoAsserts();
      return result;
    };

    expect(new Vector3(1, 0, 0).angleTo(await ride("fixed"))).toBeLessThan(0.02);
    // A second at 6 m/s is a fifth of the ring: 70 degrees, a little over 1 rad.
    expect(new Vector3(1, 0, 0).angleTo(await ride("path"))).toBeGreaterThan(0.9);
  });

  it("carries the path on a moving body 1", async () => {
    const Truck = () => {
      const [, truck] = useBox({
        size: [4, 1, 2],
        position: [0, 1, 0],
        motionType: "kinematic",
      });
      const [, cart] = useBox({
        size: [0.5, 0.5, 0.5],
        position: [-1, 2, 0],
        motionType: "dynamic",
        mass: 5,
      });
      usePublish("cart", cart);
      usePublish("left", truck);
      const [path] = usePathConstraint(truck, cart, {
        points: [{ position: [-1, 1, 0] }, { position: [1, 1, 0] }],
        pathFraction: 0,
        rotation: "fixed",
      });
      usePublish("path", path);
      return null;
    };

    const renderer = await renderPhysics(<Truck />, fixed);
    const truck = need("left");

    for (let step = 0; step < 120; step += 1) {
      truck.moveKinematic([step * 0.05, 1, 0], [0, 0, 0, 1], STEP);
      run(1);
    }

    const offset = position(need("cart")).sub(position(truck));
    expect(offset.y).toBeCloseTo(1, 1);
    expect(position(truck).x).toBeGreaterThan(5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("offsets the path from body 1 by pathPosition and pathRotation", async () => {
    const quarter = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)
      .toArray() as [number, number, number, number];

    const renderer = await renderPhysics(
      <Cart
        options={{
          points: [{ position: [0, 0, 0] }, { position: [10, 0, 0] }],
          pathPosition: [2, 3, 1],
          pathRotation: quarter,
          motor: { state: "velocity", targetVelocity: 2 },
        }}
        start={[2, 3, 1]}
      />,
      { ...fixed, gravity: [0, 0, 0] },
    );

    run(60);
    const at = position(need("cart"));
    // A quarter turn about Y takes the path's +X to world +Z.
    expect(at.z).toBeCloseTo(3, 1);
    expect(at.x).toBeCloseTo(2, 1);
    expect(at.y).toBeCloseTo(3, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes a path computed in JS", async () => {
    const at = vi.fn((fraction: number, out: { position: Vector3; tangent: Vector3; normal: Vector3 }) => {
      out.position.set(fraction * 10, 5, 0);
      out.tangent.set(1, 0, 0);
      out.normal.set(0, 1, 0);
    });

    const renderer = await renderPhysics(
      <Cart
        options={{
          path: { maxFraction: 1, at },
          motor: { state: "velocity", targetVelocity: 5 },
        }}
        start={[0, 5, 0]}
      />,
      fixed,
    );

    run(60);
    expect(at).toHaveBeenCalled();
    expect(need("path").getPathFraction()).toBeCloseTo(0.5, 1);
    expect(position(need("cart")).x).toBeCloseTo(5, 0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("uses a custom path's own search when it has one", async () => {
    const closest = vi.fn((point: Vector3) => Math.min(Math.max(point.x / 10, 0), 1));

    const renderer = await renderPhysics(
      <Cart
        options={{
          path: {
            maxFraction: 1,
            at: (fraction, out) => {
              out.position.set(fraction * 10, 5, 0);
              out.tangent.set(1, 0, 0);
              out.normal.set(0, 1, 0);
            },
            closest,
          },
          motor: { state: "velocity", targetVelocity: 5 },
        }}
        start={[0, 5, 0]}
      />,
      fixed,
    );

    run(30);
    expect(closest).toHaveBeenCalled();
    expect(position(need("cart")).x).toBeCloseTo(2.5, 0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a path Jolt could not follow, saying why", async () => {
    const mount = (options: UsePathConstraintOptions) =>
      renderPhysics(<Cart options={options} />, fixed);

    await expect(
      mount({ points: [{ position: [0, 0, 0] }] }),
    ).rejects.toThrow("at least 2 points");
    await expect(mount({})).rejects.toThrow("`points` or `path`");
    await expect(
      mount({
        looping: true,
        points: [
          { position: [0, 0, 0] },
          { position: [4, 0, 0] },
          { position: [0, 0, 0] },
        ],
      }),
    ).rejects.toThrow("repeated point");
    await expect(
      mount({
        points: [
          { position: [0, 0, 0], normal: [1, 0, 0] },
          { position: [4, 0, 0], normal: [1, 0, 0] },
        ],
      }),
    ).rejects.toThrow("near fraction 0.00");
  });

  it("defaults a sensible normal on a path running straight up", async () => {
    const renderer = await renderPhysics(
      <Cart
        options={{
          points: [{ position: [0, 0, 0] }, { position: [0, 8, 0] }],
          motor: { state: "velocity", targetVelocity: 2 },
        }}
      />,
      fixed,
    );

    run(60);
    expect(position(need("cart")).y).toBeCloseTo(2, 0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("warns that a path joint cannot break", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const renderer = await renderPhysics(
      <Cart options={{ points: LINE, breakForce: 10 }} start={[0, 5, 0]} />,
      fixed,
    );
    run(1);

    expect(warn.mock.calls.join()).toContain("breakForce / breakTorque ignored");

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("draws its path under debug, and PhysicsDebug draws the joint", async () => {
    const scenes: Object3D[] = [];
    const Spy = () => {
      const scene = useThree((state) => state.scene);
      useEffect(() => {
        scenes.push(scene);
      }, [scene]);
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <PhysicsDebug />
        <Cart options={{ points: LINE, debug: true }} start={[0, 5, 0]} />
        <Spy />
      </>,
      fixed,
    );

    await step(renderer, 2);
    const drawn = scenes[0].children.filter(
      (child): child is Line => child.constructor === Line,
    );

    expect(drawn).toHaveLength(1);
    expect(drawn[0].geometry.getAttribute("position").count).toBeGreaterThan(5);

    await unmount(renderer);
    expect(scenes[0].children.some((child) => child.constructor === Line)).toBe(false);
    expectNoAsserts();
  });

  it("draws gear, rack and pulley joints without Jolt complaining", async () => {
    const renderer = await renderPhysics(
      <>
        <PhysicsDebug />
        <GearTrain />
        <RackAndPinion />
        <Rope />
      </>,
      fixed,
    );

    await step(renderer, 3);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("samplePath", () => {
  it("goes through the points, and round a loop back to the start", () => {
    const open = samplePath({ points: LINE }, 4);
    expect(open[0].x).toBe(0);
    expect(open[open.length - 1].x).toBe(10);
    expect(open).toHaveLength(21);

    const loop = samplePath({ points: RING, looping: true }, 4);
    expect(loop[0].distanceTo(loop[loop.length - 1])).toBeCloseTo(0, 5);
  });

  it("matches Jolt's Hermite formula at a knot's mid-span", () => {
    const [, middle] = samplePath(
      {
        points: [
          { position: [0, 0, 0], tangent: [4, 0, 0], normal: [0, 1, 0] },
          { position: [4, 0, 0], tangent: [0, 0, 4], normal: [0, 1, 0] },
        ],
      },
      2,
    );

    // h00 p0 + h10 m0 + h01 p1 + h11 m1 at t = ½.
    expect(middle.x).toBeCloseTo(0.5 * 4 + 0.125 * 4, 5);
    expect(middle.z).toBeCloseTo(-0.125 * 4, 5);
  });
});

const AXLE = {
  hingeAxis: [0, 0, 1] as Vec3Tuple,
  normalAxis: [1, 0, 0] as Vec3Tuple,
};

/** Apart from each other, since it is the joint that links them here. */
const GearTrain = ({
  corrected = true,
  stateIds = false,
  teeth = [10, 30],
}: {
  corrected?: boolean;
  stateIds?: boolean;
  teeth?: [number, number];
}) => {
  const [, first] = useBox({
    stateId: stateIds ? 1 : undefined,
    size: [1, 1, 0.3],
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: 10,
    allowSleeping: false,
  });
  const [, second] = useBox({
    stateId: stateIds ? 2 : undefined,
    size: [2, 2, 0.3],
    position: [4, 4, 0],
    motionType: "dynamic",
    mass: 30,
    allowSleeping: false,
  });

  const [hinge1] = useHingeConstraint(null, first, {
    ...AXLE,
    stateId: stateIds ? 1 : undefined,
    point: [0, 4, 0],
    motor: { state: "velocity", targetAngularVelocity: 6 },
  });
  const [hinge2] = useHingeConstraint(null, second, {
    ...AXLE,
    stateId: stateIds ? 2 : undefined,
    point: [4, 4, 0],
  });
  const [gear] = useGearConstraint(first, second, {
    stateId: stateIds ? 3 : undefined,
    hingeAxis: [0, 0, 1],
    teeth,
    hinges: corrected ? [hinge1, hinge2] : undefined,
  });

  usePublish("wheel1", first);
  usePublish("wheel2", second);
  usePublish("hinge1", hinge1);
  usePublish("hinge2", hinge2);
  usePublish("gear", gear);
  return null;
};

/** How far two gears on a 1:3 train are out of step, in radians either way. */
const gearError = () => {
  const error =
    need("hinge1").getCurrentAngle() + 3 * need("hinge2").getCurrentAngle();
  return Math.atan2(Math.sin(error), Math.cos(error));
};

describe("useGearConstraint", () => {
  it("drives one wheel from the other at the teeth's ratio, the other way", async () => {
    const renderer = await renderPhysics(<GearTrain />, {
      ...fixed,
      gravity: [0, 0, 0],
    });

    // Well inside one turn: a hinge reads its angle wrapped to ±π.
    run(20);
    const angle1 = need("hinge1").getCurrentAngle();
    const angle2 = need("hinge2").getCurrentAngle();

    expect(Math.abs(angle1)).toBeGreaterThan(1);
    // Ten teeth against thirty: gear1 = -3 × gear2.
    expect(angle1 / angle2).toBeCloseTo(-3, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("the hinges bring two wheels back into step, which speeds alone cannot", async () => {
    const slipAfter = async (corrected: boolean) => {
      const renderer = await renderPhysics(<GearTrain corrected={corrected} />, {
        ...fixed,
        gravity: [0, 0, 0],
      });

      run(30);
      // Knock the second wheel out of step, as drift would over a long run.
      const turn = need("wheel2").body.GetRotation();
      const nudged = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 0, 1), 0.2)
        .multiply(new Quaternion(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW()));
      need("wheel2").setPositionAndRotation(
        [4, 4, 0],
        nudged.toArray() as [number, number, number, number],
      );
      run(1);
      const knocked = Math.abs(gearError());
      run(120);
      const settled = Math.abs(gearError());

      await unmount(renderer);
      expectNoAsserts();
      return { knocked, settled };
    };

    const free = await slipAfter(false);
    const tied = await slipAfter(true);

    expect(free.knocked).toBeGreaterThan(0.3);
    expect(free.settled).toBeGreaterThan(0.3);
    expect(tied.settled).toBeLessThan(0.01);
  });

  describe("over many turns", () => {
    /** The most either wheel turned in one step, over ten seconds at 6 rad/s. */
    const biggestStep = async (teeth: [number, number]) => {
      const renderer = await renderPhysics(<GearTrain teeth={teeth} />, {
        ...fixed,
        gravity: [0, 0, 0],
      });
      const turn = (name: "wheel1" | "wheel2") => {
        const at = need(name).body.GetRotation();
        return new Quaternion(at.GetX(), at.GetY(), at.GetZ(), at.GetW());
      };

      run(30);
      let last = [turn("wheel1"), turn("wheel2")];
      let biggest = 0;
      for (let index = 0; index < 600; index += 1) {
        run(1);
        const now = [turn("wheel1"), turn("wheel2")];
        biggest = Math.max(
          biggest,
          last[0].angleTo(now[0]),
          last[1].angleTo(now[1]),
        );
        last = now;
      }

      await unmount(renderer);
      expectNoAsserts();
      return biggest;
    };

    // 6 rad/s is 0.1 rad a step for the driven wheel, 0.3 for a partner at 3:1.
    it("a whole ratio turns smoothly", async () => {
      expect(await biggestStep([10, 30])).toBeLessThan(0.15);
    });

    it("so does its inverse, which Jolt's correction would snap", async () => {
      expect(await biggestStep([30, 10])).toBeLessThan(0.45);
    });

    it("and one whole neither way, with a warning that hinges are ignored", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(await biggestStep([20, 30])).toBeLessThan(0.2);
      expect(warn.mock.calls.join()).toContain("hinges ignored");

      warn.mockRestore();
    });

    it("gives no warning for a whole ratio either way round", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await biggestStep([30, 10]);
      expect(warn.mock.calls.join()).not.toContain("hinges ignored");

      warn.mockRestore();
    });
  });

  it("still corrects drift, the same way round, when given to Jolt swapped", async () => {
    const renderer = await renderPhysics(<GearTrain teeth={[30, 10]} />, {
      ...fixed,
      gravity: [0, 0, 0],
    });

    // Gear 2 turns 3 times per turn of gear 1, the other way.
    expect(need("gear").body1).toBe(need("wheel1").body);
    expect(need("gear").body2).toBe(need("wheel2").body);

    const error = () => {
      const sum =
        3 * need("hinge1").getCurrentAngle() + need("hinge2").getCurrentAngle();
      return Math.abs(Math.atan2(Math.sin(sum), Math.cos(sum)));
    };

    run(120);
    expect(error()).toBeLessThan(0.01);

    const turn = need("wheel2").body.GetRotation();
    const nudged = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 0, 1), 0.3)
      .multiply(new Quaternion(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW()));
    need("wheel2").setPositionAndRotation(
      [4, 4, 0],
      nudged.toArray() as [number, number, number, number],
    );
    run(120);
    expect(error()).toBeLessThan(0.01);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes a plain ratio", async () => {
    const Ratio = () => {
      const [, a] = useBox({
        size: [1, 1, 1],
        position: [0, 4, 0],
        motionType: "dynamic",
        allowSleeping: false,
      });
      const [, b] = useBox({
        size: [1, 1, 1],
        position: [4, 4, 0],
        motionType: "dynamic",
        allowSleeping: false,
      });
      const pin = { hingeAxis: [0, 0, 1] as Vec3Tuple, normalAxis: [1, 0, 0] as Vec3Tuple };
      const [h1] = useHingeConstraint(null, a, {
        ...pin,
        point: [0, 4, 0],
        motor: { state: "velocity", targetAngularVelocity: 2 },
      });
      const [h2] = useHingeConstraint(null, b, { ...pin, point: [4, 4, 0] });
      useGearConstraint(a, b, { hingeAxis: [0, 0, 1], ratio: 2, hinges: [h1, h2] });
      usePublish("hinge1", h1);
      usePublish("hinge2", h2);
      return null;
    };

    const renderer = await renderPhysics(<Ratio />, { ...fixed, gravity: [0, 0, 0] });
    run(30);
    expect(need("hinge1").getCurrentAngle() / need("hinge2").getCurrentAngle()).toBeCloseTo(-2, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("breaks on torque, and reads none as force", async () => {
    const broke = vi.fn();

    const Jam = () => {
      const [, a] = useBox({
        size: [1, 1, 1],
        position: [0, 4, 0],
        motionType: "dynamic",
        allowSleeping: false,
      });
      const [, b] = useBox({
        size: [1, 1, 1],
        position: [4, 4, 0],
        motionType: "dynamic",
        allowSleeping: false,
      });
      const pin = { hingeAxis: [0, 0, 1] as Vec3Tuple, normalAxis: [1, 0, 0] as Vec3Tuple };
      // Driven hard one way, and held against it on the other wheel.
      useHingeConstraint(null, a, {
        ...pin,
        point: [0, 4, 0],
        motor: { state: "velocity", targetAngularVelocity: 8, maxTorqueLimit: 5000 },
      });
      useHingeConstraint(null, b, {
        ...pin,
        point: [4, 4, 0],
        limits: { min: -0.2, max: 0.2 },
      });
      const [gear] = useGearConstraint(a, b, {
        hingeAxis: [0, 0, 1],
        teeth: [1, 1],
        breakTorque: 200,
        onBreak: broke,
      });
      usePublish("gear", gear);
      return null;
    };

    const renderer = await renderPhysics(<Jam />, { ...fixed, gravity: [0, 0, 0] });
    run(240);

    expect(broke).toHaveBeenCalledTimes(1);
    expect(broke.mock.calls[0][0].torque).toBeGreaterThan(200);
    expect(broke.mock.calls[0][0].force).toBe(0);
    expect(need("gear").isEnabled()).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });
});

const RackAndPinion = ({
  stateIds = false,
  teeth = { pinion: 20, rack: 20, length: 2 },
}: {
  stateIds?: boolean;
  teeth?: { pinion: number; rack: number; length: number };
}) => {
  const [, pinion] = useBox({
    stateId: stateIds ? 1 : undefined,
    size: [1, 1, 0.3],
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: 5,
    allowSleeping: false,
  });
  const [, rack] = useBox({
    stateId: stateIds ? 2 : undefined,
    size: [6, 0.4, 0.3],
    position: [0, 3, 1],
    motionType: "dynamic",
    mass: 10,
    allowSleeping: false,
  });
  const [hinge] = useHingeConstraint(null, pinion, {
    stateId: stateIds ? 1 : undefined,
    point: [0, 4, 0],
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    motor: { state: "velocity", targetAngularVelocity: 2 },
  });
  const [slider] = useSliderConstraint(null, rack, {
    stateId: stateIds ? 2 : undefined,
    point: [0, 3, 1],
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
  });
  useRackAndPinionConstraint(pinion, rack, {
    stateId: stateIds ? 3 : undefined,
    hingeAxis: [0, 0, 1],
    sliderAxis: [1, 0, 0],
    teeth,
    hinge,
    slider,
  });

  usePublish("hinge1", hinge);
  usePublish("slider", slider);
  usePublish("rackBody", rack);
  return null;
};

describe("useRackAndPinionConstraint", () => {
  it("turns rotation into travel at the teeth's ratio", async () => {
    const renderer = await renderPhysics(<RackAndPinion />, {
      ...fixed,
      gravity: [0, 0, 0],
    });

    run(45);
    const angle = need("hinge1").getCurrentAngle();
    const travel = position(need("rackBody")).x;

    expect(Math.abs(angle)).toBeGreaterThan(1);
    // 20 teeth on 2 m of rack, 20 on the pinion: 2π radians per 2 m, π per metre.
    expect(Math.abs(angle / travel)).toBeCloseTo(Math.PI, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

const Rope = ({
  options,
  stateIds = false,
}: {
  options?: Partial<UsePulleyConstraintOptions>;
  stateIds?: boolean;
}) => {
  const [, left] = useBox({
    stateId: stateIds ? 1 : undefined,
    size: [1, 1, 1],
    position: [-3, 4, 0],
    motionType: "dynamic",
    mass: 40,
    allowSleeping: false,
  });
  const [, right] = useBox({
    stateId: stateIds ? 2 : undefined,
    size: [1, 1, 1],
    position: [3, 4, 0],
    motionType: "dynamic",
    mass: 10,
    allowSleeping: false,
  });
  const [pulley] = usePulleyConstraint(left, right, {
    stateId: stateIds ? 3 : undefined,
    bodyPoint1: [-3, 4.5, 0],
    bodyPoint2: [3, 4.5, 0],
    fixedPoint1: [-3, 10, 0],
    fixedPoint2: [3, 10, 0],
    ...options,
  });

  usePublish("left", left);
  usePublish("right", right);
  usePublish("pulley", pulley);
  return null;
};

describe("usePulleyConstraint", () => {
  it("drops the heavy side and lifts the light one by as much", async () => {
    const renderer = await renderPhysics(<Rope />, fixed);

    const full = need("pulley").getMaxLength();
    run(60);
    const dropped = 4 - position(need("left")).y;
    const lifted = position(need("right")).y - 4;

    expect(dropped).toBeGreaterThan(0.5);
    expect(lifted).toBeCloseTo(dropped, 1);
    expect(need("pulley").getCurrentLength()).toBeCloseTo(full, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a ratio trades travel for force", async () => {
    const renderer = await renderPhysics(<Rope options={{ ratio: 2 }} />, fixed);

    run(60);
    const dropped = 4 - position(need("left")).y;
    const lifted = position(need("right")).y - 4;

    expect(dropped).toBeGreaterThan(0.5);
    expect(dropped / lifted).toBeCloseTo(2, 0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("goes slack rather than pushing", async () => {
    const Slack = () => {
      const [, a] = useBox({
        size: [1, 1, 1],
        position: [-3, 4, 0],
        motionType: "dynamic",
        mass: 10,
      });
      const [, b] = useBox({
        size: [1, 1, 1],
        position: [3, 4, 0],
        motionType: "dynamic",
        mass: 10,
      });
      const [pulley] = usePulleyConstraint(a, b, {
        bodyPoint1: [-3, 4.5, 0],
        bodyPoint2: [3, 4.5, 0],
        fixedPoint1: [-3, 10, 0],
        fixedPoint2: [3, 10, 0],
        maxLength: 40,
      });
      usePublish("left", a);
      usePublish("right", b);
      usePublish("pulley", pulley);
      return null;
    };

    const renderer = await renderPhysics(<Slack />, fixed);

    run(30);
    // Both in free fall on a rope far longer than the gap.
    expect(position(need("left")).y).toBeCloseTo(position(need("right")).y, 2);
    expect(position(need("left")).y).toBeLessThan(3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("winches with setLength, and reads it back", async () => {
    const renderer = await renderPhysics(<Rope />, {
      ...fixed,
      gravity: [0, -1, 0],
    });

    const pulley = need("pulley");
    run(5);
    const full = pulley.getCurrentLength();

    pulley.setLength(0, full - 3);
    expect(pulley.getMaxLength()).toBeCloseTo(full - 3, 4);
    expect(pulley.getMinLength()).toBe(0);

    run(120);
    expect(pulley.getCurrentLength()).toBeCloseTo(full - 3, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("replay", () => {
  const Rollback = () => {
    const rollback = useRollback({ capacity: 120 });
    usePublish("rollback", rollback);
    return null;
  };

  const replays = async (scene: React.ReactElement, gravity: Vec3Tuple) => {
    const renderer = await renderPhysics(
      <>
        {scene}
        <Rollback />
      </>,
      { ...fixed, gravity },
    );

    run(100);
    const straight = getApi().saveState();
    const rollback = need("rollback");
    const history = Array.from({ length: 60 }, (_, index) =>
      rollback.snapshotAt(40 + index)?.slice(),
    );

    expect(rollback.rewind(40)).toBe(true);

    history.forEach((snapshot, index) => {
      expect(
        isSameState(
          rollback.snapshotAt(40 + index) as Uint8Array,
          snapshot as Uint8Array,
        ),
        `step ${40 + index}`,
      ).toBe(true);
    });
    expect(isSameState(getApi().saveState(), straight)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  };

  it("a motorised path, exactly", async () => {
    await replays(
      <Cart
        stateId={1}
        options={{
          stateId: 1,
          points: RING,
          looping: true,
          rotation: "path",
          motor: { state: "velocity", targetVelocity: 6 },
        }}
        start={[5, 5, 0]}
      />,
      [0, -9.81, 0],
    );
  });

  it("a gear train with its hinges, exactly", async () => {
    await replays(<GearTrain stateIds />, [0, 0, 0]);
  });

  it("a gear train given to Jolt swapped, exactly", async () => {
    await replays(<GearTrain stateIds teeth={[30, 10]} />, [0, 0, 0]);
  });

  it("a rack and pinion, exactly", async () => {
    await replays(<RackAndPinion stateIds />, [0, 0, 0]);
  });

  it("a pulley, exactly", async () => {
    await replays(<Rope stateIds />, [0, -9.81, 0]);
  });
});
