import { Matrix4, Quaternion, Vector3 } from "three";
import type { SkinnedMesh } from "three";
import type Jolt from "jolt-physics";
import { createChildShape } from "./colliderShape";
import { applyMassProperties } from "./massProperties";
import { createSkeletonRig, MATRIX_FLOATS, type SkeletonRig } from "./skeleton";
import type { RagdollBoneConfig, RagdollConfig } from "./ragdollFit";
import type { JoltModule } from "../types";

export interface RagdollPartOptions {
  layer: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityFactor?: number;
  /**
   * How many times over a joint's motor can hold what hangs off it at full
   * leverage. A joint then sags at most about 1/strength radians under gravity.
   */
  motorStrength: number;
  /** A cap on any one motor, newton-metres. */
  motorTorque?: number;
}

const GRAVITY = 9.81;

/**
 * Bodies closer than this in the bind pose ignore each other even when they
 * are not parent and child — a thigh and the far side of the pelvis, say.
 */
const MIN_SEPARATION = 0.05;

const toVec3 = (jolt: JoltModule, vector: Vector3) =>
  new jolt.Vec3(vector.x, vector.y, vector.z);

/**
 * The joint between a part and its parent, in world space at the bind pose.
 * `bend` turns the parent's side of the cone about the plane axis, so a cone
 * symmetric about it covers 0…2·bend one way only.
 */
const createJointSettings = (
  jolt: JoltModule,
  bone: RagdollBoneConfig,
  frame: Matrix4,
  load: JointLoad,
  options: RagdollPartOptions,
) => {
  const joint = bone.joint!;
  const rotation = new Quaternion().setFromRotationMatrix(frame);
  const anchor = new Vector3().setFromMatrixPosition(frame);
  // A saved config carries its axes to four decimals; Jolt wants them unit
  // length and square to each other.
  const twist = new Vector3()
    .fromArray(joint.twistAxis)
    .normalize()
    .applyQuaternion(rotation);
  const plane = new Vector3()
    .fromArray(joint.planeAxis)
    .applyQuaternion(rotation);
  plane.addScaledVector(twist, -plane.dot(twist)).normalize();
  const parentTwist = twist
    .clone()
    .applyQuaternion(new Quaternion().setFromAxisAngle(plane, joint.bend));

  const settings = new jolt.SwingTwistConstraintSettings();
  settings.mSpace = jolt.EConstraintSpace_WorldSpace;

  const position = new jolt.RVec3(anchor.x, anchor.y, anchor.z);
  settings.mPosition1 = position;
  settings.mPosition2 = position;
  jolt.destroy(position);

  const axes = [
    toVec3(jolt, parentTwist),
    toVec3(jolt, twist),
    toVec3(jolt, plane),
  ];
  settings.mTwistAxis1 = axes[0];
  settings.mTwistAxis2 = axes[1];
  settings.mPlaneAxis1 = axes[2];
  settings.mPlaneAxis2 = axes[2];
  axes.forEach((axis) => jolt.destroy(axis));

  settings.mNormalHalfConeAngle = joint.normalHalfConeAngle;
  settings.mPlaneHalfConeAngle = joint.planeHalfConeAngle;
  settings.mTwistMinAngle = joint.twistMinAngle;
  settings.mTwistMaxAngle = joint.twistMaxAngle;

  // Stiffness from the load, not a frequency: Jolt sizes a frequency spring by
  // the child body alone, so a spine joint holding up the chest, head and arms
  // got the stiffness of the chest and sagged until gravity balanced it.
  const stiffness = options.motorStrength * load.mass * GRAVITY * load.lever;
  const motor = new jolt.MotorSettings();
  if (options.motorTorque !== undefined) {
    motor.mMinTorqueLimit = -options.motorTorque;
    motor.mMaxTorqueLimit = options.motorTorque;
  }
  const spring = new jolt.SpringSettings();
  spring.mMode = jolt.ESpringMode_StiffnessAndDamping;
  spring.mStiffness = stiffness;
  spring.mDamping = 2 * Math.sqrt(stiffness * load.mass * load.lever ** 2);
  motor.mSpringSettings = spring;
  settings.mSwingMotorSettings = motor;
  settings.mTwistMotorSettings = motor;
  jolt.destroy(spring);
  jolt.destroy(motor);

  return settings;
};

