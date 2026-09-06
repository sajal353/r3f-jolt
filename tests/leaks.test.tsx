import { useRef } from "react";
import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import {
  BoxGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { useFrame } from "@react-three/fiber";
import { useCar } from "@/Jolt/useCar";
import { useCharacter } from "@/Jolt/useCharacter";
import { useBox } from "@/Jolt/useBox";
import { useConveyor } from "@/Jolt/useConveyor";
import { useSphere } from "@/Jolt/useSphere";
import { useShapeCaster } from "@/Jolt/useShapeCaster";
import { useShapeOverlap } from "@/Jolt/useShapeOverlap";
import { usePointQuery } from "@/Jolt/usePointQuery";
import { useBroadphaseQuery } from "@/Jolt/useBroadphaseQuery";
import { useFixedConstraint } from "@/Jolt/useFixedConstraint";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import { useConeConstraint } from "@/Jolt/useConeConstraint";
import { useSwingTwistConstraint } from "@/Jolt/useSwingTwistConstraint";
import { useSixDOFConstraint } from "@/Jolt/useSixDOFConstraint";
import { useSensor } from "@/Jolt/useSensor";
import { useGroupFilterTable } from "@/Jolt/useGroupFilterTable";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useInstancedBodies } from "@/Jolt/useInstancedBodies";
import { useAutoCollider } from "@/Jolt/useAutoCollider";
import {
  addBodies,
  destroyBodies,
  removeBodies,
} from "@/Jolt/internal/batchBodies";
import type { GroupFilterTableApi } from "@/Jolt/useGroupFilterTable";
import type { Vec3Tuple } from "@/Jolt/types";
import { applyPhysicsSettings } from "@/Jolt/internal/physicsSettings";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const Ground = () => {
  useBox({ size: [50, 1, 50], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const direction = new Vector3(1, 0, 0);

const Character = () => {
  const [api] = useCharacter({
    position: [0, 3, 0],
    options: { height: { standing: 1.8, crouching: 0.9 } },
  });

  useFrame((_, delta) => {
    api?.update(direction, false, false, delta);
  });

  return null;
};

const CrouchingCharacter = () => {
  const [api] = useCharacter({ position: [0, 3, 0] });
  const frame = useRef(0);

  useFrame((_, delta) => {
    frame.current += 1;
    const n = frame.current;
    api?.update(direction, n % 30 === 0, n % 20 < 10, delta);
  });

  return null;
};

const Car = () => {
  const [api] = useCar({
    position: [0, 2, 0],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.3,
      width: 0.2,
      offsetForward: 1.2,
      offsetDown: 0.3,
    },
  });

  useFrame(() => {
    api?.update({
      forward: true,
      backward: false,
      left: false,
      right: true,
      handbrake: false,
      modifier: true,
    });
  });

  return null;
};

const Conveyor = () => {
  const [, api] = useBox({
    size: [10, 1, 10],
    position: [0, 0.5, 0],
    motionType: "static",
    material: { friction: 1 },
  });

  const conveyor = useConveyor(api, { linear: [3, 0, 0] });
  const frame = useRef(0);

  useFrame(() => {
    frame.current += 1;
    conveyor?.setLinear([frame.current % 2 === 0 ? 3 : -3, 0, 0]);
  });

  useBox({
    size: [1, 1, 1],
    position: [0, 2, 0],
    motionType: "dynamic",
    mass: 5,
    material: { friction: 1 },
  });

  return null;
};

const useJointedPair = () => {
  const [, anchor] = useBox({
    size: [0.4, 0.4, 0.4],
    position: [0, 6, 0],
    motionType: "static",
  });
  const [, hanging] = useBox({
    size: [1, 1, 1],
    position: [0, 4, 0],
    motionType: "dynamic",
    mass: 5,
  });

  return { anchor, hanging };
};

/**
 * `AddConstraint` takes the only reference, so a missing `Release` — or a
 * `destroy` where a `Release` belongs — shows up here and nowhere else: there is
 * no `GetNumConstraints` to count against.
 */
const Joints = () => {
  const { anchor, hanging } = useJointedPair();
  const point: Vec3Tuple = [0, 5, 0];

  useFixedConstraint(anchor, hanging);
  usePointConstraint(anchor, hanging, { point });
  useHingeConstraint(anchor, hanging, {
    point,
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    limits: { min: -0.5, max: 0.5 },
    limitsSpring: { frequency: 5, damping: 0.5 },
    motor: { state: "velocity", targetAngularVelocity: 1, maxTorqueLimit: 500 },
  });
  useSliderConstraint(anchor, hanging, {
    point,
    sliderAxis: [1, 0, 0],
    normalAxis: [0, 1, 0],
    limits: { min: -1, max: 1 },
    motor: { state: "position", targetPosition: 0.5 },
  });
  useDistanceConstraint(anchor, hanging, { point, maxDistance: 3 });
  useConeConstraint(anchor, hanging, {
    point,
    twistAxis: [0, 1, 0],
    halfConeAngle: 0.4,
  });
  useSwingTwistConstraint(anchor, hanging, {
    position: point,
    twistAxis: [0, 1, 0],
    planeAxis: [1, 0, 0],
    normalHalfConeAngle: 0.3,
    swingMotor: { state: "velocity", maxTorqueLimit: 100 },
    targetAngularVelocity: [0, 1, 0],
  });
  useSixDOFConstraint(anchor, hanging, {
    position: point,
    axes: {
      translationX: { limits: { min: -1, max: 1 }, maxFriction: 2 },
      translationY: { limits: "fixed" },
      rotationZ: {
        limits: "free",
        motor: { state: "velocity", maxTorqueLimit: 50 },
      },
    },
    targetAngularVelocity: [0, 0, 1],
  });

  return null;
};

const DebuggedJoint = () => {
  const { anchor, hanging } = useJointedPair();

  useHingeConstraint(anchor, hanging, {
    point: [0, 5, 0],
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
    debug: true,
  });

  return null;
};

/**
 * Every query hook at once, each in a different mode, plus a few hundred calls
 * of each. Two different leaks are possible here and only one of them shows on
 * a mount cycle: the hand-rolled `*JS` broadphase collectors are torn down per
 * mount, but a Jolt object allocated *per call* would only show under repeated
 * casting.
 */
const Queries = () => {
  const [, sphere] = useSphere({
    radius: 0.5,
    position: [0, 4, 0],
    motionType: "static",
  });

  const shape = sphere?.shape;

  const [caster] = useShapeCaster({
    shape,
    mode: "all",
    direction: [0, -8, 0],
  });
  const [probe] = useShapeOverlap({ shape, mode: "all" });
  const [point] = usePointQuery({ mode: "all" });
  const [broad] = useBroadphaseQuery();

  useFrame(() => {
    caster?.cast([0, 4, 0]);
    probe?.overlap([0, 0.5, 0]);
    point?.query([0, 0, 0]);
    broad?.collideAABox([-2, -2, -2], [2, 2, 2]);
    broad?.collideSphere([0, 0, 0], 2);
    broad?.collidePoint([0, 0, 0]);
    broad?.collideOrientedBox([0, 0, 0], [1, 1, 1]);
    broad?.castRay([0, 6, 0], [0, -12, 0]);
    broad?.castAABox([-1, 5, -1], [1, 6, 1], [0, -12, 0]);
  });

  return null;
};

/**
 * `GroupFilterTable` is the wave's only new `RefTarget`, and the bodies holding
 * it take references of their own — so a `destroy()` where a `Release()` belongs
 * is a double free rather than a leak. Flat across cycles is what proves the
 * pairing.
 */
const Filtered = ({ table }: { table: GroupFilterTableApi }) => {
  useSphere({
    position: [0, 2, 0],
    radius: 0.5,
    motionType: "dynamic",
    collisionGroup: { filter: table.filter, groupID: 0, subGroupID: 1 },
  });

  useSphere({
    position: [0, 4, 0],
    radius: 0.5,
    motionType: "dynamic",
    collisionGroup: { filter: table.filter, groupID: 0, subGroupID: 2 },
  });

  return null;
};

const GroupFilter = () => {
  const table = useGroupFilterTable(4, (built) => built.disableCollision(1, 2));
  return table ? <Filtered table={table} /> : null;
};

/**
 * The sensor hook builds a `BodyID` per sleep check and frees it again; a
 * body that settles inside the volume exercises that path every frame.
 */
const Sensor = () => {
  const [, sensor] = useBox({
    position: [0, 1.5, 0],
    size: [4, 3, 4],
    motionType: "static",
    sensor: true,
  });

  useSensor(sensor?.body, {});

  useSphere({ position: [0, 3, 0], radius: 0.5, motionType: "dynamic" });

  return null;
};

/** The force estimate allocates nothing, and this is what says so. */
const ContactForce = () => {
  const [, api] = useSphere({
    position: [0, 4, 0],
    radius: 0.5,
    motionType: "dynamic",
    allowSleeping: false,
  });

  useBodyContacts(api?.body, { onEnter: () => {}, onStay: () => {} }, {
    contactForce: true,
  });

  return null;
};

/**
 * The batch path is the wave's only code with no upstream reference — the Jolt
 * examples add bodies one at a time — so its leak cycle carries more weight than
 * most. It is also where `BodyInterface_AddState` would show up if it turned out
 * to be ours to free after all.
 */
const Swarm = () => {
  const [ref, api] = useInstancedBodies({
    count: 40,
    collider: { type: "box", size: [0.4, 0.4, 0.4] },
    transforms: (index) => ({
      position: [(index % 8) - 4, 3 + Math.floor(index / 8), 0],
    }),
    motionType: "dynamic",
  });

  void api;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 40]}>
      <meshStandardMaterial />
    </instancedMesh>
  );
};

