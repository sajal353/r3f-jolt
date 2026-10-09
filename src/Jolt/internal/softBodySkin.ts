import { Matrix4, Vector3, type Bone, type BufferGeometry, type SkinnedMesh } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";
import type { SoftBodyTopology } from "./softBodyBuild";

type VertexValue = number | ((position: Vector3, index: number) => number);

export interface SoftBodySkinOptions {
  /**
   * Supplies the skeleton and the space the geometry is in: the cloth's
   * vertices are in this mesh's own space, as a garment exported with it is.
   */
  mesh: SkinnedMesh;
  /**
   * Every vertex follows this bone. For a geometry without `skinIndex` /
   * `skinWeight` attributes, which otherwise say which bones each vertex
   * follows.
   */
  bone?: string;
  /**
   * Metres a vertex may stray from where the skin puts it. 0 holds it to the
   * skin exactly. Default unlimited.
   */
  maxDistance?: VertexValue;
  /**
   * Metres behind the skinned surface where a sphere of `backStopRadius`
   * starts that the vertex is kept out of: the body under the cloth. Only
   * applies below `maxDistance`.
   */
  backStopDistance?: VertexValue;
  backStopRadius?: VertexValue;
}

export const MAX_SKIN_WEIGHTS = 4;
const MATRIX_FLOATS = 16;
/** Into `SoftBodySharedSettingsInvBind`, after the joint index and padding. */
const INV_BIND_BYTE = 16;

/**
 * What a skinned cloth is bound to, decided once at mount. Rest positions are
 * moved out of the mesh's space into the body's: the bind-pose shape at world
 * scale, around `origin`, which is where the body is created.
 */
export interface SkinBinding {
  mesh: SkinnedMesh;
  joints: readonly Bone[];
  origin: Vector3;
  /** Four joints and four weights per simulated vertex, weights summing to 1. */
  jointOf: Uint16Array;
  weightOf: Float32Array;
  /** One per joint, column-major: from the body's rest space into the bone's. */
  inverseBinds: Float32Array;
  maxDistance: Float32Array | null;
  backStopDistance: Float32Array | null;
  backStopRadius: Float32Array | null;
}

/** The first geometry vertex behind each simulated one. */
const firstGeometryVertex = (topology: SoftBodyTopology) => {
  const first = new Int32Array(topology.count).fill(-1);
  topology.vertexOf.forEach((physics, index) => {
    if (first[physics] === -1) first[physics] = index;
  });
  return first;
};

const perVertex = (
  value: VertexValue | undefined,
  geometry: BufferGeometry,
  first: Int32Array,
) => {
  if (value === undefined) return null;
  const result = new Float32Array(first.length);
  if (typeof value === "number") return result.fill(value);

  const position = geometry.getAttribute("position");
  const point = new Vector3();
  first.forEach((index, physics) => {
    point.fromBufferAttribute(position, index);
    result[physics] = value(point, index);
  });
  return result;
};

const boneIndexOf = (mesh: SkinnedMesh, name: string) => {
  const index = mesh.skeleton.bones.findIndex((bone) => bone.name === name);
  if (index === -1) {
    throw new Error(`[r3f-jolt] useSoftBody: the skin has no bone "${name}".`);
  }
  return index;
};

/** Skeleton bone index and weight per slot, per simulated vertex. */
const readWeights = (
  geometry: BufferGeometry,
  options: SoftBodySkinOptions,
  first: Int32Array,
) => {
  const count = first.length;
  const bones = new Int32Array(count * MAX_SKIN_WEIGHTS).fill(-1);
  const weights = new Float32Array(count * MAX_SKIN_WEIGHTS);

  if (options.bone !== undefined) {
    const bone = boneIndexOf(options.mesh, options.bone);
    for (let physics = 0; physics < count; physics += 1) {
      bones[physics * MAX_SKIN_WEIGHTS] = bone;
      weights[physics * MAX_SKIN_WEIGHTS] = 1;
    }
    return { bones, weights };
  }

  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) {
    throw new Error(
      "[r3f-jolt] useSoftBody: a skinned cloth needs `skin.bone` or " +
        "skinIndex/skinWeight attributes on its geometry.",
    );
  }

  first.forEach((index, physics) => {
    let total = 0;
    for (let slot = 0; slot < MAX_SKIN_WEIGHTS; slot += 1) {
      total += skinWeight.getComponent(index, slot);
    }
    if (!(total > 0)) {
      throw new Error(
        `[r3f-jolt] useSoftBody: geometry vertex ${index} has no skin weight.`,
      );
    }

    // Jolt reads weights until the first zero, so the nonzero ones go first.
    let slotOut = 0;
    for (let slot = 0; slot < MAX_SKIN_WEIGHTS; slot += 1) {
      const weight = skinWeight.getComponent(index, slot);
      if (weight <= 0) continue;
      bones[physics * MAX_SKIN_WEIGHTS + slotOut] = skinIndex.getComponent(index, slot);
      weights[physics * MAX_SKIN_WEIGHTS + slotOut] = weight / total;
      slotOut += 1;
    }
  });

  return { bones, weights };
};

