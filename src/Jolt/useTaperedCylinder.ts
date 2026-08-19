import { CylinderGeometry } from "three";
import type Jolt from "jolt-physics";
import {
  shapeFromResultAs,
  useBody,
  type BodyOptions,
} from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import { defaultConvexRadius } from "./useBox";

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
  const { topRadius, bottomRadius, height, convexRadius, renderSegments = 24 } =
    options;

  return useBody<Jolt.TaperedCylinderShape>(
    (jolt) => {
      // A cone's tip has no room for a rounded edge, so the default follows the
      // smaller radius down to zero.
      const radius =
        convexRadius ??
        defaultConvexRadius([topRadius, bottomRadius, height * 0.5]);

      const settings = new jolt.TaperedCylinderShapeSettings(
        height * 0.5,
        topRadius,
        bottomRadius,
        radius,
        undefined,
      );
      const result = settings.Create();
      jolt.destroy(settings);

      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.TaperedCylinderShape,
        "useTaperedCylinder",
      );

      return {
        shape,
        geometry: new CylinderGeometry(
          topRadius,
          bottomRadius,
          height,
          renderSegments,
        ),
        // Jolt rounds the rim by the convex radius and the render cylinder does
        // not, so debug draws the collider's own triangulation.
        debugGeometry: () => shapeToGeometry(jolt, shape),
      };
    },
    options,
    "taperedCylinder",
  );
};
