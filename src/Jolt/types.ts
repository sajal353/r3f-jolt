import type initJolt from "jolt-physics/wasm-compat";
import type Jolt from "jolt-physics";
import type { Quaternion, Vector3 } from "three";

export type JoltModule = Awaited<ReturnType<typeof initJolt>>;

export type JoltInit = () => Promise<JoltModule>;

export type Vec3Tuple = [number, number, number];

export type QuatTuple = [number, number, number, number];

export type MotionType = "static" | "kinematic" | "dynamic";

export type Vec3Input = Vec3Tuple | Vector3;

export type QuatInput = QuatTuple | Quaternion;

/** Per-axis switches, ordered x, y, z. */
export type AxisTriple = [boolean, boolean, boolean];

/**
 * Scratch Jolt objects shared by the whole world. Every accessor returns a
 * borrowed object that the caller must neither store nor destroy — see
 * `internal/temps.ts` for how long one stays valid.
 */
export interface Temps {
  vec3: (value: Vec3Input) => Jolt.Vec3;
  rvec3: (value: Vec3Input) => Jolt.RVec3;
  quat: (value: QuatInput) => Jolt.Quat;
  destroy: () => void;
}

export interface BodyMaterial {
  friction?: number;
  restitution?: number;
}

export interface BroadPhaseLayerConfig {
  include: number;
  exclude?: number;
}

export interface LayerConfig {
  broadPhase: BroadPhaseLayerConfig[];
}

export interface ContactHandlers {
  onContactValidate?: (
    body1: Jolt.Body,
    body2: Jolt.Body,
    baseOffset: Jolt.RVec3,
    collisionResult: Jolt.CollideShapeResult,
  ) => boolean | void;
  onContactAdded?: (
    body1: Jolt.Body,
    body2: Jolt.Body,
    manifold: Jolt.ContactManifold,
    settings: Jolt.ContactSettings,
  ) => void;
  onContactPersisted?: (
    body1: Jolt.Body,
    body2: Jolt.Body,
    manifold: Jolt.ContactManifold,
    settings: Jolt.ContactSettings,
  ) => void;
  onContactRemoved?: (pair: Jolt.SubShapeIDPair) => void;
}

export interface ContactInfo {
  bodyID: number;
  userData: number;
  shapeUserData: number;
  point: Vector3;
  normal: Vector3;
  penetrationDepth: number;
}

export interface BodyContactHandlers {
  onEnter?: (contact: ContactInfo) => void;
  onStay?: (contact: ContactInfo) => void;
  onExit?: (contact: ContactInfo) => void;
}

/**
 * Live clock for the world, mutated in place by `<Physics>` each frame. Read
 * fields at the moment you need them rather than destructuring once.
 */
export interface PhysicsTiming {
  /**
   * Seconds the most recent step covered — the configured `timeStep`, or the
   * clamped frame delta when stepping `"vary"`. Anything deriving a velocity
   * from a target transform needs *this*, not `useFrame`'s render delta, which
   * is a different clock whenever the timestep is fixed.
   */
  stepDelta: number;
  /** Monotonic step count. A change means the world advanced since last frame. */
  stepCount: number;
  /**
   * How far the renderer is between the previous step and the current one, 0…1
   * — the accumulator remainder over `timeStep`. Always 0 when interpolation is
   * off or the timestep varies.
   */
  alpha: number;
  /** Whether `<Physics interpolate>` is on. */
  interpolate: boolean;
}

export interface ActivationHandlers {
  onWake?: () => void;
  onSleep?: () => void;
}

export interface ActivationRegistry {
  addBodyListener: (bodyID: number, handlers: ActivationHandlers) => () => void;
  flush: () => void;
  destroy: () => void;
}

export interface ContactRegistry {
  addListener: (handlers: ContactHandlers) => () => void;
  addBodyListener: (
    bodyID: number,
    handlers: BodyContactHandlers,
  ) => () => void;
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => number;
  flush: () => void;
  destroy: () => void;
}

export interface JoltApi {
  Jolt: JoltModule;
  joltInterface: Jolt.JoltInterface;
  physicsSystem: Jolt.PhysicsSystem;
  bodyInterface: Jolt.BodyInterface;
  layers: {
    LAYER_NON_MOVING: number;
    LAYER_MOVING: number;
  };
  groups: {
    GROUP_NON_MOVING: number;
    GROUP_MOVING: number;
  };
  objectLayer: (group: number, mask: number) => number;
  contacts: ContactRegistry;
  activation: ActivationRegistry;
  temps: Temps;
  timing: PhysicsTiming;
  debug: boolean;
  /**
   * React unmounts a parent's effects before its children's, so `<Physics>`
   * tears down first and every child hook cleans up afterwards. Destroying the
   * interface there would strand everything the children still have to free, so
   * `<Physics>` only flags `disposed` synchronously and defers the actual
   * destroy to a microtask — after the whole commit, children included.
   *
   * `disposed` — stop stepping and reject new work; the world is still valid.
   * `destroyed` — the interface is gone; touch nothing.
   */
  state: { disposed: boolean; destroyed: boolean };
}
