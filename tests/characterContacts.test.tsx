import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useFrame } from "@react-three/fiber";
import { useBox } from "@/Jolt/useBox";
import { useConveyor } from "@/Jolt/useConveyor";
import {
  useClosestHitRaycaster,
  type ClosestHitRaycasterApi,
} from "@/Jolt/useClosestHitRaycaster";
import {
  useCharacter,
  type CharacterApi,
  type UseCharacterOptions,
} from "@/Jolt/useCharacter";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const SIZE = {
  height: { standing: 1.2, crouching: 0.6 },
  radius: { standing: 0.4, crouching: 0.4 },
};

const held = new Map<string, CharacterApi>();
const directions = new Map<string, Vector3>();
const still = new Vector3();

const Walker = ({
  name,
  ...options
}: Omit<UseCharacterOptions, "options"> & {
  name: string;
  options?: UseCharacterOptions["options"];
}) => {
  const [api] = useCharacter({
    ...options,
    options: { ...SIZE, ...options.options },
  });

  useEffect(() => {
    if (api) held.set(name, api);
  }, [api, name]);

  useFrame((_, delta) => {
    api?.update(directions.get(name) ?? still, false, false, delta);
  });

  return null;
};

const character = (name: string) => {
  const api = held.get(name);
  if (!api) throw new Error(`${name} not ready`);
  return api;
};

const positionOf = (name: string) => {
  const point = character(name).character.GetPosition();
  return new Vector3(point.GetX(), point.GetY(), point.GetZ());
};

const bodies = new Map<string, BodyApi<Jolt.Shape>>();

const Floor = ({
  name = "floor",
  position = [0, -0.5, 0],
  rotation,
  linear,
  angular,
}: {
  name?: string;
  position?: Vec3Tuple;
  rotation?: QuatTuple;
  linear?: Vec3Tuple;
  angular?: Vec3Tuple;
}) => {
  const [, api] = useBox({
    size: [40, 1, 40],
    position,
    rotation,
    motionType: "static",
    material: { friction: 1 },
  });
  useConveyor(linear || angular ? api : undefined, { linear, angular });

  useEffect(() => {
    if (api) bodies.set(name, api);
  }, [api, name]);

  return null;
};

const raycaster: { api?: ClosestHitRaycasterApi } = {};

const Raycaster = () => {
  const [api] = useClosestHitRaycaster();

  useEffect(() => {
    raycaster.api = api;
  }, [api]);

  return null;
};

const bodyY = (name: string) => {
  const api = bodies.get(name);
  if (!api) throw new Error(`${name} not ready`);
  return api.body.GetPosition().GetY();
};

const reset = () => {
  held.clear();
  directions.clear();
  bodies.clear();
};

