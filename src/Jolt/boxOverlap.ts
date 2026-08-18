import type Jolt from "jolt-physics";
import { readQuat, readVector } from "./internal/query";
import type { JoltModule, QuatInput, Vec3Input } from "./types";

export interface AABoxInput {
  min: Vec3Input;
  max: Vec3Input;
}

export interface OrientedBoxInput {
  centre: Vec3Input;
  halfExtents: Vec3Input;
  rotation?: QuatInput;
}

interface BoxScratch {
  boxA: Jolt.OrientedBox;
  boxB: Jolt.OrientedBox;
  aabox: Jolt.AABox;
  vecA: Jolt.Vec3;
  vecB: Jolt.Vec3;
  quat: Jolt.Quat;
}

/**
 * Jolt objects for the box tests, one set per module rather than one per call.
 * These are pure maths with no world attached, so there is no hook to hang a
 * lifetime on — and allocating six WASM objects to answer a boolean would cost
 * more than the answer does.
 */
const scratchByModule = new WeakMap<JoltModule, BoxScratch>();

const scratchFor = (jolt: JoltModule) => {
  const existing = scratchByModule.get(jolt);
  if (existing) return existing;

  const created = {
    boxA: new jolt.OrientedBox(),
    boxB: new jolt.OrientedBox(),
    aabox: new jolt.AABox(),
    vecA: new jolt.Vec3(0, 0, 0),
    vecB: new jolt.Vec3(0, 0, 0),
    quat: new jolt.Quat(0, 0, 0, 1),
  };

  scratchByModule.set(jolt, created);
  return created;
};

const fillOriented = (
  jolt: JoltModule,
  target: Jolt.OrientedBox,
  { centre, halfExtents, rotation = [0, 0, 0, 1] }: OrientedBoxInput,
) => {
  const scratch = scratchFor(jolt);
  const [x, y, z] = readVector(centre);
  const [halfX, halfY, halfZ] = readVector(halfExtents);
  const [qx, qy, qz, qw] = readQuat(rotation);

  scratch.vecA.Set(x, y, z);
  scratch.vecB.Set(halfX, halfY, halfZ);
  scratch.quat.Set(qx, qy, qz, qw);

  target.mOrientation = jolt.Mat44.prototype.sRotationTranslation(
    scratch.quat,
    scratch.vecA,
  );
  target.mHalfExtents = scratch.vecB;
};

/**
 * Does an oriented box overlap an axis-aligned one? No world, no bodies, no
 * broadphase — the separating-axis test on its own, for culling and for
 * region tests you want to answer without asking the simulation anything.
 */
export const overlapsAABox = (
  jolt: JoltModule,
  box: OrientedBoxInput,
  aabox: AABoxInput,
  epsilon = 1e-6,
) => {
  const scratch = scratchFor(jolt);

  fillOriented(jolt, scratch.boxA, box);

  const [minX, minY, minZ] = readVector(aabox.min);
  const [maxX, maxY, maxZ] = readVector(aabox.max);
  scratch.vecA.Set(minX, minY, minZ);
  scratch.vecB.Set(maxX, maxY, maxZ);
  scratch.aabox.mMin = scratch.vecA;
  scratch.aabox.mMax = scratch.vecB;

  return scratch.boxA.OverlapsAABox(scratch.aabox, epsilon);
};

/** The same test between two oriented boxes. */
export const overlapsOrientedBox = (
  jolt: JoltModule,
  a: OrientedBoxInput,
  b: OrientedBoxInput,
  epsilon = 1e-6,
) => {
  const scratch = scratchFor(jolt);

  fillOriented(jolt, scratch.boxA, a);
  fillOriented(jolt, scratch.boxB, b);

  return scratch.boxA.OverlapsOrientedBox(scratch.boxB, epsilon);
};
