import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useBox } from "@/Jolt/useBox";
import { useCharacter } from "@/Jolt/useCharacter";
import type { CharacterApi } from "@/Jolt/useCharacter";
import type { CompoundChild } from "@/Jolt/useCompound";
import { isSameState } from "@/Jolt/internal/snapshot";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const held: { api?: CharacterApi; crouched: boolean } = { crouched: false };

const setHeld = (api: CharacterApi | undefined) => {
  held.api = api;
};

const still = new Vector3();

const Ground = () => {
  useBox({
    size: [40, 1, 40],
    position: [0, -0.5, 0],
    motionType: "static",
    material: { friction: 1 },
  });
  return null;
};

const Player = () => {
  const [api] = useCharacter({
    position: [0, 2, 0],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
    },
  });

  useEffect(() => {
    setHeld(api);
  }, [api]);

  useFrame((_, delta) => {
    api?.update(still, false, held.crouched, Math.min(delta, 1 / 30));
  });

  return null;
};

const feetY = () => {
  if (!held.api) throw new Error("character not ready");
  return held.api.character.GetPosition().GetY();
};

const SLOPE_ANGLE = 25 * (Math.PI / 180);
const WARMUP_FRAMES = 40;

const slope: { api?: CharacterApi; frames: number; airborne: number } = {
  frames: 0,
  airborne: 0,
};

const setSlopeApi = (api: CharacterApi | undefined) => {
  slope.api = api;
};

/** Tilted about +X, so the −z end is the high one and +z is downhill. */
const Slope = () => {
  useBox({
    size: [8, 0.4, 20],
    position: [0, 0, 0],
    rotation: [Math.sin(SLOPE_ANGLE / 2), 0, 0, Math.cos(SLOPE_ANGLE / 2)],
    motionType: "static",
    material: { friction: 1 },
  });
  return null;
};

const downhill = new Vector3(0, 0, 1);

const Walker = ({ stickToFloor }: { stickToFloor: boolean }) => {
  const [api] = useCharacter({
    position: [0, 4.8, -8],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
      moveSpeed: 6,
      enableStickToFloor: stickToFloor,
    },
  });

  useEffect(() => {
    setSlopeApi(api);
  }, [api]);

  useFrame((_, delta) => {
    if (!api) return;

    api.update(downhill, false, false, Math.min(delta, 1 / 30));

    slope.frames += 1;
    if (slope.frames > WARMUP_FRAMES && !api.character.IsSupported()) {
      slope.airborne += 1;
    }
  });

  return null;
};

describe("useCharacter", () => {
  it("rests on the floor standing and stays on it when crouching", async () => {
    held.crouched = false;
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Player />
      </>,
    );

    await step(renderer, 120);
    const standingY = feetY();

    // The floor's top face is y = 0 and a CharacterVirtual's position is its
    // feet, so a settled character sits at ~0.
    expect(standingY).toBeGreaterThan(-0.05);
    expect(standingY).toBeLessThan(0.05);

    held.crouched = true;
    await step(renderer, 120);
    const crouchingY = feetY();

    // Regression: both capsules were built with the standing shape's vertical
    // offset, so crouching dropped the feet by the difference between the two
    // offsets (0.45 here) and the character sank through the floor.
    expect(crouchingY).toBeGreaterThan(-0.05);
    expect(crouchingY).toBeLessThan(0.05);
    expect(Math.abs(crouchingY - standingY)).toBeLessThan(0.05);

    held.crouched = false;
    await step(renderer, 120);
    expect(Math.abs(feetY() - standingY)).toBeLessThan(0.05);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stays on the ground walking downhill only with stick-to-floor on", async () => {
    const walkDown = async (stickToFloor: boolean) => {
      slope.frames = 0;
      slope.airborne = 0;

      const renderer = await renderPhysics(
        <>
          <Slope />
          <Walker stickToFloor={stickToFloor} />
        </>,
      );

      // 6 m/s for ~1.7 s covers 10 m of a 20 m ramp: far enough to be a walk
      // downhill, short enough not to run off the bottom edge.
      await step(renderer, 140);
      const airborne = slope.airborne;
      await unmount(renderer);

      return airborne;
    };

    // Regression: the two branches were swapped, so `enableStickToFloor: true`
    // zeroed `mStickToFloorStepDown` — which is exactly how Jolt turns the
    // feature off. Walking down a slope launched the character off it every
    // step instead of holding it against the surface.
    const stuck = await walkDown(true);
    const loose = await walkDown(false);

    // 4 frames against 97 of the same 100: the handful are the initial drop
    // onto the ramp, before either configuration has landed.
    expect(stuck).toBeLessThan(10);
    expect(loose).toBeGreaterThan(80);

    expectNoAsserts();
  });
});

