import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, type BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "../useJolt";
import { syncObject } from "./syncObject";
import { createDebugMaterial, disposeDebugMaterial } from "./debugMaterial";
import type { DebugShapeKind } from "./debugMaterial";
import type {
  BodyMaterial,
  JoltModule,
  MotionType,
  QuatTuple,
  Vec3Tuple,
} from "../types";

/**
 * WASM ownership, in three rules. Getting these wrong corrupts the heap rather
 * than leaking, so they are worth stating once here.
 *
 * 1. Destroy exactly what you `new`. Getters and static factories
 *    (`GetPosition()`, `Quat.prototype.sIdentity()`) return cached wrappers
 *    around shared static storage — they allocate nothing, but they still carry
 *    a `__destroy__`, so destroying one frees a static temporary.
 * 2. Anything deriving from `RefTarget` — `Shape`, `ShapeSettings`,
 *    `PhysicsMaterial`, `Constraint`, `WheelSettings`, `CharacterBaseSettings` —
 *    is refcounted. Once another object takes a reference, ownership is the
 *    refcount's, and `destroy` becomes a double free. Use `AddRef`/`Release`.
 * 3. A `Shape` from `new Jolt.XShape(...)` starts at refcount 0; one from
 *    `settings.Create().Get()` starts at 2. `finishShape` normalises both to
 *    "the caller owns one reference".
 */

export interface BodyOptions {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  motionType: MotionType;
  mass?: number;
  material?: BodyMaterial;
  initialVelocity?: Vec3Tuple;
  debug?: boolean;
  enabled?: boolean;
  userData?: number;
  shapeUserData?: number;
  motionQuality?: "discrete" | "linearCast";
  layer?: number;
  group?: number;
  mask?: number;
  bodySettingsOverride?: (settings: Jolt.BodyCreationSettings) => void;
}

export interface BodyApi<S extends Jolt.Shape> {
  body: Jolt.Body;
  shape: S;
  geometry: BufferGeometry;
  debugMesh: Mesh | null;
  kill: () => void;
  revive: () => void;
}

/**
 * A shape factory hands back a shape the caller owns **one reference to**
 * (`AddRef` already called). `useBody` releases it once `BodyCreationSettings`
 * has taken its own reference. Without that reference the shape is freed the
 * moment its `ShapeSettings` is destroyed.
 */
export interface ShapeResult<S extends Jolt.Shape> {
  shape: S;
  geometry: BufferGeometry;
}

export const finishShape = <S extends Jolt.Shape>(shape: S): S => {
  shape.AddRef();
  return shape;
};

const MAX_USER_DATA = 0xffffffff;

const validateUserData = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_USER_DATA) {
    console.warn(
      `[r3f-jolt] ${label} must be a 32-bit unsigned integer (0…${MAX_USER_DATA}). ` +
        `Received ${value}, which the Jolt bindings will truncate.`,
    );
  }
};

