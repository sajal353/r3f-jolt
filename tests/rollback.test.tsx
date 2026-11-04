import { useEffect, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaneGeometry, Vector3 } from "three";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useContactListener } from "@/Jolt/useContactListener";
import { useSensor } from "@/Jolt/useSensor";
import { useCar, type CarApi } from "@/Jolt/useCar";
import { useCharacter, type CharacterApi } from "@/Jolt/useCharacter";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import { useInstancedBodies } from "@/Jolt/useInstancedBodies";
import { useRagdoll } from "@/Jolt/useRagdoll";
import { useSoftBody } from "@/Jolt/useSoftBody";
import { useSwimming, type SwimmingApi } from "@/Jolt/useSwimming";
import { WaterVolume } from "@/Jolt/WaterVolume";
import { useRollback, type RollbackApi } from "@/Jolt/useRollback";
import { useJolt } from "@/Jolt/useJolt";
import { isSameState } from "@/Jolt/internal/snapshot";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  unmount,
  updatePhysics,
} from "./harness";
import { loadMannequin } from "./mannequin";

const STEP = 1 / 60;
const fixed = { updateLoop: "independent", timeStep: STEP } as const;

let rollback: RollbackApi;

/** What the scene does at each step, read by step index so a re-run sees it. */
const inputs = new Map<number, number>();

const Rollback = ({ capacity = 120 }: { capacity?: number }) => {
  const api = useRollback({ capacity });

  useEffect(() => {
    rollback = api;
  }, [api]);

  return null;
};

const Floor = () => {
  useBox({
    stateId: 0,
    size: [60, 1, 60],
    position: [0, -0.5, 0],
    motionType: "static",
  });
  return null;
};

const Crate = ({ stateId, position }: { stateId: number; position: number[] }) => {
  useBox({
    stateId,
    size: [1, 1, 1],
    position: position as [number, number, number],
    motionType: "dynamic",
    mass: 10,
  });
  return null;
};

const Ball = ({ stateId = 20 }: { stateId?: number }) => {
  const [, api] = useSphere({
    stateId,
    radius: 0.5,
    position: [-4, 0.5, 0],
    motionType: "dynamic",
    mass: 40,
  });

  useBeforePhysicsStep(function pushFromInput(_, index) {
    const push = inputs.get(index);
    if (push !== undefined) api?.applyImpulse([push, 0, 0]);
  });

  return null;
};

const Pile = () => (
  <>
    <Floor />
    <Crate stateId={1} position={[0, 0.5, 0]} />
    <Crate stateId={2} position={[0, 1.5, 0]} />
    <Crate stateId={3} position={[0, 2.5, 0]} />
    <Ball />
    <Rollback />
  </>
);

const stepTo = (api: ReturnType<typeof getApi>, target: number) => {
  while (api.timing.stepCount < target) api.step();
};

beforeEach(() => {
  inputs.clear();
});

