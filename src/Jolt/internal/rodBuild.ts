import { Vector3, type Curve, type Quaternion } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule, Vec3Tuple } from "../types";
import type { LRAType } from "./softBodyBuild";

/** Every strand's vertices, one after another. */
export interface RodStrands {
  /** xyz per vertex. */
  positions: Float32Array;
  /** First vertex of each strand, then the total: one more entry than strands. */
  starts: Uint32Array;
}

export interface RodBuildOptions {
  stretchCompliance: number;
  bendCompliance: number;
  /** One flag per vertex. */
  pinned: Uint8Array;
  /** Keep Jolt's fixed direction at a pinned vertex rather than a hinge. */
  clamp: boolean;
  /** The authored shape is the rest shape; off, the rest shape is straight. */
  curl: boolean;
  mass?: number;
  lra: LRAType;
  lraMaxDistanceMultiplier?: number;
}

export interface RodTopology {
  vertexCount: number;
  segmentCount: number;
  /** First vertex of each segment, strand after strand. */
  segmentStart: Uint32Array;
  restLength: Float32Array;
  /**
   * Jolt rod behind each segment. `Optimize()` reorders Jolt's rods, and
   * `GetRodRotation` indexes that order, so build order is no guide.
   */
  rodOf: Uint32Array;
  /** One over how many segments meet at each vertex. */
  segmentShare: Float32Array;
}

const fail = (hook: string, message: string): never => {
  throw new Error(`[r3f-jolt] ${hook}: ${message}`);
};

const distance = (positions: Float32Array, a: number, b: number) =>
  Math.hypot(
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  );

/** Equal segments by arc length along the straight lines between `points`. */
const resample = (points: readonly Vec3Tuple[], segments: number) => {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay, az] = points[index - 1];
    const [bx, by, bz] = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(bx - ax, by - ay, bz - az));
  }

  const total = lengths[lengths.length - 1];
  const result = new Float32Array((segments + 1) * 3);
  let span = 1;

  for (let vertex = 0; vertex <= segments; vertex += 1) {
    const along = (total * vertex) / segments;
    while (span < points.length - 1 && lengths[span] < along) span += 1;
    const width = lengths[span] - lengths[span - 1];
    const t = width > 0 ? (along - lengths[span - 1]) / width : 0;
    const from = points[span - 1];
    const to = points[span];
    result[vertex * 3] = from[0] + (to[0] - from[0]) * t;
    result[vertex * 3 + 1] = from[1] + (to[1] - from[1]) * t;
    result[vertex * 3 + 2] = from[2] + (to[2] - from[2]) * t;
  }

  return result;
};

export const strandFromPoints = (
  points: readonly Vec3Tuple[],
  segments?: number,
) => {
  if (segments !== undefined) return resample(points, segments);
  const result = new Float32Array(points.length * 3);
  points.forEach(function copyPoint(point, index) {
    result.set(point, index * 3);
  });
  return result;
};

export const strandFromCurve = (curve: Curve<Vector3>, segments: number) => {
  const result = new Float32Array((segments + 1) * 3);
  curve.getSpacedPoints(segments).forEach(function copyPoint(point, index) {
    result[index * 3] = point.x;
    result[index * 3 + 1] = point.y;
    result[index * 3 + 2] = point.z;
  });
  return result;
};

export const packStrands = (
  strands: readonly Float32Array[],
  hook: string,
): RodStrands => {
  const starts = new Uint32Array(strands.length + 1);
  for (let strand = 0; strand < strands.length; strand += 1) {
    const count = strands[strand].length / 3;
    if (count < 2) fail(hook, `strand ${strand} needs at least two points.`);
    starts[strand + 1] = starts[strand] + count;
  }

  const positions = new Float32Array(starts[strands.length] * 3);
  strands.forEach(function copyStrand(strand, index) {
    positions.set(strand, starts[index] * 3);
  });

  return { positions, starts };
};

