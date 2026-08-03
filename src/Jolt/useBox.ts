import { BoxGeometry } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
import { roundedBoxGeometry } from "./internal/roundedBoxGeometry";
import type { Vec3Tuple } from "./types";

export interface UseBoxOptions extends BodyOptions {
  size: Vec3Tuple;
  convexRadius?: number;
}

export const defaultConvexRadius = (extents: number[]) =>
  Math.min(0.05, Math.min(...extents) * 0.1);

export const useBox = (options: UseBoxOptions) => {
  const { size, convexRadius } = options;

  return useBody<Jolt.BoxShape>(
    (jolt) => {
      const radius =
        convexRadius ?? defaultConvexRadius([size[0], size[1], size[2]]);
      const halfExtent = new jolt.Vec3(
        size[0] * 0.5,
        size[1] * 0.5,
        size[2] * 0.5,
      );
      const shape = new jolt.BoxShape(halfExtent, radius, undefined);
      jolt.destroy(halfExtent);

      return {
        shape: finishShape(shape),
        geometry: new BoxGeometry(size[0], size[1], size[2]),
        // Jolt's own triangulation reports the sharp box whatever the convex
        // radius is, so debug would otherwise draw square edges on a collider
        // that has none.
        debugGeometry: () => roundedBoxGeometry(size, radius),
      };
    },
    options,
    "box",
  );
};
