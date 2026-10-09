import { Vector3, type BufferGeometry } from "three";
import type { JoltModule } from "../types";
import { hardSkinned, writeSkin, type SkinBinding } from "./softBodySkin";

/**
 * A render geometry and the simulated mesh behind it. three.js splits vertices
 * wherever UVs or normals differ — a `BoxGeometry` has 24 for 8 corners — and a
 * soft body built from that falls apart at every seam. Welding by position
 * gives Jolt one vertex per point while the render geometry keeps its seams.
 */
export interface SoftBodyTopology {
  /** Simulated vertex behind each geometry vertex. */
  vertexOf: Uint32Array;
  /** Geometry triangle behind each simulated face. */
  triangleOf: Uint32Array;
  /** Three simulated vertex indices per face, in the geometry's winding. */
  faces: Uint32Array;
  /** Rest positions of the simulated vertices, in the geometry's space. */
  positions: Float32Array;
  count: number;
}

export type BendType = "none" | "distance" | "dihedral";
export type LRAType = "none" | "euclidean" | "geodesic";

export interface SoftBodyConstraintOptions {
  compliance?: number;
  shearCompliance?: number;
  bendCompliance?: number;
  bend?: BendType;
  angleTolerance?: number;
  lra?: LRAType;
  lraMaxDistanceMultiplier?: number;
  pinned?: readonly number[] | ((position: Vector3, index: number) => boolean);
  mass?: number;
  tetrahedra?: ArrayLike<number>;
  volumeCompliance?: number;
}

export const weldGeometry = (
  geometry: BufferGeometry,
  tolerance: number,
): SoftBodyTopology => {
  const position = geometry.getAttribute("position");
  if (!position) {
    throw new Error("[r3f-jolt] useSoftBody: the geometry has no positions.");
  }

  const vertexOf = new Uint32Array(position.count);
  const welded = new Map<string, number>();
  const rest: number[] = [];
  const scale = tolerance > 0 ? 1 / tolerance : 0;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const key =
      scale > 0
        ? `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`
        : `${index}`;

    let target = welded.get(key);
    if (target === undefined) {
      target = rest.length / 3;
      welded.set(key, target);
      rest.push(x, y, z);
    }
    vertexOf[index] = target;
  }

  const index = geometry.getIndex();
  const corners = index ? index.count : position.count;
  const faces: number[] = [];
  const triangleOf: number[] = [];

  for (let corner = 0; corner + 2 < corners; corner += 3) {
    const a = vertexOf[index ? index.getX(corner) : corner];
    const b = vertexOf[index ? index.getX(corner + 1) : corner + 1];
    const c = vertexOf[index ? index.getX(corner + 2) : corner + 2];

    // A sliver that welds down to a line has no area for Jolt to work with.
    if (a === b || b === c || a === c) continue;

    faces.push(a, b, c);
    triangleOf.push(corner / 3);
  }

  return {
    vertexOf,
    triangleOf: Uint32Array.from(triangleOf),
    faces: Uint32Array.from(faces),
    positions: Float32Array.from(rest),
    count: rest.length / 3,
  };
};

const pinnedVertices = (
  topology: SoftBodyTopology,
  geometry: BufferGeometry,
  pinned: SoftBodyConstraintOptions["pinned"],
) => {
  const result = new Uint8Array(topology.count);
  if (!pinned) return result;

  if (typeof pinned === "function") {
    const position = geometry.getAttribute("position");
    const point = new Vector3();
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index);
      if (pinned(point, index)) result[topology.vertexOf[index]] = 1;
    }
    return result;
  }

  for (const index of pinned) {
    if (index >= 0 && index < topology.vertexOf.length) {
      result[topology.vertexOf[index]] = 1;
    }
  }
  return result;
};

const bendTypeOf = (jolt: JoltModule, bend: BendType) =>
  bend === "none"
    ? jolt.SoftBodySharedSettings_EBendType_None
    : bend === "dihedral"
      ? jolt.SoftBodySharedSettings_EBendType_Dihedral
      : jolt.SoftBodySharedSettings_EBendType_Distance;

