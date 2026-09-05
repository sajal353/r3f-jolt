import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";

export interface UseCylinderOptions extends BodyOptions {
  height: number;
  radius: number;
  convexRadius?: number;
  segments?: number;
}

export const useCylinder = (options: UseCylinderOptions) => {
  const { height, radius, convexRadius, segments } = options;

  return useBody<Jolt.CylinderShape>(
    (jolt) =>
      createColliderShape(jolt, {
        type: "cylinder",
        height,
        radius,
        convexRadius,
        segments,
      }),
    options,
    "cylinder",
  );
};