/**
 * Binds the cloth to the mesh as it stands now, and moves `topology`'s rest
 * positions into body space. Three.js draws a skinned vertex at
 * `A · Σ w · boneWorld · boneInverse · bindMatrix · v`, A being the identity
 * in the default attached mode; feeding Jolt the same bone matrices puts the
 * cloth exactly where three.js would draw it, scale included.
 */
export const bindSkin = (
  geometry: BufferGeometry,
  topology: SoftBodyTopology,
  options: SoftBodySkinOptions,
): SkinBinding => {
  const { mesh } = options;
  const first = firstGeometryVertex(topology);
  const { bones, weights } = readWeights(geometry, options, first);

  const used: number[] = [];
  for (const bone of bones) if (bone >= 0 && !used.includes(bone)) used.push(bone);
  const jointOf = new Uint16Array(bones.length);
  bones.forEach((bone, slot) => {
    jointOf[slot] = bone >= 0 ? used.indexOf(bone) : 0;
  });

  mesh.updateWorldMatrix(true, false);
  const meshWorld = mesh.matrixWorld;
  const origin = new Vector3().setFromMatrixPosition(meshWorld);

  const point = new Vector3();
  const { positions } = topology;
  for (let index = 0; index < positions.length; index += 3) {
    point.fromArray(positions, index).applyMatrix4(meshWorld).sub(origin);
    point.toArray(positions, index);
  }

  // boneInverse · bindMatrix · meshWorld⁻¹ · T(origin): body rest space → bone.
  const toMesh = new Matrix4()
    .copy(meshWorld)
    .invert()
    .multiply(new Matrix4().makeTranslation(origin.x, origin.y, origin.z));
  const inverseBinds = new Float32Array(used.length * MATRIX_FLOATS);
  const inverseBind = new Matrix4();
  used.forEach((bone, joint) => {
    inverseBind
      .copy(mesh.skeleton.boneInverses[bone])
      .multiply(mesh.bindMatrix)
      .multiply(toMesh)
      .toArray(inverseBinds, joint * MATRIX_FLOATS);
  });

  return {
    mesh,
    joints: used.map((bone) => mesh.skeleton.bones[bone]),
    origin,
    jointOf,
    weightOf: weights,
    inverseBinds,
    maxDistance: perVertex(options.maxDistance, geometry, first),
    backStopDistance: perVertex(options.backStopDistance, geometry, first),
    backStopRadius: perVertex(options.backStopRadius, geometry, first),
  };
};

/** Vertices that never leave the skin: Jolt holds those best with no mass. */
export const hardSkinned = (binding: SkinBinding, index: number) =>
  binding.maxDistance !== null && binding.maxDistance[index] === 0;

