import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";
import {
  useMutableCompound,
  type MutableCompoundExtras,
  type UseMutableCompoundOptions,
} from "@/Jolt/useMutableCompound";
import { isSameState } from "@/Jolt/internal/snapshot";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { CompoundChild } from "@/Jolt/useCompound";
import type { RaycastHit } from "@/Jolt/internal/raycast";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

type CompoundApi = BodyApi<Jolt.MutableCompoundShape> & MutableCompoundExtras;

const STEP = { timeStep: 1 / 60 };

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

const warningsFrom = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map(([message]) => String(message))
    .filter((message) => message.includes("r3f-jolt"));

const box = (position: Vec3Tuple, size = 1): CompoundChild => ({
  type: "box",
  position,
  size: [size, size, size],
});

const TWO_BOXES = [box([-1, 0, 0]), box([1, 0, 0])];

const Compound = ({
  name = "compound",
  ...options
}: Partial<UseMutableCompoundOptions> & { name?: string }) => {
  const [, api] = useMutableCompound({
    shapes: TWO_BOXES,
    position: [0, 5, 0],
    motionType: "dynamic",
    gravityFactor: 0,
    ...options,
  });

  usePublished(name, api);
  return null;
};

const Faller = ({
  name,
  position,
  stateId,
}: {
  name: string;
  position: Vec3Tuple;
  stateId?: number;
}) => {
  const [, api] = useBox({
    stateId,
    size: [1, 1, 1],
    position,
    motionType: "dynamic",
  });
  usePublished(name, api);
  return null;
};

const Ground = ({ stateId }: { stateId?: number }) => {
  useBox({
    stateId,
    size: [40, 1, 40],
    position: [0, -0.5, 0],
    motionType: "static",
  });
  return null;
};

const DownRay = ({ origin }: { origin: Vec3Tuple }) => {
  const [caster] = useClosestHitRaycaster({ origin, direction: [0, -20, 0] });
  usePublished("ray", caster);
  return null;
};

const rayY = () => {
  const hit = taken<{ cast: () => RaycastHit }>("ray").cast();
  return hit.hit ? hit.point.y : null;
};

const massOf = (api: CompoundApi) =>
  1 / api.body.GetMotionProperties().GetInverseMass();

const positionOf = (api: CompoundApi): Vec3Tuple => {
  const at = api.body.GetPosition();
  return [at.GetX(), at.GetY(), at.GetZ()];
};

const topOf = (api: CompoundApi) => {
  const position = api.geometry.getAttribute("position");
  let top = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    top = Math.max(top, position.getY(index));
  }
  return top;
};

