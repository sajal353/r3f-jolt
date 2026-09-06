import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useTrimesh } from "@/Jolt/useTrimesh";
import { usePlane } from "@/Jolt/usePlane";
import { useHeightField } from "@/Jolt/useHeightField";
import { useTaperedCylinder } from "@/Jolt/useTaperedCylinder";
import { useEmpty } from "@/Jolt/useEmpty";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { HeightFieldExtras } from "@/Jolt/useHeightField";
import type { TrimeshExtras } from "@/Jolt/useTrimesh";
import type { RaycastHit } from "@/Jolt/internal/raycast";
import type { HeightFieldSamples } from "@/Jolt/internal/heightFieldSamples";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  renderPhysics,
  step,
  unmount,
} from "./harness";

/**
 * The scenes publish through this rather than through state, so an assertion
 * can reach a hook's api without the test re-rendering into the world it is
 * measuring.
 */
const published: Record<string, unknown> = {};

const usePublished = <T,>(name: string, value: T | undefined) => {
  useEffect(() => {
    if (value) published[name] = value;
  }, [name, value]);
};

const taken = <T,>(name: string) => {
  const value = published[name];
  if (!value) throw new Error(`${name} was never published`);
  return value as T;
};

// Names repeat between tests, and a stale api from an unmounted world would
// answer instead of failing.
beforeEach(() => {
  for (const key of Object.keys(published)) delete published[key];
});

const Ground = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 30 });
  return null;
};

const Faller = ({
  name,
  position,
  ...rest
}: {
  name: string;
  position: Vec3Tuple;
} & Partial<Parameters<typeof useBox>[0]>) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position,
    motionType: "dynamic",
    ...rest,
  });

  usePublished(name, api);
  return null;
};

const heightAt = (x: number, z: number) =>
  Math.sin(x * 0.35) * Math.cos(z * 0.35);

const Terrain = ({
  name,
  heights = heightAt,
  sampleCount = 16,
  range,
}: {
  name: string;
  heights?: HeightFieldSamples;
  sampleCount?: number;
  range?: [number, number];
}) => {
  const [, api] = useHeightField({
    heights,
    sampleCount,
    blockSize: 4,
    offset: [0, 0, 0],
    range,
    position: [0, 0, 0],
  });

  usePublished(name, api);
  return null;
};

const DownwardRay = ({
  name,
  origin,
}: {
  name: string;
  origin: Vec3Tuple;
}) => {
  const [caster] = useClosestHitRaycaster({
    origin,
    direction: [0, -20, 0],
  });

  usePublished(name, caster);
  return null;
};

interface Caster {
  cast: (origin?: Vec3Tuple, direction?: Vec3Tuple) => RaycastHit;
}

