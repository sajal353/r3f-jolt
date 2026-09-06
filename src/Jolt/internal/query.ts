import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import type { JoltApi, QuatInput, Vec3Input } from "../types";
import type { BodyApi } from "./useBody";

/** Either end of the api: what a body hook returns, or the raw Jolt body. */
export type QueryBody = BodyApi<Jolt.Shape> | Jolt.Body;

export type QueryMode = "closest" | "any" | "all";

export interface QueryFilterOptions {
  /** Object layer to query against. Defaults to the moving layer, which sees both. */
  layer?: number;
  /**
   * Restrict the broadphase to one layer, skipping whole regions of the tree
   * before any shape is looked at. Index into `broadPhaseLayers` on `<Physics>`.
   */
  broadPhaseLayer?: number;
  /**
   * Bodies the query pretends are not there. The usual case is the body doing
   * the asking, which otherwise reports itself at zero distance.
   */
  ignoreBodies?: QueryBody[];
}

export const bodyOf = (entry: QueryBody) =>
  "body" in entry ? entry.body : entry;

export const readVector = (value: Vec3Input) =>
  Array.isArray(value)
    ? ([value[0], value[1], value[2]] as const)
    : ([value.x, value.y, value.z] as const);

export const readQuat = (value: QuatInput) =>
  Array.isArray(value)
    ? ([value[0], value[1], value[2], value[3]] as const)
    : ([value.x, value.y, value.z, value.w] as const);

/**
 * The four filters every narrow-phase query takes, in one place. Extracted from
 * the raycasters, which had the only copy: a shape cast, an overlap and a point
 * query all want exactly this set, and five copies of it would drift.
 *
 * The body filter is always an `IgnoreMultipleBodiesFilter` rather than a plain
 * `BodyFilter`. Empty it behaves identically, and it means `ignoreBodies` can be
 * changed at runtime — which it has to be, since the body doing the asking is
 * usually `undefined` at the moment the query hook mounts.
 */
export const createQueryFilters = (
  api: JoltApi,
  layer: number,
  { broadPhaseLayer, ignoreBodies }: QueryFilterOptions = {},
) => {
  const { Jolt: jolt, joltInterface } = api;

  let broadPhaseFilter: Jolt.BroadPhaseLayerFilter;

  if (broadPhaseLayer !== undefined) {
    const specified = new jolt.BroadPhaseLayer(broadPhaseLayer);
    broadPhaseFilter = new jolt.SpecifiedBroadPhaseLayerFilter(specified);
    // Taken by value, so the layer object has done its job already.
    jolt.destroy(specified);
  } else {
    broadPhaseFilter = new jolt.DefaultBroadPhaseLayerFilter(
      joltInterface.GetObjectVsBroadPhaseLayerFilter(),
      layer,
    );
  }

  const objectFilter = new jolt.DefaultObjectLayerFilter(
    joltInterface.GetObjectLayerPairFilter(),
    layer,
  );

  const bodyFilter = new jolt.IgnoreMultipleBodiesFilter();
  const shapeFilter = new jolt.ShapeFilter();

  const setIgnoredBodies = (bodies: QueryBody[]) => {
    bodyFilter.Clear();
    for (const entry of bodies) {
      bodyFilter.IgnoreBody(bodyOf(entry).GetID());
    }
  };

  if (ignoreBodies?.length) setIgnoredBodies(ignoreBodies);

  const destroy = () => {
    jolt.destroy(shapeFilter);
    jolt.destroy(bodyFilter);
    jolt.destroy(objectFilter);
    jolt.destroy(broadPhaseFilter);
  };

  return {
    broadPhaseFilter,
    objectFilter,
    bodyFilter,
    shapeFilter,
    setIgnoredBodies,
    destroy,
  };
};

export type QueryFilters = ReturnType<typeof createQueryFilters>;

/**
 * Jolt casts from the shape's **centre of mass**, not from its origin, and
 * `RShapeCast.sFromWorldTransform` is not bound — so the transform is built by
 * hand: rotate and translate to where the caller wants the shape, then shift
 * along the shape's own centre of mass offset.
 *
 * The `RMat44` that comes back is one of Jolt's static temporaries. It is safe
 * only until the next call, which is why this is always used as the argument to
 * a field setter that copies it.
 */
