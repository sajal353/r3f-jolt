import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";
import type { Vec3Tuple } from "./types";

export interface UseBoxOptions extends BodyOptions {
  size: Vec3Tuple;
  convexRadius?: number;
}

export const useBox = (options: UseBoxOptions) => {
  const { size, convexRadius } = options;

  return useBody<Jolt.BoxShape>(
    (jolt) => createColliderShape(jolt, { type: "box", size, convexRadius }),
    options,
    "box",
  );
};
