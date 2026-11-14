import { useEffect, useRef, type RefObject } from "react";
import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import type { JoltApi, QuatTuple, Vec3Input, Vec3Tuple } from "../types";
import { readVector } from "./query";
import {
  softBodyMotion,
  softBodyVertices,
  type SoftBodyVertices,
} from "./softBodyVertices";
import { createVertexTracker, type VertexTracker } from "./softBodyTracker";
import {
  validateUserData,
  withCollisionGroup,
  type CollisionGroupOptions,
  type WaterBodyOptions,
} from "./useBody";

/** What every soft body takes, cloth, rope or hair. */
export interface SoftBodyBodyOptions extends WaterBodyOptions {
  /** The body's Jolt id, for `saveState`; see `BodyOptions.stateId`. */
  stateId?: number;
  position?: Vec3Tuple;
  iterations?: number;
  linearDamping?: number;
  maxLinearVelocity?: number;
  restitution?: number;
  friction?: number;
  gravityFactor?: number;
  /**
   * Keeps the vertices this far off whatever they rest on: how cloth draped
   * over a mesh avoids z-fighting with it, and how thick a rope is.
   */
  vertexRadius?: number;
  allowSleeping?: boolean;
  userData?: number;
  layer?: number;
  group?: number;
  mask?: number;
  collisionGroup?: CollisionGroupOptions;
  enabled?: boolean;
  debug?: boolean;
  /** World-space air velocity. Live. */
  wind?: Vec3Tuple;
  /**
   * Air resistance against the body's motion through the air, `wind`
   * included. 0 turns it off. Live.
   */
  airDrag?: number;
  settingsOverride?: (
    shared: Jolt.SoftBodySharedSettings,
    creation: Jolt.SoftBodyCreationSettings,
  ) => void;
}

/** The members every soft-body api shares. */
export interface SoftBodyBaseApi {
  body: Jolt.Body;
  /** Simulated vertices. */
  vertexCount: number;
  setEnabled: (enabled: boolean) => void;
  /** Acts on the whole body, every vertex alike. */
  applyForce: (force: Vec3Input) => void;
  applyImpulse: (impulse: Vec3Input) => void;
  setLinearVelocity: (velocity: Vec3Input) => void;
  setPosition: (position: Vec3Input) => void;
  wake: () => void;
  sleep: () => void;
  isSleeping: () => boolean;
  /** World position of a vertex, as of the last step. */
  getVertex: (index: number, target?: Vector3) => Vector3;
  /** Teleports a vertex, with no velocity. Pin it too, or it falls again. */
  setVertex: (index: number, position: Vec3Input) => void;
  /**
   * Sets one vertex moving, without pinning it. Called before every step with
   * a velocity towards a target, it drags the body the way a hand does: the
   * vertex keeps its mass, so the body pulls back instead of being yanked.
   * A pinned vertex has no mass to keep: it moves at exactly this velocity
   * until it is set again.
   */
  setVertexVelocity: (index: number, velocity: Vec3Input) => void;
  /** A pinned vertex has no mass: constraints and gravity cannot move it. */
  isPinned: (index: number) => boolean;
  pin: (index: number, pinned: boolean) => void;
  setWind: (wind: Vec3Input) => void;
  /** This body alone, every vertex included; see `BodyApi.saveState`. */
  saveState: () => Uint8Array;
  restoreState: (bytes: Uint8Array) => void;
}

export interface AirState {
  wind: Vector3;
  drag: number;
}

export interface SoftBodyHandle {
  body: Jolt.Body;
  id: Jolt.BodyID;
  bodyID: number;
  layout: SoftBodyVertices;
  motion: Jolt.SoftBodyMotionProperties;
  tracker: VertexTracker;
  /** Added to the world, not torn down, and the world still standing. */
  usable: () => boolean;
  /** Not torn down, and the world still standing; maybe not added. */
  readable: () => boolean;
  setEnabled: (enabled: boolean) => void;
  /** First thing in a cleanup: every api call is a no-op from here on. */
  retire: () => void;
  /** Last thing in a cleanup: takes the body out of the world and frees it. */
  destroy: () => void;
}

interface SoftBodyHandleOptions {
  /** Released here: the body holds its own reference once it exists. */
  shared: Jolt.SoftBodySharedSettings;
  position: Vec3Tuple;
  rotation: QuatTuple;
  options: SoftBodyBodyOptions;
  /** The fallback a pin lifted from a vertex built pinned goes back to. */
  mass: number | undefined;
  hook: string;
  /** Sets the creation fields only this hook has. */
  configure?: (creation: Jolt.SoftBodyCreationSettings) => void;
}

