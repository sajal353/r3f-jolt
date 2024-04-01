import { useCallback, useEffect, useState } from "react";
import { useJolt } from "./useJolt";
import { Vector3 } from "three";
import Jolt from "jolt-physics";

export const useClosestHitRaycaster = ({
  origin,
  direction,
}: {
  origin: [number, number, number];
  direction: [number, number, number];
}) => {
  const { Jolt, joltInterface, physicsSystem, layers } = useJolt();

  const [api, setApi] = useState<{
    ray: Jolt.RRayCast;
    cast: (
      origin?: Vector3,
      direction?: Vector3
    ) => {
      collector: Jolt.CastRayClosestHitCollisionCollector;
      distance: number;
      hit: boolean;
    };
  }>();

  const init = useCallback(() => {
    const raySettings = new Jolt.RayCastSettings();

    const bpFilter = new Jolt.DefaultBroadPhaseLayerFilter(
      joltInterface.GetObjectVsBroadPhaseLayerFilter(),
      layers.LAYER_MOVING
    );
    const objectFilter = new Jolt.DefaultObjectLayerFilter(
      joltInterface.GetObjectLayerPairFilter(),
      layers.LAYER_MOVING
    );
    const bodyFilter = new Jolt.BodyFilter();
    const shapeFilter = new Jolt.ShapeFilter();

    const ray = new Jolt.RayCast();

    const tempVec3 = new Jolt.Vec3(0, 0, 0);

    tempVec3.Set(origin[0], origin[1], origin[2]);

    ray.mOrigin = tempVec3;

    tempVec3.Set(direction[0], direction[1], direction[2]);

    ray.mDirection = tempVec3;

    const hitCollector = new Jolt.CastRayClosestHitCollisionCollector();

    const cast = (origin?: Vector3, direction?: Vector3) => {
      if (origin) {
        tempVec3.Set(origin.x, origin.y, origin.z);
        ray.mOrigin = tempVec3;
      }

      if (direction) {
        tempVec3.Set(direction.x, direction.y, direction.z);
        ray.mDirection = tempVec3;
      }

      physicsSystem
        .GetNarrowPhaseQuery()
        .CastRay(
          ray,
          raySettings,
          hitCollector,
          bpFilter,
          objectFilter,
          bodyFilter,
          shapeFilter
        );

      let hit = false;
      let distance = 0;

      if (hitCollector.HadHit()) {
        hit = true;
        distance = hitCollector.mHit.mFraction;
      }

      hitCollector.Reset();

      return {
        collector: hitCollector,
        distance,
        hit,
      };
    };

    return {
      api: { ray, cast },
      cleanup: () => {
        Jolt.destroy(ray);
        Jolt.destroy(raySettings);
        Jolt.destroy(bpFilter);
        Jolt.destroy(objectFilter);
        Jolt.destroy(bodyFilter);
        Jolt.destroy(shapeFilter);
        Jolt.destroy(hitCollector);
        Jolt.destroy(tempVec3);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { api, cleanup } = init();
    setApi(api);
    return cleanup;
  }, [init]);

  return [api] as [
    {
      ray: Jolt.RRayCast;
      cast: (
        origin?: Vector3,
        direction?: Vector3
      ) => {
        collector: Jolt.CastRayClosestHitCollisionCollector;
        distance: number;
        hit: boolean;
      };
    }
  ];
};
