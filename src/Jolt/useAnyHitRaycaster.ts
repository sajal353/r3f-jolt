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

export type UseAnyHitRaycasterOptions = RaycasterOptions;

export interface AnyHitRaycasterApi {
  ray: Jolt.RRayCast;
  collector: Jolt.CastRayAnyHitCollisionCollector;
  cast: (origin?: Vec3Input, direction?: Vec3Input) => RaycastHit;
}

/**
 * The cheapest of the three: Jolt stops at the first hit rather than comparing
 * fractions, so the hit it reports is whichever the traversal met first, not the
 * nearest. Use it for line-of-sight and "is anything in the way" questions.
 */
export const useAnyHitRaycaster = (options: UseAnyHitRaycasterOptions = {}) => {
  const api = useJolt();
  const [raycaster, setRaycaster] = useState<AnyHitRaycasterApi>();

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

    const collector = new jolt.CastRayAnyHitCollisionCollector();
    const result = createHit();

    const cast = (nextOrigin?: Vec3Input, nextDirection?: Vec3Input) => {
      if (state.disposed) return result;

      context.aim(nextOrigin, nextDirection);
      context.cast(collector);
      context.clear(result);

      return collector.HadHit() ? context.fill(result, collector.mHit) : result;
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

  return [raycaster] as [AnyHitRaycasterApi | undefined];
};