describe("useMutableCompound", () => {
  it("keeps its mass properties sane through add, remove and adjust", async () => {
    const renderer = await renderPhysics(<Compound />, STEP);
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    const whole = massOf(compound);

    compound.removeShape(0);
    expect(massOf(compound)).toBeCloseTo(whole / 2, 2);

    compound.adjustCenterOfMass();
    expect(massOf(compound)).toBeCloseTo(whole / 2, 2);

    const centre = compound.body.GetCenterOfMassPosition();
    expect(centre.GetX()).toBeCloseTo(1, 4);
    expect(centre.GetY()).toBeCloseTo(5, 4);

    const motion = compound.body.GetMotionProperties();
    const inertia = motion.GetInverseInertiaDiagonal();
    // A lone 1 m cube of 500 kg: I = m/6, however it is held.
    const expected = 6 / massOf(compound);
    expect(inertia.GetX()).toBeCloseTo(expected, 4);
    expect(inertia.GetY()).toBeCloseTo(expected, 4);
    expect(inertia.GetZ()).toBeCloseTo(expected, 4);

    compound.addShape(box([3, 0, 0]));
    compound.adjustCenterOfMass();
    expect(massOf(compound)).toBeCloseTo(whole, 2);
    expect(compound.body.GetCenterOfMassPosition().GetX()).toBeCloseTo(2, 4);

    await step(renderer, 10);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds the body and every child still when the centre of mass moves", async () => {
    const renderer = await renderPhysics(
      <Compound position={[2, 5, -1]} />,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    const before = positionOf(compound);

    compound.removeShape(0);
    compound.adjustCenterOfMass();

    expect(positionOf(compound)).toEqual(before);
    expect(compound.getShape(0).position[0]).toBeCloseTo(1, 4);

    // A position still means the frame `shapes` was written in.
    const added = compound.addShape(box([-4, 1, 0]));
    expect(compound.getShape(added).position[0]).toBeCloseTo(-4, 4);
    expect(compound.getShape(added).position[1]).toBeCloseTo(1, 4);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("scales a given mass with what is left", async () => {
    const renderer = await renderPhysics(<Compound mass={8} />, STEP);
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    expect(massOf(compound)).toBeCloseTo(8, 3);

    compound.removeShape(1);
    expect(massOf(compound)).toBeCloseTo(4, 3);

    compound.addShape(box([1, 0, 0], 2));
    // The new child is eight times the size of the one that stayed.
    expect(massOf(compound)).toBeCloseTo(36, 2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves massProperties alone", async () => {
    const renderer = await renderPhysics(
      <Compound massProperties={{ mass: 7 }} />,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    compound.removeShape(1);
    compound.adjustCenterOfMass();
    expect(massOf(compound)).toBeCloseTo(7, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("collides and draws the new shape straight away", async () => {
    const renderer = await renderPhysics(
      <>
        <Compound motionType="static" gravityFactor={undefined} />
        <DownRay origin={[3, 20, 0]} />
      </>,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    expect(rayY()).toBeNull();
    expect(topOf(compound)).toBeCloseTo(0.5, 4);

    const index = compound.addShape(box([3, 2, 0]));
    expect(rayY()).toBeCloseTo(7.5, 3);
    expect(topOf(compound)).toBeCloseTo(2.5, 4);

    compound.modifyShape(index, [3, 4, 0]);
    expect(rayY()).toBeCloseTo(9.5, 3);
    expect(topOf(compound)).toBeCloseTo(4.5, 4);

    compound.modifyShape(index, [3, 4, 0], undefined, box([0, 0, 0], 3));
    expect(rayY()).toBeCloseTo(10.5, 3);

    compound.modifyShapes(
      1,
      [
        [-1, 0, 0],
        [3, 1, 0],
      ],
      [
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
    );
    expect(rayY()).toBeCloseTo(7.5, 3);

    compound.removeShape(index);
    expect(rayY()).toBeNull();
    expect(compound.getShapeCount()).toBe(2);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses what would break it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const renderer = await renderPhysics(
      <Compound shapes={[box([0, 0, 0])]} />,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");

    expect(compound.removeShape(0)).toBe(false);
    expect(warningsFrom(warn)).toHaveLength(1);
    expect(compound.getShapeCount()).toBe(1);

    expect(() => compound.removeShape(3)).toThrow(/index 3/);
    expect(() => compound.modifyShape(-1, [0, 0, 0])).toThrow(/index -1/);
    expect(() =>
      compound.modifyShapes(0, [[0, 0, 0]], []),
    ).toThrow(/1 positions/);

    expect(compound.addShape(box([0, 0, 0], -1))).toBe(-1);
    expect(error).toHaveBeenCalledOnce();

    await unmount(renderer);
    expectNoAsserts();

    warn.mockRestore();
    error.mockRestore();
  });

  it("lets a static compound go empty, and asks a moving one to have a child", async () => {
    const renderer = await renderPhysics(
      <Compound motionType="static" gravityFactor={undefined} />,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    expect(compound.removeShape(0)).toBe(true);
    expect(compound.removeShape(0)).toBe(true);
    expect(compound.getShapeCount()).toBe(0);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      renderPhysics(<Compound shapes={[]} />, STEP),
    ).rejects.toThrow(/at least one valid child/);
    consoleError.mockRestore();
  });

  it("wakes what rested on a child that left, and nothing further off", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Compound
          motionType="static"
          gravityFactor={undefined}
          position={[0, 2, 0]}
        />
        <Faller name="left" position={[-1, 3.1, 0]} />
        <Faller name="away" position={[15, 0.6, 0]} />
      </>,
      STEP,
    );

    await step(renderer, 240);

    const left = taken<BodyApi<Jolt.Shape>>("left");
    const away = taken<BodyApi<Jolt.Shape>>("away");
    expect(left.isSleeping()).toBe(true);
    expect(left.body.GetPosition().GetY()).toBeGreaterThan(2.9);
    expect(away.isSleeping()).toBe(true);

    taken<CompoundApi>("compound").removeShape(0);

    expect(left.isSleeping()).toBe(false);
    expect(away.isSleeping()).toBe(true);

    await step(renderer, 90);
    expect(left.body.GetPosition().GetY()).toBeLessThan(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps a spinning body's children moving as they were", async () => {
    const renderer = await renderPhysics(
      <Compound initialAngularVelocity={[0, 3, 0]} />,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    const { body } = compound;

    const read = (vector: Jolt.Vec3 | Jolt.RVec3) =>
      new Vector3(vector.GetX(), vector.GetY(), vector.GetZ());

    const velocityAtChild = () => {
      const facing = body.GetRotation();
      const rotation = new Quaternion(
        facing.GetX(),
        facing.GetY(),
        facing.GetZ(),
        facing.GetW(),
      );
      const child = new Vector3(1, 0, 0)
        .applyQuaternion(rotation)
        .add(read(body.GetPosition()));
      const arm = child.sub(read(body.GetCenterOfMassPosition()));
      const spin = read(body.GetAngularVelocity());

      return read(body.GetLinearVelocity()).add(spin.cross(arm));
    };

    const before = velocityAtChild();
    expect(before.length()).toBeGreaterThan(1);

    compound.removeShape(0);
    compound.adjustCenterOfMass();

    const after = velocityAtChild();
    expect(after.distanceTo(before)).toBeLessThan(1e-4);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("says so when a joint is left behind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const Jointed = () => {
      const [, anchor] = useBox({
        size: [1, 1, 1],
        position: [0, 8, 0],
        motionType: "static",
      });
      const [, compound] = useMutableCompound({
        shapes: TWO_BOXES,
        position: [0, 5, 0],
        motionType: "dynamic",
      });
      useHingeConstraint(anchor, compound, {
        point: [0, 7, 0],
        hingeAxis: [0, 0, 1],
        normalAxis: [1, 0, 0],
      });
      usePublished("compound", compound);
      return null;
    };

    const renderer = await renderPhysics(<Jointed />, STEP);
    await step(renderer, 2);

    const compound = taken<CompoundApi>("compound");
    compound.adjustCenterOfMass();
    expect(warningsFrom(warn)).toHaveLength(0);

    compound.removeShape(0);
    compound.adjustCenterOfMass();
    expect(warningsFrom(warn)).toHaveLength(1);
    expect(warningsFrom(warn)[0]).toMatch(/useHingeConstraint/);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
    warn.mockRestore();
  });

  it("works under a creation-time scale", async () => {
    const renderer = await renderPhysics(
      <Compound scale={[2, 2, 2]} position={[0, 5, 0]} />,
      STEP,
    );
    await step(renderer, 1);

    const compound = taken<CompoundApi>("compound");
    const before = positionOf(compound);

    compound.removeShape(0);
    compound.adjustCenterOfMass();

    expect(positionOf(compound)).toEqual(before);
    expect(compound.body.GetCenterOfMassPosition().GetX()).toBeCloseTo(2, 4);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useMutableCompound in a snapshot", () => {
  const Pile = () => (
    <>
      <Ground stateId={1} />
      <Compound
        stateId={2}
        gravityFactor={undefined}
        position={[0.3, 1.2, 0.1]}
        rotation={[0, Math.sin(0.17), 0, Math.cos(0.17)]}
        mass={40}
        initialAngularVelocity={[0.4, 1.1, -0.3]}
        shapes={[
          box([-0.71, 0.13, 0.27], 0.8),
          box([0.93, -0.11, -0.37], 1.1),
          box([0.17, 0.77, 0.51], 0.6),
          {
            type: "convex",
            position: [-0.13, -0.53, 0.91],
            vertices: [
              [0, 0, 0],
              [0.7, 0, 0],
              [0, 0.7, 0],
              [0, 0, 0.7],
              [0.5, 0.5, 0.2],
            ],
          },
        ]}
      />
      <Faller name="rider" stateId={3} position={[1.1, 3.2, -0.2]} />
    </>
  );

  const edits = (compound: CompoundApi) => {
    compound.removeShape(1);
    compound.adjustCenterOfMass();
    compound.addShape(box([1.37, 0.41, -0.77], 0.7));
    compound.modifyShape(0, [-0.91, 0.23, 0.17], [0, 0.3827, 0, 0.9239]);
  };

  it("restores the shape to the byte", async () => {
    const renderer = await renderPhysics(<Pile />, STEP);
    await step(renderer, 20);

    const api = getApi();
    const compound = taken<CompoundApi>("compound");

    const saved = api.saveState();
    const count = compound.getShapeCount();
    const mass = massOf(compound);
    const position = positionOf(compound);

    edits(compound);
    expect(isSameState(api.saveState(), saved)).toBe(false);
    await step(renderer, 15);

    api.restoreState(saved);
    expect(isSameState(api.saveState(), saved)).toBe(true);
    expect(compound.getShapeCount()).toBe(count);
    expect(massOf(compound)).toBe(mass);
    expect(positionOf(compound)).toEqual(position);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("replays exactly across an edit", async () => {
    const renderer = await renderPhysics(<Pile />, STEP);
    await step(renderer, 20);

    const api = getApi();
    const compound = taken<CompoundApi>("compound");

    const saved = api.saveState();

    edits(compound);
    await step(renderer, 30);
    const first = api.saveState();
    await step(renderer, 30);
    const firstLater = api.saveState();

    api.restoreState(saved);
    edits(compound);
    await step(renderer, 30);
    expect(isSameState(api.saveState(), first)).toBe(true);
    await step(renderer, 30);
    expect(isSameState(api.saveState(), firstLater)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("restores into a compound that has moved on since", async () => {
    const renderer = await renderPhysics(<Pile />, STEP);
    await step(renderer, 10);

    const api = getApi();
    const compound = taken<CompoundApi>("compound");

    edits(compound);
    await step(renderer, 10);
    const edited = api.saveState();
    const geometryCount = compound.geometry.getAttribute("position").count;

    compound.removeShape(0);
    compound.removeShape(0);
    compound.adjustCenterOfMass();
    await step(renderer, 10);

    api.restoreState(edited);
    expect(isSameState(api.saveState(), edited)).toBe(true);
    expect(compound.geometry.getAttribute("position").count).toBe(geometryCount);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a child this compound never held", async () => {
    const first = await renderPhysics(<Pile />, STEP);
    await step(first, 2);

    const compound = taken<CompoundApi>("compound");
    compound.addShape(box([2, 2, 2]));
    const saved = getApi().saveState();
    await unmount(first);

    const second = await renderPhysics(<Pile />, STEP);
    await step(second, 2);
    expect(() => getApi().restoreState(saved)).toThrow(/never held/);

    await unmount(second);
    expectNoAsserts();
  });
});
