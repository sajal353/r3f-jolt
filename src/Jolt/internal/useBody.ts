import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, type BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "../useJolt";
import { syncObject } from "./syncObject";
import { createTransformTracker } from "./interpolate";
import { motionTypeName, resolveMotionType } from "./motionType";
import { useHandlerRef } from "./useHandlerRef";
import {
  createDebugMaterial,
  disposeDebugMaterial,
  DEBUG_RENDER_ORDER,
} from "./debugMaterial";
import type { DebugShapeKind } from "./debugMaterial";
import type {
  AxisTriple,
  BodyMaterial,
  JoltModule,
  MotionType,
  QuatInput,
  QuatTuple,
  Vec3Input,
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
 *
 * The hook keeps that reference for the whole life of the body rather than
 * handing sole ownership to Jolt, because `setScale` rebuilds a `ScaledShape`
 * from the **unscaled** base every time. If the body owned the only reference,
 * the first rescale would free the thing every later rescale needs.
 */

export interface BodyOptions {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  motionType: MotionType;
  mass?: number;
  material?: BodyMaterial;
  initialVelocity?: Vec3Tuple;
  initialAngularVelocity?: Vec3Tuple;
  debug?: boolean;
  enabled?: boolean;
  userData?: number;
  shapeUserData?: number;
  motionQuality?: "discrete" | "linearCast";
  layer?: number;
  group?: number;
  mask?: number;
  /**
   * Required to later promote a `static` body to kinematic or dynamic. Without
   * it `SetMotionType` trips an assert that a release build does not catch.
   */
  allowDynamicOrKinematic?: boolean;
  sensor?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  gravityFactor?: number;
  allowSleeping?: boolean;
  /**
   * DOF locks are **world**-space, not local-space. Locking rotation X locks
   * the world X axis however the body is oriented.
   */
  allowedDOFs?: number;
  lockRotations?: boolean;
  lockTranslations?: boolean;
  enabledRotations?: AxisTriple;
  enabledTranslations?: AxisTriple;
  enhancedInternalEdgeRemoval?: boolean;
  applyGyroscopicForce?: boolean;
  collideKinematicVsNonDynamic?: boolean;
  maxLinearVelocity?: number;
  maxAngularVelocity?: number;
  numVelocityStepsOverride?: number;
  numPositionStepsOverride?: number;
  /**
   * Delivered after the step that caused them, not from inside it. Unlike the
   * rest of these options they are read fresh on every render, so the handler
   * always sees the current closure.
   */
  onWake?: () => void;
  onSleep?: () => void;
  bodySettingsOverride?: (settings: Jolt.BodyCreationSettings) => void;
}

/**
 * Undefined until the body is created, so consumers check before use. Every
 * method additionally no-ops once the body is killed or the world is disposed,
 * which those consumers cannot see.
 *
 * Jolt spells the force family `Add*`; these are named `apply*` and map
 * one-to-one onto it.
 */
export interface BodyApi<S extends Jolt.Shape> {
  body: Jolt.Body;
  /**
   * The **base** shape, owned by the hook. After a `setScale` the body is on a
   * `ScaledShape` wrapping this one, so it is no longer the body's own shape —
   * read `bodyInterface.GetShape(body.GetID())` for that.
   */
  shape: S;
  geometry: BufferGeometry;
  debugMesh: Mesh | null;
  kill: () => void;
  revive: () => void;
  setEnabled: (enabled: boolean) => void;
  /**
   * The only correct way to drive a kinematic body. Setting the transform
   * directly teleports with zero implied velocity, so a platform moved that way
   * carries nothing and a held body drops straight down when released.
   *
   * `deltaTime` defaults to the world's step duration, which is what makes the
   * body arrive exactly on target. Pass it only to deliberately over- or
   * under-shoot — in particular, do **not** pass `useFrame`'s render delta,
   * which is a different clock whenever the timestep is fixed.
   */
  moveKinematic: (
    position: Vec3Input,
    rotation: QuatInput,
    deltaTime?: number,
  ) => void;
  resetSleepTimer: () => void;
  applyForce: (force: Vec3Input, point?: Vec3Input) => void;
  applyTorque: (torque: Vec3Input) => void;
  applyForceAndTorque: (force: Vec3Input, torque: Vec3Input) => void;
  applyImpulse: (impulse: Vec3Input, point?: Vec3Input) => void;
  applyAngularImpulse: (impulse: Vec3Input) => void;
  setLinearVelocity: (velocity: Vec3Input) => void;
  setAngularVelocity: (velocity: Vec3Input) => void;
  setVelocities: (linear: Vec3Input, angular: Vec3Input) => void;
  setPositionAndRotation: (
    position: Vec3Input,
    rotation: QuatInput,
    activate?: boolean,
  ) => void;
  setMotionType: (motionType: MotionType) => void;
  setLayer: (layer: number) => void;
  setGravityFactor: (factor: number) => void;
  sleep: () => void;
  wake: () => void;
  isSleeping: () => boolean;
  /**
   * Take manual control: switches the body to kinematic and remembers what it
   * was. Drive it with `moveTo`, then `release()` to hand it back to the
   * simulation — the velocity the moves implied becomes the throw.
   */
  grab: () => void;
  /** `moveKinematic` under the name that reads right in a grab loop. */
  moveTo: (
    position: Vec3Input,
    rotation: QuatInput,
    deltaTime?: number,
  ) => void;
  release: () => void;
  isGrabbed: () => boolean;
  /**
   * Jolt shapes are immutable, so this replaces the body's shape with a
   * `ScaledShape` built from the base one. Always rebuilt from the base, never
   * from the current scale, so calls do not compound.
   *
   * Non-uniform scale is invalid on spheres and capsules and is refused with a
   * warning rather than silently corrected.
   */
  setScale: (scale: Vec3Input, updateMassProperties?: boolean) => void;
}

/**
 * A shape factory hands back a shape the caller owns **one reference to**
 * (`AddRef` already called). `useBody` holds that reference until the body is
 * destroyed and releases it in cleanup. Without it the shape would be freed the
 * moment its `ShapeSettings` is destroyed.
 */
export interface ShapeResult<S extends Jolt.Shape> {
  shape: S;
  geometry: BufferGeometry;
  /**
   * Only for the debug mesh, when the collider is not the shape `geometry`
   * draws — a box's convex radius rounds its edges, for one. Built lazily, so a
   * body with `debug` off never pays for it, and never handed to consumers:
   * `geometry` stays the render geometry.
   */
  debugGeometry?: () => BufferGeometry;
}

export const finishShape = <S extends Jolt.Shape>(shape: S): S => {
  shape.AddRef();
  return shape;
};

/**
 * `Get()` on a failed `ShapeResult` hands back a shape that was never built, and
 * dereferencing it corrupts memory in a release build instead of asserting. Read
 * the result through this and a rejected shape becomes an ordinary JS error
 * carrying Jolt's own reason.
 */
export const shapeFromResult = <S extends Jolt.Shape>(
  result: Jolt.ShapeResult,
  hook: string,
): S => {
  if (result.HasError()) {
    const reason = result.GetError().c_str();
    result.Clear();
    throw new Error(`[r3f-jolt] ${hook}: Jolt rejected the shape — ${reason}.`);
  }

  const shape = finishShape(result.Get() as S);
  result.Clear();
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

const ALL_AXES: AxisTriple = [true, true, true];
const NO_AXES: AxisTriple = [false, false, false];

const resolveAllowedDOFs = (jolt: JoltModule, options: BodyOptions) => {
  const {
    allowedDOFs,
    lockTranslations,
    lockRotations,
    enabledTranslations,
    enabledRotations,
  } = options;

  if (allowedDOFs !== undefined) return allowedDOFs;

  const translations =
    enabledTranslations ?? (lockTranslations ? NO_AXES : undefined);
  const rotations = enabledRotations ?? (lockRotations ? NO_AXES : undefined);

  if (!translations && !rotations) return undefined;

  const translation = translations ?? ALL_AXES;
  const rotation = rotations ?? ALL_AXES;

  let mask = 0;
  if (translation[0]) mask |= jolt.EAllowedDOFs_TranslationX;
  if (translation[1]) mask |= jolt.EAllowedDOFs_TranslationY;
  if (translation[2]) mask |= jolt.EAllowedDOFs_TranslationZ;
  if (rotation[0]) mask |= jolt.EAllowedDOFs_RotationX;
  if (rotation[1]) mask |= jolt.EAllowedDOFs_RotationY;
  if (rotation[2]) mask |= jolt.EAllowedDOFs_RotationZ;

  return mask;
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
  const [tracker] = useState(createTransformTracker);

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
      temps,
      timing,
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
      initialAngularVelocity,
      debug = debugDefault,
      enabled = true,
      userData,
      shapeUserData,
      motionQuality,
      layer,
      group,
      mask,
      allowDynamicOrKinematic,
      sensor,
      linearDamping,
      angularDamping,
      gravityFactor,
      allowSleeping,
      enhancedInternalEdgeRemoval,
      applyGyroscopicForce,
      collideKinematicVsNonDynamic,
      maxLinearVelocity,
      maxAngularVelocity,
      numVelocityStepsOverride,
      numPositionStepsOverride,
      bodySettingsOverride,
    } = options;

    // Three questions, three answers. Layer defaults and activation follow
    // "does it move", mass follows "is it dynamic", and everything reached
    // through MotionProperties follows "is it not static" — a static body has
    // none, so touching one is a null dereference.
    const isDynamic = motionType === "dynamic";
    const isStatic = motionType === "static";
    const isMoving = !isStatic;

    const { shape, geometry, debugGeometry } = createShape(jolt);

    if (shapeUserData !== undefined) {
      validateUserData(shapeUserData, "shapeUserData");
      shape.SetUserData(shapeUserData);
    }

    const defaultGroup = isMoving
      ? groups.GROUP_MOVING
      : groups.GROUP_NON_MOVING;
    const defaultMask = isMoving
      ? groups.GROUP_MOVING | groups.GROUP_NON_MOVING
      : groups.GROUP_MOVING;

    const resolvedLayer =
      layer ??
      (group !== undefined || mask !== undefined
        ? objectLayer(group ?? defaultGroup, mask ?? defaultMask)
        : isMoving
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
      resolveMotionType(jolt, motionType),
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

    // These assignments copy by value, so a borrowed temporary is enough.
    if (initialVelocity) {
      bodySettings.mLinearVelocity = temps.vec3(initialVelocity);
    }

    if (initialAngularVelocity) {
      bodySettings.mAngularVelocity = temps.vec3(initialAngularVelocity);
    }

    if (allowDynamicOrKinematic !== undefined) {
      bodySettings.mAllowDynamicOrKinematic = allowDynamicOrKinematic;
    }

    if (sensor !== undefined) {
      bodySettings.mIsSensor = sensor;
    }

    if (linearDamping !== undefined) {
      bodySettings.mLinearDamping = linearDamping;
    }

    if (angularDamping !== undefined) {
      bodySettings.mAngularDamping = angularDamping;
    }

    if (gravityFactor !== undefined) {
      bodySettings.mGravityFactor = gravityFactor;
    }

    if (allowSleeping !== undefined) {
      bodySettings.mAllowSleeping = allowSleeping;
    }

    if (enhancedInternalEdgeRemoval !== undefined) {
      bodySettings.mEnhancedInternalEdgeRemoval = enhancedInternalEdgeRemoval;
    }

    if (applyGyroscopicForce !== undefined) {
      bodySettings.mApplyGyroscopicForce = applyGyroscopicForce;
    }

    if (collideKinematicVsNonDynamic !== undefined) {
      bodySettings.mCollideKinematicVsNonDynamic = collideKinematicVsNonDynamic;
    }

    if (numVelocityStepsOverride !== undefined) {
      bodySettings.mNumVelocityStepsOverride = numVelocityStepsOverride;
    }

    if (numPositionStepsOverride !== undefined) {
      bodySettings.mNumPositionStepsOverride = numPositionStepsOverride;
    }

    const resolvedDOFs = resolveAllowedDOFs(jolt, options);

    if (resolvedDOFs !== undefined) {
      bodySettings.mAllowedDOFs = resolvedDOFs;
    }

    bodySettingsOverride?.(bodySettings);

    const body = bodyInterface.CreateBody(bodySettings);

    jolt.destroy(bodySettings);
    jolt.destroy(settingsPosition);
    jolt.destroy(settingsRotation);

    if (isDynamic && mass !== undefined) {
      body.GetMotionProperties().ScaleToMass(mass);
    }

    if (isMoving && maxLinearVelocity !== undefined) {
      body.GetMotionProperties().SetMaxLinearVelocity(maxLinearVelocity);
    }

    if (isMoving && maxAngularVelocity !== undefined) {
      body.GetMotionProperties().SetMaxAngularVelocity(maxAngularVelocity);
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
        isMoving ? jolt.EActivation_Activate : jolt.EActivation_DontActivate,
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
    let colliderGeometry: BufferGeometry | null = null;

    if (debug) {
      colliderGeometry = debugGeometry?.() ?? null;
      debugMesh = new Mesh(
        colliderGeometry ?? geometry,
        createDebugMaterial(debugKind),
      );
      debugMesh.renderOrder = DEBUG_RENDER_ORDER;
      scene.add(debugMesh);
    }

    // Verified safe to hold: GetID() hands back a reference to the body's own
    // member, not one of the shared static temporaries rule 1 warns about.
    const id = body.GetID();
    const activate = jolt.EActivation_Activate;

    // Every imperative method funnels through this: a killed body is out of the
    // world and a disposed one has no world left, and Jolt asserts on both.
    const usable = () => added && !state.disposed && aliveRef.current;

    const canChangeMotionType = !isStatic || allowDynamicOrKinematic === true;

    // Jolt only asserts on an illegal promotion in a debug build; a release
    // build corrupts memory quietly, so refusing is the safer failure. Shared by
    // setMotionType, grab and release.
    const applyMotionType = (target: MotionType, caller: string) => {
      if (!canChangeMotionType && target !== "static") {
        console.warn(
          `[r3f-jolt] ${caller}("${target}") ignored: this body was created static ` +
            "without `allowDynamicOrKinematic`, so it has no MotionProperties to " +
            "promote. Pass `allowDynamicOrKinematic: true` when creating it.",
        );
        return false;
      }

      bodyInterface.SetMotionType(
        id,
        resolveMotionType(jolt, target),
        activate,
      );
      return true;
    };

    let grabbedFrom: MotionType | null = null;
    let scaledShape: Jolt.Shape | null = null;

    setBodyApi({
      body,
      shape,
      geometry,
      debugMesh,
      kill,
      revive,

      setEnabled: (value: boolean) => {
        if (value) revive();
        else kill();
      },

      moveKinematic: (
        position: Vec3Input,
        rotation: QuatInput,
        deltaTime = timing.stepDelta,
      ) => {
        if (!usable()) return;
        bodyInterface.MoveKinematic(
          id,
          temps.rvec3(position),
          temps.quat(rotation),
          deltaTime,
        );
      },

      resetSleepTimer: () => {
        if (!usable()) return;
        bodyInterface.ResetSleepTimer(id);
      },

      applyForce: (force: Vec3Input, point?: Vec3Input) => {
        if (!usable()) return;
        if (point === undefined) {
          bodyInterface.AddForce(id, temps.vec3(force), activate);
        } else {
          bodyInterface.AddForce(
            id,
            temps.vec3(force),
            temps.rvec3(point),
            activate,
          );
        }
      },

      applyTorque: (torque: Vec3Input) => {
        if (!usable()) return;
        bodyInterface.AddTorque(id, temps.vec3(torque), activate);
      },

      applyForceAndTorque: (force: Vec3Input, torque: Vec3Input) => {
        if (!usable()) return;
        bodyInterface.AddForceAndTorque(
          id,
          temps.vec3(force),
          temps.vec3(torque),
          activate,
        );
      },

      applyImpulse: (impulse: Vec3Input, point?: Vec3Input) => {
        if (!usable()) return;
        if (point === undefined) {
          bodyInterface.AddImpulse(id, temps.vec3(impulse));
        } else {
          bodyInterface.AddImpulse(id, temps.vec3(impulse), temps.rvec3(point));
        }
      },

      applyAngularImpulse: (impulse: Vec3Input) => {
        if (!usable()) return;
        bodyInterface.AddAngularImpulse(id, temps.vec3(impulse));
      },

      setLinearVelocity: (velocity: Vec3Input) => {
        if (!usable()) return;
        bodyInterface.SetLinearVelocity(id, temps.vec3(velocity));
      },

      setAngularVelocity: (velocity: Vec3Input) => {
        if (!usable()) return;
        bodyInterface.SetAngularVelocity(id, temps.vec3(velocity));
      },

      setVelocities: (linear: Vec3Input, angular: Vec3Input) => {
        if (!usable()) return;
        bodyInterface.SetLinearAndAngularVelocity(
          id,
          temps.vec3(linear),
          temps.vec3(angular),
        );
      },

      setPositionAndRotation: (
        position: Vec3Input,
        rotation: QuatInput,
        shouldActivate = true,
      ) => {
        if (!usable()) return;

        // A teleport has no history worth blending from — without the reset the
        // body visibly slides in from where it used to be.
        tracker.reset();

        bodyInterface.SetPositionAndRotation(
          id,
          temps.rvec3(position),
          temps.quat(rotation),
          shouldActivate ? activate : jolt.EActivation_DontActivate,
        );
      },

      setMotionType: (target: MotionType) => {
        if (!usable()) return;
        applyMotionType(target, "setMotionType");
      },

      setLayer: (value: number) => {
        if (!usable()) return;
        bodyInterface.SetObjectLayer(id, value);
      },

      setGravityFactor: (factor: number) => {
        if (!usable()) return;
        bodyInterface.SetGravityFactor(id, factor);
      },

      sleep: () => {
        if (!usable()) return;
        bodyInterface.DeactivateBody(id);
      },

      wake: () => {
        if (!usable()) return;
        bodyInterface.ActivateBody(id);
      },

      isSleeping: () => usable() && !bodyInterface.IsActive(id),

      grab: () => {
        if (!usable() || grabbedFrom !== null) return;

        const previous = motionTypeName(jolt, bodyInterface.GetMotionType(id));
        if (!applyMotionType("kinematic", "grab")) return;

        grabbedFrom = previous;
      },

      moveTo: (
        position: Vec3Input,
        rotation: QuatInput,
        deltaTime = timing.stepDelta,
      ) => {
        if (!usable()) return;
        bodyInterface.MoveKinematic(
          id,
          temps.rvec3(position),
          temps.quat(rotation),
          deltaTime,
        );
      },

      release: () => {
        if (!usable() || grabbedFrom === null) return;

        const target = grabbedFrom;
        grabbedFrom = null;

        // The velocity MoveKinematic accumulated survives the switch, so the
        // carry becomes the throw without anything being applied by hand.
        applyMotionType(target, "release");
      },

      isGrabbed: () => grabbedFrom !== null,

      setScale: (scale: Vec3Input, updateMassProperties = true) => {
        if (!usable()) return;

        const target = temps.vec3(scale);

        if (!shape.IsValidScale(target)) {
          const valid = shape.MakeScaleValid(target);
          console.warn(
            `[r3f-jolt] setScale(${target.GetX()}, ${target.GetY()}, ${target.GetZ()}) ` +
              "is not valid for this shape — spheres and capsules scale uniformly only. " +
              `Jolt's MakeScaleValid suggests (${valid.GetX()}, ${valid.GetY()}, ` +
              `${valid.GetZ()}). Ignoring.`,
          );
          return;
        }

        // Built from `shape`, never from the current scaled shape, or repeated
        // calls would multiply together instead of replacing one another.
        const next = new jolt.ScaledShape(shape, target);
        next.AddRef();

        bodyInterface.SetShape(id, next, updateMassProperties, activate);

        scaledShape?.Release();
        scaledShape = next;

        // SetShape recomputes mass from density × the new volume, silently
        // discarding whatever the caller asked for.
        if (updateMassProperties && isDynamic && mass !== undefined) {
          body.GetMotionProperties().ScaleToMass(mass);
        }

        // The debug mesh holds the *unscaled* geometry, so scaling the Object3D
        // matches the ScaledShape exactly — no regeneration, no allocation.
        debugMesh?.scale.set(target.GetX(), target.GetY(), target.GetZ());
      },
    });

    return () => {
      aliveRef.current = false;
      setBodyApi(undefined);

      if (debugMesh) {
        scene.remove(debugMesh);
        disposeDebugMaterial(debugMesh);
      }

      colliderGeometry?.dispose();
      geometry.dispose();

      if (state.destroyed) return;

      if (added) {
        bodyInterface.RemoveBody(body.GetID());
      }
      bodyInterface.DestroyBody(body.GetID());

      scaledShape?.Release();
      shape.Release();
    };
  }, [api, mount, scene, tracker]);

  const activationHandlers = useHandlerRef({
    onWake: options.onWake,
    onSleep: options.onSleep,
  });

  const wantsActivationEvents = Boolean(options.onWake || options.onSleep);

  useEffect(() => {
    if (!bodyApi || !wantsActivationEvents) return;

    return api.activation.addBodyListener(
      bodyApi.body.GetID().GetIndexAndSequenceNumber(),
      {
        onWake: () => activationHandlers.current.onWake?.(),
        onSleep: () => activationHandlers.current.onSleep?.(),
      },
    );
  }, [api, bodyApi, wantsActivationEvents, activationHandlers]);

  useFrame(() => {
    if (!bodyApi || !aliveRef.current) return;
    if (!ref.current && !bodyApi.debugMesh) return;

    // A static body never moves, so there is nothing to interpolate and the
    // straight read is both correct and cheaper.
    if (options.motionType === "static") {
      if (ref.current) syncObject(ref.current, bodyApi.body);
      if (bodyApi.debugMesh) syncObject(bodyApi.debugMesh, bodyApi.body);
      return;
    }

    tracker.update(bodyApi.body, api.timing);

    if (ref.current) tracker.applyTo(ref.current);
    if (bodyApi.debugMesh) tracker.applyTo(bodyApi.debugMesh);
  });

  return [ref, bodyApi] as [RefObject<Mesh | null>, BodyApi<S> | undefined];
};
