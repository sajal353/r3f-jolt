import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";

export interface UseSphereOptions extends BodyOptions {
  radius: number;
  segments?: number;
}

export const useSphere = (options: UseSphereOptions) => {
  const { radius, segments } = options;

  return useBody<Jolt.SphereShape>(
    (jolt) => createColliderShape(jolt, { type: "sphere", radius, segments }),
    options,
    "sphere",
  );
};
