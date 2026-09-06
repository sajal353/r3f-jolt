import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, SphereGeometry, type BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import { usePlane } from "@/Jolt/usePlane";
import { useAutoCollider } from "@/Jolt/useAutoCollider";
import type { AutoColliderKind } from "@/Jolt/useAutoCollider";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

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

beforeEach(() => {
  for (const key of Object.keys(published)) delete published[key];
});

const Ground = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 40 });
  return null;
};

const Shaped = ({
  name = "body",
  collider = "box" as AutoColliderKind,
  geometry,
  scale = [1, 1, 1] as Vec3Tuple,
  position = [0, 6, 0] as Vec3Tuple,
  motionType = "dynamic" as "dynamic" | "static",
}: {
  name?: string;
  collider?: AutoColliderKind;
  geometry: BufferGeometry;
  scale?: Vec3Tuple;
  position?: Vec3Tuple;
  motionType?: "dynamic" | "static";
}) => {
  const [ref, api] = useAutoCollider({ collider, position, motionType });

  usePublished(name, api);

  return (
    <mesh ref={ref} scale={scale} geometry={geometry}>
      <meshStandardMaterial />
    </mesh>
  );
};

const restingHeight = (api: BodyApi<Jolt.Shape>) =>
  api.body.GetPosition().GetY();

const localBounds = (api: BodyApi<Jolt.Shape>) => {
  const box = api.shape.GetLocalBounds();
  const min = box.mMin;
  const max = box.mMax;
  return {
    min: [min.GetX(), min.GetY(), min.GetZ()],
    max: [max.GetX(), max.GetY(), max.GetZ()],
  };
};

describe("useAutoCollider", () => {
  it("takes a box from the geometry's own bounds", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Shaped geometry={new BoxGeometry(2, 1, 3)} />
      </>,
    );

    const api = taken<BodyApi<Jolt.Shape>>("body");
    const { min, max } = localBounds(api);

    expect(max[0] - min[0]).toBeCloseTo(2, 2);
    expect(max[1] - min[1]).toBeCloseTo(1, 2);
    expect(max[2] - min[2]).toBeCloseTo(3, 2);

    await step(renderer, 400);
    expect(restingHeight(api)).toBeCloseTo(0.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes a sphere from the geometry's bounding sphere", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Shaped collider="sphere" geometry={new SphereGeometry(0.8, 16, 16)} />
      </>,
    );

    const api = taken<BodyApi<Jolt.Shape>>("body");
    const { min, max } = localBounds(api);

    expect((max[1] - min[1]) / 2).toBeCloseTo(0.8, 1);

    await step(renderer, 400);
    expect(restingHeight(api)).toBeCloseTo(0.8, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("scales the collider with the mesh", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Shaped geometry={new BoxGeometry(1, 1, 1)} scale={[2, 4, 2]} />
      </>,
    );

    const api = taken<BodyApi<Jolt.Shape>>("body");
    const { min, max } = localBounds(api);

    expect(max[0] - min[0]).toBeCloseTo(2, 2);
    expect(max[1] - min[1]).toBeCloseTo(4, 2);
    expect(max[2] - min[2]).toBeCloseTo(2, 2);

    await step(renderer, 400);
    expect(restingHeight(api)).toBeCloseTo(2, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("offsets the collider to geometry that is not centred on its origin", async () => {
    // Modelled with its feet at the origin, which is how a great many meshes
    // arrive. Without the offset the collider sits half a body low and the
    // resting height is wrong by exactly that.
    const offset = new BoxGeometry(1, 2, 1);
    offset.translate(0, 1, 0);

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Shaped geometry={offset} position={[0, 6, 0]} />
      </>,
    );

    const api = taken<BodyApi<Jolt.Shape>>("body");

    // `GetLocalBounds` is measured from the centre of mass, so it reads the same
    // for a centred shape and an offset one — the centre of mass is where the
    // offset actually shows.
    const centre = api.shape.GetCenterOfMass();
    expect(centre.GetX()).toBeCloseTo(0, 2);
    expect(centre.GetY()).toBeCloseTo(1, 2);
    expect(centre.GetZ()).toBeCloseTo(0, 2);

    await step(renderer, 400);
    // Its origin is at its feet, so a resting body's origin is on the floor.
    expect(restingHeight(api)).toBeCloseTo(0, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("hulls the geometry's own points", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Shaped collider="hull" geometry={new BoxGeometry(2, 1, 3)} />
      </>,
    );

    const api = taken<BodyApi<Jolt.Shape>>("body");
    const { min, max } = localBounds(api);

    expect(max[0] - min[0]).toBeCloseTo(2, 1);
    expect(max[1] - min[1]).toBeCloseTo(1, 1);
    expect(max[2] - min[2]).toBeCloseTo(3, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("builds a static trimesh, scaled with the mesh", async () => {
    const renderer = await renderPhysics(
      <Shaped
        collider="trimesh"
        motionType="static"
        geometry={new BoxGeometry(2, 2, 2)}
        scale={[3, 1, 1]}
        position={[0, 0, 0]}
      />,
    );

    const api = taken<BodyApi<Jolt.Shape>>("body");
    const { min, max } = localBounds(api);

    expect(max[0] - min[0]).toBeCloseTo(6, 1);
    expect(max[1] - min[1]).toBeCloseTo(2, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("says which number it used for a sphere under non-uniform scale", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const renderer = await renderPhysics(
      <Shaped
        collider="sphere"
        geometry={new SphereGeometry(1, 12, 12)}
        scale={[1, 3, 1]}
      />,
    );

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("non-uniform scale"),
      ),
    ).toBe(true);

    const api = taken<BodyApi<Jolt.Shape>>("body");
    const { min, max } = localBounds(api);
    expect((max[1] - min[1]) / 2).toBeCloseTo(3, 1);

    warn.mockRestore();
    await unmount(renderer);
    expectNoAsserts();
  });

  it("warns rather than asserting when a trimesh is asked to move", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const renderer = await renderPhysics(
      <Shaped collider="trimesh" geometry={new BoxGeometry(1, 1, 1)} />,
    );

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("only allows a trimesh collider on a static body"),
      ),
    ).toBe(true);

    warn.mockRestore();
    await unmount(renderer);
  });
});
