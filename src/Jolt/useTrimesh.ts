import type Jolt from "jolt-physics";
import {
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import { createColliderShape } from "./internal/colliderShape";
import type {
  TrimeshBuildQuality,
  TrimeshSource,
} from "./internal/trimeshShape";

export type { TrimeshBuildQuality, TrimeshSource };

export interface UseTrimeshOptions extends Omit<BodyOptions, "motionType"> {
  mesh: TrimeshSource;
  buildQuality?: TrimeshBuildQuality;
  /**
   * A 32-bit tag per triangle — a surface type, a material id, an index into
   * whatever table you keep — read back off a hit through
   * `api.getTriangleUserData(hit.subShapeID)`. Either one value per triangle,
   * or a function called with the triangle's index.
   *
   * Costs four bytes a triangle in the shape, so it is opt-in.
   */
  triangleUserData?: ArrayLike<number> | ((triangleIndex: number) => number);
  motionType?: "static";
}

export interface TrimeshExtras {
  /**
   * The tag `triangleUserData` gave the triangle a query landed on. Zero
   * without it, and zero for a sub-shape id from some other body.
   */
  getTriangleUserData: (subShapeID: number) => number;
}

export const useTrimesh = (options: UseTrimeshOptions) => {
  const { mesh, buildQuality, triangleUserData } = options;

  return useBody<Jolt.MeshShape, TrimeshExtras>(
    (jolt) =>
      createColliderShape(jolt, {
        type: "trimesh",
        mesh,
        buildQuality,
        triangleUserData,
      }),
    { ...options, motionType: "static" },
    "trimesh",
    ({ jolt, shape }: BodyApiContext<Jolt.MeshShape>): TrimeshExtras => ({
      getTriangleUserData: (subShapeID: number) => {
        const id = new jolt.SubShapeID();
        id.SetValue(subShapeID);
        const value = shape.GetTriangleUserData(id);
        jolt.destroy(id);
        return value;
      },
    }),
  );
};