const ZERO: Vec3Tuple = [0, 0, 0];

export const requireRoomForBody = (physicsSystem: Jolt.PhysicsSystem) => {
  if (physicsSystem.GetNumBodies() >= physicsSystem.GetMaxBodies()) {
    throw new Error(
      `r3f-jolt: the world is full at ${physicsSystem.GetMaxBodies()} bodies. ` +
        "Raise `maxBodies` on <Physics>.",
    );
  }
};

const resolveLayer = (api: JoltApi, options: SoftBodyBodyOptions) => {
  const { layer, group, mask } = options;
  if (layer !== undefined) return layer;
  if (group === undefined && mask === undefined) return api.layers.LAYER_MOVING;
  return api.objectLayer(
    group ?? api.groups.GROUP_MOVING,
    mask ?? api.groups.GROUP_MOVING | api.groups.GROUP_NON_MOVING,
  );
};

const applyCreationOptions = (
  api: JoltApi,
  creation: Jolt.SoftBodyCreationSettings,
  options: SoftBodyBodyOptions,
) => {
  const {
    iterations,
    linearDamping,
    maxLinearVelocity,
    restitution,
    friction,
    gravityFactor,
    vertexRadius,
    allowSleeping,
    userData,
    collisionGroup,
  } = options;

  if (iterations !== undefined) creation.mNumIterations = iterations;
  if (linearDamping !== undefined) creation.mLinearDamping = linearDamping;
  if (maxLinearVelocity !== undefined) {
    creation.mMaxLinearVelocity = maxLinearVelocity;
  }
  if (restitution !== undefined) creation.mRestitution = restitution;
  if (friction !== undefined) creation.mFriction = friction;
  if (gravityFactor !== undefined) creation.mGravityFactor = gravityFactor;
  if (vertexRadius !== undefined) creation.mVertexRadius = vertexRadius;
  if (allowSleeping !== undefined) creation.mAllowSleeping = allowSleeping;
  if (userData !== undefined) {
    validateUserData(userData, "userData");
    creation.mUserData = userData;
  }
  if (collisionGroup) {
    withCollisionGroup(api.Jolt, collisionGroup, function setGroup(value) {
      creation.mCollisionGroup = value;
    });
  }
};

const createBody = (
  api: JoltApi,
  { shared, position, rotation, options, hook, configure }: SoftBodyHandleOptions,
) => {
  const { Jolt: jolt, temps } = api;
  const creation = new jolt.SoftBodyCreationSettings(
    shared,
    temps.rvec3(position),
    temps.quat(rotation),
    resolveLayer(api, options),
  );

  try {
    applyCreationOptions(api, creation, options);
    configure?.(creation);
    options.settingsOverride?.(shared, creation);
    return api.stateIds.createSoftBody(creation, options.stateId, hook);
  } finally {
    jolt.destroy(creation);
    shared.Release();
  }
};

const readInverseMasses = (jolt: JoltApi["Jolt"], layout: SoftBodyVertices) => {
  const masses = new Float32Array(layout.count);
  for (let index = 0; index < layout.count; index += 1) {
    masses[index] = jolt.HEAPF32[layout.inverseMass + index * layout.stride];
  }
  return masses;
};

/**
 * Builds the body from finished shared settings and adds it if `enabled`.
 * The caller keeps everything hook-specific; this owns the body itself.
 */
export const createSoftBodyHandle = (
  api: JoltApi,
  handleOptions: SoftBodyHandleOptions,
): SoftBodyHandle => {
  const { Jolt: jolt, bodyInterface, state } = api;
  const body = createBody(api, handleOptions);
  const id = body.GetID();
  const bodyID = id.GetIndexAndSequenceNumber();
  const layout = softBodyVertices(jolt, body);
  const motion = softBodyMotion(jolt, body);
  const tracker = createVertexTracker(layout.count);

  let added = false;
  let alive = true;
  const usable = () => added && alive && !state.disposed;
  const readable = () => alive && !state.disposed;

  const setEnabled = (value: boolean) => {
    if (!alive || state.disposed || value === added) return;
    if (value) {
      bodyInterface.AddBody(id, jolt.EActivation_Activate);
    } else {
      api.contacts.forgetSoftBody(bodyID);
      bodyInterface.RemoveBody(id);
    }
    added = value;
  };

  setEnabled(handleOptions.options.enabled ?? true);

  return {
    body,
    id,
    bodyID,
    layout,
    motion,
    tracker,
    usable,
    readable,
    setEnabled,
    retire: () => {
      alive = false;
    },
    destroy: () => {
      if (state.destroyed) return;
      if (added) {
        api.contacts.forgetSoftBody(bodyID);
        bodyInterface.RemoveBody(id);
      }
      bodyInterface.DestroyBody(id);
    },
  };
};