const segmentsOf = (strands: RodStrands, hook: string) => {
  const { positions, starts } = strands;
  const strandCount = starts.length - 1;
  const segmentCount = starts[strandCount] - strandCount;
  const segmentStart = new Uint32Array(segmentCount);
  const restLength = new Float32Array(segmentCount);
  const touching = new Float32Array(starts[strandCount]);

  let segment = 0;
  for (let strand = 0; strand < strandCount; strand += 1) {
    for (let vertex = starts[strand]; vertex + 1 < starts[strand + 1]; vertex += 1) {
      const length = distance(positions, vertex, vertex + 1);
      if (length < 1e-6) {
        fail(hook, `points ${vertex} and ${vertex + 1} are in the same place.`);
      }
      segmentStart[segment] = vertex;
      restLength[segment] = length;
      touching[vertex] += 1;
      touching[vertex + 1] += 1;
      segment += 1;
    }
  }

  const segmentShare = touching.map((count) => (count > 0 ? 1 / count : 0));
  return { segmentCount, segmentStart, restLength, segmentShare };
};

const addVertices = (
  jolt: JoltModule,
  shared: Jolt.SoftBodySharedSettings,
  strands: RodStrands,
  pinned: Uint8Array,
  mass: number | undefined,
) => {
  const count = strands.positions.length / 3;
  let free = 0;
  for (let index = 0; index < count; index += 1) if (!pinned[index]) free += 1;
  const inverseMass = mass !== undefined && mass > 0 ? free / mass : 1;

  const vertex = new jolt.SoftBodySharedSettingsVertex();
  const point = new jolt.Float3(0, 0, 0);
  shared.mVertices.reserve(count);

  for (let index = 0; index < count; index += 1) {
    point.x = strands.positions[index * 3];
    point.y = strands.positions[index * 3 + 1];
    point.z = strands.positions[index * 3 + 2];
    vertex.mPosition = point;
    vertex.mInvMass = pinned[index] ? 0 : inverseMass;
    shared.mVertices.push_back(vertex);
  }

  jolt.destroy(point);
  jolt.destroy(vertex);
  return inverseMass;
};

const addRods = (
  jolt: JoltModule,
  shared: Jolt.SoftBodySharedSettings,
  strands: RodStrands,
  segmentStart: Uint32Array,
  { stretchCompliance, bendCompliance }: RodBuildOptions,
) => {
  const rod = new jolt.SoftBodySharedSettingsRodStretchShear(0, 1, stretchCompliance);
  for (const vertex of segmentStart) {
    rod.set_mVertex(0, vertex);
    rod.set_mVertex(1, vertex + 1);
    shared.mRodStretchShearConstraints.push_back(rod);
  }
  jolt.destroy(rod);

  // Rods are numbered as segments are, so a pair within a strand is adjacent.
  const joint = new jolt.SoftBodySharedSettingsRodBendTwist(0, 1, bendCompliance);
  const { starts } = strands;
  let segment = 0;
  for (let strand = 0; strand + 1 < starts.length; strand += 1) {
    const segments = starts[strand + 1] - starts[strand] - 1;
    for (let pair = 0; pair + 1 < segments; pair += 1) {
      joint.set_mRod(0, segment + pair);
      joint.set_mRod(1, segment + pair + 1);
      shared.mRodBendTwistConstraints.push_back(joint);
    }
    segment += segments;
  }
  jolt.destroy(joint);
};

/**
 * Tethers every free vertex to the nearest pinned vertex on each side of it in
 * its strand: a farther pin's tether could never be the one that binds.
 */
const addTethers = (
  jolt: JoltModule,
  shared: Jolt.SoftBodySharedSettings,
  strands: RodStrands,
  pinned: Uint8Array,
  { lra, lraMaxDistanceMultiplier = 1 }: RodBuildOptions,
) => {
  if (lra === "none") return;

  const { positions, starts } = strands;
  const tether = new jolt.SoftBodySharedSettingsLRA(0, 1, 0);
  const along = new Float32Array(positions.length / 3);

  const tie = (anchor: number, vertex: number) => {
    const rest =
      lra === "geodesic"
        ? Math.abs(along[vertex] - along[anchor])
        : distance(positions, anchor, vertex);
    tether.set_mVertex(0, anchor);
    tether.set_mVertex(1, vertex);
    tether.mMaxDistance = rest * lraMaxDistanceMultiplier;
    shared.mLRAConstraints.push_back(tether);
  };

  for (let strand = 0; strand + 1 < starts.length; strand += 1) {
    const first = starts[strand];
    const last = starts[strand + 1] - 1;
    for (let vertex = first + 1; vertex <= last; vertex += 1) {
      along[vertex] = along[vertex - 1] + distance(positions, vertex - 1, vertex);
    }

    let previous = -1;
    for (let vertex = first; vertex <= last; vertex += 1) {
      if (pinned[vertex]) previous = vertex;
      else if (previous >= 0) tie(previous, vertex);
    }

    let next = -1;
    for (let vertex = last; vertex >= first; vertex -= 1) {
      if (pinned[vertex]) next = vertex;
      else if (next >= 0) tie(next, vertex);
    }
  }

  jolt.destroy(tether);
};

