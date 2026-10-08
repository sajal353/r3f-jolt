import { Matrix4, Quaternion, Vector3 } from "three";
import type { Bone, SkinnedMesh } from "three";
import type { CompoundChild } from "./colliderShape";
import {
  isPhysicalBone,
  nearestKeptAncestor,
  NON_PHYSICAL_BONES,
  sortParentsFirst,
} from "./skeleton";
import type { Vec3Tuple } from "../types";

export type BoneClass =
  | "pelvis"
  | "spine"
  | "neck"
  | "head"
  | "upperarm"
  | "forearm"
  | "hand"
  | "thigh"
  | "calf"
  | "foot";

/**
 * Swing-twist limits for the joint between a bone and its parent, with every
 * axis in the bone's own bind-pose frame. `normalHalfConeAngle` limits rotation
 * about `planeAxis`, `planeHalfConeAngle` rotation about the axis normal to
 * both. `bend` turns the parent's side of the cone about `planeAxis`, which is
 * how a symmetric cone becomes a knee that bends one way only.
 */
export interface RagdollJointConfig {
  twistAxis: Vec3Tuple;
  planeAxis: Vec3Tuple;
  bend: number;
  normalHalfConeAngle: number;
  planeHalfConeAngle: number;
  twistMinAngle: number;
  twistMaxAngle: number;
}

export interface RagdollBoneConfig {
  name: string;
  /** In the bone's bind-pose frame, metres. */
  shape: CompoundChild;
  mass: number;
  /** Absent on the root. */
  joint?: RagdollJointConfig;
}

/** Parent before child, the order the ragdoll's joints are built in. */
export interface RagdollConfig {
  bones: RagdollBoneConfig[];
}

export type FitShapeKind = "capsule" | "box" | "convex";

export interface RagdollBoneOverride {
  shape?: FitShapeKind | CompoundChild;
  mass?: number;
  joint?: Partial<RagdollJointConfig>;
  exclude?: boolean;
}

export interface RagdollFitOptions {
  /** Kilograms, spread over the bones by anthropometric share. Default 70. */
  mass?: number;
  /** The bones to make bodies of. Default: picked by name, see `selectRagdollBones`. */
  bones?: string[];
  /** Bones never to make bodies of. Default `NON_PHYSICAL_BONES`. */
  exclude?: readonly RegExp[];
  overrides?: Record<string, RagdollBoneOverride>;
  /** How much of a vertex's skin weight a bone needs to claim it. Default 0.5. */
  minWeight?: number;
  /** Which radial distance sets a capsule's radius. Default 0.9. */
  radiusPercentile?: number;
}

export interface RagdollFit {
  config: RagdollConfig;
  excluded: string[];
}

const CLASS_PATTERNS: readonly [BoneClass, RegExp][] = [
  ["pelvis", /pelvis|hips?$/i],
  ["neck", /neck/i],
  ["head", /head/i],
  ["spine", /spine|chest|torso|abdomen/i],
  ["forearm", /fore_?arm|lower_?arm/i],
  ["upperarm", /upper_?arm|arm$/i],
  ["hand", /hand|wrist/i],
  ["thigh", /thigh|up_?leg|upper_?leg/i],
  ["calf", /calf|shin|knee|lower_?leg|leg$/i],
  ["foot", /foot|ankle/i],
];

export const classifyBone = (name: string): BoneClass | null =>
  CLASS_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;

const LEFT = /(^|[^a-z])(l|left)([^a-z]|$)|left/i;
const RIGHT = /(^|[^a-z])(r|right)([^a-z]|$)|right/i;

const sideOf = (name: string) => {
  if (LEFT.test(name)) return 1;
  if (RIGHT.test(name)) return -1;
  return 0;
};

/**
 * Share of total body mass per class, from Winter's segment tables. The trunk's
 * half is shared by the pelvis and spine bodies by volume, and so is any class
 * with more than one body.
 */
const MASS_SHARE: Record<BoneClass, number> = {
  pelvis: 0.497,
  spine: 0.497,
  neck: 0,
  head: 0.081,
  upperarm: 0.056,
  forearm: 0.032,
  hand: 0.012,
  thigh: 0.2,
  calf: 0.093,
  foot: 0.029,
};

interface JointDefaults {
  normal: number;
  plane: number;
  twist: number;
  /** Hinge-like: bends `range` radians one way, toward +forward or −forward. */
  hinge?: { range: number; toward: 1 | -1 };
}

