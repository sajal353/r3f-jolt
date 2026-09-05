import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";

export interface UseTaperedCylinderOptions extends BodyOptions {
  topRadius: number;
  bottomRadius: number;
  height: number;
  convexRadius?: number;
  /** Sides on the render mesh only. The collider is analytic. */
  renderSegments?: number;
}

/**
 * A cylinder with two radii — and, with one at zero, a cone. Flat ends are what
 * separate it from `useTaperedCapsule`: this stands where that one rolls.
 */
export const useTaperedCylinder = (options: UseTaperedCylinderOptions) => {
  const { topRadius, bottomRadius, height, convexRadius, renderSegments } =
    options;

  return useBody<Jolt.TaperedCylinderShape>(
    (jolt) =>
      createColliderShape(jolt, {
        type: "taperedCylinder",
        topRadius,
        bottomRadius,
        height,
        convexRadius,
        renderSegments,
      }),
    options,
    "taperedCylinder",
  );
};
