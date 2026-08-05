import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import type { AxisTriple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const STEP_DISTANCE = 0.02;
const PHYSICS_DELTA = 1 / 60;

const KinematicPlatform = ({
  start = 0,
  deltaTime,
}: {
  start?: number;
  deltaTime?: number;
}) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [start, 0, 0],
    motionType: "kinematic",
  });

  const travelled = useRef(start);

  useFrame(() => {
    if (!api) return;
    travelled.current += STEP_DISTANCE;
    api.moveKinematic([travelled.current, 0, 0], [0, 0, 0, 1], deltaTime);
  });

  return null;
};

const PushTarget = () => {
  useBox({
    size: [1, 1, 1],
    position: [2, 0, 0],
    motionType: "dynamic",
    mass: 1,
  });
  return null;
};

const SpinningBox = ({
  lockRotations,
  enabledRotations,
}: {
  lockRotations?: boolean;
  enabledRotations?: AxisTriple;
}) => {
  useBox({
    size: [1, 1, 1],
    position: [0, 0, 0],
    motionType: "dynamic",
    mass: 1,
    initialAngularVelocity: [3, 3, 3],
    lockRotations,
    enabledRotations,
  });
  return null;
};

const SensorVolume = ({ onEnter }: { onEnter: () => void }) => {
  const [, sensor] = useBox({
    size: [4, 1, 4],
    position: [0, 0, 0],
    motionType: "static",
    sensor: true,
  });

  useBodyContacts(sensor?.body, { onEnter });

  useBox({
    size: [0.5, 0.5, 0.5],
    position: [0, 3, 0],
    motionType: "dynamic",
    mass: 1,
  });

  return null;
};

const bodiesOfType = (motionType: Jolt.EMotionType) => {
  const { physicsSystem, Jolt } = getApi();
  const ids = new Jolt.BodyIDVector();
  physicsSystem.GetBodies(ids);
  const bodyInterface = physicsSystem.GetBodyInterface();

  const matched: Jolt.BodyID[] = [];
  for (let i = 0; i < ids.size(); i += 1) {
    const id = ids.at(i);
    if (bodyInterface.GetMotionType(id) === motionType) {
      matched.push(id);
    }
  }

  return { matched, bodyInterface, release: () => Jolt.destroy(ids) };
};

const dynamicBodies = () => {
  const { Jolt } = getApi();
  const { matched, bodyInterface, release } = bodiesOfType(
    Jolt.EMotionType_Dynamic,
  );
  return { dynamic: matched, bodyInterface, release };
};

const kinematicBody = () => {
  const { Jolt } = getApi();
  const { matched, bodyInterface, release } = bodiesOfType(
    Jolt.EMotionType_Kinematic,
  );
  return { id: matched[0], count: matched.length, bodyInterface, release };
};

