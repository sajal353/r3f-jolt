import { CylinderGeometry } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
import { defaultConvexRadius } from "./useBox";

export interface UseCylinderOptions extends BodyOptions {
  height: number;
  radius: number;
  convexRadius?: number;
  segments?: number;
}

export const useCylinder = (options: UseCylinderOptions) => {
  const { height, radius, convexRadius, segments = 32 } = options;

  return useBody<Jolt.CylinderShape>(
    (jolt) => ({
      shape: finishShape(
        new jolt.CylinderShape(
          height * 0.5,
          radius,
          convexRadius ?? defaultConvexRadius([height, radius * 2]),
          undefined,
        ),
      ),
      geometry: new CylinderGeometry(radius, radius, height, segments),
    }),
    options,
    "cylinder",
  );
};