export const useBody = <S extends Jolt.Shape>(
  createShape: (jolt: JoltModule) => ShapeResult<S>,
  options: BodyOptions,
  debugKind: DebugShapeKind,
) => {
  const ref = useRef<Mesh | null>(null);
  const api = useJolt();
  const scene = useThree((state) => state.scene);


  const aliveRef = useRef(false);
  const [bodyApi, setBodyApi] = useState<BodyApi<S>>();

  // Body creation is init-once: these are snapshotted at mount and later prop
  // changes are ignored by design (rebuild with `key`). Holding the snapshot in
  // state rather than a ref keeps the effect's dependency list honest.
  const [mount] = useState(() => ({ options, createShape, debugKind }));

  useEffect(() => {
    const {
      Jolt: jolt,
      bodyInterface,
      layers,
      groups,
      objectLayer,
      state,
      debug: debugDefault,
    } = api;

    const { options, createShape, debugKind } = mount;

    const {
      position,
      rotation = [0, 0, 0, 1],
      motionType,
      mass,
      material,
      initialVelocity,
      debug = debugDefault,
      enabled = true,
      userData,
      shapeUserData,
      motionQuality,
      layer,
      group,
      mask,
      bodySettingsOverride,
    } = options;

    const isDynamic = motionType === "dynamic";
    const { shape, geometry } = createShape(jolt);

    if (shapeUserData !== undefined) {
      validateUserData(shapeUserData, "shapeUserData");
      shape.SetUserData(shapeUserData);
    }

    const defaultGroup = isDynamic
      ? groups.GROUP_MOVING
      : groups.GROUP_NON_MOVING;
    const defaultMask = isDynamic
      ? groups.GROUP_MOVING | groups.GROUP_NON_MOVING
      : groups.GROUP_MOVING;

    const resolvedLayer =
      layer ??
      (group !== undefined || mask !== undefined
        ? objectLayer(group ?? defaultGroup, mask ?? defaultMask)
        : isDynamic
          ? layers.LAYER_MOVING
          : layers.LAYER_NON_MOVING);

    const settingsPosition = new jolt.RVec3(
      position[0],
      position[1],
      position[2],
    );
    const settingsRotation = new jolt.Quat(
      rotation[0],
      rotation[1],
      rotation[2],
      rotation[3],
    );

    const bodySettings = new jolt.BodyCreationSettings(
      shape,
      settingsPosition,
      settingsRotation,
      isDynamic ? jolt.EMotionType_Dynamic : jolt.EMotionType_Static,
      resolvedLayer,
    );

    if (userData !== undefined) {
      validateUserData(userData, "userData");
      bodySettings.mUserData = userData;
    }

    if (motionQuality !== undefined) {
      bodySettings.mMotionQuality =
        motionQuality === "linearCast"
          ? jolt.EMotionQuality_LinearCast
          : jolt.EMotionQuality_Discrete;
    }

    if (initialVelocity) {
      const velocity = new jolt.Vec3(
        initialVelocity[0],
        initialVelocity[1],
        initialVelocity[2],
      );
      bodySettings.mLinearVelocity = velocity;
      jolt.destroy(velocity);
    }

    shape.Release();

    bodySettingsOverride?.(bodySettings);

    const body = bodyInterface.CreateBody(bodySettings);

    jolt.destroy(bodySettings);
    jolt.destroy(settingsPosition);
    jolt.destroy(settingsRotation);

    if (isDynamic && mass !== undefined) {
      body.GetMotionProperties().ScaleToMass(mass);
    }

    if (material?.friction !== undefined) {
      body.SetFriction(material.friction);
    }

    if (material?.restitution !== undefined) {
      body.SetRestitution(material.restitution);
    }

    let added = false;

    const revive = () => {
      if (added || state.disposed || !aliveRef.current) return;
      bodyInterface.AddBody(
        body.GetID(),
        isDynamic ? jolt.EActivation_Activate : jolt.EActivation_DontActivate,
      );
      added = true;
    };

    const kill = () => {
      if (!added || state.disposed || !aliveRef.current) return;
      bodyInterface.RemoveBody(body.GetID());
      added = false;
    };

    aliveRef.current = true;

    if (enabled) {
      revive();
    }

    let debugMesh: Mesh | null = null;

    if (debug) {
      debugMesh = new Mesh(geometry, createDebugMaterial(debugKind));
      scene.add(debugMesh);
    }

    setBodyApi({ body, shape, geometry, debugMesh, kill, revive });

    return () => {
      aliveRef.current = false;
      setBodyApi(undefined);

      if (debugMesh) {
        scene.remove(debugMesh);
        disposeDebugMaterial(debugMesh);
      }

      geometry.dispose();

      if (state.destroyed) return;

      if (added) {
        bodyInterface.RemoveBody(body.GetID());
      }
      bodyInterface.DestroyBody(body.GetID());
    };
  }, [api, mount, scene]);

  useFrame(() => {
    if (!bodyApi || !aliveRef.current) return;

    if (ref.current) {
      syncObject(ref.current, bodyApi.body);
    }

    if (bodyApi.debugMesh) {
      syncObject(bodyApi.debugMesh, bodyApi.body);
    }
  });

  return [ref, bodyApi] as [RefObject<Mesh | null>, BodyApi<S> | undefined];
};
