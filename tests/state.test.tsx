import { useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Mesh,
  type Object3D,
} from "three";
import { useFrame } from "@react-three/fiber";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import {
  useHingeConstraint,
  type HingeConstraintApi,
} from "@/Jolt/useHingeConstraint";
import { useDistanceConstraint } from "@/Jolt/useDistanceConstraint";
import { useInstancedBodies } from "@/Jolt/useInstancedBodies";
import { useSoftBody } from "@/Jolt/useSoftBody";
import { useCar, type CarApi } from "@/Jolt/useCar";
import { useCharacter, type CharacterApi } from "@/Jolt/useCharacter";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import { useRagdoll, type RagdollApi } from "@/Jolt/useRagdoll";
import { isSameState } from "@/Jolt/internal/snapshot";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { ConstraintApi } from "@/Jolt/internal/useConstraint";
import {
  expectNoAsserts,
  getApi,
  Refused,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";
import { loadMannequin } from "./mannequin";

const TILT = new Quaternion()
  .setFromAxisAngle(new Vector3(1, 2, 0).normalize(), 0.3)
  .toArray() as [number, number, number, number];

const bodies = new Map<string, BodyApi<Jolt.Shape>>();
const joints = new Map<string, ConstraintApi<Jolt.Constraint>>();
const meshes = new Map<string, Mesh | null>();

const Floor = ({ stateId }: { stateId?: number }) => {
  useBox({
    stateId,
    size: [40, 1, 40],
    position: [0, -0.5, 0],
    motionType: "static",
  });
  return null;
};

const Crate = ({
  name,
  stateId,
  position,
}: {
  name: string;
  stateId?: number;
  position: [number, number, number];
}) => {
  const [ref, api] = useBox({
    stateId,
    size: [1, 1, 1],
    position,
    rotation: TILT,
    motionType: "dynamic",
  });

  useEffect(() => {
    if (api) bodies.set(name, api);
    meshes.set(name, ref.current);
  }, [api, name, ref]);

  return <mesh ref={ref} />;
};

const Hinge = ({
  name,
  stateId,
  from,
  to,
}: {
  name: string;
  stateId?: number;
  from: string;
  to: string;
}) => {
  const [api] = useHingeConstraint(
    bodies.get(from),
    bodies.get(to),
    {
      stateId,
      point: [0, 4, 0],
      hingeAxis: [0, 0, 1],
      normalAxis: [1, 0, 0],
      motor: { state: "velocity", targetAngularVelocity: 2, maxTorqueLimit: 50 },
    },
  );

  useEffect(() => {
    if (api) joints.set(name, api as ConstraintApi<Jolt.Constraint>);
  }, [api, name]);

  return null;
};

/**
 * The same pile and the same joints, mounted in either order: four crates, a
 * hinge from `a` to `b` and a rope from `b` to `c`. Sharing `b` puts both
 * joints in one island, where the order they are solved in shows.
 */
const Pile = ({ reversed = false }: { reversed?: boolean }) => {
  const crates = [
    <Crate key="a" name="a" stateId={1} position={[-1, 3, 0]} />,
    <Crate key="b" name="b" stateId={2} position={[1, 4, 0]} />,
    <Crate key="c" name="c" stateId={3} position={[0, 6, 0.2]} />,
    <Crate key="d" name="d" stateId={4} position={[0.3, 8, -0.2]} />,
  ];
  return (
    <>
      <Floor stateId={0} />
      {reversed ? crates.reverse() : crates}
    </>
  );
};

const Joints = ({ reversed = false }: { reversed?: boolean }) => {
  const list = [
    <Hinge key="h" name="h" stateId={7} from="a" to="b" />,
    <Rope key="r" name="r" stateId={3} from="b" to="c" />,
  ];
  return <>{reversed ? list.reverse() : list}</>;
};

const Rope = ({
  name,
  stateId,
  from,
  to,
}: {
  name: string;
  stateId?: number;
  from: string;
  to: string;
}) => {
  const [api] = useDistanceConstraint(bodies.get(from), bodies.get(to), {
    stateId,
    point1: [1, 4, 0],
    point2: [0, 6, 0.2],
  });

  useEffect(() => {
    if (api) joints.set(name, api as ConstraintApi<Jolt.Constraint>);
  }, [api, name]);

  return null;
};

/** Bodies first, then the joints on the next render, once they exist. */
const mountPile = async (reversed = false) => {
  bodies.clear();
  joints.clear();
  const renderer = await renderPhysics(<Pile reversed={reversed} />);
  await updatePhysics(
    renderer,
    <>
      <Pile reversed={reversed} />
      <Joints reversed={reversed} />
    </>,
  );
  return renderer;
};

const position = (name: string) => {
  const at = bodies.get(name)!.body.GetPosition();
  return [at.GetX(), at.GetY(), at.GetZ()];
};

describe("saveState / restoreState", () => {
  it("rewinds: restore and re-run reproduces the same bytes", async () => {
    const renderer = await mountPile();
    await step(renderer, 20);

    const api = getApi();
    const early = api.saveState();
    const stepAtSave = api.timing.stepCount;
    await step(renderer, 30);
    const late = api.saveState();
    const lateA = position("a");

    api.restoreState(early);
    expect(api.timing.stepCount).toBe(stepAtSave);
    expect(position("a")).not.toEqual(lateA);

    await step(renderer, 30);
    expect(position("a")).toEqual(lateA);
    expect(isSameState(api.saveState(), late)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("runs the same scene twice to the same bytes", async () => {
    const first = await mountPile();
    await step(first, 60);
    const a = getApi().saveState();
    await unmount(first);

    const second = await mountPile();
    await step(second, 60);
    const b = getApi().saveState();
    await unmount(second);

    expect(b.length).toBeGreaterThan(500);
    expect(isSameState(a, b)).toBe(true);
    expectNoAsserts();
  });

  it("carries over to a world mounted in the opposite order", async () => {
    const first = await mountPile();
    await step(first, 20);
    const snapshot = getApi().saveState();
    await step(first, 40);
    const expected = getApi().saveState();
    await unmount(first);

    const second = await mountPile(true);
    await step(second, 3);
    getApi().restoreState(snapshot);
    await step(second, 40);
    const actual = getApi().saveState();
    await unmount(second);

    expect(isSameState(actual, expected)).toBe(true);
    expectNoAsserts();
  });

  it("names the bodies without a stateId", async () => {
    bodies.clear();
    const renderer = await renderPhysics(
      <>
        <Floor stateId={0} />
        <Crate name="a" position={[0, 3, 0]} />
        <Crate name="b" position={[0, 5, 0]} />
      </>,
    );

    expect(() => getApi().saveState()).toThrow(
      /2 things have none: a body from useBox ×2/,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a snapshot of a different world, listing what differs", async () => {
    const first = await mountPile();
    const snapshot = getApi().saveState();
    await unmount(first);

    bodies.clear();
    const second = await renderPhysics(
      <>
        <Floor stateId={0} />
        <Crate name="a" stateId={1} position={[-1, 3, 0]} />
        <Crate name="z" stateId={9} position={[1, 4, 0]} />
      </>,
    );

    expect(() => getApi().restoreState(snapshot)).toThrow(
      /bodies 2, 3, 4 not in the world; bodies 9 not in the snapshot.*constraints 3, 7 not in the world/,
    );
    expect(() => getApi().restoreState(new Uint8Array(40))).toThrow(
      /not a snapshot/,
    );

    await unmount(second);
    expectNoAsserts();
  });

  it("refuses a stateId another body holds, naming it", async () => {
    bodies.clear();
    const renderer = await renderPhysics(
      <>
        <Floor stateId={0} />
        <Crate name="a" stateId={1} position={[0, 3, 0]} />
      </>,
    );

    expect(() => getApi().stateIds.check(1, "useSphere")).toThrow(
      /useSphere stateId 1 is taken by useBox \(stateId 1\)/,
    );
    expect(() => getApi().stateIds.check(70_000, "useCharacter")).toThrow(
      /must be a whole number from 0 to/,
    );

    await unmount(renderer);
  });

  it("puts a sleeping body that a restore moved where it now is", async () => {
    bodies.clear();
    const renderer = await renderPhysics(
      <>
        <Floor stateId={0} />
        <Crate name="a" stateId={1} position={[0, 0.5, 0]} />
      </>,
    );
    await step(renderer, 120);
    expect(bodies.get("a")!.isSleeping()).toBe(true);
    const resting = getApi().saveState();
    const before = meshes.get("a")!.position.x;

    bodies.get("a")!.setPositionAndRotation([5, 0.5, 0], [0, 0, 0, 1], false);
    await step(renderer, 2);
    expect(meshes.get("a")!.position.x).toBeCloseTo(5, 3);

    getApi().restoreState(resting);
    await step(renderer, 2);
    expect(bodies.get("a")!.isSleeping()).toBe(true);
    expect(meshes.get("a")!.position.x).toBeCloseTo(before, 5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("frees everything it allocates across save/restore cycles", async () => {
    const renderer = await mountPile();
    await step(renderer, 5);
    const api = getApi();
    const snapshot = api.saveState();
    api.restoreState(snapshot);

    const free = api.Jolt.JoltInterface.prototype.sGetFreeMemory();
    for (let cycle = 0; cycle < 20; cycle += 1) {
      api.restoreState(api.saveState());
      bodies.get("a")!.restoreState(bodies.get("a")!.saveState());
      joints.get("h")!.restoreState(joints.get("h")!.saveState());
    }
    expect(api.Jolt.JoltInterface.prototype.sGetFreeMemory()).toBe(free);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("filtered and per-object snapshots", () => {
  it("restores only what the filter picked", async () => {
    const renderer = await mountPile();
    await step(renderer, 20);
    const api = getApi();
    const onlyA = api.saveState({ body: (id) => id === 1 });
    const a = position("a");
    const b = position("b");
    const clock = api.timing.stepCount;

    await step(renderer, 20);
    const laterB = position("b");
    api.restoreState(onlyA);

    expect(position("a")).toEqual(a);
    expect(position("b")).toEqual(laterB);
    expect(position("b")).not.toEqual(b);
    expect(api.timing.stepCount).toBe(clock + 20);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("saves one body, and refuses another body's bytes", async () => {
    const renderer = await mountPile();
    await step(renderer, 20);
    const a = bodies.get("a")!;
    const bytes = a.saveState();
    const at = position("a");

    await step(renderer, 20);
    a.restoreState(bytes);
    expect(position("a")).toEqual(at);
    expect(() => bodies.get("b")!.restoreState(bytes)).toThrow(
      /another body's snapshot/,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("saves one constraint's impulses and motor state", async () => {
    const renderer = await mountPile();
    await step(renderer, 30);
    const hinge = joints.get("h") as unknown as HingeConstraintApi;
    const bytes = hinge.saveState();
    const { Jolt: jolt } = getApi();

    hinge.setMotorState("off");
    expect(hinge.constraint.GetMotorState()).toBe(jolt.EMotorState_Off);
    expect(isSameState(hinge.saveState(), bytes)).toBe(false);

    hinge.restoreState(bytes);
    expect(hinge.constraint.GetMotorState()).toBe(jolt.EMotorState_Velocity);
    expect(isSameState(hinge.saveState(), bytes)).toBe(true);
    expect(() => hinge.restoreState(new Uint8Array(3))).toThrow(
      /different kind/,
    );

    await unmount(renderer);
    expectNoAsserts();
  });
});

const held: {
  car?: CarApi;
  character?: CharacterApi;
  ragdoll?: RagdollApi;
  softBody?: { saveState: () => Uint8Array; body: Jolt.Body };
} = {};

const Car = ({ stateId = 20 }: { stateId?: number }) => {
  const [api] = useCar({
    stateId,
    position: [0, 2, 0],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: { radius: 0.35, width: 0.28, offsetForward: 1.4, offsetDown: 0.3 },
  });

  useEffect(() => {
    held.car = api;
  }, [api]);

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

const Cloth = () => {
  const [, api] = useSoftBody(new PlaneGeometry(2, 2, 6, 6), {
    stateId: 30,
    position: [4, 3, 0],
  });

  useEffect(() => {
    held.softBody = api;
  }, [api]);

  return null;
};

const Swarm = () => {
  const [, swarm] = useInstancedBodies({
    stateId: 40,
    count: 5,
    collider: { type: "sphere", radius: 0.3 },
    transforms: (index) => ({ position: [-4, 1 + index, 0] }),
  });

  useEffect(() => {
    if (swarm) {
      expect(swarm.ids.map((id) => id & 0x7fffff)).toEqual([40, 41, 42, 43, 44]);
    }
  }, [swarm]);

  return null;
};

const still = new Vector3();

const Walker = () => {
  const [api] = useCharacter({
    stateId: 2,
    innerBody: true,
    position: [-6, 1, 4],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
    },
  });

  useEffect(() => {
    held.character = api;
  }, [api]);

  useFrame(() => {
    api?.update(still, false, false, 1 / 60);
  });

  return null;
};

const Mannequin = ({
  scene,
  stateId = 100,
}: {
  scene: Object3D;
  stateId?: number;
}) => {
  const model = useCharacterModel(scene);
  const [ragdoll] = useRagdoll(model, { stateId });

  useEffect(() => {
    held.ragdoll = ragdoll;
  }, [ragdoll]);

  return null;
};

const Ball = () => {
  useSphere({ stateId: 50, radius: 0.4, position: [2, 6, 2], motionType: "dynamic" });
  return null;
};

describe("stateId on every hook", () => {
  it("round-trips a car, cloth, swarm, character and ragdoll", async () => {
    const { scene } = await loadMannequin();
    scene.position.set(6, 1, -4);
    const renderer = await renderPhysics(
      <>
        <Floor stateId={0} />
        <Car />
        <Cloth />
        <Swarm />
        <Walker />
        <Ball />
        <Mannequin scene={scene} />
      </>,
    );
    await step(renderer, 10);

    const ragdoll = held.ragdoll!;
    expect(ragdoll.bodies.map((id) => id.GetIndexAndSequenceNumber())).toEqual(
      ragdoll.bodies.map((_, index) => 100 + index),
    );
    expect(held.character!.innerBodyID!.GetIndexAndSequenceNumber()).toBe(2);

    const api = getApi();
    const snapshot = api.saveState();
    await step(renderer, 30);
    const expected = api.saveState();

    api.restoreState(snapshot);
    await step(renderer, 30);
    expect(isSameState(api.saveState(), expected)).toBe(true);

    const character = held.character!;
    const alone = character.saveState();
    const y = character.character.GetPosition().GetY();
    character.character.SetPosition(new api.Jolt.RVec3(0, 20, 0));
    character.restoreState(alone);
    expect(character.character.GetPosition().GetY()).toBe(y);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a ragdoll whose range another body sits in", async () => {
    const { scene } = await loadMannequin();
    held.ragdoll = undefined;

    await expect(
      renderPhysics(
        <>
          <Floor stateId={0} />
          <Crate name="x" stateId={105} position={[0, 3, 0]} />
          <Mannequin scene={scene} />
        </>,
      ),
    ).rejects.toThrow(/useRagdoll stateId 105 is taken by useBox \(stateId 105\)/);
  });
});

/** A crouching capsule of no radius, which Jolt refuses after the standing one is built. */
const Squashed = () => {
  useCharacter({
    position: [4, 1, -4],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0 },
    },
  });
  return null;
};

const Ghost = ({ stateId }: { stateId: number }) => {
  useCharacter({
    stateId,
    position: [4, 1, -4],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
    },
  });
  return null;
};

describe("a refused stateId leaves nothing behind", () => {
  const refusals: unknown[] = [];
  const caught = (error: unknown) => {
    refusals.push(error);
  };

  /**
   * Mounts `refused` beside the jointed pile, whose hinge is constraint
   * stateId 7, and reports what it left behind.
   */
  const mountBeside = async (refused: ReactNode) => {
    refusals.length = 0;
    const renderer = await mountPile();

    const api = getApi();
    const bodies = api.physicsSystem.GetNumBodies();
    const constraints = api.constraints.attached().length;
    const free = api.Jolt.JoltInterface.prototype.sGetFreeMemory();

    await updatePhysics(
      renderer,
      <>
        <Pile />
        <Joints />
        <Refused onError={caught}>{refused}</Refused>
      </>,
    );

    return {
      renderer,
      api,
      refusal: String(refusals[0]),
      bodiesLeft: api.physicsSystem.GetNumBodies() - bodies,
      constraintsLeft: api.constraints.attached().length - constraints,
      heapLost: free - api.Jolt.JoltInterface.prototype.sGetFreeMemory(),
    };
  };

  it("a car whose constraint stateId a joint holds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await mountBeside(<Car stateId={7} />);

    expect(result.refusal).toContain("constraint stateId 7 is taken by useHingeConstraint");
    expect(result.bodiesLeft).toBe(0);
    expect(result.constraintsLeft).toBe(0);
    expect(() => result.api.saveState()).not.toThrow();

    error.mockRestore();
    await unmount(result.renderer);
    expectNoAsserts();
  });

  it("a ragdoll whose joint stateId a joint holds", async () => {
    const { scene } = await loadMannequin();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await mountBeside(<Mannequin scene={scene} stateId={5} />);

    expect(result.refusal).toContain("constraint stateId 7 is taken by useHingeConstraint");
    expect(result.bodiesLeft).toBe(0);
    expect(result.constraintsLeft).toBe(0);
    expect(() => result.api.saveState()).not.toThrow();

    error.mockRestore();
    await unmount(result.renderer);
    expectNoAsserts();
  });

  it("a character whose stateId another character holds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await mountBeside(
      <>
        <Ghost stateId={7} />
        <Refused onError={caught}>
          <Ghost stateId={7} />
        </Refused>
      </>,
    );

    expect(result.refusal).toContain("character stateId 7 is taken by useCharacter");
    expect(result.api.stateIds.characters()).toHaveLength(1);

    error.mockRestore();
    await unmount(result.renderer);
    expectNoAsserts();
  });

  it("a character whose inner body stateId a body holds frees what it built", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await mountBeside(<Walker />);

    expect(result.refusal).toContain("useCharacter stateId 2 is taken by useBox");
    expect(result.bodiesLeft).toBe(0);
    expect(result.heapLost).toBeLessThanOrEqual(0);

    error.mockRestore();
    await unmount(result.renderer);
    expectNoAsserts();
  });

  it("a character stateId that a snapshot could not carry", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const stateId of [-1, 1.5]) {
      const result = await mountBeside(<Ghost stateId={stateId} />);
      expect(result.refusal).toContain(`stateId ${stateId} must be a whole number`);
      expect(result.api.stateIds.characters()).toHaveLength(0);
      await unmount(result.renderer);
    }
    error.mockRestore();
    expectNoAsserts();
  });

  it("a character whose shape cannot be built frees what it built", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await mountBeside(<Squashed />);

    expect(result.refusal).toContain("Invalid radius");
    expect(result.heapLost).toBeLessThanOrEqual(0);

    error.mockRestore();
    await unmount(result.renderer);
    expectNoAsserts();
  });

  it("names an unstated body even once its slot's sequence wraps to 0", async () => {
    const renderer = await renderPhysics(<Floor stateId={0} />);
    const api = getApi();
    const { Jolt: jolt, bodyInterface, stateIds } = api;

    const shape = new jolt.SphereShape(0.5);
    shape.AddRef();
    const position = new jolt.RVec3(0, 5, 0);
    const rotation = new jolt.Quat(0, 0, 0, 1);
    const settings = new jolt.BodyCreationSettings(
      shape,
      position,
      rotation,
      jolt.EMotionType_Dynamic,
      1,
    );

    // A pooled bullet without a stateId, spawned and despawned in one slot
    // until Jolt's 8-bit sequence number has gone all the way round.
    const claimedStated: number[] = [];
    for (let shot = 0; shot < 300; shot += 1) {
      const id = stateIds.createBody(settings, undefined, "a pooled bullet").GetID();
      bodyInterface.AddBody(id, jolt.EActivation_Activate);
      if (stateIds.isStated(id)) claimedStated.push(shot);
      if (shot < 299) {
        bodyInterface.RemoveBody(id);
        bodyInterface.DestroyBody(id);
      }
    }
    expect(claimedStated).toEqual([]);
    expect(() => api.saveState()).toThrow(/a body from a pooled bullet/);

    jolt.destroy(settings);
    jolt.destroy(position);
    jolt.destroy(rotation);
    shape.Release();
    await unmount(renderer);
    expectNoAsserts();
  });
});
