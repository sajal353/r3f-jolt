import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useConveyor, type ConveyorApi } from "@/Jolt/useConveyor";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const BELT_SIZE: Vec3Tuple = [20, 1, 20];

const Belt = ({
  linear,
  angular,
  rotation,
  space = "local",
  wake,
  onReady,
}: {
  linear?: Vec3Tuple;
  angular?: Vec3Tuple;
  rotation?: QuatTuple;
  space?: "local" | "world";
  wake?: boolean;
  onReady?: (conveyor: ConveyorApi) => void;
}) => {
  const [, api] = useBox({
    size: BELT_SIZE,
    position: [0, -0.5, 0],
    rotation,
    motionType: "static",
    material: { friction: 1 },
  });

  const conveyor = useConveyor(api, { linear, angular, space, wake });

  if (conveyor && onReady) onReady(conveyor);
  return null;
};

const Crate = ({
  position = [0, 1, 0],
  onReady,
}: {
  position?: Vec3Tuple;
  onReady?: (api: BodyApi<Jolt.BoxShape>) => void;
}) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position,
    motionType: "dynamic",
    mass: 5,
    material: { friction: 1 },
  });

  if (api && onReady) onReady(api);
  return null;
};

const Drive = ({ api }: { api: BodyApi<Jolt.BoxShape> | undefined }) => {
  useConveyor(api, { linear: [4, 0, 0] });
  return null;
};

const SplitBelt = ({ driven }: { driven: boolean }) => {
  const [, api] = useBox({
    size: BELT_SIZE,
    position: [0, -0.5, 0],
    motionType: "static",
    material: { friction: 1 },
  });

  return driven ? <Drive api={api} /> : null;
};

const positionOf = (api: BodyApi<Jolt.BoxShape>) => {
  const p = api.body.GetPosition();
  return { x: p.GetX(), y: p.GetY(), z: p.GetZ() };
};

const yawTuple = (radians: number): QuatTuple => {
  const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, radians);
  return [q.x, q.y, q.z, q.w];
};

