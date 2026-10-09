import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

/**
 * Float offsets into a soft body's `ArraySoftBodyVertex`, read straight off the
 * wasm heap. Going through `GetVertex(i)` would cross into wasm three times per
 * vertex per frame; this is one property read for the whole array.
 *
 * Positions and velocities are relative to the body's position and in world
 * orientation — `mMakeRotationIdentity`, on by default, bakes the creation
 * rotation into the vertices.
 */
export interface SoftBodyVertices {
  count: number;
  /** Floats from one vertex to the next. */
  stride: number;
  /** Heap float index of vertex 0's position; `+ i * stride` for vertex i. */
  position: number;
  velocity: number;
  /**
   * Not in `SoftBodyVertexTraits`: the last float of Jolt's 80-byte vertex,
   * after the collision plane and contact bookkeeping. `tests/softBody` pins
   * it, so a binding that moves it fails there rather than pinning nothing.
   */
  inverseMass: number;
  faces: Uint32Array;
  /** One over how many faces each vertex is a corner of. */
  faceShare: Float32Array;
}

const INVERSE_MASS_BYTE = 76;
const FACE_VERTICES = 3;

const faceIndices = (jolt: JoltModule, motion: Jolt.SoftBodyMotionProperties) => {
  const faces = motion.GetFaces();
  const count = faces.size();
  const result = new Uint32Array(count * FACE_VERTICES);
  if (count === 0) return result;

  const base = jolt.getPointer(faces.at(0)) >> 2;
  const stride =
    count > 1 ? (jolt.getPointer(faces.at(1)) >> 2) - base : FACE_VERTICES;

  for (let face = 0; face < count; face += 1) {
    const at = base + face * stride;
    result[face * 3] = jolt.HEAPU32[at];
    result[face * 3 + 1] = jolt.HEAPU32[at + 1];
    result[face * 3 + 2] = jolt.HEAPU32[at + 2];
  }

  return result;
};

const faceShares = (faces: Uint32Array, count: number) => {
  const shares = new Float32Array(count);
  for (const vertex of faces) shares[vertex] += 1;
  for (let vertex = 0; vertex < count; vertex += 1) {
    shares[vertex] = shares[vertex] > 0 ? 1 / shares[vertex] : 0;
  }
  return shares;
};

export const softBodyMotion = (jolt: JoltModule, body: Jolt.Body) =>
  jolt.castObject(body.GetMotionProperties(), jolt.SoftBodyMotionProperties);

/**
 * The vertex array never reallocates after creation, so the offsets hold for
 * the body's life. The heap itself can grow, which is why callers index
 * `jolt.HEAPF32` at the moment of use instead of keeping a view.
 */
export const softBodyVertices = (
  jolt: JoltModule,
  body: Jolt.Body,
): SoftBodyVertices => {
  const motion = softBodyMotion(jolt, body);
  const vertices = motion.GetVertices();
  const count = vertices.size();
  const first = jolt.getPointer(vertices.at(0));
  const stride =
    count > 1 ? (jolt.getPointer(vertices.at(1)) - first) >> 2 : 20;
  const traits = jolt.SoftBodyVertexTraits.prototype;
  const faces = faceIndices(jolt, motion);

  return {
    count,
    stride,
    position: (first + traits.mPositionOffset) >> 2,
    velocity: (first + traits.mVelocityOffset) >> 2,
    inverseMass: (first + INVERSE_MASS_BYTE) >> 2,
    faces,
    faceShare: faceShares(faces, count),
  };
};
