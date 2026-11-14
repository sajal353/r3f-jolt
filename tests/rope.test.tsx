import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { EllipseCurve, Quaternion, Vector3, type Curve } from "three";
import { useBox } from "@/Jolt/useBox";
import { useRope, type RopeApi, type UseRopeOptions } from "@/Jolt/useRope";
import { readRodRotation } from "@/Jolt/internal/rodBuild";
import {
  expectNoAsserts,
  getApi,
  Refused,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const held: { ropes: RopeApi[] } = { ropes: [] };

const Rope = ({ slot = 0, ...options }: UseRopeOptions & { slot?: number }) => {
  const [ref, api] = useRope(options);

  useEffect(() => {
    if (api) held.ropes[slot] = api;
  }, [api, slot]);

  return <lineSegments ref={ref} geometry={api?.geometry} />;
};

const Floor = ({ y = 0 }: { y?: number }) => {
  useBox({
    size: [20, 1, 20],
    position: [0, y - 0.5, 0],
    motionType: "static",
    stateId: 1,
  });
  return null;
};

const rope = (slot = 0) => {
  const found = held.ropes[slot];
  if (!found) throw new Error(`rope ${slot} was never created`);
  return found;
};

const vertices = (api: RopeApi) =>
  Array.from({ length: api.vertexCount }, (_, index) => api.getVertex(index));

/** The catenary through (±1, 2) with arc length `length`. */
const catenary = (length: number) => {
  let low = 0.05;
  let high = 100;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    if (2 * middle * Math.sinh(1 / middle) > length) low = middle;
    else high = middle;
  }
  const a = (low + high) / 2;
  return (x: number) => 2 - (a * Math.cosh(1 / a) - a * Math.cosh(x / a));
};

/** A V of length 2.4 between (±1, 2), resampled into 24 segments. */
const hanging: UseRopeOptions = {
  points: [
    [-1, 2, 0],
    [0, 2 - Math.sqrt(0.44), 0],
    [1, 2, 0],
  ],
  segments: 24,
  pinned: "both",
};

const curl = (): Curve<Vector3> => {
  const arc = new EllipseCurve(0, 0, 0.3, 0.3, Math.PI, Math.PI / 4, true);
  return {
    getSpacedPoints: (divisions: number) =>
      arc
        .getSpacedPoints(divisions)
        .map((point) => new Vector3(point.x + 0.3, point.y + 2, 0)),
  } as Curve<Vector3>;
};

