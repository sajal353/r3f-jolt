import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Box3, Quaternion, Vector3, type AnimationMixer } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { buildRagdoll } from "./internal/ragdollBuild";
import { createRagdollDrive, type RagdollMode } from "./internal/ragdollDrive";
import type { SkeletonRig } from "./internal/skeleton";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { CharacterModel } from "./useCharacterModel";
import type { JoltApi, Vec3Input } from "./types";

export type { RagdollMode };

export interface UseRagdollOptions {
  /** Default `"passive"`. Switch at runtime with `setMode`, on the same bodies. */
  mode?: RagdollMode;
  /**
   * The animation to follow, updated by the hook itself just before it reads
   * the pose. Do not also update it elsewhere — drei's `useAnimations` already
   * does — so give the hook a mixer of its own.
   */
  mixer?: AnimationMixer;
  /** Bones kept kinematic and on the animation in every mode but `passive`. */
  kinematicBones?: string[];
  /**
   * Hertz: how hard `softKeying` pulls toward the animation. Gravity is
   * cancelled for it, so this is purely how readily a shove moves it. Default 3.
   */
  keyingFrequency?: number;
  /** `softKeying`'s damping ratio; 1, the default, returns without overshoot. */
  keyingDamping?: number;
  /**
   * How many times over each motor can hold what hangs off its joint. A joint
   * sags at most about 1/strength radians under gravity. Default 8.
   */
  motorStrength?: number;
  /** A cap on any one motor, newton-metres. Default none. */
  motorTorque?: number;
  layer?: number;
  group?: number;
  mask?: number;
  userData?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityFactor?: number;
}

export interface RagdollApi {
  ragdoll: Jolt.Ragdoll;
  rig: SkeletonRig;
  /** In joint order, alongside `bones`. */
  bodies: readonly Jolt.BodyID[];
  bones: readonly string[];
  /** One per bone but the root, joining it to its parent. */
  constraints: readonly Jolt.SwingTwistConstraint[];
  readonly mode: RagdollMode;
  setMode: (mode: RagdollMode) => void;
  setKinematicBones: (bones: readonly string[]) => void;
  bodyOf: (bone: string) => Jolt.BodyID | undefined;
  /** Takes a `BodyID` or its `GetIndexAndSequenceNumber()`, as a hit reports it. */
  boneOf: (body: Jolt.BodyID | number) => string | undefined;
  /** On one bone, at `point` if given; on every body without a bone. */
  applyImpulse: (impulse: Vec3Input, bone?: string, point?: Vec3Input) => void;
  setLinearVelocity: (velocity: Vec3Input) => void;
  setLinearAndAngularVelocity: (linear: Vec3Input, angular: Vec3Input) => void;
  getRootTransform: (
    position?: Vector3,
    quaternion?: Quaternion,
  ) => { position: Vector3; quaternion: Quaternion };
  bounds: (target?: Box3) => Box3;
  /** Snaps every body onto the bones as they stand — a teleport. */
  setPose: () => void;
  /**
   * Crossfades from where the ragdoll lies to the animation over `seconds`,
   * then hands over to `then` (default `"hardKeying"`): a get-up. Move the
   * character to `getRootTransform()` first, or it stands up where it started.
   */
  blendToAnimation: (seconds: number, then?: RagdollMode) => void;
  activate: () => void;
  isActive: () => boolean;
  resetWarmStart: () => void;
}

let nextGroupID = 1;

const resolveLayer = (api: JoltApi, options: UseRagdollOptions) => {
  if (options.layer !== undefined) return options.layer;
  if (options.group === undefined && options.mask === undefined) {
    return api.layers.LAYER_MOVING;
  }
  return api.objectLayer(
    options.group ?? api.groups.GROUP_MOVING,
    options.mask ?? api.groups.GROUP_MOVING | api.groups.GROUP_NON_MOVING,
  );
};