export const centreOfMassTransform = (
  jolt: JoltApi["Jolt"],
  shape: Jolt.Shape,
  position: Jolt.RVec3,
  rotation: Jolt.Quat,
) =>
  jolt.RMat44.prototype
    .sRotationTranslation(rotation, position)
    .PreTranslated(shape.GetCenterOfMass());

export interface OverlapHit {
  hit: boolean;
  /**
   * The body that was hit. Jolt fills in `mBodyID2` only — there is no
   * `mBodyID1`, because body 1 is the shape you handed in.
   */
  bodyID: number;
  subShapeID: number;
  /** On the queried shape, in world space. */
  contactPointOn1: Vector3;
  /** On the body that was hit, in world space. */
  contactPointOn2: Vector3;
  /**
   * Direction to push the queried shape along to separate the two, times
   * nothing in particular — the length is not the depth. `penetrationDepth` is.
   */
  penetrationAxis: Vector3;
  penetrationDepth: number;
}

export interface ShapeCastHit extends OverlapHit {
  /** Along the cast direction, so `distance` is `fraction × |direction|`. */
  fraction: number;
  distance: number;
  isBackFaceHit: boolean;
}

export const createOverlapHit = (): OverlapHit => ({
  hit: false,
  bodyID: 0,
  subShapeID: 0,
  contactPointOn1: new Vector3(),
  contactPointOn2: new Vector3(),
  penetrationAxis: new Vector3(),
  penetrationDepth: 0,
});

export const createShapeCastHit = (): ShapeCastHit => ({
  ...createOverlapHit(),
  fraction: 0,
  distance: 0,
  isBackFaceHit: false,
});

export const clearOverlapHit = <T extends OverlapHit>(result: T) => {
  result.hit = false;
  result.bodyID = 0;
  result.subShapeID = 0;
  result.contactPointOn1.set(0, 0, 0);
  result.contactPointOn2.set(0, 0, 0);
  result.penetrationAxis.set(0, 0, 0);
  result.penetrationDepth = 0;
  return result;
};

export const clearShapeCastHit = (result: ShapeCastHit) => {
  clearOverlapHit(result);
  result.fraction = 0;
  result.distance = 0;
  result.isBackFaceHit = false;
  return result;
};

/**
 * Contact points come back relative to the `inBaseOffset` the query was given,
 * not in world space. The hooks pass the query's own position as that offset —
 * which is what keeps precision usable far from the origin — and add it back
 * here, so what a consumer sees is always world space.
 */
export const fillOverlapHit = <T extends OverlapHit>(
  result: T,
  raw: Jolt.CollideShapeResult,
  offset: readonly [number, number, number],
) => {
  const on1 = raw.mContactPointOn1;
  const on2 = raw.mContactPointOn2;
  const axis = raw.mPenetrationAxis;

  result.hit = true;
  result.bodyID = raw.mBodyID2.GetIndexAndSequenceNumber();
  result.subShapeID = raw.mSubShapeID2.GetValue();
  result.penetrationDepth = raw.mPenetrationDepth;

  result.contactPointOn1.set(
    on1.GetX() + offset[0],
    on1.GetY() + offset[1],
    on1.GetZ() + offset[2],
  );
  result.contactPointOn2.set(
    on2.GetX() + offset[0],
    on2.GetY() + offset[1],
    on2.GetZ() + offset[2],
  );
  result.penetrationAxis.set(axis.GetX(), axis.GetY(), axis.GetZ());

  return result;
};

export const fillShapeCastHit = (
  result: ShapeCastHit,
  raw: Jolt.ShapeCastResult,
  offset: readonly [number, number, number],
  directionLength: number,
) => {
  fillOverlapHit(result, raw, offset);
  result.fraction = raw.mFraction;
  result.distance = raw.mFraction * directionLength;
  result.isBackFaceHit = raw.mIsBackFaceHit;
  return result;
};
