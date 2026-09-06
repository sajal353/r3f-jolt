import type Jolt from "jolt-physics";
import {
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";
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
    (jolt) => createColliderShape(jolt, { type: "convex", vertices }),
    options,
    "convex",
    ({ jolt, shape }: BodyApiContext<Jolt.ConvexShape>) =>
      createShapeMaterialApi(jolt, shape),
  );
};
