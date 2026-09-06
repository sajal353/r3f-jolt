import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";

export interface UseCapsuleOptions extends BodyOptions {
  height: number;
  radius: number;
  segments?: number;
}

export const useCapsule = (options: UseCapsuleOptions) => {
  const { height, radius, segments } = options;

  return useBody<Jolt.CapsuleShape>(
    (jolt) =>
      createColliderShape(jolt, { type: "capsule", height, radius, segments }),
    options,
    "capsule",
  );
};