const JOINT_DEFAULTS: Record<BoneClass | "other", JointDefaults> = {
  pelvis: { normal: 0.4, plane: 0.3, twist: 0.3 },
  spine: { normal: 0.4, plane: 0.3, twist: 0.3 },
  neck: { normal: 0.5, plane: 0.4, twist: 0.6 },
  head: { normal: 0.6, plane: 0.4, twist: 0.7 },
  upperarm: { normal: 1.5, plane: 1.3, twist: 0.8 },
  forearm: { normal: 0, plane: 0.1, twist: 0.15, hinge: { range: 2.5, toward: 1 } },
  hand: { normal: 0.9, plane: 0.4, twist: 0.2 },
  thigh: { normal: 1.1, plane: 0.6, twist: 0.4 },
  calf: { normal: 0, plane: 0.05, twist: 0.1, hinge: { range: 2.4, toward: -1 } },
  foot: { normal: 0.7, plane: 0.25, twist: 0.15 },
  other: { normal: 0.5, plane: 0.5, twist: 0.3 },
};

/**
 * The bones a humanoid ragdoll is usually built from: everything physical by
 * name, less the neck, which folds into the bodies either side of it, and less
 * the middle of a spine chain, whose lowest and highest bones are enough.
 */
export const selectRagdollBones = (
  bones: readonly Bone[],
  exclude: readonly RegExp[] = NON_PHYSICAL_BONES,
) => {
  const candidates = bones.filter(
    (bone) => isPhysicalBone(bone, exclude) && classifyBone(bone.name) !== "neck",
  );
  const pool = new Set(candidates);

  const isSpine = (bone: Bone | null) =>
    bone !== null && classifyBone(bone.name) === "spine";

  const midSpine = new Set(
    candidates.filter(
      (bone) =>
        isSpine(bone) &&
        isSpine(nearestKeptAncestor(bone, pool)) &&
        candidates.some(
          (other) => isSpine(other) && nearestKeptAncestor(other, pool) === bone,
        ),
    ),
  );

  return candidates.filter((bone) => !midSpine.has(bone));
};

const round = (value: number) => Math.round(value * 1e4) / 1e4;

const tuple = (vector: Vector3): Vec3Tuple => [
  round(vector.x),
  round(vector.y),
  round(vector.z),
];

const percentile = (sorted: Float64Array, fraction: number) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index];
};

const sortedOf = (values: number[]) => Float64Array.from(values).sort();

/** The direction a cloud spreads furthest along, by power iteration. */
const principalAxis = (points: readonly Vector3[], skip?: Vector3) => {
  const mean = new Vector3();
  points.forEach((point) => mean.add(point));
  mean.divideScalar(Math.max(points.length, 1));

  const covariance = new Array<number>(9).fill(0);
  const offset = new Vector3();

  for (const point of points) {
    offset.subVectors(point, mean);
    if (skip) offset.addScaledVector(skip, -offset.dot(skip));
    const values = [offset.x, offset.y, offset.z];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        covariance[row * 3 + column] += values[row] * values[column];
      }
    }
  }

  const axis = new Vector3(0.577, 0.577, 0.577);
  if (skip) axis.addScaledVector(skip, -axis.dot(skip));
  const next = new Vector3();

  for (let iteration = 0; iteration < 32; iteration += 1) {
    next.set(
      covariance[0] * axis.x + covariance[1] * axis.y + covariance[2] * axis.z,
      covariance[3] * axis.x + covariance[4] * axis.y + covariance[5] * axis.z,
      covariance[6] * axis.x + covariance[7] * axis.y + covariance[8] * axis.z,
    );
    if (next.lengthSq() < 1e-20) break;
    axis.copy(next).normalize();
  }

  return axis;
};

/**
 * A torso segment is about as wide as it is tall, so a capsule round it rounds
 * up to a sphere as deep as the chest is wide. A box keeps its shape.
 */
const DEFAULT_KIND: Partial<Record<BoneClass | "other", FitShapeKind>> = {
  pelvis: "box",
  spine: "box",
};

const anyPerpendicular =(axis: Vector3) =>
  new Vector3()
    .crossVectors(axis, Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0))
    .normalize();

/** Rotation taking +Y, the axis every Jolt capsule is built along, onto `axis`. */
const alongY = (axis: Vector3) =>
  new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);