/** Every derivation mode, including the two that wrap the collider. */
const AutoColliders = () => (
  <>
    <AutoCollider collider="box" geometry={new BoxGeometry(1, 2, 1)} />
    <AutoCollider collider="sphere" geometry={new SphereGeometry(0.6, 12, 12)} />
    <AutoCollider collider="hull" geometry={new BoxGeometry(1, 1, 2)} />
    <AutoCollider collider="offset" geometry={offsetGeometry()} />
  </>
);

const offsetGeometry = () => {
  const geometry = new BoxGeometry(1, 2, 1);
  geometry.translate(0, 1, 0);
  return geometry;
};

const AutoCollider = ({
  collider,
  geometry,
}: {
  collider: "box" | "sphere" | "hull" | "offset";
  geometry: BufferGeometry;
}) => {
  const [ref] = useAutoCollider({
    collider: collider === "offset" ? "box" : collider,
    position: [0, 5, 0],
    motionType: "dynamic",
  });

  return (
    <mesh ref={ref} geometry={geometry} scale={[1.5, 1.5, 1.5]}>
      <meshStandardMaterial />
    </mesh>
  );
};

const cycles = async (element: React.ReactElement, frames: number) => {
  const module = await loadDebugModule();

  const run = async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        {element}
      </>,
    );
    await step(renderer, frames);
    await unmount(renderer);
  };

  await run();
  const baseline = module.JoltInterface.prototype.sGetFreeMemory();

  for (let i = 0; i < 4; i += 1) await run();

  return {
    baseline,
    after: module.JoltInterface.prototype.sGetFreeMemory(),
  };
};