const shaped: { api?: CharacterApi; crouched: boolean } = { crouched: false };

const setShaped = (api: CharacterApi | undefined) => {
  shaped.api = api;
};

/** Standing 1.8 m tall, crouching 0.8 m. */
const Shaped = ({ position }: { position: [number, number, number] }) => {
  const [api] = useCharacter({
    position,
    options: {
      height: { standing: 1.2, crouching: 0.2 },
      radius: { standing: 0.3, crouching: 0.3 },
    },
  });

  useEffect(() => {
    setShaped(api);
  }, [api]);

  useFrame((_, delta) => {
    api?.update(still, false, shaped.crouched, Math.min(delta, 1 / 30));
  });

  return null;
};

/** Its underside 1.2 m up, over x < 0. */
const Ceiling = () => {
  useBox({ size: [10, 0.4, 10], position: [-5, 1.4, 0], motionType: "static" });
  return null;
};

const shapeNow = () =>
  getApi().Jolt.getPointer(shaped.api!.character.GetShape());

/** A horizontal capsule along +z, resting on the feet. */
const HORIZONTAL: CompoundChild[] = [
  {
    type: "capsule",
    position: [0, 0.3, 0],
    rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    height: 1.2,
    radius: 0.3,
  },
];

const TALL: CompoundChild[] = [
  { type: "capsule", position: [0, 1.1, 0], height: 1.6, radius: 0.3 },
];

const moveTo = (x: number) => {
  const at = shaped.api!.character.GetPosition();
  shaped.api!.character.SetPosition(
    getApi().temps.rvec3([x, at.GetY(), at.GetZ()]),
  );
};

describe("useCharacter setShape", () => {
  it("swaps in a shape of your own and back, and refuses one with no room", async () => {
    shaped.crouched = false;
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Ceiling />
        <Shaped position={[3, 0.1, 0]} />
      </>,
    );
    await step(renderer, 30);
    const standing = shapeNow();

    expect(shaped.api!.setShape(HORIZONTAL)).toBe(true);
    expect(shapeNow()).not.toBe(standing);
    await step(renderer, 30);
    // Resting on the feet, so the floor still holds it up.
    expect(shaped.api!.character.IsSupported()).toBe(true);

    expect(shaped.api!.setShape(null)).toBe(true);
    expect(shapeNow()).toBe(standing);

    // Crouched under the ceiling, a 2.2 m shape has no room.
    shaped.crouched = true;
    await step(renderer, 2);
    moveTo(-3);
    await step(renderer, 2);
    const crouching = shapeNow();
    expect(shaped.api!.setShape(TALL)).toBe(false);
    expect(shapeNow()).toBe(crouching);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stays crouched under a ceiling until there is room to stand", async () => {
    shaped.crouched = true;
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Ceiling />
        <Shaped position={[3, 0.1, 0]} />
      </>,
    );
    await step(renderer, 30);
    const crouching = shapeNow();

    moveTo(-3);
    shaped.crouched = false;
    await step(renderer, 10);
    // Regression: a refused stand-up was recorded as standing.
    expect(shapeNow()).toBe(crouching);

    moveTo(3);
    await step(renderer, 2);
    expect(shapeNow()).not.toBe(crouching);

    await unmount(renderer);
    expectNoAsserts();
  });
});

const climber: { api?: CharacterApi; jumpAt: number; frame: number; direction: Vector3 } = {
  jumpAt: -1,
  frame: 0,
  direction: new Vector3(),
};

const Climber = ({
  start,
  stateId,
}: {
  start: [number, number, number];
  stateId?: number;
}) => {
  const [api] = useCharacter({
    stateId,
    position: start,
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
    },
  });

  useEffect(() => {
    climber.api = api;
    climber.frame = 0;
  }, [api]);

  useFrame(() => {
    if (!api) return;
    climber.frame += 1;
    api.update(climber.direction, climber.frame === climber.jumpAt, false, 1 / 60);
  });

  return null;
};

const Slab = ({
  position,
  size,
  stateId,
}: {
  position: [number, number, number];
  size: [number, number, number];
  stateId?: number;
}) => {
  useBox({ stateId, size, position, motionType: "static", material: { friction: 1 } });
  return null;
};

/** Where the character's own up points, from its rotation. */
const feetUp = () => {
  const turn = climber.api!.character.GetRotation();
  return new Vector3(0, 1, 0).applyQuaternion(
    new Quaternion(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW()),
  );
};