/** Fills the skin constraints. `pinned` vertices are held to the skin. */
export const writeSkin = (
  jolt: JoltModule,
  shared: Jolt.SoftBodySharedSettings,
  binding: SkinBinding,
  pinned: Uint8Array,
) => {
  const joints = binding.joints.length;
  const inverseBinds = shared.mInvBindMatrices;
  inverseBinds.resize(joints);
  for (let joint = 0; joint < joints; joint += 1) {
    const entry = inverseBinds.at(joint);
    entry.mJointIndex = joint;
    const at = (jolt.getPointer(entry) + INV_BIND_BYTE) >> 2;
    jolt.HEAPF32.set(
      binding.inverseBinds.subarray(joint * MATRIX_FLOATS, (joint + 1) * MATRIX_FLOATS),
      at,
    );
  }

  const count = pinned.length;
  const constraints = shared.mSkinnedConstraints;
  constraints.resize(count);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const entry = constraints.at(vertex);
    entry.mVertex = vertex;
    for (let slot = 0; slot < MAX_SKIN_WEIGHTS; slot += 1) {
      const weight = entry.get_mWeights(slot);
      weight.mInvBindIndex = binding.jointOf[vertex * MAX_SKIN_WEIGHTS + slot];
      weight.mWeight = binding.weightOf[vertex * MAX_SKIN_WEIGHTS + slot];
    }
    if (pinned[vertex]) entry.mMaxDistance = 0;
    else if (binding.maxDistance) entry.mMaxDistance = binding.maxDistance[vertex];
    if (binding.backStopDistance) {
      entry.mBackStopDistance = binding.backStopDistance[vertex];
    }
    if (binding.backStopRadius) entry.mBackStopRadius = binding.backStopRadius[vertex];
  }

  shared.CalculateSkinnedConstraintNormals();
};

/**
 * Drives a skinned cloth: the bones go to Jolt before every step, and every
 * frame the drawn cloth is moved onto the bones as they are *now*.
 *
 * The step runs before the character is animated and placed, and the cloth is
 * drawn blended between steps, so the skin Jolt last saw trails the drawn
 * character by a frame or more — at a sprint, a hand's width. The drawn
 * vertices are offset by the live skin minus the skin the physics used: a
 * held vertex lands exactly on the character, and a free one keeps its
 * simulated offset from it. Linear in the matrices, so it is exact.
 */
