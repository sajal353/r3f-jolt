import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { addBodies, destroyBodies, removeBodies } from "./internal/batchBodies";
import { resolveCollider, type ColliderSource } from "./internal/colliderShape";
import { resolveMotionType } from "./internal/motionType";
import { applyMassProperties } from "./internal/massProperties";
import type {
  MassPropertiesOptions,
  MassPropertiesOverride,
} from "./internal/massProperties";
import type { CollisionGroupOptions } from "./internal/useBody";
import type {
  BodyMaterial,
  MotionType,
  QuatInput,
  QuatTuple,
  Vec3Input,
  Vec3Tuple,
} from "./types";

export interface InstanceTransform {
  position: Vec3Tuple;
  rotation?: QuatTuple;
}

export interface UseInstancedBodiesOptions {
  count: number;
  /**
   * One collider, shared by every instance — Jolt shapes are immutable and
   * refcounted, which is what makes that safe, and it is the same saving on the
   * physics side that instancing is on the render side.
   */
  collider: ColliderSource;
  /** Where each instance starts. An array, or a function of the index. */
  transforms:
    | InstanceTransform[]
    | ((index: number) => InstanceTransform);
  motionType?: MotionType;
  mass?: number;
  massProperties?: MassPropertiesOptions;
  overrideMassProperties?: MassPropertiesOverride;
  material?: BodyMaterial;
  layer?: number;
  group?: number;
  mask?: number;
  collisionGroup?: CollisionGroupOptions;
  userData?: number | ((index: number) => number);
  linearDamping?: number;
  angularDamping?: number;
  gravityFactor?: number;
  allowSleeping?: boolean;
  motionQuality?: "discrete" | "linearCast";
  /** Awake on arrival. Off for a swarm meant to sit until something hits it. */
  activate?: boolean;
  /** Defaults to the world's setting, as a body hook's rendering does. */
  interpolate?: boolean;
  /** Runs per instance, immediately before the body is created. */
  bodySettingsOverride?: (
    settings: Jolt.BodyCreationSettings,
    index: number,
  ) => void;
}

/**
 * One instance, addressed by index. Built fresh per `at()` call, so nothing
 * aliases and holding one is safe. A deliberate subset of `BodyApi`: an instance
 * has no mesh of its own and no shape of its own, so the parts of that api which
 * are about either are absent rather than lying.
 */
export interface InstanceApi {
  index: number;
  id: number;
  body: Jolt.Body;
  setPositionAndRotation: (
    position: Vec3Input,
    rotation: QuatInput,
    activate?: boolean,
  ) => void;
  setLinearVelocity: (velocity: Vec3Input) => void;
  setAngularVelocity: (velocity: Vec3Input) => void;
  applyImpulse: (impulse: Vec3Input, point?: Vec3Input) => void;
  applyForce: (force: Vec3Input, point?: Vec3Input) => void;
  wake: () => void;
  sleep: () => void;
  isSleeping: () => boolean;
}

export interface InstancedBodiesApi {
  /** In the order `transforms` produced them, whatever order Jolt added them in. */
  bodies: Jolt.Body[];
  ids: number[];
  count: number;
  /** Shared by every instance, owned by the hook. */
  shape: Jolt.Shape;
  /** The collider's render geometry, already on the `InstancedMesh`. */
  geometry: BufferGeometry;
  at: (index: number) => InstanceApi | undefined;
}

const transformAt = (
  transforms: UseInstancedBodiesOptions["transforms"],
  index: number,
): InstanceTransform =>
  typeof transforms === "function" ? transforms(index) : transforms[index];

/**
 * Many bodies of one kind, drawn by one `InstancedMesh` and created in a single
 * broadphase walk. The trade against a body hook per object is deliberate: a
 * hook builds a component, a mesh and a frame subscriber per body, which is
 * right up to a few hundred and wrong past that.
 *
 * Init-once like every other hook — `count`, `collider` and the starting
 * transforms are read at mount and `key` is the rebuild hatch.
 */
