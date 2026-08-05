import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import initJolt from "jolt-physics/wasm-compat";
import type Jolt from "jolt-physics";
import { joltContext } from "./context";
import { createActivationRegistry } from "./internal/activation";
import { createContactRegistry } from "./internal/contacts";
import { createTemps } from "./internal/temps";
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
  module,
  init = defaultInit,
  settingsOverride,
}: PhysicsProps) => {
  const [world, setWorld] = useState<Omit<JoltApi, "debug"> | null>(null);
  const accumulatorRef = useRef(0);

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
    module,
    init,
    settingsOverride,
  }));

  useEffect(() => {
    let cancelled = false;
    let created: {
      jolt: JoltModule;
      joltInterface: Jolt.JoltInterface;
      contacts: ReturnType<typeof createContactRegistry>;
      activation: ReturnType<typeof createActivationRegistry>;
      temps: Temps;
      state: { disposed: boolean; destroyed: boolean };
    } | null = null;

    const build = async () => {
      const { broadPhaseLayers, module, init, settingsOverride } = mount;
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

      settingsOverride?.(settings, jolt);

      const joltInterface = new jolt.JoltInterface(settings);
      jolt.destroy(settings);

      const physicsSystem = joltInterface.GetPhysicsSystem();
      const bodyInterface = physicsSystem.GetBodyInterface();
      const state = { disposed: false, destroyed: false };
      const contacts = createContactRegistry(jolt, physicsSystem);
      const activation = createActivationRegistry(jolt, physicsSystem);
      const temps = createTemps(jolt);

      const objectLayer = (group: number, mask: number) =>
        jolt.ObjectLayerPairFilterMask.prototype.sGetObjectLayer(group, mask);

      created = { jolt, joltInterface, contacts, activation, temps, state };

      if (cancelled) {
        state.disposed = true;
        state.destroyed = true;
        contacts.destroy();
        activation.destroy();
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
        temps,
        timing: timingRef.current,
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
          world.temps.destroy();
          world.jolt.destroy(world.joltInterface);
        });
      }
    };
  }, [mount]);

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

  // Priority -1 runs the step before every body's default-priority sync, so
  // meshes read post-step transforms. It must stay negative: R3F hands rendering
  // to the subscriber only when priority is > 0.
  useFrame((_, delta) => {
    if (!world || world.state.disposed || paused) return;

    const timing = timingRef.current;

    if (timeStep === "vary") {
      const varyingStep = Math.min(delta, 1 / 30);
      timing.stepDelta = varyingStep;
      world.joltInterface.Step(varyingStep, collisionSteps);
      timing.stepCount += 1;
    } else {
      accumulatorRef.current += delta;

      let steps = 0;
      while (accumulatorRef.current >= timeStep && steps < maxSubSteps) {
        world.joltInterface.Step(timeStep, collisionSteps);
        accumulatorRef.current -= timeStep;
        steps += 1;
      }

      if (steps === maxSubSteps) {
        accumulatorRef.current = 0;
      }

      timing.stepCount += steps;
      timing.alpha = timing.interpolate ? accumulatorRef.current / timeStep : 0;
    }

    world.contacts.flush();
    world.activation.flush();
  }, -1);

  const value = useMemo(
    () => (world ? { ...world, debug } : null),
    [world, debug],
  );

  if (!value) return null;

  return <joltContext.Provider value={value}>{children}</joltContext.Provider>;
};
