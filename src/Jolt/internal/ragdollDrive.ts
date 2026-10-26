import { Matrix4, Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import { createTransformTracker } from "./interpolate";
import { jointMatrixView, MATRIX_FLOATS, type SkeletonRig } from "./skeleton";
import type { JoltModule, PhysicsTiming, Temps } from "../types";

/**
 * - `passive` — limp: the simulation poses the character.
 * - `hardKeying` — every body kinematic, on the animation exactly. It pushes
 *   the world around and nothing pushes it back.
 * - `softKeying` — dynamic bodies sprung toward the animation, so a shove
 *   knocks them off it and they come back.
 * - `motors` — dynamic bodies, joint motors driving toward the animation's
 *   joint angles: an active ragdoll for hit reactions. Nothing holds the root
 *   up, so pair it with `kinematicBones` to keep the character standing.
 */
export type RagdollMode = "passive" | "hardKeying" | "softKeying" | "motors";

export interface RagdollDriveOptions {
  mode: RagdollMode;
  kinematicBones: readonly string[];
  /** Hertz for `softKeying`'s pull toward the animation. */
  keyingFrequency: number;
  /** 1 is critical: the quickest return with no overshoot. */
  keyingDamping: number;
}

interface RagdollDriveContext {
  jolt: JoltModule;
  physicsSystem: Jolt.PhysicsSystem;
  /** The bodies' gravity factor, which soft keying cancels. */
  gravityFactor: number;
  bodyInterface: Jolt.BodyInterface;
  temps: Temps;
  timing: PhysicsTiming;
  ragdoll: Jolt.Ragdoll;
  rig: SkeletonRig;
  bodyIDs: readonly Jolt.BodyID[];
  bodies: readonly Jolt.Body[];
  constraints: readonly Jolt.SwingTwistConstraint[];
}

const POSE_FLOATS = 7;
const VELOCITY_FLOATS = 6;

/** A rotation as axis × angle, the shortest way round. */
const rotationVector = (rotation: Quaternion, out: Vector3) => {
  const sign = rotation.w < 0 ? -1 : 1;
  const w = Math.min(1, rotation.w * sign);
  const sine = Math.sqrt(Math.max(0, 1 - w * w));
  if (sine < 1e-6) return out.set(0, 0, 0);
  const scale = (2 * Math.acos(w) * sign) / sine;
  return out.set(rotation.x * scale, rotation.y * scale, rotation.z * scale);
};

/**
 * Everything a ragdoll does after it is built: follows an animation pose in
 * whichever mode it is in, steps that pose into the bodies, and poses the
 * character's bones from the bodies. Allocation-free per frame and per step.
 */
export const createRagdollDrive = (
  context: RagdollDriveContext,
  options: RagdollDriveOptions,
) => {
  const { jolt, bodyInterface, temps, timing, ragdoll, rig, bodyIDs, bodies } =
    context;
  const count = bodyIDs.length;
  const byBone = new Map(rig.names.map((name, index) => [name, index]));

  // The animation pose to follow, and one to blend a get-up through. Both hold
  // the rig's skeleton by reference, so they must be destroyed before it is.
  const target = new jolt.SkeletonPose();
  target.SetSkeleton(rig.skeleton);
  const targetMatrices = jointMatrixView(jolt, target);
  const blendPose = new jolt.SkeletonPose();
  blendPose.SetSkeleton(rig.skeleton);
  const blendMatrices = jointMatrixView(jolt, blendPose);
  const origin = new jolt.RVec3(0, 0, 0);

  /** World position and rotation per body: x y z, qx qy qz qw. */
  const goal = new Float32Array(count * POSE_FLOATS);
  const previousGoal = new Float32Array(count * POSE_FLOATS);
  /** The animation's own velocity per body: linear, angular. */
  const goalVelocity = new Float32Array(count * VELOCITY_FLOATS);
  let hasPrevious = false;

  /** The ragdoll as the get-up found it, each joint relative to its parent. */
  const blendFrom = new Float32Array(count * POSE_FLOATS);
  /** The blended pose in world space, built parent first. */
  const blended = new Float32Array(count * POSE_FLOATS);
  /**
   * `read` turns true at the first frame's read of the animation after the
   * blend began. Until then the pose to blend into may be the one from before
   * the call — a switch of clip lands with the next mixer update — so the blend
   * holds where it started rather than steering toward a pose about to change.
   */
  let blend: {
    elapsed: number;
    seconds: number;
    then: RagdollMode;
    read: boolean;
  } | null =
    null;

  const trackers = rig.names.map(() => createTransformTracker());
  const kinematic = new Uint8Array(count);
  let mode = options.mode;

  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const previous = new Quaternion();
  const vector = new Vector3();
  const unit = new Vector3(1, 1, 1);
  const parentPosition = new Vector3();
  const parentRotation = new Quaternion();
  const gravityStep = new Vector3();

  const loadPose = (
    from: Float32Array,
    index: number,
    intoPosition: Vector3,
    intoRotation: Quaternion,
  ) => {
    const base = index * POSE_FLOATS;
    intoPosition.set(from[base], from[base + 1], from[base + 2]);
    intoRotation.set(from[base + 3], from[base + 4], from[base + 5], from[base + 6]);
  };

  const loadGoal = (index: number, from = goal) =>
    loadPose(from, index, position, rotation);

  const storePose = (into: Float32Array, index: number) => {
    const base = index * POSE_FLOATS;
    into[base] = position.x;
    into[base + 1] = position.y;
    into[base + 2] = position.z;
    into[base + 3] = rotation.x;
    into[base + 4] = rotation.y;
    into[base + 5] = rotation.z;
    into[base + 6] = rotation.w;
  };

  const saveLocals = (into: Float32Array) => {
    rig.bones.forEach((bone, index) => {
      const base = index * POSE_FLOATS;
      bone.position.toArray(into, base);
      bone.quaternion.toArray(into, base + 3);
    });
  };

  const loadLocals = (from: Float32Array) => {
    rig.bones.forEach((bone, index) => {
      const base = index * POSE_FLOATS;
      bone.position.fromArray(from, base);
      bone.quaternion.fromArray(from, base + 3);
    });
  };

  /** The bones' animated local transforms, from before the bodies were drawn on them. */
  const animated = new Float32Array(count * POSE_FLOATS);
  /**
   * The bodies as last drawn, in world space: the character may be moved
   * between frames — stood where a get-up will start — and bones kept
   * relative to it would carry the drawn ragdoll along.
   */
  const drawn = new Float32Array(count * POSE_FLOATS);
  let overwritten = false;

  /**
   * Puts the animation back on the bones the bodies were drawn on. three.js's
   * mixer only writes a value that changed since its last write, so a held
   * pose — or any channel that is constant through a clip — is never written
   * again, and reading the bones would return the ragdoll's own pose as the
   * pose to follow: the target falls with the body.
   */
  const restoreAnimation = () => {
    if (!overwritten) return;
    overwritten = false;
    loadLocals(animated);
  };

  const rememberAnimation = () => saveLocals(animated);

  /** World poses, one per joint, onto the bones. */
  const drawWorld = (poses: Float32Array) => {
    const into = rig.matrices();
    for (let index = 0; index < count; index += 1) {
      loadPose(poses, index, position, rotation);
      matrix.compose(position, rotation, unit).toArray(into, index * MATRIX_FLOATS);
    }

    rig.pose.SetRootOffset(origin);
    rig.writeBones();
    overwritten = true;
  };

  /**
   * Reads the bones into the target pose. `delta` is the time since the last
   * read; without one the animation is taken to be standing still, as it is
   * after a mode change or a teleport.
   */
  const readTarget = (delta = 0) => {
    // Read between frames — a mode change, a get-up — the bones still show
    // the bodies, and must go on showing them once the animation has been
    // read, or that frame draws the animation pose for a split second.
    const showingBodies = overwritten;
    restoreAnimation();
    rig.readBones();
    rememberAnimation();
    if (showingBodies) drawWorld(drawn);
    targetMatrices().set(rig.matrices());
    const root = rig.pose.GetRootOffset();
    target.SetRootOffset(root);
    target.CalculateJointStates();

    const matrices = targetMatrices();
    previousGoal.set(goal);

    for (let index = 0; index < count; index += 1) {
      matrix.fromArray(matrices, index * MATRIX_FLOATS);
      matrix.decompose(position, rotation, scale);
      position.x += root.GetX();
      position.y += root.GetY();
      position.z += root.GetZ();
      storePose(goal, index);
    }

    const moving = hasPrevious && delta > 0;
    hasPrevious = true;

    for (let index = 0; index < count; index += 1) {
      const base = index * VELOCITY_FLOATS;
      if (!moving) {
        goalVelocity.fill(0, base, base + VELOCITY_FLOATS);
        continue;
      }

      loadGoal(index, previousGoal);
      vector.copy(position);
      previous.copy(rotation);
      loadGoal(index);

      vector.subVectors(position, vector).divideScalar(delta);
      goalVelocity[base] = vector.x;
      goalVelocity[base + 1] = vector.y;
      goalVelocity[base + 2] = vector.z;

      rotationVector(rotation.multiply(previous.invert()), vector).divideScalar(
        delta,
      );
      goalVelocity[base + 3] = vector.x;
      goalVelocity[base + 4] = vector.y;
      goalVelocity[base + 5] = vector.z;
    }
  };

  const isKinematic = (index: number) =>
    blend !== null ||
    mode === "hardKeying" ||
    (mode !== "passive" && kinematic[index] === 1);

  const applyMotionTypes = () => {
    for (let index = 0; index < count; index += 1) {
      bodyInterface.SetMotionType(
        bodyIDs[index],
        isKinematic(index) ? jolt.EMotionType_Kinematic : jolt.EMotionType_Dynamic,
        jolt.EActivation_Activate,
      );
    }

    const motorState =
      mode === "motors" && blend === null
        ? jolt.EMotorState_Position
        : jolt.EMotorState_Off;

    for (const constraint of context.constraints) {
      constraint.SetSwingMotorState(motorState);
      constraint.SetTwistMotorState(motorState);
    }
  };

  const moveKinematicParts = (delta: number) => {
    for (let index = 0; index < count; index += 1) {
      if (!isKinematic(index)) continue;
      loadGoal(index);
      bodyInterface.MoveKinematic(
        bodyIDs[index],
        temps.rvec3(position),
        temps.quat(rotation),
        delta,
      );
    }
  };

  /**
   * A critically damped spring from each body to its place in the animation,
   * integrated implicitly so no frequency can make it unstable. It changes
   * velocity rather than setting it, so whatever else pushed the body this
   * step — a shove, a contact — decays back out instead of being erased.
   *
   * Gravity is cancelled rather than fought: the step will add `g·dt`, so it
   * is taken off first. Without that the spring has to be stiff enough to hold
   * the body up, and then a shove barely moves it.
   */
  const steerTowardTarget = (delta: number) => {
    const omega = 2 * Math.PI * options.keyingFrequency;
    const spring = omega * omega * delta;
    const damper = 2 * options.keyingDamping * omega * delta;
    const divisor = 1 + damper + spring * delta;
    const gravity = context.physicsSystem.GetGravity();
    const fall = context.gravityFactor * delta;
    gravityStep.set(gravity.GetX() * fall, gravity.GetY() * fall, gravity.GetZ() * fall);

    for (let index = 0; index < count; index += 1) {
      if (isKinematic(index)) continue;
      const body = bodies[index];
      const base = index * VELOCITY_FLOATS;
      loadGoal(index);

      const at = body.GetPosition();
      const velocity = body.GetLinearVelocity();
      vector.set(
        (velocity.GetX() +
          spring * (position.x - at.GetX()) +
          damper * goalVelocity[base]) /
          divisor,
        (velocity.GetY() +
          spring * (position.y - at.GetY()) +
          damper * goalVelocity[base + 1]) /
          divisor,
        (velocity.GetZ() +
          spring * (position.z - at.GetZ()) +
          damper * goalVelocity[base + 2]) /
          divisor,
      );
      const linear = temps.vec3(vector.sub(gravityStep));

      const facing = body.GetRotation();
      previous.set(facing.GetX(), facing.GetY(), facing.GetZ(), facing.GetW());
      rotationVector(rotation.multiply(previous.invert()), position);
      const spin = body.GetAngularVelocity();
      vector.set(
        (spin.GetX() + spring * position.x + damper * goalVelocity[base + 3]) /
          divisor,
        (spin.GetY() + spring * position.y + damper * goalVelocity[base + 4]) /
          divisor,
        (spin.GetZ() + spring * position.z + damper * goalVelocity[base + 5]) /
          divisor,
      );

      bodyInterface.SetLinearAndAngularVelocity(
        bodyIDs[index],
        linear,
        temps.vec3(vector),
      );
    }
  };

  /** `position` / `rotation`, a joint in world space, made relative to `parent`'s pose in `from`. */
  const relativeTo = (from: Float32Array, parent: number) => {
    if (parent < 0) return;
    loadPose(from, parent, parentPosition, parentRotation);
    parentRotation.invert();
    position.sub(parentPosition).applyQuaternion(parentRotation);
    rotation.premultiply(parentRotation);
  };

  /**
   * Blended joint by joint relative to the parent, the root in world space.
   * Blending every body in world space instead swings a hand through the
   * twist of its whole arm: the gap nears half a turn, the shortest way round
   * flips sides between frames, and the hand snaps.
   */
  const writeBlend = (amount: number) => {
    const into = blendMatrices();

    for (let index = 0; index < count; index += 1) {
      const parent = rig.parents[index];

      loadGoal(index);
      relativeTo(goal, parent);
      vector.copy(position);
      previous.copy(rotation);

      loadPose(blendFrom, index, position, rotation);
      position.lerp(vector, amount);
      rotation.slerp(previous, amount);

      if (parent >= 0) {
        loadPose(blended, parent, parentPosition, parentRotation);
        position.applyQuaternion(parentRotation).add(parentPosition);
        rotation.premultiply(parentRotation);
      }

      storePose(blended, index);
      matrix.compose(position, rotation, unit).toArray(into, index * MATRIX_FLOATS);
    }

    blendPose.SetRootOffset(origin);
  };

  const step = (delta: number) => {
    if (delta <= 0) return;

    if (blend) {
      if (blend.read) blend.elapsed += delta;
      const amount = Math.min(1, blend.elapsed / blend.seconds);
      writeBlend(amount);
      ragdoll.DriveToPoseUsingKinematics(blendPose, delta);
      if (amount >= 1) {
        const next = blend.then;
        blend = null;
        setMode(next);
      }
      return;
    }

    if (mode === "passive") return;

    if (mode === "hardKeying") {
      ragdoll.DriveToPoseUsingKinematics(target, delta);
      return;
    }

    if (mode === "motors") ragdoll.DriveToPoseUsingMotors(target);
    else steerTowardTarget(delta);

    moveKinematicParts(delta);
  };

  /** Bodies → bones, interpolated, sleeping bodies read once and held. */
  const renderBodies = () => {
    for (let index = 0; index < count; index += 1) {
      const tracker = trackers[index];
      const body = bodies[index];
      if (body.IsActive()) tracker.update(body, timing);
      else tracker.rest(body);

      position.copy(tracker.position);
      rotation.copy(tracker.rotation);
      storePose(drawn, index);
    }

    drawWorld(drawn);
  };

  /**
   * The blend as last stepped, rather than the bodies chasing it: kinematic
   * bodies trail their target by a step or two, and drawing them would jump by
   * that much when the blend ends and the animation is drawn instead.
   */
  const renderBlend = () => {
    drawn.set(blended);
    drawWorld(drawn);
  };

  /**
   * Once a frame, after `restoreAnimation` and the mixer's update. With
   * `hardKeying` the animation is what is drawn.
   */
  const render = (delta: number) => {
    if (mode !== "passive" || blend) readTarget(delta);
    else rememberAnimation();

    if (blend) {
      blend.read = true;
      renderBlend();
    }
    else if (mode !== "hardKeying") renderBodies();
  };

  const resetTrackers = () => {
    for (const tracker of trackers) tracker.reset();
  };

  const setMode = (next: RagdollMode) => {
    // Nothing was drawn from the bodies while they were keyed, so their
    // interpolation history is stale.
    if (mode === "hardKeying" && next !== "hardKeying") resetTrackers();
    // A mode asked for mid-get-up wins over the one the blend would hand to.
    blend = null;
    mode = next;
    hasPrevious = false;
    readTarget();
    applyMotionTypes();
  };

  const setKinematicBones = (bones: readonly string[]) => {
    kinematic.fill(0);
    for (const bone of bones) {
      const index = byBone.get(bone);
      if (index !== undefined) kinematic[index] = 1;
    }
    applyMotionTypes();
  };

  const blendToAnimation = (seconds: number, then: RagdollMode) => {
    for (let index = 0; index < count; index += 1) {
      const at = bodies[index].GetPosition();
      const facing = bodies[index].GetRotation();
      position.set(at.GetX(), at.GetY(), at.GetZ());
      rotation.set(facing.GetX(), facing.GetY(), facing.GetZ(), facing.GetW());
      storePose(blended, index);
    }

    // Parents come first, so each joint is made relative to its parent's
    // world pose before that pose is overwritten.
    for (let index = count - 1; index >= 0; index -= 1) {
      loadPose(blended, index, position, rotation);
      relativeTo(blended, rig.parents[index]);
      storePose(blendFrom, index);
    }

    blend = { elapsed: 0, seconds: Math.max(seconds, 1e-3), then, read: false };
    hasPrevious = false;
    readTarget();
    applyMotionTypes();
  };

  /** Every body onto the bones as they stand, history dropped. */
  const snapToBones = () => {
    hasPrevious = false;
    readTarget();
    ragdoll.SetPose(target);
    ragdoll.ResetWarmStart();
    resetTrackers();
  };

  const dispose = () => {
    jolt.destroy(target);
    jolt.destroy(blendPose);
    jolt.destroy(origin);
  };

  kinematic.fill(0);
  setKinematicBones(options.kinematicBones);
  snapToBones();

  return {
    get mode() {
      return mode;
    },
    step,
    restoreAnimation,
    render,
    setMode,
    setKinematicBones,
    blendToAnimation,
    snapToBones,
    dispose,
  };
};

export type RagdollDrive = ReturnType<typeof createRagdollDrive>;
