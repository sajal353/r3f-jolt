import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";

export interface UseTaperedCapsuleOptions extends BodyOptions {
  topRadius: number;
  bottomRadius: number;
  height: number;
}

export const useTaperedCapsule = (options: UseTaperedCapsuleOptions) => {
  const { topRadius, bottomRadius, height } = options;

  return useBody<Jolt.Shape>(
    (jolt) => {
      const settings = new jolt.TaperedCapsuleShapeSettings(
        height * 0.5,
        topRadius,
        bottomRadius,
        undefined,
      );
      const result = settings.Create();
      const shape = finishShape(result.Get());
      result.Clear();
      jolt.destroy(settings);

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    options,
    "taperedCapsule",
  );
};