describe("useCharacter: inner body", () => {
  it("is in the world for queries only when asked for", async () => {
    const hitAcross = async (innerBody: boolean) => {
      reset();
      const renderer = await renderPhysics(
        <>
          <Walker name="player" position={[0, 0, 0]} innerBody={innerBody} />
          <Raycaster />
        </>,
        { gravity: [0, 0, 0] },
      );
      await step(renderer, 2);
      const hit = raycaster.api!.cast([-5, 1, 0], [10, 0, 0]);
      const innerBodyID =
        character("player").innerBodyID?.GetIndexAndSequenceNumber() ?? null;
      await unmount(renderer);
      return { hit, innerBodyID };
    };

    const solid = await hitAcross(true);
    expect(solid.hit.hit).toBe(true);
    expect(solid.hit.bodyID).toBe(solid.innerBodyID);
    // The capsule's side is 0.4 from its axis.
    expect(solid.hit.point.x).toBeCloseTo(-0.4, 2);

    const virtual = await hitAcross(false);
    expect(virtual.hit.hit).toBe(false);
    expect(virtual.innerBodyID).toBeNull();

    expectNoAsserts();
  });

  it("takes the inner body ID it is given", async () => {
    reset();
    const renderer = await renderPhysics(
      <Walker
        name="player"
        position={[0, 0, 0]}
        innerBody
        innerBodyIDOverride={7}
      />,
    );
    await step(renderer, 1);
    expect(
      character("player").innerBodyID?.GetIndexAndSequenceNumber(),
    ).toBe(7);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useCharacter: character vs character", () => {
  const walkTogether = async (collide: boolean) => {
    reset();
    const events: string[] = [];
    directions.set("left", new Vector3(1, 0, 0));
    directions.set("right", new Vector3(-1, 0, 0));

    const renderer = await renderPhysics(
      <>
        <Floor />
        <Walker
          name="left"
          position={[-3, 0, 0]}
          userData={11}
          collideWithCharacters={collide}
          onCharacterContactAdded={(contact) =>
            events.push(`added ${contact.characterID} ${contact.userData}`)
          }
          onCharacterContactRemoved={(contact) =>
            events.push(`removed ${contact.characterID} ${contact.userData}`)
          }
        />
        <Walker
          name="right"
          position={[3, 0, 0]}
          userData={22}
          collideWithCharacters={collide}
        />
      </>,
    );

    await step(renderer, 90);
    const gap = positionOf("right").x - positionOf("left").x;
    const touching = character("left").hasCollidedWithCharacter(
      character("right"),
    );
    const touchingByID = character("left").hasCollidedWithCharacter(
      character("right").characterID,
    );
    const contacts = character("left").getActiveContacts();

    directions.set("left", new Vector3(-1, 0, 0));
    directions.set("right", new Vector3(1, 0, 0));
    await step(renderer, 60);

    const rightID = character("right").characterID;
    await unmount(renderer);
    return { gap, touching, touchingByID, contacts, events, rightID };
  };

  it("keeps two characters apart, and reports the contact", async () => {
    const result = await walkTogether(true);

    expect(result.gap).toBeGreaterThan(0.75);
    expect(result.touching).toBe(true);
    expect(result.touchingByID).toBe(true);
    expect(
      result.contacts.some(
        (contact) =>
          contact.characterID === result.rightID &&
          contact.bodyID === null &&
          contact.userData === 22,
      ),
    ).toBe(true);
    expect(result.events[0]).toBe(`added ${result.rightID} 22`);
    expect(result.events.at(-1)).toBe(`removed ${result.rightID} 22`);

    expectNoAsserts();
  });

  it("walks through with collideWithCharacters off", async () => {
    const result = await walkTogether(false);

    expect(result.gap).toBeLessThan(0);
    expect(result.touching).toBe(false);
    expect(result.events).toEqual([]);

    expectNoAsserts();
  });
});

describe("useCharacter: contact callbacks", () => {
  it("reports the floor added, persisted and removed, and lets validate refuse it", async () => {
    reset();
    const events: string[] = [];
    let refuse = false;

    const renderer = await renderPhysics(
      <>
        <Floor />
        <Floor name="ledge" position={[0, -0.5, 42]} />
        <Walker
          name="player"
          position={[0, 0, 0]}
          onContactAdded={(contact) =>
            events.push(`added ${contact.bodyID} ${contact.normal.y < -0.9}`)
          }
          onContactPersisted={(contact) =>
            events.at(-1) !== `persisted ${contact.bodyID}` &&
            events.push(`persisted ${contact.bodyID}`)
          }
          onContactRemoved={(contact) => events.push(`removed ${contact.bodyID}`)}
          onContactValidate={() => !refuse}
          onContactSolve={(_, velocities) => {
            if (refuse) velocities.result.set(0, 0, 0);
          }}
        />
      </>,
    );

    await step(renderer, 30);
    const floorID = bodies.get("floor")!.body.GetID();
    const floor = floorID.GetIndexAndSequenceNumber();

    expect(events.slice(0, 2)).toEqual([
      `added ${floor} true`,
      `persisted ${floor}`,
    ]);
    expect(character("player").hasCollidedWith(floorID)).toBe(true);
    expect(
      character("player")
        .getActiveContacts()
        .some((contact) => contact.bodyID === floor && contact.characterID === null),
    ).toBe(true);

    // A body the validate callback refuses is not there at all.
    refuse = true;
    await step(renderer, 30);
    expect(events).toContain(`removed ${floor}`);
    expect(positionOf("player").y).toBeLessThan(-0.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets onAdjustBodyVelocity move the ground under the character", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Walker
          name="player"
          position={[0, 0, 0]}
          onAdjustBodyVelocity={(_, linear) => linear.set(0, 0, 1.5)}
        />
      </>,
    );

    await step(renderer, 20);
    const start = positionOf("player").z;
    await step(renderer, 60);
    expect(positionOf("player").z - start).toBeCloseTo(1.5, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useCharacter: conveyors", () => {
  const carried = async (floor: Parameters<typeof Floor>[0]) => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor {...floor} />
        <Walker name="player" position={[3, 0, 0]} />
      </>,
    );
    await step(renderer, 20);
    const start = positionOf("player");
    await step(renderer, 60);
    const end = positionOf("player");
    await unmount(renderer);
    return end.sub(start);
  };

  it("carries a character standing on a belt", async () => {
    const moved = await carried({ linear: [2, 0, 0] });
    expect(moved.x).toBeCloseTo(2, 1);
    expect(Math.abs(moved.z)).toBeLessThan(0.01);
    expectNoAsserts();
  });

  it("turns a local belt with its body", async () => {
    const quarter = Math.SQRT1_2;
    const moved = await carried({
      linear: [2, 0, 0],
      rotation: [0, quarter, 0, quarter],
    });
    // +X turned a quarter about +Y is −Z.
    expect(moved.z).toBeCloseTo(-2, 1);
    expect(Math.abs(moved.x)).toBeLessThan(0.01);
    expectNoAsserts();
  });

  it("sweeps a character round a turntable", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor angular={[0, 1, 0]} />
        <Walker name="player" position={[3, 0, 0]} />
      </>,
    );
    await step(renderer, 20);
    const start = positionOf("player");
    await step(renderer, 60);
    const end = positionOf("player");
    await unmount(renderer);

    // 1 rad/s about +Y for a second, on a circle that stays 3 m round.
    const angle = (point: Vector3) => Math.atan2(-point.z, point.x);
    expect(angle(end) - angle(start)).toBeCloseTo(1, 1);
    expect(Math.hypot(end.x, end.z)).toBeCloseTo(3, 1);
    expectNoAsserts();
  });
});

const Raft = () => {
  const [, api] = useBox({
    size: [4, 0.4, 4],
    position: [0, 0.2, 0],
    motionType: "dynamic",
    mass: 50,
    gravityFactor: 0,
  });

  useEffect(() => {
    if (api) bodies.set("raft", api);
  }, [api]);

  return null;
};

describe("useCharacter: weight", () => {
  it("pushes down on a body it stands on", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Raft />
        <Walker name="player" position={[0, 0.45, 0]} mass={80} />
      </>,
    );
    await step(renderer, 30);
    // Regression: the up vector went in as Jolt's gravity argument, so a
    // character put no weight on what it stood on: the raft stayed at 0.2.
    expect(bodyY("raft")).toBeLessThan(0.1);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useCharacter: shapes", () => {
  it("stands a single box and a compound on the floor, feet at zero", async () => {
    const restingY = async (shape: UseCharacterOptions["shape"]) => {
      reset();
      const renderer = await renderPhysics(
        <>
          <Floor />
          <Walker name="player" position={[0, 1, 0]} shape={shape} />
        </>,
      );
      await step(renderer, 90);
      const y = positionOf("player").y;
      const shapeType = character("player").character.GetShape().GetSubType();
      await unmount(renderer);
      return { y, shapeType };
    };

    const jolt = getApi().Jolt;

    const box = await restingY({
      standing: [{ type: "box", position: [0, 0.5, 0], size: [0.6, 1, 0.6] }],
    });
    expect(Math.abs(box.y)).toBeLessThan(0.05);
    expect(box.shapeType).toBe(jolt.EShapeSubType_RotatedTranslated);

    const compound = await restingY({
      standing: [
        { type: "box", position: [0, 0.3, 0], size: [1.2, 0.6, 0.6] },
        { type: "sphere", position: [0, 0.9, 0], radius: 0.3 },
      ],
    });
    expect(Math.abs(compound.y)).toBeLessThan(0.05);
    expect(compound.shapeType).toBe(jolt.EShapeSubType_StaticCompound);

    expectNoAsserts();
  });

  it("walks a triangle mesh with enhanced edge removal on", async () => {
    reset();
    directions.set("player", new Vector3(1, 0, 0));
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Walker
          name="player"
          position={[-4, 0, 0]}
          options={{ enhancedInternalEdgeRemoval: true }}
        />
      </>,
    );
    await step(renderer, 60);
    expect(positionOf("player").x).toBeGreaterThan(0.5);
    expect(Math.abs(positionOf("player").y)).toBeLessThan(0.05);
    await unmount(renderer);
    expectNoAsserts();
  });
});
