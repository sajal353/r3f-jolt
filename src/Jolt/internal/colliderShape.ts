import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferAttribute,
} from "three";
import type Jolt from "jolt-physics";
import { finishShape, shapeFromResult, shapeFromResultAs } from "./useBody";
import type { ShapeResult } from "./useBody";
import { shapeToGeometry } from "./shapeToGeometry";
import { roundedBoxGeometry } from "./roundedBoxGeometry";
import { createTrimeshShape } from "./trimeshShape";
import type { TrimeshBuildQuality, TrimeshSource } from "./trimeshShape";
import type { JoltModule, QuatTuple, Vec3Tuple } from "../types";

/**
 * Small enough not to change how a shape behaves, large enough for the solver to
 * find a contact early. Scaled to the shape rather than fixed, because 5 cm of
 * rounding on a 10 cm box is most of the box.
 */
export const defaultConvexRadius = (extents: number[]) =>
  Math.min(0.05, Math.min(...extents) * 0.1);

export type CompoundChild =
  | {
      type: "box";
      position: Vec3Tuple;
      rotation?: QuatTuple;
      size: Vec3Tuple;
      convexRadius?: number;
    }
  | {
      type: "sphere";
      position: Vec3Tuple;
      rotation?: QuatTuple;
      radius: number;
    }
  | {
      type: "capsule";
      position: Vec3Tuple;
      rotation?: QuatTuple;
      height: number;
      radius: number;
    }
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
  | {
      type: "convex";
      position: Vec3Tuple;
      rotation?: QuatTuple;
      vertices: number[][];
    };

export const createChildSettings = (
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

/**
 * Jolt refuses a shape built from a zero or negative dimension, and the whole
 * compound fails with it — so a child is checked for a usable number, not merely
 * a present one, and skipped before it can take the rest of the body down.
 */
const measures = (child: CompoundChild): Record<string, unknown> | null => {
  switch (child.type) {
    case "box":
      return {
        "size[0]": child.size?.[0],
        "size[1]": child.size?.[1],
        "size[2]": child.size?.[2],
      };
    case "sphere":
      return { radius: child.radius };
    case "capsule":
    case "cylinder":
      return { height: child.height, radius: child.radius };
    case "taperedCapsule":
      return {
        height: child.height,
        topRadius: child.topRadius,
        bottomRadius: child.bottomRadius,
      };
    case "convex":
      return {};
    default:
      return null;
  }
};

const describeInvalidChild = (child: CompoundChild): string | null => {
  const dimensions = measures(child);

  if (!dimensions) return "unknown shape type";

  if (child.type === "convex") {
    return child.vertices?.length ? null : "`vertices` is required";
  }

  for (const [name, value] of Object.entries(dimensions)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return `\`${name}\` must be a positive number, received ${String(value)}`;
    }
  }

  return null;
};

/**
 * One compound child, built as a shape in its own right. A child carrying a
 * position or rotation is wrapped in a `RotatedTranslatedShape`, which is how a
 * collider ends up somewhere other than its body's origin — the case a mesh
 * modelled with its feet at zero needs, and the one that otherwise looks like a
 * physics bug.
 *
 * `RotatedTranslatedShapeSettings` takes a **`ShapeSettings`**, not a `Shape`,
 * so the inner primitive is built through `createChildSettings` rather than
 * `new`.
 */
export const createChildShape = (
  jolt: JoltModule,
  child: CompoundChild,
  hook: string,
): Jolt.Shape => {
  const inner = createChildSettings(jolt, child);

  const [x, y, z] = child.position;
  const [rx, ry, rz, rw] = child.rotation ?? [0, 0, 0, 1];
  const centred = x === 0 && y === 0 && z === 0;
  const upright = rx === 0 && ry === 0 && rz === 0 && rw === 1;

  if (centred && upright) {
    const result = inner.Create();
    jolt.destroy(inner);
    return shapeFromResult<Jolt.Shape>(result, hook);
  }

  const at = new jolt.Vec3(x, y, z);
  const facing = new jolt.Quat(rx, ry, rz, rw);
  const settings = new jolt.RotatedTranslatedShapeSettings(at, facing, inner);
  jolt.destroy(at);
  jolt.destroy(facing);

  const result = settings.Create();
  // The wrapper took a reference to the inner settings, so destroying it
  // releases them both. Destroying `inner` as well is a double free, and the
  // debug build aborts on it.
  jolt.destroy(settings);

  return shapeFromResult<Jolt.Shape>(result, hook);
};

