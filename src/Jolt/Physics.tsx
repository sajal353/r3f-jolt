import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import initJolt from "jolt-physics/wasm-compat";
import type Jolt from "jolt-physics";
import { joltContext, physicsDebugContext } from "./context";
import { createActivationRegistry } from "./internal/activation";
import { createConstraintRegistry } from "./internal/constraints";
import { createContactRegistry } from "./internal/contacts";
import { createWaterRegistry } from "./internal/water";
import {
  createStateIdRegistry,
  type StateIdRegistry,
} from "./internal/stateIds";
import { createSnapshots, type Snapshots } from "./internal/snapshot";
import { createStepRegistry } from "./internal/steps";
import { createTemps } from "./internal/temps";
import { useHandlerRef } from "./internal/useHandlerRef";
import {
  applyPhysicsSettings,
  sameSettings,
  type PhysicsSettingsOptions,
} from "./internal/physicsSettings";
import type {
  BroadPhaseLayerConfig,
  JoltApi,
  JoltInit,
  JoltModule,
  PhysicsTiming,
  StateFilter,
  Temps,
  Vec3Tuple,
} from "./types";

const GROUP_NON_MOVING = 1 << 0;
const GROUP_MOVING = 1 << 1;

const DEFAULT_BROAD_PHASE: BroadPhaseLayerConfig[] = [
  { include: GROUP_NON_MOVING },
  { include: GROUP_MOVING },
];

const moduleCache = new Map<JoltInit, Promise<JoltModule>>();

const loadModule = (init: JoltInit) => {
  const cached = moduleCache.get(init);
  if (cached) return cached;

  const pending = init();
  moduleCache.set(init, pending);
  // A failed load is not kept, so the next mount tries again.
  pending.catch(() => moduleCache.delete(init));
  return pending;
};

const defaultInit: JoltInit = () => initJolt();

/** How long one tick of the fixed loop may spend catching up, in milliseconds. */
const CATCH_UP_BUDGET = 50;

export interface PhysicsProps {
  children: ReactNode;
  gravity?: Vec3Tuple;
  paused?: boolean;
  /**
   * Turns the per-hook `debug` flag on for every hook that does not set it.
   * Live: changing it adds or removes their overlays without touching a body.
   */
  debug?: boolean;
  timeStep?: number | "vary";
  /**
   * Render bodies between physics steps instead of snapping to the last one.
   * Costs one step of latency and is what stops a fixed timestep looking juddery
   * whenever the frame rate is not a multiple of it. Ignored when `timeStep` is
   * `"vary"`, which already lands a step on every frame.
   */
  interpolate?: boolean;
  maxSubSteps?: number;
  collisionSteps?: number;
  broadPhaseLayers?: BroadPhaseLayerConfig[];
  /**
   * Hard caps on the world, sized at construction. Jolt allocates for them up
   * front, so raising one costs memory whether or not it is used, and changing
   * one after mount means a new world — `key` the `<Physics>`, as with
   * `broadPhaseLayers`.
   */
  maxBodies?: number;
  maxBodyPairs?: number;
  maxContactConstraints?: number;
  /**
   * Only a `*-multithread` build has threads to create, and that build needs
   * COOP/COEP headers on the page. Ignored otherwise; see the readme.
   */
  maxWorkerThreads?: number;
  /**
   * Solver and sleep settings, applied over the defaults the world was built
   * with. Unlike the caps above these are live: change one and it takes effect
   * on the next step.
   */
  physicsSettings?: PhysicsSettingsOptions;
  /**
   * Where the step sits in R3F's frame. It must stay **negative**: R3F hands
   * rendering to a subscriber the moment any priority is greater than zero, and
   * a positive value here means nothing draws the scene unless you do it
   * yourself.
   */
  updatePriority?: number;
  /**
   * `"follow"` steps the world from R3F's frame loop, which is what you want
   * almost always. `"independent"` subscribes to no frame at all and the world
   * advances only through `api.step()` — for stepping by hand, for a loop of
   * your own, and for a deterministic replay. `"fixed"` runs on a timer and the
   * wall clock, so it keeps time in a background tab and never drops a step,
   * which `maxSubSteps` does; it needs a numeric `timeStep`. `"fixed"` is
   * experimental and may change in a minor release.
   */
  updateLoop?: "follow" | "independent" | "fixed";
  module?: JoltModule;
  init?: JoltInit;
  settingsOverride?: (settings: Jolt.JoltSettings, jolt: JoltModule) => void;
}