describe("kinematic bodies", () => {
  it("defaults to the moving layer, not the static one", async () => {
    const renderer = await renderPhysics(<KinematicPlatform />);
    const { layers } = getApi();

    // A kinematic body inheriting the static defaults lands in
    // GROUP_NON_MOVING and silently stops colliding with the static world.
    const { id, count, bodyInterface, release } = kinematicBody();
    expect(count).toBe(1);
    const layer = bodyInterface.GetObjectLayer(id);
    release();

    expect(layer).toBe(layers.LAYER_MOVING);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("is added activated, so it moves without being touched first", async () => {
    const renderer = await renderPhysics(<KinematicPlatform />);

    const { id, bodyInterface, release } = kinematicBody();
    const active = bodyInterface.IsActive(id);
    release();

    expect(active).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("gains the velocity implied by moveKinematic", async () => {
    const renderer = await renderPhysics(<KinematicPlatform />, {
      gravity: [0, 0, 0],
    });

    await step(renderer, 10);

    const { id, bodyInterface, release } = kinematicBody();
    const velocityX = bodyInterface.GetLinearVelocity(id).GetX();
    release();

    expect(velocityX).toBeCloseTo(STEP_DISTANCE / PHYSICS_DELTA, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  // The omitted deltaTime above is the whole point. Hand it a shorter clock —
  // render delta under a fixed timestep, say — and the error compounds rather
  // than merely scaling: the body overshoots, and the next correction is
  // computed from the overshot position, so the drive runs away.
  it("runs away when handed a delta shorter than the step", async () => {
    const renderer = await renderPhysics(
      <KinematicPlatform deltaTime={PHYSICS_DELTA / 4} />,
      { gravity: [0, 0, 0] },
    );

    await step(renderer, 10);

    const { id, bodyInterface, release } = kinematicBody();
    const velocityX = bodyInterface.GetLinearVelocity(id).GetX();
    release();

    expect(Math.abs(velocityX)).toBeGreaterThan(
      100 * (STEP_DISTANCE / PHYSICS_DELTA),
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("tracks a varying timestep rather than a configured one", async () => {
    const renderer = await renderPhysics(<KinematicPlatform />, {
      gravity: [0, 0, 0],
      timeStep: "vary",
    });

    await step(renderer, 10, 1 / 120);

    const { id, bodyInterface, release } = kinematicBody();
    const velocityX = bodyInterface.GetLinearVelocity(id).GetX();
    release();

    expect(velocityX).toBeCloseTo(STEP_DISTANCE * 120, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("pushes a dynamic body it is driven into", async () => {
    const renderer = await renderPhysics(
      <>
        <KinematicPlatform />
        <PushTarget />
      </>,
      { gravity: [0, 0, 0] },
    );

    await step(renderer, 120);

    const { dynamic, bodyInterface, release } = dynamicBodies();
    expect(dynamic).toHaveLength(1);
    const pushedX = bodyInterface.GetPosition(dynamic[0]).GetX();
    release();

    expect(pushedX).toBeGreaterThan(2.1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("degrees of freedom", () => {
  it("spins freely by default", async () => {
    const renderer = await renderPhysics(<SpinningBox />, {
      gravity: [0, 0, 0],
    });

    await step(renderer, 5);

    const { dynamic, bodyInterface, release } = dynamicBodies();
    const angular = bodyInterface.GetAngularVelocity(dynamic[0]);
    const spin = Math.abs(angular.GetX()) + Math.abs(angular.GetZ());
    release();

    expect(spin).toBeGreaterThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lockRotations pins every rotational axis", async () => {
    const renderer = await renderPhysics(<SpinningBox lockRotations />, {
      gravity: [0, 0, 0],
    });

    await step(renderer, 5);

    const { dynamic, bodyInterface, release } = dynamicBodies();
    const angular = bodyInterface.GetAngularVelocity(dynamic[0]);
    const spin =
      Math.abs(angular.GetX()) +
      Math.abs(angular.GetY()) +
      Math.abs(angular.GetZ());
    release();

    expect(spin).toBeCloseTo(0, 5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("enabledRotations leaves exactly the requested axis free", async () => {
    const renderer = await renderPhysics(
      <SpinningBox enabledRotations={[false, true, false]} />,
      { gravity: [0, 0, 0] },
    );

    await step(renderer, 5);

    const { dynamic, bodyInterface, release } = dynamicBodies();
    const angular = bodyInterface.GetAngularVelocity(dynamic[0]);
    const [x, y, z] = [angular.GetX(), angular.GetY(), angular.GetZ()];
    release();

    expect(x).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
    expect(Math.abs(y)).toBeGreaterThan(0.1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("sensors", () => {
  it("reports contacts but lets the body pass through", async () => {
    const onEnter = vi.fn();
    const renderer = await renderPhysics(<SensorVolume onEnter={onEnter} />);

    await step(renderer, 120);

    const { dynamic, bodyInterface, release } = dynamicBodies();
    const fallenY = bodyInterface.GetPosition(dynamic[0]).GetY();
    release();

    expect(onEnter).toHaveBeenCalled();
    expect(fallenY).toBeLessThan(-1);

    await unmount(renderer);
    expectNoAsserts();
  });
});
