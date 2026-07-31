import { CapsuleGeometry } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";

export interface UseCapsuleOptions extends BodyOptions {
  height: number;
  radius: number;
  segments?: number;
}

export const useCapsule = (options: UseCapsuleOptions) => {
  const { height, radius, segments = 32 } = options;

  return useBody<Jolt.CapsuleShape>(
    (jolt) => ({
      shape: finishShape(
        new jolt.CapsuleShape(height * 0.5, radius, undefined),
      ),
      geometry: new CapsuleGeometry(radius, height, 8, segments),
    }),
    options,
    "capsule",
  );
};