export const Physics = ({
  children,
  gravity = [0, -9.81, 0],
  paused = false,
  debug = false,
  timeStep = 1 / 60,
  interpolate = true,
  maxSubSteps = 4,
  collisionSteps = 1,
  broadPhaseLayers = DEFAULT_BROAD_PHASE,
  maxBodies,
  maxBodyPairs,
  maxContactConstraints,
  maxWorkerThreads,
  physicsSettings,
  updatePriority = -1,
  updateLoop = "follow",
  module,
  init = defaultInit,
  settingsOverride,
}: PhysicsProps) => {
  const [world, setWorld] = useState<JoltApi | null>(null);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const gravityRef = useHandlerRef(gravity);
  const accumulatorRef = useRef(0);
  const debugRef = useRef(debug);
  const invalidate = useThree((state) => state.invalidate);

  // One mutable clock for the world, handed to every consumer by reference so a
  // body reads this frame's values rather than the ones captured at mount.
  const timingRef = useRef<PhysicsTiming>({
    stepDelta: typeof timeStep === "number" ? timeStep : 1 / 60,
    stepCount: 0,
    elapsed: 0,
    restores: 0,
    resimulating: false,
    alpha: 0,
    interpolate: false,
  });

  // The world is built once; changing these after mount is a remount (`key`).
  const [mount] = useState(() => ({
    broadPhaseLayers,
    maxBodies,
    maxBodyPairs,
    maxContactConstraints,
    maxWorkerThreads,
    module,
    init,
    settingsOverride,
  }));

  const steppingRef = useRef(false);
  const lastTickRef = useRef(0);

  /**
   * One step, with its subscribers either side of it. They run *between*
   * `Step()` calls rather than inside one, so the world is theirs to touch;
   * `stepCount` is advanced between the two phases so a callback reading the
   * clock sees the step it is in rather than last frame's.
   */
  const runStep = (active: JoltApi, stepDelta: number) => {
    const timing = timingRef.current;
    const index = timing.stepCount;

    steppingRef.current = true;
    try {
      timing.stepDelta = stepDelta;
      active.steps.run("start", stepDelta, index);
      active.steps.run("before", stepDelta, index);
      active.constraints.order();
      active.joltInterface.Step(stepDelta, collisionSteps);
      timing.stepCount = index + 1;
      timing.elapsed += stepDelta;
      active.steps.run("after", stepDelta, index);
    } finally {
      steppingRef.current = false;
    }
  };

  const settle = (active: JoltApi) => {
    active.contacts.flush();
    active.activation.flush();
    active.water.flush();

    // On `frameloop="demand"` nothing asks for the next frame, so a world with
    // anything still moving in it would freeze mid-fall. Asking while bodies are
    // awake keeps it running and lets it genuinely stop once everything sleeps,
    // which is the point of demand. A no-op on the default frame loop.
    if (
      active.physicsSystem.GetNumActiveBodies(active.Jolt.EBodyType_RigidBody) >
        0 ||
      active.physicsSystem.GetNumActiveBodies(active.Jolt.EBodyType_SoftBody) > 0
    ) {
      invalidate();
    }
  };

  /**
   * One frame's worth of simulation. Shared by the frame loop and by
   * `api.step()`, so a world driven by hand runs exactly what a world driven by
   * R3F does — same accumulator, same step callbacks, same flushes.
   */
  const advance = (delta?: number) => {
    if (!world || world.state.disposed || paused) return;

    const timing = timingRef.current;
    const elapsed =
      delta ?? (typeof timeStep === "number" ? timeStep : 1 / 60);

    if (timeStep === "vary") {
      runStep(world, Math.min(elapsed, 1 / 30));
    } else {
      accumulatorRef.current += elapsed;

      let steps = 0;
      while (accumulatorRef.current >= timeStep && steps < maxSubSteps) {
        runStep(world, timeStep);
        accumulatorRef.current -= timeStep;
        steps += 1;
      }

      if (steps === maxSubSteps) {
        accumulatorRef.current = 0;
      }

      timing.alpha = timing.interpolate ? accumulatorRef.current / timeStep : 0;
    }

    settle(world);
  };

  /**
   * `updateLoop="fixed"`. Time owed stays owed: past the budget the rest waits
   * for the next tick rather than being dropped, so the step count follows the
   * wall clock however long a tab sat throttled.
   */
  const tickFixed = () => {
    const now = performance.now();
    const owed = (now - lastTickRef.current) / 1000;
    lastTickRef.current = now;

    if (typeof timeStep !== "number") return;
    if (!world || world.state.disposed || paused) return;

    accumulatorRef.current += owed;

    let ran = false;
    while (
      accumulatorRef.current >= timeStep &&
      performance.now() - now < CATCH_UP_BUDGET
    ) {
      runStep(world, timeStep);
      accumulatorRef.current -= timeStep;
      ran = true;
    }

    const timing = timingRef.current;
    timing.alpha = timing.interpolate
      ? Math.min(accumulatorRef.current / timeStep, 1)
      : 0;

    if (ran) settle(world);
  };

  const replay = (bytes: Uint8Array, untilStep: number) => {
    if (!world || world.state.disposed) {
      throw new Error("r3f-jolt: replay on a world that is gone.");
    }
    if (typeof timeStep !== "number") {
      throw new Error('r3f-jolt: replay needs a numeric timeStep, not "vary".');
    }
    if (steppingRef.current) {
      throw new Error(
        "r3f-jolt: replay or rewind from inside a step callback. Call it " +
          "between steps, where the input arrives.",
      );
    }

    const timing = timingRef.current;
    world.snapshots.restore(bytes);

    timing.resimulating = true;
    try {
      while (timing.stepCount < untilStep) runStep(world, timeStep);
      settle(world);
    } finally {
      timing.resimulating = false;
    }
  };

  const advanceRef = useHandlerRef(advance);
  const replayRef = useHandlerRef(replay);
  const tickFixedRef = useHandlerRef(tickFixed);

  useEffect(() => {
    let cancelled = false;
    let created: {
      jolt: JoltModule;
      joltInterface: Jolt.JoltInterface;
      contacts: ReturnType<typeof createContactRegistry>;
      activation: ReturnType<typeof createActivationRegistry>;
      constraints: ReturnType<typeof createConstraintRegistry>;
      steps: ReturnType<typeof createStepRegistry>;
      temps: Temps;
      characters: Jolt.CharacterVsCharacterCollisionSimple;
      water: ReturnType<typeof createWaterRegistry>;
      stateIds: StateIdRegistry;
      snapshots: Snapshots;
      state: { disposed: boolean; destroyed: boolean };
    } | null = null;

    const build = async () => {
      const {
        broadPhaseLayers,
        maxBodies,
        maxBodyPairs,
        maxContactConstraints,
        maxWorkerThreads,
        module,
        init,
        settingsOverride,
      } = mount;
      const jolt = module ?? (await loadModule(init));

      if (cancelled) return;

      const settings = new jolt.JoltSettings();
      const broadPhaseInterface = new jolt.BroadPhaseLayerInterfaceMask(
        broadPhaseLayers.length,
      );

      broadPhaseLayers.forEach((entry, index) => {
        const broadPhaseLayer = new jolt.BroadPhaseLayer(index);
        broadPhaseInterface.ConfigureLayer(
          broadPhaseLayer,
          entry.include,
          entry.exclude ?? 0,
        );
        jolt.destroy(broadPhaseLayer);
      });

      settings.mBroadPhaseLayerInterface = broadPhaseInterface;
      settings.mObjectLayerPairFilter = new jolt.ObjectLayerPairFilterMask();
      settings.mObjectVsBroadPhaseLayerFilter =
        new jolt.ObjectVsBroadPhaseLayerFilterMask(broadPhaseInterface);

      if (maxBodies !== undefined) settings.mMaxBodies = maxBodies;
      if (maxBodyPairs !== undefined) settings.mMaxBodyPairs = maxBodyPairs;
      if (maxContactConstraints !== undefined) {
        settings.mMaxContactConstraints = maxContactConstraints;
      }
      if (maxWorkerThreads !== undefined) {
        settings.mMaxWorkerThreads = maxWorkerThreads;
      }

      // Last, so the escape hatch outranks every prop above it.
      try {
        settingsOverride?.(settings, jolt);
      } catch (error) {
        jolt.destroy(settings);
        throw error;
      }

      const joltInterface = new jolt.JoltInterface(settings);
      jolt.destroy(settings);

      const physicsSystem = joltInterface.GetPhysicsSystem();
      // Here as well as in the effect below, which runs after the children's
      // own: a character mounting would otherwise see Jolt's default.
      const [startX, startY, startZ] = gravityRef.current;
      const startGravity = new jolt.Vec3(startX, startY, startZ);
      physicsSystem.SetGravity(startGravity);
      jolt.destroy(startGravity);
      const bodyInterface = physicsSystem.GetBodyInterface();
      const state = { disposed: false, destroyed: false };
      const steps = createStepRegistry();
      const contacts = createContactRegistry(jolt, physicsSystem, steps);
      const activation = createActivationRegistry(jolt, physicsSystem);
      const constraints = createConstraintRegistry(physicsSystem);
      const water = createWaterRegistry(
        jolt,
        joltInterface,
        steps,
        timingRef.current,
      );
      const stateIds = createStateIdRegistry(jolt, physicsSystem);
      const snapshots = createSnapshots(
        jolt,
        physicsSystem,
        stateIds,
        constraints,
        timingRef.current,
        function flushEvents() {
          contacts.flush();
          activation.flush();
          water.flush();
        },
      );
      const temps = createTemps(jolt);
      const characters = new jolt.CharacterVsCharacterCollisionSimple();

      const objectLayer = (group: number, mask: number) =>
        jolt.ObjectLayerPairFilterMask.prototype.sGetObjectLayer(group, mask);

      created = {
        jolt,
        joltInterface,
        contacts,
        activation,
        constraints,
        steps,
        temps,
        characters,
        water,
        stateIds,
        snapshots,
        state,
      };

      if (cancelled) {
        state.disposed = true;
        state.destroyed = true;
        contacts.destroy();
        activation.destroy();
        constraints.destroy();
        steps.destroy();
        temps.destroy();
        water.destroy();
        snapshots.destroy();
        stateIds.destroy();
        jolt.destroy(characters);
        jolt.destroy(joltInterface);
        created = null;
        return;
      }

      setWorld({
        Jolt: jolt,
        joltInterface,
        physicsSystem,
        bodyInterface,
        layers: {
          LAYER_NON_MOVING: objectLayer(GROUP_NON_MOVING, GROUP_MOVING),
          LAYER_MOVING: objectLayer(
            GROUP_MOVING,
            GROUP_NON_MOVING | GROUP_MOVING,
          ),
        },
        groups: { GROUP_NON_MOVING, GROUP_MOVING },
        objectLayer,
        contacts,
        activation,
        constraints,
        steps,
        temps,
        characters,
        water,
        timing: timingRef.current,
        stateIds,
        snapshots,
        saveState: (filter?: StateFilter) => {
          if (state.disposed) {
            throw new Error("r3f-jolt: saveState on a world that is gone.");
          }
          return snapshots.save(filter);
        },
        restoreState: (bytes: Uint8Array) => {
          if (state.disposed) {
            throw new Error("r3f-jolt: restoreState on a world that is gone.");
          }
          // The step under way would carry on from the restored world on the
          // clock it started with.
          if (steppingRef.current) {
            throw new Error(
              "r3f-jolt: restoreState from inside a step callback. Call it " +
                "between steps, where the snapshot arrives.",
            );
          }
          snapshots.restore(bytes);
        },
        replay: (bytes: Uint8Array, untilStep: number) =>
          replayRef.current(bytes, untilStep),
        step: (delta?: number) => advanceRef.current(delta),
        get debug() {
          return debugRef.current;
        },
        state,
      });
    };

    // Rendered as a throw below, so an error boundary sees a world that could
    // not be built rather than a <Physics> that stays empty.
    build().catch((error: unknown) => {
      if (!cancelled) setFailure({ error });
    });

    return () => {
      cancelled = true;
      setWorld(null);

      if (created) {
        const world = created;
        created = null;
        world.state.disposed = true;

        queueMicrotask(() => {
          world.state.destroyed = true;
          world.contacts.destroy();
          world.activation.destroy();
          world.constraints.destroy();
          world.steps.destroy();
          world.temps.destroy();
          world.water.destroy();
          world.snapshots.destroy();
          world.stateIds.destroy();
          world.jolt.destroy(world.characters);
          world.jolt.destroy(world.joltInterface);
        });
      }
    };
  }, [mount, advanceRef, replayRef, gravityRef]);

  useEffect(() => {
    if (updateLoop !== "fixed" || !world) return;
    if (typeof timeStep !== "number") {
      throw new Error(
        'r3f-jolt: <Physics updateLoop="fixed"> needs a numeric timeStep, not "vary".',
      );
    }

    lastTickRef.current = performance.now();
    const timer = setInterval(function tick() {
      tickFixedRef.current();
    }, timeStep * 1000);

    return () => clearInterval(timer);
  }, [updateLoop, world, timeStep, tickFixedRef]);

  // A fixed step is known from the prop and stays correct while paused; a
  // varying one is only knowable per frame, so the step callback owns that case.
  // Interpolation needs a fixed step to have anything to interpolate between:
  // `"vary"` already lands exactly one step on every frame.
  useEffect(() => {
    const timing = timingRef.current;

    if (typeof timeStep === "number") {
      timing.stepDelta = timeStep;
      timing.interpolate = interpolate;
    } else {
      timing.interpolate = false;
      timing.alpha = 0;
    }
  }, [timeStep, interpolate]);

  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);

  const [gravityX, gravityY, gravityZ] = gravity;

  useEffect(() => {
    if (!world) return;

    world.physicsSystem.SetGravity(
      world.temps.vec3([gravityX, gravityY, gravityZ]),
    );
  }, [world, gravityX, gravityY, gravityZ]);

  // No dependency array: the prop is an options object, and requiring a
  // consumer to memoize an inline literal to avoid re-applying it every render
  // is a worse deal than comparing the fields ourselves.
  const appliedSettings = useRef<PhysicsSettingsOptions | undefined>(undefined);

  useEffect(() => {
    if (!world || !physicsSettings) return;
    if (sameSettings(appliedSettings.current, physicsSettings)) return;

    applyPhysicsSettings(world.physicsSystem, physicsSettings);
    appliedSettings.current = { ...physicsSettings };
  });


  useEffect(() => {
    if (updatePriority > 0) {
      console.warn(
        `[r3f-jolt] <Physics updatePriority={${updatePriority}}>: R3F stops rendering ` +
          "the scene itself as soon as any frame subscriber has a priority above zero, " +
          "so nothing will be drawn unless you render it yourself. Keep it negative.",
      );
    }
  }, [updatePriority]);

  // Priority -1 runs the step before every body's default-priority sync, so
  // meshes read post-step transforms. It must stay negative: R3F hands rendering
  // to the subscriber only when priority is > 0.
  useFrame((_, delta) => {
    if (updateLoop === "independent") return;
    if (updateLoop === "fixed") tickFixed();
    else advance(delta);
  }, updatePriority);

  if (failure) throw failure.error;
  if (!world) return null;

  return (
    <joltContext.Provider value={world}>
      <physicsDebugContext.Provider value={debug}>
        {children}
      </physicsDebugContext.Provider>
    </joltContext.Provider>
  );
};