/**
 * `CalculateRodProperties` gives a rod touching a pinned vertex no mass, and
 * Jolt never turns a rod with no mass: the end keeps its rest direction. A
 * hinge gets back the mass Jolt gives any rod, its lighter vertex's.
 */
const freePinnedRods = (
  shared: Jolt.SoftBodySharedSettings,
  segmentStart: Uint32Array,
  pinned: Uint8Array,
  inverseMass: number,
) => {
  const rods = shared.mRodStretchShearConstraints;
  segmentStart.forEach(function freeRod(vertex, segment) {
    if (pinned[vertex] === pinned[vertex + 1]) return;
    rods.at(segment).mInvMass = inverseMass;
  });
};

const straighten = (jolt: JoltModule, shared: Jolt.SoftBodySharedSettings) => {
  const identity = new jolt.Quat(0, 0, 0, 1);
  const joints = shared.mRodBendTwistConstraints;
  for (let index = 0; index < joints.size(); index += 1) {
    joints.at(index).mOmega0 = identity;
  }
  jolt.destroy(identity);
};

const mapRods = (
  shared: Jolt.SoftBodySharedSettings,
  vertexCount: number,
  segmentStart: Uint32Array,
) => {
  const segmentAt = new Int32Array(vertexCount).fill(-1);
  segmentStart.forEach(function markStart(vertex, segment) {
    segmentAt[vertex] = segment;
  });

  const rods = shared.mRodStretchShearConstraints;
  const rodOf = new Uint32Array(segmentStart.length);
  for (let rod = 0; rod < rods.size(); rod += 1) {
    const entry = rods.at(rod);
    const start = Math.min(entry.get_mVertex(0), entry.get_mVertex(1));
    rodOf[segmentAt[start]] = rod;
  }
  return rodOf;
};

/**
 * Comes back with one reference held by the caller, as `createSharedSettings`
 * does: the body takes its own.
 */
export const createRodSettings = (
  jolt: JoltModule,
  strands: RodStrands,
  options: RodBuildOptions,
  hook: string,
) => {
  const vertexCount = strands.positions.length / 3;
  const { segmentCount, segmentStart, restLength, segmentShare } = segmentsOf(
    strands,
    hook,
  );

  const shared = new jolt.SoftBodySharedSettings();
  shared.AddRef();

  const inverseMass = addVertices(
    jolt,
    shared,
    strands,
    options.pinned,
    options.mass,
  );
  addRods(jolt, shared, strands, segmentStart, options);
  addTethers(jolt, shared, strands, options.pinned, options);

  shared.CalculateRodProperties();
  if (!options.clamp) {
    freePinnedRods(shared, segmentStart, options.pinned, inverseMass);
  }
  if (!options.curl) straighten(jolt, shared);

  shared.Optimize();

  const topology: RodTopology = {
    vertexCount,
    segmentCount,
    segmentStart,
    restLength,
    rodOf: mapRods(shared, vertexCount, segmentStart),
    segmentShare,
  };

  return { shared, topology };
};

/**
 * `GetRodRotation` hands back one static `Quat`; reading its floats off the
 * heap costs one crossing where `GetX` … `GetW` would cost four more.
 */
export const readRodRotation = (
  jolt: JoltModule,
  motion: Jolt.SoftBodyMotionProperties,
  rod: number,
  target: Quaternion,
) => {
  const at = jolt.getPointer(motion.GetRodRotation(rod)) >> 2;
  const heap = jolt.HEAPF32;
  return target.set(heap[at], heap[at + 1], heap[at + 2], heap[at + 3]);
};
