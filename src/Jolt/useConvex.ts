import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";

export interface UseConvexOptions extends BodyOptions {
  vertices: number[][];
}

export const useConvex = (options: UseConvexOptions) => {
  const { vertices } = options;

  return useBody<Jolt.Shape>(
    (jolt) => {
      const settings = new jolt.ConvexHullShapeSettings();
      const point = new jolt.Vec3();

      for (const vertex of vertices) {
        point.Set(vertex[0], vertex[1], vertex[2]);
        settings.mPoints.push_back(point);
      }

      jolt.destroy(point);

      const result = settings.Create();
      const shape = finishShape(result.Get());
      result.Clear();
      jolt.destroy(settings);

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    options,
    "convex",
  );
};