describe("conveyor belts", () => {
  it("drags a resting body along the commanded axis only", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    const renderer = await renderPhysics(
      <>
        <Belt linear={[4, 0, 0]} />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 120);

    const end = positionOf(crate!);
    expect(end.x).toBeGreaterThan(1);
    expect(Math.abs(end.z)).toBeLessThan(0.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reverses when the api is driven at runtime", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;
    let conveyor: ConveyorApi | undefined;

    const renderer = await renderPhysics(
      <>
        <Belt linear={[4, 0, 0]} onReady={(api) => (conveyor = api)} />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 90);
    const forward = positionOf(crate!).x;
    expect(forward).toBeGreaterThan(0.5);

    conveyor!.setLinear([-4, 0, 0]);
    await step(renderer, 120);

    expect(positionOf(crate!).x).toBeLessThan(forward);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes a local-space velocity through the belt's own rotation", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    const renderer = await renderPhysics(
      <>
        <Belt
          linear={[4, 0, 0]}
          rotation={yawTuple(Math.PI / 2)}
          space="local"
        />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 120);

    // A +90° yaw maps the belt's local +X onto world -Z.
    const end = positionOf(crate!);
    expect(end.z).toBeLessThan(-1);
    expect(Math.abs(end.x)).toBeLessThan(0.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves world-space velocity unrotated", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    const renderer = await renderPhysics(
      <>
        <Belt
          linear={[4, 0, 0]}
          rotation={yawTuple(Math.PI / 2)}
          space="world"
        />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 120);

    const end = positionOf(crate!);
    expect(end.x).toBeGreaterThan(1);
    expect(Math.abs(end.z)).toBeLessThan(0.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * The broadphase decides which body of a pair is body 1, and Jolt reads the
   * setting as body 2's surface velocity minus body 1's. Transposing the two
   * signs still moves a crate on a single belt, so only a crate wedged between
   * two opposed belts catches it.
   */
  it("applies the same sign whichever side of the pair the belt lands on", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    const renderer = await renderPhysics(
      <>
        <Belt linear={[4, 0, 0]} />
        <Crate position={[0, 1, 0]} onReady={(api) => (crate = api)} />
        <Crate position={[0, 3, 0]} />
      </>,
    );

    await step(renderer, 120);

    expect(positionOf(crate!).x).toBeGreaterThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("carries a body up an inclined belt", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    // Oriented the way the demo's circuit places its ramps: local -Z aimed
    // along the climb, so the belt carries uphill with the same local velocity
    // every flat belt uses.
    const climb = new Vector3(0, 3, 20).normalize();
    const zAxis = climb.clone().negate();
    const xAxis = new Vector3(0, 1, 0).cross(zAxis).normalize();
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(xAxis, yAxis, zAxis),
    );

    const Ramp = () => {
      const [, api] = useBox({
        size: [6, 0.5, 20],
        position: [0, 2, 0],
        rotation: [q.x, q.y, q.z, q.w],
        motionType: "static",
        material: { friction: 1 },
      });

      useConveyor(api, { linear: [0, 0, -4] });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ramp />
        <Crate position={[0, 3.5, -4]} onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 30);
    const start = positionOf(crate!);

    await step(renderer, 120);
    const end = positionOf(crate!);

    expect(end.y).toBeGreaterThan(start.y + 0.5);
    expect(end.z).toBeGreaterThan(start.z + 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * Jolt reads the angular term about body 1's centre of mass. A turntable that
   * lands as body 2 would otherwise turn its passenger on the spot rather than
   * sweeping it round, so this asserts the crate actually travels an arc.
   */
  it("sweeps an off-centre body around an angular belt", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    // Kept under the slip threshold: at radius r a passenger needs w²r of
    // centripetal force, and friction can only supply about g.
    const renderer = await renderPhysics(
      <>
        <Belt angular={[0, 1, 0]} />
        <Crate position={[4, 1, 0]} onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 30);
    const start = positionOf(crate!);

    await step(renderer, 90);
    const end = positionOf(crate!);

    const radius = Math.hypot(start.x, start.z);
    expect(radius).toBeGreaterThan(3);

    // Swept sideways, not merely spun: the crate left its starting bearing
    // while staying about the same distance from the axis.
    expect(Math.abs(end.z - start.z)).toBeGreaterThan(1);
    expect(Math.abs(Math.hypot(end.x, end.z) - radius)).toBeLessThan(1.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("starts a body that fell asleep on a stopped belt", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;
    let conveyor: ConveyorApi | undefined;

    const renderer = await renderPhysics(
      <>
        <Belt onReady={(api) => (conveyor = api)} />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 240);
    expect(crate!.isSleeping()).toBe(true);

    const start = positionOf(crate!).x;
    conveyor!.setLinear([4, 0, 0]);
    await step(renderer, 120);

    expect(positionOf(crate!).x).toBeGreaterThan(start + 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("carries a belt declared through the body option", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    const OptionBelt = () => {
      useBox({
        size: BELT_SIZE,
        position: [0, -0.5, 0],
        motionType: "static",
        material: { friction: 1 },
        surfaceVelocity: { linear: [4, 0, 0] },
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <OptionBelt />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 120);

    expect(positionOf(crate!).x).toBeGreaterThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stops carrying once the hook unmounts", async () => {
    let crate: BodyApi<Jolt.BoxShape> | undefined;

    const renderer = await renderPhysics(
      <>
        <SplitBelt driven />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 120);
    expect(crate!.body.GetLinearVelocity().GetX()).toBeGreaterThan(2);

    await updatePhysics(
      renderer,
      <>
        <SplitBelt driven={false} />
        <Crate onReady={(api) => (crate = api)} />
      </>,
    );

    await step(renderer, 120);

    expect(Math.abs(crate!.body.GetLinearVelocity().GetX())).toBeLessThan(0.5);

    await unmount(renderer);
    expectNoAsserts();
  });
});
