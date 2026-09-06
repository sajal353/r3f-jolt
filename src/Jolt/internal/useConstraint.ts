import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type Jolt from "jolt-physics";
import { useJolt } from "../useJolt";
import { createConstraintDebugLines } from "./constraintDebug";
import type { BodyApi } from "./useBody";
import type { ConstraintEntry, JoltApi, JoltModule, Temps } from "../types";

/**
 * Either side of a constraint. `null` anchors to the world, which is how a door
 * hangs from a frame that is not itself a body; `undefined` means a body hook
 * that has not published its api yet, and the constraint waits for it.
 */
export type ConstraintBody = BodyApi<Jolt.Shape> | Jolt.Body | null;

export interface ConstraintOptions {
  enabled?: boolean;
  /**
   * Constraints are solved low priority first, so raise it for a joint the
   * others should build on — the root of a chain, typically.
   */
  priority?: number;
  numVelocityStepsOverride?: number;
  numPositionStepsOverride?: number;
  debug?: boolean;
  settingsOverride?: (
    settings: Jolt.TwoBodyConstraintSettings,
    jolt: JoltModule,
  ) => void;
}

export interface ConstraintApi<C extends Jolt.Constraint> {
  constraint: C;
  body1: Jolt.Body;
  body2: Jolt.Body;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  /** False once both bodies are asleep, and while the constraint is disabled. */
  isActive: () => boolean;
  setPriority: (priority: number) => void;
  /**
   * Drops the solver's accumulated impulses. Call it after teleporting either
   * body, or the joint fights a correction computed for where the body was.
   */
  resetWarmStart: () => void;
  /** Wakes both bodies. The runtime setters already do this for you. */
  activate: () => void;
}

/** What a hook needs to build its own runtime methods on top of the shared ones. */
export interface ConstraintApiContext<C extends Jolt.Constraint> {
  constraint: C;
  /** False once the world is disposed or the hook has unmounted. */
  usable: () => boolean;
  /**
   * Call after any change that should have a visible effect. Both bodies fall
   * asleep once a joint settles, and a sleeping body ignores a retargeted motor
   * until something else wakes it.
   */
  activate: () => void;
  jolt: JoltModule;
  temps: Temps;
}

export interface ConstraintBuild<C extends Jolt.Constraint, E extends object> {
  settings: (jolt: JoltModule, temps: Temps) => Jolt.TwoBodyConstraintSettings;
  cast: (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) => C;
  api?: (context: ConstraintApiContext<C>) => E;
}

const resolveBody = (api: JoltApi, value: ConstraintBody): Jolt.Body => {
  if (value === null) {
    return api.Jolt.JoltInterface.prototype.sGetFixedToWorldBody();
  }

  return "body" in value ? value.body : value;
};

const applySharedOptions = (
  settings: Jolt.TwoBodyConstraintSettings,
  options: ConstraintOptions,
) => {
  const {
    enabled = true,
    numVelocityStepsOverride,
    numPositionStepsOverride,
  } = options;

  settings.mEnabled = enabled;

  if (numVelocityStepsOverride !== undefined) {
    settings.mNumVelocityStepsOverride = numVelocityStepsOverride;
  }

  if (numPositionStepsOverride !== undefined) {
    settings.mNumPositionStepsOverride = numPositionStepsOverride;
  }
};

const createSharedApi = <C extends Jolt.Constraint>(
  constraint: Jolt.TwoBodyConstraint,
  typed: C,
  body1: Jolt.Body,
  body2: Jolt.Body,
  usable: () => boolean,
  activate: () => void,
): ConstraintApi<C> => {
  const setEnabled = (enabled: boolean) => {
    if (!usable()) return;
    constraint.SetEnabled(enabled);
    activate();
  };

  const isEnabled = () => usable() && constraint.GetEnabled();

  const isActive = () => usable() && constraint.IsActive();

  const setPriority = (priority: number) => {
    if (!usable()) return;
    constraint.SetConstraintPriority(priority);
  };

  const resetWarmStart = () => {
    if (!usable()) return;
    constraint.ResetWarmStart();
  };

  return {
    constraint: typed,
    body1,
    body2,
    setEnabled,
    isEnabled,
    isActive,
    setPriority,
    resetWarmStart,
    activate,
  };
};

/**
 * The shared constraint lifecycle. `AddConstraint` takes the **only** reference,
 * so the hook holds one of its own — without it `RemoveConstraint` deletes the
 * constraint outright and the teardown that follows is a double free.
 *
 * Init-once like the body hooks: options are snapshotted at mount and later
 * changes are ignored. Rebuild with `key`, or use the runtime setters.
 */
export const useConstraint = <
  C extends Jolt.Constraint,
  E extends object = object,
>(
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: ConstraintOptions,
  build: ConstraintBuild<C, E>,
) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);

  const aliveRef = useRef(false);
  const debugRef = useRef<(() => void) | null>(null);
  const [constraintApi, setConstraintApi] = useState<ConstraintApi<C> & E>();

  const [mount] = useState(() => ({ options, build }));

  useEffect(() => {
    if (body1 === undefined || body2 === undefined) return;

    const {
      Jolt: jolt,
      physicsSystem,
      bodyInterface,
      temps,
      state,
      debug: debugDefault,
    } = api;

    const { options, build } = mount;
    const { priority, debug = debugDefault, settingsOverride } = options;

    const first = resolveBody(api, body1);
    const second = resolveBody(api, body2);

    const settings = build.settings(jolt, temps);
    applySharedOptions(settings, options);
    settingsOverride?.(settings, jolt);

    // `Create` is declared as returning the base `Constraint`, but a
    // `TwoBodyConstraintSettings` only ever builds a two-body one.
    const constraint = jolt.castObject(
      settings.Create(first, second),
      jolt.TwoBodyConstraint,
    );

    jolt.destroy(settings);

    constraint.AddRef();
    physicsSystem.AddConstraint(constraint);

    if (priority !== undefined) constraint.SetConstraintPriority(priority);

    const entry: ConstraintEntry = {
      constraint,
      body1: first,
      body2: second,
    };
    const unregister = api.constraints.add(entry);

    const debugView = debug ? createConstraintDebugLines() : null;

    if (debugView) {
      scene.add(debugView.lines);
      debugRef.current = () => debugView.update((draw) => draw(entry));
    }

    aliveRef.current = true;

    const usable = () => aliveRef.current && !state.disposed;

    const activate = () => {
      if (!usable()) return;
      bodyInterface.ActivateConstraint(constraint);
    };

    const typed = build.cast(constraint, jolt);
    const shared = createSharedApi(
      constraint,
      typed,
      first,
      second,
      usable,
      activate,
    );
    const extras = build.api?.({
      constraint: typed,
      usable,
      activate,
      jolt,
      temps,
    });

    setConstraintApi({ ...shared, ...extras } as ConstraintApi<C> & E);

    return () => {
      aliveRef.current = false;
      debugRef.current = null;
      unregister();
      setConstraintApi(undefined);

      if (debugView) {
        scene.remove(debugView.lines);
        debugView.dispose();
      }

      if (state.destroyed) return;

      physicsSystem.RemoveConstraint(constraint);
      constraint.Release();
    };
  }, [api, body1, body2, mount, scene]);

  useFrame(() => {
    debugRef.current?.();
  });

  return [constraintApi] as [(ConstraintApi<C> & E) | undefined];
};