const lraTypeOf = (jolt: JoltModule, lra: LRAType) =>
  lra === "euclidean"
    ? jolt.SoftBodySharedSettings_ELRAType_EuclideanDistance
    : lra === "geodesic"
      ? jolt.SoftBodySharedSettings_ELRAType_GeodesicDistance
      : jolt.SoftBodySharedSettings_ELRAType_None;

/**
 * Comes back with one reference held by the caller: a new
 * `SoftBodySharedSettings` starts at zero, and the first body built from it
 * would otherwise own — and free — the only one.
 */
export const createSharedSettings = (
  jolt: JoltModule,
  geometry: BufferGeometry,
  topology: SoftBodyTopology,
  options: SoftBodyConstraintOptions,
  skin?: SkinBinding,
) => {
  const {
    compliance,
    shearCompliance,
    bendCompliance,
    bend = "distance",
    angleTolerance = (8 * Math.PI) / 180,
    lra,
    lraMaxDistanceMultiplier,
    pinned,
    mass,
    tetrahedra,
    volumeCompliance = 0,
  } = options;

  const shared = new jolt.SoftBodySharedSettings();
  shared.AddRef();

  const isPinned = pinnedVertices(topology, geometry, pinned);
  if (skin) {
    for (let index = 0; index < topology.count; index += 1) {
      if (hardSkinned(skin, index)) isPinned[index] = 1;
    }
  }
  let free = 0;
  for (const flag of isPinned) if (!flag) free += 1;
  const inverseMass = mass !== undefined && mass > 0 ? free / mass : 1;

  const vertex = new jolt.SoftBodySharedSettingsVertex();
  const point = new jolt.Float3(0, 0, 0);
  shared.mVertices.reserve(topology.count);

  for (let index = 0; index < topology.count; index += 1) {
    point.x = topology.positions[index * 3];
    point.y = topology.positions[index * 3 + 1];
    point.z = topology.positions[index * 3 + 2];
    vertex.mPosition = point;
    vertex.mInvMass = isPinned[index] ? 0 : inverseMass;
    shared.mVertices.push_back(vertex);
  }

  jolt.destroy(point);
  jolt.destroy(vertex);

  for (let face = 0; face < topology.faces.length; face += 3) {
    const entry = new jolt.SoftBodySharedSettingsFace(
      topology.faces[face],
      topology.faces[face + 1],
      topology.faces[face + 2],
      0,
    );
    shared.AddFace(entry);
    jolt.destroy(entry);
  }

  // Jolt's own defaults stand for anything left out: rigid edges and shear,
  // free bending, no tethers.
  const attributes = new jolt.SoftBodySharedSettingsVertexAttributes();
  if (compliance !== undefined) attributes.mCompliance = compliance;
  if (shearCompliance !== undefined) {
    attributes.mShearCompliance = shearCompliance;
  }
  if (bendCompliance !== undefined) attributes.mBendCompliance = bendCompliance;
  if (lra !== undefined) attributes.mLRAType = lraTypeOf(jolt, lra);
  if (lraMaxDistanceMultiplier !== undefined) {
    attributes.mLRAMaxDistanceMultiplier = lraMaxDistanceMultiplier;
  }
  shared.CreateConstraints(
    attributes,
    1,
    bendTypeOf(jolt, bend),
    angleTolerance,
  );
  jolt.destroy(attributes);

  if (tetrahedra && tetrahedra.length >= 4) {
    for (let corner = 0; corner + 3 < tetrahedra.length; corner += 4) {
      const volume = new jolt.SoftBodySharedSettingsVolume(
        topology.vertexOf[tetrahedra[corner]],
        topology.vertexOf[tetrahedra[corner + 1]],
        topology.vertexOf[tetrahedra[corner + 2]],
        topology.vertexOf[tetrahedra[corner + 3]],
        volumeCompliance,
      );
      shared.mVolumeConstraints.push_back(volume);
      jolt.destroy(volume);
    }
    shared.CalculateVolumeConstraintVolumes();
  }

  if (skin) writeSkin(jolt, shared, skin, isPinned);

  shared.Optimize();

  return shared;
};