const fitCapsule = (
  points: readonly Vector3[],
  axis: Vector3,
  radiusPercentile: number,
): CompoundChild => {
  const along = sortedOf(points.map((point) => point.dot(axis)));
  const radial = new Vector3();
  const offset = new Vector3();

  points.forEach((point) =>
    offset.add(radial.copy(point).addScaledVector(axis, -point.dot(axis))),
  );
  offset.divideScalar(points.length);

  const distances = sortedOf(
    points.map((point) =>
      radial
        .copy(point)
        .addScaledVector(axis, -point.dot(axis))
        .sub(offset)
        .length(),
    ),
  );

  const start = percentile(along, 0.05);
  const end = percentile(along, 0.95);
  const radius = Math.max(0.01, percentile(distances, radiusPercentile));
  const height = Math.max(0.01, end - start - 2 * radius);
  const centre = offset.addScaledVector(axis, (start + end) / 2);

  return {
    type: "capsule",
    position: tuple(centre),
    rotation: alongY(axis).toArray().map(round) as CompoundChild["rotation"],
    height: round(height),
    radius: round(radius),
  };
};

const fitBox = (points: readonly Vector3[], axis: Vector3): CompoundChild => {
  const side = principalAxis(points, axis);
  if (side.lengthSq() < 0.5) side.copy(anyPerpendicular(axis));
  const depth = new Vector3().crossVectors(side, axis).normalize();
  const basis = [side, axis, depth];

  const size: number[] = [];
  const centre = new Vector3();

  basis.forEach((direction) => {
    const along = sortedOf(points.map((point) => point.dot(direction)));
    const low = percentile(along, 0.05);
    const high = percentile(along, 0.95);
    size.push(round(Math.max(0.02, high - low)));
    centre.addScaledVector(direction, (low + high) / 2);
  });

  const rotation = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(side, axis, depth),
  );

  return {
    type: "box",
    position: tuple(centre),
    rotation: rotation.toArray().map(round) as CompoundChild["rotation"],
    size: size as Vec3Tuple,
  };
};

const CONVEX_POINTS = 96;

const fitConvex = (points: readonly Vector3[]): CompoundChild => {
  const stride = Math.max(1, Math.ceil(points.length / CONVEX_POINTS));
  const vertices: number[][] = [];
  for (let index = 0; index < points.length; index += stride) {
    vertices.push(tuple(points[index]));
  }
  return { type: "convex", position: [0, 0, 0], vertices };
};

const volumeOf = (shape: CompoundChild) => {
  switch (shape.type) {
    case "capsule":
      return Math.PI * shape.radius ** 2 * (shape.height + (4 / 3) * shape.radius);
    case "sphere":
      return (4 / 3) * Math.PI * shape.radius ** 3;
    case "box":
      return shape.size[0] * shape.size[1] * shape.size[2];
    case "convex": {
      const low = new Vector3(Infinity, Infinity, Infinity);
      const high = new Vector3(-Infinity, -Infinity, -Infinity);
      shape.vertices.forEach((vertex) => {
        low.min(new Vector3().fromArray(vertex));
        high.max(new Vector3().fromArray(vertex));
      });
      const extent = high.sub(low);
      return 0.6 * extent.x * extent.y * extent.z;
    }
    default:
      return 0.001;
  }
};

/** A bone's bind-pose frame in world space, scale stripped. */
const bindFrames = (mesh: SkinnedMesh) => {
  mesh.updateWorldMatrix(true, false);
  const carry = mesh.bindMatrix.clone().invert().premultiply(mesh.matrixWorld);
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();

  return mesh.skeleton.boneInverses.map((inverse) => {
    const world = inverse.clone().invert().premultiply(carry);
    world.decompose(position, rotation, scale);
    return new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
  });
};

/**
 * Each kept bone's share of the skinned vertices, in its own bind-pose frame.
 * A vertex weighted to a bone that is not kept counts for the nearest kept
 * ancestor, so the fingers fill out the hand.
 */
const gatherClouds = (
  meshes: readonly SkinnedMesh[],
  owner: Int32Array,
  inverseFrames: readonly Matrix4[],
  minWeight: number,
) => {
  const clouds = inverseFrames.map(() => [] as Vector3[]);
  const claimed = new Map<number, number>();
  const vertex = new Vector3();

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute("position");
    const indices = mesh.geometry.getAttribute("skinIndex");
    const weights = mesh.geometry.getAttribute("skinWeight");
    if (!positions || !indices || !weights) continue;

    for (let index = 0; index < positions.count; index += 1) {
      claimed.clear();

      for (let slot = 0; slot < 4; slot += 1) {
        const weight = weights.getComponent(index, slot);
        if (weight <= 0) continue;
        const kept = owner[indices.getComponent(index, slot)];
        if (kept < 0) continue;
        claimed.set(kept, (claimed.get(kept) ?? 0) + weight);
      }

      vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);

      for (const [kept, weight] of claimed) {
        if (weight < minWeight) continue;
        clouds[kept].push(vertex.clone().applyMatrix4(inverseFrames[kept]));
      }
    }
  }

  return clouds;
};