describe("mount/unmount leak checks", () => {
  it("useCharacter leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Character />, 30);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useCharacter crouch toggling does not leak", async () => {
    const { baseline, after } = await cycles(<CrouchingCharacter />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useCar leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Car />, 30);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useConveyor leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Conveyor />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("all eight constraint hooks leave the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Joints />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("a debug-drawn constraint leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<DebuggedJoint />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  /**
   * `GetPhysicsSettings()` may hand back the system's own struct or a heap copy
   * we then own, and the bindings do not say which. Two hundred applications
   * with the heap flat is the answer: it is borrowed, and destroying it would
   * be the double free rather than the fix.
   *
   * The step registry is deliberately absent from this file — it creates no
   * Jolt objects at all, so there is nothing here for it to leak.
   */
  it("useGroupFilterTable leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<GroupFilter />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useSensor leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Sensor />, 120);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("the contact force estimate leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<ContactForce />, 120);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useInstancedBodies leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Swarm />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useAutoCollider leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<AutoColliders />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  /**
   * Memory is asserted per *world*, above: measured, the debug build's free
   * counter walks down in 32 KiB steps as the world does work at all — two
   * hundred steps of an empty world cost one — so in-world flatness says
   * nothing, while flatness across a whole mount/unmount cycle says everything.
   * What repetition inside one world does prove is that prepare, finalize,
   * remove and destroy stay paired: an unmatched one strands bodies in the
   * world, and the debug build asserts on a mismatched batch.
   */
  it("repeated batch add and remove returns every body", async () => {
    const renderer = await renderPhysics(<Ground />);
    const api = getApi();
    const { Jolt: jolt, bodyInterface, layers, physicsSystem } = api;

    const baseline = physicsSystem.GetNumBodies();

    const half = new jolt.Vec3(0.3, 0.3, 0.3);
    const shape = new jolt.BoxShape(half, 0.03, undefined);
    shape.AddRef();
    jolt.destroy(half);

    const position = new jolt.RVec3(0, 8, 0);
    const rotation = new jolt.Quat(0, 0, 0, 1);
    const settings = new jolt.BodyCreationSettings(
      shape,
      position,
      rotation,
      jolt.EMotionType_Dynamic,
      layers.LAYER_MOVING,
    );

    for (let round = 0; round < 100; round += 1) {
      const bodies: Jolt.Body[] = [];

      for (let index = 0; index < 25; index += 1) {
        position.Set(index - 12, 8, 0);
        settings.mPosition = position;
        bodies.push(bodyInterface.CreateBody(settings));
      }

      const ids = addBodies(api, bodies, true);
      expect(physicsSystem.GetNumBodies()).toBe(baseline + 25);

      removeBodies(api, ids);
      destroyBodies(api, ids);
      expect(physicsSystem.GetNumBodies()).toBe(baseline);
    }

    jolt.destroy(settings);
    jolt.destroy(position);
    jolt.destroy(rotation);
    shape.Release();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("re-applying physicsSettings leaves the heap flat", async () => {
    const module = await loadDebugModule();

    const renderer = await renderPhysics(<Ground />, {
      physicsSettings: { numVelocitySteps: 8 },
    });

    const { physicsSystem } = getApi();
    applyPhysicsSettings(physicsSystem, { numVelocitySteps: 9 });
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 200; i += 1) {
      applyPhysicsSettings(physicsSystem, { numVelocitySteps: 8 + (i % 4) });
    }

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("the query hooks leave the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Queries />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("a driven character actually moves", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Character />
      </>,
    );

    await step(renderer, 90);
    await unmount(renderer);
    expectNoAsserts();
  });
});