const climberAt = () => {
  const at = climber.api!.character.GetPosition();
  return new Vector3(at.GetX(), at.GetY(), at.GetZ());
};

describe("useCharacter stands against gravity", () => {
  /** How far along its up the character gets in the second after a jump. */
  const jumpHeight = async (gravity: [number, number, number]) => {
    const down = new Vector3(...gravity).normalize();
    const floor = down.clone().multiplyScalar(0.5).toArray() as [number, number, number];
    const size = down
      .toArray()
      .map((component) => (component === 0 ? 40 : 1)) as [number, number, number];
    const start = down.clone().multiplyScalar(-1.2).toArray() as [number, number, number];

    climber.jumpAt = 40;
    climber.direction.set(0, 0, 0);
    const renderer = await renderPhysics(
      <>
        <Slab position={floor} size={size} />
        <Climber start={start} />
      </>,
      { gravity },
    );
    await step(renderer, 39);

    const up = down.clone().negate();
    expect(feetUp().dot(up)).toBeGreaterThan(0.9999);
    const rest = climberAt().dot(up);
    let apex = rest;
    for (let frame = 0; frame < 60; frame += 1) {
      await step(renderer, 1);
      apex = Math.max(apex, climberAt().dot(up));
    }

    await unmount(renderer);
    expectNoAsserts();
    return apex - rest;
  };

  it("plants its feet towards gravity and jumps as high whichever way it points", async () => {
    const downward = await jumpHeight([0, -9.81, 0]);
    const sideways = await jumpHeight([-9.81, 0, 0]);

    expect(downward).toBeGreaterThan(0.3);
    expect(sideways).toBeCloseTo(downward, 2);
  });

  /** Floor below, ceiling above, a wall at +x; the character stands on the floor. */
  const Room = () => (
    <>
      <Slab stateId={1} position={[0, -0.5, 0]} size={[40, 1, 40]} />
      <Slab stateId={2} position={[0, 5.5, 0]} size={[40, 1, 40]} />
      <Slab stateId={3} position={[6.5, 2.5, 0]} size={[1, 5, 40]} />
      <Climber stateId={4} start={[0, 1.2, 0]} />
    </>
  );

  const pull = (gravity: [number, number, number]) =>
    getApi().physicsSystem.SetGravity(getApi().temps.vec3(gravity));

  it("flips over on the way up to the ceiling when gravity reverses, and walks on it", async () => {
    climber.jumpAt = -1;
    climber.direction.set(0, 0, 0);
    const renderer = await renderPhysics(<Room />);
    await step(renderer, 60);
    expect(feetUp().y).toBeGreaterThan(0.9999);

    pull([0, 9.81, 0]);
    let sidewaysOnTheWay = false;
    for (let frame = 0; frame < 120; frame += 1) {
      await step(renderer, 1);
      const height = climberAt().y;
      if (height > 1.5 && height < 4 && Math.abs(feetUp().y) < 0.5) {
        sidewaysOnTheWay = true;
      }
    }

    const { character } = climber.api!;
    expect(sidewaysOnTheWay).toBe(true);
    expect(feetUp().y).toBeLessThan(-0.9999);
    expect(character.GetGroundState()).toBe(getApi().Jolt.EGroundState_OnGround);
    // Feet on the ceiling's underside at 5.
    expect(climberAt().y).toBeCloseTo(5, 1);

    const before = climberAt();
    climber.direction.set(-1, 0, 0);
    await step(renderer, 60);
    const after = climberAt();
    expect(before.x - after.x).toBeGreaterThan(2);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.05);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("turns to stand on a wall when gravity turns sideways", async () => {
    climber.jumpAt = -1;
    climber.direction.set(0, 0, 0);
    const renderer = await renderPhysics(<Room />);
    await step(renderer, 60);

    pull([9.81, 0, 0]);
    await step(renderer, 150);

    expect(feetUp().x).toBeLessThan(-0.9999);
    expect(climber.api!.character.GetGroundState()).toBe(
      getApi().Jolt.EGroundState_OnGround,
    );
    expect(climberAt().x).toBeCloseTo(6, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("carries a turn half done in a snapshot", async () => {
    climber.jumpAt = -1;
    climber.direction.set(0, 0, 0);
    const renderer = await renderPhysics(<Room />);
    await step(renderer, 60);

    pull([0, 9.81, 0]);
    await step(renderer, 12);
    expect(Math.abs(feetUp().y)).toBeLessThan(0.9);

    const api = getApi();
    const halfway = api.saveState();
    await step(renderer, 30);
    const straight = api.saveState();

    api.restoreState(halfway);
    await step(renderer, 30);
    expect(isSameState(api.saveState(), straight)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });
});
