import { Vector3 } from "three";
import type Jolt from "jolt-physics";
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

const readVector = (value: Vec3Input) =>
  Array.isArray(value)
    ? ([value[0], value[1], value[2]] as const)
    : ([value.x, value.y, value.z] as const);

/**
 * The parts every raycaster needs identically: the filter set, the reusable ray,
 * and the reset-then-cast discipline. Jolt collectors accumulate across casts,
 * so forgetting the `Reset()` yields hits from three frames ago.
 */
export const createRaycastContext = (api: JoltApi, layer: number) => {
  const { Jolt: jolt, joltInterface, physicsSystem } = api;

  const settings = new jolt.RayCastSettings();
  const broadPhaseFilter = new jolt.DefaultBroadPhaseLayerFilter(
    joltInterface.GetObjectVsBroadPhaseLayerFilter(),
    layer,
  );
  const objectFilter = new jolt.DefaultObjectLayerFilter(
    joltInterface.GetObjectLayerPairFilter(),
    layer,
  );
  const bodyFilter = new jolt.BodyFilter();
  const shapeFilter = new jolt.ShapeFilter();

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
        broadPhaseFilter,
        objectFilter,
        bodyFilter,
        shapeFilter,
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
    jolt.destroy(shapeFilter);
    jolt.destroy(bodyFilter);
    jolt.destroy(objectFilter);
    jolt.destroy(broadPhaseFilter);
    jolt.destroy(settings);
  };

  return { ray, aim, cast, clear, fill, destroy };
};

export interface RaycasterOptions {
  origin?: Vec3Input;
  direction?: Vec3Input;
  layer?: number;
}