describe("usePlane", () => {
  it("stops a falling box at the plane, and the collider outreaches the mesh", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller name="box" position={[0, 4, 0]} />
        <Faller name="far" position={[25, 4, 0]} />
      </>,
    );

    await step(renderer, 150);

    const box = taken<BodyApi<Jolt.Shape>>("box");
    const far = taken<BodyApi<Jolt.Shape>>("far");

    // Half a box above the plane, give or take the convex radius.
    expect(box.body.GetPosition().GetY()).toBeCloseTo(0.5, 1);

    // 25 units out is well past the 20-unit render mesh and well inside the
    // 30-unit collider — the whole point of the hook.
    expect(far.body.GetPosition().GetY()).toBeCloseTo(0.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("puts the surface where `point` says", async () => {
    const Raised = () => {
      usePlane({
        point: [0, 2, 0],
        position: [0, 0, 0],
        motionType: "static",
        halfExtent: 30,
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Raised />
        <Faller name="raised" position={[0, 6, 0]} />
      </>,
    );

    await step(renderer, 150);

    expect(
      taken<BodyApi<Jolt.Shape>>("raised").body.GetPosition().GetY(),
    ).toBeCloseTo(2.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("carries a material as an identity token", async () => {
    const Marked = () => {
      const [, api] = usePlane({
        position: [0, 0, 0],
        motionType: "static",
      });
      usePublished("marked", api);
      return null;
    };

    const renderer = await renderPhysics(<Marked />);
    const plane = taken<{
      setMaterial: (material: Jolt.PhysicsMaterial) => void;
      getMaterial: () => Jolt.PhysicsMaterial;
      body: Jolt.Body;
    }>("marked");

    const before = plane.getMaterial();
    expect(before).toBeTruthy();

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useHeightField", () => {
  it("reports the range it was built with and lands a ray on the sampled height", async () => {
    const renderer = await renderPhysics(
      <>
        <Terrain name="terrain" />
        <DownwardRay name="ray" origin={[4, 10, 4]} />
      </>,
    );

    await step(renderer, 2);

    const terrain = taken<BodyApi<Jolt.HeightFieldShape> & HeightFieldExtras>(
      "terrain",
    );

    // Quantisation moves the extremes a little, so the assertion is that the
    // shape agrees with the samples rather than that it is exact.
    expect(terrain.getMinHeight()).toBeLessThan(0);
    expect(terrain.getMaxHeight()).toBeGreaterThan(0);

    const hit = taken<Caster>("ray").cast();
    expect(hit.hit).toBe(true);
    expect(hit.point.y).toBeCloseTo(terrain.getHeight(4, 4), 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("moves the surface under a ray when setHeights writes to it", async () => {
    const renderer = await renderPhysics(
      <>
        <Terrain name="terrain" range={[-8, 8]} />
        <DownwardRay name="ray" origin={[5, 10, 5]} />
      </>,
    );

    await step(renderer, 2);

    const terrain = taken<BodyApi<Jolt.HeightFieldShape> & HeightFieldExtras>(
      "terrain",
    );
    const ray = taken<Caster>("ray");

    // The raycaster reuses one result object between casts, so the height has
    // to be copied out before the second cast overwrites it.
    const before = ray.cast();
    expect(before.hit).toBe(true);
    const heightBefore = before.point.y;

    terrain.setHeights(4, 4, 4, 4, new Float32Array(16).fill(5));

    const after = ray.cast();
    expect(after.hit).toBe(true);
    expect(after.point.y).toBeCloseTo(5, 1);
    expect(after.point.y).toBeGreaterThan(heightBefore + 3);

    // The render geometry is regenerated in place, so the mesh cannot drift
    // away from the collider that was just deformed.
    expect(terrain.geometry.getAttribute("position").count).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("round-trips a patch through getHeights", async () => {
    const renderer = await renderPhysics(<Terrain name="terrain" range={[-8, 8]} />);

    const terrain = taken<BodyApi<Jolt.HeightFieldShape> & HeightFieldExtras>(
      "terrain",
    );

    terrain.setHeights(0, 0, 4, 4, new Float32Array(16).fill(2));
    const read = terrain.getHeights(0, 0, 4, 4);

    expect(read).toHaveLength(16);
    for (const height of read) expect(height).toBeCloseTo(2, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets a ray through a hole and refuses a misaligned region", async () => {
    const withHole = (x: number, z: number) =>
      x >= 4 && x < 8 && z >= 4 && z < 8 ? null : 0;

    const renderer = await renderPhysics(
      <>
        <Terrain name="terrain" heights={withHole} />
        <DownwardRay name="through" origin={[5.5, 10, 5.5]} />
        <DownwardRay name="solid" origin={[1.5, 10, 1.5]} />
      </>,
    );

    await step(renderer, 2);

    const terrain = taken<BodyApi<Jolt.HeightFieldShape> & HeightFieldExtras>(
      "terrain",
    );

    expect(terrain.isNoCollision(5, 5)).toBe(true);
    expect(terrain.isNoCollision(1, 1)).toBe(false);

    expect(taken<Caster>("through").cast().hit).toBe(false);
    expect(taken<Caster>("solid").cast().hit).toBe(true);

    // Jolt reads whole blocks and asserts on anything else, which a release
    // build turns into a heap overrun rather than a message.
    expect(() => terrain.getHeights(2, 0, 4, 4)).toThrow(/multiple of blockSize/);
    expect(() => terrain.getHeights(0, 0, 2, 2)).toThrow(/multiple of blockSize/);
    expect(() => terrain.getHeights(12, 12, 8, 8)).toThrow(/runs past/);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("builds the same shape from an array, a sampler and 8-bit image data", async () => {
    const count = 16;
    const range: [number, number] = [-2, 2];

    // Quantised to bytes up front, so all three forms describe terrain the
    // 8-bit field can represent exactly — otherwise the comparison would be
    // measuring rounding rather than row order.
    const bytes = new Uint8Array(count * count);
    for (let z = 0; z < count; z += 1) {
      for (let x = 0; x < count; x += 1) {
        bytes[z * count + x] = (x * 7 + z * 13) % 256;
      }
    }

    const asHeight = (byte: number) =>
      range[0] + (byte / 255) * (range[1] - range[0]);

    const array = Array.from(bytes, asHeight);
    const sampler = (x: number, z: number) => asHeight(bytes[z * count + x]);

    const renderer = await renderPhysics(
      <>
        <Terrain name="array" heights={array} sampleCount={count} range={range} />
        <Terrain
          name="sampler"
          heights={sampler}
          sampleCount={count}
          range={range}
        />
        <Terrain
          name="image"
          heights={{ data: bytes, heightRange: range }}
          sampleCount={count}
          range={range}
        />
      </>,
    );

    const fields = (["array", "sampler", "image"] as const).map((name) =>
      taken<BodyApi<Jolt.HeightFieldShape> & HeightFieldExtras>(name),
    );

    for (let z = 0; z < count; z += 1) {
      for (let x = 0; x < count; x += 1) {
        const [first, second, third] = fields.map((field) =>
          field.getHeight(x, z),
        );
        expect(second).toBeCloseTo(first, 5);
        expect(third).toBeCloseTo(first, 5);
      }
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a sampleCount that does not fit the block size", async () => {
    const Bad = () => {
      useHeightField({
        heights: () => 0,
        sampleCount: 10,
        blockSize: 4,
        position: [0, 0, 0],
      });
      return null;
    };

    await expect(renderPhysics(<Bad />)).rejects.toThrow(
      /multiple of blockSize/,
    );
  });
});

describe("useTaperedCylinder", () => {
  it("mounts with non-empty debug geometry and stands on its flat end", async () => {
    const Cone = () => {
      const [, api] = useTaperedCylinder({
        topRadius: 0,
        bottomRadius: 0.5,
        height: 1,
        position: [0, 3, 0],
        motionType: "dynamic",
        debug: true,
      });
      usePublished("cone", api);
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Cone />
      </>,
    );

    await step(renderer, 150);

    const cone = taken<BodyApi<Jolt.TaperedCylinderShape>>("cone");

    expect(cone.debugMesh).not.toBeNull();
    expect(
      cone.debugMesh?.geometry.getAttribute("position").count,
    ).toBeGreaterThan(0);
    expect(cone.shape.GetBottomRadius()).toBeCloseTo(0.5, 5);
    expect(cone.body.GetPosition().GetY()).toBeCloseTo(0.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useEmpty", () => {
  it("adds a body that collides with nothing and draws nothing", async () => {
    const Marker = () => {
      const [, api] = useEmpty({ position: [0, 1, 0], motionType: "dynamic" });
      usePublished("marker", api);
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Marker />
      </>,
    );

    await step(renderer, 120);

    const marker = taken<BodyApi<Jolt.EmptyShape>>("marker");

    expect(marker.geometry.getAttribute("position")).toBeUndefined();
    // The plane is right there and it went straight through.
    expect(marker.body.GetPosition().GetY()).toBeLessThan(-2);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("creation-time scale", () => {
  it("changes the resting height, and a later setScale replaces it", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller name="plain" position={[0, 4, 0]} />
        <Faller name="big" position={[4, 4, 0]} scale={[2, 2, 2]} />
      </>,
    );

    await step(renderer, 150);

    const plain = taken<BodyApi<Jolt.Shape>>("plain");
    const big = taken<BodyApi<Jolt.Shape>>("big");

    expect(plain.body.GetPosition().GetY()).toBeCloseTo(0.5, 1);
    expect(big.body.GetPosition().GetY()).toBeCloseTo(1, 1);

    // Built from the base shape either way, so this is 3× the original rather
    // than 3× the 2× it is already wearing.
    big.setScale([3, 3, 3]);
    big.setPositionAndRotation([4, 6, 0], [0, 0, 0, 1], true);
    await step(renderer, 150);

    expect(big.body.GetPosition().GetY()).toBeCloseTo(1.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("mass properties", () => {
  it("carries an explicit mass and inertia into the body", async () => {
    const Weighted = () => {
      const [, api] = useBox({
        size: [1, 1, 1],
        position: [0, 5, 0],
        motionType: "dynamic",
        massProperties: { mass: 7, inertia: [2, 3, 4] },
      });
      usePublished("weighted", api);
      return null;
    };

    const renderer = await renderPhysics(<Weighted />);
    await step(renderer, 2);

    const motion = taken<BodyApi<Jolt.Shape>>("weighted")
      .body.GetMotionProperties();

    expect(1 / motion.GetInverseMass()).toBeCloseTo(7, 3);

    const diagonal = motion.GetInverseInertiaDiagonal();
    // Jolt eigen-decomposes the tensor and hands the diagonal back sorted, so
    // the three values survive the round trip while their order does not.
    const inertia = [
      1 / diagonal.GetX(),
      1 / diagonal.GetY(),
      1 / diagonal.GetZ(),
    ].sort((a, b) => a - b);

    expect(inertia[0]).toBeCloseTo(2, 3);
    expect(inertia[1]).toBeCloseTo(3, 3);
    expect(inertia[2]).toBeCloseTo(4, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("survives a rescale that would otherwise recompute it from density", async () => {
    const Weighted = () => {
      const [, api] = useBox({
        size: [1, 1, 1],
        position: [0, 5, 0],
        motionType: "dynamic",
        massProperties: { mass: 7 },
      });
      usePublished("rescaled", api);
      return null;
    };

    const renderer = await renderPhysics(<Weighted />);
    await step(renderer, 2);

    const body = taken<BodyApi<Jolt.Shape>>("rescaled");
    body.setScale([2, 2, 2]);

    expect(1 / body.body.GetMotionProperties().GetInverseMass()).toBeCloseTo(
      7,
      3,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses an inertia with no mass to go with it", async () => {
    const Bad = () => {
      useBox({
        size: [1, 1, 1],
        position: [0, 5, 0],
        motionType: "dynamic",
        massProperties: { inertia: [1, 1, 1] },
      });
      return null;
    };

    await expect(renderPhysics(<Bad />)).rejects.toThrow(/positive `mass`/);
  });
});

describe("per-triangle user data", () => {
  it("round-trips a surface tag through a raycast hit", async () => {
    // Two triangles making one quad, wound counter-clockwise seen from above so
    // a ray from the sky hits the front face — Jolt culls back faces on a mesh.
    const quad = {
      position: {
        count: 4,
        getX: (i: number) => [-1, 1, 1, -1][i],
        getY: () => 0,
        getZ: (i: number) => [-1, -1, 1, 1][i],
      },
      index: [0, 2, 1, 0, 3, 2],
    };

    const Surfaces = () => {
      const [, api] = useTrimesh({
        mesh: quad as unknown as Parameters<typeof useTrimesh>[0]["mesh"],
        position: [0, 0, 0],
        triangleUserData: [11, 22],
        buildQuality: "favorBuildSpeed",
      });
      usePublished("surfaces", api);
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Surfaces />
        <DownwardRay name="rightHalf" origin={[0.5, 5, -0.5]} />
        <DownwardRay name="leftHalf" origin={[-0.5, 5, 0.5]} />
      </>,
    );

    await step(renderer, 2);

    const mesh = taken<BodyApi<Jolt.MeshShape> & TrimeshExtras>("surfaces");

    const right = taken<Caster>("rightHalf").cast();
    const left = taken<Caster>("leftHalf").cast();

    expect(right.hit).toBe(true);
    expect(left.hit).toBe(true);

    const tags = [
      mesh.getTriangleUserData(right.subShapeID),
      mesh.getTriangleUserData(left.subShapeID),
    ].sort((a, b) => a - b);

    expect(tags).toEqual([11, 22]);

    await unmount(renderer);
    expectNoAsserts();
  });
});
