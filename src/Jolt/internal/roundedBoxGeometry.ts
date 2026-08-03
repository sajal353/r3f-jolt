import { BoxGeometry, type BufferGeometry } from "three";
import type { Vec3Tuple } from "../types";

const SEGMENTS = 4;

const clamp = (value: number, limit: number) =>
  value < -limit ? -limit : value > limit ? limit : value;

/**
 * The collider Jolt builds for a box is the Minkowski sum of a shrunken box and
 * a sphere of `convexRadius`, so its edges and corners are rounded. Jolt's own
 * triangulation reports the sharp box whatever the radius, which would leave a
 * debug view drawing a shape the simulation is not using. This builds the real
 * surface: every vertex is pushed out from the shrunken box by the radius, and
 * the direction it moved in is its normal.
 */
export const roundedBoxGeometry = (
  size: Vec3Tuple,
  convexRadius: number,
): BufferGeometry => {
  const geometry = new BoxGeometry(
    size[0],
    size[1],
    size[2],
    SEGMENTS,
    SEGMENTS,
    SEGMENTS,
  );

  const halfX = size[0] * 0.5;
  const halfY = size[1] * 0.5;
  const halfZ = size[2] * 0.5;
  const radius = Math.min(convexRadius, halfX, halfY, halfZ);

  if (!(radius > 0)) return geometry;

  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    const innerX = clamp(x, halfX - radius);
    const innerY = clamp(y, halfY - radius);
    const innerZ = clamp(z, halfZ - radius);

    const dx = x - innerX;
    const dy = y - innerY;
    const dz = z - innerZ;

    // Every box vertex sits on a face, so at least one axis is a full half
    // extent out and this length is never below the radius.
    const length = Math.hypot(dx, dy, dz);

    positions.setXYZ(
      i,
      innerX + (dx / length) * radius,
      innerY + (dy / length) * radius,
      innerZ + (dz / length) * radius,
    );
    normals.setXYZ(i, dx / length, dy / length, dz / length);
  }

  return geometry;
};