/**
 * One collider, described rather than built. The body hooks each take their own
 * options and pass them through here, and it is also what `useInstancedBodies`
 * takes — so a swarm can use any collider a single body can, described the same
 * way.
 */
export type ColliderDescriptor =
  | { type: "box"; size: Vec3Tuple; convexRadius?: number }
  | { type: "sphere"; radius: number; segments?: number }
  | { type: "capsule"; height: number; radius: number; segments?: number }
  | {
      type: "cylinder";
      height: number;
      radius: number;
      convexRadius?: number;
      segments?: number;
    }
  | {
      type: "taperedCapsule";
      topRadius: number;
      bottomRadius: number;
      height: number;
    }
  | {
      type: "taperedCylinder";
      topRadius: number;
      bottomRadius: number;
      height: number;
      convexRadius?: number;
      /** Sides on the render mesh only. The collider is analytic. */
      renderSegments?: number;
    }
  /** Points, or the geometry to read them off. */
  | { type: "convex"; vertices?: number[][]; geometry?: BufferGeometry }
  | {
      type: "trimesh";
      mesh: TrimeshSource;
      buildQuality?: TrimeshBuildQuality;
      triangleUserData?: ArrayLike<number> | ((index: number) => number);
    }
  | { type: "compound"; shapes: CompoundChild[] }
  | { type: "empty"; centerOfMass?: Vec3Tuple };

/**
 * Anything the descriptors do not cover: the same factory contract `useBody`
 * takes, so an exotic collider is a function rather than a fork of the library.
 */
export type ColliderFactory<S extends Jolt.Shape = Jolt.Shape> = (
  jolt: JoltModule,
) => ShapeResult<S>;

export type ColliderSource<S extends Jolt.Shape = Jolt.Shape> =
  | ColliderDescriptor
  | ColliderFactory<S>;

/** Which Jolt shape each descriptor builds, so a call site keeps its exact type. */
export interface ColliderShapeFor {
  box: Jolt.BoxShape;
  sphere: Jolt.SphereShape;
  capsule: Jolt.CapsuleShape;
  cylinder: Jolt.CylinderShape;
  taperedCapsule: Jolt.Shape;
  taperedCylinder: Jolt.TaperedCylinderShape;
  convex: Jolt.ConvexShape;
  trimesh: Jolt.MeshShape;
  compound: Jolt.Shape;
  empty: Jolt.EmptyShape;
}

const hullPoints = (descriptor: {
  vertices?: number[][];
  geometry?: BufferGeometry;
}): number[][] => {
  if (descriptor.vertices) return descriptor.vertices;

  const position = descriptor.geometry?.getAttribute(
    "position",
  ) as BufferAttribute | undefined;

  if (!position) {
    throw new Error(
      "[r3f-jolt] a convex collider needs either `vertices` or a `geometry` " +
        "with a position attribute",
    );
  }

  const points: number[][] = [];
  for (let i = 0; i < position.count; i += 1) {
    points.push([position.getX(i), position.getY(i), position.getZ(i)]);
  }
  return points;
};

