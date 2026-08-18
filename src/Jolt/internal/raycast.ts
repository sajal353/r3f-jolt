import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import {
  createQueryFilters,
  readVector,
  type QueryFilterOptions,
} from "./query";
import type { JoltApi, Vec3Input } from "../types";

export interface RaycastHit {
  hit: boolean;
  fraction: number;
  distance: number;
  point: Vector3;
  normal: Vector3;
  bodyID: number;
}

export const createHit = (): RaycastHit => ({
  hit: false,
  fraction: 0,
  distance: 0,
  point: new Vector3(),
  normal: new Vector3(),
  bodyID: 0,
});

/**
 * The parts every raycaster needs identically: the filter set, the reusable ray,
 * and the reset-then-cast discipline. Jolt collectors accumulate across casts,
 * so forgetting the `Reset()` yields hits from three frames ago.
 */
export const createRaycastContext = (
  api: JoltApi,
  layer: number,
  options: QueryFilterOptions = {},
) => {
  const { Jolt: jolt, physicsSystem } = api;

  const settings = new jolt.RayCastSettings();
  const filters = createQueryFilters(api, layer, options);

  const rayOrigin = new jolt.RVec3(0, 0, 0);
  const rayDirection = new jolt.Vec3(0, -1, 0);

  const ray = new jolt.RRayCast();
  ray.mOrigin = rayOrigin;
  ray.mDirection = rayDirection;

  const aim = (origin?: Vec3Input, direction?: Vec3Input) => {
    if (origin) {
      const [x, y, z] = readVector(origin);
      rayOrigin.Set(x, y, z);
      ray.mOrigin = rayOrigin;
    }

    if (direction) {
      const [x, y, z] = readVector(direction);
      rayDirection.Set(x, y, z);
      ray.mDirection = rayDirection;
    }
  };

  const cast = (collector: Jolt.CastRayCollector) => {
    collector.Reset();
    physicsSystem
      .GetNarrowPhaseQuery()
      .CastRay(
        ray,
        settings,
        collector,
        filters.broadPhaseFilter,
        filters.objectFilter,
        filters.bodyFilter,
        filters.shapeFilter,
      );
  };

  const clear = (result: RaycastHit) => {
    result.hit = false;
    result.fraction = 0;
    result.distance = 0;
    result.bodyID = 0;
    result.point.set(0, 0, 0);
    result.normal.set(0, 0, 0);
    return result;
  };

  const fill = (result: RaycastHit, raw: Jolt.RayCastResult) => {
    result.hit = true;
    result.fraction = raw.mFraction;
    result.distance = raw.mFraction * rayDirection.Length();
    result.bodyID = raw.mBodyID.GetIndexAndSequenceNumber();

    const point = ray.GetPointOnRay(raw.mFraction);
    result.point.set(point.GetX(), point.GetY(), point.GetZ());

    const body = physicsSystem
      .GetBodyLockInterfaceNoLock()
      .TryGetBody(raw.mBodyID);

    if (body && jolt.getPointer(body) !== 0) {
      const normal = body.GetWorldSpaceSurfaceNormal(raw.mSubShapeID2, point);
      result.normal.set(normal.GetX(), normal.GetY(), normal.GetZ());
    } else {
      result.normal.set(0, 0, 0);
    }

    return result;
  };

  const destroy = () => {
    jolt.destroy(ray);
    jolt.destroy(rayOrigin);
    jolt.destroy(rayDirection);
    filters.destroy();
    jolt.destroy(settings);
  };

  return {
    ray,
    aim,
    cast,
    clear,
    fill,
    destroy,
    setIgnoredBodies: filters.setIgnoredBodies,
  };
};

export interface RaycasterOptions extends QueryFilterOptions {
  origin?: Vec3Input;
  direction?: Vec3Input;
}