describe("useRollback", () => {
  it("a late input re-simulated lands on the bytes of one that came on time", async () => {
    const run = async (arrivesAt: number) => {
      inputs.clear();
      const renderer = await renderPhysics(<Pile />, fixed);
      const api = getApi();

      if (arrivesAt === 30) inputs.set(30, 600);
      stepTo(api, arrivesAt);

      if (arrivesAt !== 30) {
        inputs.set(30, 600);
        expect(rollback.rewind(30)).toBe(true);
        expect(api.timing.stepCount).toBe(arrivesAt);
      }

      stepTo(api, 120);
      const bytes = api.saveState();
      await unmount(renderer);
      expectNoAsserts();
      return bytes;
    };

    const onTime = await run(30);
    const late = await run(55);
    const lastMoment = await run(119);

    expect(isSameState(onTime, late)).toBe(true);
    expect(isSameState(onTime, lastMoment)).toBe(true);
  });

  it("a rewind that changes nothing changes nothing", async () => {
    const renderer = await renderPhysics(<Pile />, fixed);
    const api = getApi();

    inputs.set(10, 600);
    stepTo(api, 40);
    const straight = rollback.snapshotAt(39);
    const before = api.saveState();

    expect(rollback.rewind(12)).toBe(true);

    expect(isSameState(api.saveState(), before)).toBe(true);
    expect(rollback.snapshotAt(39)).not.toBe(straight);
    expect(isSameState(rollback.snapshotAt(39) as Uint8Array, straight as Uint8Array)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a step older than its history and leaves the world alone", async () => {
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Ball />
        <Rollback capacity={10} />
      </>,
      fixed,
    );
    const api = getApi();

    stepTo(api, 40);
    const before = api.saveState();

    expect(rollback.rewind(29)).toBe(false);
    expect(rollback.rewind(-1)).toBe(false);
    expect(rollback.snapshotAt(29)).toBeNull();
    expect(isSameState(api.saveState(), before)).toBe(true);
    expect(rollback.rewind(30)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("has nothing to do for the current step or a later one", async () => {
    const renderer = await renderPhysics(<Pile />, fixed);
    const api = getApi();

    stepTo(api, 20);
    const restores = api.timing.restores;

    expect(rollback.rewind(20)).toBe(true);
    expect(rollback.rewind(500)).toBe(true);
    expect(api.timing.restores).toBe(restores);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("forgets its history when something else restores the world", async () => {
    const renderer = await renderPhysics(<Pile />, fixed);
    const api = getApi();

    const start = api.saveState();
    stepTo(api, 30);
    api.restoreState(start);
    api.step();

    expect(api.timing.stepCount).toBe(1);
    expect(rollback.snapshotAt(0)).not.toBeNull();
    expect(rollback.snapshotAt(20)).toBeNull();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("saves the world ahead of what a step's callbacks apply", async () => {
    const renderer = await renderPhysics(<Pile />, fixed);
    const api = getApi();

    inputs.set(5, 600);
    stepTo(api, 8);

    // Replaying from step 5 has to apply step 5's push exactly once.
    const expected = api.saveState();
    expect(rollback.rewind(5)).toBe(true);
    expect(isSameState(api.saveState(), expected)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("re-runs each step with its own index and says so", async () => {
    const seen: [number, boolean][] = [];
    const Watcher = () => {
      const { timing } = useJolt();
      useBeforePhysicsStep(function note(_, index) {
        seen.push([index, timing.resimulating]);
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Pile />
        <Watcher />
      </>,
      fixed,
    );
    const api = getApi();

    stepTo(api, 5);
    seen.length = 0;
    rollback.rewind(2);

    expect(seen).toEqual([
      [2, true],
      [3, true],
      [4, true],
    ]);
    expect(api.timing.resimulating).toBe(false);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("delivers re-run contact events flagged, and flushes per step", async () => {
    const events: boolean[] = [];

    const Listener = () => {
      const { timing } = useJolt();
      const [, api] = useSphere({
        stateId: 30,
        radius: 0.5,
        position: [10, 3, 0],
        motionType: "dynamic",
      });
      useBodyContacts(api?.body, {
        onEnter: () => events.push(timing.resimulating),
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Floor />
        <Rollback capacity={200} />
        <Listener />
      </>,
      fixed,
    );
    const api = getApi();

    stepTo(api, 100);
    expect(events).toEqual([false]);

    expect(rollback.rewind(5)).toBe(true);
    expect(events).toEqual([false, true]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("leaves the accumulator and a paused world's clock alone", async () => {
    const renderer = await renderPhysics(<Pile />, fixed);
    const api = getApi();

    stepTo(api, 9);
    api.step(1.5 * STEP);
    expect(api.timing.stepCount).toBe(10);

    expect(rollback.rewind(4)).toBe(true);
    expect(api.timing.stepCount).toBe(10);

    api.step(0.5 * STEP);
    expect(api.timing.stepCount).toBe(11);

    await updatePhysics(renderer, <Pile />, { ...fixed, paused: true });
    expect(rollback.rewind(6)).toBe(true);
    expect(api.timing.stepCount).toBe(11);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("throws from inside a step callback", async () => {
    let thrown: unknown = null;
    const Caller = () => {
      useBeforePhysicsStep(function rewindHere(_, index) {
        if (index !== 5) return;
        try {
          rollback.rewind(2);
        } catch (error) {
          thrown = error;
        }
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Pile />
        <Caller />
      </>,
      fixed,
    );
    stepTo(getApi(), 8);

    expect(String(thrown)).toContain("inside a step callback");

    await unmount(renderer);
    expectNoAsserts();
  });

  it('refuses timeStep="vary"', async () => {
    const renderer = await renderPhysics(<Pile />, {
      updateLoop: "independent",
      timeStep: "vary",
    });
    const api = getApi();

    api.step(STEP);
    api.step(STEP);
    expect(() => rollback.rewind(0)).toThrow("numeric timeStep");

    await unmount(renderer);
    expectNoAsserts();
  });

  it("names what lacks a stateId on the first step", async () => {
    const Unstated = () => {
      useBox({ size: [1, 1, 1], position: [5, 5, 5], motionType: "dynamic" });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Unstated />
        <Rollback />
      </>,
      fixed,
    );

    expect(() => getApi().step()).toThrow("useBox");

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a rewind across a body that came and went is refused by name", async () => {
    const renderer = await renderPhysics(
      <>
        <Pile />
        {null}
      </>,
      fixed,
    );
    const api = getApi();

    stepTo(api, 10);
    await updatePhysics(
      renderer,
      <>
        <Pile />
        <Crate stateId={9} position={[5, 1, 5]} />
      </>,
      fixed,
    );
    stepTo(api, 20);

    expect(() => rollback.rewind(5)).toThrow("bodies 9 not in the snapshot");

    await unmount(renderer);
    expectNoAsserts();
  });

  it("rejects a capacity that is not a whole number", async () => {
    await expect(
      renderPhysics(<Rollback capacity={0} />, fixed),
    ).rejects.toThrow("capacity 0");
  });
});

describe("JS state a replay depends on", () => {
  const replayMatches = async (
    scene: React.ReactElement,
    setup: (api: ReturnType<typeof getApi>) => void = () => {},
    { span = 12, until = 90 }: { span?: number; until?: number } = {},
  ) => {
    const renderer = await renderPhysics(scene, fixed);
    const api = getApi();
    setup(api);

    stepTo(api, until);
    const straight = api.saveState();
    const from = until - span;
    const history = Array.from({ length: span }, (_, index) =>
      rollback.snapshotAt(from + index),
    );

    expect(rollback.rewind(from)).toBe(true);

    // Every step, not just the last: JS state that goes wrong can come right
    // again a few steps on, and the bytes at the end would never show it.
    history.forEach((snapshot, index) => {
      const replayed = rollback.snapshotAt(from + index);
      expect(
        isSameState(replayed as Uint8Array, snapshot as Uint8Array),
        `step ${from + index}`,
      ).toBe(true);
    });
    expect(isSameState(api.saveState(), straight)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  };

  let character: CharacterApi | undefined;
  let swimming: SwimmingApi | undefined;
  let car: CarApi | undefined;

  const Walker = ({ innerBody = false }: { innerBody?: boolean }) => {
    const [api] = useCharacter({
      stateId: 1,
      position: [0, 0.05, 0],
      innerBody,
    });
    const direction = useRef(new Vector3());

    useEffect(() => {
      character = api;
    }, [api]);

    useBeforePhysicsStep(function walk(delta, index) {
      if (!api) return;
      direction.current.set(index % 40 < 20 ? 1 : -0.5, 0, index % 30 < 10 ? 1 : 0);
      api.update(direction.current, index % 50 === 7, index % 44 > 30, delta);
    });

    return null;
  };

  it("a passive ragdoll, cloth and a swarm", async () => {
    const { scene } = await loadMannequin();

    const Doll = () => {
      const model = useCharacterModel(scene);
      useRagdoll(model, { stateId: 100 });
      return null;
    };

    const Cloth = () => {
      const [geometry] = useState(() => new PlaneGeometry(2, 2, 6, 6));
      useSoftBody(geometry, { stateId: 60, position: [6, 3, 0] });
      return null;
    };

    const Swarm = () => {
      useInstancedBodies({
        stateId: 40,
        count: 5,
        collider: { type: "sphere", radius: 0.3 },
        transforms: (index) => ({ position: [-6, 1 + index, 0] }),
      });
      return null;
    };

    await replayMatches(
      <>
        <Floor />
        <Doll />
        <Cloth />
        <Swarm />
        <Rollback />
      </>,
      undefined,
      { span: 60, until: 100 },
    );
  });

  it("a character's inertia and posture", async () => {
    await replayMatches(
      <>
        <Floor />
        <Walker />
        <Rollback />
      </>,
    );
    expect(character).toBeDefined();
  });

  it("a posture goes back wherever the character stands now", async () => {
    const Ceiling = () => {
      useBox({
        stateId: 5,
        size: [6, 1, 6],
        position: [10, 3.5, 0],
        motionType: "static",
      });
      return null;
    };

    const Ducker = () => {
      const [api] = useCharacter({ stateId: 1, position: [0, 0.05, 0] });
      const direction = useRef(new Vector3());
      const { Jolt: jolt } = useJolt();

      useBeforePhysicsStep(function duck(delta, index) {
        if (!api) return;
        if (index === 21) {
          const under = new jolt.RVec3(10, 0.05, 0);
          api.character.SetPosition(under);
          jolt.destroy(under);
        }
        api.update(direction.current, false, index >= 20, delta);
      });

      return null;
    };

    // Rewinds from under the ceiling, where standing up has no room, to the open.
    await replayMatches(
      <>
        <Floor />
        <Ceiling />
        <Ducker />
        <Rollback />
      </>,
      undefined,
      { span: 30, until: 40 },
    );
  });

  it("a character's own saveState brings its inertia and posture back", async () => {
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Walker />
      </>,
      fixed,
    );
    const api = getApi();

    stepTo(api, 36);
    const saved = character?.saveState() as Uint8Array;
    const position = () => {
      const at = character?.character.GetPosition();
      return [at?.GetX(), at?.GetY(), at?.GetZ()];
    };

    stepTo(api, 60);
    const later = position();

    character?.restoreState(saved);
    api.timing.stepCount = 36;
    stepTo(api, 60);

    expect(position()).toEqual(later);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("swimming's hysteresis, and water claiming a step run twice", async () => {
    const Swimmer = () => {
      const [api] = useCharacter({ stateId: 1, position: [0, -0.6, 0] });
      const swim = useSwimming(api, { depth: 1 });
      const direction = useRef(new Vector3());

      useEffect(() => {
        character = api;
        swimming = swim;
      }, [api, swim]);

      useBeforePhysicsStep(function paddle(delta, index) {
        if (!api) return;
        direction.current.set(1, 0, 0);
        swim.setVertical(index % 30 < 15 ? 1 : 0);
        api.update(direction.current, false, false, delta, {
          overrideUpdate: swim.overrideUpdate,
        });
      });

      return null;
    };

    const Float = () => {
      useBox({
        stateId: 40,
        size: [1, 1, 1],
        position: [4, 3, 4],
        motionType: "dynamic",
        mass: 200,
      });
      return null;
    };

    await replayMatches(
      <>
        <WaterVolume
          position={[0, -5, 0]}
          size={[40, 10, 40]}
          surfaceLevel={0}
        />
        <Swimmer />
        <Float />
        <Rollback capacity={200} />
      </>,
      undefined,
      { span: 149, until: 150 },
    );
    expect(swimming?.swimming).toBe(true);
  });

  it("a car's reverse logic", async () => {
    const Driver = () => {
      const [api] = useCar({
        stateId: 1,
        position: [0, 1.5, 0],
        vehicleSize: { length: 4, width: 1.8, height: 1 },
        wheelSettings: {
          radius: 0.35,
          width: 0.28,
          offsetForward: 1.4,
          offsetDown: 0.3,
        },
      });

      useEffect(() => {
        car = api;
      }, [api]);

      useBeforePhysicsStep(function drive(_, index) {
        const forward = index % 120 < 20;
        api?.update({
          forward,
          backward: !forward,
          left: false,
          right: index % 25 < 8,
          handbrake: false,
          modifier: true,
        });
      });

      return null;
    };

    await replayMatches(
      <>
        <Floor />
        <Driver />
        <Rollback capacity={200} />
      </>,
      undefined,
      // Last went forwards at step 10; has braked and reversed by step 100.
      { span: 90, until: 100 },
    );
    expect(car).toBeDefined();
  });

  it("a joint's load window, so it breaks on the same step", async () => {
    const breaks: [number, boolean][] = [];

    const Breakable = () => {
      const { timing } = useJolt();
      const [, anchor] = useBox({
        stateId: 1,
        size: [1, 1, 1],
        position: [-1.5, 4.5, 0],
        motionType: "static",
      });
      const [, weight] = useBox({
        stateId: 2,
        size: [1, 1, 1],
        position: [0, 4.5, 0],
        motionType: "dynamic",
        mass: 40,
      });
      useSphere({
        stateId: 3,
        radius: 0.6,
        position: [0, 12, 0],
        motionType: "dynamic",
        mass: 400,
      });

      useHingeConstraint(anchor, weight, {
        stateId: 1,
        point: [-0.75, 4.5, 0],
        hingeAxis: [0, 0, 1],
        normalAxis: [1, 0, 0],
        breakForce: 3000,
        onBreak: () => breaks.push([timing.stepCount, timing.resimulating]),
      });

      return null;
    };

    await replayMatches(
      <>
        <Breakable />
        <Rollback capacity={200} />
      </>,
      undefined,
      { span: 110, until: 130 },
    );

    expect(breaks.length).toBe(2);
    expect(breaks[0][0]).toBe(breaks[1][0]);
    expect(breaks[0][1]).toBe(false);
    expect(breaks[1][1]).toBe(true);
  });

  it("a sensor's inside set stays true to the restored world", async () => {
    let inside: readonly number[] = [];
    const exits: number[] = [];

    const Trigger = () => {
      const [, sensor] = useBox({
        stateId: 1,
        size: [2, 2, 2],
        position: [0, 1, 0],
        motionType: "static",
        sensor: true,
      });
      const [current] = useSensor(sensor?.body, {
        onIntersectionExit: (contact) => exits.push(contact.bodyID),
      });

      useEffect(() => {
        inside = current;
      }, [current]);

      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Floor />
        <Trigger />
        <Ball />
        <Rollback capacity={240} />
      </>,
      fixed,
    );
    const api = getApi();
    const flushRender = () => updatePhysics(
      renderer,
      <>
        <Floor />
        <Trigger />
        <Ball />
        <Rollback capacity={240} />
      </>,
      fixed,
    );

    inputs.set(30, 400);
    stepTo(api, 60);
    await flushRender();
    expect(inside).toHaveLength(1);

    // The push never happened after all: the ball never reached the sensor.
    inputs.delete(30);
    expect(rollback.rewind(30)).toBe(true);
    await flushRender();

    expect(inside).toHaveLength(0);
    expect(exits).toHaveLength(0);

    stepTo(api, 200);
    await flushRender();
    expect(inside).toHaveLength(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a snapshot between a frame's steps knows what those steps reported", async () => {
    // Enters on a step partway through a frame for one of these three offsets.
    for (const offset of [0, 1, 2]) {
      let inside: readonly number[] = [];
      let entered = -1;

      const Scene = () => {
        const { timing } = useJolt();
        const [, sensor] = useBox({
          stateId: 1,
          size: [2, 2, 2],
          position: [0, 1, 0],
          motionType: "static",
          sensor: true,
        });
        const [current] = useSensor(sensor?.body);

        useContactListener({
          onContactAdded: () => {
            if (entered === -1) entered = timing.stepCount;
          },
        });

        useEffect(() => {
          inside = current;
        }, [current]);

        return (
          <>
            <Ball />
            <Rollback capacity={240} />
          </>
        );
      };

      const tree = <Scene />;
      const renderer = await renderPhysics(tree, fixed);
      const api = getApi();

      inputs.set(0, 1200);
      stepTo(api, offset + 1);
      while (entered === -1) api.step(3 * STEP);

      // The step straight after the contact began.
      expect(rollback.rewind(entered + 1)).toBe(true);
      await updatePhysics(renderer, tree, fixed);

      expect(inside, `offset ${offset}`).toHaveLength(1);

      await unmount(renderer);
      expectNoAsserts();
      inputs.clear();
    }
  });
});

describe('updateLoop="fixed"', () => {
  let now = 0;

  const Faller = () => {
    useSphere({
      stateId: 1,
      radius: 0.5,
      position: [0, 400, 0],
      motionType: "dynamic",
    });
    return null;
  };

  const running = async (options = {}) => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    return renderPhysics(<Faller />, {
      updateLoop: "fixed",
      timeStep: STEP,
      ...options,
    });
  };

  const finish = async (renderer: Awaited<ReturnType<typeof renderPhysics>>) => {
    await unmount(renderer);
    vi.useRealTimers();
    vi.restoreAllMocks();
    expectNoAsserts();
  };

  const pass = (ms: number, tick = 1000 / 60) => {
    for (let elapsed = 0; elapsed < ms; elapsed += tick) {
      now += tick;
      vi.advanceTimersByTime(tick);
    }
  };

  it("steps off the wall clock with no frames at all", async () => {
    const renderer = await running();
    const api = getApi();

    pass(1000);
    expect(api.timing.stepCount).toBeGreaterThanOrEqual(59);
    expect(api.timing.stepCount).toBeLessThanOrEqual(61);

    await finish(renderer);
  });

  it("drops nothing after a stall, where follow would", async () => {
    const renderer = await running();
    const api = getApi();

    now += 5000;
    vi.advanceTimersByTime(1000 / 60);
    expect(api.timing.stepCount).toBeGreaterThanOrEqual(299);
    expect(api.timing.stepCount).toBeLessThanOrEqual(301);

    await finish(renderer);
  });

  it("carries what is over the budget to the next tick", async () => {
    const renderer = await running();
    const api = getApi();

    // Every read of the clock during a tick moves it on, so each step costs 5 ms.
    now += 1000;
    let cost = 0;
    vi.mocked(performance.now).mockImplementation(() => {
      cost += 5;
      return now + cost;
    });
    vi.advanceTimersByTime(1000 / 60);
    const first = api.timing.stepCount;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(20);

    vi.mocked(performance.now).mockImplementation(() => now + cost);
    vi.advanceTimersByTime(1000 / 60);
    expect(api.timing.stepCount).toBeGreaterThan(first + 20);

    await finish(renderer);
  });

  it("stops the clock while paused, and owes nothing for it", async () => {
    const renderer = await running({ paused: true });
    const api = getApi();

    pass(1000);
    expect(api.timing.stepCount).toBe(0);

    await updatePhysics(renderer, <Faller />, {
      updateLoop: "fixed",
      timeStep: STEP,
    });
    pass(100);
    expect(api.timing.stepCount).toBeLessThanOrEqual(7);
    expect(api.timing.stepCount).toBeGreaterThan(0);

    await finish(renderer);
  });

  it("stops ticking when unmounted", async () => {
    const renderer = await running();
    await unmount(renderer);

    expect(() => pass(100)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
    vi.restoreAllMocks();
    expectNoAsserts();
  });

  it('refuses timeStep="vary"', async () => {
    await expect(running({ timeStep: "vary" })).rejects.toThrow("numeric timeStep");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
