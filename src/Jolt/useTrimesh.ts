import type {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
} from "three";
import type Jolt from "jolt-physics";
import {
  shapeFromResultAs,
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";

export type TrimeshSource =
  | BufferGeometry
  | {
      position: BufferAttribute | InterleavedBufferAttribute;
      index?: ArrayLike<number>;
    };

/**
 * `favorRuntimePerformance` is Jolt's default and builds a tighter tree;
 * `favorBuildSpeed` trades query speed for build time, which is what streaming
 * terrain in wants.
 */
export type TrimeshBuildQuality = "favorRuntimePerformance" | "favorBuildSpeed";

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

const readSource = (mesh: TrimeshSource) => {
  const position =
    "position" in mesh
      ? mesh.position
      : (mesh.getAttribute("position") as BufferAttribute);

  const index =
    "position" in mesh ? mesh.index : (mesh.getIndex()?.array ?? undefined);

  if (!position) {
    throw new Error(
      "[r3f-jolt] useTrimesh: the mesh has no position attribute",
    );
  }

  return { position, index };
};

export const useTrimesh = (options: UseTrimeshOptions) => {
  const { mesh, buildQuality, triangleUserData } = options;

  return useBody<Jolt.MeshShape, TrimeshExtras>(
    (jolt) => {
      const { position, index } = readSource(mesh);

      const vertexList = new jolt.VertexList();
      vertexList.reserve(position.count);

      const vertex = new jolt.Float3(0, 0, 0);
      for (let i = 0; i < position.count; i += 1) {
        vertex.x = position.getX(i);
        vertex.y = position.getY(i);
        vertex.z = position.getZ(i);
        vertexList.push_back(vertex);
      }
      jolt.destroy(vertex);

      const indexCount = index ? index.length : position.count;
      const triangleList = new jolt.IndexedTriangleList();
      triangleList.reserve(indexCount / 3);

      const userDataOf =
        typeof triangleUserData === "function"
          ? triangleUserData
          : triangleUserData
            ? (n: number) => triangleUserData[n]
            : null;

      const triangle = new jolt.IndexedTriangle();
      triangle.mMaterialIndex = 0;

      for (let i = 0; i < indexCount; i += 3) {
        triangle.set_mIdx(0, index ? index[i] : i);
        triangle.set_mIdx(1, index ? index[i + 1] : i + 1);
        triangle.set_mIdx(2, index ? index[i + 2] : i + 2);
        triangle.mUserData = userDataOf ? userDataOf(i / 3) : 0;
        triangleList.push_back(triangle);
      }
      jolt.destroy(triangle);

      const materials = new jolt.PhysicsMaterialList();
      materials.push_back(new jolt.PhysicsMaterial());

      const settings = new jolt.MeshShapeSettings(
        vertexList,
        triangleList,
        materials,
      );

      if (userDataOf) settings.mPerTriangleUserData = true;

      if (buildQuality) {
        settings.mBuildQuality =
          buildQuality === "favorBuildSpeed"
            ? jolt.MeshShapeSettings_EBuildQuality_FavorBuildSpeed
            : jolt.MeshShapeSettings_EBuildQuality_FavorRuntimePerformance;
      }

      const result = settings.Create();
      jolt.destroy(settings);
      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.MeshShape,
        "useTrimesh",
      );

      jolt.destroy(materials);
      jolt.destroy(triangleList);
      jolt.destroy(vertexList);

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
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
