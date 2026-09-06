import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";
import type { Vec3Tuple } from "./types";

export interface UseEmptyOptions extends BodyOptions {
  /** Where the body pivots, in body-local space. Defaults to its origin. */
  centerOfMass?: Vec3Tuple;
}

/**
 * A body with no collision at all. It moves, sleeps, carries velocity and can be
 * jointed to — it simply never touches anything. That makes it the anchor for a
 * joint that has to move, where a one-sided constraint would bolt to the world,
 * and a place in the physics world for a marker or an attachment socket.
 *
 * `api.geometry` is empty. Bring your own mesh if it should be visible.
 */
export const useEmpty = (options: UseEmptyOptions) => {
  const { centerOfMass } = options;

  return useBody<Jolt.EmptyShape>(
    (jolt) => createColliderShape(jolt, { type: "empty", centerOfMass }),
    options,
    "empty",
  );
};
