import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useCharacter, type CharacterApi } from "@/Jolt/useCharacter";
import { useSwimming, type SwimmingApi } from "@/Jolt/useSwimming";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import { WaterVolume, type WaterVolumeProps } from "@/Jolt/WaterVolume";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple, WaterEvent } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

type Box = BodyApi<Jolt.BoxShape>;

const held: { box?: Box; character?: CharacterApi; swim?: SwimmingApi } = {};
const log: string[] = [];
const still = new Vector3();

const record = (label: string) => (event: WaterEvent) =>
  log.push(`${label}:${event.bodyID}`);

const POOL: WaterVolumeProps = {
  position: [0, -2.5, 0],
  size: [20, 5, 20],
};

const Floor = ({ y = -5 }: { y?: number }) => {
  useBox({
    size: [40, 1, 40],
    position: [0, y - 0.5, 0],
    motionType: "static",
  });
  return null;
};

const Crate = ({
  position = [0, 2, 0],
  floats,
  sensor,
  label = "crate",
}: {
  position?: Vec3Tuple;
  floats?: boolean | number;
  sensor?: boolean;
  label?: string;
}) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position,
    motionType: "dynamic",
    mass: 10,
    floats,
    sensor,
    onEnterWater: record(`${label} wet`),
    onExitWater: record(`${label} dry`),
  });

  useEffect(() => {
    if (label === "crate") held.box = api;
  }, [api, label]);

  return null;
};

const y = () => held.box!.body.GetPosition().GetY();
const x = () => held.box!.body.GetPosition().GetX();
const idOf = (api: Box) => api.body.GetID().GetIndexAndSequenceNumber();

const reset = () => {
  held.box = undefined;
  held.character = undefined;
  held.swim = undefined;
  log.length = 0;
};