export const createSkinDriver = (
  jolt: JoltModule,
  binding: SkinBinding,
  restPositions: Float32Array,
) => {
  const { mesh, joints } = binding;
  const jointCount = joints.length;
  const floats = jointCount * MATRIX_FLOATS;
  const matrices = new jolt.ArrayMat44();
  matrices.resize(jointCount);
  const matrixData = matrices.data();
  const heapAt = jolt.getPointer(matrixData) >> 2;

  /** World joint matrices as of the last step, and the one before. */
  let stepCurrent = new Float32Array(floats);
  let stepPrevious = new Float32Array(floats);
  /** As of the frames the vertex tracker last read, mirroring its history. */
  const frameCurrent = new Float32Array(floats);
  const framePrevious = new Float32Array(floats);
  const live = new Float32Array(floats);
  const offsets = new Float32Array(jointCount * 12);
  const scratch = new Matrix4();
  const outer = new Matrix4();
  const blended = new Matrix4();
  const inverseBind = new Matrix4();

  let hard = true;
  let stepped = false;
  let primed = false;
  let lastStepCount = -1;

  /** A · boneWorld, three's own drawing transform, per joint. */
  const readJoints = (target: Float32Array) => {
    if (mesh.bindMode === "detached") {
      mesh.updateWorldMatrix(true, false);
      outer.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
    } else {
      outer.identity();
    }

    for (let joint = 0; joint < jointCount; joint += 1) {
      const bone = joints[joint];
      bone.updateWorldMatrix(true, false);
      scratch.multiplyMatrices(outer, bone.matrixWorld);
      scratch.toArray(target, joint * MATRIX_FLOATS);
    }
  };

  /**
   * The "before" step callback. Returns whether the joints moved since the
   * last step, so the caller can wake a sleeping cloth: Jolt does not.
   */
  const skin = (
    body: Jolt.Body,
    motion: Jolt.SoftBodyMotionProperties,
    tempAllocator: Jolt.TempAllocator,
  ) => {
    const swap = stepPrevious;
    stepPrevious = stepCurrent;
    stepCurrent = swap;
    readJoints(stepCurrent);

    let moved = !stepped;
    for (let index = 0; !moved && index < floats; index += 1) {
      if (stepCurrent[index] !== stepPrevious[index]) moved = true;
    }

    const origin = body.GetPosition();
    const heap = jolt.HEAPF32;
    heap.set(stepCurrent, heapAt);
    for (let joint = 0; joint < jointCount; joint += 1) {
      const at = heapAt + joint * MATRIX_FLOATS;
      heap[at + 12] -= origin.GetX();
      heap[at + 13] -= origin.GetY();
      heap[at + 14] -= origin.GetZ();
    }

    // Every step, moved or not: Jolt keeps the skin's previous position
    // alongside its current one, and a skipped call would leave it stale.
    const hardNow = hard;
    motion.SkinVertices(
      body.GetCenterOfMassTransform(),
      matrixData,
      jointCount,
      hardNow,
      tempAllocator,
    );

    // The vertices jumped: no blending across that.
    if (hardNow) primed = false;
    hard = false;
    stepped = true;
    return { moved, hard: hardNow };
  };

  /**
   * `local`, the tracker's blended vertices, plus the live-skin offset, into
   * `out`. `alpha` is the blend the tracker drew with. Returns whether there
   * was any offset: false while the bones stand where the physics saw them.
   */
  const correct = (
    local: Readonly<Float32Array>,
    out: Float32Array,
    alpha: number,
    stepCount: number,
  ) => {
    if (!stepped) {
      out.set(local);
      return false;
    }

    if (!primed) {
      framePrevious.set(stepCurrent);
      frameCurrent.set(stepCurrent);
      primed = true;
      lastStepCount = stepCount;
    } else if (stepCount !== lastStepCount) {
      framePrevious.set(frameCurrent);
      frameCurrent.set(stepCurrent);
      lastStepCount = stepCount;
    }

    readJoints(live);

    let any = false;
    for (let joint = 0; joint < jointCount; joint += 1) {
      const base = joint * MATRIX_FLOATS;
      for (let element = 0; element < MATRIX_FLOATS; element += 1) {
        const previous = framePrevious[base + element];
        const physics = previous + (frameCurrent[base + element] - previous) * alpha;
        blended.elements[element] = live[base + element] - physics;
        if (blended.elements[element] !== 0) any = true;
      }
      inverseBind.fromArray(binding.inverseBinds, base);
      blended.multiply(inverseBind);
      const e = blended.elements;
      const at = joint * 12;
      offsets[at] = e[0];
      offsets[at + 1] = e[1];
      offsets[at + 2] = e[2];
      offsets[at + 3] = e[4];
      offsets[at + 4] = e[5];
      offsets[at + 5] = e[6];
      offsets[at + 6] = e[8];
      offsets[at + 7] = e[9];
      offsets[at + 8] = e[10];
      offsets[at + 9] = e[12];
      offsets[at + 10] = e[13];
      offsets[at + 11] = e[14];
    }

    const { jointOf, weightOf } = binding;
    const vertices = local.length / 3;
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const x = restPositions[vertex * 3];
      const y = restPositions[vertex * 3 + 1];
      const z = restPositions[vertex * 3 + 2];
      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (any) {
        for (let slot = 0; slot < MAX_SKIN_WEIGHTS; slot += 1) {
          const weight = weightOf[vertex * MAX_SKIN_WEIGHTS + slot];
          if (weight === 0) break;
          const o = jointOf[vertex * MAX_SKIN_WEIGHTS + slot] * 12;
          dx += weight * (offsets[o] * x + offsets[o + 3] * y + offsets[o + 6] * z + offsets[o + 9]);
          dy += weight * (offsets[o + 1] * x + offsets[o + 4] * y + offsets[o + 7] * z + offsets[o + 10]);
          dz += weight * (offsets[o + 2] * x + offsets[o + 5] * y + offsets[o + 8] * z + offsets[o + 11]);
        }
      }

      out[vertex * 3] = local[vertex * 3] + dx;
      out[vertex * 3 + 1] = local[vertex * 3 + 1] + dy;
      out[vertex * 3 + 2] = local[vertex * 3 + 2] + dz;
    }

    return any;
  };

  return {
    skin,
    correct,
    /** Hard-skins every vertex on the next step and drops the history. */
    snap: () => {
      hard = true;
    },
    dispose: () => {
      jolt.destroy(matrices);
    },
  };
};

export type SkinDriver = ReturnType<typeof createSkinDriver>;
