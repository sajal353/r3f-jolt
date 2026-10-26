import { Bone, Matrix4, Quaternion, Vector3 } from "three";
import type { Object3D, SkinnedMesh } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

/**
 * Bones that must never become ragdoll bodies: fingers, toes, end markers,
 * twist and IK helpers, the armature root, and clavicles (Mixamo's `Shoulder`),
 * which are too short to carry a stable body of their own.
 */
export const NON_PHYSICAL_BONES: readonly RegExp[] = [
  /thumb|index|middle|ring|pinky|finger/i,
  /toe|ball/i,
  /leaf|(^|[^a-z])end$/i,
  /twist|helper|socket|attach/i,
  /(^|[^a-z])ik([^a-z]|$)/i,
  /^root$/i,
  /clavicle|shoulder/i,
];

export const isPhysicalBone = (
  bone: Bone,
  exclude: readonly RegExp[] = NON_PHYSICAL_BONES,
) => !exclude.some((pattern) => pattern.test(bone.name));

/**
 * A Jolt skeleton over some or all of a three.js rig's bones, and a pose to
 * carry transforms between the two. With a subset — a ragdoll's dozen or so
 * bones out of a hundred — this is the two-way mapper upstream's
 * `SkeletonMapper` would be: a kept bone's parent is its nearest kept ancestor,
 * and the bones left out keep their own local transform when the pose is
 * written back, so a hand still carries its fingers.
 */
export interface SkeletonRig {
  skeleton: Jolt.Skeleton;
  pose: Jolt.SkeletonPose;
  /** In joint order: every bone after its parent. */
  bones: readonly Bone[];
  names: readonly string[];
  /** Each joint's parent joint, or -1 for a root. */
  parents: Int32Array;
  indexOf: ReadonlyMap<string, number>;
  /**
   * The pose's joint matrices, 16 floats a joint, column-major as three.js
   * stores them. Rotation and translation only, relative to the root offset.
   */
  matrices: () => Float32Array;
  /**
   * Bones → pose, then the local joint states from it. Brings the bones' world
   * matrices up to date first, so it can follow an `AnimationMixer` update
   * directly.
   */
  readBones: () => void;
  /** The mesh's bind pose → pose, wherever the mesh now stands. */
  readBindPose: () => void;
  /** Pose → bones, leaving each bone's own scale alone. */
  writeBones: () => void;
  dispose: () => void;
}

export const MATRIX_FLOATS = 16;

/**
 * A pose's joint matrices as a `Float32Array` over the wasm heap, 16 floats a
 * joint in the column-major order `Matrix4.elements` uses. The pose must
 * already have its skeleton: `SetSkeleton` is what sizes the array.
 */
export const jointMatrixView = (jolt: JoltModule, pose: Jolt.SkeletonPose) => {
  const pointer = jolt.getPointer(pose.GetJointMatrices().data());
  const length = pose.GetJointCount() * MATRIX_FLOATS;
  let view = new Float32Array(jolt.HEAPF32.buffer, pointer, length);

  // The wasm heap can grow, and growing it detaches every view over the old one.
  return () => {
    if (view.buffer !== jolt.HEAPF32.buffer) {
      view = new Float32Array(jolt.HEAPF32.buffer, pointer, length);
    }
    return view;
  };
};

export const nearestKeptAncestor = (bone: Bone, kept: ReadonlySet<Bone>) => {
  for (let node = bone.parent; node; node = node.parent) {
    if (node instanceof Bone && kept.has(node)) return node;
  }
  return null;
};

/**
 * Parent before child, which `Skeleton.AreJointsCorrectlyOrdered` requires and
 * a three.js `Skeleton`'s bone order does not promise. Sorting by depth keeps
 * the rig's own order among bones at the same depth.
 */
export const sortParentsFirst = (bones: readonly Bone[]) => {
  const kept = new Set(bones);
  const depth = new Map<Bone, number>();

  const depthOf = (bone: Bone): number => {
    const known = depth.get(bone);
    if (known !== undefined) return known;

    const parent = nearestKeptAncestor(bone, kept);
    const value = parent ? depthOf(parent) + 1 : 0;
    depth.set(bone, value);
    return value;
  };

  return [...bones].sort(
    (first, second) => depthOf(first) - depthOf(second),
  );
};

/**
 * The bones between a joint and its parent joint, outermost first. They are not
 * joints, so writing a pose back has to bring their world matrices up to date
 * before the joint below them can be placed.
 */
const bonesBetween = (bone: Bone, parentJoint: Bone | null) => {
  const chain: Object3D[] = [];
  if (!parentJoint) return chain;

  for (let node = bone.parent; node && node !== parentJoint; node = node.parent) {
    chain.unshift(node);
  }

  return chain;
};

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

const buildSkeleton = (
  jolt: JoltModule,
  names: readonly string[],
  parents: Int32Array,
) => {
  const skeleton = new jolt.Skeleton();

  names.forEach((name, index) => {
    const joltName = new jolt.JPHString(name, utf8Length(name));
    skeleton.AddJoint(joltName, parents[index]);
    jolt.destroy(joltName);
  });

  skeleton.CalculateParentJointIndices();

  if (!skeleton.AreJointsCorrectlyOrdered()) {
    jolt.destroy(skeleton);
    throw new Error("[r3f-jolt] skeleton joints came out of order");
  }

  return skeleton;
};

const assertUniqueNames = (names: readonly string[]) => {
  const seen = new Set<string>();

  for (const name of names) {
    // Jolt finds a joint's parent by name, so a repeated name re-parents
    // whichever joint comes second.
    if (seen.has(name)) {
      throw new Error(
        `[r3f-jolt] bone names must be unique within a skeleton: "${name}" repeats`,
      );
    }
    seen.add(name);
  }
};

