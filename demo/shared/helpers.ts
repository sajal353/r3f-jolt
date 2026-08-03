import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  type ColorRepresentation,
  type Vector3,
} from "three";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

/**
 * Axis-angle as a quaternion. Bodies dropped perfectly upright land perfectly
 * upright and nothing interesting happens, so most scenes here start their
 * shapes on a tilt.
 */
export const tilt = (axis: Vec3Tuple, radians: number): QuatTuple => {
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const sine = Math.sin(radians * 0.5) / length;

  return [
    axis[0] * sine,
    axis[1] * sine,
    axis[2] * sine,
    Math.cos(radians * 0.5),
  ];
};

export interface Beam {
  object: Line;
  set: (from: Vector3, to: Vector3) => void;
  setColor: (color: ColorRepresentation) => void;
}

/**
 * A two-point line whose ends move every frame. Rays are the one thing a query
 * scene most needs to show and the one thing physics cannot draw for you, so
 * this is deliberately imperative — rebuilding the geometry through React on
 * every cast would cost more than the cast.
 */
export const useBeam = (color: ColorRepresentation): Beam => {
  const beam = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(6), 3),
    );

    const material = new LineBasicMaterial({ color });
    const object = new Line(geometry, material);

    // Both ends move, so the bounding sphere computed at creation is a lie.
    object.frustumCulled = false;

    return {
      object,
      set: (from: Vector3, to: Vector3) => {
        const positions = geometry.attributes.position;
        positions.setXYZ(0, from.x, from.y, from.z);
        positions.setXYZ(1, to.x, to.y, to.z);
        positions.needsUpdate = true;
      },
      setColor: (next: ColorRepresentation) => material.color.set(next),
    };
  }, [color]);

  useEffect(
    () => () => {
      beam.object.geometry.dispose();
      (beam.object.material as LineBasicMaterial).dispose();
    },
    [beam],
  );

  return beam;
};