/** "Up" from the root to the head, "left" from the right-hand bones to the left. */
const bodyAxes = (names: readonly string[], frames: readonly Matrix4[]) => {
  const left = new Vector3();
  const up = new Vector3(0, 1, 0);
  const at = (index: number) => new Vector3().setFromMatrixPosition(frames[index]);

  names.forEach((name, index) => {
    const side = sideOf(name);
    if (side !== 0) left.addScaledVector(at(index), side);
  });
  if (left.lengthSq() < 1e-8) left.set(1, 0, 0);
  left.normalize();

  const head = names.findIndex((name) => classifyBone(name) === "head");
  if (head > 0) up.subVectors(at(head), at(0));
  up.addScaledVector(left, -up.dot(left)).normalize();

  const forward = new Vector3().crossVectors(left, up).normalize();
  return { left, forward };
};

const jointFor = (
  boneClass: BoneClass | null,
  axis: Vector3,
  rotation: Quaternion,
  left: Vector3,
  forward: Vector3,
): RagdollJointConfig => {
  const defaults = JOINT_DEFAULTS[boneClass ?? "other"];
  const toLocal = rotation.clone().invert();
  const localLeft = left.clone().applyQuaternion(toLocal);
  const localForward = forward.clone().applyQuaternion(toLocal);

  if (defaults.hinge) {
    const bendToward = localForward.multiplyScalar(defaults.hinge.toward);
    const planeAxis = new Vector3().crossVectors(axis, bendToward);
    if (planeAxis.lengthSq() < 1e-6) planeAxis.copy(localLeft);
    planeAxis.addScaledVector(axis, -planeAxis.dot(axis)).normalize();
    const half = defaults.hinge.range / 2;

    return {
      twistAxis: tuple(axis),
      planeAxis: tuple(planeAxis),
      bend: round(half),
      normalHalfConeAngle: round(half),
      planeHalfConeAngle: defaults.plane,
      twistMinAngle: -defaults.twist,
      twistMaxAngle: defaults.twist,
    };
  }

  const planeAxis = localLeft.addScaledVector(axis, -localLeft.dot(axis));
  if (planeAxis.lengthSq() < 0.1) {
    planeAxis.copy(localForward).addScaledVector(axis, -localForward.dot(axis));
  }
  if (planeAxis.lengthSq() < 1e-6) planeAxis.copy(anyPerpendicular(axis));
  planeAxis.normalize();

  return {
    twistAxis: tuple(axis),
    planeAxis: tuple(planeAxis),
    bend: 0,
    normalHalfConeAngle: defaults.normal,
    planeHalfConeAngle: defaults.plane,
    twistMinAngle: -defaults.twist,
    twistMaxAngle: defaults.twist,
  };
};

const fitShape = (
  kind: FitShapeKind,
  points: readonly Vector3[],
  axis: Vector3,
  radiusPercentile: number,
): CompoundChild => {
  if (points.length < 4) {
    return { type: "sphere", position: [0, 0, 0], radius: 0.05 };
  }
  if (kind === "box") return fitBox(points, axis);
  if (kind === "convex") return fitConvex(points);
  return fitCapsule(points, axis, radiusPercentile);
};

/**
 * Bodies, masses and joint limits for a ragdoll of a skinned character, fitted
 * to its skin in the bind pose. Every mesh sharing the first one's skeleton
 * contributes, so a character split across materials fits as one.
 */
