import { BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
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
    (jolt) => {
      let shape: Jolt.EmptyShape;

      if (centerOfMass) {
        const centre = new jolt.Vec3(
          centerOfMass[0],
          centerOfMass[1],
          centerOfMass[2],
        );
        shape = new jolt.EmptyShape(centre);
        jolt.destroy(centre);
      } else {
        shape = new jolt.EmptyShape();
      }

      // Jolt gives an empty shape mass 1 and an identity inertia, so a dynamic
      // one falls sensibly rather than tripping a zero-volume assert.
      return { shape: finishShape(shape), geometry: new BufferGeometry() };
    },
    options,
    "empty",
  );
};
