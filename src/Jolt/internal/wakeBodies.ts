import type Jolt from "jolt-physics";
import type { JoltModule, Vec3Tuple } from "../types";

export interface BoundsBox {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

/** Further than a resting body's gap, so one just clear of the surface counts. */
const MARGIN = 0.1;

export const readBounds = (body: Jolt.Body): BoundsBox => {
  const bounds = body.GetWorldSpaceBounds();
  const { mMin: min, mMax: max } = bounds;

  return {
    min: [min.GetX(), min.GetY(), min.GetZ()],
    max: [max.GetX(), max.GetY(), max.GetZ()],
  };
};

export const unionBounds = (a: BoundsBox, b: BoundsBox): BoundsBox => ({
  min: [
    Math.min(a.min[0], b.min[0]),
    Math.min(a.min[1], b.min[1]),
    Math.min(a.min[2], b.min[2]),
  ],
  max: [
    Math.max(a.max[0], b.max[0]),
    Math.max(a.max[1], b.max[1]),
    Math.max(a.max[2], b.max[2]),
  ],
});

/**
 * For a shape that just changed under whatever rests on it. Jolt only wakes a
 * sleeping body when something touches it, and ground that dropped away touches
 * nothing, so without this a body stays in the air until disturbed.
 */
export const wakeBodiesIn = (
  jolt: JoltModule,
  bodyInterface: Jolt.BodyInterface,
  { min, max }: BoundsBox,
) => {
  const low = new jolt.Vec3(min[0] - MARGIN, min[1] - MARGIN, min[2] - MARGIN);
  const high = new jolt.Vec3(max[0] + MARGIN, max[1] + MARGIN, max[2] + MARGIN);
  const box = new jolt.AABox(low, high);
  const layers = new jolt.BroadPhaseLayerFilter();
  const objects = new jolt.ObjectLayerFilter();

  bodyInterface.ActivateBodiesInAABox(box, layers, objects);

  jolt.destroy(objects);
  jolt.destroy(layers);
  jolt.destroy(box);
  jolt.destroy(high);
  jolt.destroy(low);
};
