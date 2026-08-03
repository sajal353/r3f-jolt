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

export type { RaycastHit };

export type UseClosestHitRaycasterOptions = RaycasterOptions;

export interface ClosestHitRaycasterApi {
  ray: Jolt.RRayCast;
  collector: Jolt.CastRayClosestHitCollisionCollector;
  cast: (origin?: Vec3Input, direction?: Vec3Input) => RaycastHit;
}

export const useClosestHitRaycaster = (
  options: UseClosestHitRaycasterOptions = {},
) => {
  const api = useJolt();
  const [raycaster, setRaycaster] = useState<ClosestHitRaycasterApi>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
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

    const collector = new jolt.CastRayClosestHitCollisionCollector();
    const result = createHit();

    const cast = (nextOrigin?: Vec3Input, nextDirection?: Vec3Input) => {
      if (state.disposed) return result;

      context.aim(nextOrigin, nextDirection);
      context.cast(collector);
      context.clear(result);

      return collector.HadHit() ? context.fill(result, collector.mHit) : result;
    };

    // Same external-resource publication as `useCar`, and exempt for the same
    // reason there: no ref in the published value, so the rule's
    // ref-derived-setState exemption does not cover it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRaycaster({ ray: context.ray, collector, cast });

    return () => {
      setRaycaster(undefined);

      if (state.destroyed) return;

      jolt.destroy(collector);
      context.destroy();
    };
  }, [api, mount]);

  return [raycaster] as [ClosestHitRaycasterApi | undefined];
};