const fillPart = (
  jolt: JoltModule,
  part: Jolt.RagdollPart,
  bone: RagdollBoneConfig,
  frame: Matrix4,
  load: JointLoad,
  options: RagdollPartOptions,
) => {
  const shape = createChildShape(jolt, bone.shape, "useRagdoll");
  part.SetShape(shape);
  // The part holds its own reference now.
  shape.Release();

  const position = new Vector3();
  const rotation = new Quaternion();
  frame.decompose(position, rotation, new Vector3());

  const at = new jolt.RVec3(position.x, position.y, position.z);
  const facing = new jolt.Quat(rotation.x, rotation.y, rotation.z, rotation.w);
  part.mPosition = at;
  part.mRotation = facing;
  jolt.destroy(at);
  jolt.destroy(facing);

  part.mMotionType = jolt.EMotionType_Dynamic;
  part.mAllowDynamicOrKinematic = true;
  part.mObjectLayer = options.layer;

  if (options.friction !== undefined) part.mFriction = options.friction;
  if (options.restitution !== undefined) part.mRestitution = options.restitution;
  if (options.linearDamping !== undefined) part.mLinearDamping = options.linearDamping;
  if (options.angularDamping !== undefined) {
    part.mAngularDamping = options.angularDamping;
  }
  if (options.gravityFactor !== undefined) part.mGravityFactor = options.gravityFactor;

  applyMassProperties(jolt, part, { mass: bone.mass }, undefined);

  if (bone.joint) {
    part.mToParent = createJointSettings(jolt, bone, frame, load, options);
  }
};

/** What hangs off a joint: everything below it, and how far out its centre is. */
interface JointLoad {
  mass: number;
  lever: number;
}

const jointLoads = (
  bones: readonly RagdollBoneConfig[],
  frames: readonly Matrix4[],
  parents: Int32Array,
): JointLoad[] => {
  const centres = bones.map((bone, index) =>
    new Vector3().fromArray(bone.shape.position).applyMatrix4(frames[index]),
  );
  const mass = bones.map((bone) => bone.mass);
  const weighted = centres.map((centre, index) =>
    centre.clone().multiplyScalar(mass[index]),
  );

  // Children come after parents, so walking backwards sums each subtree.
  for (let index = bones.length - 1; index > 0; index -= 1) {
    const parent = parents[index];
    if (parent < 0) continue;
    mass[parent] += mass[index];
    weighted[parent].add(weighted[index]);
  }

  return bones.map((_, index) => {
    const joint = new Vector3().setFromMatrixPosition(frames[index]);
    const centre = weighted[index].clone().divideScalar(mass[index]);
    return { mass: mass[index], lever: Math.max(0.05, centre.distanceTo(joint)) };
  });
};

export interface BuiltRagdoll {
  ragdoll: Jolt.Ragdoll;
  rig: SkeletonRig;
}

/**
 * Builds the ragdoll in the bind pose, at wherever the mesh stands, and adds it
 * to the world. Ownership runs ragdoll → settings → skeleton, all by reference
 * count, so destroying the ragdoll frees the settings and `rig.dispose()` then
 * frees the skeleton.
 */
export const buildRagdoll = (
  jolt: JoltModule,
  physicsSystem: Jolt.PhysicsSystem,
  mesh: SkinnedMesh,
  config: RagdollConfig,
  groupID: number,
  userData: number,
  options: RagdollPartOptions,
): BuiltRagdoll => {
  const byName = new Map(config.bones.map((bone) => [bone.name, bone]));
  const rig = createSkeletonRig(jolt, mesh, (bone) => byName.has(bone.name));
  rig.readBindPose();

  const root = rig.pose.GetRootOffset();
  const offset = new Vector3(root.GetX(), root.GetY(), root.GetZ());
  const matrices = rig.matrices();

  const settings = new jolt.RagdollSettings();
  settings.mSkeleton = rig.skeleton;
  const parts = settings.mParts;
  parts.resize(rig.bones.length);

  const bones = rig.names.map((name) => byName.get(name)!);
  const frames = bones.map((_, index) => {
    const frame = new Matrix4().fromArray(matrices, index * MATRIX_FLOATS);
    return frame.setPosition(new Vector3().setFromMatrixPosition(frame).add(offset));
  });
  const loads = jointLoads(bones, frames, rig.parents);

  bones.forEach((bone, index) =>
    fillPart(jolt, parts.at(index), bone, frames[index], loads[index], options),
  );

  settings.Stabilize();
  settings.DisableParentChildCollisions(
    rig.pose.GetJointMatrices().data(),
    MIN_SEPARATION,
  );
  settings.CalculateBodyIndexToConstraintIndex();
  settings.CalculateConstraintIndexToBodyIdxPair();
  settings.CalculateConstraintPriorities();

  const ragdoll = settings.CreateRagdoll(groupID, userData, physicsSystem);

  if (jolt.getPointer(ragdoll) === 0) {
    jolt.destroy(settings);
    rig.dispose();
    throw new Error(
      `r3f-jolt: useRagdoll could not create ${rig.bones.length} bodies — the ` +
        `world is full at ${physicsSystem.GetMaxBodies()}. Raise \`maxBodies\` ` +
        "on <Physics>.",
    );
  }

  ragdoll.AddToPhysicsSystem(jolt.EActivation_Activate);

  return { ragdoll, rig };
};