export const useInstancedBodies = (options: UseInstancedBodiesOptions) => {
  const ref = useRef<InstancedMesh | null>(null);
  const api = useJolt();

  const aliveRef = useRef(false);
  const [swarm, setSwarm] = useState<InstancedBodiesApi>();
  const [mount] = useState(() => options);

  const motion = useRef({
    previousPosition: new Float32Array(0),
    currentPosition: new Float32Array(0),
    previousRotation: new Float32Array(0),
    currentRotation: new Float32Array(0),
    /** 1 while an instance still has a transform worth writing to the mesh. */
    pending: new Uint8Array(0),
    lastStepCount: -1,
    primed: false,
  });

  useEffect(() => {
    const {
      Jolt: jolt,
      bodyInterface,
      physicsSystem,
      layers,
      objectLayer,
      state,
    } = api;

    const {
      count,
      collider,
      transforms,
      motionType = "dynamic",
      mass,
      massProperties,
      overrideMassProperties,
      material,
      layer,
      group,
      mask,
      collisionGroup,
      userData,
      linearDamping,
      angularDamping,
      gravityFactor,
      allowSleeping,
      motionQuality,
      activate = true,
      bodySettingsOverride,
    } = mount;

    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `[r3f-jolt] useInstancedBodies: count must be a non-negative integer, received ${String(count)}.`,
      );
    }

    if (physicsSystem.GetNumBodies() + count > physicsSystem.GetMaxBodies()) {
      throw new Error(
        `[r3f-jolt] useInstancedBodies: ${count} more bodies would pass the world's ` +
          `cap of ${physicsSystem.GetMaxBodies()}. Raise \`maxBodies\` on <Physics>; it is ` +
          "sized at construction, so the world has to be rebuilt (`key`) for a new value to take.",
      );
    }

    const isStatic = motionType === "static";
    const { shape, geometry } = resolveCollider(jolt, collider);

    const position = new jolt.RVec3(0, 0, 0);
    const rotation = new jolt.Quat(0, 0, 0, 1);

    // One settings object for the whole swarm, rewound between bodies. Building
    // one per body would be `count` allocations to describe `count` near
    // identical bodies.
    const settings = new jolt.BodyCreationSettings(
      shape,
      position,
      rotation,
      resolveMotionType(jolt, motionType),
      layer ??
        (group !== undefined || mask !== undefined
          ? objectLayer(group ?? 0, mask ?? 0)
          : isStatic
            ? layers.LAYER_NON_MOVING
            : layers.LAYER_MOVING),
    );

    if (mass !== undefined || massProperties) {
      applyMassProperties(
        jolt,
        settings,
        massProperties ?? { mass },
        overrideMassProperties,
      );
    }

    if (material?.friction !== undefined) settings.mFriction = material.friction;
    if (material?.restitution !== undefined) {
      settings.mRestitution = material.restitution;
    }
    if (linearDamping !== undefined) settings.mLinearDamping = linearDamping;
    if (angularDamping !== undefined) settings.mAngularDamping = angularDamping;
    if (gravityFactor !== undefined) settings.mGravityFactor = gravityFactor;
    if (allowSleeping !== undefined) settings.mAllowSleeping = allowSleeping;
    if (motionQuality) {
      settings.mMotionQuality =
        motionQuality === "linearCast"
          ? jolt.EMotionQuality_LinearCast
          : jolt.EMotionQuality_Discrete;
    }

    if (collisionGroup) {
      const { filter, groupID = 0, subGroupID = 0 } = collisionGroup;
      const built = filter
        ? new jolt.CollisionGroup(filter, groupID, subGroupID)
        : new jolt.CollisionGroup();

      if (!filter) {
        built.SetGroupID(groupID);
        built.SetSubGroupID(subGroupID);
      }

      settings.mCollisionGroup = built;
      jolt.destroy(built);
    }

    const bodies: Jolt.Body[] = [];

    for (let index = 0; index < count; index += 1) {
      const transform = transformAt(transforms, index);
      const [x, y, z] = transform.position;
      const [rx, ry, rz, rw] = transform.rotation ?? [0, 0, 0, 1];

      position.Set(x, y, z);
      rotation.Set(rx, ry, rz, rw);
      settings.mPosition = position;
      settings.mRotation = rotation;
      settings.mUserData =
        typeof userData === "function" ? userData(index) : (userData ?? 0);

      bodySettingsOverride?.(settings, index);
      bodies.push(bodyInterface.CreateBody(settings));
    }

    jolt.destroy(settings);
    jolt.destroy(position);
    jolt.destroy(rotation);

    const ids = addBodies(api, bodies, activate && !isStatic);

    const mesh = ref.current;
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.count = count;
    }

    const tracking = motion.current;
    tracking.previousPosition = new Float32Array(count * 3);
    tracking.currentPosition = new Float32Array(count * 3);
    tracking.previousRotation = new Float32Array(count * 4);
    tracking.currentRotation = new Float32Array(count * 4);
    tracking.pending = new Uint8Array(count).fill(1);
    tracking.primed = false;
    tracking.lastStepCount = -1;

    const instanceApi = (index: number): InstanceApi | undefined => {
      const body = bodies[index];
      if (!body) return undefined;

      const id = ids[index];
      const usable = () => aliveRef.current && !state.disposed;
      const activation = (wake: boolean) =>
        wake ? jolt.EActivation_Activate : jolt.EActivation_DontActivate;

      return {
        index,
        id,
        body,
        setPositionAndRotation: (at, facing, wake = true) => {
          if (!usable()) return;
          bodyInterface.SetPositionAndRotation(
            body.GetID(),
            api.temps.rvec3(at),
            api.temps.quat(facing),
            activation(wake),
          );
          tracking.pending[index] = 1;
          tracking.primed = false;
        },
        setLinearVelocity: (velocity) => {
          if (!usable()) return;
          bodyInterface.SetLinearVelocity(
            body.GetID(),
            api.temps.vec3(velocity),
          );
        },
        setAngularVelocity: (velocity) => {
          if (!usable()) return;
          bodyInterface.SetAngularVelocity(
            body.GetID(),
            api.temps.vec3(velocity),
          );
        },
        applyImpulse: (impulse, point) => {
          if (!usable()) return;
          if (point === undefined) {
            bodyInterface.AddImpulse(body.GetID(), api.temps.vec3(impulse));
          } else {
            bodyInterface.AddImpulse(
              body.GetID(),
              api.temps.vec3(impulse),
              api.temps.rvec3(point),
            );
          }
        },
        applyForce: (force, point) => {
          if (!usable()) return;
          if (point === undefined) {
            bodyInterface.AddForce(
              body.GetID(),
              api.temps.vec3(force),
              activation(true),
            );
          } else {
            bodyInterface.AddForce(
              body.GetID(),
              api.temps.vec3(force),
              api.temps.rvec3(point),
              activation(true),
            );
          }
        },
        wake: () => {
          if (!usable()) return;
          bodyInterface.ActivateBody(body.GetID());
        },
        sleep: () => {
          if (!usable()) return;
          bodyInterface.DeactivateBody(body.GetID());
        },
        isSleeping: () => usable() && !body.IsActive(),
      };
    };

    aliveRef.current = true;
    setSwarm({
      bodies,
      ids,
      count,
      shape,
      geometry,
      at: instanceApi,
    });

    return () => {
      aliveRef.current = false;
      setSwarm(undefined);

      if (!state.destroyed) {
        removeBodies(api, ids);
        destroyBodies(api, ids);
        shape.Release();
      }

      geometry.dispose();
    };
  }, [api, mount]);

  const scratch = useRef({
    matrix: new Matrix4(),
    position: new Vector3(),
    rotation: new Quaternion(),
    target: new Quaternion(),
    scale: new Vector3(1, 1, 1),
  });

  useFrame(() => {
    const mesh = ref.current;
    if (!swarm || !mesh || !aliveRef.current || api.state.disposed) return;

    const { timing } = api;
    const tracking = motion.current;
    const {
      previousPosition,
      currentPosition,
      previousRotation,
      currentRotation,
      pending,
    } = tracking;

    const interpolating = mount.interpolate ?? timing.interpolate;

    // Only shift on a frame that actually stepped. Shifting every frame would
    // collapse previous onto current and defeat the interpolation.
    const stepped = timing.stepCount !== tracking.lastStepCount;
    if (interpolating && stepped) {
      if (tracking.primed) {
        previousPosition.set(currentPosition);
        previousRotation.set(currentRotation);
      }
      tracking.lastStepCount = timing.stepCount;
    }

    const { matrix, position, rotation, target, scale } = scratch.current;
    let moved = false;

    for (let index = 0; index < swarm.count; index += 1) {
      const body = swarm.bodies[index];

      // Jolt deactivates a body that has come to rest and its matrix is already
      // correct from the last frame it moved. Skipping those is the difference
      // between paying for every body every frame and paying only for the ones
      // still doing something: reading a transform out of WASM is half a dozen
      // boundary crossings, and there can be thousands of them.
      const active = body.IsActive();
      if (!active && !pending[index]) continue;
      if (active) pending[index] = 1;

      const p = index * 3;
      const r = index * 4;

      if (!interpolating) {
        const at = body.GetPosition();
        position.set(at.GetX(), at.GetY(), at.GetZ());
        const facing = body.GetRotation();
        rotation.set(
          facing.GetX(),
          facing.GetY(),
          facing.GetZ(),
          facing.GetW(),
        );

        if (!active) pending[index] = 0;
      } else {
        if (stepped || !tracking.primed) {
          const at = body.GetPosition();
          currentPosition[p] = at.GetX();
          currentPosition[p + 1] = at.GetY();
          currentPosition[p + 2] = at.GetZ();

          const facing = body.GetRotation();
          currentRotation[r] = facing.GetX();
          currentRotation[r + 1] = facing.GetY();
          currentRotation[r + 2] = facing.GetZ();
          currentRotation[r + 3] = facing.GetW();

          if (!tracking.primed) {
            previousPosition[p] = currentPosition[p];
            previousPosition[p + 1] = currentPosition[p + 1];
            previousPosition[p + 2] = currentPosition[p + 2];
            previousRotation[r] = currentRotation[r];
            previousRotation[r + 1] = currentRotation[r + 1];
            previousRotation[r + 2] = currentRotation[r + 2];
            previousRotation[r + 3] = currentRotation[r + 3];
          }
        }

        const alpha = timing.alpha;
        position.set(
          previousPosition[p] + (currentPosition[p] - previousPosition[p]) * alpha,
          previousPosition[p + 1] +
            (currentPosition[p + 1] - previousPosition[p + 1]) * alpha,
          previousPosition[p + 2] +
            (currentPosition[p + 2] - previousPosition[p + 2]) * alpha,
        );

        rotation.set(
          previousRotation[r],
          previousRotation[r + 1],
          previousRotation[r + 2],
          previousRotation[r + 3],
        );
        target.set(
          currentRotation[r],
          currentRotation[r + 1],
          currentRotation[r + 2],
          currentRotation[r + 3],
        );
        rotation.slerp(target, alpha);

        // A settled body keeps being written until the shift has caught up with
        // it, or it would freeze part-way through its last interpolation.
        if (
          !active &&
          previousPosition[p] === currentPosition[p] &&
          previousPosition[p + 1] === currentPosition[p + 1] &&
          previousPosition[p + 2] === currentPosition[p + 2]
        ) {
          pending[index] = 0;
        }
      }

      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      moved = true;
    }

    if (interpolating) tracking.primed = true;

    // Re-uploading the buffer for a swarm that has entirely settled would undo
    // the saving above.
    if (moved) mesh.instanceMatrix.needsUpdate = true;
  });

  return [ref, swarm] as [
    typeof ref,
    InstancedBodiesApi | undefined,
  ];
};