describe("useRope", () => {
  it("settles to the catenary between two pins", async () => {
    held.ropes = [];
    const renderer = await renderPhysics(
      <Rope
        {...hanging}
        bendCompliance={1e-3}
        iterations={10}
        linearDamping={0.5}
        lra="geodesic"
      />,
      { strict: true },
    );

    await step(renderer, 900);

    const api = rope();
    expect(api.restLength).toBeCloseTo(2.4, 3);
    const curve = catenary(api.restLength);
    for (const point of vertices(api)) {
      expect(Math.abs(point.y - curve(point.x))).toBeLessThan(0.01);
    }
    expect(api.length()).toBeLessThan(api.restLength * 1.005);
    expect(api.isSleeping()).toBe(true);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("swings about a pinned end, or holds its direction with clamp", async () => {
    held.ropes = [];
    const straight: UseRopeOptions = {
      points: [
        [0, 2, 0],
        [1, 2, 0],
      ],
      segments: 10,
      pinned: "start",
      bendCompliance: 1e-5,
      iterations: 10,
      linearDamping: 0.5,
    };
    const renderer = await renderPhysics(
      <>
        <Rope slot={0} {...straight} />
        <Rope slot={1} {...straight} position={[0, 0, 2]} clamp />
      </>,
      { strict: true },
    );

    await step(renderer, 600);

    const hinged = rope(0).getVertex(10);
    const clamped = rope(1).getVertex(10);
    expect(hinged.y).toBeLessThan(1.2);
    expect(clamped.y).toBeGreaterThan(1.9);
    expect(rope(0).getVertex(0).distanceTo(new Vector3(0, 2, 0))).toBeLessThan(1e-5);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("springs back to its curl with curl, and straightens without", async () => {
    held.ropes = [];
    const strand: UseRopeOptions = {
      curve: curl(),
      segments: 12,
      pinned: "start",
      clamp: true,
      bendCompliance: 1e-4,
      gravityFactor: 0,
      iterations: 10,
      linearDamping: 1,
    };
    const renderer = await renderPhysics(
      <>
        <Rope slot={0} {...strand} curl />
        <Rope slot={1} {...strand} position={[0, 0, 2]} />
      </>,
      { strict: true },
    );

    await step(renderer, 2);
    const rest = vertices(rope(0)).map((point) => point.clone());
    rope(0).applyImpulse([0, 0, 0.4]);
    await step(renderer, 600);

    vertices(rope(0)).forEach(function matchesRest(point, index) {
      expect(point.distanceTo(rest[index])).toBeLessThan(0.02);
    });

    const straightened = rope(1);
    const root = straightened.getVertex(0);
    const tip = straightened.getVertex(straightened.vertexCount - 1);
    expect(root.distanceTo(tip)).toBeGreaterThan(straightened.restLength * 0.98);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("frames each segment along it, continuous from one to the next", async () => {
    held.ropes = [];
    const renderer = await renderPhysics(
      <Rope {...hanging} iterations={10} />,
      { strict: true },
    );

    await step(renderer, 90);

    const api = rope();
    const points = vertices(api);
    const previous = new Quaternion();
    const frame = new Quaternion();
    const axis = new Vector3();
    const along = new Vector3();

    for (let segment = 0; segment < api.segmentCount; segment += 1) {
      api.getRotation(segment, frame);
      axis.set(0, 0, 1).applyQuaternion(frame);
      along.subVectors(points[segment + 1], points[segment]).normalize();
      expect(axis.dot(along)).toBeGreaterThan(0.99);
      if (segment > 0) expect(Math.abs(previous.dot(frame))).toBeGreaterThan(0.9);
      previous.copy(frame);
    }

    expectNoAsserts();
    await unmount(renderer);
  });

  it("rests on the floor at its radius", async () => {
    held.ropes = [];
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Rope
          points={[
            [-1, 0.5, 0],
            [1, 0.5, 0],
          ]}
          segments={20}
          radius={0.03}
        />
      </>,
      { strict: true },
    );

    await step(renderer, 240);

    for (const point of vertices(rope())) {
      expect(point.y).toBeGreaterThan(0.02);
      expect(point.y).toBeLessThan(0.04);
    }

    expectNoAsserts();
    await unmount(renderer);
  });

  it("is blown downwind, and only with air drag", async () => {
    held.ropes = [];
    const vertical: UseRopeOptions = {
      points: [
        [0, 2, 0],
        [0, 1, 0],
      ],
      segments: 10,
      pinned: "start",
      gravityFactor: 0,
      wind: [6, 0, 0],
      radius: 0.05,
    };
    const renderer = await renderPhysics(
      <>
        <Rope slot={0} {...vertical} />
        <Rope slot={1} {...vertical} position={[0, 0, 2]} airDrag={0} />
      </>,
      { strict: true },
    );

    await step(renderer, 120);

    expect(rope(0).getVertex(10).x).toBeGreaterThan(0.2);
    expect(rope(1).getVertex(10).x).toBeCloseTo(0, 6);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("cannot stretch past its length with tethers", async () => {
    held.ropes = [];
    const vertical: UseRopeOptions = {
      points: [
        [0, 3, 0],
        [0, 2, 0],
      ],
      segments: 10,
      pinned: "start",
    };
    const renderer = await renderPhysics(
      <>
        <Rope slot={0} {...vertical} lra="geodesic" />
        <Rope slot={1} {...vertical} position={[0, 0, 2]} />
      </>,
      { strict: true },
    );

    let tethered = 0;
    let loose = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      rope(0).setVertexVelocity(10, [0, -40, 0]);
      rope(1).setVertexVelocity(10, [0, -40, 0]);
      await step(renderer);
      tethered = Math.max(tethered, rope(0).getVertex(0).distanceTo(rope(0).getVertex(10)));
      loose = Math.max(loose, rope(1).getVertex(0).distanceTo(rope(1).getVertex(10)));
    }

    expect(tethered).toBeLessThan(1.001);
    expect(loose).toBeGreaterThan(tethered);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("restores to the same bytes, segment frames included", async () => {
    held.ropes = [];
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Rope {...hanging} pinned="start" stateId={2} />
      </>,
      { strict: true },
    );

    await step(renderer, 20);
    const api = getApi();
    const start = api.saveState();
    const own = rope().saveState();
    const ownVertices = vertices(rope()).map((point) => point.toArray());
    await step(renderer, 40);
    const first = api.saveState();
    const frame = rope().getRotation(5).clone();

    api.restoreState(start);
    await step(renderer, 40);
    expect(api.saveState()).toEqual(first);
    expect(rope().getRotation(5).equals(frame)).toBe(true);

    rope().restoreState(own);
    expect(vertices(rope()).map((point) => point.toArray())).toEqual(ownVertices);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("refuses a stateId another rope holds, and a rope with no shape", async () => {
    held.ropes = [];
    const errors: unknown[] = [];
    const record = (error: unknown) => errors.push(error);
    const renderer = await renderPhysics(
      <>
        <Rope slot={0} {...hanging} stateId={3} />
        <Refused onError={record}>
          <Rope slot={1} {...hanging} stateId={3} />
        </Refused>
        <Refused onError={record}>
          <Rope slot={2} />
        </Refused>
      </>,
    );

    expect(String(errors[0])).toMatch(/stateId 3 is taken by useRope/);
    expect(String(errors[1])).toMatch(/useRope: needs `points` or `curve`/);

    expectNoAsserts();
    await unmount(renderer);
  });

  it("reads segment frames off the heap exactly as Jolt's getters do", async () => {
    held.ropes = [];
    const renderer = await renderPhysics(<Rope {...hanging} />);

    await step(renderer, 30);

    const api = rope();
    const jolt = getApi().Jolt;
    const motion = jolt.castObject(
      api.body.GetMotionProperties(),
      jolt.SoftBodyMotionProperties,
    );
    const read = new Quaternion();
    for (let rod = 0; rod < api.segmentCount; rod += 1) {
      const quat = motion.GetRodRotation(rod);
      const expected = [quat.GetX(), quat.GetY(), quat.GetZ(), quat.GetW()];
      readRodRotation(jolt, motion, rod, read);
      expect(read.toArray()).toEqual(expected);
    }

    expectNoAsserts();
    await unmount(renderer);
  });
});
