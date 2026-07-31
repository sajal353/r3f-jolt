import { BoxGeometry } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
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
      const halfExtent = new jolt.Vec3(
        size[0] * 0.5,
        size[1] * 0.5,
        size[2] * 0.5,
      );
      const shape = new jolt.BoxShape(
        halfExtent,
        convexRadius ?? defaultConvexRadius([size[0], size[1], size[2]]),
        undefined,
      );
      jolt.destroy(halfExtent);

      return {
        shape: finishShape(shape),
        geometry: new BoxGeometry(size[0], size[1], size[2]),
      };
    },
    options,
    "box",
  );
};
