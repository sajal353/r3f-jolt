import { SphereGeometry } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";

export interface UseSphereOptions extends BodyOptions {
  radius: number;
  segments?: number;
}

export const useSphere = (options: UseSphereOptions) => {
  const { radius, segments = 32 } = options;

  return useBody<Jolt.SphereShape>(
    (jolt) => ({
      shape: finishShape(new jolt.SphereShape(radius, undefined)),
      geometry: new SphereGeometry(radius, segments, segments),
    }),
    options,
    "sphere",
  );
};
