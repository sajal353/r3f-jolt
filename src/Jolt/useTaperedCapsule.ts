import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";

export interface UseTaperedCapsuleOptions extends BodyOptions {
  topRadius: number;
  bottomRadius: number;
  height: number;
}

export const useTaperedCapsule = (options: UseTaperedCapsuleOptions) => {
  const { topRadius, bottomRadius, height } = options;

  return useBody<Jolt.Shape>(
    (jolt) =>
      createColliderShape(jolt, {
        type: "taperedCapsule",
        topRadius,
        bottomRadius,
        height,
      }),
    options,
    "taperedCapsule",
  );
};
