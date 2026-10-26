import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  type BufferGeometry,
} from "three";
import { useSoftBody, type SoftBodyApi } from "@/Jolt/useSoftBody";
import type { Vec3Tuple } from "@/Jolt/types";

const STRIPES = ["#e74c3c", "#f1c40f", "#3498db", "#ecf0f1", "#2ecc71", "#e67e22"];

/** Segments by longitude, as a beach ball's panels run. */
const paintStripes = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  const paint = new Float32Array(position.count * 3);
  const swatches = STRIPES.map((color) => new Color(color));

  for (let index = 0; index < position.count; index += 1) {
    const turn =
      (Math.atan2(position.getZ(index), position.getX(index)) + Math.PI) /
      (2 * Math.PI);
    const stripe = Math.min(STRIPES.length - 1, Math.floor(turn * STRIPES.length));
    swatches[stripe].toArray(paint, index * 3);
  }

  geometry.setAttribute("color", new BufferAttribute(paint, 3));
  return geometry;
};

/**
 * An inflatable: a closed mesh held round by `pressure`. An icosphere rather
 * than a UV sphere, whose poles fan a dozen sliver triangles into one vertex
 * that never stops trembling.
 */
export const BeachBall = ({
  position,
  floats,
  onCreate,
}: {
  position: Vec3Tuple;
  /** A beach ball is mostly air: it rides almost entirely above the water. */
  floats?: number;
  /** Returns its own cleanup, run when the ball goes away. */
  onCreate?: (api: SoftBodyApi) => () => void;
}) => {
  const geometry = useMemo(
    () => paintStripes(new IcosahedronGeometry(0.6, 4)),
    [],
  );

  const [ref, api] = useSoftBody(geometry, {
    position,
    pressure: 60,
    mass: 1,
    // Bounce on a resting contact keeps every vertex trembling.
    restitution: 0,
    friction: 0.4,
    floats,
  });

  useEffect(() => {
    if (api && onCreate) return onCreate(api);
  }, [api, onCreate]);

  return (
    <mesh ref={ref} geometry={api?.geometry} castShadow>
      <meshStandardMaterial vertexColors roughness={0.4} />
    </mesh>
  );
};
