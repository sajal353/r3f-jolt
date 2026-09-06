import { useRef } from "react";
import { Mesh, Vector3, type BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import { useBody, type BodyOptions } from "./internal/useBody";
import { createChildShape } from "./internal/colliderShape";
import { createTrimeshShape } from "./internal/trimeshShape";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import type { CompoundChild } from "./internal/colliderShape";
import type { JoltModule, Vec3Tuple } from "./types";

/**
 * `"box"` and `"sphere"` come from the geometry's own bounds, `"hull"` from its
 * points, `"trimesh"` from its triangles. A trimesh is static-only in Jolt, so a
 * dynamic body wants a hull.
 */
export type AutoColliderKind = "box" | "sphere" | "hull" | "trimesh";

export interface UseAutoColliderOptions extends BodyOptions {
  collider?: AutoColliderKind;
}

const NEARLY_UNIFORM = 1e-4;

const readMesh = (mesh: Mesh | null) => {
  if (!mesh) {
    throw new Error(
      "[r3f-jolt] useAutoCollider: the ref was never attached to a mesh. Put it " +
        "on the `<mesh>` this hook is for.",
    );
  }

  const geometry = mesh.geometry;

  if (!geometry?.getAttribute("position")) {
    throw new Error(
      "[r3f-jolt] useAutoCollider: the mesh has no geometry with a position " +
        "attribute yet. A geometry that arrives later needs `key` to rebuild the body.",
    );
  }

  return { mesh, geometry };
};

const scaledPoints = (geometry: BufferGeometry, scale: Vector3) => {
  const position = geometry.getAttribute("position");
  const points: number[][] = [];

  for (let i = 0; i < position.count; i += 1) {
    points.push([
      position.getX(i) * scale.x,
      position.getY(i) * scale.y,
      position.getZ(i) * scale.z,
    ]);
  }

  return points;
};

const boxChild = (geometry: BufferGeometry, scale: Vector3): CompoundChild => {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  if (!box) {
    throw new Error("[r3f-jolt] useAutoCollider: the geometry has no bounds.");
  }

  const size: Vec3Tuple = [
    Math.max((box.max.x - box.min.x) * scale.x, 1e-4),
    Math.max((box.max.y - box.min.y) * scale.y, 1e-4),
    Math.max((box.max.z - box.min.z) * scale.z, 1e-4),
  ];

  const position: Vec3Tuple = [
    ((box.max.x + box.min.x) * 0.5) * scale.x,
    ((box.max.y + box.min.y) * 0.5) * scale.y,
    ((box.max.z + box.min.z) * 0.5) * scale.z,
  ];

  return { type: "box", position, size };
};

const sphereChild = (
  geometry: BufferGeometry,
  scale: Vector3,
): CompoundChild => {
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;

  if (!sphere) {
    throw new Error("[r3f-jolt] useAutoCollider: the geometry has no bounds.");
  }

  const largest = Math.max(scale.x, scale.y, scale.z);
  const smallest = Math.min(scale.x, scale.y, scale.z);

  // A sphere cannot be scaled non-uniformly, so say which number was used
  // rather than quietly picking one.
  if (largest - smallest > NEARLY_UNIFORM) {
    console.warn(
      `[r3f-jolt] useAutoCollider: a sphere collider cannot take the mesh's ` +
        `non-uniform scale (${scale.x}, ${scale.y}, ${scale.z}); using the largest ` +
        `axis, ${largest}. Use "hull" for a squashed shape.`,
    );
  }

  return {
    type: "sphere",
    radius: Math.max(sphere.radius * largest, 1e-4),
    position: [
      sphere.center.x * scale.x,
      sphere.center.y * scale.y,
      sphere.center.z * scale.z,
    ],
  };
};

const buildShape = (
  jolt: JoltModule,
  geometry: BufferGeometry,
  scale: Vector3,
  kind: AutoColliderKind,
): Jolt.Shape => {
  if (kind === "trimesh") {
    const uniform =
      Math.abs(scale.x - 1) < NEARLY_UNIFORM &&
      Math.abs(scale.y - 1) < NEARLY_UNIFORM &&
      Math.abs(scale.z - 1) < NEARLY_UNIFORM;

    if (uniform) {
      return createTrimeshShape(jolt, { mesh: geometry }, "useAutoCollider");
    }

    // Jolt bakes the vertices into the tree, so the scale has to be applied
    // before the build rather than wrapped around it afterwards.
    const scaled = geometry.clone().scale(scale.x, scale.y, scale.z);
    const shape = createTrimeshShape(jolt, { mesh: scaled }, "useAutoCollider");
    scaled.dispose();
    return shape;
  }

  if (kind === "hull") {
    return createChildShape(
      jolt,
      {
        type: "convex",
        position: [0, 0, 0],
        vertices: scaledPoints(geometry, scale),
      },
      "useAutoCollider",
    );
  }

  const child =
    kind === "sphere"
      ? sphereChild(geometry, scale)
      : boxChild(geometry, scale);

  return createChildShape(jolt, child, "useAutoCollider");
};

/**
 * A body whose collider is read off the mesh it is attached to, so the size is
 * written once — in the JSX — instead of once there and once in the hook, where
 * the two drift apart silently.
 *
 * The mesh's own `scale` is applied to the collider. Everything else is an
 * ordinary body: the whole of `BodyOptions` and the whole of `BodyApi`.
 *
 * Read at mount, like every other hook. A geometry that changes afterwards needs
 * `key` to rebuild the body.
 */
export const useAutoCollider = (options: UseAutoColliderOptions) => {
  const { collider = "box" } = options;
  const ref = useRef<Mesh | null>(null);

  return useBody<Jolt.Shape>(
    (jolt) => {
      const { mesh, geometry } = readMesh(ref.current);

      if (collider === "trimesh" && options.motionType !== "static") {
        console.warn(
          "[r3f-jolt] useAutoCollider: Jolt only allows a trimesh collider on a " +
            'static body. Use "hull" for one that moves.',
        );
      }

      const shape = buildShape(jolt, geometry, mesh.scale, collider);
      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    options,
    collider === "hull" ? "convex" : collider,
    undefined,
    ref,
  );
};