describe("WaterVolume", () => {
  it("floats a box half under at buoyancy 2, and floats: false sinks it", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <WaterVolume {...POOL} buoyancy={2} />
        <Crate />
      </>,
    );

    await step(renderer, 600);
    expect(Math.abs(y())).toBeLessThan(0.05);

    await unmount(renderer);
    expectNoAsserts();

    for (const floats of [false, 0.25] as const) {
      reset();
      const sinking = await renderPhysics(
        <>
          <Floor />
          <WaterVolume {...POOL} buoyancy={2} />
          <Crate floats={floats} />
        </>,
      );

      await step(sinking, 300);
      expect(y()).toBeLessThan(-4.4);

      await unmount(sinking);
      expectNoAsserts();
    }
  });

  it("bobs the same whatever the frame rate", async () => {
    const sampleAt = async (frameDelta: number) => {
      reset();
      const samples: number[] = [];

      const Recorder = () => {
        useAfterPhysicsStep((_, index) => {
          if (held.box && index === 100) samples.push(y());
        });
        return null;
      };

      const renderer = await renderPhysics(
        <>
          <Floor />
          <WaterVolume {...POOL} buoyancy={1.6} />
          <Crate />
          <Recorder />
        </>,
        { timeStep: 1 / 60 },
      );

      await step(renderer, Math.ceil(2 / frameDelta), frameDelta);
      await unmount(renderer);
      expectNoAsserts();
      return samples[0];
    };

    const slow = await sampleAt(1 / 30);
    const fast = await sampleAt(1 / 120);

    expect(slow).toBeLessThan(1);
    expect(Math.abs(slow - fast)).toBeLessThan(1e-6);
  });

  it("fires enter and exit once per crossing", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <WaterVolume
          {...POOL}
          buoyancy={1.6}
          linearDrag={2}
          onEnter={(event) => {
            log.push(`enter:${event.bodyID}`);
            if (event.velocity.y >= 0) log.push("rising?");
          }}
          onExit={record("exit")}
        />
        <Crate />
        <Crate position={[5, -3, 5]} sensor label="sensor" />
      </>,
    );

    await step(renderer, 300);
    const id = idOf(held.box!);
    expect(log).toEqual([`enter:${id}`, `crate wet:${id}`]);

    // The broadphase sees a teleport only once the next step has run.
    held.box!.setPositionAndRotation([0, 5, 0], [0, 0, 0, 1]);
    await step(renderer, 2);
    expect(log.slice(2)).toEqual([`exit:${id}`, `crate dry:${id}`]);

    await step(renderer, 300);
    expect(log.slice(4)).toEqual([`enter:${id}`, `crate wet:${id}`]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets a float fall asleep in the water and wakes it when the flow starts", async () => {
    reset();
    const pool = (flow?: Vec3Tuple) => (
      <>
        <Floor />
        <WaterVolume
          {...POOL}
          buoyancy={1.6}
          linearDrag={2}
          flow={flow}
          onExit={record("exit")}
        />
        <Crate />
      </>
    );

    const renderer = await renderPhysics(pool());

    for (let frame = 0; frame < 1200 && !held.box?.isSleeping(); frame += 60) {
      await step(renderer, 60);
    }
    expect(held.box!.isSleeping()).toBe(true);
    await step(renderer, 30);
    expect(log.filter((entry) => entry.startsWith("exit"))).toEqual([]);

    const before = x();
    await updatePhysics(renderer, pool([2, 0, 0]));
    await step(renderer, 60);
    expect(held.box!.isSleeping()).toBe(false);
    expect(x() - before).toBeGreaterThan(0.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("gives an overlapped body to the highest priority, or the first mounted on a tie", async () => {
    const drift = async (priorities: [number, number]) => {
      reset();
      const renderer = await renderPhysics(
        <>
          <Floor />
          <WaterVolume
            {...POOL}
            flow={[3, 0, 0]}
            priority={priorities[0]}
            onEnter={record("east")}
          />
          <WaterVolume
            {...POOL}
            flow={[-3, 0, 0]}
            priority={priorities[1]}
            onEnter={record("west")}
          />
          <Crate />
        </>,
      );

      await step(renderer, 120);
      const travelled = x();
      const entered = log.filter((entry) => !entry.includes("wet"));
      await unmount(renderer);
      expectNoAsserts();
      return { travelled, entered };
    };

    const westWins = await drift([0, 1]);
    expect(westWins.travelled).toBeLessThan(-1);
    expect(westWins.entered).toHaveLength(1);
    expect(westWins.entered[0]).toMatch(/^west:/);

    const tie = await drift([0, 0]);
    expect(tie.travelled).toBeGreaterThan(1);
    expect(tie.entered[0]).toMatch(/^east:/);
  });

  it("reports leaving when the volume or the body goes away", async () => {
    reset();
    const scene = (water: boolean, crate: boolean) => (
      <>
        <Floor />
        {water && (
          <WaterVolume
            {...POOL}
            buoyancy={1.6}
            linearDrag={2}
            onExit={record("exit")}
          />
        )}
        {crate && <Crate />}
      </>
    );

    const renderer = await renderPhysics(scene(true, true));
    await step(renderer, 240);
    const id = idOf(held.box!);
    const floating = y();

    await updatePhysics(renderer, scene(false, true));
    await step(renderer, 60);
    expect(log).toContain(`crate dry:${id}`);
    expect(log).not.toContain(`exit:${id}`);
    expect(y()).toBeLessThan(floating - 1);

    await updatePhysics(renderer, scene(true, true));
    await step(renderer, 120);
    log.length = 0;

    await updatePhysics(renderer, scene(true, false));
    await step(renderer, 2);
    expect(log).toEqual([`exit:${id}`]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets a character stand on a light float without spinning it", async () => {
    reset();
    let fastest = 0;

    const Watch = () => {
      useFrame(() => {
        if (!held.box) return;
        fastest = Math.max(fastest, held.box.body.GetAngularVelocity().Length());
      });
      return null;
    };

    const Stander = () => {
      const [api] = useCharacter({
        position: [0.1, 0.5, 0],
        options: {
          height: { standing: 1.1, crouching: 1.1 },
          radius: { standing: 0.35, crouching: 0.35 },
        },
      });
      useFrame((_, delta) => api?.update(still, false, false, delta));
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Floor />
        <WaterVolume {...POOL} buoyancy={1.4} linearDrag={2} />
        <Crate position={[0, -0.4, 0]} />
        <Stander />
        <Watch />
      </>,
    );

    await step(renderer, 300);
    // Regression: the character's whole 1000 kg went into an 8 kg float at
    // one point every frame, and the float spun at up to 47 rad/s.
    expect(fastest).toBeLessThan(6);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("floats ride the waves, and samples include them", async () => {
    reset();
    const swell = (_x: number, _z: number, time: number) =>
      0.4 * Math.sin(time * 2);

    const heights: number[] = [];
    const Recorder = () => {
      useAfterPhysicsStep(() => {
        if (held.box) heights.push(y());
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Floor />
        <WaterVolume
          {...POOL}
          surfaceLevel={-1}
          waves={swell}
          buoyancy={2}
          linearDrag={2}
        />
        <Crate position={[0, -0.5, 0]} />
        <Recorder />
      </>,
    );

    await step(renderer, 600);
    const settled = heights.slice(-200);
    expect(Math.max(...settled) - Math.min(...settled)).toBeGreaterThan(0.5);

    const time = getApi().timing.elapsed;
    expect(getApi().water.sample([3, -3, 3])?.surfaceLevel).toBeCloseTo(
      -1 + swell(3, 3, time),
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  it("samples depth, surface and flow at a point", async () => {
    reset();
    const renderer = await renderPhysics(
      <WaterVolume {...POOL} surfaceLevel={-1} flow={[1, 0, 2]} />,
    );
    await step(renderer, 1);

    const water = getApi().water;
    const wet = water.sample([3, -3, 3]);
    expect(wet?.depth).toBeCloseTo(2);
    expect(wet?.surfaceLevel).toBe(-1);
    expect(wet?.flow.toArray()).toEqual([1, 0, 2]);

    expect(water.sample(new Vector3(3, -0.5, 3))).toBeNull();
    expect(water.sample([30, -3, 3])).toBeNull();

    await unmount(renderer);
    expectNoAsserts();
  });
});

const Swimmer = ({
  position = [0, 1, 0] as Vec3Tuple,
  direction = new Vector3(),
}) => {
  const [api] = useCharacter({
    position,
    options: {
      height: { standing: 1.2, crouching: 1.2 },
      radius: { standing: 0.3, crouching: 0.3 },
    },
  });
  const swim = useSwimming(api, { depth: 1.2 });

  useEffect(() => {
    held.character = api;
    held.swim = swim;
  }, [api, swim]);

  useFrame((_, delta) => {
    api?.update(direction, false, false, Math.min(delta, 1 / 30), {
      overrideUpdate: swim.overrideUpdate,
    });
  });

  return null;
};

const feet = () => held.character!.character.GetPosition();

/** A pool 5 deep, with a ramp rising out of it towards +x. */
const RAMP_ANGLE = 20 * (Math.PI / 180);

const Ramp = () => {
  useBox({
    size: [16, 0.4, 6],
    position: [12, -2.5, 0],
    rotation: [0, 0, Math.sin(RAMP_ANGLE / 2), Math.cos(RAMP_ANGLE / 2)],
    motionType: "static",
  });
  return null;
};

describe("useSwimming", () => {
  it("floats with the feet at depth, dives on request, and drifts with the flow", async () => {
    reset();
    const scene = (flow?: Vec3Tuple) => (
      <>
        <Floor />
        <WaterVolume {...POOL} flow={flow} />
        <Swimmer />
      </>
    );
    const renderer = await renderPhysics(scene());

    await step(renderer, 300);
    expect(held.swim!.swimming).toBe(true);
    expect(Math.abs(feet().GetY() + 1.2)).toBeLessThan(0.1);

    held.swim!.setVertical(-1);
    await step(renderer, 60);
    expect(feet().GetY()).toBeLessThan(-2);

    held.swim!.setVertical(0);
    await step(renderer, 240);
    expect(Math.abs(feet().GetY() + 1.2)).toBeLessThan(0.1);

    const before = feet().GetZ();
    await updatePhysics(renderer, scene([0, 0, 2]));
    await step(renderer, 60);
    expect(feet().GetZ() - before).toBeGreaterThan(1.5);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("says when it is moving across the water rather than treading it", async () => {
    reset();
    const direction = new Vector3();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <WaterVolume {...POOL} />
        <Swimmer position={[0, -1.5, 0]} direction={direction} />
      </>,
    );

    await step(renderer, 120);
    expect(held.swim!.swimming).toBe(true);
    expect(held.swim!.moving).toBe(false);

    direction.set(0, 0, 1);
    await step(renderer, 30);
    expect(held.swim!.moving).toBe(true);

    direction.set(0, 0, 0);
    await step(renderer, 60);
    expect(held.swim!.moving).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("wades out up a ramp", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Ramp />
        <WaterVolume {...POOL} />
        <Swimmer position={[2, -1, 0]} direction={new Vector3(1, 0, 0)} />
      </>,
    );

    await step(renderer, 60);
    expect(held.swim!.swimming).toBe(true);

    await step(renderer, 360);
    expect(feet().GetX()).toBeGreaterThan(10);
    expect(held.swim!.swimming).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });
});
