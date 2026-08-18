import { useEffect, useState } from "react";
import { useJolt } from "./useJolt";
import {
  createQueryFilters,
  readQuat,
  readVector,
  type QueryFilterOptions,
} from "./internal/query";
import type { QuatInput, Vec3Input } from "./types";

export type UseBroadphaseQueryOptions = Omit<
  QueryFilterOptions,
  "ignoreBodies"
>;

export interface BroadphaseQueryApi {
  /** Bodies whose bounding box the ray crosses. Length of `direction` is the reach. */
  castRay: (origin: Vec3Input, direction: Vec3Input) => number[];
  /** Bodies whose bounding box overlaps an axis-aligned box. */
  collideAABox: (min: Vec3Input, max: Vec3Input) => number[];
  collideSphere: (centre: Vec3Input, radius: number) => number[];
  collidePoint: (point: Vec3Input) => number[];
  collideOrientedBox: (
    centre: Vec3Input,
    halfExtents: Vec3Input,
    rotation?: QuatInput,
  ) => number[];
  /** Bodies an axis-aligned box would meet if swept along `direction`. */
  castAABox: (min: Vec3Input, max: Vec3Input, direction: Vec3Input) => number[];
}

/**
 * The cheap half of a query: which bodies are *near* something, judged by
 * bounding box alone, with no shape ever looked at. Right for AI perception,
 * spatial culling and narrowing a set before an exact test — and wrong for
 * anything that has to be true, since a bounding box overlapping is not the
 * same as a body overlapping.
 *
 * It returns body ids and nothing else. Jolt binds no ready-made broad-phase
 * collectors — only the `*JS` bases, whose `AddHit` hands back a raw pointer —
 * so every hit costs a call into JS. That is affordable precisely because the
 * answers are small; it is not a hook to run against the whole world every
 * frame.
 *
 * The returned array is reused between calls.
 */
