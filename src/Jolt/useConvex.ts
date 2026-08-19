import type Jolt from "jolt-physics";
import {
  shapeFromResultAs,
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import {
  createShapeMaterialApi,
  type ShapeMaterialApi,
} from "./internal/shapeMaterial";

export interface UseConvexOptions extends BodyOptions {
  vertices: number[][];
}

export type ConvexApi = ShapeMaterialApi;

export const useConvex = (options: UseConvexOptions) => {
  const { vertices } = options;

  return useBody<Jolt.ConvexShape, ConvexApi>(
    (jolt) => {
      const settings = new jolt.ConvexHullShapeSettings();
      const point = new jolt.Vec3();

      for (const vertex of vertices) {
        point.Set(vertex[0], vertex[1], vertex[2]);
        settings.mPoints.push_back(point);
      }

      jolt.destroy(point);

      const result = settings.Create();
      jolt.destroy(settings);
      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.ConvexShape,
        "useConvex",
      );

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    options,
    "convex",
    ({ jolt, shape }: BodyApiContext<Jolt.ConvexShape>) =>
      createShapeMaterialApi(jolt, shape),
  );
};
