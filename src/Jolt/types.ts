import type initJolt from "jolt-physics/wasm-compat";
import type Jolt from "jolt-physics";
import type { Quaternion, Vector3 } from "three";
import type { StateIdRegistry } from "./internal/stateIds";
import type { Snapshots } from "./internal/snapshot";

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

/**
 * Soft bodies have a listener of their own: Jolt reports a soft body's
 * contacts once per step and pair, with no persisted or removed calls.
 */
export interface SoftBodyContactHandlers {
  /** Return `false` to let the pair pass through each other. */
  onSoftBodyContactValidate?: (
    softBody: Jolt.Body,
    otherBody: Jolt.Body,
    settings: Jolt.SoftBodyContactSettings,
  ) => boolean | void;
  onSoftBodyContactAdded?: (
    softBody: Jolt.Body,
    manifold: Jolt.SoftBodyManifold,
  ) => void;
}

export interface ContactInfo {
  bodyID: number;
  userData: number;
  shapeUserData: number;
  point: Vector3;
  /**
   * Contact normal, pointing **from the body you subscribed to** towards the
   * body in `bodyID` — so negating it is the direction you were pushed. Zero on
   * `onExit`.
   *
   * `useContactListener` is unaffected: a raw listener gets Jolt's manifold
   * untouched, whose normal runs from body 1 to body 2 in Jolt's own pair
   * ordering.
   */
  normal: Vector3;
  penetrationDepth: number;
  /**
   * Closing speed along the contact normal, in m/s, measured before the solver
   * ran. Zero for a resting or separating contact, and zero on `onExit` — the
   * manifold is gone by then.
   *
   * Only filled when the subscriber asked for it; see `BodyContactOptions`.
   */
  impactSpeed: number;
  /**
   * Normal impulse in kg·m/s, summed over the contact points: Jolt's
   * `EstimateCollisionResponse`, which runs the contact solver on this one
   * manifold with restitution, friction and surface velocity. An estimate
   * because the real solver also sees every other contact on both bodies.
   *
   * Only filled when the subscriber asked for it; see `BodyContactOptions`.
   */
  impulse: number;
  /**
   * Tangential impulse in kg·m/s from the same estimate: large for a scrape,
   * near zero for a straight drop.
   *
   * Only filled when the subscriber asked for it; see `BodyContactOptions`.
   */
  frictionImpulse: number;
}

export interface BodyContactHandlers {
  onEnter?: (contact: ContactInfo) => void;
  onStay?: (contact: ContactInfo) => void;
  onExit?: (contact: ContactInfo) => void;
}

/**
 * `contactForce` runs Jolt's collision estimate per contact per step, so it is
 * off unless asked for and `impactSpeed`, `impulse` and `frictionImpulse` stay
 * 0 without it.
 */
export interface BodyContactOptions {
  contactForce?: boolean;
}

/** Mutate in place to change the belt; the registry reads it inside the step. */
export interface SurfaceVelocity {
  linear: Vector3;
  angular: Vector3;
  space: "local" | "world";
}

/**
 * Jolt solves one relative velocity per contact, so a body has one record and
 * later callers share it: `source` may be a record someone else registered, and
 * `release` is then a no-op.
 */
export interface SurfaceVelocityHandle {
  source: SurfaceVelocity;
  release: () => void;
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
  stepCount: number;
  /** Simulated seconds: every step's delta added up. */
  elapsed: number;
  /**
   * How far the renderer is between the previous step and the current one, 0…1
   * — the accumulator remainder over `timeStep`. Always 0 when interpolation is
   * off or the timestep varies.
   */
  alpha: number;
  interpolate: boolean;
  /**
   * Counts `restoreState` calls. Anything holding on to a body's last pose —
   * interpolation, a sleeping body's skipped readback — reads it again when
   * this changes.
   */
  restores: number;
  /**
   * True while `replay` or a rollback's `rewind` runs steps a second time, and
   * for the events those steps deliver. Check it before anything that should
   * happen once, like a sound.
   *
   * @experimental May change in a minor release.
   */
  resimulating: boolean;
}

/**
 * Runs once per physics step, either side of it. `index` is the step's own
 * number — the value `PhysicsTiming.stepCount` holds while a `"before"`
 * callback runs, and one less than it holds while the matching `"after"` one
 * does.
 */
export type StepCallback = (delta: number, index: number) => void;

/** `"start"` runs ahead of every `"before"`, so it sees the world as the step found it. */
export type StepPhase = "start" | "before" | "after";

/**
 * The only registry with no Jolt object in it: these callbacks run *between*
 * `Step()` calls rather than inside one, so there is no listener to install and
 * nothing to free.
 */
export interface StepRegistry {
  add: (phase: StepPhase, callback: StepCallback) => () => void;
  run: (phase: StepPhase, delta: number, index: number) => void;
  destroy: () => void;
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
    options?: BodyContactOptions,
  ) => () => void;
  addSurfaceVelocity: (
    bodyID: number,
    source: SurfaceVelocity,
  ) => SurfaceVelocityHandle;
  surfaceVelocityOf: (bodyID: number) => SurfaceVelocity | undefined;
  addSoftBodyListener: (handlers: SoftBodyContactHandlers) => () => void;
  /** Ends a removed soft body's contacts, with `onExit` on both sides. */
  forgetSoftBody: (bodyID: number) => void;
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => number;
  flush: () => void;
  destroy: () => void;
}