/** Pinned vertices are left alone: they move only when told to. */
export const addToFreeVertices = (
  heap: Float32Array,
  layout: SoftBodyVertices,
  x: number,
  y: number,
  z: number,
  replace: boolean,
) => {
  for (let index = 0; index < layout.count; index += 1) {
    const offset = index * layout.stride;
    if (heap[layout.inverseMass + offset] <= 0) continue;
    const at = layout.velocity + offset;
    heap[at] = (replace ? 0 : heap[at]) + x;
    heap[at + 1] = (replace ? 0 : heap[at + 1]) + y;
    heap[at + 2] = (replace ? 0 : heap[at + 2]) + z;
  }
};

/**
 * `vertexOf` turns the hook's own vertex index into a simulated one — through
 * the weld for cloth, unchanged for a rope.
 */
export const createSoftBodyBaseApi = (
  api: JoltApi,
  handle: SoftBodyHandle,
  air: RefObject<AirState>,
  vertexOf: (index: number) => number,
  mass: number | undefined,
): SoftBodyBaseApi => {
  const { Jolt: jolt, bodyInterface, temps } = api;
  const { body, id, layout, tracker, usable, readable } = handle;
  const restInverseMass = readInverseMasses(jolt, layout);
  const freeInverseMass =
    restInverseMass.find((value) => value > 0) ??
    (mass ? layout.count / mass : 1);

  const positionOf = (index: number) =>
    layout.position + vertexOf(index) * layout.stride;
  const velocityOf = (index: number) =>
    layout.velocity + vertexOf(index) * layout.stride;

  return {
    body,
    vertexCount: layout.count,
    setEnabled: handle.setEnabled,

    applyForce: (force) => {
      if (!usable()) return;
      bodyInterface.AddForce(id, temps.vec3(force), jolt.EActivation_Activate);
    },

    // Jolt's own `AddImpulse` and `SetLinearVelocity` write the rigid-body
    // velocity, which a soft body's solver never reads; these go to the
    // vertices instead.
    applyImpulse: (impulse) => {
      if (!usable()) return;
      const heap = jolt.HEAPF32;
      let total = 0;
      for (let index = 0; index < layout.count; index += 1) {
        const inverse = heap[layout.inverseMass + index * layout.stride];
        if (inverse > 0) total += 1 / inverse;
      }
      if (total === 0) return;
      const [x, y, z] = readVector(impulse);
      addToFreeVertices(heap, layout, x / total, y / total, z / total, false);
      bodyInterface.ActivateBody(id);
    },

    setLinearVelocity: (velocity) => {
      if (!usable()) return;
      const [x, y, z] = readVector(velocity);
      addToFreeVertices(jolt.HEAPF32, layout, x, y, z, true);
      bodyInterface.ActivateBody(id);
    },

    setPosition: (target) => {
      if (!usable()) return;
      tracker.reset();
      bodyInterface.SetPositionAndRotation(
        id,
        temps.rvec3(target),
        temps.quat([0, 0, 0, 1]),
        jolt.EActivation_Activate,
      );
    },

    wake: () => {
      if (usable()) bodyInterface.ActivateBody(id);
    },

    sleep: () => {
      if (usable()) bodyInterface.DeactivateBody(id);
    },

    isSleeping: () => usable() && !bodyInterface.IsActive(id),

    getVertex: (index, target = new Vector3()) => {
      if (!readable()) return target.set(0, 0, 0);
      const at = positionOf(index);
      const origin = body.GetPosition();
      const heap = jolt.HEAPF32;
      return target.set(
        heap[at] + origin.GetX(),
        heap[at + 1] + origin.GetY(),
        heap[at + 2] + origin.GetZ(),
      );
    },

    setVertex: (index, target) => {
      if (!usable()) return;
      const [x, y, z] = readVector(target);
      const at = positionOf(index);
      const origin = body.GetPosition();
      const heap = jolt.HEAPF32;
      heap[at] = x - origin.GetX();
      heap[at + 1] = y - origin.GetY();
      heap[at + 2] = z - origin.GetZ();
      heap.set(ZERO, velocityOf(index));
      bodyInterface.ActivateBody(id);
    },

    setVertexVelocity: (index, velocity) => {
      if (!usable()) return;
      const at = velocityOf(index);
      const [x, y, z] = readVector(velocity);
      const heap = jolt.HEAPF32;
      heap[at] = x;
      heap[at + 1] = y;
      heap[at + 2] = z;
      if (!bodyInterface.IsActive(id)) bodyInterface.ActivateBody(id);
    },

    isPinned: (index) =>
      readable() &&
      jolt.HEAPF32[layout.inverseMass + vertexOf(index) * layout.stride] === 0,

    pin: (index, pinned) => {
      if (!usable()) return;
      const physics = vertexOf(index);
      const heap = jolt.HEAPF32;
      heap[layout.inverseMass + physics * layout.stride] = pinned
        ? 0
        : restInverseMass[physics] || freeInverseMass;
      heap.set(ZERO, layout.velocity + physics * layout.stride);
      bodyInterface.ActivateBody(id);
    },

    setWind: (wind) => {
      const [x, y, z] = readVector(wind);
      air.current.wind.set(x, y, z);
    },

    saveState: () =>
      usable() ? api.snapshots.saveBody(body) : new Uint8Array(0),

    restoreState: (bytes) => {
      if (!usable() || bytes.length === 0) return;
      api.snapshots.restoreBody(body, bytes);
    },
  };
};