/**
 * A ragdoll for a character fitted with `useCharacterModel`: a body per fitted
 * bone and swing-twist joints between them, built in the bind pose and snapped
 * onto the character as it stands. In every mode but `hardKeying` the hook
 * poses the character's bones from the bodies each frame, interpolated like
 * any other body. `<PhysicsDebug />` draws the bodies and joints.
 *
 * Options are read at mount; rebuild with `key`.
 */
export const useRagdoll = (
  model: CharacterModel,
  options: UseRagdollOptions = {},
) => {
  const api = useJolt();
  const [mount] = useState(() => ({ model, options }));
  const mixerRef = useHandlerRef(options.mixer);
  const [ragdollApi, setRagdollApi] = useState<RagdollApi>();
  const renderRef = useRef<((delta: number) => void) | null>(null);

  useEffect(() => {
    const { Jolt: jolt, physicsSystem, bodyInterface, temps, state } = api;
    const { model, options } = mount;
    const count = model.config.bones.length;

    if (physicsSystem.GetNumBodies() + count > physicsSystem.GetMaxBodies()) {
      throw new Error(
        `r3f-jolt: useRagdoll needs ${count} bodies and the world is full at ` +
          `${physicsSystem.GetMaxBodies()}. Raise \`maxBodies\` on <Physics>.`,
      );
    }

    // Unique per ragdoll: two ragdolls in different groups collide, while the
    // parts of one consult its own filter table.
    const groupID = nextGroupID;
    nextGroupID += 1;

    const { ragdoll, rig } = buildRagdoll(
      jolt,
      physicsSystem,
      model.mesh,
      model.config,
      groupID,
      options.userData ?? 0,
      {
        layer: resolveLayer(api, options),
        friction: options.friction,
        restitution: options.restitution,
        linearDamping: options.linearDamping,
        angularDamping: options.angularDamping,
        gravityFactor: options.gravityFactor,
        motorStrength: options.motorStrength ?? 10,
        motorTorque: options.motorTorque,
      },
    );

    const names = rig.names;
    // Not `GetBodyID(i)`: it returns by value, and the binding hands back one
    // shared wrapper for every call. The vector's elements are the ragdoll's own.
    const idVector = ragdoll.GetBodyIDs();
    const bodyIDs = names.map((_, index) => idVector.at(index));
    const lock = physicsSystem.GetBodyLockInterfaceNoLock();
    const bodies = bodyIDs.map((id) => lock.TryGetBody(id));
    const byBone = new Map(names.map((name, index) => [name, index]));
    const byBody = new Map(
      bodyIDs.map((id, index) => [id.GetIndexAndSequenceNumber(), index]),
    );

    const joints = Array.from(
      { length: ragdoll.GetConstraintCount() },
      (_, index) => ragdoll.GetConstraint(index),
    );
    const constraints = joints.map((joint) =>
      jolt.castObject(joint, jolt.SwingTwistConstraint),
    );
    const unregister = joints.map((joint) =>
      api.constraints.add({
        constraint: joint,
        body1: joint.GetBody1(),
        body2: joint.GetBody2(),
      }),
    );

    mixerRef.current?.update(0);

    const drive = createRagdollDrive(
      {
        jolt,
        physicsSystem,
        gravityFactor: options.gravityFactor ?? 1,
        bodyInterface,
        temps,
        timing: api.timing,
        ragdoll,
        rig,
        bodyIDs,
        bodies,
        constraints,
      },
      {
        mode: options.mode ?? "passive",
        kinematicBones: options.kinematicBones ?? [],
        keyingFrequency: options.keyingFrequency ?? 3,
        keyingDamping: options.keyingDamping ?? 1,
      },
    );

    let alive = true;
    const usable = () => alive && !state.disposed;

    const driveStep = (delta: number) => {
      if (usable()) drive.step(delta);
    };
    const stopStepping = api.steps.add("before", driveStep);

    renderRef.current = (delta: number) => {
      if (!usable()) return;
      drive.restoreAnimation();
      mixerRef.current?.update(delta);
      drive.render(delta);
    };

    const applyImpulse = (
      impulse: Vec3Input,
      bone?: string,
      point?: Vec3Input,
    ) => {
      if (!usable()) return;
      const index = bone === undefined ? undefined : byBone.get(bone);

      if (index === undefined) {
        ragdoll.AddImpulse(temps.vec3(impulse));
      } else if (point) {
        bodyInterface.AddImpulse(
          bodyIDs[index],
          temps.vec3(impulse),
          temps.rvec3(point),
        );
      } else {
        bodyInterface.AddImpulse(bodyIDs[index], temps.vec3(impulse));
      }
    };

    const getRootTransform = (
      position = new Vector3(),
      quaternion = new Quaternion(),
    ) => {
      if (usable()) {
        const at = temps.rvec3([0, 0, 0]);
        const facing = temps.quat([0, 0, 0, 1]);
        ragdoll.GetRootTransform(at, facing);
        position.set(at.GetX(), at.GetY(), at.GetZ());
        quaternion.set(facing.GetX(), facing.GetY(), facing.GetZ(), facing.GetW());
      }
      return { position, quaternion };
    };

    const bounds = (box = new Box3()) => {
      if (!usable()) return box.makeEmpty();
      const aabb = ragdoll.GetWorldSpaceBounds();
      box.min.set(aabb.mMin.GetX(), aabb.mMin.GetY(), aabb.mMin.GetZ());
      box.max.set(aabb.mMax.GetX(), aabb.mMax.GetY(), aabb.mMax.GetZ());
      return box;
    };

    // The same external-resource publication as `useCar`, exempt for the same
    // reason: the ragdoll only exists once this effect has built it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRagdollApi({
      ragdoll,
      rig,
      bodies: bodyIDs,
      bones: names,
      constraints,
      get mode() {
        return drive.mode;
      },
      setMode: (mode) => {
        if (usable()) drive.setMode(mode);
      },
      setKinematicBones: (bones) => {
        if (usable()) drive.setKinematicBones(bones);
      },
      bodyOf: (bone) => {
        const index = byBone.get(bone);
        return index === undefined ? undefined : bodyIDs[index];
      },
      boneOf: (body) => {
        const key =
          typeof body === "number" ? body : body.GetIndexAndSequenceNumber();
        const index = byBody.get(key);
        return index === undefined ? undefined : names[index];
      },
      applyImpulse,
      setLinearVelocity: (velocity) => {
        if (usable()) ragdoll.SetLinearVelocity(temps.vec3(velocity));
      },
      setLinearAndAngularVelocity: (linear, angular) => {
        if (!usable()) return;
        ragdoll.SetLinearAndAngularVelocity(
          temps.vec3(linear),
          temps.vec3(angular),
        );
      },
      getRootTransform,
      bounds,
      setPose: () => {
        if (usable()) drive.snapToBones();
      },
      blendToAnimation: (seconds, then = "hardKeying") => {
        if (usable()) drive.blendToAnimation(seconds, then);
      },
      activate: () => {
        if (usable()) ragdoll.Activate();
      },
      isActive: () => usable() && ragdoll.IsActive(),
      resetWarmStart: () => {
        if (usable()) ragdoll.ResetWarmStart();
      },
    });

    return () => {
      alive = false;
      renderRef.current = null;
      stopStepping();
      unregister.forEach((remove) => remove());
      setRagdollApi(undefined);

      if (state.destroyed) return;

      ragdoll.RemoveFromPhysicsSystem();
      jolt.destroy(ragdoll);
      drive.dispose();
      rig.dispose();
    };
  }, [api, mount, mixerRef]);

  useFrame((_, delta) => {
    renderRef.current?.(delta);
  });

  return [ragdollApi] as [RagdollApi | undefined];
};
