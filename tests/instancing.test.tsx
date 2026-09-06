import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import { usePlane } from "@/Jolt/usePlane";
import { useInstancedBodies } from "@/Jolt/useInstancedBodies";
import type { InstancedBodiesApi } from "@/Jolt/useInstancedBodies";
import type { ColliderSource } from "@/Jolt/internal/colliderShape";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

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

const spread = (index: number) => ({
  position: [index * 2 - 6, 4 + index, 0] as Vec3Tuple,
});

const Swarm = ({
  count = 6,
  collider = { type: "box", size: [1, 1, 1] } as ColliderSource,
  name = "swarm",
}: {
  count?: number;
  collider?: ColliderSource;
  name?: string;
}) => {
  const [ref, api] = useInstancedBodies({
    count,
    collider,
    transforms: spread,
    motionType: "dynamic",
  });

  usePublished(name, api);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <meshStandardMaterial />
    </instancedMesh>
  );
};

const positionOf = (body: Jolt.Body): Vec3Tuple => {
  const at = body.GetPosition();
  return [at.GetX(), at.GetY(), at.GetZ()];
};

describe("useInstancedBodies", () => {
  it("adds every instance in one batch and removes them all", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Swarm count={24} />
      </>,
    );

    const api = getApi();
    const before = api.physicsSystem.GetNumBodies();
    const swarm = taken<InstancedBodiesApi>("swarm");

    expect(swarm.count).toBe(24);
    expect(swarm.bodies).toHaveLength(24);
    expect(swarm.ids).toHaveLength(24);
    expect(new Set(swarm.ids).size).toBe(24);
    // The ground plus the swarm, and every one of them actually in the world.
    expect(before).toBe(25);

    await step(renderer, 30);
    expect(api.physicsSystem.GetNumBodies()).toBe(25);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps instance order through Jolt's own sort", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Swarm count={8} />
      </>,
    );

    const swarm = taken<InstancedBodiesApi>("swarm");

    // AddBodiesPrepare sorts the id array it is handed, so this is the check
    // that index 3 is still the body transform 3 described.
    for (let index = 0; index < swarm.count; index += 1) {
      const [x] = positionOf(swarm.bodies[index]);
      expect(x).toBeCloseTo(spread(index).position[0], 3);
      expect(swarm.at(index)?.body).toBe(swarm.bodies[index]);
      expect(swarm.at(index)?.id).toBe(swarm.ids[index]);
    }

    expect(swarm.at(8)).toBeUndefined();
    expect(swarm.at(-1)).toBeUndefined();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("moves the instance an impulse was aimed at, and no other", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Swarm count={6} />
      </>,
    );

    await step(renderer, 120);
    const swarm = taken<InstancedBodiesApi>("swarm");

    const before = swarm.bodies.map(positionOf);

    // Jolt ignores an impulse on a sleeping body, so waking it is part of the
    // gesture rather than an oversight — and it exercises `wake()`.
    expect(swarm.at(2)?.isSleeping()).toBe(true);
    swarm.at(2)?.wake();
    // A 1 m cube at Jolt's default density is 1000 kg, so the impulse is
    // scaled to it: 3000 kg·m/s is 3 m/s.
    swarm.at(2)?.applyImpulse([0, 0, 3000]);
    await step(renderer, 20);
    const after = swarm.bodies.map(positionOf);

    expect(after[2][2] - before[2][2]).toBeGreaterThan(0.5);

    for (const index of [0, 1, 3, 4, 5]) {
      expect(Math.abs(after[index][2] - before[index][2])).toBeLessThan(0.05);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("settles on the ground and stops writing", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Swarm count={6} />
      </>,
    );

    await step(renderer, 400);

    const api = getApi();
    const swarm = taken<InstancedBodiesApi>("swarm");

    for (const body of swarm.bodies) {
      expect(positionOf(body)[1]).toBeCloseTo(0.5, 1);
    }

    expect(
      api.physicsSystem.GetNumActiveBodies(api.Jolt.EBodyType_RigidBody),
    ).toBe(0);
    expect(swarm.at(0)?.isSleeping()).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes a collider factory for anything the descriptors do not cover", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Swarm
          count={4}
          name="spheres"
          collider={(jolt) => {
            const settings = new jolt.SphereShapeSettings(0.6, undefined);
            const result = settings.Create();
            jolt.destroy(settings);
            const shape = result.Get();
            shape.AddRef();
            result.Clear();
            return { shape, geometry: new BufferGeometry() };
          }}
        />
      </>,
    );

    await step(renderer, 400);
    const swarm = taken<InstancedBodiesApi>("spheres");

    // The factory's own sphere, not a descriptor's: they rest on its radius.
    for (const body of swarm.bodies) {
      expect(positionOf(body)[1]).toBeCloseTo(0.6, 1);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("survives a StrictMode double mount", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Swarm count={10} />
      </>,
      { strict: true },
    );

    const api = getApi();
    await step(renderer, 10);
    expect(api.physicsSystem.GetNumBodies()).toBe(11);

    await unmount(renderer);
    expectNoAsserts();
  });
});
