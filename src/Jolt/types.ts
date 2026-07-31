import type initJolt from "jolt-physics/wasm-compat";
import type Jolt from "jolt-physics";
import type { Vector3 } from "three";

export type JoltModule = Awaited<ReturnType<typeof initJolt>>;

export type JoltInit = () => Promise<JoltModule>;

export type Vec3Tuple = [number, number, number];

export type QuatTuple = [number, number, number, number];

export type MotionType = "static" | "dynamic";

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

export interface ContactRegistry {
  addListener: (handlers: ContactHandlers) => () => void;
  addBodyListener: (bodyID: number, handlers: BodyContactHandlers) => () => void;
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