/** The live `wind` and `airDrag`, read by the step pass and `setWind`. */
export const useAir = (wind: Vec3Tuple | undefined, airDrag: number) => {
  const air = useRef<AirState>({ wind: new Vector3(), drag: airDrag });
  const [x, y, z] = wind ?? ZERO;

  useEffect(
    function applyAir() {
      air.current.wind.set(x, y, z);
      air.current.drag = airDrag;
    },
    [x, y, z, airDrag],
  );

  return air;
};

export type AirPass = (
  heap: Float32Array,
  layout: SoftBodyVertices,
  wind: Vector3,
  drag: number,
  delta: number,
) => void;

/** Before every step. Still air leaves a sleeper asleep; wind wakes it. */
export const addAirPass = (
  api: JoltApi,
  handle: SoftBodyHandle,
  air: RefObject<AirState>,
  pass: AirPass,
) =>
  api.steps.add("before", function blowOnSoftBody(delta) {
    const { wind, drag } = air.current;
    if (!handle.usable() || drag <= 0) return;

    if (!api.bodyInterface.IsActive(handle.id)) {
      if (wind.lengthSq() === 0) return;
      api.bodyInterface.ActivateBody(handle.id);
    }
    pass(api.Jolt.HEAPF32, handle.layout, wind, drag, delta);
  });

export interface SoftBodyLiveOptions {
  iterations?: number;
  vertexRadius?: number;
  friction?: number;
  restitution?: number;
  gravityFactor?: number;
  linearDamping?: number;
}

/** Applies what can change after creation; a change wakes the body. */
export const useLiveSoftBodyOptions = (
  api: JoltApi,
  softApi: SoftBodyBaseApi | undefined,
  {
    iterations,
    vertexRadius,
    friction,
    restitution,
    gravityFactor,
    linearDamping,
  }: SoftBodyLiveOptions,
) => {
  const appliedRef = useRef(false);

  useEffect(
    function applyLiveOptions() {
      if (!softApi) return;
      const motion = softBodyMotion(api.Jolt, softApi.body);

      if (iterations !== undefined) motion.SetNumIterations(iterations);
      if (vertexRadius !== undefined) motion.SetVertexRadius(vertexRadius);
      if (gravityFactor !== undefined) motion.SetGravityFactor(gravityFactor);
      if (linearDamping !== undefined) motion.SetLinearDamping(linearDamping);
      if (friction !== undefined) softApi.body.SetFriction(friction);
      if (restitution !== undefined) softApi.body.SetRestitution(restitution);

      // The first pass only restates what creation already set.
      if (appliedRef.current) softApi.wake();
      appliedRef.current = true;
    },
    [
      api,
      softApi,
      iterations,
      vertexRadius,
      friction,
      restitution,
      gravityFactor,
      linearDamping,
    ],
  );
};
