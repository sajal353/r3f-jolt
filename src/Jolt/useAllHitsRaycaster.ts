import { useEffect, useState } from "react";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  createHit,
  createRaycastContext,
  type RaycastHit,
  type RaycasterOptions,
} from "./internal/raycast";
import type { Vec3Input } from "./types";

export type UseAllHitsRaycasterOptions = RaycasterOptions;

export interface AllHitsRaycasterApi {
  ray: Jolt.RRayCast;
  collector: Jolt.CastRayAllHitCollisionCollector;
  cast: (origin?: Vec3Input, direction?: Vec3Input) => RaycastHit[];
}

/**
 * Every body along the ray, nearest first. The returned array and the hits in it
 * are reused between casts, so copy anything you need to keep.
 */
export const useAllHitsRaycaster = (
  options: UseAllHitsRaycasterOptions = {},
) => {
  const api = useJolt();
  const [raycaster, setRaycaster] = useState<AllHitsRaycasterApi>();

  const [mount] = useState(() => options);

  useEffect(() => {
    const { Jolt: jolt, layers, state } = api;
    const {
      origin = [0, 0, 0],
      direction = [0, -1, 0],
      layer = layers.LAYER_MOVING,
    } = mount;

    const context = createRaycastContext(api, layer);
    context.aim(origin, direction);

    const collector = new jolt.CastRayAllHitCollisionCollector();
    const pool: RaycastHit[] = [];
    const results: RaycastHit[] = [];

    const cast = (nextOrigin?: Vec3Input, nextDirection?: Vec3Input) => {
      results.length = 0;
      if (state.disposed) return results;

      context.aim(nextOrigin, nextDirection);
      context.cast(collector);

      if (!collector.HadHit()) return results;

      // Jolt collects in traversal order; sorting is what makes "nearest first"
      // true rather than usually-true.
      collector.Sort();

      const hits = collector.mHits;
      for (let i = 0; i < hits.size(); i += 1) {
        if (pool.length <= i) pool.push(createHit());
        results.push(context.fill(pool[i], hits.at(i)));
      }

      return results;
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRaycaster({ ray: context.ray, collector, cast });

    return () => {
      setRaycaster(undefined);

      if (state.destroyed) return;

      jolt.destroy(collector);
      context.destroy();
    };
  }, [api, mount]);

  return [raycaster] as [AllHitsRaycasterApi | undefined];
};