export interface WaterEvent {
  bodyID: number;
  userData: number;
  /** Where the body was when it crossed, in world space. */
  position: Vector3;
  /** Its linear velocity at that moment: how big a splash to make. */
  velocity: Vector3;
}

export type WaterEventHandler = (event: WaterEvent) => void;

/** Height of the surface above `surfaceLevel` at `x, z`, at simulated `time`. */
export type WaveHeight = (x: number, z: number, time: number) => number;

/** What a point is under. Reused between calls unless you pass your own. */
export interface WaterSample {
  /** Metres below the surface. */
  depth: number;
  /** Including the wave at that point. */
  surfaceLevel: number;
  flow: Vector3;
}

/** One region, mutated in place by `<WaterVolume>` and read every step. */
export interface WaterVolumeEntry {
  min: Vector3;
  max: Vector3;
  surfaceLevel: number;
  buoyancy: number;
  linearDrag: number;
  angularDrag: number;
  flow: Vector3;
  priority: number;
  layer: number;
  waves?: WaveHeight;
  onEnter?: WaterEventHandler;
  onExit?: WaterEventHandler;
  /** Set when the region moved, rose or changed flow, so sleepers in it wake. */
  changed: boolean;
}

export interface WaterBodySettings {
  /** 0 opts out of buoyancy; anything else multiplies the volume's. */
  floats: number;
  onEnterWater?: WaterEventHandler;
  onExitWater?: WaterEventHandler;
}

export interface WaterRegistry {
  addVolume: (volume: WaterVolumeEntry) => () => void;
  addBody: (
    bodyID: number,
    settings: { readonly current: WaterBodySettings },
  ) => () => void;
  /** The highest-priority water `point` is under, or null when it is dry. */
  sample: (point: Vec3Input, target?: WaterSample) => WaterSample | null;
  flush: () => void;
  destroy: () => void;
}

/** One joint, as `<PhysicsDebug />` needs it: the constraint and both ends. */
export interface ConstraintEntry {
  constraint: Jolt.TwoBodyConstraint;
  body1: Jolt.Body;
  body2: Jolt.Body;
}

/**
 * Jolt binds no way to enumerate a world's constraints, so the library tracks
 * the ones its hooks create. A constraint built by hand through `useJolt()` is
 * not in here and will not be drawn.
 */
export interface ConstraintRegistry {
  add: (entry: ConstraintEntry) => () => void;
  forEach: (visit: (entry: ConstraintEntry) => void) => void;
  size: () => number;
  /** Throws if `stateId` is not a whole number or another constraint holds it. */
  check: (stateId: number, hook: string) => void;
  /** Adds the constraint to the world; the returned function takes it out. */
  attach: (
    constraint: Jolt.Constraint,
    stateId: number | undefined,
    hook: string,
  ) => () => void;
  /** Puts constraints with a `stateId` back in `stateId` order, if needed. */
  order: () => void;
  attached: () => readonly AttachedConstraint[];
  destroy: () => void;
}

export interface AttachedConstraint {
  constraint: Jolt.Constraint;
  stateId: number | undefined;
  hook: string;
}

/**
 * Picks what a filtered `saveState` holds, by `stateId`. A kind with no
 * function is left out, and contacts, gravity and the step clock only travel
 * in a full snapshot.
 */
export interface StateFilter {
  body?: (stateId: number) => boolean;
  constraint?: (stateId: number) => boolean;
  character?: (stateId: number) => boolean;
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
  constraints: ConstraintRegistry;
  steps: StepRegistry;
  temps: Temps;
  /**
   * Every `useCharacter` with `collideWithCharacters` adds itself here, so the
   * characters in one world block each other.
   */
  characters: Jolt.CharacterVsCharacterCollisionSimple;
  /** Every `<WaterVolume>` in the world, and what each body is floating in. */
  water: WaterRegistry;
  timing: PhysicsTiming;
  stateIds: StateIdRegistry;
  snapshots: Snapshots;
  /**
   * The whole world as bytes: every body, contact, constraint and character,
   * and the step clock. Needs a `stateId` on each of them, and throws naming
   * the ones without. With a `filter`, only what it selects.
   */
  saveState: (filter?: StateFilter) => Uint8Array;
  /**
   * Puts the world back as `saveState` found it, step clock included. Throws,
   * listing the differences, unless the world holds exactly the `stateId`s
   * the snapshot does — or, for a filtered one, at least those.
   */
  restoreState: (bytes: Uint8Array) => void;
  /**
   * Restores a snapshot, then runs fixed steps until `timing.stepCount` reaches
   * `untilStep`, with `timing.resimulating` set throughout. Leaves the
   * accumulator alone, works while paused, and needs a numeric `timeStep`.
   * Throws if called from a step callback.
   *
   * @experimental May change in a minor release.
   */
  replay: (bytes: Uint8Array, untilStep: number) => void;
  /**
   * Advances the world by hand: the same accumulator, step callbacks and event
   * flushes a frame runs. Meant for `updateLoop: "independent"`, where nothing
   * else steps it; with `"follow"` this is an extra step on top of the frame's.
   *
   * `delta` defaults to one `timeStep`, so `step()` is exactly one step.
   * Does nothing while the world is paused or disposed.
   */
  step: (delta?: number) => void;
  /**
   * The current `<Physics debug>`. Reading it does not subscribe to it; the
   * hooks pick up a change on their own.
   */
  readonly debug: boolean;
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
