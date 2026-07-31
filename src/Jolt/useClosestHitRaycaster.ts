import { useEffect, useState } from "react";
import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import type { Vec3Tuple } from "./types";

export interface RaycastHit {
  hit: boolean;
  fraction: number;
  distance: number;
  point: Vector3;
  normal: Vector3;
  bodyID: number;
}

export interface UseClosestHitRaycasterOptions {
  origin?: Vec3Tuple;
  direction?: Vec3Tuple;
  layer?: number;
}

export interface ClosestHitRaycasterApi {
  ray: Jolt.RRayCast;
  collector: Jolt.CastRayClosestHitCollisionCollector;
  cast: (origin?: Vector3 | Vec3Tuple, direction?: Vector3 | Vec3Tuple) => RaycastHit;
}

const readVector = (value: Vector3 | Vec3Tuple) =>
  Array.isArray(value)
    ? ([value[0], value[1], value[2]] as const)
    : ([value.x, value.y, value.z] as const);

export const useClosestHitRaycaster = (
  options: UseClosestHitRaycasterOptions = {},
) => {
  const api = useJolt();
  const [raycaster, setRaycaster] = useState<ClosestHitRaycasterApi>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
  const [mount] = useState(() => options);

  useEffect(() => {
    const { Jolt: jolt, joltInterface, physicsSystem, layers, state } = api;
    const {
      origin = [0, 0, 0],
      direction = [0, -1, 0],
      layer = layers.LAYER_MOVING,
    } = mount;

    const raySettings = new jolt.RayCastSettings();
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

    const rayOrigin = new jolt.RVec3(origin[0], origin[1], origin[2]);
    const rayDirection = new jolt.Vec3(
      direction[0],
      direction[1],
      direction[2],
    );

    const ray = new jolt.RRayCast();
    ray.mOrigin = rayOrigin;
    ray.mDirection = rayDirection;

    const collector = new jolt.CastRayClosestHitCollisionCollector();

    const result: RaycastHit = {
      hit: false,
      fraction: 0,
      distance: 0,
      point: new Vector3(),
      normal: new Vector3(),
      bodyID: 0,
    };

    const cast = (
      nextOrigin?: Vector3 | Vec3Tuple,
      nextDirection?: Vector3 | Vec3Tuple,
    ): RaycastHit => {
      if (state.disposed) return result;

      if (nextOrigin) {
        const [x, y, z] = readVector(nextOrigin);
        rayOrigin.Set(x, y, z);
        ray.mOrigin = rayOrigin;
      }

      if (nextDirection) {
        const [x, y, z] = readVector(nextDirection);
        rayDirection.Set(x, y, z);
        ray.mDirection = rayDirection;
      }

      collector.Reset();

      physicsSystem
        .GetNarrowPhaseQuery()
        .CastRay(
          ray,
          raySettings,
          collector,
          broadPhaseFilter,
          objectFilter,
          bodyFilter,
          shapeFilter,
        );

      result.hit = collector.HadHit();
      result.point.set(0, 0, 0);
      result.normal.set(0, 0, 0);

      if (!result.hit) {
        result.fraction = 0;
        result.distance = 0;
        result.bodyID = 0;
        return result;
      }

      const hit = collector.mHit;
      result.fraction = hit.mFraction;
      result.distance = hit.mFraction * rayDirection.Length();
      result.bodyID = hit.mBodyID.GetIndexAndSequenceNumber();

      const point = ray.GetPointOnRay(hit.mFraction);
      result.point.set(point.GetX(), point.GetY(), point.GetZ());

      const body = physicsSystem.GetBodyLockInterfaceNoLock().TryGetBody(
        hit.mBodyID,
      );

      if (body && jolt.getPointer(body) !== 0) {
        const normal = body.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point);
        result.normal.set(normal.GetX(), normal.GetY(), normal.GetZ());
      }

      return result;
    };

    // Same external-resource publication as `useCar`, and exempt for the same
    // reason there: no ref in the published value, so the rule's
    // ref-derived-setState exemption does not cover it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRaycaster({ ray, collector, cast });

    return () => {
      setRaycaster(undefined);

      if (state.destroyed) return;

      jolt.destroy(collector);
      jolt.destroy(ray);
      jolt.destroy(rayOrigin);
      jolt.destroy(rayDirection);
      jolt.destroy(shapeFilter);
      jolt.destroy(bodyFilter);
      jolt.destroy(objectFilter);
      jolt.destroy(broadPhaseFilter);
      jolt.destroy(raySettings);
    };
  }, [api, mount]);

  return [raycaster] as [ClosestHitRaycasterApi | undefined];
};
