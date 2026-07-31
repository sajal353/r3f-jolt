import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import { defaultConvexRadius } from "./useBox";
import type { JoltModule, QuatTuple, Vec3Tuple } from "./types";

export type CompoundChild =
  | { type: "box"; position: Vec3Tuple; rotation?: QuatTuple; size: Vec3Tuple; convexRadius?: number }
  | { type: "sphere"; position: Vec3Tuple; rotation?: QuatTuple; radius: number }
  | { type: "capsule"; position: Vec3Tuple; rotation?: QuatTuple; height: number; radius: number }
  | {
      type: "cylinder";
      position: Vec3Tuple;
      rotation?: QuatTuple;
      height: number;
      radius: number;
      convexRadius?: number;
    }
  | {
      type: "taperedCapsule";
      position: Vec3Tuple;
      rotation?: QuatTuple;
      height: number;
      topRadius: number;
      bottomRadius: number;
    }
  | { type: "convex"; position: Vec3Tuple; rotation?: QuatTuple; vertices: number[][] };

export interface UseCompoundOptions extends BodyOptions {
  shapes: CompoundChild[];
}

const createChildSettings = (
  jolt: JoltModule,
  child: CompoundChild,
): Jolt.ShapeSettings => {
  switch (child.type) {
    case "box": {
      const halfExtent = new jolt.Vec3(
        child.size[0] * 0.5,
        child.size[1] * 0.5,
        child.size[2] * 0.5,
      );
      const settings = new jolt.BoxShapeSettings(
        halfExtent,
        child.convexRadius ?? defaultConvexRadius(child.size),
        undefined,
      );
      jolt.destroy(halfExtent);
      return settings;
    }
    case "sphere":
      return new jolt.SphereShapeSettings(child.radius, undefined);
    case "capsule":
      return new jolt.CapsuleShapeSettings(
        child.height * 0.5,
        child.radius,
        undefined,
      );
    case "cylinder":
      return new jolt.CylinderShapeSettings(
        child.height * 0.5,
        child.radius,
        child.convexRadius ??
          defaultConvexRadius([child.height, child.radius * 2]),
        undefined,
      );
    case "taperedCapsule":
      return new jolt.TaperedCapsuleShapeSettings(
        child.height * 0.5,
        child.topRadius,
        child.bottomRadius,
        undefined,
      );
    case "convex": {
      const settings = new jolt.ConvexHullShapeSettings();
      const point = new jolt.Vec3();

      for (const vertex of child.vertices) {
        point.Set(vertex[0], vertex[1], vertex[2]);
        settings.mPoints.push_back(point);
      }

      jolt.destroy(point);
      return settings;
    }
  }
};

const describeInvalid = (child: CompoundChild): string | null => {
  switch (child.type) {
    case "box":
      return child.size ? null : "`size` is required";
    case "sphere":
      return child.radius !== undefined ? null : "`radius` is required";
    case "capsule":
    case "cylinder":
      return child.height !== undefined && child.radius !== undefined
        ? null
        : "`height` and `radius` are required";
    case "taperedCapsule":
      return child.height !== undefined &&
        child.topRadius !== undefined &&
        child.bottomRadius !== undefined
        ? null
        : "`height`, `topRadius` and `bottomRadius` are required";
    case "convex":
      return child.vertices?.length ? null : "`vertices` is required";
    default:
      return "unknown shape type";
  }
};

export const useCompound = (options: UseCompoundOptions) => {
  const { shapes } = options;

  return useBody<Jolt.Shape>(
    (jolt) => {
      const compound = new jolt.StaticCompoundShapeSettings();
      const position = new jolt.Vec3();
      const rotation = new jolt.Quat();

      for (const [index, child] of shapes.entries()) {
        const problem = describeInvalid(child);

        if (problem) {
          console.error(
            `[r3f-jolt] useCompound: skipping child ${index} (${child.type}) — ${problem}.`,
          );
          continue;
        }

        position.Set(child.position[0], child.position[1], child.position[2]);
        rotation.Set(
          child.rotation?.[0] ?? 0,
          child.rotation?.[1] ?? 0,
          child.rotation?.[2] ?? 0,
          child.rotation?.[3] ?? 1,
        );

        compound.AddShape(
          position,
          rotation,
          createChildSettings(jolt, child),
          0,
        );
      }

      jolt.destroy(position);
      jolt.destroy(rotation);

      const result = compound.Create();
      const shape = finishShape(result.Get());
      result.Clear();

      // AddShape takes a reference to each child, so destroying the compound
      // releases them. Destroying a child by hand is a double free.
      jolt.destroy(compound);

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    options,
    "compound",
  );
};