const isUniformScale = (scale: Vector3) => {
  const tolerance = 1e-3 * Math.max(Math.abs(scale.x), 1e-6);

  return (
    scale.x > 0 &&
    Math.abs(scale.y - scale.x) <= tolerance &&
    Math.abs(scale.z - scale.x) <= tolerance
  );
};

/** Builds the rig over the mesh's skeleton, or over the bones `keep` accepts. */
export const createSkeletonRig = (
  jolt: JoltModule,
  mesh: SkinnedMesh,
  keep: (bone: Bone) => boolean = () => true,
): SkeletonRig => {
  const bones = sortParentsFirst(mesh.skeleton.bones.filter(keep));
  const kept = new Set(bones);
  const names = bones.map((bone) => bone.name);
  const indexOf = new Map(names.map((name, index) => [name, index]));

  assertUniqueNames(names);

  const parentBones = bones.map((bone) => nearestKeptAncestor(bone, kept));
  const parents = Int32Array.from(parentBones, (parent) =>
    parent ? indexOf.get(parent.name)! : -1,
  );
  const between = bones.map((bone, index) =>
    bonesBetween(bone, parentBones[index]),
  );
  const bindIndex = Int32Array.from(bones, (bone) =>
    mesh.skeleton.bones.indexOf(bone),
  );

  const skeleton = buildSkeleton(jolt, names, parents);
  const pose = new jolt.SkeletonPose();
  pose.SetSkeleton(skeleton);

  const rootOffset = new jolt.RVec3(0, 0, 0);
  const matrices = jointMatrixView(jolt, pose);

  const world = new Matrix4();
  const local = new Matrix4();
  const position = new Vector3();
  const offset = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const unit = new Vector3(1, 1, 1);
  let warnedScale = false;

  const warnNonUniformScale = (bone: Bone) => {
    if (warnedScale) return;
    warnedScale = true;
    console.warn(
      `[r3f-jolt] bone "${bone.name}" has a non-uniform or mirrored world ` +
        "scale. Jolt joints carry rotation and translation only, so its " +
        "rotation is approximate and colliders fitted to it will be off.",
    );
  };

  /** One joint's world transform, scale stripped, into the pose. */
  const storeJoint = (index: number, source: Matrix4) => {
    source.decompose(position, rotation, scale);
    if (!isUniformScale(scale)) warnNonUniformScale(bones[index]);

    position.sub(offset);
    world.compose(position, rotation, unit);
    world.toArray(matrices(), index * MATRIX_FLOATS);
  };

  const setRootOffset = (source: Matrix4) => {
    offset.setFromMatrixPosition(source);
    rootOffset.Set(offset.x, offset.y, offset.z);
    pose.SetRootOffset(rootOffset);
  };

  const refreshWorld = (node: Object3D) => {
    if (node.matrixAutoUpdate) node.updateMatrix();

    if (node.parent) {
      node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
    } else {
      node.matrixWorld.copy(node.matrix);
    }
  };

  /** Brings everything above a joint up to date, assuming its parent joint is. */
  const refreshAbove = (index: number) => {
    if (parentBones[index]) between[index].forEach(refreshWorld);
    else bones[index].parent?.updateWorldMatrix(true, false);
  };

  const readBones = () => {
    for (let index = 0; index < bones.length; index += 1) {
      const bone = bones[index];
      refreshAbove(index);
      refreshWorld(bone);
      if (index === 0) setRootOffset(bone.matrixWorld);
      storeJoint(index, bone.matrixWorld);
    }

    pose.CalculateJointStates();
  };

  // A bone in the bind pose sits at the inverse of its boneInverse, in the
  // space the mesh was bound in. Carrying that by mesh · bindMatrix⁻¹ puts it
  // where the mesh stands now. Not bindMatrixInverse: in the default attached
  // mode three.js re-derives that from the mesh every frame.
  const readBindPose = () => {
    mesh.updateWorldMatrix(true, false);
    local.copy(mesh.bindMatrix).invert().premultiply(mesh.matrixWorld);

    for (let index = 0; index < bones.length; index += 1) {
      world
        .copy(mesh.skeleton.boneInverses[bindIndex[index]])
        .invert()
        .premultiply(local);
      if (index === 0) setRootOffset(world);
      storeJoint(index, world);
    }

    pose.CalculateJointStates();
  };

  const placeBone = (index: number) => {
    const bone = bones[index];
    const parent = bone.parent;

    refreshAbove(index);

    world.fromArray(matrices(), index * MATRIX_FLOATS);
    position.setFromMatrixPosition(world).add(offset);
    world.setPosition(position);

    // The local scale this decomposes to is discarded: the bone keeps its own.
    if (parent) local.copy(parent.matrixWorld).invert().multiply(world);
    else local.copy(world);

    local.decompose(bone.position, bone.quaternion, scale);
    refreshWorld(bone);
  };

  const writeBones = () => {
    const root = pose.GetRootOffset();
    offset.set(root.GetX(), root.GetY(), root.GetZ());

    for (let index = 0; index < bones.length; index += 1) placeBone(index);
  };

  // The pose holds the only reference to the skeleton, so destroying the pose
  // frees both; destroying the skeleton as well would be a double free.
  const dispose = () => {
    jolt.destroy(pose);
    jolt.destroy(rootOffset);
  };

  return {
    skeleton,
    pose,
    bones,
    names,
    parents,
    indexOf,
    matrices,
    readBones,
    readBindPose,
    writeBones,
    dispose,
  };
};