export const useBroadphaseQuery = (options: UseBroadphaseQueryOptions = {}) => {
  const api = useJolt();
  const [query, setQuery] = useState<BroadphaseQueryApi>();

  const [mount] = useState(() => options);

  useEffect(() => {
    const { Jolt: jolt, layers, physicsSystem, state } = api;
    const { layer = layers.LAYER_MOVING } = mount;

    const filters = createQueryFilters(api, layer, mount);
    const broadPhase = physicsSystem.GetBroadPhaseQuery();

    const results: number[] = [];

    // Every method a `JSImplementation` declares has to be assigned — leave one
    // out and Jolt refuses the object outright rather than falling back to the
    // base. `Reset` is the base's own behaviour, written out.
    const rayCollector = new jolt.RayCastBodyCollectorJS();
    rayCollector.Reset = () => rayCollector.ResetEarlyOutFraction();
    rayCollector.AddHit = (result: number) => {
      const hit = jolt.wrapPointer(result, jolt.BroadPhaseCastResult);
      results.push(hit.mBodyID.GetIndexAndSequenceNumber());
    };

    const overlapCollector = new jolt.CollideShapeBodyCollectorJS();
    overlapCollector.Reset = () => overlapCollector.ResetEarlyOutFraction();
    overlapCollector.AddHit = (result: number) => {
      const bodyID = jolt.wrapPointer(result, jolt.BodyID);
      results.push(bodyID.GetIndexAndSequenceNumber());
    };

    const sweepCollector = new jolt.CastShapeBodyCollectorJS();
    sweepCollector.Reset = () => sweepCollector.ResetEarlyOutFraction();
    sweepCollector.AddHit = (result: number) => {
      const hit = jolt.wrapPointer(result, jolt.BroadPhaseCastResult);
      results.push(hit.mBodyID.GetIndexAndSequenceNumber());
    };

    // One of each kind, reused: the alternative is a Jolt allocation per call
    // on what is meant to be the cheap query.
    const point = new jolt.Vec3(0, 0, 0);
    const extent = new jolt.Vec3(0, 0, 0);
    const direction = new jolt.Vec3(0, 0, 0);
    const box = new jolt.AABox();
    const boxCast = new jolt.AABoxCast();
    const orientedBox = new jolt.OrientedBox();
    const rotation = new jolt.Quat(0, 0, 0, 1);
    const ray = new jolt.RayCast();

    const begin = (collector: { Reset: () => void }) => {
      results.length = 0;
      collector.Reset();
    };

    const setBox = (min: Vec3Input, max: Vec3Input) => {
      const [minX, minY, minZ] = readVector(min);
      const [maxX, maxY, maxZ] = readVector(max);
      point.Set(minX, minY, minZ);
      extent.Set(maxX, maxY, maxZ);
      box.mMin = point;
      box.mMax = extent;
    };

    const castRay = (origin: Vec3Input, castDirection: Vec3Input) => {
      if (state.disposed) return results;

      const [originX, originY, originZ] = readVector(origin);
      const [dirX, dirY, dirZ] = readVector(castDirection);
      point.Set(originX, originY, originZ);
      direction.Set(dirX, dirY, dirZ);
      ray.mOrigin = point;
      ray.mDirection = direction;

      begin(rayCollector);
      broadPhase.CastRay(
        ray,
        rayCollector,
        filters.broadPhaseFilter,
        filters.objectFilter,
      );

      return results;
    };

    const collideAABox = (min: Vec3Input, max: Vec3Input) => {
      if (state.disposed) return results;

      setBox(min, max);
      begin(overlapCollector);
      broadPhase.CollideAABox(
        box,
        overlapCollector,
        filters.broadPhaseFilter,
        filters.objectFilter,
      );

      return results;
    };

    const collideSphere = (centre: Vec3Input, radius: number) => {
      if (state.disposed) return results;

      const [x, y, z] = readVector(centre);
      point.Set(x, y, z);

      begin(overlapCollector);
      broadPhase.CollideSphere(
        point,
        radius,
        overlapCollector,
        filters.broadPhaseFilter,
        filters.objectFilter,
      );

      return results;
    };

    const collidePoint = (target: Vec3Input) => {
      if (state.disposed) return results;

      const [x, y, z] = readVector(target);
      point.Set(x, y, z);

      begin(overlapCollector);
      broadPhase.CollidePoint(
        point,
        overlapCollector,
        filters.broadPhaseFilter,
        filters.objectFilter,
      );

      return results;
    };

    const collideOrientedBox = (
      centre: Vec3Input,
      halfExtents: Vec3Input,
      nextRotation: QuatInput = [0, 0, 0, 1],
    ) => {
      if (state.disposed) return results;

      const [x, y, z] = readVector(centre);
      const [halfX, halfY, halfZ] = readVector(halfExtents);
      const [qx, qy, qz, qw] = readQuat(nextRotation);

      point.Set(x, y, z);
      extent.Set(halfX, halfY, halfZ);
      rotation.Set(qx, qy, qz, qw);

      orientedBox.mOrientation = jolt.Mat44.prototype.sRotationTranslation(
        rotation,
        point,
      );
      orientedBox.mHalfExtents = extent;

      begin(overlapCollector);
      broadPhase.CollideOrientedBox(
        orientedBox,
        overlapCollector,
        filters.broadPhaseFilter,
        filters.objectFilter,
      );

      return results;
    };

    const castAABox = (
      min: Vec3Input,
      max: Vec3Input,
      castDirection: Vec3Input,
    ) => {
      if (state.disposed) return results;

      setBox(min, max);

      const [dirX, dirY, dirZ] = readVector(castDirection);
      direction.Set(dirX, dirY, dirZ);

      boxCast.mBox = box;
      boxCast.mDirection = direction;

      begin(sweepCollector);
      broadPhase.CastAABox(
        boxCast,
        sweepCollector,
        filters.broadPhaseFilter,
        filters.objectFilter,
      );

      return results;
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery({
      castRay,
      collideAABox,
      collideSphere,
      collidePoint,
      collideOrientedBox,
      castAABox,
    });

    return () => {
      setQuery(undefined);

      if (state.destroyed) return;

      jolt.destroy(ray);
      jolt.destroy(rotation);
      jolt.destroy(orientedBox);
      jolt.destroy(boxCast);
      jolt.destroy(box);
      jolt.destroy(direction);
      jolt.destroy(extent);
      jolt.destroy(point);
      jolt.destroy(sweepCollector);
      jolt.destroy(overlapCollector);
      jolt.destroy(rayCollector);
      filters.destroy();
    };
  }, [api, mount]);

  return [query] as [BroadphaseQueryApi | undefined];
};
