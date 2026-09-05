import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import initJolt from "jolt-physics/wasm-compat";
import type Jolt from "jolt-physics";
import { joltContext } from "./context";
import { createActivationRegistry } from "./internal/activation";
import { createConstraintRegistry } from "./internal/constraints";
import { createContactRegistry } from "./internal/contacts";
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
  return pending;
};

const defaultInit: JoltInit = () => initJolt();

export interface PhysicsProps {
  children: ReactNode;
  gravity?: Vec3Tuple;
  paused?: boolean;
  /**
   * Turns the per-hook `debug` flag on for every hook that does not set it.
   * Each hook reads it once, at mount, so changing it rebuilds every body in
   * the world — `<PhysicsDebug />` is the toggle to reach for at runtime.
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
   * your own, and for a deterministic replay.
   */
  updateLoop?: "follow" | "independent";
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
  const [world, setWorld] = useState<Omit<JoltApi, "debug"> | null>(null);
  const accumulatorRef = useRef(0);
  const invalidate = useThree((state) => state.invalidate);

  // One mutable clock for the world, handed to every consumer by reference so a
  // body reads this frame's values rather than the ones captured at mount.
  const timingRef = useRef<PhysicsTiming>({
    stepDelta: typeof timeStep === "number" ? timeStep : 1 / 60,
    stepCount: 0,
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

    /**
     * One step, with its subscribers either side of it. They run *between*
     * `Step()` calls rather than inside one, so the world is theirs to touch;
     * `stepCount` is advanced between the two phases so a callback reading the
     * clock sees the step it is in rather than last frame's.
     */
    const runStep = (stepDelta: number) => {
      const index = timing.stepCount;

      timing.stepDelta = stepDelta;
      world.steps.run("before", stepDelta, index);
      world.joltInterface.Step(stepDelta, collisionSteps);
      timing.stepCount = index + 1;
      world.steps.run("after", stepDelta, index);
    };

    if (timeStep === "vary") {
      runStep(Math.min(elapsed, 1 / 30));
    } else {
      accumulatorRef.current += elapsed;

      let steps = 0;
      while (accumulatorRef.current >= timeStep && steps < maxSubSteps) {
        runStep(timeStep);
        accumulatorRef.current -= timeStep;
        steps += 1;
      }

      if (steps === maxSubSteps) {
        accumulatorRef.current = 0;
      }

      timing.alpha = timing.interpolate ? accumulatorRef.current / timeStep : 0;
    }

    world.contacts.flush();
    world.activation.flush();

    // On `frameloop="demand"` nothing asks for the next frame, so a world with
    // anything still moving in it would freeze mid-fall. Asking while bodies are
    // awake keeps it running and lets it genuinely stop once everything sleeps,
    // which is the point of demand. A no-op on the default frame loop.
    if (
      world.physicsSystem.GetNumActiveBodies(world.Jolt.EBodyType_RigidBody) > 0
    ) {
      invalidate();
    }
  };

  const advanceRef = useHandlerRef(advance);

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
      settingsOverride?.(settings, jolt);

      const joltInterface = new jolt.JoltInterface(settings);
      jolt.destroy(settings);

      const physicsSystem = joltInterface.GetPhysicsSystem();
      const bodyInterface = physicsSystem.GetBodyInterface();
      const state = { disposed: false, destroyed: false };
      const contacts = createContactRegistry(jolt, physicsSystem);
      const activation = createActivationRegistry(jolt, physicsSystem);
      const constraints = createConstraintRegistry();
      const steps = createStepRegistry();
      const temps = createTemps(jolt);

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
        timing: timingRef.current,
        step: (delta?: number) => advanceRef.current(delta),
        state,
      });
    };

    void build();

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
          world.jolt.destroy(world.joltInterface);
        });
      }
    };
  }, [mount, advanceRef]);

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
    advance(delta);
  }, updatePriority);

  const value = useMemo(
    () => (world ? { ...world, debug } : null),
    [world, debug],
  );

  if (!value) return null;

  return <joltContext.Provider value={value}>{children}</joltContext.Provider>;
};
