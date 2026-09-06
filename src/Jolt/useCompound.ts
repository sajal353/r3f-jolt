import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";
import type { CompoundChild } from "./internal/colliderShape";

export type { CompoundChild };

export interface UseCompoundOptions extends BodyOptions {
  shapes: CompoundChild[];
}

export const useCompound = (options: UseCompoundOptions) => {
  const { shapes } = options;

  return useBody<Jolt.Shape>(
    (jolt) => createColliderShape(jolt, { type: "compound", shapes }),
    options,
    "compound",
  );
};