const build = (
  jolt: JoltModule,
  descriptor: ColliderDescriptor,
): ShapeResult<Jolt.Shape> => {
  switch (descriptor.type) {
    case "box": {
      const { size, convexRadius } = descriptor;
      const radius = convexRadius ?? defaultConvexRadius(size);
      const halfExtent = new jolt.Vec3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5);
      const shape = new jolt.BoxShape(halfExtent, radius, undefined);
      jolt.destroy(halfExtent);

      return {
        shape: finishShape(shape),
        geometry: new BoxGeometry(size[0], size[1], size[2]),
        // Jolt's own triangulation reports the sharp box whatever the convex
        // radius is, so debug would otherwise draw square edges on a collider
        // that has none.
        debugGeometry: () => roundedBoxGeometry(size, radius),
      };
    }

    case "sphere": {
      const { radius, segments = 32 } = descriptor;
      return {
        shape: finishShape(new jolt.SphereShape(radius, undefined)),
        geometry: new SphereGeometry(radius, segments, segments),
      };
    }

    case "capsule": {
      const { height, radius, segments = 32 } = descriptor;
      return {
        shape: finishShape(
          new jolt.CapsuleShape(height * 0.5, radius, undefined),
        ),
        geometry: new CapsuleGeometry(radius, height, 8, segments),
      };
    }

    case "cylinder": {
      const { height, radius, convexRadius, segments = 32 } = descriptor;
      return {
        shape: finishShape(
          new jolt.CylinderShape(
            height * 0.5,
            radius,
            convexRadius ?? defaultConvexRadius([height, radius * 2]),
            undefined,
          ),
        ),
        geometry: new CylinderGeometry(radius, radius, height, segments),
      };
    }

    case "taperedCapsule": {
      const { topRadius, bottomRadius, height } = descriptor;
      const settings = new jolt.TaperedCapsuleShapeSettings(
        height * 0.5,
        topRadius,
        bottomRadius,
        undefined,
      );
      const result = settings.Create();
      jolt.destroy(settings);
      const shape = shapeFromResult<Jolt.Shape>(result, "taperedCapsule");

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    }

    case "taperedCylinder": {
      const {
        topRadius,
        bottomRadius,
        height,
        convexRadius,
        renderSegments = 24,
      } = descriptor;

      // A cone's tip has no room for a rounded edge, so the default follows the
      // smaller radius down to zero.
      const radius =
        convexRadius ??
        defaultConvexRadius([topRadius, bottomRadius, height * 0.5]);

      const settings = new jolt.TaperedCylinderShapeSettings(
        height * 0.5,
        topRadius,
        bottomRadius,
        radius,
        undefined,
      );
      const result = settings.Create();
      jolt.destroy(settings);

      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.TaperedCylinderShape,
        "taperedCylinder",
      );

      return {
        shape,
        geometry: new CylinderGeometry(
          topRadius,
          bottomRadius,
          height,
          renderSegments,
        ),
        // Jolt rounds the rim by the convex radius and the render cylinder does
        // not, so debug draws the collider's own triangulation.
        debugGeometry: () => shapeToGeometry(jolt, shape),
      };
    }

    case "convex": {
      const settings = new jolt.ConvexHullShapeSettings();
      const point = new jolt.Vec3();

      for (const vertex of hullPoints(descriptor)) {
        point.Set(vertex[0], vertex[1], vertex[2]);
        settings.mPoints.push_back(point);
      }

      jolt.destroy(point);

      const result = settings.Create();
      jolt.destroy(settings);
      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.ConvexShape,
        "convex",
      );

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    }

    case "trimesh": {
      const shape = createTrimeshShape(jolt, descriptor, "trimesh");
      return { shape, geometry: shapeToGeometry(jolt, shape) };
    }

    case "compound": {
      const settings = new jolt.StaticCompoundShapeSettings();
      const at = new jolt.Vec3();
      const facing = new jolt.Quat(0, 0, 0, 1);

      for (const [index, child] of descriptor.shapes.entries()) {
        const problem = describeInvalidChild(child);

        if (problem) {
          console.error(
            `[r3f-jolt] compound: skipping child ${index} (${child.type}) — ${problem}.`,
          );
          continue;
        }

        const [x, y, z] = child.position;
        at.Set(x, y, z);

        const [rx, ry, rz, rw] = child.rotation ?? [0, 0, 0, 1];
        facing.Set(rx, ry, rz, rw);

        settings.AddShape(at, facing, createChildSettings(jolt, child), 0);
      }

      jolt.destroy(at);
      jolt.destroy(facing);

      const result = settings.Create();
      // AddShape took a reference to each child, so destroying the compound
      // releases them. Destroying a child by hand is a double free.
      jolt.destroy(settings);
      const shape = shapeFromResult<Jolt.Shape>(result, "compound");

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    }

    case "empty": {
      const { centerOfMass } = descriptor;
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
    }
  }
};

/**
 * Builds a collider from a descriptor, handing back the same
 * `{ shape, geometry }` a body hook's own factory does — the caller owns one
 * reference to the shape and releases it when done.
 */
export const createColliderShape = <D extends ColliderDescriptor>(
  jolt: JoltModule,
  descriptor: D,
): ShapeResult<ColliderShapeFor[D["type"]]> =>
  build(jolt, descriptor) as ShapeResult<ColliderShapeFor[D["type"]]>;

/** A descriptor or a factory, resolved to the one thing `useBody` wants. */
export const resolveCollider = <S extends Jolt.Shape>(
  jolt: JoltModule,
  source: ColliderSource<S>,
): ShapeResult<S> =>
  typeof source === "function"
    ? source(jolt)
    : (build(jolt, source) as ShapeResult<S>);