export const fitRagdoll = (
  meshes: readonly SkinnedMesh[],
  options: RagdollFitOptions = {},
): RagdollFit => {
  const {
    mass = 70,
    exclude = NON_PHYSICAL_BONES,
    overrides = {},
    minWeight = 0.5,
    radiusPercentile = 0.9,
  } = options;

  const mesh = meshes[0];
  const all = mesh.skeleton.bones;
  const chosen = options.bones
    ? all.filter((bone) => options.bones!.includes(bone.name))
    : selectRagdollBones(all, exclude);
  const bones = sortParentsFirst(
    chosen.filter((bone) => !overrides[bone.name]?.exclude),
  );
  const kept = new Set(bones);
  const names = bones.map((bone) => bone.name);
  const excluded = all
    .filter((bone) => !kept.has(bone))
    .map((bone) => bone.name);

  const allFrames = bindFrames(mesh);
  const frames = bones.map((bone) => allFrames[all.indexOf(bone)]);
  const inverseFrames = frames.map((frame) => frame.clone().invert());
  const keptIndex = new Map(bones.map((bone, index) => [bone, index]));

  const owner = Int32Array.from(all, (bone) => {
    if (kept.has(bone)) return keptIndex.get(bone)!;
    const ancestor = nearestKeptAncestor(bone, kept);
    return ancestor ? keptIndex.get(ancestor)! : -1;
  });

  const clouds = gatherClouds(meshes, owner, inverseFrames, minWeight);
  const parents = bones.map((bone) => {
    const parent = nearestKeptAncestor(bone, kept);
    return parent ? keptIndex.get(parent)! : -1;
  });
  const { left, forward } = bodyAxes(names, frames);
  const classes = names.map(classifyBone);

  const rotations = frames.map((frame) =>
    new Quaternion().setFromRotationMatrix(frame),
  );
  const positions = frames.map((frame) =>
    new Vector3().setFromMatrixPosition(frame),
  );

  const childrenOf = bones.map((_, index) =>
    parents.flatMap((parent, child) => (parent === index ? [child] : [])),
  );

  const towardChildren = bones.map((_, index) => {
    const sum = new Vector3();
    childrenOf[index].forEach((child) =>
      sum.add(positions[child].clone().applyMatrix4(inverseFrames[index])),
    );
    return sum;
  });

  const awayFromParent = bones.map((_, index) =>
    parents[index] >= 0
      ? positions[index]
          .clone()
          .sub(positions[parents[index]])
          .applyQuaternion(rotations[index].clone().invert())
      : towardChildren[index].clone(),
  );

  // A limb runs to its one child. A torso or an end bone has no single
  // direction to run to, so its body lies along its flesh instead.
  const shapeAxes = bones.map((_, index) => {
    if (childrenOf[index].length === 1 && towardChildren[index].lengthSq() > 1e-8) {
      return towardChildren[index].clone().normalize();
    }

    const axis = clouds[index].length >= 4
      ? principalAxis(clouds[index])
      : new Vector3(0, 1, 0);
    const away = awayFromParent[index];
    if (away.lengthSq() > 1e-8 && axis.dot(away) < 0) axis.negate();

    return axis;
  });

  // A joint twists about the bone, not the flesh: the chest's body lies across
  // the shoulders, but the spine below it still twists about the spine.
  const jointAxes = bones.map((_, index) =>
    childrenOf[index].length === 1 || awayFromParent[index].lengthSq() < 1e-8
      ? shapeAxes[index]
      : awayFromParent[index].clone().normalize(),
  );

  const shapes = bones.map((bone, index) => {
    const override = overrides[bone.name]?.shape;
    if (override && typeof override === "object") return override;
    return fitShape(
      override ?? DEFAULT_KIND[classes[index] ?? "other"] ?? "capsule",
      clouds[index],
      shapeAxes[index],
      radiusPercentile,
    );
  });

  const volumes = shapes.map(volumeOf);
  const classVolume = new Map<BoneClass | null, number>();
  classes.forEach((boneClass, index) =>
    classVolume.set(boneClass, (classVolume.get(boneClass) ?? 0) + volumes[index]),
  );
  const trunkVolume = (classVolume.get("pelvis") ?? 0) + (classVolume.get("spine") ?? 0);
  const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);

  const shares = classes.map((boneClass, index) => {
    if (boneClass === null) return volumes[index] / totalVolume;
    const pooled =
      boneClass === "pelvis" || boneClass === "spine"
        ? trunkVolume
        : classVolume.get(boneClass)!;
    return MASS_SHARE[boneClass] * (volumes[index] / pooled);
  });

  const fixedMass = names.reduce(
    (sum, name) => sum + (overrides[name]?.mass ?? 0),
    0,
  );
  const freeShare = names.reduce(
    (sum, name, index) =>
      overrides[name]?.mass === undefined ? sum + shares[index] : sum,
    0,
  );
  const spread = Math.max(0, mass - fixedMass);

  const config: RagdollConfig = {
    bones: bones.map((bone, index) => {
      const override = overrides[bone.name];
      const boneMass =
        override?.mass ?? round((shares[index] / freeShare) * spread);
      const entry: RagdollBoneConfig = {
        name: bone.name,
        shape: shapes[index],
        mass: boneMass,
      };

      if (parents[index] >= 0) {
        entry.joint = {
          ...jointFor(
            classes[index],
            jointAxes[index],
            rotations[index],
            left,
            forward,
          ),
          ...override?.joint,
        };
      }

      return entry;
    }),
  };

  return { config, excluded };
};
